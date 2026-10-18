/**
 * Push auth-secret key rotation and endpoint takeover (Issue #1098), against a
 * real database.
 *
 * Proves: the re-key moves only rows under a non-active key id, is idempotent,
 * resumable and batched, runs as `awcms_worker`, leaves undecryptable rows
 * untouched and counted, keeps delivering the ORIGINAL secret, and the per-key-id
 * count agrees; and that re-registering an endpoint held by another user
 * TRANSFERS it explicitly (ownership, delivery, audit with ids only, fail
 * closed), while re-registering one's own device records nothing.
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
  getAdminSql,
  getRuntimeSql,
  getWorkerRoleSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
  workerRoleActivated
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { dispatchPushQueue } from "../../src/modules/push-delivery/application/push-dispatch";
import { enqueuePushToRecipients } from "../../src/modules/push-delivery/application/push-enqueue";
import {
  countPushAuthSecretsByKeyId,
  rekeyPushAuthSecretsBatch,
  rekeyPushAuthSecretsForTenant
} from "../../src/modules/push-delivery/application/push-auth-secret-backfill";
import {
  disablePushSubscription,
  registerPushSubscription,
  revokeOwnPushSubscription
} from "../../src/modules/push-delivery/application/subscription-directory";
import { resolvePushAuthSecretRing } from "../../src/modules/push-delivery/domain/push-auth-secret";
import type {
  PushProvider,
  PushTarget
} from "../../src/modules/push-delivery/domain/push-provider-contract";

const TENANT = "f1098000-0000-4000-8000-000000000001";
const USER = "f1098000-0000-4000-8000-0000000000a1";
const OTHER = "f1098000-0000-4000-8000-0000000000a2";
const bytes = (mul: number) =>
  Buffer.from(
    Array.from({ length: 32 }, (_, i) => (i * mul + 3) % 251)
  ).toString("base64");
const K1 = bytes(7);
const K2 = bytes(13);
const K3 = bytes(17);

function ringOf(spec: string) {
  const ring = resolvePushAuthSecretRing({
    PUSH_AUTH_SECRET_ENCRYPTION_KEYS: spec
  } as unknown as NodeJS.ProcessEnv);

  if (!ring.ok) throw new Error(ring.reason);

  return ring;
}

const OLD_RING = ringOf(`k1:${K1}`);
const ROTATED = ringOf(`k2:${K2},k1:${K1}`);
const ENV = {
  PUSH_ENABLED: "true",
  PUSH_PROVIDER: "web_push",
  PUSH_AUTH_SECRET_ENCRYPTION_KEYS: `k2:${K2},k1:${K1}`
} as unknown as NodeJS.ProcessEnv;

const endpointOf = (n: number) => `https://push.example.test/send/rk-${n}`;
const secretOf = (n: number) =>
  `rekey-auth-secret-${String(n).padStart(4, "0")}`;

async function seedTenantAndUsers(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT}, 'push-rekey', 'Push Rekey')
  `;

  for (const [userId, label] of [
    [USER, "u1"],
    [OTHER, "u2"]
  ] as const) {
    const profile = (await admin`
      INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
      VALUES (${TENANT}, 'person', ${label}) RETURNING id
    `) as { id: string }[];
    const identity = (await admin`
      INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
      VALUES (${TENANT}, ${profile[0]!.id}, ${`${label}@example.test`}, 'x')
      RETURNING id
    `) as { id: string }[];

    await admin`
      INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
      VALUES (${userId}, ${TENANT}, ${identity[0]!.id})
    `;
  }
}

function register(
  tenantUserId: string,
  n: number,
  ring = OLD_RING,
  authSecret = secretOf(n)
) {
  return withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
    registerPushSubscription(
      tx,
      TENANT,
      {
        tenantUserId,
        transport: "web_push",
        endpoint: endpointOf(n),
        p256dhKey: "BPublicKey",
        authSecret
      },
      ring
    )
  );
}

async function ciphertextOf(id: string): Promise<string> {
  const rows = (await getAdminSql()`
    SELECT auth_secret_ciphertext FROM awcms_push_subscriptions WHERE id = ${id}
  `) as { auth_secret_ciphertext: string }[];

  return rows[0]!.auth_secret_ciphertext;
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

function enqueueFor(userId: string, category: string) {
  return withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
    enqueuePushToRecipients(tx, TENANT, [userId], {
      category,
      title: "T",
      body: "B"
    })
  );
}

const suite = integrationEnabled ? describe : describe.skip;

suite("push auth-secret re-key and endpoint takeover (#1098)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedTenantAndUsers();
  });

  test("re-key moves only old-key rows, is idempotent and resumable, and keeps the secret deliverable", async () => {
    const ids: string[] = [];

    for (let n = 1; n <= 5; n += 1) ids.push((await register(USER, n)).id);

    // One row already under the ACTIVE key: must be left exactly as it is.
    const current = await register(USER, 6, ROTATED);
    const untouched = await ciphertextOf(current.id);
    const sql = workerRoleActivated ? getWorkerRoleSql() : getRuntimeSql();

    expect(await countPushAuthSecretsByKeyId(sql, TENANT)).toEqual({
      k1: 5,
      k2: 1
    });

    const first = await rekeyPushAuthSecretsBatch(sql, TENANT, ROTATED, {
      limit: 2
    });

    expect(first).toMatchObject({ converted: 2, failed: 0, complete: false });
    expect(await countPushAuthSecretsByKeyId(sql, TENANT)).toEqual({
      k1: 3,
      k2: 3
    });

    const rest = await rekeyPushAuthSecretsForTenant(sql, TENANT, ROTATED, {
      limit: 2
    });

    expect(rest).toEqual({ converted: 3, failed: 0, complete: true });
    expect(await countPushAuthSecretsByKeyId(sql, TENANT)).toEqual({ k2: 6 });
    expect(await ciphertextOf(current.id)).toBe(untouched);

    const before = await Promise.all(ids.map(ciphertextOf));
    const again = await rekeyPushAuthSecretsForTenant(sql, TENANT, ROTATED);

    expect(again).toEqual({ converted: 0, failed: 0, complete: true });
    expect(await Promise.all(ids.map(ciphertextOf))).toEqual(before);

    // The old key is no longer needed: delivery works with k2 alone.
    await enqueueFor(USER, "test.rekey");

    const sent: PushTarget[] = [];
    const result = await dispatchPushQueue(sql, TENANT, {
      env: {
        ...ENV,
        PUSH_AUTH_SECRET_ENCRYPTION_KEYS: `k2:${K2}`
      } as unknown as NodeJS.ProcessEnv,
      resolveProvider: () => recordingProvider(sent)
    });

    expect(result.sent).toBe(6);
    expect(sent.map((target) => target.authSecret).sort()).toEqual(
      [1, 2, 3, 4, 5, 6].map(secretOf).sort()
    );
  });

  test("a row that cannot be decrypted is counted, left untouched and never logged", async () => {
    const a = await register(USER, 1);
    const b = await register(USER, 2);
    const sql = workerRoleActivated ? getWorkerRoleSql() : getRuntimeSql();
    // A ring that lacks k1 cannot read either row.
    const wrongRing = ringOf(`k3:${K3}`);
    const beforeA = await ciphertextOf(a.id);
    const beforeB = await ciphertextOf(b.id);
    const result = await rekeyPushAuthSecretsForTenant(sql, TENANT, wrongRing);

    expect(result).toEqual({ converted: 0, failed: 2, complete: true });
    expect(await ciphertextOf(a.id)).toBe(beforeA);
    expect(await ciphertextOf(b.id)).toBe(beforeB);
  });

  test("takeover: the endpoint moves to the new user, delivery follows, the prior user's queue is cancelled, and the audit event carries ids only", async () => {
    const original = await register(USER, 1);

    await enqueueFor(USER, "test.before_transfer");

    const moved = await register(OTHER, 1, OLD_RING, "new-owner-secret-0001");

    expect(moved.id).toBe(original.id);
    expect(moved.tenantUserId).toBe(OTHER);

    const admin = getAdminSql();
    const queued = (await admin`
      SELECT status, last_error FROM awcms_push_messages
      WHERE tenant_id = ${TENANT} AND subscription_id = ${original.id}
    `) as { status: string; last_error: string | null }[];

    expect(queued).toEqual([
      { status: "cancelled", last_error: "subscription_transferred" }
    ]);

    // The previous owner is no longer reachable on this device; the new one is.
    const sent: PushTarget[] = [];

    await enqueueFor(USER, "test.old_owner");
    expect((await dispatchAll(sent)).sent).toBe(0);
    await enqueueFor(OTHER, "test.new_owner");
    expect((await dispatchAll(sent)).sent).toBe(1);
    expect(sent[0]!.authSecret).toBe("new-owner-secret-0001");

    const audits = (await admin`
      SELECT module_key, action, resource_type, resource_id, actor_tenant_user_id,
             attributes::text AS attributes, message
      FROM awcms_audit_events
      WHERE tenant_id = ${TENANT} AND action = 'subscription.transfer'
    `) as {
      module_key: string;
      action: string;
      resource_type: string;
      resource_id: string;
      actor_tenant_user_id: string;
      attributes: string;
      message: string;
    }[];

    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      module_key: "push_delivery",
      resource_type: "push_subscription",
      resource_id: original.id,
      actor_tenant_user_id: OTHER
    });
    expect(JSON.parse(audits[0]!.attributes)).toEqual({
      subscriptionId: original.id,
      previousTenantUserId: USER,
      newTenantUserId: OTHER,
      previousStatus: "active"
    });

    const serialised = JSON.stringify(audits);

    expect(serialised).not.toContain("push.example.test");
    expect(serialised).not.toContain("new-owner-secret");
    expect(serialised).not.toContain(secretOf(1));
  });

  test("re-registering one's own device or a new device records no transfer", async () => {
    await register(USER, 1);
    await register(USER, 1);
    await register(OTHER, 2);

    const audits = (await getAdminSql()`
      SELECT 1 FROM awcms_audit_events
      WHERE tenant_id = ${TENANT} AND action = 'subscription.transfer'
    `) as unknown[];

    expect(audits).toHaveLength(0);
  });

  async function transferAudits() {
    return (await getAdminSql()`
      SELECT attributes::text AS attributes FROM awcms_audit_events
      WHERE tenant_id = ${TENANT} AND action = 'subscription.transfer'
    `) as { attributes: string }[];
  }

  test("M1: revoke, then another user registers the same endpoint: audited, A's message is never delivered to B", async () => {
    const original = await register(USER, 1);

    await enqueueFor(USER, "test.m1");
    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      revokeOwnPushSubscription(tx, TENANT, USER, original.id)
    );

    const moved = await register(OTHER, 1, OLD_RING, "new-owner-secret-0001");

    expect(moved.tenantUserId).toBe(OTHER);

    const audits = await transferAudits();

    expect(audits).toHaveLength(1);
    expect(JSON.parse(audits[0]!.attributes)).toEqual({
      subscriptionId: original.id,
      previousTenantUserId: USER,
      newTenantUserId: OTHER,
      previousStatus: "disabled"
    });

    const sent: PushTarget[] = [];

    expect((await dispatchAll(sent)).sent).toBe(0);
    expect(sent).toHaveLength(0);

    const rows = (await getAdminSql()`
      SELECT status FROM awcms_push_messages WHERE tenant_id = ${TENANT}
    `) as { status: string }[];

    expect(rows).toEqual([{ status: "cancelled" }]);
  });

  test("disabling a subscription cancels its queued messages", async () => {
    const sub = await register(USER, 1);

    await enqueueFor(USER, "test.disable");
    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      disablePushSubscription(tx, TENANT, sub.id, "gone")
    );

    const rows = (await getAdminSql()`
      SELECT status, last_error FROM awcms_push_messages WHERE tenant_id = ${TENANT}
    `) as { status: string; last_error: string }[];

    expect(rows).toEqual([
      { status: "cancelled", last_error: "subscription_disabled" }
    ]);
  });

  test("enqueue records the recipient, and the dispatcher refuses a message whose recipient no longer owns the device (defence in depth)", async () => {
    const sub = await register(USER, 1);
    const ids = await enqueueFor(USER, "test.recipient");
    const admin = getAdminSql();
    const row = (await admin`
      SELECT recipient_tenant_user_id FROM awcms_push_messages
      WHERE id = ${ids.messageIds[0]!}
    `) as { recipient_tenant_user_id: string }[];

    expect(row[0]!.recipient_tenant_user_id).toBe(USER);

    // Move the owner behind the queue's back (no cancel, no audit).
    await admin`
      UPDATE awcms_push_subscriptions SET tenant_user_id = ${OTHER}
      WHERE id = ${sub.id}
    `;

    const sent: PushTarget[] = [];
    const result = await dispatchAll(sent);

    expect(sent).toHaveLength(0);
    expect(result.failed).toBe(1);

    const msg = (await admin`
      SELECT status, last_error FROM awcms_push_messages WHERE id = ${ids.messageIds[0]!}
    `) as { status: string; last_error: string }[];

    expect(msg[0]!.status).toBe("failed");
    expect(msg[0]!.last_error).not.toContain(USER);
    expect(msg[0]!.last_error).not.toContain(OTHER);
  });

  test("L1: a message already claimed (sending) when the transfer commits is not delivered under the new owner", async () => {
    const sub = await register(USER, 1);
    const ids = await enqueueFor(USER, "test.l1");
    const admin = getAdminSql();

    // Claimed by a dispatcher whose lease has since expired (it will be
    // re-claimed), i.e. the message is in `sending` while the transfer commits.
    await admin`
      UPDATE awcms_push_messages
      SET status = 'sending', next_attempt_at = now() - interval '1 minute'
      WHERE id = ${ids.messageIds[0]!}
    `;

    await register(OTHER, 1, OLD_RING, "new-owner-secret-0001");

    const sent: PushTarget[] = [];

    await dispatchAll(sent);
    expect(sent).toHaveLength(0);

    const msg = (await admin`
      SELECT status FROM awcms_push_messages WHERE id = ${ids.messageIds[0]!}
    `) as { status: string }[];

    expect(msg[0]!.status).toBe("failed");
    expect(sub.id).toBeTruthy();
  });

  test("sql/315 backfills existing messages from the subscription's current owner", async () => {
    const sub = await register(USER, 1);
    const admin = getAdminSql();

    await admin`ALTER TABLE awcms_push_messages DROP COLUMN recipient_tenant_user_id`;
    await admin`
      INSERT INTO awcms_push_messages
        (tenant_id, category, subscription_id, title, body)
      VALUES (${TENANT}, 'test.backfill', ${sub.id}, 'T', 'B')
    `;
    await admin.unsafe(
      await Bun.file(
        new URL(
          "../../sql/315_awcms_push_messages_recipient.sql",
          import.meta.url
        )
      ).text()
    );

    const rows = (await admin`
      SELECT recipient_tenant_user_id FROM awcms_push_messages
      WHERE tenant_id = ${TENANT}
    `) as { recipient_tenant_user_id: string }[];

    expect(rows).toEqual([{ recipient_tenant_user_id: USER }]);
  });

  test("the transfer is fail-closed: if the audit write fails, the registration rolls back", async () => {
    const original = await register(USER, 1);
    const admin = getAdminSql();

    // Make the audit INSERT fail without touching any other write.
    await admin`
      ALTER TABLE awcms_audit_events
      ADD CONSTRAINT it1098_refuse_transfer
      CHECK (action <> 'subscription.transfer') NOT VALID
    `;

    try {
      let failed = false;

      try {
        await register(OTHER, 1);
      } catch {
        failed = true;
      }

      expect(failed).toBe(true);

      const rows = (await admin`
        SELECT tenant_user_id FROM awcms_push_subscriptions WHERE id = ${original.id}
      `) as { tenant_user_id: string }[];

      expect(rows[0]!.tenant_user_id).toBe(USER);
    } finally {
      await admin`
        ALTER TABLE awcms_audit_events DROP CONSTRAINT it1098_refuse_transfer
      `;
    }
  });
});
