/**
 * StarSender per-device adapter against a real PostgreSQL (Issue #1142, ADR-0148
 * section 4 and 7): the acknowledgement table, the `connected` guard, revocation,
 * attestation, the worker's column-only grants, and the whole path through the
 * REAL dispatcher with the REAL adapter over a scripted HTTP seam.
 *
 * Proves what a mock cannot:
 *
 *   * an acknowledgement is append-only apart from one revocation stamp, never
 *     deleted, tenant-isolated by RLS (FORCE), and a double submit is one row;
 *   * a StarSender account cannot be connected without an active acknowledgement,
 *     at the database, whatever the application did;
 *   * revoking the LAST acknowledgement degrades the tenant's devices in the same
 *     transaction, and the send decision denies at once;
 *   * attestation needs the caller's OWN acknowledgement, a credential and a
 *     pending or degraded device, and is recorded as operator-attested;
 *   * the dispatcher (as `awcms_worker`) reads only the five columns it needs;
 *   * accepted is not delivered; a disconnected device HOLDS its own lane and no
 *     other device, number or provider is tried; two devices and two tenants
 *     never share a key.
 *
 * Gated on `DATABASE_URL` (harness section Gating). FIXTURES ARE NOT LIVE TRAFFIC.
 */
import {
  afterAll,
  afterEach,
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
  reassertRuntimeRoleLogins,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
  workerRoleActivated
} from "./harness";
import {
  getProviderCircuitBreaker,
  resetDatabaseCircuitBreakerForTests,
  resetProviderCircuitBreakersForTests
} from "../../src/lib/database/circuit-breaker";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { createChannelAccountPortAdapter } from "../../src/modules/channel-accounts/application/channel-account-port-adapter";
import { createChannelSenderCredentialAdapter } from "../../src/modules/channel-accounts/application/channel-sender-credential-adapter";
import {
  attestDevice,
  acknowledgeRisk,
  listRiskAcknowledgements,
  revokeRiskAcknowledgement
} from "../../src/modules/channel-accounts/application/risk-acknowledgement-directory";
import {
  createKeyRingSecretStore,
  resetSecretDecryptCounts
} from "../../src/modules/channel-accounts/application/secret-store";
import { resolveChannelSecretsRing } from "../../src/modules/channel-accounts/domain/channel-accounts-config";
import { PROVIDER_MATRIX_VERSION } from "../../src/modules/channel-accounts/domain/provider-matrix";
import {
  overrideRiskAcknowledgementCatalogueForTests,
  resolveRiskAcknowledgement
} from "../../src/modules/channel-accounts/domain/risk-acknowledgements";
import { dispatchWhatsappQueue } from "../../src/modules/whatsapp-delivery/application/whatsapp-dispatch";
import { enqueueWhatsappMessage } from "../../src/modules/whatsapp-delivery/application/whatsapp-enqueue";
import { whatsappSenderBreakerKey } from "../../src/modules/whatsapp-delivery/domain/whatsapp-config";
import { registerWhatsappTemplate } from "../../src/modules/whatsapp-delivery/domain/whatsapp-templates";
import { buildWhatsappSenderProvider } from "../../src/modules/whatsapp-delivery/infrastructure/whatsapp-sender-providers";
import type { WhatsappHttpClient } from "../../src/modules/whatsapp-delivery/infrastructure/whatsapp-http-client";

const TENANT_A = "a1142000-0000-4000-8000-00000000000a";
const TENANT_B = "a1142000-0000-4000-8000-00000000000b";
const PHONE = "+6281234567890";

const bytes = (mul: number) =>
  Buffer.from(
    Array.from({ length: 32 }, (_, i) => (i * mul + 5) % 251)
  ).toString("base64");
const HASH_KEY = bytes(7);
const SECRET_KEY = bytes(13);
const ring = resolveChannelSecretsRing({
  CHANNEL_SECRETS_ENCRYPTION_KEYS: `k1:${SECRET_KEY}`
} as unknown as NodeJS.ProcessEnv);

if (!ring.ok) throw new Error(ring.reason);

const store = createKeyRingSecretStore(() => ring);
const ENV = {
  WHATSAPP_ENABLED: "true",
  WHATSAPP_PROVIDER: "log",
  WHATSAPP_STARSENDER_ENABLED: "true",
  WHATSAPP_RECIPIENT_HASH_KEYS: `k1:${HASH_KEY}`,
  WHATSAPP_RATE_PER_RECIPIENT_PER_HOUR: "1000",
  WHATSAPP_RATE_PER_TENANT_PER_HOUR: "100000"
} as unknown as NodeJS.ProcessEnv;
const CA_ENV = {
  CHANNEL_ACCOUNTS_ENABLED: "true"
} as unknown as NodeJS.ProcessEnv;

process.env.WHATSAPP_RECIPIENT_HASH_KEYS = `k1:${HASH_KEY}`;

const senders = createChannelAccountPortAdapter({ env: CA_ENV });
const credentials = createChannelSenderCredentialAdapter({
  store,
  env: CA_ENV
});

registerWhatsappTemplate({
  key: "it1142.reminder",
  version: 1,
  purpose: "transactional",
  body: "Reminder for {{name}}",
  variables: ["name"]
});

const runtime = () => getRuntimeSql();
const inTenant = <T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
) => withTenantOrThrow(runtime(), tenantId, fn);

const approve = () =>
  overrideRiskAcknowledgementCatalogueForTests({
    starsender: {
      ...resolveRiskAcknowledgement("starsender").entry,
      approval: {
        approvedBy: "business owner (test fixture)",
        approvedOn: "2026-11-10",
        reference: "fixture"
      }
    }
  });
const currentVersion = () =>
  resolveRiskAcknowledgement("starsender").entry.textVersion;

let sequence = 0;
const nextKey = () => `k1142-${(sequence += 1)}`;
let deviceCounter = 0;

async function makeUser(tenantId: string): Promise<string> {
  const admin = getAdminSql();
  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', 'op') RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`op-${crypto.randomUUID()}@example.test`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const user = (await admin`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id}) RETURNING id
  `) as { id: string }[];

  return user[0]!.id;
}

const acknowledge = (tenantId: string, userId: string) =>
  inTenant(tenantId, (tx) =>
    acknowledgeRisk(tx, tenantId, userId, {
      provider: "starsender",
      textVersion: currentVersion()
    })
  );

type DeviceSeed = {
  status?: string;
  key?: string | null;
  capabilities?: ("dm" | "reply" | "broadcast")[];
};

/** A pending StarSender device with its capability evidence and (optionally) its device key through the real secret store. */
async function seedDevice(
  tenantId: string,
  seed: DeviceSeed = {}
): Promise<{ id: string; key: string | null; externalId: string }> {
  const admin = getAdminSql();

  deviceCounter += 1;
  const externalId = `dev-${deviceCounter}-${tenantId.slice(-1)}`;
  const rows = (await admin`
    INSERT INTO awcms_channel_accounts
      (tenant_id, provider, account_kind, external_id, display_name, auth_mode, status)
    VALUES (${tenantId}, 'starsender', 'device', ${externalId}, ${externalId},
            'device_key', ${seed.status ?? "pending"})
    RETURNING id
  `) as { id: string }[];
  const id = rows[0]!.id;

  for (const capability of seed.capabilities ?? ["dm", "reply"]) {
    await admin`
      INSERT INTO awcms_channel_account_capabilities
        (tenant_id, account_id, capability, state, evidence_kind,
         evidence_ref, matrix_version, verified_at)
      VALUES (${tenantId}, ${id}, ${capability}, 'granted',
              'app_review_reference', 'evidence-1', ${PROVIDER_MATRIX_VERSION}, now())
    `;
  }

  const key =
    seed.key === undefined
      ? `CANARY-KEY-${externalId}-${"x".repeat(8)}`
      : seed.key;

  if (key !== null) {
    const ref = await inTenant(tenantId, (tx) =>
      store.put(tx, {
        tenantId,
        purpose: "device_key",
        plaintext: key,
        createdBy: null
      })
    );

    await admin`
      UPDATE awcms_channel_accounts SET secret_id = ${ref.secretId} WHERE id = ${id}
    `;
  }

  return { id, key, externalId };
}

async function statusOf(accountId: string): Promise<string> {
  return (
    (await getAdminSql()`
      SELECT status FROM awcms_channel_accounts WHERE id = ${accountId}
    `) as { status: string }[]
  )[0]!.status;
}

async function pgRejected(
  promise: Promise<unknown>,
  what: string,
  errno: string,
  message?: string
): Promise<void> {
  let error: Error & { errno?: unknown };

  try {
    error = (await assertRejected(promise, what)) as typeof error;
  } finally {
    resetDatabaseCircuitBreakerForTests();
  }

  expect(String(error.errno), `${what}: ${error.message}`).toBe(errno);

  if (message !== undefined) expect(error.message).toContain(message);
}

type Call = { url: string; headers: Record<string, string>; body: string };

function scriptedHttp(
  answer: (call: Call, n: number) => { status: number; body: string }
): { http: WhatsappHttpClient; calls: Call[] } {
  const calls: Call[] = [];

  return {
    calls,
    http: async (url, request) => {
      const call = { url, headers: request.headers, body: request.body };

      calls.push(call);

      return { ok: true, ...answer(call, calls.length) };
    }
  };
}

const ACCEPTED = {
  status: 200,
  body: '{"success":true,"data":{},"message":"Success sent message"}'
};

async function seedTenants(): Promise<void> {
  for (const [id, code] of [
    [TENANT_A, "wa1142-a"],
    [TENANT_B, "wa1142-b"]
  ] as const) {
    await getAdminSql()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${id}, ${code}, ${code})
    `;
  }
}

const enqueue = (
  tenantId: string,
  senderAccountId: string,
  env: NodeJS.ProcessEnv = ENV
) =>
  inTenant(tenantId, (tx) =>
    enqueueWhatsappMessage(
      tx,
      {
        tenantId,
        templateKey: "it1142.reminder",
        variables: { name: "Sari" },
        recipient: { kind: "address", phone: PHONE },
        idempotencyKey: nextKey(),
        senderAccountId
      },
      { env, senders }
    )
  );

const queuedId = (result: { status: string }) =>
  (result as unknown as { messageId: string }).messageId;

async function message(id: string) {
  return (
    (await getAdminSql()`
      SELECT status, failure_code, retry_count, provider_message_id, provider_name AS provider
      FROM awcms_whatsapp_messages WHERE id = ${id}
    `) as {
      status: string;
      failure_code: string | null;
      retry_count: number;
      provider_message_id: string | null;
      provider: string | null;
    }[]
  )[0]!;
}

function dispatch(tenantId: string, http: WhatsappHttpClient) {
  return dispatchWhatsappQueue(getWorkerRoleSql(), tenantId, {
    env: ENV,
    senders,
    credentials,
    now: new Date(Date.now() + 1000),
    buildSenderProvider: (input) =>
      buildWhatsappSenderProvider({ ...input, http })
  });
}

async function requireWorkerRole(): Promise<void> {
  await reassertRuntimeRoleLogins();

  if (!workerRoleActivated) {
    throw new Error(
      "awcms_worker is not provisioned or cannot log in: the worker-role assertions cannot run, and a skipped assertion is not a pass."
    );
  }
}

function workerTest(name: string, fn: () => Promise<void>): void {
  test(name, async () => {
    await requireWorkerRole();
    await fn();
  });
}

const suite = integrationEnabled ? describe : describe.skip;

suite("StarSender adapter against PostgreSQL (Issue #1142)", () => {
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
    approve();
  });

  afterEach(() => {
    overrideRiskAcknowledgementCatalogueForTests(null);
  });

  describe("acknowledgements", () => {
    test("with the shipped (unapproved) text nothing can be acknowledged", async () => {
      overrideRiskAcknowledgementCatalogueForTests(null);

      const user = await makeUser(TENANT_A);
      const result = await inTenant(TENANT_A, (tx) =>
        acknowledgeRisk(tx, TENANT_A, user, {
          provider: "starsender",
          textVersion: currentVersion()
        })
      );

      expect(result).toEqual({ outcome: "refused", code: "TEXT_NOT_APPROVED" });
      expect(
        (
          await listRiskAcknowledgements(
            getAdminSql() as never,
            TENANT_A,
            "starsender"
          )
        ).length
      ).toBe(0);
    });

    test("approved: recorded with the version and the hash of the exact text; a stale version is refused; a double submit is one row", async () => {
      const user = await makeUser(TENANT_A);
      const stale = await inTenant(TENANT_A, (tx) =>
        acknowledgeRisk(tx, TENANT_A, user, {
          provider: "starsender",
          textVersion: "an-older-version"
        })
      );

      expect(stale).toEqual({ outcome: "refused", code: "TEXT_VERSION_STALE" });

      const first = await acknowledge(TENANT_A, user);
      const second = await acknowledge(TENANT_A, user);

      expect(first).toMatchObject({ outcome: "recorded", created: true });
      expect(second).toMatchObject({ outcome: "recorded", created: false });
      expect(
        (first as { acknowledgement: { id: string } }).acknowledgement.id
      ).toBe(
        (second as { acknowledgement: { id: string } }).acknowledgement.id
      );

      const rows = (await getAdminSql()`
        SELECT provider, tenant_user_id, text_version, text_sha256
        FROM awcms_channel_provider_risk_acknowledgements
        WHERE tenant_id = ${TENANT_A}
      `) as {
        provider: string;
        tenant_user_id: string;
        text_version: string;
        text_sha256: string;
      }[];

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        provider: "starsender",
        tenant_user_id: user,
        text_version: currentVersion()
      });
      expect(rows[0]!.text_sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    test("append-only apart from the revocation stamp; never deleted; a revocation is terminal (for every role)", async () => {
      const user = await makeUser(TENANT_A);
      const ack = (await acknowledge(TENANT_A, user)) as {
        acknowledgement: { id: string };
      };
      const id = ack.acknowledgement.id;
      const admin = getAdminSql();

      await pgRejected(
        admin`UPDATE awcms_channel_provider_risk_acknowledgements SET text_version = 'forged' WHERE id = ${id}`,
        "editing the text version",
        "23514",
        "immutable"
      );
      await pgRejected(
        admin`UPDATE awcms_channel_provider_risk_acknowledgements SET tenant_user_id = ${await makeUser(TENANT_A)} WHERE id = ${id}`,
        "re-attributing it to another person",
        "23514",
        "immutable"
      );
      await pgRejected(
        admin`UPDATE awcms_channel_provider_risk_acknowledgements SET acknowledged_at = now() - interval '9 days' WHERE id = ${id}`,
        "back-dating it",
        "23514",
        "immutable"
      );
      await pgRejected(
        admin`DELETE FROM awcms_channel_provider_risk_acknowledgements WHERE id = ${id}`,
        "deleting it",
        "23514",
        "never deleted"
      );
      await pgRejected(
        inTenant(
          TENANT_A,
          (tx) =>
            tx`DELETE FROM awcms_channel_provider_risk_acknowledgements WHERE id = ${id}`
        ),
        "deleting it as the runtime role",
        "23514",
        "never deleted"
      );

      const revoked = await inTenant(TENANT_A, (tx) =>
        revokeRiskAcknowledgement(tx, TENANT_A, user, id)
      );

      expect(revoked).toMatchObject({ outcome: "revoked" });

      await pgRejected(
        admin`UPDATE awcms_channel_provider_risk_acknowledgements SET revoked_at = NULL, revoked_by = NULL WHERE id = ${id}`,
        "un-revoking it",
        "23514",
        "terminal"
      );
      expect(
        await inTenant(TENANT_A, (tx) =>
          revokeRiskAcknowledgement(tx, TENANT_A, user, id)
        )
      ).toMatchObject({ outcome: "already_revoked" });
    });

    test("a revoked acknowledgement can be replaced by a new one (the unique index is over ACTIVE rows)", async () => {
      const user = await makeUser(TENANT_A);
      const first = (await acknowledge(TENANT_A, user)) as {
        acknowledgement: { id: string };
      };

      await inTenant(TENANT_A, (tx) =>
        revokeRiskAcknowledgement(tx, TENANT_A, user, first.acknowledgement.id)
      );

      const again = await acknowledge(TENANT_A, user);

      expect(again).toMatchObject({ outcome: "recorded", created: true });
      expect(
        (
          await inTenant(TENANT_A, (tx) =>
            listRiskAcknowledgements(tx, TENANT_A, "starsender")
          )
        ).length
      ).toBe(2);
    });

    test("RLS: another tenant sees none of it, cannot revoke it, and cannot insert one for this tenant", async () => {
      const userA = await makeUser(TENANT_A);
      const ack = (await acknowledge(TENANT_A, userA)) as {
        acknowledgement: { id: string };
      };
      const userB = await makeUser(TENANT_B);

      expect(
        await inTenant(TENANT_B, (tx) =>
          listRiskAcknowledgements(tx, TENANT_B, "starsender")
        )
      ).toEqual([]);
      expect(
        await inTenant(TENANT_B, (tx) =>
          revokeRiskAcknowledgement(tx, TENANT_B, userB, ack.acknowledgement.id)
        )
      ).toEqual({ outcome: "not_found" });
      // Reading with the OTHER tenant's id in the predicate is still empty: RLS
      // decides, not the WHERE clause.
      expect(
        (await inTenant(
          TENANT_B,
          (tx) => tx`
            SELECT id FROM awcms_channel_provider_risk_acknowledgements
            WHERE tenant_id = ${TENANT_A}
          `
        )) as unknown[]
      ).toEqual([]);
      await pgRejected(
        inTenant(
          TENANT_B,
          (tx) => tx`
            INSERT INTO awcms_channel_provider_risk_acknowledgements
              (tenant_id, provider, tenant_user_id, text_version, text_sha256)
            VALUES (${TENANT_A}, 'starsender', ${userA}, 'v', ${"0".repeat(64)})
          `
        ),
        "inserting for another tenant",
        "42501"
      );
      // A person of tenant B cannot be the acknowledging person of tenant A (the
      // composite foreign key).
      await pgRejected(
        getAdminSql()`
          INSERT INTO awcms_channel_provider_risk_acknowledgements
            (tenant_id, provider, tenant_user_id, text_version, text_sha256)
          VALUES (${TENANT_A}, 'starsender', ${userB}, 'v', ${"0".repeat(64)})
        `,
        "a foreign person as the acknowledger",
        "23503"
      );
    });

    test("the table refuses a provider that is not on the list and a malformed hash", async () => {
      const user = await makeUser(TENANT_A);

      await pgRejected(
        getAdminSql()`
          INSERT INTO awcms_channel_provider_risk_acknowledgements
            (tenant_id, provider, tenant_user_id, text_version, text_sha256)
          VALUES (${TENANT_A}, 'whatsapp_cloud', ${user}, 'v', ${"0".repeat(64)})
        `,
        "an official provider",
        "23514"
      );
      await pgRejected(
        getAdminSql()`
          INSERT INTO awcms_channel_provider_risk_acknowledgements
            (tenant_id, provider, tenant_user_id, text_version, text_sha256)
          VALUES (${TENANT_A}, 'starsender', ${user}, 'v', 'not-a-hash')
        `,
        "a malformed hash",
        "23514"
      );
    });
  });

  describe("a StarSender device cannot be connected without an acknowledgement (database guard)", () => {
    test("INSERT and UPDATE to connected are refused with none; allowed with one; other providers and other transitions are untouched", async () => {
      const admin = getAdminSql();
      const device = await seedDevice(TENANT_A);

      await pgRejected(
        admin`UPDATE awcms_channel_accounts SET status = 'connected' WHERE id = ${device.id}`,
        "connecting without an acknowledgement",
        "23514",
        "risk acknowledgement"
      );
      await pgRejected(
        admin`
          INSERT INTO awcms_channel_accounts
            (tenant_id, provider, account_kind, external_id, display_name, auth_mode, status)
          VALUES (${TENANT_A}, 'starsender', 'device', 'born-connected', 'x', 'device_key', 'connected')
        `,
        "inserting an already-connected device",
        "23514",
        "risk acknowledgement"
      );

      // Another tenant's acknowledgement does not count (the guard reads under the
      // row's own tenant).
      const userB = await makeUser(TENANT_B);

      await acknowledge(TENANT_B, userB);
      await pgRejected(
        admin`UPDATE awcms_channel_accounts SET status = 'connected' WHERE id = ${device.id}`,
        "connecting on the strength of another tenant's acknowledgement",
        "23514"
      );

      // Not a starsender account: no acknowledgement involved.
      await admin`
        INSERT INTO awcms_channel_accounts
          (tenant_id, provider, account_kind, external_id, display_name, auth_mode, status)
        VALUES (${TENANT_A}, 'whatsapp_cloud', 'waba', 'official-waba', 'x', 'oauth2', 'connected')
      `;

      const userA = await makeUser(TENANT_A);

      await acknowledge(TENANT_A, userA);
      await admin`UPDATE awcms_channel_accounts SET status = 'connected' WHERE id = ${device.id}`;
      expect(await statusOf(device.id)).toBe("connected");
      // Leaving `connected` is never blocked.
      await admin`UPDATE awcms_channel_accounts SET status = 'degraded' WHERE id = ${device.id}`;
      await admin`UPDATE awcms_channel_accounts SET status = 'disabled' WHERE id = ${device.id}`;
    });
  });

  describe("revocation", () => {
    test("revoking the LAST acknowledgement degrades the tenant's connected devices in the same transaction; another remaining acknowledgement keeps them", async () => {
      const u1 = await makeUser(TENANT_A);
      const u2 = await makeUser(TENANT_A);
      const a1 = (await acknowledge(TENANT_A, u1)) as {
        acknowledgement: { id: string };
      };
      const a2 = (await acknowledge(TENANT_A, u2)) as {
        acknowledgement: { id: string };
      };
      const d1 = await seedDevice(TENANT_A);
      const d2 = await seedDevice(TENANT_A);

      for (const d of [d1, d2]) {
        await getAdminSql()`UPDATE awcms_channel_accounts SET status = 'connected' WHERE id = ${d.id}`;
      }

      // A device of ANOTHER tenant is never touched.
      const otherUser = await makeUser(TENANT_B);

      await acknowledge(TENANT_B, otherUser);

      const other = await seedDevice(TENANT_B);

      await getAdminSql()`UPDATE awcms_channel_accounts SET status = 'connected' WHERE id = ${other.id}`;

      const first = await inTenant(TENANT_A, (tx) =>
        revokeRiskAcknowledgement(tx, TENANT_A, u1, a1.acknowledgement.id)
      );

      expect(first).toMatchObject({ outcome: "revoked", degradedAccounts: 0 });
      expect(await statusOf(d1.id)).toBe("connected");

      const last = await inTenant(TENANT_A, (tx) =>
        revokeRiskAcknowledgement(tx, TENANT_A, u2, a2.acknowledgement.id)
      );

      expect(last).toMatchObject({ outcome: "revoked", degradedAccounts: 2 });
      expect(await statusOf(d1.id)).toBe("degraded");
      expect(await statusOf(d2.id)).toBe("degraded");
      expect(await statusOf(other.id)).toBe("connected");

      const reason = (await getAdminSql()`
        SELECT status_reason FROM awcms_channel_accounts WHERE id = ${d1.id}
      `) as { status_reason: string }[];

      expect(reason[0]!.status_reason).toBe("RISK_ACK_REVOKED");
      // ... and it cannot come back without a NEW acknowledgement.
      await pgRejected(
        getAdminSql()`UPDATE awcms_channel_accounts SET status = 'connected' WHERE id = ${d1.id}`,
        "re-connecting after the last revocation",
        "23514"
      );
    });
  });

  describe("attestation (the one human-asserted connection, for a provider with no status call)", () => {
    test("needs the CALLER's own acknowledgement, a credential and a pending or degraded device", async () => {
      const owner = await makeUser(TENANT_A);
      const bystander = await makeUser(TENANT_A);
      const attest = (user: string, id: string) =>
        inTenant(TENANT_A, (tx) => attestDevice(tx, TENANT_A, user, id));
      const device = await seedDevice(TENANT_A);
      const noKey = await seedDevice(TENANT_A, { key: null });

      // Somebody else's acknowledgement does not stand in for the caller's.
      await acknowledge(TENANT_A, owner);
      expect(await attest(bystander, device.id)).toEqual({
        outcome: "refused",
        code: "RISK_ACKNOWLEDGEMENT_REQUIRED"
      });
      expect(await attest(owner, noKey.id)).toEqual({
        outcome: "refused",
        code: "CREDENTIAL_REQUIRED"
      });
      expect(await attest(owner, crypto.randomUUID())).toEqual({
        outcome: "not_found"
      });
      expect(await statusOf(device.id)).toBe("pending");

      expect(await attest(owner, device.id)).toEqual({
        outcome: "attested",
        status: "connected"
      });
      expect(await statusOf(device.id)).toBe("connected");
      expect(await attest(owner, device.id)).toEqual({
        outcome: "already_connected"
      });

      const health = (await getAdminSql()`
        SELECT state, reason_code FROM awcms_channel_account_health
        WHERE account_id = ${device.id}
      `) as { state: string; reason_code: string }[];

      expect(health[0]).toEqual({
        state: "ok",
        reason_code: "OPERATOR_ATTESTED"
      });
    });

    test("only a StarSender device can be attested; revoked and disabled accounts stay as they are", async () => {
      const owner = await makeUser(TENANT_A);

      await acknowledge(TENANT_A, owner);

      const admin = getAdminSql();
      const waba = (await admin`
        INSERT INTO awcms_channel_accounts
          (tenant_id, provider, account_kind, external_id, display_name, auth_mode, status)
        VALUES (${TENANT_A}, 'whatsapp_cloud', 'waba', 'w-1', 'x', 'oauth2', 'pending')
        RETURNING id
      `) as { id: string }[];
      const disabled = await seedDevice(TENANT_A, { status: "disabled" });
      const attest = (id: string) =>
        inTenant(TENANT_A, (tx) => attestDevice(tx, TENANT_A, owner, id));

      expect(await attest(waba[0]!.id)).toEqual({
        outcome: "refused",
        code: "NOT_AN_UNOFFICIAL_DEVICE"
      });
      expect(await attest(disabled.id)).toEqual({
        outcome: "refused",
        code: "ACCOUNT_STATE_INVALID"
      });
      expect(await statusOf(disabled.id)).toBe("disabled");
    });

    test("with the text unapproved no attestation is possible even with a stored acknowledgement row", async () => {
      const owner = await makeUser(TENANT_A);
      const device = await seedDevice(TENANT_A);

      await acknowledge(TENANT_A, owner);
      overrideRiskAcknowledgementCatalogueForTests(null);

      expect(
        await inTenant(TENANT_A, (tx) =>
          attestDevice(tx, TENANT_A, owner, device.id)
        )
      ).toEqual({ outcome: "refused", code: "RISK_ACKNOWLEDGEMENT_REQUIRED" });
    });
  });

  describe("the worker role", () => {
    workerTest(
      "reads only the five columns the send decision needs, and writes nothing",
      async () => {
        const owner = await makeUser(TENANT_A);

        await acknowledge(TENANT_A, owner);

        const inWorker = <T>(fn: (tx: Bun.TransactionSQL) => Promise<T>) =>
          withTenantOrThrow(getWorkerRoleSql(), TENANT_A, fn, {
            workClass: "background_sync"
          });

        expect(
          (await inWorker(
            (tx) => tx`
            SELECT id, tenant_id, provider, text_version, revoked_at
            FROM awcms_channel_provider_risk_acknowledgements
            WHERE tenant_id = ${TENANT_A}
          `
          )) as unknown[]
        ).toHaveLength(1);

        for (const column of [
          "tenant_user_id",
          "text_sha256",
          "revoked_by",
          "acknowledged_at"
        ]) {
          await pgRejected(
            inWorker((tx) =>
              tx.unsafe(
                `SELECT ${column} FROM awcms_channel_provider_risk_acknowledgements`
              )
            ),
            `reading ${column}`,
            "42501"
          );
        }

        await pgRejected(
          inWorker(
            (tx) => tx`
            UPDATE awcms_channel_provider_risk_acknowledgements SET revoked_at = now()
          `
          ),
          "writing",
          "42501"
        );
        await pgRejected(
          inWorker(
            (tx) => tx`
            INSERT INTO awcms_channel_provider_risk_acknowledgements
              (tenant_id, provider, tenant_user_id, text_version, text_sha256)
            VALUES (${TENANT_A}, 'starsender', ${owner}, 'v', ${"0".repeat(64)})
          `
          ),
          "inserting",
          "42501"
        );
      }
    );
  });

  describe("through the real dispatcher with the real adapter", () => {
    async function connectedDevice(
      tenantId: string,
      owner: string,
      seed: DeviceSeed = {}
    ) {
      const device = await seedDevice(tenantId, seed);

      await inTenant(tenantId, (tx) =>
        attestDevice(tx, tenantId, owner, device.id)
      );
      expect(await statusOf(device.id)).toBe("connected");

      return device;
    }

    workerTest(
      "accepted is not delivered: the message is `sent` with no provider message id, through THIS device's key to the one allowlisted URL",
      async () => {
        const owner = await makeUser(TENANT_A);

        await acknowledge(TENANT_A, owner);

        const device = await connectedDevice(TENANT_A, owner);
        const queued = await enqueue(TENANT_A, device.id);

        expect(queued.status).toBe("queued");

        const { http, calls } = scriptedHttp(() => ACCEPTED);
        const result = await dispatch(TENANT_A, http);

        expect(result.sent).toBe(1);
        expect(calls).toHaveLength(1);
        expect(calls[0]!.url).toBe("https://api.starsender.online/api/send");
        expect(calls[0]!.headers.Authorization).toBe(device.key!);
        expect(JSON.parse(calls[0]!.body)).toEqual({
          messageType: "text",
          to: "6281234567890",
          body: "Reminder for Sari"
        });

        const sent = await message(queuedId(queued));

        expect(sent.status).toBe("sent");
        expect(sent.provider_message_id).toBeNull();
        expect(sent.provider).toBe("starsender");

        // The key never reached a row.
        const everything = (await getAdminSql()`
        SELECT to_jsonb(t)::text AS row FROM awcms_whatsapp_messages t
        UNION ALL SELECT to_jsonb(t)::text FROM awcms_whatsapp_delivery_attempts t
        UNION ALL SELECT to_jsonb(t)::text FROM awcms_domain_events t
        UNION ALL SELECT to_jsonb(t)::text FROM awcms_audit_events t
      `) as { row: string }[];

        expect(everything.map((r) => r.row).join("\n")).not.toContain(
          device.key!
        );
      }
    );

    workerTest(
      "a semantic HTTP 200 failure is a failure with a fixed code and sanitized text, and the provider's wording is not stored",
      async () => {
        const owner = await makeUser(TENANT_A);

        await acknowledge(TENANT_A, owner);

        const device = await connectedDevice(TENANT_A, owner);
        const queued = await enqueue(TENANT_A, device.id);
        const { http } = scriptedHttp(() => ({
          status: 200,
          body: `{"success":false,"message":"cannot send to 6281234567890 using ${device.key!}"}`
        }));

        await dispatch(TENANT_A, http);

        const failed = await message(queuedId(queued));

        expect(failed.status).toBe("failed");
        expect(failed.failure_code).toBe("rejected");

        const attempts = (await getAdminSql()`
        SELECT to_jsonb(t)::text AS row FROM awcms_whatsapp_delivery_attempts t
      `) as { row: string }[];
        const text = attempts.map((r) => r.row).join("\n");

        expect(text).not.toContain(device.key!);
        expect(text).not.toContain("6281234567890");
        expect(text).not.toContain("cannot send");
      }
    );

    workerTest(
      "a disconnected device HOLDS its own lane (one call, a bounded retry); the tenant's other device still sends; nothing is rerouted",
      async () => {
        const owner = await makeUser(TENANT_A);

        await acknowledge(TENANT_A, owner);

        const down = await connectedDevice(TENANT_A, owner);
        const up = await connectedDevice(TENANT_A, owner);
        const toDown1 = await enqueue(TENANT_A, down.id);
        const toDown2 = await enqueue(TENANT_A, down.id);
        const toUp = await enqueue(TENANT_A, up.id);
        const { http, calls } = scriptedHttp((call) =>
          call.headers.Authorization === down.key
            ? {
                status: 200,
                body: '{"success":false,"message":"Device is not connected"}'
              }
            : ACCEPTED
        );

        await dispatch(TENANT_A, http);

        const downCalls = calls.filter(
          (c) => c.headers.Authorization === down.key
        );
        const upCalls = calls.filter((c) => c.headers.Authorization === up.key);

        // The lane is held after the FIRST disconnected answer: no further call.
        expect(downCalls).toHaveLength(1);
        expect(upCalls).toHaveLength(1);
        expect((await message(queuedId(toUp))).status).toBe("sent");

        const first = await message(queuedId(toDown1));
        const second = await message(queuedId(toDown2));

        expect(first).toMatchObject({
          status: "retry_wait",
          failure_code: "device_disconnected"
        });
        expect(second.status).not.toBe("sent");
        // No other sender, device or provider carried them.
        expect(
          calls.every((c) =>
            [down.key, up.key].includes(c.headers.Authorization!)
          )
        ).toBe(true);
        expect(
          getProviderCircuitBreaker(whatsappSenderBreakerKey(up.id)).canAttempt(
            new Date()
          )
        ).toBe(true);
      }
    );

    workerTest(
      "revoking the acknowledgement fails a queued message terminally at the next claim, the device is never called, and a new enqueue is refused",
      async () => {
        const owner = await makeUser(TENANT_A);
        const ack = (await acknowledge(TENANT_A, owner)) as {
          acknowledgement: { id: string };
        };
        const device = await connectedDevice(TENANT_A, owner);
        const queued = await enqueue(TENANT_A, device.id);

        await inTenant(TENANT_A, (tx) =>
          revokeRiskAcknowledgement(tx, TENANT_A, owner, ack.acknowledgement.id)
        );

        const { http, calls } = scriptedHttp(() => ACCEPTED);

        await dispatch(TENANT_A, http);

        expect(calls).toHaveLength(0);
        expect(await message(queuedId(queued))).toMatchObject({
          status: "failed",
          failure_code: "sender_unavailable"
        });
        expect(await enqueue(TENANT_A, device.id)).toEqual({
          status: "refused",
          reason: "SENDER_UNAVAILABLE"
        });
      }
    );

    workerTest(
      "off by default: without the adapter flag a connected, acknowledged device is refused at enqueue and a queued row fails at dispatch, with no call",
      async () => {
        const owner = await makeUser(TENANT_A);

        await acknowledge(TENANT_A, owner);

        const device = await connectedDevice(TENANT_A, owner);
        const queued = await enqueue(TENANT_A, device.id);
        const flagOff = {
          ...ENV,
          WHATSAPP_STARSENDER_ENABLED: "false"
        } as NodeJS.ProcessEnv;

        expect(await enqueue(TENANT_A, device.id, flagOff)).toEqual({
          status: "refused",
          reason: "SENDER_UNAVAILABLE"
        });

        const { http, calls } = scriptedHttp(() => ACCEPTED);

        await dispatchWhatsappQueue(getWorkerRoleSql(), TENANT_A, {
          env: flagOff,
          senders,
          credentials,
          now: new Date(Date.now() + 1000),
          buildSenderProvider: (input) =>
            buildWhatsappSenderProvider({ ...input, http })
        });

        expect(calls).toHaveLength(0);
        expect((await message(queuedId(queued))).status).toBe("failed");
      }
    );

    workerTest(
      "two tenants: a tenant cannot send through another tenant's device, and each device is called with its own key",
      async () => {
        const ownerA = await makeUser(TENANT_A);
        const ownerB = await makeUser(TENANT_B);

        await acknowledge(TENANT_A, ownerA);
        await acknowledge(TENANT_B, ownerB);

        const deviceA = await connectedDevice(TENANT_A, ownerA);
        const deviceB = await connectedDevice(TENANT_B, ownerB);

        // Forgery: B names A's device. Same answer as an unknown id.
        expect(await enqueue(TENANT_B, deviceA.id)).toEqual({
          status: "refused",
          reason: "SENDER_UNAVAILABLE"
        });

        await enqueue(TENANT_A, deviceA.id);
        await enqueue(TENANT_B, deviceB.id);

        const { http, calls } = scriptedHttp(() => ACCEPTED);

        await dispatch(TENANT_A, http);
        await dispatch(TENANT_B, http);

        expect(calls.map((c) => c.headers.Authorization).sort()).toEqual(
          [deviceA.key!, deviceB.key!].sort()
        );
      }
    );

    workerTest(
      "a timeout is an unknown outcome and is NOT retried (no idempotency key at the provider: a retry could message the recipient twice)",
      async () => {
        const owner = await makeUser(TENANT_A);

        await acknowledge(TENANT_A, owner);

        const device = await connectedDevice(TENANT_A, owner);
        const queued = await enqueue(TENANT_A, device.id);
        const calls: number[] = [];
        const http: WhatsappHttpClient = async () => {
          calls.push(1);

          return {
            ok: false,
            reason: "outbound request refused: request_failed"
          };
        };

        await dispatch(TENANT_A, http);
        await dispatch(TENANT_A, http);

        expect(calls).toHaveLength(1);
        expect(await message(queuedId(queued))).toMatchObject({
          status: "failed",
          failure_code: "outcome_unknown"
        });
      }
    );
  });
});
