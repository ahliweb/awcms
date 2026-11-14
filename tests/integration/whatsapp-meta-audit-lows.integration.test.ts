/**
 * The Low findings of the independent audit of #1267, against PostgreSQL
 * (Issue #1298). The route-level one (L6) is in
 * `whatsapp-meta-audit-fixes.integration.test.ts`; the pure ones (L2's
 * `entry.time` horizon) in `tests/whatsapp-meta-senders.test.ts`.
 *
 *   L1  an operator clear moves the restriction event clock, so a stale restrict
 *       event arriving later (another body, another subscription) cannot undo it
 *   L2  a captured signed body does not apply again after a token rotation, and
 *       a stale or time-less WABA-level entry changes nothing
 *   L3  the dispatcher role's UPDATE is column-only and value-bounded, tried AS
 *       the real `awcms_worker` login
 *   L4  the webhook ledgers use the database clock, and the runtime role can
 *       neither move a receipt's stamp, nor delete a receipt or a window
 *
 * Every id, token and secret is a fixture.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";
import { createHmac } from "node:crypto";

import {
  assertRejected,
  getAdminSql,
  getRuntimeSql,
  getWorkerRoleSql,
  integrationEnabled,
  reassertRuntimeRoleLogins,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
  workerRoleActivated
} from "./harness";
import {
  WHATSAPP_META_AUDIT_TRIGGERS,
  WORKER_COLUMN_GRANTS,
  WORKER_PURGE_POLICIES,
  evaluateWorkerPurgePolicies,
  pinTriggerFunction,
  probeWorkerPurgeDeleteFloors
} from "../../scripts/security-readiness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { parseChannelCallbackToken } from "../../src/modules/_shared/channel-webhook-token";
import { createChannelAccountPortAdapter } from "../../src/modules/channel-accounts/application/channel-account-port-adapter";
import { createKeyRingSecretStore } from "../../src/modules/channel-accounts/application/secret-store";
import {
  createChannelWebhookVerifierAdapter,
  createMetaWebhookSubscription
} from "../../src/modules/channel-accounts/application/webhook-subscription-directory";
import { resolveChannelSecretsRing } from "../../src/modules/channel-accounts/domain/channel-accounts-config";
import { PROVIDER_MATRIX_VERSION } from "../../src/modules/channel-accounts/domain/provider-matrix";
import { enqueueWhatsappMessage } from "../../src/modules/whatsapp-delivery/application/whatsapp-enqueue";
import {
  clearMetaRestriction,
  readMetaRestriction,
  recordWebhookReceipt
} from "../../src/modules/whatsapp-delivery/application/whatsapp-meta-directory";
import { handleMetaWebhook } from "../../src/modules/whatsapp-delivery/application/whatsapp-meta-webhook";
import { runMetaEnablementPreflight } from "../../src/modules/whatsapp-delivery/application/whatsapp-meta-preflight";
import { parseRecipientHashKeys } from "../../src/modules/whatsapp-delivery/domain/whatsapp-recipient";
import { registerWhatsappTemplate } from "../../src/modules/whatsapp-delivery/domain/whatsapp-templates";

const TENANT = "a1298000-0000-4000-8000-00000000000a";
const PHONE = "+6281234567890";
const WABA = "2980000000001";
const NUMBER = "2980000000002";
const APP_SECRET = "appsecret1298appsecret1298abcdef";

const bytes = (mul: number) =>
  Buffer.from(
    Array.from({ length: 32 }, (_, i) => (i * mul + 5) % 251)
  ).toString("base64");
const secretRing = resolveChannelSecretsRing({
  CHANNEL_SECRETS_ENCRYPTION_KEYS: `k1:${bytes(17)}`
} as unknown as NodeJS.ProcessEnv);

if (!secretRing.ok) throw new Error(secretRing.reason);

const store = createKeyRingSecretStore(() => secretRing);
const ENV = {
  WHATSAPP_ENABLED: "true",
  WHATSAPP_PROVIDER: "log",
  WHATSAPP_RECIPIENT_HASH_KEYS: `k1:${bytes(13)}`,
  WHATSAPP_RATE_PER_RECIPIENT_PER_HOUR: "1000",
  WHATSAPP_RATE_PER_TENANT_PER_HOUR: "100000"
} as unknown as NodeJS.ProcessEnv;
const CA_ENV = {
  CHANNEL_ACCOUNTS_ENABLED: "true"
} as unknown as NodeJS.ProcessEnv;
const ring = parseRecipientHashKeys(ENV);

if (!ring.ok) throw new Error("recipient ring");

const senders = createChannelAccountPortAdapter({ env: CA_ENV });
const verifier = createChannelWebhookVerifierAdapter({ store, env: CA_ENV });

registerWhatsappTemplate({
  key: "it1298.reminder",
  version: 1,
  purpose: "transactional",
  body: "Reminder for {{name}}",
  variables: ["name"],
  providerTemplate: { name: "it1298_reminder", language: "id" }
});

const runtime = () => getRuntimeSql();
const inTenant = <T>(fn: (tx: Bun.TransactionSQL) => Promise<T>) =>
  withTenantOrThrow(runtime(), TENANT, fn);
const asWorker = <T>(fn: (tx: Bun.TransactionSQL) => Promise<T>) =>
  withTenantOrThrow(getWorkerRoleSql(), TENANT, fn);

let sequence = 0;
let actor = "";
let numberId = "";

async function seedFixtures(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT}, 'wa1298', 'wa1298')
  `;

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT}, 'person', 'it1298') RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${TENANT}, ${profile[0]!.id}, 'it1298@example.test', 'x')
    RETURNING id
  `) as { id: string }[];
  const user = (await admin`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${TENANT}, ${identity[0]!.id}) RETURNING id
  `) as { id: string }[];

  actor = user[0]!.id;

  const waba = (await admin`
    INSERT INTO awcms_channel_accounts
      (tenant_id, provider, account_kind, external_id, display_name,
       auth_mode, status)
    VALUES (${TENANT}, 'whatsapp_cloud', 'waba', ${WABA}, 'waba',
            'api_token', 'connected')
    RETURNING id
  `) as { id: string }[];
  const number = (await admin`
    INSERT INTO awcms_channel_accounts
      (tenant_id, provider, account_kind, external_id, display_name,
       auth_mode, status, parent_account_id)
    VALUES (${TENANT}, 'whatsapp_cloud', 'waba_phone_number', ${NUMBER},
            'n', 'api_token', 'connected', ${waba[0]!.id})
    RETURNING id
  `) as { id: string }[];

  numberId = number[0]!.id;

  for (const capability of ["dm", "reply", "broadcast"]) {
    await admin`
      INSERT INTO awcms_channel_account_capabilities
        (tenant_id, account_id, capability, state, evidence_kind,
         evidence_ref, matrix_version, verified_at)
      VALUES (${TENANT}, ${numberId}, ${capability}, 'granted',
              'app_review_reference', 'evidence-1', ${PROVIDER_MATRIX_VERSION},
              now())
    `;
  }

  const ref = await inTenant((tx) =>
    store.put(tx, {
      tenantId: TENANT,
      purpose: "api_token",
      plaintext: "TOKEN-1298",
      createdBy: null
    })
  );

  await admin`
    UPDATE awcms_channel_accounts SET secret_id = ${ref.secretId}
    WHERE id = ${numberId}
  `;
  await admin`
    INSERT INTO awcms_whatsapp_meta_templates
      (tenant_id, waba_external_id, template_name, language, category,
       provider_status, evidence_ref, source, last_event_at)
    VALUES (${TENANT}, ${WABA}, 'it1298_reminder', 'id', 'UTILITY',
            'APPROVED', 'fixture', 'operator', now() - interval '1 hour')
  `;
}

async function subscribe(): Promise<string> {
  const created = await inTenant((tx) =>
    createMetaWebhookSubscription(
      tx,
      store,
      TENANT,
      actor,
      numberId,
      APP_SECRET
    )
  );

  if (created.outcome !== "created") throw new Error(created.outcome);

  return created.callbackToken;
}

const sign = (body: string) =>
  `sha256=${createHmac("sha256", APP_SECRET).update(body, "utf8").digest("hex")}`;

function deliver(token: string, body: string) {
  const parsed = parseChannelCallbackToken(token);

  if (!parsed) throw new Error("token shape");

  return handleMetaWebhook(
    runtime(),
    parsed,
    { rawBody: body, signatureHeader: sign(body) },
    { verifier, ring: ring as Extract<typeof ring, { ok: true }> }
  );
}

function wabaEvent(
  value: Record<string, unknown>,
  time: number | null,
  field = "account_update"
): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: WABA,
        ...(time === null ? {} : { time }),
        changes: [{ field, value }]
      }
    ]
  });
}

const nowSeconds = () => Math.floor(Date.now() / 1000);
const restriction = () =>
  inTenant((tx) => readMetaRestriction(tx, TENANT, WABA));

async function queuedMessage(): Promise<string> {
  sequence += 1;

  const result = await inTenant((tx) =>
    enqueueWhatsappMessage(
      tx,
      {
        tenantId: TENANT,
        templateKey: "it1298.reminder",
        variables: { name: "Sari" },
        recipient: { kind: "address", phone: PHONE },
        idempotencyKey: `k1298-${sequence}`,
        senderAccountId: numberId
      },
      { env: ENV, senders }
    )
  );

  if (result.status !== "queued") throw new Error(`enqueue: ${result.status}`);

  return (result as unknown as { messageId: string }).messageId;
}

async function requireWorkerRole(): Promise<void> {
  await reassertRuntimeRoleLogins();

  if (!workerRoleActivated) {
    throw new Error(
      "awcms_worker is not provisioned or cannot log in: the worker-role assertions cannot run."
    );
  }
}

const suite = integrationEnabled ? describe : describe.skip;

suite("#1267 audit Lows against PostgreSQL (#1298)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  }, 60_000);

  afterAll(async () => {
    await teardownIntegrationDatabase();
  }, 60_000);

  beforeEach(async () => {
    await resetDatabase();
    await seedFixtures();
  }, 30_000);

  describe("L1: an operator clear moves the restriction event clock", () => {
    test("a stale restrict event arriving later, as another body, does not undo the clear; a newer one does", async () => {
      const token = await subscribe();
      const stated = nowSeconds() - 60;

      await deliver(token, wabaEvent({ event: "ACCOUNT_RESTRICTION" }, stated));
      expect(await restriction()).toBe("ACCOUNT_RESTRICTION");

      const cleared = await inTenant((tx) =>
        clearMetaRestriction(tx, TENANT, actor, WABA)
      );

      expect(cleared.outcome).toBe("cleared");
      expect(await restriction()).toBeNull();

      // The SAME event Meta stamped before the clear, in a body of another
      // shape (so the body-hash receipt does not catch it).
      const again = await deliver(
        token,
        wabaEvent({ event: "ACCOUNT_RESTRICTION", resent: true }, stated)
      );

      expect(again.kind).toBe("accepted");
      expect(await restriction()).toBeNull();

      // An event Meta stamps AFTER the clear still restricts.
      await Bun.sleep(1_100);
      await deliver(
        token,
        wabaEvent({ event: "ACCOUNT_RESTRICTION", fresh: true }, nowSeconds())
      );
      expect(await restriction()).toBe("ACCOUNT_RESTRICTION");
    });
  });

  describe("L2: replay after a token rotation, and stale entries", () => {
    test("a captured signed body does not apply again under the rotated token", async () => {
      const first = await subscribe();
      const body = wabaEvent(
        { event: "ACCOUNT_RESTRICTION" },
        nowSeconds() - 30
      );
      const applied = await deliver(first, body);

      expect(applied.kind === "accepted" && applied.result.duplicate).toBe(
        false
      );

      // Rotation: a new subscription, the same app secret.
      const second = await subscribe();

      expect(second).not.toBe(first);

      const replay = await deliver(second, body);

      expect(replay.kind === "accepted" && replay.result.duplicate).toBe(true);

      // The old token no longer verifies at all.
      expect((await deliver(first, body)).kind).toBe("refused");
    });

    test("an entry older than the horizon, or with no stated time, changes no WABA state", async () => {
      const token = await subscribe();
      const stale = await deliver(
        token,
        wabaEvent(
          { event: "ACCOUNT_RESTRICTION" },
          nowSeconds() - 8 * 24 * 60 * 60
        )
      );
      const timeless = await deliver(
        token,
        wabaEvent({ event: "ACCOUNT_RESTRICTION", other: 1 }, null)
      );

      for (const outcome of [stale, timeless]) {
        expect(outcome.kind).toBe("accepted");

        if (outcome.kind === "accepted") {
          expect(outcome.result.signalsUpdated).toBe(0);
          expect(outcome.result.ignored).toBeGreaterThan(0);
        }
      }

      expect(await restriction()).toBeNull();
    });
  });

  describe("L3: the dispatcher role writes only the columns and values it uses", () => {
    const rejected = (
      what: string,
      run: (tx: Bun.TransactionSQL) => Promise<unknown>
    ) => assertRejected(asWorker(run), what);

    test("it cannot write the provider-reported status, nor the identity of a message", async () => {
      await requireWorkerRole();

      const id = await queuedMessage();

      for (const [what, run] of [
        [
          "provider_status",
          (tx: Bun.TransactionSQL) => tx`
            UPDATE awcms_whatsapp_messages
            SET provider_status = 'read', provider_status_rank = 3
            WHERE id = ${id}`
        ],
        [
          "provider_failure_code",
          (tx: Bun.TransactionSQL) => tx`
            UPDATE awcms_whatsapp_messages
            SET provider_failure_code = 'meta_131026' WHERE id = ${id}`
        ],
        [
          "recipient",
          (tx: Bun.TransactionSQL) => tx`
            UPDATE awcms_whatsapp_messages
            SET recipient = '+6280000000000' WHERE id = ${id}`
        ],
        [
          "template_key",
          (tx: Bun.TransactionSQL) => tx`
            UPDATE awcms_whatsapp_messages
            SET template_key = 'system.notice' WHERE id = ${id}`
        ],
        [
          "contains_secret",
          (tx: Bun.TransactionSQL) => tx`
            UPDATE awcms_whatsapp_messages
            SET contains_secret = true WHERE id = ${id}`
        ]
      ] as const) {
        const error = await rejected(`a worker write of ${what}`, run);

        expect(String(error.message)).toContain("permission denied");
      }
    });

    test("it cannot take a message through a transition the queue never makes", async () => {
      await requireWorkerRole();

      const id = await queuedMessage();

      // queued -> sent without ever being claimed
      await rejected(
        "queued -> sent",
        (tx) => tx`
        UPDATE awcms_whatsapp_messages
        SET status = 'sent', sent_at = now(), provider_name = 'meta_cloud',
            provider_message_id = 'wamid.FORGED'
        WHERE id = ${id}`
      );

      // the claim is allowed
      await asWorker(
        (tx) => tx`
        UPDATE awcms_whatsapp_messages
        SET status = 'sending', next_attempt_at = now() + interval '5 minutes'
        WHERE id = ${id}`
      );

      // back to queued, a provider acceptance written while still sending, a
      // body rewritten on a message that holds no secret, a lower retry count
      await rejected(
        "sending -> queued",
        (tx) => tx`
        UPDATE awcms_whatsapp_messages SET status = 'queued' WHERE id = ${id}`
      );
      await rejected(
        "a provider id while sending",
        (tx) => tx`
        UPDATE awcms_whatsapp_messages
        SET provider_message_id = 'wamid.EARLY' WHERE id = ${id}`
      );
      await rejected(
        "a body rewrite",
        (tx) => tx`
        UPDATE awcms_whatsapp_messages SET body = '' WHERE id = ${id}`
      );
      await rejected(
        "variables rewrite",
        (tx) => tx`
        UPDATE awcms_whatsapp_messages
        SET variables = '{"name":"X"}'::jsonb WHERE id = ${id}`
      );

      await asWorker(
        (tx) => tx`
        UPDATE awcms_whatsapp_messages SET retry_count = 2 WHERE id = ${id}`
      );
      await rejected(
        "a lower retry count",
        (tx) => tx`
        UPDATE awcms_whatsapp_messages SET retry_count = 1 WHERE id = ${id}`
      );

      // finalising as the dispatcher does is allowed ...
      await asWorker(
        (tx) => tx`
        UPDATE awcms_whatsapp_messages
        SET status = 'sent', sent_at = now(), next_attempt_at = NULL,
            provider_name = 'meta_cloud', provider_message_id = 'wamid.REAL',
            updated_at = now()
        WHERE id = ${id}`
      );

      // ... and a terminal message is frozen.
      await rejected(
        "sent -> failed",
        (tx) => tx`
        UPDATE awcms_whatsapp_messages
        SET status = 'failed', failure_code = 'forged' WHERE id = ${id}`
      );
      await rejected(
        "a provider id rewrite on a sent message",
        (tx) => tx`
        UPDATE awcms_whatsapp_messages
        SET provider_message_id = 'wamid.OTHER' WHERE id = ${id}`
      );
      await rejected(
        "a rewrite of a sent message's failure code",
        (tx) => tx`
        UPDATE awcms_whatsapp_messages
        SET failure_code = 'forged', last_error = 'forged' WHERE id = ${id}`
      );
      await rejected(
        "sent -> queued",
        (tx) => tx`
        UPDATE awcms_whatsapp_messages SET status = 'queued' WHERE id = ${id}`
      );

      const final = (await getAdminSql()`
        SELECT status, provider_message_id FROM awcms_whatsapp_messages
        WHERE id = ${id}
      `) as { status: string; provider_message_id: string }[];

      expect(final[0]).toEqual({
        status: "sent",
        provider_message_id: "wamid.REAL"
      });
    });

    test("the worker may still cancel a waiting message (the booking reminder job does, through the port) and expire one, but not a terminal one", async () => {
      await requireWorkerRole();

      const waiting = await queuedMessage();
      const stale = await queuedMessage();

      await asWorker(
        (tx) => tx`
        UPDATE awcms_whatsapp_messages
        SET status = 'cancelled', next_attempt_at = NULL,
            failure_code = 'cancelled', updated_at = now()
        WHERE id = ${waiting}`
      );
      await asWorker(
        (tx) => tx`
        UPDATE awcms_whatsapp_messages
        SET status = 'expired', next_attempt_at = NULL,
            failure_code = 'expired', updated_at = now()
        WHERE id = ${stale}`
      );
      await assertRejected(
        asWorker(
          (tx) => tx`
          UPDATE awcms_whatsapp_messages SET status = 'queued'
          WHERE id = ${waiting}`
        ),
        "reviving a cancelled message"
      );
    });

    test("the app role is not bound by the worker guard (the webhook still writes the provider status)", async () => {
      const id = await queuedMessage();

      await getAdminSql()`
        UPDATE awcms_whatsapp_messages
        SET status = 'sent', provider_name = 'meta_cloud',
            provider_message_id = 'wamid.APP', sent_at = now()
        WHERE id = ${id}
      `;
      await inTenant(
        (tx) => tx`
        UPDATE awcms_whatsapp_messages
        SET provider_status = 'delivered', provider_status_rank = 2
        WHERE id = ${id}`
      );

      const rows = (await getAdminSql()`
        SELECT provider_status FROM awcms_whatsapp_messages WHERE id = ${id}
      `) as { provider_status: string }[];

      expect(rows[0]!.provider_status).toBe("delivered");
    });
  });

  describe("L4: the database clock on the webhook ledgers", () => {
    test("a receipt's stamp is the database clock and the runtime role can neither move nor delete it", async () => {
      await subscribe();

      const subscription = (await getAdminSql()`
        SELECT id FROM awcms_channel_webhook_subscriptions
        WHERE tenant_id = ${TENANT} AND status = 'active'
      `) as { id: string }[];
      const subscriptionId = subscription[0]!.id;

      // The statement asks for a stamp thirty days old; the trigger overrides.
      await inTenant(
        (tx) => tx`
        INSERT INTO awcms_whatsapp_webhook_receipts
          (tenant_id, subscription_id, payload_sha256, received_at)
        VALUES (${TENANT}, ${subscriptionId}, ${"c".repeat(64)},
                now() - interval '30 days')`
      );

      const stamped = (await getAdminSql()`
        SELECT received_at > now() - interval '1 minute' AS fresh
        FROM awcms_whatsapp_webhook_receipts
        WHERE payload_sha256 = ${"c".repeat(64)}
      `) as { fresh: boolean }[];

      expect(stamped[0]!.fresh).toBe(true);

      const moved = await assertRejected(
        inTenant(
          (tx) => tx`
          UPDATE awcms_whatsapp_webhook_receipts
          SET received_at = now() - interval '30 days'`
        ),
        "the runtime role moving a receipt stamp"
      );
      const erased = await assertRejected(
        inTenant((tx) => tx`DELETE FROM awcms_whatsapp_webhook_receipts`),
        "the runtime role deleting a receipt"
      );

      expect(String(moved.message)).toContain("permission denied");
      expect(String(erased.message)).toContain("permission denied");
    });

    test("a service window can never be later than the write, and the runtime role cannot delete one", async () => {
      await inTenant(
        (tx) => tx`
        INSERT INTO awcms_whatsapp_service_windows
          (tenant_id, sender_account_id, recipient_hash, last_inbound_at)
        VALUES (${TENANT}, ${numberId}, 'k1:future',
                now() + interval '1 day')`
      );

      const inserted = (await getAdminSql()`
        SELECT last_inbound_at <= now() AS capped
        FROM awcms_whatsapp_service_windows WHERE recipient_hash = 'k1:future'
      `) as { capped: boolean }[];

      expect(inserted[0]!.capped).toBe(true);

      await inTenant(
        (tx) => tx`
        UPDATE awcms_whatsapp_service_windows
        SET last_inbound_at = now() + interval '2 days'
        WHERE recipient_hash = 'k1:future'`
      );

      const updated = (await getAdminSql()`
        SELECT last_inbound_at <= now() AS capped
        FROM awcms_whatsapp_service_windows WHERE recipient_hash = 'k1:future'
      `) as { capped: boolean }[];

      expect(updated[0]!.capped).toBe(true);

      const erased = await assertRejected(
        inTenant((tx) => tx`DELETE FROM awcms_whatsapp_service_windows`),
        "the runtime role deleting a window"
      );

      expect(String(erased.message)).toContain("permission denied");
    });
  });
  describe("security:readiness pins the new controls", () => {
    class Rollback extends Error {}

    /** Runs `mutate` then the pin, always rolled back; returns the finding. */
    async function pinAfter(
      index: number,
      mutate: (tx: Bun.TransactionSQL) => Promise<unknown>
    ): Promise<string | null> {
      let finding: string | null = null;

      try {
        await getAdminSql().begin(async (tx) => {
          await mutate(tx);
          finding = await pinTriggerFunction(
            tx as unknown as Bun.SQL,
            WHATSAPP_META_AUDIT_TRIGGERS[index]!
          );
          throw new Rollback();
        });
      } catch (error) {
        if (!(error instanceof Rollback)) throw error;
      }

      return finding;
    }

    test("every pinned trigger matches the migrated database exactly", async () => {
      for (const pin of WHATSAPP_META_AUDIT_TRIGGERS) {
        expect(await pinTriggerFunction(getAdminSql(), pin)).toBeNull();
      }
    });

    test("a disabled or loosened trigger is a finding", async () => {
      // worker guard (index 0): disabled, then body widened to a no-op
      expect(
        await pinAfter(0, (tx) =>
          tx.unsafe(
            "ALTER TABLE awcms_whatsapp_messages DISABLE TRIGGER awcms_whatsapp_messages_worker_guard"
          )
        )
      ).toContain("awcms_whatsapp_messages_worker_guard");
      expect(
        await pinAfter(0, (tx) =>
          tx.unsafe(
            "CREATE OR REPLACE FUNCTION awcms_whatsapp_messages_worker_guard() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END; $f$"
          )
        )
      ).toContain("no longer runs its reviewed body");

      // receipts clock (index 1) and windows clamp (index 2): body replaced
      expect(
        await pinAfter(1, (tx) =>
          tx.unsafe(
            "CREATE OR REPLACE FUNCTION awcms_whatsapp_webhook_receipts_clock() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END; $f$"
          )
        )
      ).not.toBeNull();
      expect(
        await pinAfter(2, (tx) =>
          tx.unsafe(
            "CREATE OR REPLACE FUNCTION awcms_whatsapp_service_windows_clock() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END; $f$"
          )
        )
      ).not.toBeNull();

      // A trigger that fires on the wrong event is also a finding (exact shape).
      expect(
        await pinAfter(1, async (tx) => {
          await tx.unsafe(
            "DROP TRIGGER awcms_whatsapp_webhook_receipts_clock ON awcms_whatsapp_webhook_receipts"
          );
          await tx.unsafe(
            "CREATE TRIGGER awcms_whatsapp_webhook_receipts_clock BEFORE INSERT OR DELETE ON awcms_whatsapp_webhook_receipts FOR EACH ROW EXECUTE FUNCTION awcms_whatsapp_webhook_receipts_clock()"
          );
        })
      ).not.toBeNull();
    });

    test("the worker's column grant on the queue is the exact pinned list, and no wider", async () => {
      const columns = (await getAdminSql()`
        SELECT column_name FROM information_schema.column_privileges
        WHERE table_name = 'awcms_whatsapp_messages'
          AND grantee = 'awcms_worker' AND privilege_type = 'UPDATE'
        ORDER BY column_name
      `) as { column_name: string }[];

      expect(columns.map((row) => row.column_name)).toEqual(
        [...WORKER_COLUMN_GRANTS.awcms_whatsapp_messages!.UPDATE!].sort()
      );
    });
  });
  describe("L5: the enablement preflight, read as the real awcms_worker", () => {
    test("it names a number without a WABA parent and a template with no approval, and is quiet once fixed", async () => {
      await requireWorkerRole();

      // Queued while everything was valid (the guard refuses an unbound number
      // at INSERT), then the deployment drifts: the approval goes, then the
      // parent is detached.
      await queuedMessage();
      await queuedMessage();

      const ready = await asWorker((tx) =>
        runMetaEnablementPreflight(tx, TENANT, { senders })
      );

      expect(ready.findings).toEqual([]);
      expect(ready.pendingRows).toBe(2);

      await getAdminSql()`
        DELETE FROM awcms_whatsapp_meta_templates
        WHERE tenant_id = ${TENANT}
      `;

      const unapproved = await asWorker((tx) =>
        runMetaEnablementPreflight(tx, TENANT, { senders })
      );

      expect(unapproved.blockedRows).toBe(2);
      expect(unapproved.findings).toEqual([
        expect.objectContaining({
          kind: "pending_blocked",
          reason: "TEMPLATE_NOT_APPROVED",
          accountId: numberId,
          wabaId: WABA,
          rows: 2
        })
      ]);

      await getAdminSql()`
        UPDATE awcms_channel_accounts SET parent_account_id = NULL
        WHERE id = ${numberId}
      `;

      const unbound = await asWorker((tx) =>
        runMetaEnablementPreflight(tx, TENANT, { senders })
      );

      expect(unbound.blockedRows).toBe(2);
      expect(unbound.findings).toEqual([
        {
          kind: "number_without_waba",
          accountId: numberId,
          pendingRows: 2,
          pendingSecurityRows: 0
        }
      ]);
    });
  });
  describe("audit follow-up LOW-1: the worker's INSERT and DELETE on the queue", () => {
    const insertAsWorker = (overrides: Record<string, unknown>, key: string) =>
      asWorker(async (tx) => {
        const row = {
          status: "queued",
          provider_name: null,
          provider_message_id: null,
          sent_at: null,
          provider_status: null,
          provider_status_rank: 0,
          retry_count: 0,
          failure_code: null,
          last_error: null,
          ...overrides
        };

        return tx`
          INSERT INTO awcms_whatsapp_messages
            (tenant_id, idempotency_key, template_key, template_version,
             purpose, recipient, recipient_hash, recipient_masked, body,
             status, provider_name, provider_message_id, sent_at,
             provider_status, provider_status_rank, retry_count,
             failure_code, last_error, sender_account_id)
          VALUES (${TENANT}, ${key}, 'it1298.reminder', 1, 'transactional',
                  ${PHONE}, ${`k1:${key}`}, '+62***90', 'x',
                  ${row.status as string}, ${row.provider_name as string | null},
                  ${row.provider_message_id as string | null},
                  ${row.sent_at as Date | null},
                  ${row.provider_status as string | null},
                  ${row.provider_status_rank as number},
                  ${row.retry_count as number},
                  ${row.failure_code as string | null},
                  ${row.last_error as string | null}, ${numberId})
          RETURNING id`;
      });

    test("the worker still enqueues a fresh queued message (the booking reminder job does, through the port)", async () => {
      await requireWorkerRole();

      sequence += 1;

      const result = await asWorker((tx) =>
        enqueueWhatsappMessage(
          tx,
          {
            tenantId: TENANT,
            templateKey: "it1298.reminder",
            variables: { name: "Sari" },
            recipient: { kind: "address", phone: PHONE },
            idempotencyKey: `k1298-worker-${sequence}`,
            senderAccountId: numberId
          },
          { env: ENV, senders }
        )
      );

      expect(result.status).toBe("queued");
    });

    test("it cannot insert a forged sent or read message, nor a non-fresh one", async () => {
      await requireWorkerRole();

      for (const [what, overrides] of [
        [
          "a sent row with a provider status read",
          {
            status: "sent",
            provider_name: "meta_cloud",
            provider_message_id: "wamid.FORGED",
            sent_at: new Date(),
            provider_status: "read",
            provider_status_rank: 3
          }
        ],
        ["a sent row", { status: "sent" }],
        ["a queued row with a provider id", { provider_message_id: "w.X" }],
        ["a queued row with a provider name", { provider_name: "meta_cloud" }],
        ["a queued row with a sent_at", { sent_at: new Date() }],
        [
          "a queued row with a provider status",
          { provider_status: "read", provider_status_rank: 3 }
        ],
        ["a queued row with retries", { retry_count: 2 }],
        ["a queued row with a failure code", { failure_code: "x" }],
        ["a queued row with an error text", { last_error: "x" }]
      ] as const) {
        sequence += 1;

        const error = await assertRejected(
          insertAsWorker(overrides, `forged-${sequence}`),
          `a worker insert of ${what}`
        );

        expect(String(error.message)).toContain("fresh queued message");
      }
    });

    test("it deletes only terminal rows past the floor: a fresh sent, an old queued and a fresh failed row survive", async () => {
      await requireWorkerRole();

      const admin = getAdminSql();
      const rows: Record<string, string> = {};

      for (const [name, status, age] of [
        ["freshSent", "sent", "0 days"],
        ["freshFailed", "failed", "1 day"],
        ["oldQueued", "queued", "60 days"],
        ["oldSending", "sending", "60 days"],
        ["agedFailed", "failed", "60 days"],
        ["agedSent", "sent", "60 days"]
      ] as const) {
        const id = await queuedMessage();

        await admin.unsafe(
          `UPDATE awcms_whatsapp_messages SET status = '${status}',
             updated_at = now() - interval '${age}' WHERE id = '${id}'`
        );
        rows[name] = id;
      }

      const deleted = await asWorker(
        (tx) => tx`
        DELETE FROM awcms_whatsapp_messages
        WHERE id = ANY(string_to_array(${Object.values(rows).join(",")}, ',')::uuid[])
        RETURNING id`
      );
      const gone = new Set((deleted as { id: string }[]).map((r) => r.id));

      expect([...gone].sort()).toEqual(
        [rows.agedFailed!, rows.agedSent!].sort()
      );
    });

    test("the worker cannot age a terminal row to pass the floor (it cannot write a terminal row at all)", async () => {
      await requireWorkerRole();

      const id = await queuedMessage();

      await getAdminSql()`
        UPDATE awcms_whatsapp_messages SET status = 'sent' WHERE id = ${id}
      `;
      await assertRejected(
        asWorker(
          (tx) => tx`
          UPDATE awcms_whatsapp_messages
          SET updated_at = now() - interval '90 days' WHERE id = ${id}`
        ),
        "ageing a terminal message"
      );
    });

    test("security:readiness: the insert guard is pinned exactly, the delete floor by expression and by probe", async () => {
      expect(
        await pinTriggerFunction(
          getAdminSql(),
          WHATSAPP_META_AUDIT_TRIGGERS[3]!
        )
      ).toBeNull();
      expect(
        await pinTriggerFunction(
          getAdminSql(),
          WHATSAPP_META_AUDIT_TRIGGERS[3]!
        )
      ).toBeNull();

      const rows = (await getAdminSql()`
        SELECT p.polname AS name, NOT p.polpermissive AS restrictive,
               p.polcmd AS command,
               p.polroles = ARRAY[to_regrole('awcms_worker')::oid] AS worker_only,
               pg_get_expr(p.polqual, p.polrelid) AS expression
        FROM pg_policy p
        WHERE p.polname = ANY(${Object.keys(WORKER_PURGE_POLICIES)})
      `) as Parameters<typeof evaluateWorkerPurgePolicies>[0];

      expect(rows).toHaveLength(Object.keys(WORKER_PURGE_POLICIES).length);
      expect(evaluateWorkerPurgePolicies(rows)).toEqual([]);

      // loosened floor: the behavioural probe finds it (restored in finally;
      // the probe opens its own transaction, so the change is committed
      // briefly, and nothing else runs in this file meanwhile)
      let finding: string | undefined;

      try {
        await getAdminSql().unsafe(
          "ALTER POLICY awcms_whatsapp_messages_worker_purge_only ON awcms_whatsapp_messages USING (true)"
        );
        finding = (await probeWorkerPurgeDeleteFloors(getAdminSql())).finding;
      } finally {
        await getAdminSql().unsafe(
          "ALTER POLICY awcms_whatsapp_messages_worker_purge_only ON awcms_whatsapp_messages USING (status IN ('sent', 'failed', 'cancelled', 'expired') AND updated_at < now() - interval '7 days')"
        );
      }

      expect(finding).toContain("message:");

      expect(await probeWorkerPurgeDeleteFloors(getAdminSql())).toEqual({
        ran: true
      });

      // a disabled insert guard is a finding
      let pin: string | null = null;

      try {
        await getAdminSql().begin(async (tx) => {
          await tx.unsafe(
            "ALTER TABLE awcms_whatsapp_messages DISABLE TRIGGER awcms_whatsapp_messages_worker_insert_guard"
          );
          pin = await pinTriggerFunction(
            tx as unknown as Bun.SQL,
            WHATSAPP_META_AUDIT_TRIGGERS[3]!
          );
          throw new Error("rollback");
        });
      } catch {
        // rolled back on purpose
      }

      expect(pin).not.toBeNull();
    });
  });

  describe("audit follow-up LOW-3: the receipt dedupe is atomic across subscriptions", () => {
    test("the same signed body arriving at two subscriptions of one tenant at once is applied once", async () => {
      const admin = getAdminSql();
      const second = (await admin`
        INSERT INTO awcms_channel_webhook_subscriptions
          (tenant_id, account_id, provider, callback_token_hash,
           verification_mode, status)
        VALUES (${TENANT}, ${numberId}, 'whatsapp_cloud',
                ${`sha256:${crypto.randomUUID().replace(/-/g, "").padEnd(64, "0")}`},
                'hmac_signature', 'revoked')
        RETURNING id
      `) as { id: string }[];
      const first = (await admin`
        INSERT INTO awcms_channel_webhook_subscriptions
          (tenant_id, account_id, provider, callback_token_hash,
           verification_mode, status)
        VALUES (${TENANT}, ${numberId}, 'whatsapp_cloud',
                ${`sha256:${crypto.randomUUID().replace(/-/g, "").padEnd(64, "0")}`},
                'hmac_signature', 'revoked')
        RETURNING id
      `) as { id: string }[];
      const hash = "c".repeat(64);

      // The first holds its transaction open after recording; the second starts
      // while it is open. Without the lock the second also inserts (it cannot
      // see the uncommitted receipt); with it, the second waits and then sees it.
      const one = inTenant(async (tx) => {
        const recorded = await recordWebhookReceipt(
          tx,
          TENANT,
          first[0]!.id,
          hash
        );

        await Bun.sleep(1200);

        return recorded;
      });

      await Bun.sleep(300);

      const two = inTenant((tx) =>
        recordWebhookReceipt(tx, TENANT, second[0]!.id, hash)
      );
      const results = await Promise.all([one, two]);

      expect(results.filter(Boolean)).toHaveLength(1);

      const count = (await admin`
        SELECT count(*)::int AS n FROM awcms_whatsapp_webhook_receipts
        WHERE tenant_id = ${TENANT} AND payload_sha256 = ${hash}
      `) as { n: number }[];

      expect(count[0]!.n).toBe(1);
    });
  });

  describe("audit follow-up LOW-2: the preflight applies the dispatcher's own binding rule", () => {
    async function verdictFor(sql: string) {
      await getAdminSql().unsafe(sql);

      const report = await asWorker((tx) =>
        runMetaEnablementPreflight(tx, TENANT, { senders })
      );

      return report;
    }

    test("a revoked or disabled WABA parent is a terminal finding; a degraded one is a hold; a scope the parent does not contain is terminal", async () => {
      await requireWorkerRole();

      await queuedMessage();
      await queuedMessage();

      const parent = `(SELECT parent_account_id FROM awcms_channel_accounts WHERE id = '${numberId}')`;

      try {
        for (const status of ["revoked", "disabled"]) {
          const report = await verdictFor(
            `UPDATE awcms_channel_accounts SET status = '${status}' WHERE id = ${parent}`
          );

          expect(report.findings).toEqual([
            {
              kind: "number_unusable",
              accountId: numberId,
              verdict: "terminal",
              reason:
                status === "revoked" ? "ACCOUNT_REVOKED" : "ACCOUNT_DISABLED",
              pendingRows: 2,
              pendingSecurityRows: 0
            }
          ]);
          expect(report.blockedRows).toBe(2);
        }

        const held = await verdictFor(
          `UPDATE awcms_channel_accounts SET status = 'degraded' WHERE id = ${parent}`
        );

        expect(held.findings).toEqual([
          expect.objectContaining({
            kind: "number_unusable",
            verdict: "hold",
            reason: "ACCOUNT_DEGRADED",
            pendingRows: 2
          })
        ]);
        expect(held.blockedRows).toBe(0);

        const scoped = await verdictFor(
          `UPDATE awcms_channel_accounts SET status = 'connected',
             business_scope_type = 'brand',
             business_scope_id = 'b1298000-0000-4000-8000-0000000000bb'
           WHERE id = ${parent}`
        );

        expect(scoped.findings).toEqual([
          expect.objectContaining({
            kind: "number_unusable",
            verdict: "terminal",
            reason: "CONTAINER_BINDING_INVALID"
          })
        ]);
        expect(scoped.blockedRows).toBe(2);
      } finally {
        await getAdminSql().unsafe(
          `UPDATE awcms_channel_accounts SET status = 'connected',
             business_scope_type = NULL, business_scope_id = NULL
           WHERE id = ${parent}`
        );
      }

      const ok = await asWorker((tx) =>
        runMetaEnablementPreflight(tx, TENANT, { senders })
      );

      expect(ok.findings).toEqual([]);
    });
  });
});
