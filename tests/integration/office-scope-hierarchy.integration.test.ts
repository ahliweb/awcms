/**
 * Integration tests for `tenant_admin`'s office business-scope resolver
 * (ADR-0060) against a real PostgreSQL under the ephemeral-database harness.
 * A recursive CTE with cycle detection cannot be proven by a unit test with a
 * fake `tx`; these run the real SQL against real rows.
 *
 *   1. **The headline**: `createBusinessScopeAssignment` SUCCEEDS for a real
 *      office. Before ADR-0060 the base injected a resolver that resolved
 *      nothing, so this endpoint's success path was unreachable in every
 *      deployment — it could only ever answer `scope_unresolved`.
 *   2. **Liveness**: a soft-deleted or `inactive` office does not resolve, and
 *      one in the middle of a chain truncates that chain instead of lending
 *      coverage through a resource its tenant switched off.
 *   3. **Tenant isolation**: tenant A never resolves tenant B's office —
 *      asserted under the real non-superuser `awcms_app` role, where RLS FORCE
 *      applies, not only through the explicit `tenant_id` predicate.
 *   4. **Bounds refuse, never truncate**: a cycle (written directly, since
 *      `updateOffice` cannot re-parent), a chain past the depth cap, and a
 *      result set past the count cap each return `resolved: false`.
 *   5. **The reserved tenant-wide sentinel** only mints a covers-everything
 *      fact when it names THIS tenant.
 *
 * Skipped unless a real database is configured (see tests/integration/harness.ts).
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
  appRoleActivated,
  getAdminSql,
  getAppRoleSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { createBusinessScopeAssignment } from "../../src/modules/identity-access/application/business-scope-assignment-service";
import { resolveBusinessScopeFacts } from "../../src/modules/identity-access/application/business-scope-facts";
import {
  createOfficeScopeHierarchyPortAdapter,
  officeScopeHierarchyPortAdapter
} from "../../src/modules/tenant-admin/application/office-scope-hierarchy-port-adapter";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const A_SUBJECT = "a0000000-0000-4000-8000-000000000001";
const A_ACTOR = "a0000000-0000-4000-8000-000000000002";

// head -> region -> branch, plus a sibling branch under region.
const HEAD = "a0000000-0000-4000-8000-0000000000f0";
const REGION = "a0000000-0000-4000-8000-0000000000f1";
const BRANCH = "a0000000-0000-4000-8000-0000000000f2";
const BRANCH_SIBLING = "a0000000-0000-4000-8000-0000000000f3";
const OFFICE_B = "b0000000-0000-4000-8000-0000000000f0";

const NOW = new Date("2026-08-03T00:00:00.000Z");

async function insertOffice(
  tenantId: string,
  id: string,
  code: string,
  parentId: string | null,
  options: { status?: string; deleted?: boolean } = {}
): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_offices
      (id, tenant_id, office_code, office_name, office_type, parent_office_id,
       status, deleted_at)
    VALUES (
      ${id}, ${tenantId}, ${code}, ${code}, 'branch', ${parentId},
      ${options.status ?? "active"},
      ${options.deleted === true ? NOW : null}
    )
  `;
}

async function seedTenants(): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
    VALUES
      (${TENANT_A}, 'os-tenant-a', 'OS Tenant A', 'active'),
      (${TENANT_B}, 'os-tenant-b', 'OS Tenant B', 'active')
    ON CONFLICT (id) DO NOTHING
  `;
}

/** Profile -> identity -> tenant_user chain, the shape the assignment service requires. */
async function seedTenantUser(
  tenantId: string,
  tenantUserId: string,
  label: string
): Promise<void> {
  const admin = getAdminSql();
  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`Profile ${label}`})
    RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${label}@example.test`}, 'x')
    RETURNING id
  `) as { id: string }[];
  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
    VALUES (${tenantUserId}, ${tenantId}, ${identity[0]!.id})
  `;
}

function resolve(
  tenantId: string,
  scopeId: string,
  port = officeScopeHierarchyPortAdapter
) {
  return withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
    port.resolveScope(tx, tenantId, "office", scopeId)
  );
}

const suite = integrationEnabled ? describe : describe.skip;

suite(
  "office business-scope hierarchy resolver (integration, ADR-0060)",
  () => {
    beforeAll(async () => {
      await setupIntegrationDatabase();
    });
    afterAll(async () => {
      await teardownIntegrationDatabase();
    });
    beforeEach(async () => {
      await resetDatabase();
      await seedTenants();
      await insertOffice(TENANT_A, HEAD, "head", null);
      await insertOffice(TENANT_A, REGION, "region", HEAD);
      await insertOffice(TENANT_A, BRANCH, "branch", REGION);
      await insertOffice(TENANT_A, BRANCH_SIBLING, "branch-2", REGION);
      await insertOffice(TENANT_B, OFFICE_B, "b-office", null);
    });

    test("resolves a real office with its ancestor chain, immediate parent first", async () => {
      const result = await resolve(TENANT_A, BRANCH);

      expect(result.resolved).toBe(true);
      expect(result.ancestorScopes).toEqual([
        { scopeType: "office", scopeId: REGION },
        { scopeType: "office", scopeId: HEAD }
      ]);
      expect(result.descendantScopes).toEqual([]);
    });

    test("resolves descendants at any depth", async () => {
      const result = await resolve(TENANT_A, HEAD);

      expect(result.resolved).toBe(true);
      expect(result.ancestorScopes).toEqual([]);
      expect(new Set(result.descendantScopes.map((s) => s.scopeId))).toEqual(
        new Set([REGION, BRANCH, BRANCH_SIBLING])
      );
    });

    test("a soft-deleted office does not resolve; an unknown id is the same answer", async () => {
      await getAdminSql()`
      UPDATE awcms_offices SET deleted_at = ${NOW} WHERE id = ${BRANCH}
    `;

      expect((await resolve(TENANT_A, BRANCH)).resolved).toBe(false);
      expect(
        (await resolve(TENANT_A, "ffffffff-ffff-4fff-8fff-ffffffffffff"))
          .resolved
      ).toBe(false);
    });

    test("an inactive office does not resolve", async () => {
      await getAdminSql()`
      UPDATE awcms_offices SET status = 'inactive' WHERE id = ${BRANCH}
    `;

      expect((await resolve(TENANT_A, BRANCH)).resolved).toBe(false);
    });

    test("a deactivated ANCESTOR truncates the chain rather than lending coverage through it", async () => {
      await getAdminSql()`
      UPDATE awcms_offices SET status = 'inactive' WHERE id = ${REGION}
    `;

      const result = await resolve(TENANT_A, BRANCH);

      // The branch itself is still live, so it resolves — but the chain stops at
      // the office its tenant switched off, and HEAD (reachable only through it)
      // is NOT borrowed.
      expect(result.resolved).toBe(true);
      expect(result.ancestorScopes).toEqual([]);
    });

    test("cross-tenant: tenant A never resolves tenant B's office, under the real awcms_app role", async () => {
      expect((await resolve(TENANT_A, OFFICE_B)).resolved).toBe(false);

      if (!appRoleActivated) return;

      // Same question through the non-superuser LOGIN role, where RLS FORCE is
      // the layer under the explicit tenant_id predicate.
      const asAppRole = await withTenantOrThrow(
        getAppRoleSql(),
        TENANT_A,
        (tx) =>
          officeScopeHierarchyPortAdapter.resolveScope(
            tx,
            TENANT_A,
            "office",
            OFFICE_B
          )
      );
      expect(asAppRole.resolved).toBe(false);
    });

    test("a cycle refuses, it does not return a truncated chain", async () => {
      // `updateOffice` cannot re-parent, so a cycle can only arrive this way —
      // which is exactly why the resolver must not trust the shape of the graph.
      // The composite FK is (tenant_id, parent_office_id), so a same-tenant cycle
      // is writable.
      await getAdminSql()`
      UPDATE awcms_offices SET parent_office_id = ${BRANCH} WHERE id = ${HEAD}
    `;

      expect((await resolve(TENANT_A, BRANCH)).resolved).toBe(false);
      expect((await resolve(TENANT_A, HEAD)).resolved).toBe(false);
    });

    test("a cycle ABOVE the queried office refuses too (the upward walk has its own check)", async () => {
      // HEAD <-> REGION cycle, with BRANCH a leaf hanging under it. BRANCH has no
      // children, so the descendant walk sees nothing: only the ancestor walk can
      // detect this, which is what makes it a real test of that check rather than
      // of its downward twin.
      await getAdminSql()`
      UPDATE awcms_offices SET parent_office_id = ${REGION} WHERE id = ${HEAD}
    `;
      await getAdminSql()`
      DELETE FROM awcms_offices WHERE id = ${BRANCH_SIBLING}
    `;

      expect((await resolve(TENANT_A, BRANCH)).resolved).toBe(false);
    });

    test("a chain past the depth cap refuses", async () => {
      const shallow = createOfficeScopeHierarchyPortAdapter({ maxDepth: 1 });

      // BRANCH -> REGION is depth 1 (inside the cap); BRANCH -> REGION -> HEAD
      // is depth 2 (past it), so the whole resolution refuses rather than
      // returning the first ancestor and silently dropping the rest.
      expect((await resolve(TENANT_A, BRANCH, shallow)).resolved).toBe(false);
      expect((await resolve(TENANT_A, REGION, shallow)).resolved).toBe(true);
    });

    test("a result set past the count cap refuses", async () => {
      const tiny = createOfficeScopeHierarchyPortAdapter({ maxResults: 2 });

      // HEAD has three descendants; the cap is two.
      expect((await resolve(TENANT_A, HEAD, tiny)).resolved).toBe(false);
      expect((await resolve(TENANT_A, BRANCH, tiny)).resolved).toBe(true);
    });

    test("HEADLINE: a business-scope assignment to a real office now succeeds", async () => {
      await seedTenantUser(TENANT_A, A_SUBJECT, "os-subject");
      await seedTenantUser(TENANT_A, A_ACTOR, "os-actor");

      const created = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        createBusinessScopeAssignment(
          tx,
          TENANT_A,
          A_ACTOR,
          {
            tenantUserId: A_SUBJECT,
            roleId: null,
            scopeType: "office",
            scopeId: BRANCH,
            effectiveFrom: NOW,
            effectiveTo: null,
            isTemporary: false,
            reason: null
          },
          { hierarchyPort: officeScopeHierarchyPortAdapter, sodRules: [] },
          NOW
        )
      );

      expect(created.ok).toBe(true);

      // And the facts the evaluator consumes carry the resolved hierarchy.
      const facts = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        resolveBusinessScopeFacts(
          tx,
          TENANT_A,
          A_SUBJECT,
          NOW,
          officeScopeHierarchyPortAdapter
        )
      );

      expect(facts).toHaveLength(1);
      expect(facts[0]!.resolved).toBe(true);
      expect(facts[0]!.ancestorScopes.map((s) => s.scopeId)).toEqual([
        REGION,
        HEAD
      ]);
    });

    test("an office belonging to another tenant is still refused at assignment time", async () => {
      await seedTenantUser(TENANT_A, A_SUBJECT, "os-subject");
      await seedTenantUser(TENANT_A, A_ACTOR, "os-actor");

      const created = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        createBusinessScopeAssignment(
          tx,
          TENANT_A,
          A_ACTOR,
          {
            tenantUserId: A_SUBJECT,
            roleId: null,
            scopeType: "office",
            scopeId: OFFICE_B,
            effectiveFrom: NOW,
            effectiveTo: null,
            isTemporary: false,
            reason: null
          },
          { hierarchyPort: officeScopeHierarchyPortAdapter, sodRules: [] },
          NOW
        )
      );

      expect(created.ok).toBe(false);
      if (!created.ok) expect(created.reason).toBe("scope_unresolved");
    });

    test("a tenant-wide sentinel row is trusted only when it names THIS tenant", async () => {
      await seedTenantUser(TENANT_A, A_SUBJECT, "os-subject");

      // The service refuses to write the reserved type at all (#180 review F2),
      // so a row like this can only arrive out of band — which is precisely why
      // the read path re-checks it.
      const insertSentinel = async (scopeId: string) => {
        await getAdminSql()`
        DELETE FROM awcms_business_scope_assignments WHERE tenant_id = ${TENANT_A}
      `;
        await getAdminSql()`
        INSERT INTO awcms_business_scope_assignments
          (tenant_id, tenant_user_id, role_id, scope_type, scope_id,
           effective_from, effective_to, is_temporary, reason,
           granted_by_tenant_user_id, status)
        VALUES (
          ${TENANT_A}, ${A_SUBJECT}, NULL, 'tenant', ${scopeId},
          ${NOW}, NULL, false, NULL, ${A_SUBJECT}, 'active'
        )
      `;
        return withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
          resolveBusinessScopeFacts(
            tx,
            TENANT_A,
            A_SUBJECT,
            NOW,
            officeScopeHierarchyPortAdapter
          )
        );
      };

      const own = await insertSentinel(TENANT_A);
      expect(own[0]!.resolved).toBe(true);
      expect(own[0]!.tenantWide).toBe(true);

      // Same reserved scope_type, someone else's id: a covers-everything fact
      // must NOT be minted from it.
      const foreign = await insertSentinel(TENANT_B);
      expect(foreign[0]!.resolved).toBe(false);
      expect(foreign[0]!.tenantWide).toBe(false);
    });
  }
);
