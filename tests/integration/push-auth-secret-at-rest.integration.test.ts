/**
 * Push subscription auth secret at rest (Issue #1089), against a real database.
 *
 * Proves, end to end: registration stores ciphertext and no plaintext; the
 * dispatcher delivers for BOTH a legacy plaintext row and a ciphertext row; a
 * ciphertext moved to another row fails (AAD) and is not rescued by a plaintext
 * fallback; the runtime backfill is idempotent and resumable and runs as
 * `awcms_worker` under the narrowed column grants of sql/314; and the CHECK
 * refuses a row holding both or neither.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
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
import { getDatabaseCircuitBreaker } from "../../src/lib/database/circuit-breaker";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { dispatchPushQueue } from "../../src/modules/push-delivery/application/push-dispatch";
import { enqueuePushToRecipients } from "../../src/modules/push-delivery/application/push-enqueue";
import {
  backfillPushAuthSecretsBatch,
  backfillPushAuthSecretsForTenant,
  countPlaintextPushAuthSecrets
} from "../../src/modules/push-delivery/application/push-auth-secret-backfill";
import { registerPushSubscription } from "../../src/modules/push-delivery/application/subscription-directory";
import { hashPushEndpoint } from "../../src/modules/push-delivery/domain/push-endpoint";
import {
  encryptPushAuthSecret,
  resolvePushAuthSecretRing
} from "../../src/modules/push-delivery/domain/push-auth-secret";
import type {
  PushProvider,
  PushTarget
} from "../../src/modules/push-delivery/domain/push-provider-contract";

const TENANT = "f1089000-0000-4000-8000-000000000001";
const USER = "f1089000-0000-4000-8000-0000000000a1";
const KEY = Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 251)
).toString("base64");
const ENV = {
  PUSH_ENABLED: "true",
  PUSH_PROVIDER: "web_push",
  PUSH_AUTH_SECRET_ENCRYPTION_KEYS: `k1:${KEY}`
} as unknown as NodeJS.ProcessEnv;
const RING = (() => {
  const ring = resolvePushAuthSecretRing(ENV);

  if (!ring.ok) throw new Error(ring.reason);

  return ring;
})();

const endpointOf = (n: number) => `https://push.example.test/send/device-${n}`;
const secretOf = (n: number) =>
  `legacy-auth-secret-${String(n).padStart(4, "0")}`;

async function seedTenantAndUser(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT}, 'push-at-rest', 'Push At Rest')
  `;
  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT}, 'person', 'Recipient') RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${TENANT}, ${profile[0]!.id}, 'push-at-rest@example.test', 'x')
    RETURNING id
  `) as { id: string }[];

  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
    VALUES (${USER}, ${TENANT}, ${identity[0]!.id})
  `;
}

/** A pre-#1089 row: plaintext secret, no ciphertext. */
async function seedLegacyRow(n: number): Promise<string> {
  const endpoint = endpointOf(n);
  const rows = (await getAdminSql()`
    INSERT INTO awcms_push_subscriptions
      (tenant_id, tenant_user_id, transport, endpoint, endpoint_hash,
       endpoint_masked, p256dh_key, auth_secret)
    VALUES (${TENANT}, ${USER}, 'web_push', ${endpoint},
            ${hashPushEndpoint(endpoint)}, 'masked', 'BPublicKey', ${secretOf(n)})
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

async function rowState(id: string): Promise<{
  auth_secret: string | null;
  auth_secret_ciphertext: string | null;
}> {
  const rows = (await getAdminSql()`
    SELECT auth_secret, auth_secret_ciphertext
    FROM awcms_push_subscriptions WHERE id = ${id}
  `) as { auth_secret: string | null; auth_secret_ciphertext: string | null }[];

  return rows[0]!;
}

function recordingProvider(sent: PushTarget[]): PushProvider {
  return {
    supportedTransports: ["web_push", "fcm"],
    async send(target) {
      sent.push(target);

      return { ok: true };
    },
    async healthCheck() {
      return { ok: true };
    }
  };
}

async function dispatchAll(sent: PushTarget[]) {
  const sql = workerRoleActivated ? getWorkerRoleSql() : getRuntimeSql();

  return dispatchPushQueue(sql, TENANT, {
    env: ENV,
    resolveProvider: () => recordingProvider(sent)
  });
}

const suite = integrationEnabled ? describe : describe.skip;

suite("push subscription auth secret at rest (#1089)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedTenantAndUser();
  });

  test("registration stores ciphertext and leaves no plaintext", async () => {
    const runtime = getRuntimeSql();
    const summary = await withTenantOrThrow(runtime, TENANT, (tx) =>
      registerPushSubscription(
        tx,
        TENANT,
        {
          tenantUserId: USER,
          transport: "web_push",
          endpoint: endpointOf(1),
          p256dhKey: "BPublicKey",
          authSecret: "fresh-auth-secret-0001"
        },
        RING
      )
    );
    const state = await rowState(summary.id);

    expect(state.auth_secret).toBeNull();
    expect(state.auth_secret_ciphertext).toStartWith("v2:k1:");
    expect(state.auth_secret_ciphertext).not.toContain("fresh-auth-secret");
  });

  test("re-registering a legacy plaintext row migrates it to ciphertext", async () => {
    const id = await seedLegacyRow(1);
    const runtime = getRuntimeSql();

    await withTenantOrThrow(runtime, TENANT, (tx) =>
      registerPushSubscription(
        tx,
        TENANT,
        {
          tenantUserId: USER,
          transport: "web_push",
          endpoint: endpointOf(1),
          p256dhKey: "BPublicKey",
          authSecret: "rotated-auth-secret"
        },
        RING
      )
    );

    const state = await rowState(id);

    expect(state.auth_secret).toBeNull();
    expect(state.auth_secret_ciphertext).toStartWith("v2:k1:");
  });

  test("dispatcher delivers for a legacy plaintext row AND a ciphertext row", async () => {
    const legacyId = await seedLegacyRow(1);
    const runtime = getRuntimeSql();
    const encrypted = await withTenantOrThrow(runtime, TENANT, (tx) =>
      registerPushSubscription(
        tx,
        TENANT,
        {
          tenantUserId: USER,
          transport: "web_push",
          endpoint: endpointOf(2),
          p256dhKey: "BPublicKey",
          authSecret: "fresh-auth-secret-0002"
        },
        RING
      )
    );

    expect((await rowState(legacyId)).auth_secret).toBe(secretOf(1));

    await withTenantOrThrow(runtime, TENANT, (tx) =>
      enqueuePushToRecipients(tx, TENANT, [USER], {
        category: "test.at_rest",
        title: "T",
        body: "B"
      })
    );

    const sent: PushTarget[] = [];
    const result = await dispatchAll(sent);

    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);

    const secrets = sent.map((target) => target.authSecret).sort();

    expect(secrets).toEqual([secretOf(1), "fresh-auth-secret-0002"].sort());
    expect(encrypted.id).not.toBe(legacyId);
  });

  test("a ciphertext moved to another row fails to deliver and is not rescued by plaintext", async () => {
    const admin = getAdminSql();
    const victim = await seedLegacyRow(1);

    // Ciphertext legitimately bound to ANOTHER endpoint hash, copied onto the
    // victim row; the victim keeps no plaintext (exactly one column is allowed).
    const foreign = encryptPushAuthSecret(
      "stolen-secret",
      TENANT,
      hashPushEndpoint(endpointOf(99)),
      RING
    );

    await admin`
      UPDATE awcms_push_subscriptions
      SET auth_secret = NULL, auth_secret_ciphertext = ${foreign}
      WHERE id = ${victim}
    `;
    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      enqueuePushToRecipients(tx, TENANT, [USER], {
        category: "test.moved",
        title: "T",
        body: "B"
      })
    );

    const sent: PushTarget[] = [];
    const result = await dispatchAll(sent);

    expect(sent).toHaveLength(0);
    expect(result.failed).toBe(1);

    const attempts = (await admin`
      SELECT error_message FROM awcms_push_delivery_attempts
      WHERE tenant_id = ${TENANT}
    `) as { error_message: string }[];

    expect(JSON.stringify(attempts)).not.toContain("stolen-secret");
  });

  test("ciphertext rows with no key ring are retried, not failed", async () => {
    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      registerPushSubscription(
        tx,
        TENANT,
        {
          tenantUserId: USER,
          transport: "web_push",
          endpoint: endpointOf(3),
          p256dhKey: "BPublicKey",
          authSecret: "fresh-auth-secret-0003"
        },
        RING
      )
    );
    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      enqueuePushToRecipients(tx, TENANT, [USER], {
        category: "test.noring",
        title: "T",
        body: "B"
      })
    );

    const sent: PushTarget[] = [];
    const sql = workerRoleActivated ? getWorkerRoleSql() : getRuntimeSql();
    const result = await dispatchPushQueue(sql, TENANT, {
      env: { ...ENV, PUSH_AUTH_SECRET_ENCRYPTION_KEYS: "" },
      resolveProvider: () => recordingProvider(sent)
    });

    expect(sent).toHaveLength(0);
    expect(result.retried).toBe(1);
    expect(result.failed).toBe(0);
  });

  test("the backfill is idempotent and resumable, and runs as the worker", async () => {
    const ids: string[] = [];

    for (let n = 1; n <= 5; n += 1) ids.push(await seedLegacyRow(n));

    const sql = workerRoleActivated ? getWorkerRoleSql() : getRuntimeSql();

    expect(await countPlaintextPushAuthSecrets(sql, TENANT)).toBe(5);

    // Resumable: a partial run (2 of 5, then "killed") leaves a consistent table.
    const first = await backfillPushAuthSecretsBatch(sql, TENANT, RING, {
      limit: 2
    });

    expect(first.converted).toBe(2);
    expect(first.complete).toBe(false);
    expect(await countPlaintextPushAuthSecrets(sql, TENANT)).toBe(3);

    // A fresh run (no cursor) finishes exactly the remainder.
    const rest = await backfillPushAuthSecretsForTenant(sql, TENANT, RING, {
      limit: 2
    });

    expect(rest).toEqual({ converted: 3, complete: true });
    expect(await countPlaintextPushAuthSecrets(sql, TENANT)).toBe(0);

    // Idempotent: nothing left to do, nothing changes.
    const before = await Promise.all(ids.map(rowState));
    const again = await backfillPushAuthSecretsForTenant(sql, TENANT, RING);

    expect(again).toEqual({ converted: 0, complete: true });
    expect(await Promise.all(ids.map(rowState))).toEqual(before);

    for (const state of before) {
      expect(state.auth_secret).toBeNull();
      expect(state.auth_secret_ciphertext).toStartWith("v2:k1:");
    }

    // The converted rows still deliver with their ORIGINAL secrets.
    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      enqueuePushToRecipients(tx, TENANT, [USER], {
        category: "test.after_backfill",
        title: "T",
        body: "B"
      })
    );

    const sent: PushTarget[] = [];
    const result = await dispatchAll(sent);

    expect(result.sent).toBe(5);
    expect(sent.map((target) => target.authSecret).sort()).toEqual(
      [1, 2, 3, 4, 5].map(secretOf).sort()
    );
  });

  test("the CHECK refuses a web_push row with both secret columns, or neither", async () => {
    const admin = getAdminSql();
    const hash = hashPushEndpoint(endpointOf(7));

    await assertRejected(
      admin`
        INSERT INTO awcms_push_subscriptions
          (tenant_id, tenant_user_id, transport, endpoint, endpoint_hash,
           endpoint_masked, p256dh_key, auth_secret, auth_secret_ciphertext)
        VALUES (${TENANT}, ${USER}, 'web_push', ${endpointOf(7)}, ${hash},
                'm', 'BPublicKey', 'a', 'b')
      `,
      "both secret columns"
    );
    await assertRejected(
      admin`
        INSERT INTO awcms_push_subscriptions
          (tenant_id, tenant_user_id, transport, endpoint, endpoint_hash,
           endpoint_masked, p256dh_key)
        VALUES (${TENANT}, ${USER}, 'web_push', ${endpointOf(7)}, ${hash},
                'm', 'BPublicKey')
      `,
      "neither secret column"
    );
  });

  test("a row whose endpoint does not hash to its endpoint_hash is not delivered, and is not a database failure", async () => {
    const admin = getAdminSql();
    const id = await seedLegacyRow(1);

    // Re-pointed endpoint, hash and secret untouched (what a DELETE+INSERT or a
    // direct write would produce).
    await admin`
      UPDATE awcms_push_subscriptions SET endpoint = 'https://evil.test/x'
      WHERE id = ${id}
    `;
    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      enqueuePushToRecipients(tx, TENANT, [USER], {
        category: "test.forged",
        title: "T",
        body: "B"
      })
    );

    const breaker = getDatabaseCircuitBreaker();
    const failures = spyOn(breaker, "recordFailure");
    const sent: PushTarget[] = [];

    try {
      const result = await dispatchAll(sent);

      expect(sent).toHaveLength(0);
      expect(result.failed).toBe(1);
      // L1: the refusal happens outside the transaction.
      expect(failures).not.toHaveBeenCalled();
    } finally {
      failures.mockRestore();
    }
  });

  test("a decryption refusal is not a database failure either", async () => {
    const id = await seedLegacyRow(1);
    const foreign = encryptPushAuthSecret(
      "x",
      TENANT,
      hashPushEndpoint(endpointOf(98)),
      RING
    );

    await getAdminSql()`
      UPDATE awcms_push_subscriptions
      SET auth_secret = NULL, auth_secret_ciphertext = ${foreign}
      WHERE id = ${id}
    `;
    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      enqueuePushToRecipients(tx, TENANT, [USER], {
        category: "test.l1",
        title: "T",
        body: "B"
      })
    );

    const failures = spyOn(getDatabaseCircuitBreaker(), "recordFailure");

    try {
      expect((await dispatchAll([])).failed).toBe(1);
      expect(failures).not.toHaveBeenCalled();
    } finally {
      failures.mockRestore();
    }
  });

  test("the worker cannot INSERT a subscription (no re-pointing by DELETE + INSERT)", async () => {
    if (!workerRoleActivated) return;

    const worker = getWorkerRoleSql();
    const error = await assertRejected(
      worker.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${TENANT}, true)`;
        await tx`
          INSERT INTO awcms_push_subscriptions
            (tenant_id, tenant_user_id, transport, endpoint, endpoint_hash,
             endpoint_masked, p256dh_key, auth_secret)
          VALUES (${TENANT}, ${USER}, 'web_push', 'https://evil.test/x',
                  'forged', 'm', 'BAttacker', 'attacker-secret')
        `;
      }),
      "worker INSERT"
    );

    expect(`${(error as { errno?: string }).errno}`).toBe("42501");
  });

  test("the worker can no longer rewrite the endpoint", async () => {
    if (!workerRoleActivated) return;

    const id = await seedLegacyRow(1);
    const worker = getWorkerRoleSql();
    const error = await assertRejected(
      worker.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${TENANT}, true)`;
        await tx`
          UPDATE awcms_push_subscriptions SET endpoint = 'https://evil.test/x'
          WHERE id = ${id}
        `;
      }),
      "worker UPDATE (endpoint)"
    );

    expect(`${(error as { errno?: string }).errno}`).toBe("42501");
  });
});
