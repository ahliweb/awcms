/**
 * `POST /api/v1/access/evaluate` agrees with the chokepoint about an enrolment
 * requirement (ADR-0141, audit F-6) — WORLD 2, because the real route handler
 * calls `getDatabaseClient()` itself.
 *
 * The endpoint says it reflects "what `evaluateAccess` would decide for the
 * CALLER'S OWN access", i.e. what the real guard would do. Before F-6 it
 * reported `allowed: true` for a flagged permission whose endpoint would answer
 * `403 MFA_ENROLMENT_REQUIRED` — a preview that lies in the direction that
 * costs an administrator an afternoon.
 *
 * The flag is declared on a fixture module pushed into the real module list
 * (production path, no seam). Its catalogue row is inserted into the handler
 * database and REMOVED in `afterAll`, since `awcms_permissions` is global state
 * other suites count.
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
  ensureHandlerDatabaseReady,
  getHandlerAdminSql,
  integrationEnabled,
  invoke,
  resetHandlerDatabase,
  teardownHandlerDatabase
} from "./harness";
import {
  generateSessionToken,
  hashSessionToken
} from "../../src/lib/auth/session-token";
import { linkIdentityToPrincipal } from "../../src/modules/identity-access/application/principal-store";
import { resetMfaRequiredPermissionCacheForTests } from "../../src/modules/identity-access/domain/mfa-required-permissions";
import { modules } from "../../src/modules/index";
import type { ModuleDescriptor } from "../../src/modules/_shared/module-contract";
import { POST as accessEvaluate } from "../../src/pages/api/v1/access/evaluate";

const suite = integrationEnabled ? describe : describe.skip;

const TENANT = "ce000000-0000-4000-8000-0000000000ce";
const MODULE = "mfa_evaluate_fixture";

const FIXTURE_MODULE = {
  key: MODULE,
  name: "MFA evaluate fixture",
  type: "domain",
  status: "active",
  permissions: [
    {
      activityCode: "payout",
      action: "approve",
      description: "flagged by descriptor",
      requiresMfaEnrolment: true
    },
    { activityCode: "note", action: "update", description: "not flagged" }
  ]
} as unknown as ModuleDescriptor;

let handlerReady = false;

async function seedHolder(
  label: string,
  enrolled: boolean
): Promise<{ token: string; tenantUserId: string }> {
  const admin = getHandlerAdminSql();
  const login = `${label}@example.test`;

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT}, 'person', ${label}) RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${TENANT}, ${profile[0]!.id}, ${login}, 'x') RETURNING id
  `) as { id: string }[];
  const tenantUser = (await admin`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${TENANT}, ${identity[0]!.id}) RETURNING id
  `) as { id: string }[];
  const principalId = await linkIdentityToPrincipal(
    admin,
    identity[0]!.id,
    login
  );

  const role = (await admin`
    INSERT INTO awcms_roles (tenant_id, role_code, role_name)
    VALUES (${TENANT}, ${`r-${label}`}, ${label}) RETURNING id
  `) as { id: string }[];

  for (const [activity, action] of [
    ["payout", "approve"],
    ["note", "update"]
  ]) {
    const permission = (await admin`
      SELECT id FROM awcms_permissions
      WHERE module_key = ${MODULE} AND activity_code = ${activity} AND action = ${action}
    `) as { id: string }[];

    await admin`
      INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
      VALUES (${TENANT}, ${role[0]!.id}, ${permission[0]!.id})
    `;
  }

  await admin`
    INSERT INTO awcms_access_policies
      (tenant_id, tenant_user_id, role_id, scope_type, scope_id,
       granted_by_tenant_user_id)
    VALUES (${TENANT}, ${tenantUser[0]!.id}, ${role[0]!.id}, 'tenant',
            ${TENANT}, ${tenantUser[0]!.id})
  `;

  if (enrolled) {
    await admin`
      INSERT INTO awcms_principal_mfa_factors
        (principal_id, factor_type, secret_ciphertext, status, last_used_step,
         activated_at)
      VALUES (${principalId}, 'totp', 'ciphertext-not-read', 'active', -1, now())
    `;
  }

  const token = generateSessionToken();

  await admin`
    INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
    VALUES (${TENANT}, ${identity[0]!.id}, ${hashSessionToken(token)},
            now() + interval '1 hour')
  `;

  return { token, tenantUserId: tenantUser[0]!.id };
}

async function evaluate(token: string, activityCode: string, action: string) {
  const res = await invoke<{
    data: { allowed: boolean; matchedPolicy?: string };
  }>(accessEvaluate, {
    method: "POST",
    path: "/api/v1/access/evaluate",
    headers: {
      authorization: `Bearer ${token}`,
      "x-awcms-tenant-id": TENANT,
      "content-type": "application/json"
    },
    body: { moduleKey: MODULE, activityCode, action }
  });

  return {
    status: res.status,
    allowed: res.body?.data?.allowed,
    matchedPolicy: res.body?.data?.matchedPolicy
  };
}

suite("POST /access/evaluate and the enrolment requirement (ADR-0141)", () => {
  let savedMfaEnabled: string | undefined;

  beforeAll(async () => {
    savedMfaEnabled = process.env.AUTH_MFA_ENABLED;
    handlerReady = await ensureHandlerDatabaseReady();

    if (!handlerReady) return;

    for (const [activity, action] of [
      ["payout", "approve"],
      ["note", "update"]
    ]) {
      await getHandlerAdminSql()`
        INSERT INTO awcms_permissions (module_key, activity_code, action, description)
        VALUES (${MODULE}, ${activity}, ${action}, 'evaluate fixture')
        ON CONFLICT (module_key, activity_code, action) DO NOTHING
      `;
    }
  }, 120000);

  afterAll(async () => {
    const index = modules.indexOf(FIXTURE_MODULE);
    if (index !== -1) modules.splice(index, 1);
    resetMfaRequiredPermissionCacheForTests();

    if (savedMfaEnabled === undefined) delete process.env.AUTH_MFA_ENABLED;
    else process.env.AUTH_MFA_ENABLED = savedMfaEnabled;

    if (handlerReady) {
      await resetHandlerDatabase();
      await getHandlerAdminSql()`
        DELETE FROM awcms_permissions WHERE module_key = ${MODULE}
      `;
      await teardownHandlerDatabase();
    }
  }, 60000);

  beforeEach(async () => {
    if (!handlerReady) return;
    process.env.AUTH_MFA_ENABLED = "true";
    await resetHandlerDatabase();
    await getHandlerAdminSql()`
      INSERT INTO awcms_tenants
        (id, tenant_code, tenant_name, legal_name, status, default_locale, default_theme)
      VALUES (${TENANT}, 'mfa-evaluate', 'mfa-evaluate', 'mfa-evaluate', 'active', 'en', 'light')
    `;

    if (!modules.includes(FIXTURE_MODULE)) modules.push(FIXTURE_MODULE);
    resetMfaRequiredPermissionCacheForTests();
  }, 30000);

  test("an unenrolled holder is told 'not allowed' for the flagged permission, as the endpoint would", async () => {
    if (!handlerReady) return;
    const bare = await seedHolder("bare", false);

    const result = await evaluate(bare.token, "payout", "approve");

    expect(result.status).toBe(200);
    expect(result.allowed).toBe(false);
    expect(result.matchedPolicy).toBe("mfa_enrolment_required");

    // And the decision log records the same single refusal.
    const rows = (await getHandlerAdminSql()`
      SELECT decision, matched_policy FROM awcms_abac_decision_logs
      WHERE tenant_user_id = ${bare.tenantUserId} AND activity_code = 'payout'
    `) as { decision: string; matched_policy: string | null }[];

    expect(rows).toEqual([
      { decision: "deny", matched_policy: "mfa_enrolment_required" }
    ]);
  }, 60000);

  test("an enrolled holder is told 'allowed', and an unflagged permission is allowed for anyone", async () => {
    if (!handlerReady) return;
    const enrolled = await seedHolder("enrolled", true);
    const bare = await seedHolder("bare", false);

    expect((await evaluate(enrolled.token, "payout", "approve")).allowed).toBe(
      true
    );
    expect((await evaluate(bare.token, "note", "update")).allowed).toBe(true);
  }, 60000);

  test("it reports on the CALLER'S enrolment only — enrolling someone else changes nothing", async () => {
    if (!handlerReady) return;
    const bare = await seedHolder("bare", false);
    await seedHolder("someone-else", true);

    expect((await evaluate(bare.token, "payout", "approve")).allowed).toBe(
      false
    );
  }, 60000);
});
