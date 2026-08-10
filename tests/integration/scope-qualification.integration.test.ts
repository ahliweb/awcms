/**
 * Scope qualification (ADR-0080, Gelombang 3 PR 3.4 of #423) — the resolver
 * half, against a real PostgreSQL.
 *
 * The domain clause is proven pure in `tests/scope-narrowing.test.ts`. What only
 * a database can answer is what `resolveBusinessScopeFacts` actually PRODUCES:
 *
 *   1. **Inert today.** A subject holding only tenant-wide grants — which is
 *      every subject in the repo, because nothing writes a narrower one — gets
 *      exactly the fact set they got before. Asserted, not assumed: the claim
 *      "this ships disabled in practice" is the kind that is true right up until
 *      a `<>` is written as an `=`.
 *   2. **A scoped grant becomes a QUALIFIED fact**, carrying precisely the
 *      permission keys its role confers and no others.
 *   3. **A tenant-wide grant mints NO fact.** This is the direction that would
 *      be a blanket widening if it were wrong: a `tenantWide` fact covers every
 *      required scope, so producing one from an ordinary role grant would hand
 *      the #180 guard's answer to everybody who holds any role at all.
 *
 * Scoped rows are inserted through the admin connection because no writer mints
 * them yet — the admin surface for scoped grants is deliberately a later PR
 * (ADR-0080 §Rollback). That is the same reason this file can assert (1) at all.
 *
 * Gated on `DATABASE_URL` (harness §Gating).
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
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { resolveBusinessScopeFacts } from "../../src/modules/identity-access/application/business-scope-facts";
import { evaluateAccess } from "../../src/modules/identity-access/domain/access-control";
import type {
  AccessRequest,
  TenantContext
} from "../../src/modules/identity-access/domain/access-control";
import type { BusinessScopeHierarchyPort } from "../../src/modules/_shared/ports/business-scope-hierarchy-port";

const TENANT = "e5555555-5555-4555-8555-555555555555";
const SUBJECT = "e5000000-0000-4000-8000-000000000001";
const OFFICE = "e5000000-0000-4000-8000-0000000000f1";
const OTHER_OFFICE = "e5000000-0000-4000-8000-0000000000f2";
const READER_ROLE = "e5000000-0000-4000-8000-0000000000a1";

const READ_KEY = "blog_content.posts.read";
const UPDATE_KEY = "blog_content.posts.update";

/** A trivially-resolving hierarchy: every scope resolves, with no relatives. */
const flatHierarchy: BusinessScopeHierarchyPort = {
  resolveScope: async () => ({
    resolved: true,
    ancestorScopes: [],
    descendantScopes: []
  })
};

const context: TenantContext = {
  tenantId: TENANT,
  tenantUserId: SUBJECT,
  identityId: SUBJECT,
  roles: ["reader"]
};

function scopedRequest(
  action: "read" | "update",
  scopeId: string
): AccessRequest {
  return {
    moduleKey: "blog_content",
    activityCode: "posts",
    action,
    resourceAttributes: {
      requiredScopeType: "office",
      requiredScopeId: scopeId
    }
  };
}

async function seedFixtures(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT}, 'scope-qual-tenant', 'Scope Qualification Tenant')
  `;

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT}, 'person', 'Scoped Subject')
    RETURNING id
  `) as { id: string }[];

  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${TENANT}, ${profile[0]!.id}, 'scoped@example.test', 'x')
    RETURNING id
  `) as { id: string }[];

  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
    VALUES (${SUBJECT}, ${TENANT}, ${identity[0]!.id})
  `;

  await admin`
    INSERT INTO awcms_roles (id, tenant_id, role_code, role_name)
    VALUES (${READER_ROLE}, ${TENANT}, 'reader', 'Reader')
  `;

  // The role confers READ and nothing else — `update` is the key the qualified
  // fact must refuse.
  const permission = (await admin`
    SELECT id FROM awcms_permissions
    WHERE module_key = 'blog_content' AND activity_code = 'posts' AND action = 'read'
  `) as { id: string }[];

  await admin`
    INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
    VALUES (${TENANT}, ${READER_ROLE}, ${permission[0]!.id})
  `;
}

/** Inserts a grant at `scopeType`/`scopeId` directly — no writer mints these yet. */
async function insertGrant(scopeType: string, scopeId: string): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_access_policies
      (tenant_id, tenant_user_id, role_id, scope_type, scope_id)
    VALUES (${TENANT}, ${SUBJECT}, ${READER_ROLE}, ${scopeType}, ${scopeId})
  `;
}

async function facts() {
  return withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
    resolveBusinessScopeFacts(tx, TENANT, SUBJECT, new Date(), flatHierarchy)
  );
}

const suite = integrationEnabled ? describe : describe.skip;

suite("scope-qualified facts (ADR-0080)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedFixtures();
  });

  test("a TENANT-WIDE grant mints no fact at all", async () => {
    // The failure direction that would be a blanket widening: a `tenantWide`
    // fact covers EVERY required scope, so minting one from an ordinary role
    // grant would give the #180 guard's answer away to everyone holding a role.
    await insertGrant("tenant", TENANT);

    expect(await facts()).toEqual([]);
  });

  test("a subject with no grants at all still has no facts", async () => {
    expect(await facts()).toEqual([]);
  });

  test("a SCOPED grant mints a fact carrying exactly its role's keys", async () => {
    await insertGrant("office", OFFICE);

    const resolved = await facts();

    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.scopeType).toBe("office");
    expect(resolved[0]!.scopeId).toBe(OFFICE);
    expect(resolved[0]!.tenantWide).toBe(false);
    expect([...(resolved[0]!.permissionKeys ?? [])]).toEqual([READ_KEY]);
  });

  test("the qualified fact covers the permission it confers, at its own scope", async () => {
    await insertGrant("office", OFFICE);

    const resolved = await facts();
    const granted = new Set([READ_KEY, UPDATE_KEY]);

    expect(
      evaluateAccess(context, scopedRequest("read", OFFICE), granted, resolved)
        .allowed
    ).toBe(true);

    // A permission the role does NOT confer — denied at the same scope. This is
    // the whole point: RBAC says the subject holds `update` somewhere (the
    // granted set says so), and the scoped grant says not HERE.
    expect(
      evaluateAccess(
        context,
        scopedRequest("update", OFFICE),
        granted,
        resolved
      ).allowed
    ).toBe(false);

    // And the scope still bounds it: the conferred permission at ANOTHER office
    // is denied for the ordinary #180 reason.
    expect(
      evaluateAccess(
        context,
        scopedRequest("read", OTHER_OFFICE),
        granted,
        resolved
      ).allowed
    ).toBe(false);
  });

  test("a revoked scoped grant stops qualifying immediately", async () => {
    // Lifecycle comes from the shared `activeRoleGrants` fragment, so this is
    // really asserting that the scoped read did not grow its own idea of
    // "in force" — the drift ADR-0079 was written about.
    await insertGrant("office", OFFICE);

    await getAdminSql()`
      UPDATE awcms_access_policies
      SET status = 'revoked', revoked_at = now()
      WHERE tenant_id = ${TENANT}
    `;

    expect(await facts()).toEqual([]);
  });

  test("a scope ASSIGNMENT still covers every action at its scope", async () => {
    // The #180 contract, unchanged. A scope assignment says which scopes the
    // subject may act in and has never said which actions, so its fact carries
    // no keys and qualifies for everything — including the `update` the scoped
    // grant above refuses.
    await getAdminSql()`
      INSERT INTO awcms_business_scope_assignments
        (tenant_id, tenant_user_id, role_id, scope_type, scope_id, granted_by_tenant_user_id)
      VALUES (${TENANT}, ${SUBJECT}, ${READER_ROLE}, 'office', ${OFFICE}, ${SUBJECT})
    `;

    const resolved = await facts();

    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.permissionKeys).toBeUndefined();

    expect(
      evaluateAccess(
        context,
        scopedRequest("update", OFFICE),
        new Set([READ_KEY, UPDATE_KEY]),
        resolved
      ).allowed
    ).toBe(true);
  });

  test("an assignment and a scoped grant on the SAME scope keep the wider answer", async () => {
    // Both facts are minted, and `evaluateAccess` uses `.some()`. Holding both
    // therefore resolves to the assignment's answer — which is precisely today's
    // answer, so adding the grant took nothing away from anybody.
    await insertGrant("office", OFFICE);
    await getAdminSql()`
      INSERT INTO awcms_business_scope_assignments
        (tenant_id, tenant_user_id, role_id, scope_type, scope_id, granted_by_tenant_user_id)
      VALUES (${TENANT}, ${SUBJECT}, ${READER_ROLE}, 'office', ${OFFICE}, ${SUBJECT})
    `;

    const resolved = await facts();

    expect(resolved).toHaveLength(2);
    expect(
      evaluateAccess(
        context,
        scopedRequest("update", OFFICE),
        new Set([READ_KEY, UPDATE_KEY]),
        resolved
      ).allowed
    ).toBe(true);
  });
});
