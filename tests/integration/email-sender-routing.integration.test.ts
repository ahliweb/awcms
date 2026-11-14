/**
 * Tenant-scoped Mailketing accounts and verified sender routing on the ONE
 * email queue, against a real PostgreSQL (Issue #1160, ADR-0151 section 2):
 * enqueue as the runtime role, dispatch as `awcms_worker`, FORCE RLS in force,
 * two tenants x two Mailketing accounts x three verified sender addresses.
 *
 * Proves what a mock cannot:
 *
 *   * NULL is the deployment sender and stays exactly that (legacy env path);
 *   * each tenant sender is sent FROM its own snapshotted address with ITS OWN
 *     account's token and breaker, for ITS OWN tenant;
 *   * wrong-tenant / forged / unverified / security-mail senders are refused at
 *     enqueue AND at the database; the snapshot is immutable for every role;
 *   * revoked, disabled-account, stale, unknown and depleted-credit senders
 *     are failed or held at dispatch, never rerouted; cancelled rows never go;
 *   * per-account breaker, hourly cap, concurrent passes send each row once;
 *   * the policy is prospective and never deleted;
 *   * the verify job turns the provider's verdict into health, fail closed;
 *   * secret rotation, and the token never lands in a row.
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
  reassertRuntimeRoleLogins,
  rescopeChannelAccount,
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
import { recordAccountHealth } from "../../src/modules/channel-accounts/application/account-directory";
import {
  createChannelAccountPortAdapter,
  emailAccountDirectoryAdapter
} from "../../src/modules/channel-accounts/application/channel-account-port-adapter";
import { createChannelSenderCredentialAdapter } from "../../src/modules/channel-accounts/application/channel-sender-credential-adapter";
import { createKeyRingSecretStore } from "../../src/modules/channel-accounts/application/secret-store";
import { resolveChannelSecretsRing } from "../../src/modules/channel-accounts/domain/channel-accounts-config";
import { PROVIDER_MATRIX_VERSION } from "../../src/modules/channel-accounts/domain/provider-matrix";
import { enqueueAnnouncement } from "../../src/modules/email/application/announcement-directory";
import {
  dispatchEmailQueue,
  type BuildEmailSenderProviderInput,
  type DispatchEmailQueueOptions
} from "../../src/modules/email/application/email-dispatch";
import {
  resolveEnqueueEmailSender,
  setEmailSenderPolicy
} from "../../src/modules/email/application/email-sender-directory";
import {
  emailSendersVerifyRunFailed,
  verifyEmailSendersForTenant
} from "../../src/modules/email/application/email-sender-verify";
import type {
  EmailMessage,
  EmailProvider
} from "../../src/modules/email/domain/email-provider-contract";
import { emailSenderBreakerKey } from "../../src/modules/email/domain/email-sender";
import type { MailketingV2AccountProbe } from "../../src/modules/email/infrastructure/mailketing-v2-provider";

const TENANT_A = "c1160000-0000-4000-8000-00000000000a";
const TENANT_B = "c1160000-0000-4000-8000-00000000000b";
const SCOPE_X = { type: "brand", id: "d1160000-0000-4000-8000-0000000000a1" };

const SECRET_KEY = Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 13 + 5) % 251)
).toString("base64");
const ring = resolveChannelSecretsRing({
  CHANNEL_SECRETS_ENCRYPTION_KEYS: `k1:${SECRET_KEY}`
} as unknown as NodeJS.ProcessEnv);

if (!ring.ok) throw new Error(ring.reason);

const store = createKeyRingSecretStore(() => ring);
const CA_ENV = {
  CHANNEL_ACCOUNTS_ENABLED: "true"
} as unknown as NodeJS.ProcessEnv;
const ENV = {
  EMAIL_ENABLED: "true",
  EMAIL_PROVIDER: "log",
  EMAIL_FROM_ADDRESS: "noreply@deployment.test",
  EMAIL_FROM_NAME: "Deployment",
  EMAIL_SENDER_ROUTING_ENABLED: "true",
  EMAIL_MAILKETING_CREDIT_FLOOR: "10",
  EMAIL_SENDER_RATE_PER_HOUR: "1000"
} as unknown as NodeJS.ProcessEnv;

const senders = createChannelAccountPortAdapter({ env: CA_ENV });
const credentials = createChannelSenderCredentialAdapter({
  store,
  env: CA_ENV
});

const inTenant = <T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
) => withTenantOrThrow(getRuntimeSql(), tenantId, fn);

let seq = 0;
const next = () => (seq += 1);

type Fixture = {
  accounts: { id: string; token: string }[];
  senders: { id: string; address: string; espIndex: number }[];
  userId: string;
};

const fixtures = new Map<string, Fixture>();

async function seedTenant(id: string, code: string): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_tenants
      (id, tenant_code, tenant_name, legal_name, status, default_locale, default_theme)
    VALUES (${id}, ${code}, ${code}, ${code}, 'active', 'en', 'light')
  `;
  const actor = crypto.randomUUID();

  await getAdminSql()`
    INSERT INTO awcms_email_templates
      (tenant_id, template_key, name, subject_template, text_body_template,
       created_by, updated_by)
    VALUES (${id}, 'system.announcement', 'Announcement',
            ${{ en: "Hello" }}::jsonb, ${{ en: "Body {{userName}}" }}::jsonb,
            ${actor}, ${actor})
  `;
}

async function seedUser(tenantId: string): Promise<string> {
  const admin = getAdminSql();
  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', 'Recipient') RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`person-${next()}@recipient.test`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const user = (await admin`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id}) RETURNING id
  `) as { id: string }[];

  return user[0]!.id;
}

async function health(
  tenantId: string,
  accountId: string,
  state: string,
  quota: number | null = null,
  checkedAt = new Date()
): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_channel_account_health
      (tenant_id, account_id, state, checked_at, quota_remaining)
    VALUES (${tenantId}, ${accountId}, ${state}, ${checkedAt}, ${quota})
    ON CONFLICT (tenant_id, account_id) DO UPDATE
    SET state = EXCLUDED.state, checked_at = EXCLUDED.checked_at,
        quota_remaining = EXCLUDED.quota_remaining
  `;
}

/** Two Mailketing accounts (own tokens), three verified senders: two under the first, one (scoped to SCOPE_X) under the second. */
async function seedMailketing(tenantId: string, tag: string): Promise<Fixture> {
  const admin = getAdminSql();
  const accounts: Fixture["accounts"] = [];

  for (const index of [1, 2]) {
    const token = `CANARY-${tag}-acct${index}-tok`;
    const ref = await inTenant(tenantId, (tx) =>
      store.put(tx, {
        tenantId,
        purpose: "api_token",
        plaintext: token,
        createdBy: null
      })
    );
    const rows = (await admin`
      INSERT INTO awcms_channel_accounts
        (tenant_id, provider, account_kind, external_id, display_name,
         auth_mode, status, secret_id)
      VALUES (${tenantId}, 'mailketing', 'esp_account', ${`mk-${tag}-${index}`},
              ${`Account ${index}`}, 'api_token', 'connected', ${ref.secretId})
      RETURNING id
    `) as { id: string }[];

    accounts.push({ id: rows[0]!.id, token });
    await health(tenantId, rows[0]!.id, "ok", 1000);
  }

  const list: Fixture["senders"] = [];
  const specs = [
    { espIndex: 0, scope: null },
    { espIndex: 0, scope: null },
    { espIndex: 1, scope: SCOPE_X }
  ];

  for (const [i, spec] of specs.entries()) {
    const address = `news${i + 1}@${tag}.example`;
    const rows = (await admin`
      INSERT INTO awcms_channel_accounts
        (tenant_id, business_scope_type, business_scope_id, provider,
         account_kind, external_id, display_name, auth_mode, status,
         parent_account_id)
      VALUES (${tenantId}, ${spec.scope?.type ?? null}, ${spec.scope?.id ?? null},
              'mailketing', 'sender_identity', ${address}, ${`Brand ${i + 1}`},
              'api_token', 'connected', ${accounts[spec.espIndex]!.id})
      RETURNING id
    `) as { id: string }[];
    const id = rows[0]!.id;

    for (const capability of ["dm", "broadcast"]) {
      await admin`
        INSERT INTO awcms_channel_account_capabilities
          (tenant_id, account_id, capability, state, evidence_kind,
           evidence_ref, matrix_version, verified_at)
        VALUES (${tenantId}, ${id}, ${capability}, 'granted',
                'written_authorization', 'evidence-1', ${PROVIDER_MATRIX_VERSION}, now())
      `;
    }

    await health(tenantId, id, "ok");
    list.push({ id, address, espIndex: spec.espIndex });
  }

  return { accounts, senders: list, userId: await seedUser(tenantId) };
}

const fx = (tenantId: string) => fixtures.get(tenantId)!;

async function enqueue(
  tenantId: string,
  routing: { senderAccountId?: string | null; businessScope?: unknown } = {},
  env: NodeJS.ProcessEnv = ENV,
  templateKey = "system.announcement"
) {
  return inTenant(tenantId, async (tx) => {
    const decision = await resolveEnqueueEmailSender(tx, {
      tenantId,
      explicitSenderAccountId: routing.senderAccountId ?? null,
      businessScope: routing.businessScope ?? null,
      purpose: templateKey.startsWith("auth.") ? "security" : "transactional",
      senders: async () => senders,
      env
    });

    if (!decision.ok) return decision;

    await enqueueAnnouncement(
      tx,
      tenantId,
      "system.announcement",
      {},
      { type: "users", userIds: [fx(tenantId).userId] },
      `corr-${next()}`,
      "en",
      decision.snapshot
    );

    const rows = (await tx`
      SELECT id FROM awcms_email_messages
      WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT 1
    `) as { id: string }[];

    return { ok: true as const, id: rows[0]!.id, snapshot: decision.snapshot };
  });
}

async function row(id: string) {
  return (
    (await getAdminSql()`
      SELECT * FROM awcms_email_messages WHERE id = ${id}
    `) as Record<string, unknown>[]
  )[0]!;
}

type Sent = { token: string | null; breakerKey: string | null; from: string };

function harness() {
  const sent: Sent[] = [];
  const make = (
    input: BuildEmailSenderProviderInput | null
  ): EmailProvider => ({
    async send(message: EmailMessage) {
      sent.push({
        token: input?.apiToken ?? null,
        breakerKey: input?.breakerKey ?? null,
        from: message.from.address
      });

      return { ok: true, providerMessageId: `mk-${sent.length}` };
    },
    async healthCheck() {
      return { ok: true };
    }
  });
  const options = (
    over: Partial<DispatchEmailQueueOptions> = {}
  ): DispatchEmailQueueOptions => ({
    env: ENV,
    now: new Date(Date.now() + 1000),
    senders,
    credentials,
    resolveProvider: () => make(null),
    buildSenderProvider: (input) => make(input),
    ...over
  });

  return { sent, options };
}

async function requireWorker(): Promise<void> {
  await reassertRuntimeRoleLogins();

  if (!workerRoleActivated) {
    throw new Error(
      "awcms_worker is not provisioned: the worker-role assertions cannot run."
    );
  }
}

const dispatch = (
  tenantId: string,
  h: ReturnType<typeof harness>,
  over: Partial<DispatchEmailQueueOptions> = {}
) => dispatchEmailQueue(getWorkerRoleSql(), tenantId, h.options(over));

async function expectPgRejected(
  promise: Promise<unknown>,
  what: string,
  errno: string
): Promise<void> {
  try {
    const error = (await assertRejected(promise, what)) as Error & {
      errno?: unknown;
    };

    expect(String(error.errno), `${what}: ${error.message}`).toBe(errno);
  } finally {
    resetDatabaseCircuitBreakerForTests();
  }
}

const suite = integrationEnabled ? describe : describe.skip;

suite("email sender routing against PostgreSQL (Issue #1160)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    resetProviderCircuitBreakersForTests();
    await seedTenant(TENANT_A, "em1160-a");
    await seedTenant(TENANT_B, "em1160-b");
    fixtures.set(TENANT_A, await seedMailketing(TENANT_A, "tenant-a"));
    fixtures.set(TENANT_B, await seedMailketing(TENANT_B, "tenant-b"));
  });

  test("the deployment sender is unchanged: NULL sender, legacy env provider and from-address", async () => {
    await requireWorker();
    const queued = await enqueue(TENANT_A);

    expect(queued.ok).toBe(true);
    if (!queued.ok) return;

    const message = await row(queued.id);

    expect(message.sender_account_id).toBeNull();
    expect(message.sender_selection).toBe("deployment");
    expect(message.sender_address).toBeNull();
    expect(message.purpose).toBe("transactional");

    const h = harness();
    const result = await dispatch(TENANT_A, h);

    expect(result.sent).toBe(1);
    expect(result.senderLanes).toBe(0);
    expect(h.sent).toEqual([
      { token: null, breakerKey: null, from: "noreply@deployment.test" }
    ]);
  });

  test("2 tenants x 2 accounts x 3 senders: each row goes from its own address with its own account's token and breaker", async () => {
    await requireWorker();
    const expected: Sent[] = [];

    for (const tenantId of [TENANT_A, TENANT_B]) {
      for (const sender of fx(tenantId).senders) {
        const queued = await enqueue(tenantId, {
          senderAccountId: sender.id,
          businessScope: sender.espIndex === 1 ? SCOPE_X : null
        });

        expect(queued.ok).toBe(true);
        if (!queued.ok) continue;

        const message = await row(queued.id);

        expect(message.sender_account_id).toBe(sender.id);
        expect(message.sender_address).toBe(sender.address);
        expect(message.sender_selection).toBe("explicit");

        const account = fx(tenantId).accounts[sender.espIndex]!;

        expected.push({
          token: account.token,
          breakerKey: emailSenderBreakerKey(account.id),
          from: sender.address
        });
      }
    }

    const h = harness();

    for (const tenantId of [TENANT_A, TENANT_B]) {
      const result = await dispatch(
        TENANT_A === tenantId ? TENANT_A : TENANT_B,
        h
      );

      expect(result.sent).toBe(3);
      expect(result.senderLanes).toBe(3);
    }

    const sortKey = (s: Sent) => `${s.from}|${s.token}`;

    expect(
      [...h.sent].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
    ).toEqual(
      [...expected].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
    );

    // The token never lands in a row.
    const leaked = (await getAdminSql()`
      SELECT count(*)::int AS n FROM awcms_email_messages m
      WHERE m::text LIKE '%CANARY-%'
    `) as { n: number }[];
    const leakedAttempts = (await getAdminSql()`
      SELECT count(*)::int AS n FROM awcms_email_delivery_attempts a
      WHERE a::text LIKE '%CANARY-%'
    `) as { n: number }[];

    expect(leaked[0]!.n).toBe(0);
    expect(leakedAttempts[0]!.n).toBe(0);
  });

  test("another tenant's sender is the same refusal as an unknown one, and the database refuses it too", async () => {
    const foreign = fx(TENANT_B).senders[0]!;
    const refused = await enqueue(TENANT_A, { senderAccountId: foreign.id });
    const unknown = await enqueue(TENANT_A, {
      senderAccountId: crypto.randomUUID()
    });

    expect(refused).toMatchObject({ ok: false, reason: "SENDER_UNAVAILABLE" });
    expect(unknown).toMatchObject({ ok: false, reason: "SENDER_UNAVAILABLE" });

    await expectPgRejected(
      inTenant(
        TENANT_A,
        (tx) => tx`
          INSERT INTO awcms_email_messages
            (tenant_id, category, template_key, to_address, to_address_hash,
             to_address_masked, subject, sender_account_id, sender_selection,
             sender_address)
          VALUES (${TENANT_A}, 'system.announcement', 'system.announcement',
                  'x@y.test', 'h', 'x***', 's', ${foreign.id}, 'explicit',
                  ${foreign.address})
        `
      ),
      // The BEFORE INSERT guard refuses first (the composite FK is the second
      // line, for a caller that could disable triggers).
      "cross-tenant sender insert",
      "23514"
    );
  });

  test("a forged snapshot address, an unverified sender and a security message are refused by the database", async () => {
    const sender = fx(TENANT_A).senders[0]!;
    const insert = (
      address: string,
      accountId: string,
      purpose = "transactional"
    ) =>
      inTenant(
        TENANT_A,
        (tx) => tx`
          INSERT INTO awcms_email_messages
            (tenant_id, category, template_key, to_address, to_address_hash,
             to_address_masked, subject, sender_account_id, sender_selection,
             sender_address, purpose)
          VALUES (${TENANT_A}, 'system.announcement', 'system.announcement',
                  'x@y.test', 'h', 'x***', 's', ${accountId}, 'explicit',
                  ${address}, ${purpose})
        `
      );

    await expectPgRejected(
      insert("ceo@forged.example", sender.id),
      "forged address",
      "23514"
    );
    await expectPgRejected(
      insert(sender.address, sender.id, "security"),
      "security mail",
      "23514"
    );

    await getAdminSql()`UPDATE awcms_channel_accounts SET status = 'pending' WHERE id = ${sender.id}`;

    await expectPgRejected(
      insert(sender.address, sender.id),
      "unverified sender",
      "23514"
    );
    expect(
      await enqueue(TENANT_A, { senderAccountId: sender.id })
    ).toMatchObject({
      ok: false,
      reason: "SENDER_UNAVAILABLE"
    });
  });

  test("the sender snapshot is immutable for the runtime role and the worker", async () => {
    await requireWorker();
    const [first, second] = fx(TENANT_A).senders;
    const queued = await enqueue(TENANT_A, { senderAccountId: first!.id });

    if (!queued.ok) throw new Error("enqueue refused");

    await expectPgRejected(
      inTenant(
        TENANT_A,
        (tx) => tx`
          UPDATE awcms_email_messages SET sender_account_id = ${second!.id},
                 sender_address = ${second!.address}
          WHERE id = ${queued.id}
        `
      ),
      "runtime re-point",
      "23514"
    );
    await expectPgRejected(
      withTenantOrThrow(
        getWorkerRoleSql(),
        TENANT_A,
        (tx) => tx`
          UPDATE awcms_email_messages SET sender_account_id = NULL,
                 sender_selection = 'deployment', sender_address = NULL,
                 sender_name = NULL
          WHERE id = ${queued.id}
        `
      ),
      "worker re-point to the deployment sender",
      "23514"
    );
  });

  test("security mail never takes a tenant sender, and routing switched off refuses a named sender", async () => {
    const sender = fx(TENANT_A).senders[0]!;

    expect(
      await enqueue(
        TENANT_A,
        { senderAccountId: sender.id },
        ENV,
        "auth.password_reset"
      )
    ).toMatchObject({ ok: false, reason: "SENDER_UNAVAILABLE" });

    const off = {
      ...ENV,
      EMAIL_SENDER_ROUTING_ENABLED: "false"
    } as NodeJS.ProcessEnv;

    expect(
      await enqueue(TENANT_A, { senderAccountId: sender.id }, off)
    ).toMatchObject({
      ok: false,
      reason: "SENDER_ROUTING_DISABLED"
    });
  });

  test("routing off at dispatch: tenant-sender rows are not claimed, nothing is rerouted", async () => {
    await requireWorker();
    const queued = await enqueue(TENANT_A, {
      senderAccountId: fx(TENANT_A).senders[0]!.id
    });

    if (!queued.ok) throw new Error("enqueue refused");

    const h = harness();
    const result = await dispatch(TENANT_A, h, {
      env: {
        ...ENV,
        EMAIL_SENDER_ROUTING_ENABLED: "false"
      } as NodeJS.ProcessEnv
    });

    expect(result.claimed).toBe(0);
    expect(h.sent).toEqual([]);
    expect((await row(queued.id)).status).toBe("queued");
  });

  test("revoked after enqueue: terminal failure, provider never called, no other sender used", async () => {
    await requireWorker();
    const sender = fx(TENANT_A).senders[0]!;
    const queued = await enqueue(TENANT_A, { senderAccountId: sender.id });

    if (!queued.ok) throw new Error("enqueue refused");

    await getAdminSql()`
      UPDATE awcms_channel_accounts SET status = 'revoked', revoked_at = now()
      WHERE id = ${sender.id}
    `;

    const h = harness();
    const result = await dispatch(TENANT_A, h);
    const message = await row(queued.id);

    expect(result.failed).toBe(1);
    expect(h.sent).toEqual([]);
    expect(message.status).toBe("failed");
    expect(String(message.last_error)).toContain("SENDER_UNAVAILABLE");
    expect(message.sender_account_id).toBe(sender.id);
  });

  test("a disabled Mailketing account stops all its senders (terminal), the other account still sends", async () => {
    await requireWorker();
    const [s1, , s3] = fx(TENANT_A).senders;
    const a = await enqueue(TENANT_A, { senderAccountId: s1!.id });
    const b = await enqueue(TENANT_A, {
      senderAccountId: s3!.id,
      businessScope: SCOPE_X
    });

    if (!a.ok || !b.ok) throw new Error("enqueue refused");

    await getAdminSql()`
      UPDATE awcms_channel_accounts SET status = 'disabled'
      WHERE id = ${fx(TENANT_A).accounts[0]!.id}
    `;

    const h = harness();
    const result = await dispatch(TENANT_A, h);

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
    expect(h.sent.map((s) => s.from)).toEqual([s3!.address]);
    expect((await row(a.id)).status).toBe("failed");
  });

  test("stale or unknown verification and credit below the floor HOLD the row (no send), then fail once the budget is spent", async () => {
    await requireWorker();
    const [s1, s2] = fx(TENANT_A).senders;
    const acct = fx(TENANT_A).accounts[0]!;
    const stale = await enqueue(TENANT_A, { senderAccountId: s1!.id });

    if (!stale.ok) throw new Error("enqueue refused");

    await health(
      TENANT_A,
      s1!.id,
      "ok",
      null,
      new Date(Date.now() - 48 * 3_600_000)
    );

    const h = harness();
    let result = await dispatch(TENANT_A, h);

    expect(result.senderHeld).toBe(1);
    expect(h.sent).toEqual([]);
    expect(String((await row(stale.id)).last_error)).toContain(
      "SENDER_VERIFICATION_STALE"
    );

    await health(TENANT_A, s1!.id, "ok");
    await health(TENANT_A, acct.id, "ok", 3);

    result = await dispatch(TENANT_A, h, {
      now: new Date(Date.now() + 10 * 60_000)
    });

    expect(result.senderHeld).toBe(1);
    expect(String((await row(stale.id)).last_error)).toContain(
      "CREDIT_BELOW_THRESHOLD"
    );

    await getAdminSql()`
      DELETE FROM awcms_channel_account_health WHERE account_id = ${s2!.id}
    `;
    await health(TENANT_A, acct.id, "ok", 1000);

    const unknown = await enqueue(TENANT_A, { senderAccountId: s2!.id });

    if (!unknown.ok) throw new Error("enqueue refused");

    result = await dispatch(TENANT_A, h, {
      now: new Date(Date.now() + 20 * 60_000)
    });

    // s1 now sends; s2 (no health row) is held, then over budget it fails.
    expect(result.sent).toBe(1);
    expect(result.senderHeld).toBe(1);
    expect(h.sent.map((s) => s.from)).toEqual([s1!.address]);
    expect((await row(unknown.id)).status).toBe("queued");

    result = await dispatch(TENANT_A, h, {
      now: new Date(Date.now() + 5 * 3_600_000)
    });

    expect(result.failed).toBe(1);
    expect(String((await row(unknown.id)).last_error)).toContain(
      "SENDER_HOLD_BUDGET_EXCEEDED"
    );
  });

  test("a cancelled message is never dispatched", async () => {
    await requireWorker();
    const queued = await enqueue(TENANT_A, {
      senderAccountId: fx(TENANT_A).senders[0]!.id
    });

    if (!queued.ok) throw new Error("enqueue refused");

    await getAdminSql()`
      UPDATE awcms_email_messages SET status = 'cancelled' WHERE id = ${queued.id}
    `;

    const h = harness();
    const result = await dispatch(TENANT_A, h);

    expect(result.claimed).toBe(0);
    expect(h.sent).toEqual([]);
  });

  test("an open breaker on one account skips only that account's lanes", async () => {
    await requireWorker();
    const [s1, , s3] = fx(TENANT_A).senders;

    await enqueue(TENANT_A, { senderAccountId: s1!.id });
    await enqueue(TENANT_A, {
      senderAccountId: s3!.id,
      businessScope: SCOPE_X
    });

    const breaker = getProviderCircuitBreaker(
      emailSenderBreakerKey(fx(TENANT_A).accounts[0]!.id)
    );

    for (let i = 0; i < 10; i += 1) breaker.recordFailure(new Date());

    const h = harness();
    const result = await dispatch(TENANT_A, h);

    expect(result.senderLanesSkipped).toBe(1);
    expect(h.sent.map((s) => s.from)).toEqual([s3!.address]);
    expect(result.breakerOpen).toBe(false);
  });

  test("the hourly cap and two concurrent passes: each row is sent at most once and never above the cap", async () => {
    await requireWorker();
    const sender = fx(TENANT_A).senders[0]!;

    for (let i = 0; i < 5; i += 1) {
      await enqueue(TENANT_A, { senderAccountId: sender.id });
    }

    const capped = {
      ...ENV,
      EMAIL_SENDER_RATE_PER_HOUR: "3"
    } as NodeJS.ProcessEnv;
    const h = harness();
    const [one, two] = await Promise.all([
      dispatch(TENANT_A, h, { env: capped }),
      dispatch(TENANT_A, h, { env: capped })
    ]);

    expect(one.sent + two.sent).toBe(3);
    expect(h.sent).toHaveLength(3);

    const statuses = (await getAdminSql()`
      SELECT status, count(*)::int AS n FROM awcms_email_messages
      WHERE tenant_id = ${TENANT_A} GROUP BY status
    `) as { status: string; n: number }[];

    expect(statuses.find((s) => s.status === "sent")?.n).toBe(3);
    expect(statuses.find((s) => s.status === "queued")?.n).toBe(2);
  });

  test("the default-sender policy is prospective, versioned, scope-bound and never deleted", async () => {
    const [s1, s2] = fx(TENANT_A).senders;
    const actor = fx(TENANT_A).userId;
    const set = (sender: string | null) =>
      inTenant(TENANT_A, (tx) =>
        setEmailSenderPolicy(
          tx,
          TENANT_A,
          actor,
          { businessScope: null, defaultSenderAccountId: sender },
          senders,
          ENV
        )
      );

    const first = await set(s1!.id);

    expect(first).toMatchObject({ outcome: "set", changed: true });

    const viaPolicy = await enqueue(TENANT_A);

    if (!viaPolicy.ok) throw new Error("enqueue refused");

    expect(await row(viaPolicy.id)).toMatchObject({
      sender_account_id: s1!.id,
      sender_selection: "policy",
      sender_policy_version: 1
    });

    expect(await set(s1!.id)).toMatchObject({ changed: false });
    expect(await set(s2!.id)).toMatchObject({
      changed: true,
      policy: { configVersion: 2 }
    });
    // The earlier row keeps its sender.
    expect((await row(viaPolicy.id)).sender_account_id).toBe(s1!.id);

    // A scoped sender cannot be the tenant-wide default; a foreign one is refused.
    expect(await set(fx(TENANT_A).senders[2]!.id)).toMatchObject({
      outcome: "refused",
      code: "SENDER_UNAVAILABLE"
    });
    expect(await set(fx(TENANT_B).senders[0]!.id)).toMatchObject({
      outcome: "refused",
      code: "SENDER_UNAVAILABLE"
    });

    await expectPgRejected(
      inTenant(TENANT_A, (tx) => tx`DELETE FROM awcms_email_sender_policies`),
      "policy delete",
      "23514"
    );
  });

  test("RLS is ENABLE + FORCE on the policy table, and the worker cannot read it or write health", async () => {
    await requireWorker();
    const rls = (await getAdminSql()`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relname = 'awcms_email_sender_policies'
    `) as { relrowsecurity: boolean; relforcerowsecurity: boolean }[];

    expect(rls[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });

    await expectPgRejected(
      withTenantOrThrow(
        getWorkerRoleSql(),
        TENANT_A,
        (tx) => tx`SELECT * FROM awcms_email_sender_policies`
      ),
      "worker reads policies",
      "42501"
    );
    await expectPgRejected(
      withTenantOrThrow(
        getWorkerRoleSql(),
        TENANT_A,
        (tx) => tx`UPDATE awcms_channel_account_health SET state = 'ok'`
      ),
      "worker writes health",
      "42501"
    );

    // The runtime role of tenant A sees none of tenant B's policies.
    await getAdminSql()`
      INSERT INTO awcms_email_sender_policies (tenant_id) VALUES (${TENANT_B})
    `;
    const seen = await inTenant(
      TENANT_A,
      (tx) => tx`SELECT id FROM awcms_email_sender_policies`
    );

    expect(seen).toHaveLength(0);
  });

  test("secret rotation: the next dispatch uses the new token, never the old", async () => {
    await requireWorker();
    const sender = fx(TENANT_A).senders[0]!;
    const account = fx(TENANT_A).accounts[0]!;
    const ref = await inTenant(TENANT_A, (tx) =>
      store.put(tx, {
        tenantId: TENANT_A,
        purpose: "api_token",
        plaintext: "CANARY-rotated-tok",
        createdBy: null
      })
    );

    await getAdminSql()`
      UPDATE awcms_channel_accounts SET secret_id = ${ref.secretId}
      WHERE id = ${account.id}
    `;
    await enqueue(TENANT_A, { senderAccountId: sender.id });

    const h = harness();

    await dispatch(TENANT_A, h);

    expect(h.sent.map((s) => s.token)).toEqual(["CANARY-rotated-tok"]);
  });

  test("the verify job turns the provider's verdict into health, fail closed", async () => {
    const [s1, s2, s3] = fx(TENANT_A).senders;

    await getAdminSql()`
      UPDATE awcms_channel_accounts SET status = 'pending'
      WHERE id IN (${s1!.id}, ${s2!.id})
    `;

    const tokens: string[] = [];
    const probe = (apiToken: string): MailketingV2AccountProbe => {
      tokens.push(apiToken);
      const first = apiToken === fx(TENANT_A).accounts[0]!.token;

      return {
        readCredits: async () =>
          first ? { ok: true, value: 500 } : { ok: false, failure: "auth" },
        listVerifiedSenders: async () =>
          first
            ? {
                ok: true,
                value: {
                  verified: new Set([s1!.address]),
                  ambiguous: new Set<string>()
                }
              }
            : { ok: false, failure: "auth" }
      };
    };
    const summary = await verifyEmailSendersForTenant(
      getRuntimeSql(),
      TENANT_A,
      {
        directory: emailAccountDirectoryAdapter,
        credentials,
        recordHealth: (tx, tenantId, accountId, input) =>
          recordAccountHealth(tx, tenantId, accountId, input),
        buildProbe: probe,
        env: { ...ENV, ...CA_ENV } as NodeJS.ProcessEnv
      }
    );

    expect(summary).toMatchObject({
      accounts: 2,
      accountsProbed: 2,
      sendersVerified: 1,
      sendersUnverified: 1,
      sendersUnknown: 1
    });
    expect(new Set(tokens)).toEqual(
      new Set(fx(TENANT_A).accounts.map((a) => a.token))
    );

    const status = async (id: string) =>
      (
        (await getAdminSql()`
          SELECT status FROM awcms_channel_accounts WHERE id = ${id}
        `) as { status: string }[]
      )[0]!.status;

    expect(await status(s1!.id)).toBe("connected");
    expect(await status(s2!.id)).toBe("pending");
    expect(await status(fx(TENANT_A).accounts[1]!.id)).toBe("degraded");

    const accountHealth = (await getAdminSql()`
      SELECT state, quota_remaining::int AS q FROM awcms_channel_account_health
      WHERE account_id = ${fx(TENANT_A).accounts[0]!.id}
    `) as { state: string; q: number }[];

    expect(accountHealth[0]).toEqual({ state: "ok", q: 500 });

    // s3 borrows from the rejected account: it can no longer send.
    expect(
      await enqueue(TENANT_A, {
        senderAccountId: s3!.id,
        businessScope: SCOPE_X
      })
    ).toMatchObject({ ok: false, reason: "SENDER_UNAVAILABLE" });
  });

  test("audit L-1 of PR #1301: an unavailable secret store is counted and fails the run, not just skipped", async () => {
    let probed = 0;
    const summary = await verifyEmailSendersForTenant(
      getRuntimeSql(),
      TENANT_A,
      {
        directory: emailAccountDirectoryAdapter,
        credentials: {
          ...credentials,
          resolveEmailAccountCredential: async () => ({
            ok: false,
            reason: "SECRET_STORE_UNAVAILABLE"
          })
        } as typeof credentials,
        recordHealth: (tx, tenantId, accountId, input) =>
          recordAccountHealth(tx, tenantId, accountId, input),
        buildProbe: () => {
          probed += 1;
          throw new Error("no probe may run without a token");
        },
        env: { ...ENV, ...CA_ENV } as NodeJS.ProcessEnv
      }
    );

    expect(probed).toBe(0);
    expect(summary.accounts).toBeGreaterThan(0);
    expect(summary.accountsProbed).toBe(0);
    expect(summary.secretStoreFailures).toBe(summary.accounts);
    expect(emailSendersVerifyRunFailed(summary, 0)).toBe(true);
  });

  describe("audit M2: a parent lends only to a child whose scope it contains", () => {
    const SCOPE_Y = {
      type: "brand",
      id: "d1160000-0000-4000-8000-0000000000b2"
    };

    /** A brand-Y sender registered (bypassing the route) under brand X's scoped account. */
    async function seedCrossScopeSender(): Promise<{
      id: string;
      address: string;
    }> {
      const address = "cross@brand-y.example";
      const rows = (await getAdminSql()`
        INSERT INTO awcms_channel_accounts
          (tenant_id, business_scope_type, business_scope_id, provider,
           account_kind, external_id, display_name, auth_mode, status,
           parent_account_id)
        VALUES (${TENANT_A}, ${SCOPE_Y.type}, ${SCOPE_Y.id}, 'mailketing',
                'sender_identity', ${address}, 'Brand Y', 'api_token',
                'connected', ${fx(TENANT_A).accounts[1]!.id})
        RETURNING id
      `) as { id: string }[];
      const id = rows[0]!.id;

      await rescopeChannelAccount(fx(TENANT_A).accounts[1]!.id, SCOPE_X);
      await getAdminSql()`
        INSERT INTO awcms_channel_account_capabilities
          (tenant_id, account_id, capability, state, evidence_kind,
           evidence_ref, matrix_version, verified_at)
        VALUES (${TENANT_A}, ${id}, 'dm', 'granted', 'written_authorization',
                'evidence-1', ${PROVIDER_MATRIX_VERSION}, now())
      `;
      await health(TENANT_A, id, "ok");

      return { id, address };
    }

    test("layer 2 (lending): the port and the credential refuse, even with the database guard switched off", async () => {
      await requireWorker();
      const cross = await seedCrossScopeSender();

      expect(
        await enqueue(TENANT_A, {
          senderAccountId: cross.id,
          businessScope: SCOPE_Y
        })
      ).toMatchObject({ ok: false, reason: "SENDER_UNAVAILABLE" });

      const credential = await inTenant(TENANT_A, (tx) =>
        credentials.resolveEmailCredential(tx, {
          tenantId: TENANT_A,
          accountId: cross.id
        })
      );

      expect(credential).toEqual({
        ok: false,
        reason: "CREDENTIAL_UNAVAILABLE"
      });

      // Mutation: with the trigger DISABLED a row can be queued; the lending
      // check alone still stops brand Y from spending brand X's token.
      await getAdminSql()`
        ALTER TABLE awcms_email_messages DISABLE TRIGGER awcms_email_messages_sender_guard
      `;

      try {
        await getAdminSql()`
          INSERT INTO awcms_email_messages
            (tenant_id, category, template_key, to_address, to_address_hash,
             to_address_masked, subject, sender_account_id, sender_selection,
             sender_address, business_scope_type, business_scope_id)
          VALUES (${TENANT_A}, 'system.announcement', 'system.announcement',
                  'x@y.test', 'h-cross', 'x***', 's', ${cross.id}, 'explicit',
                  ${cross.address}, ${SCOPE_Y.type}, ${SCOPE_Y.id})
        `;
      } finally {
        await getAdminSql()`
          ALTER TABLE awcms_email_messages ENABLE TRIGGER awcms_email_messages_sender_guard
        `;
      }

      const h = harness();

      await dispatch(TENANT_A, h);
      expect(h.sent).toEqual([]);
    });

    test("layer 3 (database): the guard refuses a brand-Y row borrowing brand X's account", async () => {
      const cross = await seedCrossScopeSender();

      await expectPgRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            INSERT INTO awcms_email_messages
              (tenant_id, category, template_key, to_address, to_address_hash,
               to_address_masked, subject, sender_account_id, sender_selection,
               sender_address, business_scope_type, business_scope_id)
            VALUES (${TENANT_A}, 'system.announcement', 'system.announcement',
                    'x@y.test', 'h', 'x***', 's', ${cross.id}, 'explicit',
                    ${cross.address}, ${SCOPE_Y.type}, ${SCOPE_Y.id})
          `
        ),
        "cross-scope borrow",
        "23514"
      );
    });

    test("createAccount refuses a child outside its parent's scope", async () => {
      await rescopeChannelAccount(fx(TENANT_A).accounts[1]!.id, SCOPE_X);

      const { createAccount } =
        await import("../../src/modules/channel-accounts/application/account-directory");
      const result = await inTenant(TENANT_A, (tx) =>
        createAccount(tx, TENANT_A, fx(TENANT_A).userId, {
          provider: "mailketing",
          accountKind: "sender_identity",
          externalId: "y2@brand-y.example",
          displayName: "Y",
          authMode: "api_token",
          connectionId: null,
          parentAccountId: fx(TENANT_A).accounts[1]!.id,
          businessScope: SCOPE_Y
        })
      );

      expect(result).toEqual({ outcome: "refused", code: "PARENT_INVALID" });
    });
  });

  test("audit M3/Info: the worker never sees a sender_identity's own token, and the credential port never uses one", async () => {
    await requireWorker();
    const sender = fx(TENANT_A).senders[0]!;
    const ref = await inTenant(TENANT_A, (tx) =>
      store.put(tx, {
        tenantId: TENANT_A,
        purpose: "api_token",
        plaintext: "CANARY-sender-own-tok",
        createdBy: null
      })
    );

    await getAdminSql()`
      UPDATE awcms_channel_accounts SET secret_id = ${ref.secretId}
      WHERE id = ${sender.id}
    `;

    const seen = (await withTenantOrThrow(
      getWorkerRoleSql(),
      TENANT_A,
      (tx) => tx`SELECT id FROM awcms_channel_secrets`
    )) as { id: string }[];

    expect(seen.map((row) => row.id)).not.toContain(ref.secretId);

    const credential = await inTenant(TENANT_A, (tx) =>
      credentials.resolveEmailCredential(tx, {
        tenantId: TENANT_A,
        accountId: sender.id
      })
    );

    expect(credential).toMatchObject({
      ok: true,
      credential: fx(TENANT_A).accounts[0]!.token
    });
  });
});
