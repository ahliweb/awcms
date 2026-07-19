/**
 * Business-scope hierarchy + assignment integration tests (Issue #180),
 * against a real PostgreSQL under the WORLD-1 ephemeral-database harness.
 * Proves, with real DDL/RLS/FKs (not mocks):
 *
 *   - the hierarchy port + assignment happy path (create/list/revoke) driven
 *     by the DUMMY capability-port resolver from the fixture derived module;
 *   - cross-tenant denial at BOTH layers the issue requires — the composite
 *     `(tenant_id, …)` FKs reject a cross-tenant subject/role at the DB level
 *     (proven as a raw INSERT that bypasses the app), and the hierarchy port
 *     rejects a cross-tenant scope reference at the app level;
 *   - FORCE ROW LEVEL SECURITY tenant isolation on the two new tables, proven
 *     under the non-superuser `awcms_app` role (skips loudly if 019 absent);
 *   - revocation / effective-dating taking effect IMMEDIATELY on the next
 *     authorization decision (no cache);
 *   - the scheduled expiry job transitioning an elapsed assignment;
 *   - a performance bound on a wide+deep hierarchy resolution.
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
  appRoleActivated,
  assertRejected,
  getAdminSql,
  getAppRoleSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenant } from "../../src/lib/database/tenant-context";
import {
  createBusinessScopeAssignment,
  listBusinessScopeAssignments,
  revokeBusinessScopeAssignment
} from "../../src/modules/identity-access/application/business-scope-assignment-service";
import { resolveBusinessScopeFacts } from "../../src/modules/identity-access/application/business-scope-facts";
import { defaultBusinessScopeHierarchyPortAdapter } from "../../src/modules/identity-access/application/business-scope-hierarchy-port-adapter";
import { runBusinessScopeExpiry } from "../../src/modules/identity-access/application/business-scope-expiry-job";
import { evaluateAccess } from "../../src/modules/identity-access/domain/access-control";
import {
  createDummyBusinessScopeHierarchyResolver,
  DUMMY_HIERARCHY_MAX_DEPTH,
  type DummyScopeNode
} from "../fixtures/derived-application-example/modules/example-crm/business-scope-hierarchy-adapter";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// Deterministic ids so the FK/RLS assertions can reference exact rows.
const A_SUBJECT = "a0000000-0000-4000-8000-000000000001";
const A_ACTOR = "a0000000-0000-4000-8000-000000000002";
const A_ROLE = "a0000000-0000-4000-8000-0000000000a1";
const B_SUBJECT = "b0000000-0000-4000-8000-000000000001";
const B_ROLE = "b0000000-0000-4000-8000-0000000000b1";

const OFFICE_A = "a0000000-0000-4000-8000-00000000000f"; // tenant A's scope
const OFFICE_A_CHILD = "a0000000-0000-4000-8000-00000000001f";
const OFFICE_B = "b0000000-0000-4000-8000-00000000000f"; // tenant B's scope

// Dummy hierarchy: tenant A has office OFFICE_A with a child OFFICE_A_CHILD;
// tenant B has its own OFFICE_B. Cross-tenant resolution is impossible because
// the resolver filters by tenantId.
const HIERARCHY: DummyScopeNode[] = [
  { tenantId: TENANT_A, scopeType: "office", scopeId: OFFICE_A, parent: null },
  {
    tenantId: TENANT_A,
    scopeType: "office",
    scopeId: OFFICE_A_CHILD,
    parent: { scopeType: "office", scopeId: OFFICE_A }
  },
  { tenantId: TENANT_B, scopeType: "office", scopeId: OFFICE_B, parent: null }
];
const hierarchyPort = createDummyBusinessScopeHierarchyResolver(HIERARCHY);

async function seedFixtures(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT_A}, 'bs-tenant-a', 'BS Tenant A'),
           (${TENANT_B}, 'bs-tenant-b', 'BS Tenant B')
  `;

  // Two subjects + one actor in tenant A, one subject in tenant B. Each needs
  // a profile -> identity -> tenant_user chain.
  const users: { id: string; tenant: string; label: string }[] = [
    { id: A_SUBJECT, tenant: TENANT_A, label: "a-subject" },
    { id: A_ACTOR, tenant: TENANT_A, label: "a-actor" },
    { id: B_SUBJECT, tenant: TENANT_B, label: "b-subject" }
  ];

  for (const user of users) {
    const profile = (await admin`
      INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
      VALUES (${user.tenant}, 'person', ${`Profile ${user.label}`})
      RETURNING id
    `) as { id: string }[];
    const identity = (await admin`
      INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
      VALUES (${user.tenant}, ${profile[0]!.id}, ${`${user.label}@example.test`}, 'x')
      RETURNING id
    `) as { id: string }[];
    await admin`
      INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
      VALUES (${user.id}, ${user.tenant}, ${identity[0]!.id})
    `;
  }

  await admin`
    INSERT INTO awcms_roles (id, tenant_id, role_code, role_name)
    VALUES (${A_ROLE}, ${TENANT_A}, 'a-role', 'A Role'),
           (${B_ROLE}, ${TENANT_B}, 'b-role', 'B Role')
  `;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("business-scope hierarchy + assignments (Issue #180)", () => {
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

  test("create -> list -> revoke happy path, scope resolved through the dummy capability port", async () => {
    const now = new Date();
    const runtime = getRuntimeSql();

    const created = await withTenant(runtime, TENANT_A, (tx) =>
      createBusinessScopeAssignment(
        tx,
        TENANT_A,
        A_ACTOR,
        {
          tenantUserId: A_SUBJECT,
          roleId: A_ROLE,
          scopeType: "office",
          scopeId: OFFICE_A,
          effectiveFrom: now,
          effectiveTo: null,
          isTemporary: false,
          reason: "onboarding"
        },
        { hierarchyPort, sodRules: [] },
        now
      )
    );
    expect(created.ok).toBe(true);

    const list = await withTenant(runtime, TENANT_A, (tx) =>
      listBusinessScopeAssignments(tx, TENANT_A, {})
    );
    expect(list.length).toBe(1);
    expect(list[0]!.scopeId).toBe(OFFICE_A);
    expect(list[0]!.status).toBe("active");

    // Lifecycle event recorded (append-only).
    const events = (await getAdminSql()`
      SELECT event_type FROM awcms_business_scope_assignment_events
      WHERE tenant_id = ${TENANT_A} ORDER BY occurred_at
    `) as { event_type: string }[];
    expect(events.map((e) => e.event_type)).toEqual(["granted"]);

    const assignmentId = list[0]!.id;
    const revoked = await withTenant(runtime, TENANT_A, (tx) =>
      revokeBusinessScopeAssignment(tx, TENANT_A, A_ACTOR, assignmentId, {
        revokeReason: "left the office"
      })
    );
    expect(revoked.ok).toBe(true);
    if (revoked.ok) expect(revoked.assignment.status).toBe("revoked");
  });

  test("self-grant is denied", async () => {
    const now = new Date();
    const result = await withTenant(getRuntimeSql(), TENANT_A, (tx) =>
      createBusinessScopeAssignment(
        tx,
        TENANT_A,
        A_SUBJECT, // actor === subject
        {
          tenantUserId: A_SUBJECT,
          roleId: null,
          scopeType: "office",
          scopeId: OFFICE_A,
          effectiveFrom: now,
          effectiveTo: null,
          isTemporary: false,
          reason: null
        },
        { hierarchyPort, sodRules: [] },
        now
      )
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("self_grant_denied");
  });

  test("F3: self-grant is denied BEFORE scope resolution — reachable even with the base no-op resolver", async () => {
    const now = new Date();
    // The base no-op resolver returns resolved:false for OFFICE_A, so if the
    // self-grant check ran AFTER resolveScope the result would be
    // SCOPE_UNRESOLVED. It must be SELF_GRANT_DENIED (identity guard first).
    const result = await withTenant(getRuntimeSql(), TENANT_A, (tx) =>
      createBusinessScopeAssignment(
        tx,
        TENANT_A,
        A_SUBJECT, // actor === subject
        {
          tenantUserId: A_SUBJECT,
          roleId: null,
          scopeType: "office",
          scopeId: OFFICE_A,
          effectiveFrom: now,
          effectiveTo: null,
          isTemporary: false,
          reason: null
        },
        {
          hierarchyPort: defaultBusinessScopeHierarchyPortAdapter,
          sodRules: []
        },
        now
      )
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("self_grant_denied");
  });

  test("F2: the reserved 'tenant' scope_type cannot be stored as an assignment", async () => {
    const now = new Date();
    const result = await withTenant(getRuntimeSql(), TENANT_A, (tx) =>
      createBusinessScopeAssignment(
        tx,
        TENANT_A,
        A_ACTOR,
        {
          tenantUserId: A_SUBJECT,
          roleId: null,
          scopeType: "tenant", // reserved tenant-wide sentinel
          scopeId: TENANT_A,
          effectiveFrom: now,
          effectiveTo: null,
          isTemporary: false,
          reason: null
        },
        { hierarchyPort, sodRules: [] },
        now
      )
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("validation");
      if (result.reason === "validation") {
        expect(result.errors.some((e) => /reserved/i.test(e.message))).toBe(
          true
        );
      }
    }
  });

  test("cross-tenant SCOPE reference is denied at the app layer (port resolves nothing for the wrong tenant)", async () => {
    const now = new Date();
    // tenant A subject, but a scope id that only exists under tenant B.
    const result = await withTenant(getRuntimeSql(), TENANT_A, (tx) =>
      createBusinessScopeAssignment(
        tx,
        TENANT_A,
        A_ACTOR,
        {
          tenantUserId: A_SUBJECT,
          roleId: null,
          scopeType: "office",
          scopeId: OFFICE_B,
          effectiveFrom: now,
          effectiveTo: null,
          isTemporary: false,
          reason: null
        },
        { hierarchyPort, sodRules: [] },
        now
      )
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("scope_unresolved");
  });

  test("cross-tenant SUBJECT reference is denied by the composite (tenant_id, tenant_user_id) FK (raw INSERT bypassing the app)", async () => {
    const error = await withTenant(getRuntimeSql(), TENANT_A, (tx) =>
      assertRejected(
        tx`
          INSERT INTO awcms_business_scope_assignments
            (tenant_id, tenant_user_id, scope_type, scope_id, granted_by_tenant_user_id, status)
          VALUES (${TENANT_A}, ${B_SUBJECT}, 'office', ${OFFICE_A}, ${A_ACTOR}, 'active')
        `,
        "a tenant-A assignment referencing a tenant-B subject"
      )
    );
    expect(
      String((error as { errno?: string }).errno ?? error.message)
    ).toContain("23503");
  });

  test("cross-tenant ROLE reference is denied by the composite (tenant_id, role_id) FK (raw INSERT bypassing the app)", async () => {
    const error = await withTenant(getRuntimeSql(), TENANT_A, (tx) =>
      assertRejected(
        tx`
          INSERT INTO awcms_business_scope_assignments
            (tenant_id, tenant_user_id, role_id, scope_type, scope_id, granted_by_tenant_user_id, status)
          VALUES (${TENANT_A}, ${A_SUBJECT}, ${B_ROLE}, 'office', ${OFFICE_A}, ${A_ACTOR}, 'active')
        `,
        "a tenant-A assignment referencing a tenant-B role"
      )
    );
    expect(
      String((error as { errno?: string }).errno ?? error.message)
    ).toContain("23503");
  });

  test("FORCE RLS isolates the assignment table across tenants under non-superuser awcms_app", async () => {
    if (!appRoleActivated) {
      console.warn(
        "SKIP awcms_app RLS assertion — migration 019 role not activated in this environment."
      );
      return;
    }
    const now = new Date();
    // Seed one tenant-A assignment through the owner/app runtime.
    await withTenant(getRuntimeSql(), TENANT_A, (tx) =>
      createBusinessScopeAssignment(
        tx,
        TENANT_A,
        A_ACTOR,
        {
          tenantUserId: A_SUBJECT,
          roleId: null,
          scopeType: "office",
          scopeId: OFFICE_A,
          effectiveFrom: now,
          effectiveTo: null,
          isTemporary: false,
          reason: null
        },
        { hierarchyPort, sodRules: [] },
        now
      )
    );

    const app = getAppRoleSql();
    // Control: with the GUC on tenant A, awcms_app sees the row.
    const visible = await withTenant(app, TENANT_A, (tx) =>
      tx`SELECT id FROM awcms_business_scope_assignments`.then(
        (r) => r as { id: string }[]
      )
    );
    expect(visible.length).toBe(1);

    // Isolation: with the GUC on tenant B, awcms_app sees ZERO tenant-A rows.
    const hidden = await withTenant(app, TENANT_B, (tx) =>
      tx`SELECT id FROM awcms_business_scope_assignments`.then(
        (r) => r as { id: string }[]
      )
    );
    expect(hidden.length).toBe(0);
  });

  test("revocation takes effect IMMEDIATELY on the next authorization decision (no cache)", async () => {
    const now = new Date();
    const runtime = getRuntimeSql();

    await withTenant(runtime, TENANT_A, (tx) =>
      createBusinessScopeAssignment(
        tx,
        TENANT_A,
        A_ACTOR,
        {
          tenantUserId: A_SUBJECT,
          roleId: A_ROLE,
          scopeType: "office",
          scopeId: OFFICE_A,
          effectiveFrom: now,
          effectiveTo: null,
          isTemporary: false,
          reason: null
        },
        { hierarchyPort, sodRules: [] },
        now
      )
    );

    const contextA = {
      tenantId: TENANT_A,
      tenantUserId: A_SUBJECT,
      identityId: "identity",
      roles: []
    };
    const scopedRead = {
      moduleKey: "sales",
      activityCode: "orders",
      action: "read" as const,
      resourceAttributes: {
        requiredScopeType: "office",
        requiredScopeId: OFFICE_A
      }
    };
    const granted = new Set(["sales.orders.read"]);

    // Before revoke — the subject's facts cover the required scope.
    const factsBefore = await withTenant(runtime, TENANT_A, (tx) =>
      resolveBusinessScopeFacts(
        tx,
        TENANT_A,
        A_SUBJECT,
        new Date(),
        hierarchyPort
      )
    );
    expect(
      evaluateAccess(contextA, scopedRead, granted, factsBefore).allowed
    ).toBe(true);

    // Revoke, then re-resolve facts at the same instant — coverage is gone.
    const list = await withTenant(runtime, TENANT_A, (tx) =>
      listBusinessScopeAssignments(tx, TENANT_A, {})
    );
    await withTenant(runtime, TENANT_A, (tx) =>
      revokeBusinessScopeAssignment(tx, TENANT_A, A_ACTOR, list[0]!.id, {
        revokeReason: "immediate"
      })
    );

    const factsAfter = await withTenant(runtime, TENANT_A, (tx) =>
      resolveBusinessScopeFacts(
        tx,
        TENANT_A,
        A_SUBJECT,
        new Date(),
        hierarchyPort
      )
    );
    const decisionAfter = evaluateAccess(
      contextA,
      scopedRead,
      granted,
      factsAfter
    );
    expect(decisionAfter.allowed).toBe(false);
    expect(decisionAfter.matchedPolicy).toBe("business_scope_unresolved");
  });

  test("descendant coverage resolves end-to-end through the dummy port (assigned parent office covers a child office)", async () => {
    const now = new Date();
    const runtime = getRuntimeSql();
    await withTenant(runtime, TENANT_A, (tx) =>
      createBusinessScopeAssignment(
        tx,
        TENANT_A,
        A_ACTOR,
        {
          tenantUserId: A_SUBJECT,
          roleId: A_ROLE,
          scopeType: "office",
          scopeId: OFFICE_A, // parent
          effectiveFrom: now,
          effectiveTo: null,
          isTemporary: false,
          reason: null
        },
        { hierarchyPort, sodRules: [] },
        now
      )
    );

    const facts = await withTenant(runtime, TENANT_A, (tx) =>
      resolveBusinessScopeFacts(
        tx,
        TENANT_A,
        A_SUBJECT,
        new Date(),
        hierarchyPort
      )
    );

    const decision = evaluateAccess(
      {
        tenantId: TENANT_A,
        tenantUserId: A_SUBJECT,
        identityId: "identity",
        roles: []
      },
      {
        moduleKey: "sales",
        activityCode: "orders",
        action: "read",
        resourceAttributes: {
          requiredScopeType: "office",
          requiredScopeId: OFFICE_A_CHILD, // the CHILD, covered via descendant
          requiredScopeRelations: ["exact", "descendant"]
        }
      },
      new Set(["sales.orders.read"]),
      facts
    );
    expect(decision.allowed).toBe(true);
  });

  test("the scheduled expiry job transitions an elapsed assignment to expired and records the event", async () => {
    const admin = getAdminSql();
    const past = new Date(Date.now() - 60_000);
    const older = new Date(Date.now() - 120_000);

    // Seed an elapsed but still-active assignment directly (cross-RLS admin).
    const seeded = (await admin`
      INSERT INTO awcms_business_scope_assignments
        (tenant_id, tenant_user_id, scope_type, scope_id, effective_from, effective_to,
         is_temporary, granted_by_tenant_user_id, status)
      VALUES (${TENANT_A}, ${A_SUBJECT}, 'office', ${OFFICE_A}, ${older}, ${past},
              true, ${A_ACTOR}, 'active')
      RETURNING id
    `) as { id: string }[];
    const assignmentId = seeded[0]!.id;

    const ctx = {
      runId: "test-expiry-run",
      correlationId: "test-expiry",
      dryRun: false,
      signal: new AbortController().signal
    };
    const result = await runBusinessScopeExpiry(getRuntimeSql(), ctx);
    expect(result.assignmentsExpired).toBeGreaterThanOrEqual(1);

    const rows = (await admin`
      SELECT status FROM awcms_business_scope_assignments WHERE id = ${assignmentId}
    `) as { status: string }[];
    expect(rows[0]!.status).toBe("expired");

    const events = (await admin`
      SELECT event_type FROM awcms_business_scope_assignment_events
      WHERE assignment_id = ${assignmentId}
    `) as { event_type: string }[];
    expect(events.map((e) => e.event_type)).toContain("expired");
  });

  test("performance: resolving one scope over a wide+deep hierarchy stays within a realistic bound", async () => {
    // 2000-node hierarchy: a spine of 500 deep, each spine node fanning out to
    // 3 leaves. In-memory dummy resolver -> O(N) per resolve; a real derived
    // adapter would bound depth/nodes in SQL. Asserts the resolution is bounded
    // and fast, exercising the "wide and deep hierarchy" requirement.
    const nodes: DummyScopeNode[] = [];
    const spineDepth = 500;
    for (let i = 0; i < spineDepth; i += 1) {
      nodes.push({
        tenantId: TENANT_A,
        scopeType: "unit",
        scopeId: `spine-${i}`,
        parent:
          i === 0 ? null : { scopeType: "unit", scopeId: `spine-${i - 1}` }
      });
      for (let j = 0; j < 3; j += 1) {
        nodes.push({
          tenantId: TENANT_A,
          scopeType: "unit",
          scopeId: `leaf-${i}-${j}`,
          parent: { scopeType: "unit", scopeId: `spine-${i}` }
        });
      }
    }
    const bigResolver = createDummyBusinessScopeHierarchyResolver(nodes);
    const totalDescendants = nodes.length - 1; // every node except the queried root

    const startedAt = performance.now();
    const res = await bigResolver.resolveScope(
      null as unknown as Bun.SQL,
      TENANT_A,
      "unit",
      "spine-0"
    );
    const elapsedMs = performance.now() - startedAt;

    expect(res.resolved).toBe(true);
    expect(res.descendantScopes.length).toBeGreaterThan(0);

    // The PRIMARY proof of the "realistic bound" acceptance criterion: the
    // depth cap actually ENGAGED. The spine is 500 deep, so a full traversal
    // would return ~1999 descendants; the dummy resolver's BFS stops at
    // DUMMY_HIERARCHY_MAX_DEPTH (64) levels, each level contributing one spine
    // node + 3 leaves, so the result is bounded to ~64*4 and is STRICTLY LESS
    // than the full tree. If the cap regressed (removed), this count would jump
    // to the full ~1999 and both bounds below would fail.
    expect(res.descendantScopes.length).toBeLessThan(totalDescendants);
    expect(res.descendantScopes.length).toBeLessThanOrEqual(
      DUMMY_HIERARCHY_MAX_DEPTH * 4
    );

    // Secondary sanity: a bounded traversal is also fast.
    expect(elapsedMs).toBeLessThan(1000);
  });
});
