/**
 * What `/admin/email-senders` decides for a caller, against a real PostgreSQL
 * and the real `loadAdminScreen` chokepoint (Issue #1162, ADR-0151 sections 2,
 * 6 and 7).
 *
 * The screen's decisions are an application function
 * (`resolveEmailSendersScreen`), so a database can answer what a source-text
 * test cannot:
 *
 *   * TENANT isolation: a person of tenant B sees none of tenant A's Mailketing
 *     accounts, senders, health or queue, and a tenant-A person sees none of B's;
 *   * BRAND isolation: a caller confined to brand X sees brand X's sender and not
 *     brand Y's, gets no deployment lane, and may not make a tenant-wide sender
 *     the default;
 *   * a sender assigned to somebody else (an account assignment) is invisible;
 *   * stale and unknown are told apart and neither is "verified"; a balance below
 *     the floor is insufficient and holds every sender of that account;
 *   * "make default" is offered only to a caller who holds
 *     `sender_policy.configure`, for a connected sender that may send now;
 *   * the rendered data never carries a token, a secret reference or a whole
 *     address (a canary token is stored through the real secret store);
 *   * a channel registry switched off reads as such, not as "no senders".
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
import { randomBytes } from "node:crypto";

import {
  ensureHandlerDatabaseReady,
  getHandlerAdminSql,
  getHandlerDatabaseClient,
  integrationEnabled,
  invoke,
  resetHandlerDatabase,
  teardownHandlerDatabase
} from "./harness";
import { hashSessionToken } from "../../src/lib/auth/session-token";
import { loadAdminScreen } from "../../src/lib/auth/admin-screen";
import type { SsrContext } from "../../src/lib/auth/ssr-session";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { createKeyRingSecretStore } from "../../src/modules/channel-accounts/application/secret-store";
import { resolveChannelSecretsRing } from "../../src/modules/channel-accounts/domain/channel-accounts-config";
import { PROVIDER_MATRIX_VERSION } from "../../src/modules/channel-accounts/domain/provider-matrix";
import { grantRolePolicy } from "../../src/modules/identity-access/application/access-policy-writer";
import {
  loadMailketingHealth,
  resolveEmailSendersScreen,
  type EmailSendersScreen
} from "../../src/modules/email/application/email-senders-screen";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";

const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";
const RING_KEY = Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 11 + 9) % 251)
).toString("base64");
const RING = `k1:${RING_KEY}`;
const UNUSABLE_LOGIN_MARKER = "fixture-no-login";

const READ = "email.senders.read";
const POLICY = "email.sender_policy.configure";
const CANARY_TOKEN = "CANARY-MAILKETING-TOKEN-1162";

const ENV = {
  EMAIL_SENDER_ROUTING_ENABLED: "true",
  EMAIL_MAILKETING_CREDIT_FLOOR: "100",
  EMAIL_SENDER_HEALTH_MAX_AGE_MINUTES: "360"
} as unknown as NodeJS.ProcessEnv;

type Env = {
  tenantId: string;
  ownerSessionHash: string;
  ownerTenantUserId: string;
};

let env: Env;
let userCounter = 0;
let accountCounter = 0;
let handlerReady = false;
const savedEnv: Record<string, string | undefined> = {};
const admin = () => getHandlerAdminSql();

async function insertSession(
  tenantId: string,
  identityId: string
): Promise<string> {
  const opaque = `sess-${randomBytes(18).toString("hex")}`;
  const stored = hashSessionToken(opaque);

  await admin()`
    INSERT INTO awcms_sessions
      (tenant_id, identity_id, token_hash, expires_at, assurance_level,
       last_authenticated_at)
    VALUES (${tenantId}, ${identityId}, ${stored},
            now() + interval '8 hours', 'aal1', now())
  `;

  return stored;
}

async function bootstrap(): Promise<Env> {
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "Senders Co",
      tenantCode: "snd-co",
      officeCode: "hq",
      officeName: "HQ",
      ownerLoginIdentifier: "snd-owner@example.com",
      ownerPassword: OWNER_PASSWORD,
      ownerDisplayName: "Owner"
    }
  });

  expect(setup.status).toBe(200);

  const tenantId = setup.body.data.tenantId;
  const owner = (await admin()`
    SELECT tu.id, tu.identity_id FROM awcms_tenant_users tu
    WHERE tu.tenant_id = ${tenantId} LIMIT 1
  `) as { id: string; identity_id: string }[];

  return {
    tenantId,
    ownerSessionHash: await insertSession(tenantId, owner[0]!.identity_id),
    ownerTenantUserId: owner[0]!.id
  };
}

async function seedUser(
  tenantId: string,
  label: string,
  permissionKeys: readonly string[]
): Promise<{ sessionHash: string; tenantUserId: string }> {
  userCounter += 1;
  const sql = admin();
  const tag = `${label}-${userCounter}`;
  const profile = (await sql`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`User ${tag}`}) RETURNING id
  `) as { id: string }[];
  const identity = (await sql`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${tag}@example.com`}, ${UNUSABLE_LOGIN_MARKER})
    RETURNING id
  `) as { id: string }[];
  const tenantUser = (await sql`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id}) RETURNING id
  `) as { id: string }[];
  const sessionHash = await insertSession(tenantId, identity[0]!.id);
  const role = (await sql`
    INSERT INTO awcms_roles (tenant_id, role_code, role_name)
    VALUES (${tenantId}, ${`role-${tag}`}, ${`Role ${tag}`}) RETURNING id
  `) as { id: string }[];

  for (const key of permissionKeys) {
    const [moduleKey, activityCode, action] = key.split(".");
    const permission = (await sql`
      SELECT id FROM awcms_permissions
      WHERE module_key = ${moduleKey!} AND activity_code = ${activityCode!}
        AND action = ${action!}
    `) as { id: string }[];

    if (!permission[0])
      throw new Error(`fixture: ${key} is not in the catalogue`);

    await sql`
      INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
      VALUES (${tenantId}, ${role[0]!.id}, ${permission[0].id})
    `;
  }

  await withTenantOrThrow(getHandlerDatabaseClient(), tenantId, (tx) =>
    grantRolePolicy(tx, tenantId, {
      tenantUserId: tenantUser[0]!.id,
      roleId: role[0]!.id,
      grantedByTenantUserId: null,
      reason: "email senders screen fixture"
    })
  );

  return { sessionHash, tenantUserId: tenantUser[0]!.id };
}

async function seedOffice(tenantId: string, code: string): Promise<string> {
  const rows = (await admin()`
    INSERT INTO awcms_offices (tenant_id, office_code, office_name)
    VALUES (${tenantId}, ${code}, ${`Office ${code}`}) RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

async function holdScope(
  tenantId: string,
  tenantUserId: string,
  officeId: string,
  grantedBy: string
) {
  await admin()`
    INSERT INTO awcms_business_scope_assignments
      (tenant_id, tenant_user_id, scope_type, scope_id, granted_by_tenant_user_id)
    VALUES (${tenantId}, ${tenantUserId}, 'office', ${officeId}, ${grantedBy})
  `;
}

async function health(
  tenantId: string,
  accountId: string,
  state: string,
  options: {
    reason?: string | null;
    quota?: number | null;
    ageMinutes?: number;
  } = {}
): Promise<void> {
  const checkedAt = new Date(Date.now() - (options.ageMinutes ?? 1) * 60_000);

  await admin()`
    INSERT INTO awcms_channel_account_health
      (tenant_id, account_id, state, reason_code, checked_at, quota_remaining)
    VALUES (${tenantId}, ${accountId}, ${state}, ${options.reason ?? null},
            ${checkedAt}, ${options.quota ?? null})
    ON CONFLICT (tenant_id, account_id) DO UPDATE
    SET state = EXCLUDED.state, reason_code = EXCLUDED.reason_code,
        checked_at = EXCLUDED.checked_at,
        quota_remaining = EXCLUDED.quota_remaining
  `;
}

async function seedEsp(
  tenantId: string,
  options: { name?: string; quota?: number | null; withSecret?: boolean } = {}
): Promise<string> {
  accountCounter += 1;
  const ring = resolveChannelSecretsRing({
    CHANNEL_SECRETS_ENCRYPTION_KEYS: RING
  } as unknown as NodeJS.ProcessEnv);

  if (!ring.ok) throw new Error(ring.reason);

  const store = createKeyRingSecretStore(() => ring);
  const ref = options.withSecret
    ? await withTenantOrThrow(getHandlerDatabaseClient(), tenantId, (tx) =>
        store.put(tx, {
          tenantId,
          purpose: "api_token",
          plaintext: CANARY_TOKEN,
          createdBy: null
        })
      )
    : null;
  const rows = (await admin()`
    INSERT INTO awcms_channel_accounts
      (tenant_id, provider, account_kind, external_id, display_name, auth_mode,
       status, secret_id)
    VALUES (${tenantId}, 'mailketing', 'esp_account', ${`mk-login-${accountCounter}`},
            ${options.name ?? `Mailketing ${accountCounter}`}, 'api_token',
            'connected', ${ref?.secretId ?? null})
    RETURNING id
  `) as { id: string }[];

  await health(tenantId, rows[0]!.id, "ok", {
    quota: options.quota === undefined ? 1000 : options.quota
  });

  return rows[0]!.id;
}

async function seedSender(
  tenantId: string,
  parentId: string,
  options: {
    address?: string;
    name?: string;
    officeId?: string | null;
    status?: string;
    healthState?: string | null;
    reason?: string | null;
    ageMinutes?: number;
  } = {}
): Promise<string> {
  accountCounter += 1;
  const address =
    options.address ?? `news${accountCounter}@brand${accountCounter}.example`;
  const rows = (await admin()`
    INSERT INTO awcms_channel_accounts
      (tenant_id, business_scope_type, business_scope_id, provider, account_kind,
       external_id, display_name, auth_mode, status, parent_account_id)
    VALUES (${tenantId}, ${options.officeId ? "office" : null},
            ${options.officeId ?? null}, 'mailketing', 'sender_identity',
            ${address}, ${options.name ?? `Sender ${accountCounter}`},
            'api_token', ${options.status ?? "connected"}, ${parentId})
    RETURNING id
  `) as { id: string }[];
  const id = rows[0]!.id;

  for (const capability of ["dm", "broadcast"]) {
    await admin()`
      INSERT INTO awcms_channel_account_capabilities
        (tenant_id, account_id, capability, state, evidence_kind, evidence_ref,
         matrix_version, verified_at)
      VALUES (${tenantId}, ${id}, ${capability}, 'granted',
              'written_authorization', 'evidence-1', ${PROVIDER_MATRIX_VERSION}, now())
    `;
  }

  if (options.healthState !== null) {
    await health(tenantId, id, options.healthState ?? "ok", {
      reason: options.reason ?? null,
      ageMinutes: options.ageMinutes
    });
  }

  return id;
}

async function assign(
  tenantId: string,
  accountId: string,
  tenantUserId: string,
  createdBy: string,
  kind: "operator" | "viewer" = "operator"
) {
  await admin()`
    INSERT INTO awcms_channel_account_assignments
      (tenant_id, account_id, tenant_user_id, kind, created_by)
    VALUES (${tenantId}, ${accountId}, ${tenantUserId}, ${kind}, ${createdBy})
  `;
}

async function seedMessage(
  tenantId: string,
  options: { senderId: string | null; status: string }
): Promise<void> {
  accountCounter += 1;
  // The snapshot must be the account's own address (a database guard).
  const own =
    options.senderId === null
      ? []
      : ((await admin()`
          SELECT external_id FROM awcms_channel_accounts
          WHERE tenant_id = ${tenantId} AND id = ${options.senderId}
        `) as { external_id: string }[]);
  const address = own[0]?.external_id ?? null;

  await admin()`
    INSERT INTO awcms_email_messages
      (tenant_id, category, status, to_address, to_address_hash,
       to_address_masked, subject, sender_account_id, sender_selection,
       sender_address, sent_at)
    VALUES (${tenantId}, 'system.announcement', ${options.status},
            ${`to${accountCounter}@recipient.test`}, ${`hash-${accountCounter}`},
            't•••@recipient.test', 'Subject', ${options.senderId},
            ${options.senderId === null ? "deployment" : "explicit"}, ${address},
            ${options.status === "sent" ? new Date() : null})
  `;
}

async function otherTenant(code: string): Promise<string> {
  const id = crypto.randomUUID();

  await admin()`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${id}, ${code}, ${code})
  `;

  return id;
}

/** Runs the screen the way `email-senders.astro` does: the real chokepoint, one transaction. */
async function screenFor(
  sessionHash: string,
  tenantId: string,
  runEnv: NodeJS.ProcessEnv = ENV
): Promise<EmailSendersScreen | "denied" | "error"> {
  const outcome = await loadAdminScreen({
    ssr: { tenantId, tokenHash: sessionHash } as unknown as SsrContext,
    sql: getHandlerDatabaseClient(),
    workClass: "interactive",
    authorize: { moduleKey: "email", activityCode: "senders", action: "read" },
    load: async ({ tx, auth, can }) =>
      resolveEmailSendersScreen(
        {
          tx,
          tenantId,
          tokenHash: sessionHash,
          auth,
          now: new Date(),
          request: new Request("http://localhost/admin/email-senders"),
          clientAddress: "127.0.0.1"
        },
        (guard) => can({ ...guard }),
        { env: runEnv }
      ),
    onError: () => {}
  });

  return outcome.state === "allowed" ? outcome.data : outcome.state;
}

const ready = (value: Awaited<ReturnType<typeof screenFor>>) => {
  if (value === "denied" || value === "error") {
    throw new Error(`screen was ${value}`);
  }

  return value;
};

const suite = integrationEnabled ? describe : describe.skip;

suite("email senders screen decisions (Issue #1162)", () => {
  beforeAll(async () => {
    for (const name of [
      "CHANNEL_ACCOUNTS_ENABLED",
      "CHANNEL_SECRETS_ENCRYPTION_KEYS"
    ]) {
      savedEnv[name] = process.env[name];
    }

    process.env.CHANNEL_ACCOUNTS_ENABLED = "true";
    process.env.CHANNEL_SECRETS_ENCRYPTION_KEYS = RING;
    handlerReady = await ensureHandlerDatabaseReady();
  });

  afterAll(async () => {
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }

    await teardownHandlerDatabase();
  });

  beforeEach(async () => {
    if (!handlerReady) return;
    process.env.CHANNEL_ACCOUNTS_ENABLED = "true";
    process.env.CHANNEL_SECRETS_ENCRYPTION_KEYS = RING;
    await resetHandlerDatabase();
    env = await bootstrap();
  });

  test("a person of another tenant sees none of this tenant's accounts, senders, health or queue", async () => {
    if (!handlerReady) return;

    const esp = await seedEsp(env.tenantId, { name: "Tenant A login" });
    await seedSender(env.tenantId, esp, { name: "Tenant A sender" });

    const tenant2 = await otherTenant("snd-two");
    const foreign = await seedUser(tenant2, "foreign", [READ]);
    const espB = await seedEsp(tenant2, { name: "Tenant B login" });

    await seedSender(tenant2, espB, { name: "Tenant B sender" });

    const mine = ready(await screenFor(env.ownerSessionHash, env.tenantId));
    const theirs = ready(await screenFor(foreign.sessionHash, tenant2));

    expect(mine.accounts.map((a) => a.displayName)).toEqual(["Tenant A login"]);
    expect(mine.senders.map((s) => s.displayName)).toEqual(["Tenant A sender"]);
    expect(theirs.accounts.map((a) => a.displayName)).toEqual([
      "Tenant B login"
    ]);
    expect(theirs.senders.map((s) => s.displayName)).toEqual([
      "Tenant B sender"
    ]);
    expect(JSON.stringify(theirs)).not.toContain("Tenant A");
    expect(JSON.stringify(mine)).not.toContain("Tenant B");
  });

  test("a caller confined to brand X sees brand X and not brand Y, and no deployment lane", async () => {
    if (!handlerReady) return;

    const brandX = await seedOffice(env.tenantId, "brand-x");
    const brandY = await seedOffice(env.tenantId, "brand-y");
    const esp = await seedEsp(env.tenantId);

    await seedSender(env.tenantId, esp, {
      name: "Brand X sender",
      officeId: brandX
    });
    await seedSender(env.tenantId, esp, {
      name: "Brand Y sender",
      officeId: brandY
    });

    const confined = await seedUser(env.tenantId, "brand-x", [READ]);

    await holdScope(
      env.tenantId,
      confined.tenantUserId,
      brandX,
      env.ownerTenantUserId
    );

    const screen = ready(await screenFor(confined.sessionHash, env.tenantId));
    const both = await seedUser(env.tenantId, "both-brands", [READ]);

    await holdScope(
      env.tenantId,
      both.tenantUserId,
      brandX,
      env.ownerTenantUserId
    );
    await holdScope(
      env.tenantId,
      both.tenantUserId,
      brandY,
      env.ownerTenantUserId
    );

    const everything = ready(await screenFor(both.sessionHash, env.tenantId));

    expect(screen.senders.map((s) => s.displayName)).toEqual([
      "Brand X sender"
    ]);
    expect(screen.confined).toBe(true);
    expect(screen.deploymentLane).toBeNull();
    expect(JSON.stringify(screen)).not.toContain("Brand Y");
    expect(everything.senders.map((s) => s.displayName).sort()).toEqual([
      "Brand X sender",
      "Brand Y sender"
    ]);
    // Still confined (to two brands), so still no deployment lane.
    expect(everything.confined).toBe(true);
  });

  test("a sender assigned to somebody else is invisible to a colleague", async () => {
    if (!handlerReady) return;

    const esp = await seedEsp(env.tenantId);
    const mine = await seedSender(env.tenantId, esp, {
      name: "Assigned sender"
    });
    const open = await seedSender(env.tenantId, esp, { name: "Open sender" });
    const colleague = await seedUser(env.tenantId, "colleague", [READ]);
    const assignee = await seedUser(env.tenantId, "assignee", [READ]);

    await assign(
      env.tenantId,
      mine,
      assignee.tenantUserId,
      env.ownerTenantUserId
    );

    const seen = ready(await screenFor(colleague.sessionHash, env.tenantId));

    expect(seen.senders.map((s) => s.id)).toEqual([open]);
  });

  test("the queue per sender is counted from this tenant's own messages, and the deployment lane is for an unconfined caller only", async () => {
    if (!handlerReady) return;

    const brandX = await seedOffice(env.tenantId, "brand-x");
    const esp = await seedEsp(env.tenantId);
    const sender = await seedSender(env.tenantId, esp, { name: "Queued" });
    const tenant2 = await otherTenant("snd-three");
    const espB = await seedEsp(tenant2);
    const senderB = await seedSender(tenant2, espB, { name: "Other tenant" });

    await seedMessage(env.tenantId, { senderId: sender, status: "queued" });
    await seedMessage(env.tenantId, { senderId: sender, status: "retry_wait" });
    await seedMessage(env.tenantId, { senderId: sender, status: "failed" });
    await seedMessage(env.tenantId, { senderId: sender, status: "sent" });
    await seedMessage(env.tenantId, { senderId: null, status: "queued" });
    // Another tenant's backlog must not appear in this tenant's counts.
    await seedMessage(tenant2, { senderId: senderB, status: "queued" });
    await seedMessage(tenant2, { senderId: senderB, status: "queued" });

    const confined = await seedUser(env.tenantId, "lane-confined", [READ]);

    await holdScope(
      env.tenantId,
      confined.tenantUserId,
      brandX,
      env.ownerTenantUserId
    );

    const owner = ready(await screenFor(env.ownerSessionHash, env.tenantId));
    const asConfined = ready(
      await screenFor(confined.sessionHash, env.tenantId)
    );

    expect(owner.senders[0]!.lane).toMatchObject({
      waiting: 2,
      sending: 0,
      failedLastDay: 1,
      sentLastHour: 1
    });
    expect(owner.deploymentLane).toMatchObject({ waiting: 1 });
    expect(owner.deploymentIsDefault).toBe(true);
    expect(asConfined.deploymentLane).toBeNull();
    expect(asConfined.deploymentIsDefault).toBeNull();
    expect(asConfined.senders[0]!.lane).toMatchObject({ waiting: 2 });
  });

  test("the credit of an account the caller may not see is not used, so its sender is held as `credit unknown`", async () => {
    if (!handlerReady) return;

    const esp = await seedEsp(env.tenantId, {
      name: "Hidden login",
      quota: 5000
    });
    const sender = await seedSender(env.tenantId, esp, {
      name: "Visible sender"
    });
    const assignee = await seedUser(env.tenantId, "esp-assignee", [READ]);
    const colleague = await seedUser(env.tenantId, "esp-colleague", [READ]);

    await assign(
      env.tenantId,
      esp,
      assignee.tenantUserId,
      env.ownerTenantUserId
    );

    const asColleague = ready(
      await screenFor(colleague.sessionHash, env.tenantId)
    );
    const asAssignee = ready(
      await screenFor(assignee.sessionHash, env.tenantId)
    );

    expect(asColleague.accounts).toEqual([]);
    expect(JSON.stringify(asColleague)).not.toContain("Hidden login");
    expect(asColleague.senders.find((s) => s.id === sender)).toMatchObject({
      parentAccountId: null,
      parentName: null,
      hold: "CREDIT_UNKNOWN",
      readyToSend: false
    });
    // The person the account is assigned to sees it and its credit.
    expect(asAssignee.accounts.map((a) => a.displayName)).toEqual([
      "Hidden login"
    ]);
    expect(asAssignee.senders.find((s) => s.id === sender)).toMatchObject({
      hold: null,
      readyToSend: true
    });
  });

  test("a viewer assignment may see a sender but not make it the default", async () => {
    if (!handlerReady) return;

    const esp = await seedEsp(env.tenantId);
    const viewerOnly = await seedSender(env.tenantId, esp, { name: "Viewer" });
    const operated = await seedSender(env.tenantId, esp, { name: "Operated" });
    const writer = await seedUser(env.tenantId, "writer", [READ, POLICY]);

    await assign(
      env.tenantId,
      viewerOnly,
      writer.tenantUserId,
      env.ownerTenantUserId,
      "viewer"
    );
    await assign(
      env.tenantId,
      operated,
      writer.tenantUserId,
      env.ownerTenantUserId,
      "operator"
    );

    const screen = ready(await screenFor(writer.sessionHash, env.tenantId));
    const withheld = Object.fromEntries(
      screen.senders.map((s) => [s.displayName, s.defaultWithheld])
    );

    expect(withheld).toEqual({ Viewer: "not_yours", Operated: null });
  });

  test("stale and unknown are told apart; neither is verified", async () => {
    if (!handlerReady) return;

    const esp = await seedEsp(env.tenantId);
    const fresh = await seedSender(env.tenantId, esp, { name: "Fresh" });
    const stale = await seedSender(env.tenantId, esp, {
      name: "Stale",
      ageMinutes: 400
    });
    const never = await seedSender(env.tenantId, esp, {
      name: "Never",
      healthState: null
    });
    const unverified = await seedSender(env.tenantId, esp, {
      name: "Unverified",
      healthState: "degraded",
      reason: "SENDER_UNVERIFIED"
    });
    const screen = ready(await screenFor(env.ownerSessionHash, env.tenantId));
    const byId = new Map(screen.senders.map((s) => [s.id, s]));

    expect(byId.get(fresh)).toMatchObject({
      verification: "verified",
      freshness: "fresh",
      hold: null,
      readyToSend: true
    });
    expect(byId.get(stale)).toMatchObject({
      verification: "stale",
      freshness: "stale",
      hold: "SENDER_VERIFICATION_STALE",
      readyToSend: false
    });
    expect(byId.get(never)).toMatchObject({
      verification: "unknown",
      freshness: "unknown",
      checkedAt: null,
      hold: "SENDER_VERIFICATION_UNKNOWN",
      readyToSend: false
    });
    expect(byId.get(unverified)).toMatchObject({
      verification: "unverified",
      hold: "SENDER_UNVERIFIED",
      readyToSend: false
    });
  });

  test("a balance below the floor is insufficient and holds every sender of the account; an old balance is stale", async () => {
    if (!handlerReady) return;

    const poor = await seedEsp(env.tenantId, { name: "Poor", quota: 5 });
    const old = await seedEsp(env.tenantId, { name: "Old", quota: 5000 });
    const unknown = await seedEsp(env.tenantId, {
      name: "Unknown",
      quota: null
    });

    await health(env.tenantId, old, "ok", { quota: 5000, ageMinutes: 500 });

    const poorSender = await seedSender(env.tenantId, poor);
    const screen = ready(await screenFor(env.ownerSessionHash, env.tenantId));
    const kinds = Object.fromEntries(
      screen.accounts.map((a) => [a.displayName, a.credit.kind])
    );

    expect(kinds).toEqual({
      Poor: "insufficient",
      Old: "stale",
      Unknown: "unknown"
    });
    expect(screen.senders.find((s) => s.id === poorSender)).toMatchObject({
      hold: "CREDIT_BELOW_THRESHOLD",
      readyToSend: false
    });
    expect(screen.creditFloor).toBe(100);
    expect(screen.freshnessWindowMinutes).toBe(360);
    // Tenant senders always use v2.
    expect(screen.accounts.every((a) => a.apiVersion === "v2")).toBe(true);
    expect(unknown).toBeTruthy();
  });

  test("disconnected, rejected and depleted accounts are named", async () => {
    if (!handlerReady) return;

    const revoked = await seedEsp(env.tenantId, { name: "Revoked" });
    const rejected = await seedEsp(env.tenantId, { name: "Rejected" });
    const depleted = await seedEsp(env.tenantId, { name: "Depleted" });

    await admin()`
      UPDATE awcms_channel_accounts SET status = 'revoked', revoked_at = now()
      WHERE id = ${revoked}
    `;
    await health(env.tenantId, rejected, "failing", {
      reason: "CREDENTIAL_REJECTED"
    });
    await health(env.tenantId, depleted, "degraded", {
      reason: "CREDIT_DEPLETED",
      quota: 0
    });

    const screen = ready(await screenFor(env.ownerSessionHash, env.tenantId));
    const byName = Object.fromEntries(
      screen.accounts.map((a) => [a.displayName, a.connection])
    );

    expect(byName).toEqual({
      Revoked: "disconnected",
      Rejected: "credential_rejected",
      Depleted: "credit_depleted"
    });
  });

  test("make default is offered only where the endpoint would accept it", async () => {
    if (!handlerReady) return;

    const brandX = await seedOffice(env.tenantId, "brand-x");
    const esp = await seedEsp(env.tenantId);
    const wide = await seedSender(env.tenantId, esp, { name: "Wide" });
    const scoped = await seedSender(env.tenantId, esp, {
      name: "Scoped",
      officeId: brandX
    });
    const pending = await seedSender(env.tenantId, esp, {
      name: "Pending",
      status: "pending"
    });
    const unverified = await seedSender(env.tenantId, esp, {
      name: "Unverified",
      healthState: "degraded",
      reason: "SENDER_UNVERIFIED"
    });
    const reader = await seedUser(env.tenantId, "reader", [READ]);
    const writer = await seedUser(env.tenantId, "writer", [READ, POLICY]);
    const confinedWriter = await seedUser(env.tenantId, "confined-writer", [
      READ,
      POLICY
    ]);

    await holdScope(
      env.tenantId,
      confinedWriter.tenantUserId,
      brandX,
      env.ownerTenantUserId
    );

    const withheld = (screen: EmailSendersScreen) =>
      Object.fromEntries(
        screen.senders.map((s) => [s.displayName, s.defaultWithheld])
      );
    const owner = ready(await screenFor(env.ownerSessionHash, env.tenantId));
    const asReader = ready(await screenFor(reader.sessionHash, env.tenantId));
    const asWriter = ready(await screenFor(writer.sessionHash, env.tenantId));
    const asConfined = ready(
      await screenFor(confinedWriter.sessionHash, env.tenantId)
    );

    // A caller who holds no brand scope does not cover brand X's account: it is
    // not shown (fail closed), and the tenant-wide ones are decidable.
    expect(withheld(owner)).toEqual({
      Wide: null,
      Pending: "not_connected",
      Unverified: "not_ready"
    });
    expect(withheld(asWriter)).toEqual(withheld(owner));
    // A reader sees everything and can change nothing.
    expect(asReader.canConfigurePolicy).toBe(false);
    expect(
      Object.values(withheld(asReader)).every((v) => v === "not_permitted")
    ).toBe(true);
    // A caller confined to brand X may make brand X's sender the default, and
    // not the tenant-wide one (that is the tenant-wide policy).
    expect(withheld(asConfined).Scoped).toBeNull();
    expect(withheld(asConfined).Wide).toBe("scope_not_held");
    expect(wide && scoped && pending && unverified).toBeTruthy();
  });

  test("with routing switched off the default cannot be changed, and the page can say so", async () => {
    if (!handlerReady) return;

    const esp = await seedEsp(env.tenantId);

    await seedSender(env.tenantId, esp);

    const off = {
      ...ENV,
      EMAIL_SENDER_ROUTING_ENABLED: "false"
    } as unknown as NodeJS.ProcessEnv;
    const screen = ready(
      await screenFor(env.ownerSessionHash, env.tenantId, off)
    );

    expect(screen.routingEnabled).toBe(false);
    expect(screen.senders[0]!.defaultWithheld).toBe("routing_disabled");
  });

  test("the default is read back from the policy, per scope", async () => {
    if (!handlerReady) return;

    const esp = await seedEsp(env.tenantId);
    const first = await seedSender(env.tenantId, esp, { name: "First" });
    const second = await seedSender(env.tenantId, esp, { name: "Second" });

    await admin()`
      INSERT INTO awcms_email_sender_policies
        (tenant_id, business_scope_type, business_scope_id,
         default_sender_account_id, changed_by)
      VALUES (${env.tenantId}, NULL, NULL, ${first}, ${env.ownerTenantUserId})
    `;

    const screen = ready(await screenFor(env.ownerSessionHash, env.tenantId));
    const defaults = Object.fromEntries(
      screen.senders.map((s) => [s.id, s.isDefault])
    );

    expect(defaults).toEqual({ [first]: true, [second]: false });
    expect(screen.deploymentIsDefault).toBe(false);
  });

  test("no token, secret reference or whole address reaches the screen data", async () => {
    if (!handlerReady) return;

    const esp = await seedEsp(env.tenantId, { withSecret: true });
    const sender = await seedSender(env.tenantId, esp, {
      address: "billing@private-brand.example"
    });
    const secretRows = (await admin()`
      SELECT id FROM awcms_channel_secrets WHERE tenant_id = ${env.tenantId}
    `) as { id: string }[];

    expect(secretRows.length).toBe(1);

    const screen = ready(await screenFor(env.ownerSessionHash, env.tenantId));
    const serialised = JSON.stringify(screen);

    expect(serialised).not.toContain(CANARY_TOKEN);
    expect(serialised).not.toContain(secretRows[0]!.id);
    expect(serialised).not.toContain("billing@private-brand.example");
    expect(serialised).not.toContain("mk-login-");
    expect(screen.senders.find((s) => s.id === sender)!.addressMasked).toBe(
      "b•••@private-brand.example"
    );
  });

  test("channel accounts switched off reads as such, not as no senders", async () => {
    if (!handlerReady) return;

    const esp = await seedEsp(env.tenantId);

    await seedSender(env.tenantId, esp);
    process.env.CHANNEL_ACCOUNTS_ENABLED = "false";

    const screen = ready(await screenFor(env.ownerSessionHash, env.tenantId));

    expect(screen.channelAccountsEnabled).toBe(false);
    expect(screen.unavailable).toBe(false);
    expect(screen.senders).toEqual([]);
  });

  test("a caller without email.senders.read is denied, not shown an empty page", async () => {
    if (!handlerReady) return;

    const nobody = await seedUser(env.tenantId, "nobody", []);

    expect(await screenFor(nobody.sessionHash, env.tenantId)).toBe("denied");
  });

  test("a parent login the caller cannot see does not show its state through the sender's reason (audit L-1)", async () => {
    if (!handlerReady) return;

    const esp = await seedEsp(env.tenantId);
    const sender = await seedSender(env.tenantId, esp, { name: "Open sender" });
    const colleague = await seedUser(env.tenantId, "colleague", [READ]);
    const assignee = await seedUser(env.tenantId, "assignee", [READ]);

    await assign(
      env.tenantId,
      esp,
      assignee.tenantUserId,
      env.ownerTenantUserId
    );

    const reasons: Array<string | null> = [];

    for (const status of [
      "connected",
      "revoked",
      "disabled",
      "degraded",
      "pending"
    ]) {
      await admin()`
        UPDATE awcms_channel_accounts SET status = ${status}
        WHERE tenant_id = ${env.tenantId} AND id = ${esp}
      `;

      const seen = ready(await screenFor(colleague.sessionHash, env.tenantId));
      const row = seen.senders.find((s) => s.id === sender)!;

      expect(seen.accounts).toEqual([]);
      reasons.push(row.unusableReason);
    }

    expect(reasons[0]).toBeNull();
    // Every parent state other than connected reads as the SAME code.
    expect(new Set(reasons.slice(1))).toEqual(new Set(["PARENT_UNAVAILABLE"]));
  });

  test("a tenant-wide default the caller cannot see is unknown, not 'the deployment sender' (audit L-2)", async () => {
    if (!handlerReady) return;

    const esp = await seedEsp(env.tenantId);
    const hidden = await seedSender(env.tenantId, esp, { name: "Hidden" });
    const colleague = await seedUser(env.tenantId, "colleague", [READ]);
    const assignee = await seedUser(env.tenantId, "assignee", [READ]);

    await assign(
      env.tenantId,
      hidden,
      assignee.tenantUserId,
      env.ownerTenantUserId
    );
    await admin()`
      INSERT INTO awcms_email_sender_policies
        (tenant_id, business_scope_type, business_scope_id,
         default_sender_account_id, changed_by)
      VALUES (${env.tenantId}, NULL, NULL, ${hidden}, ${env.ownerTenantUserId})
    `;

    const peer = ready(await screenFor(colleague.sessionHash, env.tenantId));
    const holder = ready(await screenFor(assignee.sessionHash, env.tenantId));

    expect(peer.confined).toBe(false);
    expect(peer.senders).toEqual([]);
    expect(peer.deploymentIsDefault).toBeNull();
    expect(holder.deploymentIsDefault).toBe(false);
  });

  test("health is loaded only for the accounts asked about, however many rows the tenant holds (audit L-3)", async () => {
    if (!handlerReady) return;

    const visible = await seedEsp(env.tenantId);
    const other = await seedEsp(env.tenantId);
    const facts = await withTenantOrThrow(
      getHandlerDatabaseClient(),
      env.tenantId,
      async (tx) => ({
        one: await loadMailketingHealth(tx, env.tenantId, [visible]),
        none: await loadMailketingHealth(tx, env.tenantId, []),
        both: await loadMailketingHealth(tx, env.tenantId, [visible, other])
      })
    );

    expect([...facts.one.keys()]).toEqual([visible]);
    expect(facts.none.size).toBe(0);
    expect(new Set(facts.both.keys())).toEqual(new Set([visible, other]));
  });

  test("more accounts than the screen loads are flagged as truncated, not silently dropped", async () => {
    if (!handlerReady) return;

    const esp = await seedEsp(env.tenantId);

    for (let i = 0; i < 101; i += 1) {
      await seedSender(env.tenantId, esp, { healthState: null });
    }

    const screen = ready(await screenFor(env.ownerSessionHash, env.tenantId));

    expect(screen.truncated).toBe(true);
    expect(screen.accounts.length + screen.senders.length).toBe(100);
  });
});
