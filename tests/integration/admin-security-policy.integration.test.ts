/**
 * The break-glass picker on `/admin/security` against a real database.
 *
 * The screen's whole job is to keep an operator from locking themselves out, so
 * the one thing it must never do is OFFER an option the save path will then
 * discard. `listBreakGlassCandidates` and `fetchEligibleBreakGlassIdentityIds`
 * are two hand-written queries with the same intent and no shared code — the
 * kind of pair that drifts silently, because a picker that offers an ineligible
 * account still renders perfectly and only fails at the moment it matters.
 *
 * These tests seed each way an account can be ineligible and require the two to
 * agree on every one.
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
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import {
  fetchEligibleBreakGlassIdentityIds,
  getTenantAuthPolicy,
  listBreakGlassCandidates,
  saveTenantAuthPolicy
} from "../../src/modules/identity-access/application/tenant-auth-policy";
import {
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";

const suite = integrationEnabled ? describe : describe.skip;

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

async function seedTenant(id: string, code: string): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_tenants
      (id, tenant_code, tenant_name, legal_name, status, default_locale, default_theme)
    VALUES (${id}, ${code}, ${code}, ${code}, 'active', 'en', 'light')
    ON CONFLICT (id) DO NOTHING
  `;
}

async function seedAccount(
  tenantId: string,
  loginIdentifier: string,
  options: { identityStatus?: string; membershipStatus?: string } = {}
): Promise<{ identityId: string; tenantUserId: string }> {
  const admin = getAdminSql();
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
      ${await hashPassword("original-password")},
      ${options.identityStatus ?? "active"}
    )
  `;
  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id, status)
    VALUES (
      ${tenantUserId}, ${tenantId}, ${identityId},
      ${options.membershipStatus ?? "active"}
    )
  `;

  return { identityId, tenantUserId };
}

function candidates(tenantId: string) {
  return withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
    listBreakGlassCandidates(tx, tenantId)
  );
}

function eligible(tenantId: string, identityIds: string[]) {
  return withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
    fetchEligibleBreakGlassIdentityIds(tx, tenantId, identityIds)
  );
}

suite("admin security break-glass picker (Wave 2 delta auth)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  }, 120000);

  afterAll(async () => {
    await teardownIntegrationDatabase();
  }, 60000);

  beforeEach(async () => {
    await resetDatabase();
    await seedTenant(TENANT_A, "tenant-a");
    await seedTenant(TENANT_B, "tenant-b");
  }, 30000);

  test("offers active accounts, with the identifier masked", async () => {
    const { identityId } = await seedAccount(TENANT_A, "owner@example.com");

    const list = await candidates(TENANT_A);

    expect(list).toHaveLength(1);
    expect(list[0]!.identityId).toBe(identityId);
    // The screen shows this string to an admin; it must not be the raw address.
    expect(list[0]!.loginIdentifierMasked).not.toBe("owner@example.com");
    expect(list[0]!.loginIdentifierMasked).toContain("@example.com");
  });

  test.each([
    ["an inactive identity", { identityStatus: "inactive" }],
    ["an inactive membership", { membershipStatus: "inactive" }],
    ["a locked identity", { identityStatus: "locked" }]
  ])("never offers %s — and the save path agrees", async (_label, options) => {
    const { identityId } = await seedAccount(
      TENANT_A,
      "ineligible@example.com",
      options
    );

    // The picker does not offer it...
    expect(await candidates(TENANT_A)).toEqual([]);
    // ...and the save path would not have accepted it either. Both directions,
    // because a picker consistent with a BROKEN eligibility rule proves nothing.
    expect(await eligible(TENANT_A, [identityId])).toEqual([]);
  });

  test("a submitted ineligible id is dropped, not saved", async () => {
    const active = await seedAccount(TENANT_A, "owner@example.com");
    const inactive = await seedAccount(TENANT_A, "gone@example.com", {
      identityStatus: "inactive"
    });

    const result = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      saveTenantAuthPolicy(tx, TENANT_A, active.tenantUserId, {
        breakGlassIdentityIds: [active.identityId, inactive.identityId]
      })
    );

    expect(result.outcome).toBe("saved");

    const stored = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      getTenantAuthPolicy(tx, TENANT_A)
    );

    expect(stored.breakGlassIdentityIds).toEqual([active.identityId]);
  });

  test("requiring SSO with no eligible break-glass account is refused", async () => {
    const active = await seedAccount(TENANT_A, "owner@example.com");

    const result = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      saveTenantAuthPolicy(tx, TENANT_A, active.tenantUserId, {
        ssoEnabled: true,
        ssoRequired: true,
        breakGlassIdentityIds: []
      })
    );

    // This is the error `/admin/security` surfaces verbatim instead of
    // collapsing into a generic failure — the operator has to know which change
    // the server will never accept.
    expect(result.outcome).toBe("break_glass_required");

    const stored = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      getTenantAuthPolicy(tx, TENANT_A)
    );
    expect(stored.ssoRequired).toBe(false);
  });

  test("requiring SSO succeeds once an eligible account is named", async () => {
    const active = await seedAccount(TENANT_A, "owner@example.com");

    const result = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      saveTenantAuthPolicy(tx, TENANT_A, active.tenantUserId, {
        ssoEnabled: true,
        ssoRequired: true,
        breakGlassIdentityIds: [active.identityId]
      })
    );

    expect(result.outcome).toBe("saved");
  });

  test("another tenant's accounts are never offered", async () => {
    await seedAccount(TENANT_A, "owner@example.com");
    const foreign = await seedAccount(TENANT_B, "other@example.com");

    const list = await candidates(TENANT_A);

    expect(list.map((entry) => entry.identityId)).not.toContain(
      foreign.identityId
    );
    expect(await eligible(TENANT_A, [foreign.identityId])).toEqual([]);
  });
});
