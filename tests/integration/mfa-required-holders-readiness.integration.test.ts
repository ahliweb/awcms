/**
 * `checkMfaRequiredPermissionHolders` against a real PostgreSQL (WORLD 2 — the
 * check calls `getDatabaseClient()` itself, so it can only be exercised against
 * the handler database; see harness.ts). ADR-0141, finding PS-13.
 *
 * The listing LOGIC (grant sources, deactivation, module availability, tenant
 * scoping) is proved in WORLD 1 by `mfa-required-permissions.integration.test.ts`
 * against `reportMfaRequiredPermissionHolders`. What this adds is the thing only
 * the real check can show: that it walks EVERY active tenant under that tenant's
 * own RLS, names the ones with a problem, and reports a clean bill only when it
 * actually looked.
 *
 * The flagged permission is a test-only fixture injected through `requiredKeys`.
 * Its catalogue row is inserted into the handler database and REMOVED again in
 * `afterAll`, because `awcms_permissions` is global state other suites count.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import { checkMfaRequiredPermissionHolders } from "../../scripts/security-readiness";
import { linkIdentityToPrincipal } from "../../src/modules/identity-access/application/principal-store";
import {
  ensureHandlerDatabaseReady,
  getHandlerAdminSql,
  integrationEnabled,
  resetHandlerDatabase,
  teardownHandlerDatabase
} from "./harness";

const suite = integrationEnabled ? describe : describe.skip;

const TENANT_A = "ca000000-0000-4000-8000-00000000000a";
const TENANT_B = "cb000000-0000-4000-8000-00000000000b";
const FIXTURE_MODULE = "mfa_readiness_fixture";
const KEYS = new Set([`${FIXTURE_MODULE}.payout.approve`]);

let handlerReady = false;

async function seedTenant(id: string, code: string): Promise<void> {
  await getHandlerAdminSql()`
    INSERT INTO awcms_tenants
      (id, tenant_code, tenant_name, legal_name, status, default_locale, default_theme)
    VALUES (${id}, ${code}, ${code}, ${code}, 'active', 'en', 'light')
    ON CONFLICT (id) DO NOTHING
  `;
}

/** A tenant user holding the fixture permission, optionally with a confirmed factor. */
async function seedHolder(
  tenantId: string,
  label: string,
  enrolled: boolean
): Promise<{ principalId: string }> {
  const admin = getHandlerAdminSql();
  const loginIdentifier = `${label}@example.test`;

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${label}) RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities
      (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${loginIdentifier}, 'x')
    RETURNING id
  `) as { id: string }[];
  const tenantUser = (await admin`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id}) RETURNING id
  `) as { id: string }[];
  const principalId = await linkIdentityToPrincipal(
    admin,
    identity[0]!.id,
    loginIdentifier
  );

  const role = (await admin`
    INSERT INTO awcms_roles (tenant_id, role_code, role_name)
    VALUES (${tenantId}, ${`r-${label}`}, ${label}) RETURNING id
  `) as { id: string }[];
  const permission = (await admin`
    SELECT id FROM awcms_permissions
    WHERE module_key = ${FIXTURE_MODULE}
      AND activity_code = 'payout' AND action = 'approve'
  `) as { id: string }[];

  await admin`
    INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
    VALUES (${tenantId}, ${role[0]!.id}, ${permission[0]!.id})
  `;
  await admin`
    INSERT INTO awcms_access_policies
      (tenant_id, tenant_user_id, role_id, scope_type, scope_id,
       granted_by_tenant_user_id)
    VALUES (${tenantId}, ${tenantUser[0]!.id}, ${role[0]!.id}, 'tenant',
            ${tenantId}, ${tenantUser[0]!.id})
  `;

  if (enrolled) await enrol(principalId);

  return { principalId };
}

async function enrol(principalId: string): Promise<void> {
  await getHandlerAdminSql()`
    INSERT INTO awcms_principal_mfa_factors
      (principal_id, factor_type, secret_ciphertext, status, last_used_step,
       activated_at)
    VALUES (${principalId}, 'totp', 'ciphertext-not-read', 'active', -1, now())
  `;
}

suite("MFA-required holders readiness check (ADR-0141)", () => {
  beforeAll(async () => {
    handlerReady = await ensureHandlerDatabaseReady();

    if (!handlerReady) return;

    await getHandlerAdminSql()`
      INSERT INTO awcms_permissions (module_key, activity_code, action, description)
      VALUES (${FIXTURE_MODULE}, 'payout', 'approve', 'readiness fixture')
      ON CONFLICT (module_key, activity_code, action) DO NOTHING
    `;
  }, 120000);

  afterAll(async () => {
    if (handlerReady) {
      // Grants first (FK), then the catalogue row: leave the global catalogue
      // exactly as it was found.
      await resetHandlerDatabase();
      await getHandlerAdminSql()`
        DELETE FROM awcms_permissions WHERE module_key = ${FIXTURE_MODULE}
      `;
      await teardownHandlerDatabase();
    }
  }, 60000);

  beforeEach(async () => {
    if (!handlerReady) return;
    await resetHandlerDatabase();
    await seedTenant(TENANT_A, "mfa-ready-a");
    await seedTenant(TENANT_B, "mfa-ready-b");
  }, 30000);

  test("passes, and says how many tenants it looked at, when every holder is enrolled", async () => {
    if (!handlerReady) return;
    await seedHolder(TENANT_A, "a-holder", true);
    await seedHolder(TENANT_B, "b-holder", true);

    const result = await checkMfaRequiredPermissionHolders({
      requiredKeys: KEYS
    });

    expect(result.status).toBe("pass");
    expect(result.severity).toBe("warning");
    // "0 tenants scanned" would also print PASS and would mean the check saw
    // nothing rather than saw nothing wrong.
    expect(result.evidence).toContain("2 active tenant(s) scanned");
    expect(result.evidence).toContain("2 holder(s)");
  }, 60000);

  test("names the tenant whose holder has no factor, and only that tenant", async () => {
    if (!handlerReady) return;
    await seedHolder(TENANT_A, "a-holder", true);
    await seedHolder(TENANT_B, "b-holder", false);

    const result = await checkMfaRequiredPermissionHolders({
      requiredKeys: KEYS
    });

    expect(result.status).toBe("fail");
    // Reported, never blocking: an unenrolled holder is refused by the
    // chokepoint, which is the control; this is the early warning.
    expect(result.severity).toBe("warning");
    expect(result.evidence).toContain(TENANT_B);
    expect(result.evidence).not.toContain(TENANT_A);
    expect(result.evidence).toContain("1 of 1 holder(s) not enrolled");
    // The way forward is in the report.
    expect(result.evidence).toContain("/admin/account");
    // Ids only: no login identifier reaches an operator log.
    expect(result.evidence).not.toContain("@example.test");
  }, 60000);

  test("turns green the moment the last holder enrols — no other action involved", async () => {
    if (!handlerReady) return;
    await seedHolder(TENANT_A, "a-holder", true);
    const b = await seedHolder(TENANT_B, "b-holder", false);

    expect(
      (await checkMfaRequiredPermissionHolders({ requiredKeys: KEYS })).status
    ).toBe("fail");

    await enrol(b.principalId);

    expect(
      (await checkMfaRequiredPermissionHolders({ requiredKeys: KEYS })).status
    ).toBe("pass");
  }, 60000);

  test("a tenant with no holder at all is not a finding", async () => {
    if (!handlerReady) return;

    const result = await checkMfaRequiredPermissionHolders({
      requiredKeys: KEYS
    });

    expect(result.status).toBe("pass");
    expect(result.evidence).toContain("0 holder(s)");
  }, 60000);
});
