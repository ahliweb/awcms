/**
 * `checkSsoBreakGlassReady` against a real PostgreSQL (WORLD 2 — the check
 * calls `getDatabaseClient()` itself, so it can only be exercised against the
 * handler database, see harness.ts).
 *
 * ## What is actually under test
 *
 * Not "does the check run". The check exists for ONE scenario, and that
 * scenario is a sequence, not a state: a tenant saves `sso_required=true` with
 * a valid break-glass identity — accepted, because at that instant it IS valid
 * — and some later, unrelated administrative action deactivates that identity
 * or its tenant membership. The stored policy is now false, and nothing in the
 * write path is ever consulted again to notice. So every test below SAVES a
 * legitimate policy first and only then breaks it, because a test that seeded
 * the broken end-state directly would pass just as happily against a check that
 * only ever looked at `break_glass_identity_ids` being non-empty.
 *
 * ## Why a green case is included, and why it is the specific one it is
 *
 * A check that returns `fail` unconditionally would satisfy every red test
 * here. The pass cases pin the two ways this must NOT fire: a tenant that never
 * locked itself down (the overwhelmingly common case — a false positive here
 * would block every go-live), and a locked-down tenant with a SECOND, still-
 * active break-glass account, which is the difference between "counts eligible
 * identities" and "checks the list is non-empty".
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import { hashPassword } from "../../src/lib/auth/password";
import { withTenant } from "../../src/lib/database/tenant-context";
import { saveTenantAuthPolicy } from "../../src/modules/identity-access/application/tenant-auth-policy";
import { checkSsoBreakGlassReady } from "../../scripts/security-readiness";
import {
  ensureHandlerDatabaseReady,
  getHandlerAdminSql,
  getHandlerDatabaseClient,
  integrationEnabled,
  resetHandlerDatabase,
  teardownHandlerDatabase
} from "./harness";

const suite = integrationEnabled ? describe : describe.skip;

const TENANT_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const TENANT_B = "bbbbbbbb-0000-4000-8000-00000000000b";

let handlerReady = false;

async function seedTenant(id: string, code: string): Promise<void> {
  await getHandlerAdminSql()`
    INSERT INTO awcms_tenants
      (id, tenant_code, tenant_name, legal_name, status, default_locale, default_theme)
    VALUES (${id}, ${code}, ${code}, ${code}, 'active', 'en', 'light')
    ON CONFLICT (id) DO NOTHING
  `;
}

async function seedAccount(
  tenantId: string,
  loginIdentifier: string
): Promise<{ identityId: string; tenantUserId: string }> {
  const admin = getHandlerAdminSql();
  const profileId = crypto.randomUUID();
  const identityId = crypto.randomUUID();
  const tenantUserId = crypto.randomUUID();

  await admin`
    INSERT INTO awcms_profiles (id, tenant_id, profile_type, display_name, status)
    VALUES (${profileId}, ${tenantId}, 'person', ${loginIdentifier}, 'active')
  `;
  await admin`
    INSERT INTO awcms_identities
      (id, tenant_id, profile_id, login_identifier, password_hash, status)
    VALUES (
      ${identityId}, ${tenantId}, ${profileId}, ${loginIdentifier},
      ${await hashPassword("break-glass-password")}, 'active'
    )
  `;
  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id, status)
    VALUES (${tenantUserId}, ${tenantId}, ${identityId}, 'active')
  `;

  return { identityId, tenantUserId };
}

/**
 * Locks the tenant down THROUGH the real save path, so the fixture can only
 * ever exist in a state the application itself would have produced. If
 * `saveTenantAuthPolicy` had refused, this throws and the test is honest about
 * why rather than quietly testing an impossible row.
 */
async function lockDownTenant(
  tenantId: string,
  actorTenantUserId: string,
  breakGlassIdentityIds: string[],
  // Both halves of `evaluateBreakGlassRequirement`'s trigger. `ssoRequired` is
  // the common one; disabling password login is the other, and the two are
  // separate booleans that a narrowed early-return could silently stop
  // covering. `passwordLoginEnabled: false` also needs `ssoEnabled: true` — the
  // table's CHECK forbids a row with neither login method.
  mode: "sso_required" | "password_login_disabled" = "sso_required"
): Promise<void> {
  const result = await withTenant(
    getHandlerDatabaseClient(),
    tenantId,
    (tx) =>
      saveTenantAuthPolicy(tx, tenantId, actorTenantUserId, {
        ssoEnabled: true,
        ssoRequired: mode === "sso_required",
        passwordLoginEnabled: mode === "sso_required",
        breakGlassIdentityIds
      }),
    { workClass: "interactive" }
  );

  if (typeof result !== "object" || !("outcome" in result)) {
    throw new Error("saveTenantAuthPolicy did not return a result object.");
  }

  if (result.outcome !== "saved") {
    throw new Error(
      `fixture could not lock the tenant down: ${result.outcome}. The break-glass identity was already ineligible before the test began.`
    );
  }
}

suite("SSO break-glass readiness check (Issue #185 residual)", () => {
  beforeAll(async () => {
    handlerReady = await ensureHandlerDatabaseReady();
  }, 120000);

  afterAll(async () => {
    if (handlerReady) {
      await teardownHandlerDatabase();
    }
  }, 60000);

  beforeEach(async () => {
    if (!handlerReady) return;
    await resetHandlerDatabase();
    await seedTenant(TENANT_A, "bg-tenant-a");
    await seedTenant(TENANT_B, "bg-tenant-b");
  }, 30000);

  test("passes when no tenant has locked itself down", async () => {
    if (!handlerReady) return;
    await seedAccount(TENANT_A, "owner-a@example.com");

    const result = await checkSsoBreakGlassReady();

    expect(result.status).toBe("pass");
    expect(result.severity).toBe("critical");
    // The count is load-bearing evidence: "0 tenants scanned" would also print
    // PASS, and would mean the check saw nothing rather than saw nothing wrong.
    expect(result.evidence).toContain("2 active tenant(s) scanned");
    expect(result.evidence).toContain("0 require a break-glass local owner");
  }, 60000);

  test("passes for a locked-down tenant whose break-glass account is intact", async () => {
    if (!handlerReady) return;
    const owner = await seedAccount(TENANT_A, "owner-a@example.com");
    await lockDownTenant(TENANT_A, owner.tenantUserId, [owner.identityId]);

    const result = await checkSsoBreakGlassReady();

    expect(result.status).toBe("pass");
    expect(result.evidence).toContain("1 require a break-glass local owner");
  }, 60000);

  test("FAILS after the break-glass identity is deactivated post-save", async () => {
    if (!handlerReady) return;
    const owner = await seedAccount(TENANT_A, "owner-a@example.com");
    await lockDownTenant(TENANT_A, owner.tenantUserId, [owner.identityId]);

    // Green immediately after the save — this is the state the save path
    // guaranteed, and the state every existing check still sees afterwards.
    expect((await checkSsoBreakGlassReady()).status).toBe("pass");

    // An ordinary user-administration action, with no visible connection to SSO.
    await getHandlerAdminSql()`
      UPDATE awcms_identities SET status = 'inactive' WHERE id = ${owner.identityId}
    `;

    const result = await checkSsoBreakGlassReady();

    expect(result.status).toBe("fail");
    expect(result.severity).toBe("critical");
    expect(result.evidence).toContain(TENANT_A);
    expect(result.evidence).toContain("1 of 2 active tenant(s)");
  }, 60000);

  test("FAILS after the break-glass membership is revoked post-save", async () => {
    if (!handlerReady) return;
    const owner = await seedAccount(TENANT_A, "owner-a@example.com");
    await lockDownTenant(TENANT_A, owner.tenantUserId, [owner.identityId]);

    // The identity itself stays active — only its seat in THIS tenant goes.
    await getHandlerAdminSql()`
      UPDATE awcms_tenant_users SET status = 'inactive' WHERE identity_id = ${owner.identityId}
    `;

    const result = await checkSsoBreakGlassReady();

    expect(result.status).toBe("fail");
    expect(result.evidence).toContain(TENANT_A);
  }, 60000);

  test("FAILS for the other lockdown mode too — password login disabled", async () => {
    if (!handlerReady) return;
    const owner = await seedAccount(TENANT_A, "owner-a@example.com");
    await lockDownTenant(
      TENANT_A,
      owner.tenantUserId,
      [owner.identityId],
      "password_login_disabled"
    );

    await getHandlerAdminSql()`
      UPDATE awcms_identities SET status = 'inactive' WHERE id = ${owner.identityId}
    `;

    // `sso_required` and `password_login_enabled` are independent booleans and
    // either one alone strands the tenant. A check that only looked at
    // `sso_required` would pass here while the tenant has no local login at all.
    const result = await checkSsoBreakGlassReady();

    expect(result.status).toBe("fail");
    expect(result.evidence).toContain(TENANT_A);
    // Triage detail: this tenant has no local login AT ALL right now, which is
    // the urgent variant. Reporting both triggers with the same words would
    // leave an operator to re-derive the difference from the database.
    expect(result.evidence).toContain("password_login_enabled=false");
  }, 60000);

  test("still passes when one of two break-glass accounts is deactivated", async () => {
    if (!handlerReady) return;
    const first = await seedAccount(TENANT_A, "owner-a@example.com");
    const second = await seedAccount(TENANT_A, "backup-a@example.com");
    await lockDownTenant(TENANT_A, first.tenantUserId, [
      first.identityId,
      second.identityId
    ]);

    await getHandlerAdminSql()`
      UPDATE awcms_identities SET status = 'inactive' WHERE id = ${first.identityId}
    `;

    const result = await checkSsoBreakGlassReady();

    // Counting eligible identities, not asserting the stored list is non-empty.
    expect(result.status).toBe("pass");
  }, 60000);

  test("names every stranded tenant, not just the first", async () => {
    if (!handlerReady) return;
    const ownerA = await seedAccount(TENANT_A, "owner-a@example.com");
    const ownerB = await seedAccount(TENANT_B, "owner-b@example.com");
    await lockDownTenant(TENANT_A, ownerA.tenantUserId, [ownerA.identityId]);
    await lockDownTenant(TENANT_B, ownerB.tenantUserId, [ownerB.identityId]);

    await getHandlerAdminSql()`
      UPDATE awcms_identities SET status = 'inactive'
      WHERE id IN (${ownerA.identityId}, ${ownerB.identityId})
    `;

    const result = await checkSsoBreakGlassReady();

    expect(result.status).toBe("fail");
    // An operator who fixes only the tenant named in the message and re-runs
    // must not be told everything is fine while the other is still locked out.
    expect(result.evidence).toContain(TENANT_A);
    expect(result.evidence).toContain(TENANT_B);
    expect(result.evidence).toContain("2 of 2 active tenant(s)");
  }, 60000);

  test("ignores inactive tenants — they have no live login surface", async () => {
    if (!handlerReady) return;
    const owner = await seedAccount(TENANT_B, "owner-b@example.com");
    await lockDownTenant(TENANT_B, owner.tenantUserId, [owner.identityId]);
    await getHandlerAdminSql()`
      UPDATE awcms_identities SET status = 'inactive' WHERE id = ${owner.identityId}
    `;
    await getHandlerAdminSql()`
      UPDATE awcms_tenants SET status = 'inactive' WHERE id = ${TENANT_B}
    `;

    const result = await checkSsoBreakGlassReady();

    expect(result.status).toBe("pass");
    expect(result.evidence).toContain("1 active tenant(s) scanned");
  }, 60000);

  test("never prints a login identifier — the evidence goes to an operator console", async () => {
    if (!handlerReady) return;
    const owner = await seedAccount(TENANT_A, "owner-a@example.com");
    await lockDownTenant(TENANT_A, owner.tenantUserId, [owner.identityId]);
    await getHandlerAdminSql()`
      UPDATE awcms_identities SET status = 'inactive' WHERE id = ${owner.identityId}
    `;

    const result = await checkSsoBreakGlassReady();

    expect(result.status).toBe("fail");
    expect(result.evidence).not.toContain("owner-a@example.com");
  }, 60000);
});
