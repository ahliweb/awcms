/**
 * Sender-aware `whatsapp_delivery` against a real PostgreSQL (Issue #1141,
 * ADR-0148 section 4): enqueue as the least-privilege runtime role, dispatch as
 * `awcms_worker`, FORCE RLS in force, two tenants with several senders each.
 *
 * Proves what a mock cannot:
 *
 *   * the sender is a snapshot on the ONE queue (immutable for every role, a
 *     composite tenant FK, a live-sender insert guard), and NULL is the
 *     deployment sender with an event payload that is byte for byte unchanged;
 *   * cross-tenant sender forgery: another tenant's account id is the same
 *     refusal as an unknown one, at the application AND at the database;
 *   * token isolation: each sender is sent through ITS OWN phone number id and
 *     credential, for ITS OWN tenant, and no request field can carry either;
 *   * a sender that is revoked, disabled, disconnected, unapproved or without an
 *     adapter is a refusal at enqueue and a terminal failure at dispatch, with
 *     the provider never called and no other sender used; a merely unavailable
 *     one is held;
 *   * the default is a PROSPECTIVE policy: a change affects later messages only;
 *   * a reply keeps the thread's sender; a different explicit sender conflicts;
 *   * per-sender breaker, quota and fair claiming; concurrent claims send each
 *     row once; a crashed pass is replayed without changing the sender;
 *   * consent and suppression follow the recipient, never the sender;
 *   * the worker's column-only grants, and that it can read nothing else.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import {
  assertRejected,
  getAdminSql,
  getRuntimeSql,
  getWorkerRoleSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
  workerRoleActivated
} from "./harness";
import {
  getProviderCircuitBreaker,
  resetProviderCircuitBreakersForTests
} from "../../src/lib/database/circuit-breaker";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { createChannelAccountPortAdapter } from "../../src/modules/channel-accounts/application/channel-account-port-adapter";
import { createChannelSenderCredentialAdapter } from "../../src/modules/channel-accounts/application/channel-sender-credential-adapter";
import {
  createKeyRingSecretStore,
  resetSecretDecryptCounts,
  snapshotSecretDecryptCounts
} from "../../src/modules/channel-accounts/application/secret-store";
import { resolveChannelSecretsRing } from "../../src/modules/channel-accounts/domain/channel-accounts-config";
import { PROVIDER_MATRIX_VERSION } from "../../src/modules/channel-accounts/domain/provider-matrix";
import {
  createSuppression,
  grantMarketingConsent,
  withdrawMarketingConsent
} from "../../src/modules/whatsapp-delivery/application/whatsapp-consent-directory";
import {
  dispatchWhatsappQueue,
  type DispatchWhatsappQueueOptions
} from "../../src/modules/whatsapp-delivery/application/whatsapp-dispatch";
import {
  enqueueWhatsappMessage,
  whatsappDeliveryPortAdapter
} from "../../src/modules/whatsapp-delivery/application/whatsapp-enqueue";
import {
  listSenderPolicies,
  setSenderPolicy,
  summarizeWhatsappSenders
} from "../../src/modules/whatsapp-delivery/application/whatsapp-sender-directory";
import { whatsappSenderBreakerKey } from "../../src/modules/whatsapp-delivery/domain/whatsapp-config";
import type {
  WhatsappProvider,
  WhatsappSendRequest,
  WhatsappSendResult
} from "../../src/modules/whatsapp-delivery/domain/whatsapp-provider-contract";
import { registerWhatsappTemplate } from "../../src/modules/whatsapp-delivery/domain/whatsapp-templates";
import type { BuildSenderProviderInput } from "../../src/modules/whatsapp-delivery/infrastructure/whatsapp-sender-providers";

const TENANT_A = "a1141000-0000-4000-8000-00000000000a";
const TENANT_B = "a1141000-0000-4000-8000-00000000000b";
const SCOPE_X = {
  type: "brand",
  id: "b1141000-0000-4000-8000-0000000000a1"
};
const SCOPE_Y = {
  type: "brand",
  id: "b1141000-0000-4000-8000-0000000000a2"
};
const PHONE = "+6281234567890";
const OTHER_PHONE = "+6289876543210";

const bytes = (mul: number) =>
  Buffer.from(
    Array.from({ length: 32 }, (_, i) => (i * mul + 3) % 251)
  ).toString("base64");
const HASH_KEY = bytes(7);
const SECRET_KEY = bytes(11);

const ring = resolveChannelSecretsRing({
  CHANNEL_SECRETS_ENCRYPTION_KEYS: `k1:${SECRET_KEY}`
} as unknown as NodeJS.ProcessEnv);

if (!ring.ok) throw new Error(ring.reason);

const store = createKeyRingSecretStore(() => ring);
const ENV = {
  WHATSAPP_ENABLED: "true",
  WHATSAPP_PROVIDER: "log",
  WHATSAPP_RECIPIENT_HASH_KEYS: `k1:${HASH_KEY}`,
  WHATSAPP_RATE_PER_RECIPIENT_PER_HOUR: "1000",
  WHATSAPP_RATE_PER_TENANT_PER_HOUR: "100000"
} as unknown as NodeJS.ProcessEnv;
const CA_ENV = {
  CHANNEL_ACCOUNTS_ENABLED: "true"
} as unknown as NodeJS.ProcessEnv;

// The consent and suppression functions read the key ring from the process
// environment (as the routes do); enqueue and dispatch take `ENV`.
process.env.WHATSAPP_RECIPIENT_HASH_KEYS = `k1:${HASH_KEY}`;

const senders = createChannelAccountPortAdapter({ env: CA_ENV });
const credentials = createChannelSenderCredentialAdapter({
  store,
  env: CA_ENV
});

registerWhatsappTemplate({
  key: "it1141.reminder",
  version: 1,
  purpose: "transactional",
  body: "Reminder for {{name}}",
  variables: ["name"]
});
registerWhatsappTemplate({
  key: "it1141.promo",
  version: 1,
  purpose: "marketing",
  body: "Sale for {{name}}",
  variables: ["name"]
});

const runtime = () => getRuntimeSql();
const inTenant = <T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
) => withTenantOrThrow(runtime(), tenantId, fn);

let sequence = 0;
const nextKey = () => `k1141-${(sequence += 1)}`;
let phoneId = 1_000_000_000_000;
const nextPhoneId = () => String((phoneId += 1));

type EnqueueOver = Partial<Parameters<typeof enqueueWhatsappMessage>[1]>;

function enqueue(tenantId: string, over: EnqueueOver = {}) {
  return inTenant(tenantId, (tx) =>
    enqueueWhatsappMessage(
      tx,
      {
        tenantId,
        templateKey: "it1141.reminder",
        variables: { name: "Sari" },
        recipient: { kind: "address", phone: PHONE },
        idempotencyKey: nextKey(),
        ...over
      },
      { env: ENV, senders }
    )
  );
}

const queuedId = (result: { status: string }) =>
  (result as unknown as { messageId: string }).messageId;

type AccountSeed = {
  provider?: string;
  kind?: string;
  authMode?: string;
  status?: string;
  scope?: { type: string; id: string } | null;
  externalId?: string;
  token?: string | null;
  capabilities?: ("dm" | "reply" | "broadcast")[] | null;
};

/** A tenant-owned account, its capability evidence and (optionally) its credential, through the real secret store. */
async function seedAccount(
  tenantId: string,
  seed: AccountSeed = {}
): Promise<{ id: string; externalId: string; token: string | null }> {
  const admin = getAdminSql();
  const provider = seed.provider ?? "whatsapp_cloud";
  const kind =
    seed.kind ?? (provider === "starsender" ? "device" : "waba_phone_number");
  const authMode =
    seed.authMode ?? (provider === "starsender" ? "device_key" : "api_token");
  const externalId = seed.externalId ?? nextPhoneId();
  const rows = (await admin`
    INSERT INTO awcms_channel_accounts
      (tenant_id, business_scope_type, business_scope_id, provider,
       account_kind, external_id, display_name, auth_mode, status)
    VALUES (${tenantId}, ${seed.scope?.type ?? null}, ${seed.scope?.id ?? null},
            ${provider}, ${kind}, ${externalId}, ${`n-${externalId}`},
            ${authMode}, ${seed.status ?? "connected"})
    RETURNING id
  `) as { id: string }[];
  const id = rows[0]!.id;

  for (const capability of seed.capabilities === undefined
    ? ["dm", "reply", "broadcast"]
    : (seed.capabilities ?? [])) {
    await admin`
      INSERT INTO awcms_channel_account_capabilities
        (tenant_id, account_id, capability, state, evidence_kind,
         evidence_ref, matrix_version, verified_at)
      VALUES (${tenantId}, ${id}, ${capability}, 'granted',
              ${provider === "starsender" && capability === "broadcast" ? "contract_reference" : "app_review_reference"},
              'evidence-1', ${PROVIDER_MATRIX_VERSION}, now())
    `;
  }

  const token =
    seed.token === undefined
      ? `TOKEN-${externalId}-${tenantId.slice(-1)}`
      : seed.token;

  if (token !== null) {
    const ref = await inTenant(tenantId, (tx) =>
      store.put(tx, {
        tenantId,
        purpose: authMode === "device_key" ? "device_key" : "api_token",
        plaintext: token,
        createdBy: null
      })
    );

    await admin`
      UPDATE awcms_channel_accounts SET secret_id = ${ref.secretId}
      WHERE id = ${id}
    `;
  }

  return { id, externalId, token };
}

async function setStatus(accountId: string, status: string): Promise<void> {
  await getAdminSql()`
    UPDATE awcms_channel_accounts
    SET status = ${status}, revoked_at = ${status === "revoked" ? new Date() : null}
    WHERE id = ${accountId}
  `;
}

async function row(id: string) {
  return (
    (await getAdminSql()`
    SELECT * FROM awcms_whatsapp_messages WHERE id = ${id}
  `) as Record<string, unknown>[]
  )[0]!;
}

async function count(table: string, where = "true"): Promise<number> {
  return (
    (await getAdminSql().unsafe(
      `SELECT count(*)::int AS n FROM ${table} WHERE ${where}`
    )) as { n: number }[]
  )[0]!.n;
}

type Sent = {
  senderAccountId: string | null;
  externalId: string | null;
  credential: string | null;
  request: WhatsappSendRequest;
  openWorkerTransactions: number;
};

type Harness = {
  sent: Sent[];
  built: BuildSenderProviderInput[];
  options: (
    over?: Partial<DispatchWhatsappQueueOptions>
  ) => DispatchWhatsappQueueOptions;
};

/**
 * A dispatcher with NO network: the deployment provider and every tenant-owned
 * sender's provider are fakes that record who they were built for and what they
 * were asked to send, and that ask Postgres, from a separate connection, whether
 * the worker holds an open transaction at the instant of `send`.
 */
function makeHarness(
  script: (
    sent: Sent,
    call: number
  ) => WhatsappSendResult | Promise<WhatsappSendResult> = () => ({
    ok: true,
    providerMessageId: "wamid.test"
  })
): Harness {
  const sent: Sent[] = [];
  const built: BuildSenderProviderInput[] = [];

  const make = (
    senderAccountId: string | null,
    externalId: string | null,
    credential: string | null
  ): WhatsappProvider => ({
    async send(request) {
      const open = (await getAdminSql()`
        SELECT count(*)::int AS open FROM pg_stat_activity
        WHERE datname = current_database() AND usename = 'awcms_worker'
          AND state LIKE 'idle in transaction%'
      `) as { open: number }[];
      const entry: Sent = {
        senderAccountId,
        externalId,
        credential,
        request,
        openWorkerTransactions: open[0]!.open
      };

      sent.push(entry);

      return await script(entry, sent.length);
    },
    async healthCheck() {
      return { ok: true };
    }
  });

  return {
    sent,
    built,
    options: (over = {}) => ({
      env: ENV,
      senders,
      credentials,
      resolveProvider: () => make(null, null, null),
      buildSenderProvider: (input) => {
        built.push(input);

        return make(
          input.sender.accountId,
          input.sender.externalId,
          input.credential
        );
      },
      ...over
    })
  };
}

const dispatch = (
  tenantId: string,
  harness: Harness,
  over: Partial<DispatchWhatsappQueueOptions> = {}
) =>
  dispatchWhatsappQueue(
    getWorkerRoleSql(),
    tenantId,
    harness.options({ now: new Date(Date.now() + 1000), ...over })
  );

function workerTest(name: string, fn: () => Promise<void>): void {
  test(name, async () => {
    if (!workerRoleActivated) return;

    await fn();
  });
}

async function seedTenants(): Promise<void> {
  const admin = getAdminSql();

  for (const [id, code] of [
    [TENANT_A, "wa1141-a"],
    [TENANT_B, "wa1141-b"]
  ] as const) {
    await admin`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${id}, ${code}, ${code})
    `;
  }
}

const suite = integrationEnabled ? describe : describe.skip;

suite("whatsapp_delivery sender routing against PostgreSQL", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    resetProviderCircuitBreakersForTests();
    resetSecretDecryptCounts();
    await seedTenants();
  });

  describe("the deployment sender is unchanged", () => {
    test("a message that names no sender is queued with a NULL sender, and its event payload has no sender key", async () => {
      const result = await enqueue(TENANT_A, { correlationId: "c-1" });

      expect(result.status).toBe("queued");

      const message = await row(queuedId(result));

      expect(message.sender_account_id).toBeNull();
      expect(message.sender_selection).toBe("deployment");
      expect(message.sender_policy_version).toBeNull();
      expect(message.business_scope_type).toBeNull();

      const events = (await getAdminSql()`
        SELECT payload FROM awcms_domain_events WHERE tenant_id = ${TENANT_A}
      `) as { payload: Record<string, unknown> }[];

      expect(Object.keys(events[0]!.payload).sort()).toEqual([
        "messageId",
        "purpose",
        "recipientMasked",
        "status",
        "templateKey"
      ]);
    });

    test("the port adapter an existing consumer holds still enqueues with the 1.0.0 input shape", async () => {
      const result = await inTenant(TENANT_A, (tx) =>
        whatsappDeliveryPortAdapter.enqueue(tx, {
          tenantId: TENANT_A,
          templateKey: "it1141.reminder",
          variables: { name: "Sari" },
          recipient: { kind: "address", phone: PHONE },
          idempotencyKey: nextKey()
        })
      );

      // Not enabled in process.env here: the refusal is the OLD, unchanged one.
      expect(result).toEqual({ status: "refused", reason: "DISABLED" });
    });

    workerTest(
      "a NULL-sender row is dispatched through the deployment provider, as before",
      async () => {
        const queued = await enqueue(TENANT_A);
        const harness = makeHarness();
        const result = await dispatch(TENANT_A, harness);

        expect(result).toMatchObject({
          claimed: 1,
          sent: 1,
          failed: 0,
          held: 0
        });
        expect(harness.sent).toHaveLength(1);
        expect(harness.sent[0]!.senderAccountId).toBeNull();
        expect(harness.built).toHaveLength(0);
        expect((await row(queuedId(queued))).status).toBe("sent");
      }
    );
  });

  describe("enqueue with a sender", () => {
    test("an explicit sender is snapshotted on the one queue and named in the event", async () => {
      const a1 = await seedAccount(TENANT_A);
      const result = await enqueue(TENANT_A, { senderAccountId: a1.id });

      expect(result.status).toBe("queued");

      const message = await row(queuedId(result));

      expect(message.sender_account_id).toBe(a1.id);
      expect(message.sender_selection).toBe("explicit");
      // The number and the token are on no queue row.
      expect(JSON.stringify(message)).not.toContain(a1.externalId);
      expect(JSON.stringify(message)).not.toContain(a1.token!);

      const events = JSON.stringify(
        await getAdminSql()`SELECT payload FROM awcms_domain_events WHERE tenant_id = ${TENANT_A}`
      );

      expect(events).toContain(a1.id);
      expect(events).not.toContain(a1.externalId);
      expect(events).not.toContain(a1.token!);
    });

    test("cross-tenant sender forgery: another tenant's account is the same refusal as an unknown one, and nothing is queued", async () => {
      const aAccount = await seedAccount(TENANT_A);
      const bAccount = await seedAccount(TENANT_B);

      // Tenant B names tenant A's account.
      expect(await enqueue(TENANT_B, { senderAccountId: aAccount.id })).toEqual(
        {
          status: "refused",
          reason: "SENDER_UNAVAILABLE"
        }
      );
      // ... and an id that exists nowhere gives the identical answer.
      expect(
        await enqueue(TENANT_B, {
          senderAccountId: "ffffffff-ffff-4fff-8fff-ffffffffffff"
        })
      ).toEqual({ status: "refused", reason: "SENDER_UNAVAILABLE" });
      // A malformed id and a provider name are not accounts either.
      for (const forged of ["starsender", "' OR 1=1 --", aAccount.externalId]) {
        expect(await enqueue(TENANT_B, { senderAccountId: forged })).toEqual({
          status: "refused",
          reason: "SENDER_UNAVAILABLE"
        });
      }

      expect(await count("awcms_whatsapp_messages")).toBe(0);
      // Each tenant can still use its own.
      expect(
        (await enqueue(TENANT_B, { senderAccountId: bAccount.id })).status
      ).toBe("queued");
      expect(
        (await enqueue(TENANT_A, { senderAccountId: aAccount.id })).status
      ).toBe("queued");
    });

    test("cross-tenant sender forgery at the DATABASE: the composite FK and RLS refuse a row that points at another tenant's account", async () => {
      const aAccount = await seedAccount(TENANT_A);

      await assertRejected(
        inTenant(
          TENANT_B,
          (tx) => tx`
          INSERT INTO awcms_whatsapp_messages
            (tenant_id, idempotency_key, template_key, purpose, recipient,
             recipient_hash, recipient_masked, body, status, sender_account_id,
             sender_selection)
          VALUES (${TENANT_B}, 'forged', 'it1141.reminder', 'transactional',
                  ${PHONE}, 'k1:x', '+*', 'x', 'queued', ${aAccount.id},
                  'explicit')
        `
        ),
        "a message of tenant B whose sender is tenant A's account"
      );
      expect(await count("awcms_whatsapp_messages")).toBe(0);
    });

    test("a sender that is revoked, disabled, pending, degraded or unapproved is refused, never replaced", async () => {
      for (const status of ["revoked", "disabled", "pending", "degraded"]) {
        const account = await seedAccount(TENANT_A, { status });

        expect(
          await enqueue(TENANT_A, { senderAccountId: account.id })
        ).toEqual({ status: "refused", reason: "SENDER_UNAVAILABLE" });
      }

      // Unapproved: connected, but no capability evidence at all.
      const unapproved = await seedAccount(TENANT_A, { capabilities: [] });

      expect(
        await enqueue(TENANT_A, { senderAccountId: unapproved.id })
      ).toEqual({ status: "refused", reason: "SENDER_UNAVAILABLE" });

      // A usable sender exists, but the refusal does not fall to it or to the deployment sender.
      await seedAccount(TENANT_A);
      expect(await count("awcms_whatsapp_messages")).toBe(0);
    });

    test("a disconnected connection and a withdrawn capability deny at once", async () => {
      const account = await seedAccount(TENANT_A);

      expect(
        (await enqueue(TENANT_A, { senderAccountId: account.id })).status
      ).toBe("queued");

      await getAdminSql()`
        UPDATE awcms_channel_account_capabilities SET state = 'denied'
        WHERE account_id = ${account.id} AND capability = 'dm'
      `;
      expect(await enqueue(TENANT_A, { senderAccountId: account.id })).toEqual({
        status: "refused",
        reason: "SENDER_UNAVAILABLE"
      });
    });

    test("a StarSender device has no adapter yet: refused, not queued to wait forever", async () => {
      const device = await seedAccount(TENANT_A, { provider: "starsender" });

      expect(await enqueue(TENANT_A, { senderAccountId: device.id })).toEqual({
        status: "refused",
        reason: "SENDER_UNAVAILABLE"
      });
    });

    test("the control plane switched off refuses every tenant-owned sender but leaves the deployment sender alone", async () => {
      const account = await seedAccount(TENANT_A);
      const off = createChannelAccountPortAdapter({
        env: {} as NodeJS.ProcessEnv
      });
      const attempt = (over: EnqueueOver) =>
        inTenant(TENANT_A, (tx) =>
          enqueueWhatsappMessage(
            tx,
            {
              tenantId: TENANT_A,
              templateKey: "it1141.reminder",
              variables: { name: "Sari" },
              recipient: { kind: "address", phone: PHONE },
              idempotencyKey: nextKey(),
              ...over
            },
            { env: ENV, senders: off }
          )
        );

      expect(await attempt({ senderAccountId: account.id })).toEqual({
        status: "refused",
        reason: "SENDER_UNAVAILABLE"
      });
      expect((await attempt({})).status).toBe("queued");
    });

    test("a scoped account sends only for its own business scope; a tenant-wide one for any", async () => {
      const scoped = await seedAccount(TENANT_A, { scope: SCOPE_X });
      const wide = await seedAccount(TENANT_A);

      expect(
        (
          await enqueue(TENANT_A, {
            senderAccountId: scoped.id,
            businessScope: SCOPE_X
          })
        ).status
      ).toBe("queued");
      for (const businessScope of [SCOPE_Y, undefined]) {
        expect(
          await enqueue(TENANT_A, {
            senderAccountId: scoped.id,
            ...(businessScope ? { businessScope } : {})
          })
        ).toEqual({ status: "refused", reason: "SENDER_UNAVAILABLE" });
      }
      expect(
        (
          await enqueue(TENANT_A, {
            senderAccountId: wide.id,
            businessScope: SCOPE_Y
          })
        ).status
      ).toBe("queued");
      // A malformed scope fails closed.
      expect(
        await enqueue(TENANT_A, {
          senderAccountId: wide.id,
          businessScope: { type: "Brand!", id: "x" }
        })
      ).toEqual({ status: "refused", reason: "SENDER_UNAVAILABLE" });
    });

    test("idempotency: a replay is `duplicate` with the same message, even after the sender is revoked, and inserts nothing", async () => {
      const account = await seedAccount(TENANT_A);
      const first = await enqueue(TENANT_A, {
        senderAccountId: account.id,
        idempotencyKey: "same-key"
      });

      await setStatus(account.id, "revoked");

      const replay = await enqueue(TENANT_A, {
        senderAccountId: account.id,
        idempotencyKey: "same-key"
      });

      expect(replay).toEqual({
        status: "duplicate",
        messageId: queuedId(first)
      });
      expect(await count("awcms_whatsapp_messages")).toBe(1);
    });

    test("concurrent enqueues of one idempotency key and sender make one message", async () => {
      const account = await seedAccount(TENANT_A);
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          enqueue(TENANT_A, {
            senderAccountId: account.id,
            idempotencyKey: "race"
          })
        )
      );

      expect(results.filter((r) => r.status === "queued")).toHaveLength(1);
      expect(results.filter((r) => r.status === "duplicate")).toHaveLength(5);
      expect(await count("awcms_whatsapp_messages")).toBe(1);
    });
  });

  describe("the snapshot is immutable", () => {
    test("no role can re-point a queued message at another sender, change how it was chosen, or move its scope", async () => {
      const first = await seedAccount(TENANT_A);
      const second = await seedAccount(TENANT_A);
      const queued = await enqueue(TENANT_A, { senderAccountId: first.id });
      const id = queuedId(queued);

      for (const change of [
        (sql: Bun.SQL) =>
          sql`UPDATE awcms_whatsapp_messages SET sender_account_id = ${second.id} WHERE id = ${id}`,
        (sql: Bun.SQL) =>
          sql`UPDATE awcms_whatsapp_messages SET sender_account_id = NULL, sender_selection = 'deployment' WHERE id = ${id}`,
        (sql: Bun.SQL) =>
          sql`UPDATE awcms_whatsapp_messages SET sender_selection = 'policy' WHERE id = ${id}`,
        (sql: Bun.SQL) =>
          sql`UPDATE awcms_whatsapp_messages SET business_scope_type = 'brand', business_scope_id = ${SCOPE_X.id} WHERE id = ${id}`
      ]) {
        // The table owner bypasses RLS but not the trigger.
        await assertRejected(
          Promise.resolve(change(getAdminSql())),
          "an UPDATE of the sender snapshot"
        );
        await assertRejected(
          inTenant(TENANT_A, (tx) => Promise.resolve(change(tx))),
          "an UPDATE of the sender snapshot as the runtime role"
        );
      }

      expect((await row(id)).sender_account_id).toBe(first.id);
    });

    test("an ordinary state change of the row is still allowed", async () => {
      const account = await seedAccount(TENANT_A);
      const queued = await enqueue(TENANT_A, { senderAccountId: account.id });

      await getAdminSql()`
        UPDATE awcms_whatsapp_messages SET status = 'cancelled' WHERE id = ${queuedId(queued)}
      `;
      expect((await row(queuedId(queued))).status).toBe("cancelled");
    });

    test("the database refuses a row whose sender is not connected, whatever the application did", async () => {
      const account = await seedAccount(TENANT_A, { status: "revoked" });

      await assertRejected(
        getAdminSql()`
          INSERT INTO awcms_whatsapp_messages
            (tenant_id, idempotency_key, template_key, purpose, recipient,
             recipient_hash, recipient_masked, body, status, sender_account_id,
             sender_selection)
          VALUES (${TENANT_A}, 'raw', 'it1141.reminder', 'transactional',
                  ${PHONE}, 'k1:x', '+*', 'x', 'queued', ${account.id}, 'explicit')
        `,
        "a message whose sender is revoked"
      );
      await assertRejected(
        getAdminSql()`
          INSERT INTO awcms_whatsapp_messages
            (tenant_id, idempotency_key, template_key, purpose, recipient,
             recipient_hash, recipient_masked, body, status, sender_account_id,
             sender_selection)
          VALUES (${TENANT_A}, 'raw2', 'it1141.reminder', 'transactional',
                  ${PHONE}, 'k1:x', '+*', 'x', 'queued', NULL, 'explicit')
        `,
        "an explicit selection with no sender"
      );
    });
  });

  describe("the default sender is a prospective policy", () => {
    test("with no policy a message gets the deployment sender; a policy changes only LATER messages", async () => {
      const first = await seedAccount(TENANT_A);
      const second = await seedAccount(TENANT_A);

      const user = await actor();
      const before = await enqueue(TENANT_A, {});

      const set = await inTenant(TENANT_A, (tx) =>
        setSenderPolicy(
          tx,
          TENANT_A,
          user,
          { businessScope: null, defaultSenderAccountId: first.id },
          senders
        )
      );

      expect(set).toMatchObject({
        outcome: "set",
        changed: true,
        policy: { configVersion: 1 }
      });

      const underFirst = await enqueue(TENANT_A, {});
      const change = await inTenant(TENANT_A, (tx) =>
        setSenderPolicy(
          tx,
          TENANT_A,
          user,
          { businessScope: null, defaultSenderAccountId: second.id },
          senders
        )
      );

      expect(change).toMatchObject({
        changed: true,
        policy: { configVersion: 2 }
      });

      const underSecond = await enqueue(TENANT_A, {});

      expect((await row(queuedId(before))).sender_account_id).toBeNull();
      const m1 = await row(queuedId(underFirst));
      const m2 = await row(queuedId(underSecond));

      // The earlier message KEEPS the sender it was given.
      expect(m1.sender_account_id).toBe(first.id);
      expect(m1.sender_selection).toBe("policy");
      expect(m1.sender_policy_version).toBe(1);
      expect(m2.sender_account_id).toBe(second.id);
      expect(m2.sender_policy_version).toBe(2);
    });

    test("an unchanged default is a no-op that bumps nothing", async () => {
      const account = await seedAccount(TENANT_A);
      const input = { businessScope: null, defaultSenderAccountId: account.id };
      const user = await actor();

      const one = await inTenant(TENANT_A, (tx) =>
        setSenderPolicy(tx, TENANT_A, user, input, senders)
      );
      const two = await inTenant(TENANT_A, (tx) =>
        setSenderPolicy(tx, TENANT_A, user, input, senders)
      );

      expect(one).toMatchObject({
        changed: true,
        policy: { configVersion: 1 }
      });
      expect(two).toMatchObject({
        changed: false,
        policy: { configVersion: 1 }
      });
    });

    test("a business scope's own row beats the tenant-wide row, and a null default pins the deployment sender", async () => {
      const wide = await seedAccount(TENANT_A);
      const brandX = await seedAccount(TENANT_A, { scope: SCOPE_X });
      const user = await actor();

      await inTenant(TENANT_A, async (tx) => {
        await setSenderPolicy(
          tx,
          TENANT_A,
          user,
          { businessScope: null, defaultSenderAccountId: wide.id },
          senders
        );
        await setSenderPolicy(
          tx,
          TENANT_A,
          user,
          { businessScope: SCOPE_X, defaultSenderAccountId: brandX.id },
          senders
        );
      });

      const forX = await enqueue(TENANT_A, { businessScope: SCOPE_X });
      const forY = await enqueue(TENANT_A, { businessScope: SCOPE_Y });
      const unscoped = await enqueue(TENANT_A, {});

      expect((await row(queuedId(forX))).sender_account_id).toBe(brandX.id);
      expect((await row(queuedId(forY))).sender_account_id).toBe(wide.id);
      expect((await row(queuedId(unscoped))).sender_account_id).toBe(wide.id);
      expect((await row(queuedId(forX))).business_scope_id).toBe(SCOPE_X.id);

      await inTenant(TENANT_A, (tx) =>
        setSenderPolicy(
          tx,
          TENANT_A,
          user,
          { businessScope: SCOPE_Y, defaultSenderAccountId: null },
          senders
        )
      );

      const pinned = await enqueue(TENANT_A, { businessScope: SCOPE_Y });
      const pinnedRow = await row(queuedId(pinned));

      expect(pinnedRow.sender_account_id).toBeNull();
      expect(pinnedRow.sender_selection).toBe("deployment");
      expect(pinnedRow.sender_policy_version).toBe(1);
    });

    test("a policy that names a sender that cannot send is refused, never stored; another tenant's account is the same refusal", async () => {
      const mine = await seedAccount(TENANT_A, { status: "revoked" });
      const theirs = await seedAccount(TENANT_B);
      const user = await actor();

      for (const id of [
        mine.id,
        theirs.id,
        "ffffffff-ffff-4fff-8fff-ffffffffffff"
      ]) {
        expect(
          await inTenant(TENANT_A, (tx) =>
            setSenderPolicy(
              tx,
              TENANT_A,
              user,
              { businessScope: null, defaultSenderAccountId: id },
              senders
            )
          )
        ).toEqual({ outcome: "refused", code: "SENDER_UNAVAILABLE" });
      }
      expect(await count("awcms_whatsapp_sender_policies")).toBe(0);
    });

    test("a policy cannot be changed across tenants or re-scoped, and its version only moves forward", async () => {
      const account = await seedAccount(TENANT_A);
      const user = await actor();

      await inTenant(TENANT_A, (tx) =>
        setSenderPolicy(
          tx,
          TENANT_A,
          user,
          { businessScope: null, defaultSenderAccountId: account.id },
          senders
        )
      );
      const policies = await inTenant(TENANT_A, (tx) =>
        listSenderPolicies(tx, TENANT_A)
      );

      expect(policies).toHaveLength(1);
      // Tenant B sees none of it (RLS FORCE).
      expect(
        await inTenant(TENANT_B, (tx) => listSenderPolicies(tx, TENANT_B))
      ).toEqual([]);

      await assertRejected(
        getAdminSql()`UPDATE awcms_whatsapp_sender_policies SET business_scope_type = 'brand', business_scope_id = ${SCOPE_X.id}`,
        "re-scoping a policy"
      );
      await assertRejected(
        getAdminSql()`UPDATE awcms_whatsapp_sender_policies SET config_version = 0`,
        "moving a policy version backwards"
      );
      await assertRejected(
        getAdminSql()`
          UPDATE awcms_whatsapp_sender_policies SET tenant_id = ${TENANT_B}
        `,
        "moving a policy to another tenant"
      );
    });

    test("RLS is FORCED on the policy table; the worker may READ it (an enqueueing job selects the default) but never write it", async () => {
      const flags = (await getAdminSql()`
        SELECT relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE relname = 'awcms_whatsapp_sender_policies'
      `) as { relrowsecurity: boolean; relforcerowsecurity: boolean }[];

      expect(flags[0]).toEqual({
        relrowsecurity: true,
        relforcerowsecurity: true
      });

      if (workerRoleActivated) {
        const account = await seedAccount(TENANT_A);

        await inTenant(TENANT_A, async (tx) =>
          setSenderPolicy(
            tx,
            TENANT_A,
            await actor(),
            { businessScope: null, defaultSenderAccountId: account.id },
            senders
          )
        );

        // Reads its own tenant's row only (RLS applies to the worker too).
        expect(
          await inTenantWorker(
            TENANT_A,
            (tx) => tx`SELECT id FROM awcms_whatsapp_sender_policies`
          )
        ).toHaveLength(1);
        expect(
          await inTenantWorker(
            TENANT_B,
            (tx) => tx`SELECT id FROM awcms_whatsapp_sender_policies`
          )
        ).toHaveLength(0);

        for (const write of [
          (tx: Bun.SQL) =>
            tx`UPDATE awcms_whatsapp_sender_policies SET default_sender_account_id = NULL`,
          (tx: Bun.SQL) => tx`DELETE FROM awcms_whatsapp_sender_policies`,
          (tx: Bun.SQL) =>
            tx`INSERT INTO awcms_whatsapp_sender_policies (tenant_id) VALUES (${TENANT_A})`
        ]) {
          await assertRejected(
            inTenantWorker(TENANT_A, (tx) => write(tx)),
            "a worker write to the sender policy"
          );
        }
      }
    });
  });

  describe("thread affinity", () => {
    test("a reply keeps the thread's sender even when the policy now points elsewhere", async () => {
      const first = await seedAccount(TENANT_A);
      const second = await seedAccount(TENANT_A);
      const opening = await enqueue(TENANT_A, { senderAccountId: first.id });

      const user = await actor();

      await inTenant(TENANT_A, (tx) =>
        setSenderPolicy(
          tx,
          TENANT_A,
          user,
          { businessScope: null, defaultSenderAccountId: second.id },
          senders
        )
      );

      const reply = await enqueue(TENANT_A, {
        inReplyToMessageId: queuedId(opening)
      });
      const replyRow = await row(queuedId(reply));

      expect(replyRow.sender_account_id).toBe(first.id);
      expect(replyRow.sender_selection).toBe("reply");
      // A message that is NOT a reply follows the new policy.
      expect(
        (await row(queuedId(await enqueue(TENANT_A, {})))).sender_account_id
      ).toBe(second.id);
    });

    test("a different explicit sender is a conflict, a foreign or other-recipient target is unknown, and none falls back", async () => {
      const first = await seedAccount(TENANT_A);
      const second = await seedAccount(TENANT_A);
      const other = await seedAccount(TENANT_B);
      const opening = await enqueue(TENANT_A, { senderAccountId: first.id });
      const foreign = await enqueue(TENANT_B, { senderAccountId: other.id });

      expect(
        await enqueue(TENANT_A, {
          inReplyToMessageId: queuedId(opening),
          senderAccountId: second.id
        })
      ).toEqual({ status: "refused", reason: "SENDER_AFFINITY_CONFLICT" });
      // Another tenant's message id.
      expect(
        await enqueue(TENANT_A, { inReplyToMessageId: queuedId(foreign) })
      ).toEqual({ status: "refused", reason: "REPLY_TARGET_UNKNOWN" });
      // The same tenant's message, but addressed to someone else.
      expect(
        await enqueue(TENANT_A, {
          inReplyToMessageId: queuedId(opening),
          recipient: { kind: "address", phone: OTHER_PHONE }
        })
      ).toEqual({ status: "refused", reason: "REPLY_TARGET_UNKNOWN" });
      expect(
        await enqueue(TENANT_A, { inReplyToMessageId: "not-a-uuid" })
      ).toEqual({ status: "refused", reason: "REPLY_TARGET_UNKNOWN" });
      // A thread that began on the deployment sender cannot be moved to an account.
      const deployment = await enqueue(TENANT_A, {});

      expect(
        await enqueue(TENANT_A, {
          inReplyToMessageId: queuedId(deployment),
          senderAccountId: first.id
        })
      ).toEqual({ status: "refused", reason: "SENDER_AFFINITY_CONFLICT" });
    });

    test("a reply whose thread sender has since been revoked is refused, not sent from another number", async () => {
      const first = await seedAccount(TENANT_A);

      await seedAccount(TENANT_A);

      const opening = await enqueue(TENANT_A, { senderAccountId: first.id });

      await setStatus(first.id, "revoked");

      expect(
        await enqueue(TENANT_A, { inReplyToMessageId: queuedId(opening) })
      ).toEqual({ status: "refused", reason: "SENDER_UNAVAILABLE" });
    });
  });

  describe("dispatch: two tenants, several senders, token isolation", () => {
    workerTest(
      "each message goes through ITS sender's phone number id and credential, for ITS tenant",
      async () => {
        const a1 = await seedAccount(TENANT_A);
        const a2 = await seedAccount(TENANT_A);
        const b1 = await seedAccount(TENANT_B);
        const b2 = await seedAccount(TENANT_B);
        const expected = new Map<string, string>();

        for (const [tenant, account] of [
          [TENANT_A, a1],
          [TENANT_A, a2],
          [TENANT_B, b1],
          [TENANT_B, b2]
        ] as const) {
          const queued = await enqueue(tenant, {
            senderAccountId: account.id,
            correlationId: `corr-${account.id}`
          });

          expect(queued.status).toBe("queued");
          expected.set(`corr-${account.id}`, account.id);
        }
        await enqueue(TENANT_A, { correlationId: "corr-deployment" });

        const harness = makeHarness();
        const resultA = await dispatch(TENANT_A, harness);
        const resultB = await dispatch(TENANT_B, harness);

        expect(resultA).toMatchObject({ claimed: 3, sent: 3, failed: 0 });
        expect(resultB).toMatchObject({ claimed: 2, sent: 2, failed: 0 });

        const byAccount = new Map(
          harness.sent
            .filter((s) => s.senderAccountId !== null)
            .map((s) => [s.senderAccountId!, s])
        );

        for (const account of [a1, a2, b1, b2]) {
          const sent = byAccount.get(account.id)!;

          // The request was built from the sender's OWN record and credential.
          expect(sent.externalId).toBe(account.externalId);
          expect(sent.credential).toBe(account.token);
          expect(sent.request.correlationId).toBe(`corr-${account.id}`);
          // ... and not one transaction of the worker was open while it called out.
          expect(sent.openWorkerTransactions).toBe(0);
        }

        expect(harness.built.map((b) => b.sender.externalId).sort()).toEqual(
          [a1, a2, b1, b2].map((a) => a.externalId).sort()
        );
        // The deployment lane used the deployment provider only.
        expect(
          harness.sent.filter((s) => s.senderAccountId === null)
        ).toHaveLength(1);
        // Decrypts are counted per tenant and purpose: two per tenant, one per lane.
        const counts = snapshotSecretDecryptCounts();

        expect(
          counts
            .filter((c) => c.tenantId === TENANT_A)
            .reduce((n, c) => n + c.count, 0)
        ).toBe(2);
        expect(
          counts
            .filter((c) => c.tenantId === TENANT_B)
            .reduce((n, c) => n + c.count, 0)
        ).toBe(2);

        for (const message of (await getAdminSql()`SELECT * FROM awcms_whatsapp_messages`) as Record<
          string,
          unknown
        >[]) {
          expect(message.status).toBe("sent");
          expect(message.provider_name).toBe(
            message.sender_account_id ? "whatsapp_cloud" : "log"
          );
        }
        // No token or number on an attempt row or in an event.
        const evidence = JSON.stringify([
          await getAdminSql()`SELECT * FROM awcms_whatsapp_delivery_attempts`,
          await getAdminSql()`SELECT payload FROM awcms_domain_events`
        ]);

        for (const account of [a1, a2, b1, b2]) {
          expect(evidence).not.toContain(account.token!);
          expect(evidence).not.toContain(account.externalId);
        }
      }
    );

    workerTest(
      "a tenant's dispatch pass can never read another tenant's account or credential",
      async () => {
        const aAccount = await seedAccount(TENANT_A);

        expect(
          await inTenantWorker(TENANT_B, (tx) =>
            credentials.resolveWhatsappCredential(tx, {
              tenantId: TENANT_B,
              accountId: aAccount.id
            })
          )
        ).toEqual({ ok: false, reason: "ACCOUNT_NOT_FOUND" });
        expect(
          await inTenantWorker(TENANT_B, (tx) =>
            senders.resolveWhatsappSender(tx, {
              tenantId: TENANT_B,
              accountId: aAccount.id,
              capability: "dm"
            })
          )
        ).toEqual({ usable: false, reason: "ACCOUNT_NOT_FOUND" });
        // Even asking with the wrong tenant id inside the right context finds nothing.
        expect(
          await inTenantWorker(TENANT_A, (tx) =>
            credentials.resolveWhatsappCredential(tx, {
              tenantId: TENANT_B,
              accountId: aAccount.id
            })
          )
        ).toEqual({ ok: false, reason: "ACCOUNT_NOT_FOUND" });
        // The right tenant gets the right credential.
        expect(
          await inTenantWorker(TENANT_A, (tx) =>
            credentials.resolveWhatsappCredential(tx, {
              tenantId: TENANT_A,
              accountId: aAccount.id
            })
          )
        ).toEqual({ ok: true, credential: aAccount.token! });
      }
    );
  });

  describe("dispatch: a sender that cannot send never sends through another", () => {
    workerTest(
      "revoked after enqueue: terminal `sender_unavailable`, the provider is never called, the deployment lane is unaffected",
      async () => {
        const doomed = await seedAccount(TENANT_A);
        const healthy = await seedAccount(TENANT_A);
        const doomedMessage = await enqueue(TENANT_A, {
          senderAccountId: doomed.id
        });
        const healthyMessage = await enqueue(TENANT_A, {
          senderAccountId: healthy.id
        });
        const deploymentMessage = await enqueue(TENANT_A, {});

        await setStatus(doomed.id, "revoked");

        const harness = makeHarness();
        const result = await dispatch(TENANT_A, harness);

        expect(result).toMatchObject({
          claimed: 3,
          sent: 2,
          failed: 1,
          held: 0
        });

        const failed = await row(queuedId(doomedMessage));

        expect(failed.status).toBe("failed");
        expect(failed.failure_code).toBe("sender_unavailable");
        expect(failed.sender_account_id).toBe(doomed.id);
        expect((await row(queuedId(healthyMessage))).status).toBe("sent");
        expect((await row(queuedId(deploymentMessage))).status).toBe("sent");
        // Nothing was sent as the doomed sender, from another sender, or by the deployment provider on its behalf.
        expect(harness.sent.map((s) => s.senderAccountId).sort()).toEqual(
          [healthy.id, null].sort()
        );
        expect(harness.built.map((b) => b.sender.accountId)).toEqual([
          healthy.id
        ]);
        // The failure event names the sender and carries no reason text about it.
        const events = (await getAdminSql()`
        SELECT payload FROM awcms_domain_events
        WHERE event_type = 'awcms.whatsapp.message.failed'
      `) as { payload: Record<string, unknown> }[];

        expect(events).toHaveLength(1);
        expect(events[0]!.payload).toMatchObject({
          senderAccountId: doomed.id,
          failureCode: "sender_unavailable"
        });
      }
    );

    workerTest(
      "disabled, connection revoked, capability withdrawn and a provider with no adapter all fail terminally",
      async () => {
        const disabled = await seedAccount(TENANT_A);
        const withdrawn = await seedAccount(TENANT_A);
        const queuedIds = [
          queuedId(await enqueue(TENANT_A, { senderAccountId: disabled.id })),
          queuedId(await enqueue(TENANT_A, { senderAccountId: withdrawn.id }))
        ];

        await setStatus(disabled.id, "disabled");
        await getAdminSql()`
        UPDATE awcms_channel_account_capabilities SET state = 'denied'
        WHERE account_id = ${withdrawn.id}
      `;

        const harness = makeHarness();

        expect(await dispatch(TENANT_A, harness)).toMatchObject({
          claimed: 2,
          failed: 2,
          sent: 0
        });
        expect(harness.sent).toHaveLength(0);
        for (const id of queuedIds) {
          expect((await row(id)).failure_code).toBe("sender_unavailable");
        }
      }
    );

    workerTest(
      "a sender that is only degraded is HELD: rows wait untouched, nothing is claimed, the retry budget is not spent",
      async () => {
        const account = await seedAccount(TENANT_A);
        const queued = await enqueue(TENANT_A, { senderAccountId: account.id });

        await setStatus(account.id, "degraded");

        const harness = makeHarness();
        const result = await dispatch(TENANT_A, harness);

        expect(result).toMatchObject({ claimed: 0, sent: 0, failed: 0 });
        expect(result.senders[0]).toMatchObject({
          senderAccountId: account.id,
          skipped: "ACCOUNT_DEGRADED"
        });
        expect(harness.sent).toHaveLength(0);

        const waiting = await row(queuedId(queued));

        expect(waiting.status).toBe("queued");
        expect(waiting.retry_count).toBe(0);

        // It recovers, and the same row is sent through the SAME sender.
        await setStatus(account.id, "connected");
        expect(await dispatch(TENANT_A, harness)).toMatchObject({ sent: 1 });
        expect(harness.sent[0]!.senderAccountId).toBe(account.id);
      }
    );

    workerTest(
      "without the credential port every tenant-owned lane is held (fail closed) and the deployment sender still sends",
      async () => {
        const account = await seedAccount(TENANT_A);

        await enqueue(TENANT_A, { senderAccountId: account.id });
        await enqueue(TENANT_A, {});

        const harness = makeHarness();
        const result = await dispatch(TENANT_A, harness, {
          credentials: undefined
        });

        // The lane is available (resolved), so its row is claimed, then parked.
        expect(result).toMatchObject({ sent: 1, held: 1, failed: 0 });
        expect(harness.sent.map((s) => s.senderAccountId)).toEqual([null]);
      }
    );

    workerTest(
      "a missing key ring holds the lane: no row is failed for an operator problem",
      async () => {
        const account = await seedAccount(TENANT_A);
        const queued = await enqueue(TENANT_A, { senderAccountId: account.id });
        const noRing = createChannelSenderCredentialAdapter({
          store: createKeyRingSecretStore(
            () => ({ ok: false, reason: "missing" }) as never
          ),
          env: CA_ENV
        });
        const harness = makeHarness();
        const result = await dispatch(TENANT_A, harness, {
          credentials: noRing
        });

        expect(result).toMatchObject({ held: 1, failed: 0, sent: 0 });
        expect((await row(queuedId(queued))).status).toBe("retry_wait");
        expect(harness.sent).toHaveLength(0);
      }
    );

    workerTest(
      "the provider rejecting a sender's credential fails the lane closed after ONE call, and no other sender is tried",
      async () => {
        const rejected = await seedAccount(TENANT_A);
        const other = await seedAccount(TENANT_A);

        for (let i = 0; i < 4; i += 1) {
          await enqueue(TENANT_A, { senderAccountId: rejected.id });
        }
        const otherMessage = await enqueue(TENANT_A, {
          senderAccountId: other.id
        });
        const harness = makeHarness((sent) =>
          sent.senderAccountId === rejected.id
            ? {
                ok: false,
                error: "Meta rejected the configured credentials.",
                retryable: false,
                failureCode: "unauthorized"
              }
            : { ok: true, providerMessageId: "wamid.ok" }
        );
        const result = await dispatch(TENANT_A, harness);

        expect(result).toMatchObject({ claimed: 5, sent: 1, failed: 4 });
        expect(
          harness.sent.filter((s) => s.senderAccountId === rejected.id)
        ).toHaveLength(1);
        expect((await row(queuedId(otherMessage))).status).toBe("sent");
        expect(
          await count(
            "awcms_whatsapp_messages",
            `failure_code = 'unauthorized'`
          )
        ).toBe(1);
        expect(
          await count(
            "awcms_whatsapp_messages",
            `failure_code = 'sender_unavailable'`
          )
        ).toBe(3);
      }
    );
  });

  describe("per-sender breaker, quota and fair claiming", () => {
    workerTest(
      "an open breaker on one sender holds only that sender's rows",
      async () => {
        const broken = await seedAccount(TENANT_A);
        const fine = await seedAccount(TENANT_A);
        const brokenMessage = await enqueue(TENANT_A, {
          senderAccountId: broken.id
        });
        const fineMessage = await enqueue(TENANT_A, {
          senderAccountId: fine.id
        });
        const deploymentMessage = await enqueue(TENANT_A, {});
        const breaker = getProviderCircuitBreaker(
          whatsappSenderBreakerKey(broken.id)
        );

        for (let i = 0; i < 10; i += 1) breaker.recordFailure(new Date());

        const harness = makeHarness();
        const result = await dispatch(TENANT_A, harness);

        expect(result).toMatchObject({
          claimed: 2,
          sent: 2,
          breakerOpen: false
        });
        expect(
          result.senders.find((s) => s.senderAccountId === broken.id)
        ).toMatchObject({
          claimed: 0,
          skipped: "breaker_open"
        });
        expect((await row(queuedId(brokenMessage))).status).toBe("queued");
        expect((await row(queuedId(fineMessage))).status).toBe("sent");
        expect((await row(queuedId(deploymentMessage))).status).toBe("sent");
      }
    );

    workerTest(
      "the deployment sender's breaker no longer stops a tenant-owned sender",
      async () => {
        const account = await seedAccount(TENANT_A);

        await enqueue(TENANT_A, { senderAccountId: account.id });
        await enqueue(TENANT_A, {});

        const deployment = getProviderCircuitBreaker("whatsapp-delivery");

        for (let i = 0; i < 10; i += 1) deployment.recordFailure(new Date());

        const harness = makeHarness();
        const result = await dispatch(TENANT_A, harness);

        expect(result).toMatchObject({
          breakerOpen: true,
          claimed: 1,
          sent: 1
        });
        expect(harness.sent.map((s) => s.senderAccountId)).toEqual([
          account.id
        ]);
        expect(
          result.senders.find((s) => s.senderAccountId === null)
        ).toMatchObject({
          skipped: "breaker_open"
        });
      }
    );

    workerTest(
      "the per-sender hourly cap stops claiming at the cap; the rest wait and are never rerouted",
      async () => {
        const capped = await seedAccount(TENANT_A);
        const spare = await seedAccount(TENANT_A);
        const ids: string[] = [];

        for (let i = 0; i < 5; i += 1) {
          ids.push(
            queuedId(await enqueue(TENANT_A, { senderAccountId: capped.id }))
          );
        }
        const harness = makeHarness();
        const env = {
          ...ENV,
          WHATSAPP_SENDER_RATE_PER_HOUR: "2"
        } as NodeJS.ProcessEnv;

        expect(await dispatch(TENANT_A, harness, { env })).toMatchObject({
          claimed: 2,
          sent: 2
        });

        const second = await dispatch(TENANT_A, harness, { env });

        expect(second).toMatchObject({ claimed: 0, sent: 0 });
        expect(second.senders[0]).toMatchObject({
          senderAccountId: capped.id,
          skipped: "quota_reached"
        });
        expect(
          await count("awcms_whatsapp_messages", "status = 'queued'")
        ).toBe(3);
        // The spare sender never carried a capped sender's messages.
        expect(harness.sent.every((s) => s.senderAccountId === capped.id)).toBe(
          true
        );
        expect(spare.id).not.toBe(capped.id);

        const diagnostics = await inTenant(TENANT_A, (tx) =>
          summarizeWhatsappSenders(tx, TENANT_A, senders, env)
        );

        expect(
          diagnostics.find((d) => d.senderAccountId === capped.id)
        ).toMatchObject({
          availability: { usable: true },
          queue: { waiting: 3 },
          quota: { sentLastHour: 2, hourlyLimit: 2, throttled: true }
        });
        expect(ids).toHaveLength(5);
      }
    );

    workerTest(
      "fair claiming: a sender with a deep backlog cannot starve another",
      async () => {
        const busy = await seedAccount(TENANT_A);
        const quiet = await seedAccount(TENANT_A);

        for (let i = 0; i < 10; i += 1) {
          await enqueue(TENANT_A, { senderAccountId: busy.id });
        }
        await enqueue(TENANT_A, { senderAccountId: quiet.id });

        const harness = makeHarness();
        const result = await dispatch(TENANT_A, harness, { limit: 4 });

        // Two lanes share the pass: the quiet sender's one message goes out in the FIRST pass.
        expect(
          result.senders.find((s) => s.senderAccountId === quiet.id)
        ).toMatchObject({ claimed: 1, sent: 1 });
        expect(
          result.senders.find((s) => s.senderAccountId === busy.id)
        ).toMatchObject({ claimed: 2, sent: 2 });
        expect(result.claimed).toBe(3);
      }
    );

    workerTest("concurrent passes claim every row exactly once", async () => {
      const account = await seedAccount(TENANT_A);
      const total = 24;

      for (let i = 0; i < total; i += 1) {
        await enqueue(TENANT_A, {
          senderAccountId: account.id,
          correlationId: `c-${i}`
        });
      }
      const harness = makeHarness();
      const results = await Promise.all([
        dispatch(TENANT_A, harness),
        dispatch(TENANT_A, harness),
        dispatch(TENANT_A, harness)
      ]);

      // Whatever the split, nothing was sent twice and nothing was lost.
      const counts = new Map<string, number>();

      for (const s of harness.sent) {
        counts.set(
          s.request.correlationId!,
          (counts.get(s.request.correlationId!) ?? 0) + 1
        );
      }

      expect(harness.sent).toHaveLength(total);
      expect([...counts.values()].every((n) => n === 1)).toBe(true);
      expect(results.reduce((n, r) => n + r.sent, 0)).toBe(total);
      expect(await count("awcms_whatsapp_messages", "status = 'sent'")).toBe(
        total
      );
    });

    workerTest(
      "restart and replay: a row stranded in `sending` is re-claimed once, through the same sender",
      async () => {
        const account = await seedAccount(TENANT_A);
        const queued = await enqueue(TENANT_A, { senderAccountId: account.id });

        // A worker died after claiming: the lease has passed.
        await getAdminSql()`
        UPDATE awcms_whatsapp_messages
        SET status = 'sending', next_attempt_at = now() - interval '1 minute'
        WHERE id = ${queuedId(queued)}
      `;

        const harness = makeHarness();
        const result = await dispatch(TENANT_A, harness);

        expect(result).toMatchObject({ claimed: 1, sent: 1 });
        expect(harness.sent).toHaveLength(1);
        expect(harness.sent[0]!.senderAccountId).toBe(account.id);

        const replayed = await row(queuedId(queued));

        expect(replayed.status).toBe("sent");
        // The re-claim of an expired lease counts as an attempt, so a poison pill ends.
        expect(replayed.retry_count).toBe(1);
        expect(replayed.sender_account_id).toBe(account.id);
        // A second pass has nothing left, and sends nothing again.
        expect(await dispatch(TENANT_A, harness)).toMatchObject({ claimed: 0 });
        expect(harness.sent).toHaveLength(1);
      }
    );

    workerTest(
      "a retryable provider failure keeps the row on its sender and backs off",
      async () => {
        const account = await seedAccount(TENANT_A);
        const queued = await enqueue(TENANT_A, { senderAccountId: account.id });
        const harness = makeHarness(() => ({
          ok: false,
          error: "provider timeout",
          retryable: true,
          failureCode: "provider_error"
        }));

        expect(await dispatch(TENANT_A, harness)).toMatchObject({
          retried: 1,
          failed: 0
        });

        const waiting = await row(queuedId(queued));

        expect(waiting.status).toBe("retry_wait");
        expect(waiting.retry_count).toBe(1);
        expect(waiting.sender_account_id).toBe(account.id);
      }
    );
  });

  describe("consent and suppression follow the recipient, never the sender", () => {
    test("one opt-in covers every sender of the tenant; an opt-out and a suppression stop all of them", async () => {
      const first = await seedAccount(TENANT_A);
      const second = await seedAccount(TENANT_A);
      const promo = (senderAccountId: string, phone = PHONE) =>
        enqueue(TENANT_A, {
          templateKey: "it1141.promo",
          senderAccountId,
          recipient: { kind: "address", phone }
        });

      // No consent: refused whichever sender is named.
      expect(await promo(first.id)).toEqual({
        status: "refused",
        reason: "CONSENT_REQUIRED"
      });
      expect(await promo(second.id)).toEqual({
        status: "refused",
        reason: "CONSENT_REQUIRED"
      });

      const granted = await inTenant(TENANT_A, (tx) =>
        grantMarketingConsent(tx, TENANT_A, null, {
          phone: PHONE,
          source: "form"
        })
      );

      expect(granted.outcome).toBe("granted");
      // Changing the sender does not change who consented.
      expect((await promo(first.id)).status).toBe("queued");
      expect((await promo(second.id)).status).toBe("queued");
      // ... and consent is per recipient: another number is still refused.
      expect(await promo(first.id, OTHER_PHONE)).toEqual({
        status: "refused",
        reason: "CONSENT_REQUIRED"
      });

      // A suppressed address is suppressed for transactional mail from any sender.
      await inTenant(TENANT_A, (tx) =>
        createSuppression(tx, TENANT_A, null, {
          phone: OTHER_PHONE,
          reason: "manual"
        })
      );
      for (const sender of [first.id, second.id]) {
        expect(
          await enqueue(TENANT_A, {
            senderAccountId: sender,
            recipient: { kind: "address", phone: OTHER_PHONE }
          })
        ).toEqual({ status: "suppressed", reason: "opt_out" });
      }
    });

    test("a refused sender does not leak through a suppression: an unavailable sender is still SENDER_UNAVAILABLE", async () => {
      const revoked = await seedAccount(TENANT_A, { status: "revoked" });

      await inTenant(TENANT_A, (tx) =>
        createSuppression(tx, TENANT_A, null, {
          phone: PHONE,
          reason: "manual"
        })
      );
      expect(await enqueue(TENANT_A, { senderAccountId: revoked.id })).toEqual({
        status: "refused",
        reason: "SENDER_UNAVAILABLE"
      });
    });

    workerTest(
      "an opt-out recorded after enqueue still stops the message at dispatch, on a tenant-owned sender",
      async () => {
        const account = await seedAccount(TENANT_A);
        const granted = await inTenant(TENANT_A, (tx) =>
          grantMarketingConsent(tx, TENANT_A, null, {
            phone: PHONE,
            source: "form"
          })
        );
        const queued = await enqueue(TENANT_A, {
          templateKey: "it1141.promo",
          senderAccountId: account.id
        });

        // The withdrawal bypasses the cancel-on-withdraw path.
        await getAdminSql()`
        UPDATE awcms_whatsapp_consents SET status = 'withdrawn', withdrawn_at = now()
        WHERE tenant_id = ${TENANT_A}
      `;

        const harness = makeHarness();

        expect(await dispatch(TENANT_A, harness)).toMatchObject({
          cancelled: 1,
          sent: 0
        });
        expect(harness.sent).toHaveLength(0);
        expect((await row(queuedId(queued))).failure_code).toBe(
          "consent_withdrawn"
        );
        expect(granted.outcome).toBe("granted");
      }
    );

    test("withdrawing consent cancels the waiting messages of every sender at once", async () => {
      const first = await seedAccount(TENANT_A);
      const second = await seedAccount(TENANT_A);
      const granted = await inTenant(TENANT_A, (tx) =>
        grantMarketingConsent(tx, TENANT_A, null, {
          phone: PHONE,
          source: "form"
        })
      );
      const a = await enqueue(TENANT_A, {
        templateKey: "it1141.promo",
        senderAccountId: first.id
      });
      const b = await enqueue(TENANT_A, {
        templateKey: "it1141.promo",
        senderAccountId: second.id
      });
      const withdrawn = await inTenant(TENANT_A, (tx) =>
        withdrawMarketingConsent(
          tx,
          TENANT_A,
          null,
          granted.outcome === "granted" ? granted.entry.id : ""
        )
      );

      expect(withdrawn).toMatchObject({
        outcome: "withdrawn",
        cancelledMessages: 2
      });
      expect((await row(queuedId(a))).status).toBe("cancelled");
      expect((await row(queuedId(b))).status).toBe("cancelled");
    });

    test("marketing needs the `broadcast` capability: a sender approved only for direct messages is refused", async () => {
      const dmOnly = await seedAccount(TENANT_A, { capabilities: ["dm"] });

      await inTenant(TENANT_A, (tx) =>
        grantMarketingConsent(tx, TENANT_A, null, {
          phone: PHONE,
          source: "form"
        })
      );
      expect(
        await enqueue(TENANT_A, {
          templateKey: "it1141.promo",
          senderAccountId: dmOnly.id
        })
      ).toEqual({ status: "refused", reason: "SENDER_UNAVAILABLE" });
      expect(
        (await enqueue(TENANT_A, { senderAccountId: dmOnly.id })).status
      ).toBe("queued");
    });
  });

  describe("the worker's grants", () => {
    workerTest(
      "it reads the columns sender resolution needs and nothing else on the channel tables",
      async () => {
        const account = await seedAccount(TENANT_A);

        // Allowed, and tenant-scoped by RLS.
        const readable = await inTenantWorker(
          TENANT_A,
          (tx) => tx`SELECT id, status, secret_id FROM awcms_channel_accounts`
        );

        expect(readable).toHaveLength(1);
        expect(
          await inTenantWorker(
            TENANT_B,
            (tx) => tx`SELECT id FROM awcms_channel_accounts`
          )
        ).toHaveLength(0);

        // Everything else is denied: a display name, an actor stamp, whole-table reads.
        for (const probe of [
          (tx: Bun.SQL) => tx`SELECT display_name FROM awcms_channel_accounts`,
          (tx: Bun.SQL) => tx`SELECT created_by FROM awcms_channel_accounts`,
          (tx: Bun.SQL) => tx`SELECT * FROM awcms_channel_accounts`,
          (tx: Bun.SQL) =>
            tx`SELECT refresh_secret_id FROM awcms_channel_provider_connections`,
          (tx: Bun.SQL) =>
            tx`SELECT pending_code_secret_id FROM awcms_channel_provider_connections`,
          (tx: Bun.SQL) => tx`SELECT created_by FROM awcms_channel_secrets`,
          (tx: Bun.SQL) => tx`SELECT * FROM awcms_channel_secrets`,
          (tx: Bun.SQL) =>
            tx`SELECT callback_token_hash FROM awcms_channel_webhook_subscriptions`,
          (tx: Bun.SQL) =>
            tx`SELECT state_hash FROM awcms_channel_oauth_states`,
          (tx: Bun.SQL) => tx`SELECT id FROM awcms_channel_account_assignments`,
          (tx: Bun.SQL) =>
            tx`SELECT account_id FROM awcms_channel_account_health`
        ]) {
          await assertRejected(
            inTenantWorker(TENANT_A, (tx) => probe(tx)),
            "a worker read outside its column grant"
          );
        }

        // It can never WRITE any of them.
        for (const write of [
          (tx: Bun.SQL) =>
            tx`UPDATE awcms_channel_accounts SET status = 'connected' WHERE id = ${account.id}`,
          (tx: Bun.SQL) =>
            tx`UPDATE awcms_channel_secrets SET ciphertext = 'x'`,
          (tx: Bun.SQL) => tx`DELETE FROM awcms_channel_secrets`,
          (tx: Bun.SQL) =>
            tx`INSERT INTO awcms_channel_account_capabilities (tenant_id, account_id, capability, state, matrix_version) VALUES (${TENANT_A}, ${account.id}, 'ads', 'granted', 1)`
        ]) {
          await assertRejected(
            inTenantWorker(TENANT_A, (tx) => write(tx)),
            "a worker write to the channel control plane"
          );
        }
      }
    );
  });

  describe("one queue", () => {
    test("there is exactly one WhatsApp message table, the sender is a column on it, and the module wrote nothing to a second", async () => {
      const account = await seedAccount(TENANT_A);

      await enqueue(TENANT_A, { senderAccountId: account.id });
      await enqueue(TENANT_A, {});

      const tables = (await getAdminSql()`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name LIKE 'awcms\\_whatsapp\\_%'
        ORDER BY table_name
      `) as { table_name: string }[];

      expect(tables.map((t) => t.table_name)).toEqual([
        "awcms_whatsapp_consents",
        "awcms_whatsapp_delivery_attempts",
        "awcms_whatsapp_messages",
        "awcms_whatsapp_sender_policies",
        "awcms_whatsapp_suppressions"
      ]);
      expect(await count("awcms_whatsapp_messages")).toBe(2);
      expect(
        await count("awcms_whatsapp_messages", "sender_account_id IS NOT NULL")
      ).toBe(1);
    });
  });

  describe("diagnostics", () => {
    test("one entry per sender with its own queue and availability; nothing sensitive is projected", async () => {
      const usable = await seedAccount(TENANT_A);
      const gone = await seedAccount(TENANT_A);

      await enqueue(TENANT_A, { senderAccountId: usable.id });
      await enqueue(TENANT_A, { senderAccountId: gone.id });
      await enqueue(TENANT_A, {});
      await setStatus(gone.id, "revoked");

      const diagnostics = await inTenant(TENANT_A, (tx) =>
        summarizeWhatsappSenders(tx, TENANT_A, senders, ENV)
      );
      const by = (id: string | null) =>
        diagnostics.find((d) => d.senderAccountId === id)!;

      expect(by(null)).toMatchObject({
        availability: null,
        queue: { waiting: 1 }
      });
      expect(by(usable.id)).toMatchObject({
        availability: { usable: true },
        queue: { waiting: 1 }
      });
      expect(by(gone.id)).toMatchObject({
        availability: { usable: false, reason: "ACCOUNT_REVOKED" }
      });

      const text = JSON.stringify(diagnostics);

      for (const account of [usable, gone]) {
        expect(text).not.toContain(account.externalId);
        expect(text).not.toContain(account.token!);
      }
      // Another tenant sees nothing of it.
      expect(
        await inTenant(TENANT_B, (tx) =>
          summarizeWhatsappSenders(tx, TENANT_B, senders, ENV)
        )
      ).toEqual([]);
    });
  });
});

/** The worker role inside one tenant's RLS context (the dispatcher's own way in). */
function inTenantWorker<T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return withTenantOrThrow(getWorkerRoleSql(), tenantId, fn, {
    workClass: "background_sync"
  });
}

let actorUser: string | null = null;

/** A tenant user for the `changed_by` stamp of a policy. */
async function actor(): Promise<string> {
  const admin = getAdminSql();
  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT_A}, 'person', 'op') RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${TENANT_A}, ${profile[0]!.id}, ${`op-${crypto.randomUUID()}@example.test`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const user = (await admin`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${TENANT_A}, ${identity[0]!.id}) RETURNING id
  `) as { id: string }[];

  actorUser = user[0]!.id;

  return actorUser;
}
