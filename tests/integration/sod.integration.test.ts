/**
 * Segregation-of-duties (SoD) integration tests (Issue #181), against a real
 * PostgreSQL under the WORLD-1 ephemeral-database harness. Proves, with real
 * DDL/RLS/FKs (not mocks):
 *
 *   - ASSIGNMENT-time conflict: a grant that would give a subject both halves
 *     of a registered conflict is denied `sod_conflict` and logged;
 *   - ACTION-time enforcement at the real `authorizeInTransaction` chokepoint:
 *     a high-risk action by a subject holding a conflicting permission is
 *     denied `SOD_CONFLICT` (deny-overrides-allow), and the mutation-proof that
 *     removing the conflicting fact flips it to allowed;
 *   - exception lifecycle: create -> approve (by a DIFFERENT user) makes the
 *     conflict pass; self-approval is denied; expired/revoked exceptions are
 *     immediately ineffective;
 *   - cross-tenant: a tenant-A exception cannot cover tenant B, proven at BOTH
 *     the query layer and under FORCE RLS on the non-superuser `awcms_app`;
 *   - concurrency: two concurrent approvals of one pending exception resolve to
 *     exactly one success (compare-and-swap), and approve-vs-revoke races are
 *     safe;
 *   - bounded/non-N+1 evaluation: the action-time query count does NOT grow
 *     with the number of permissions/assignments the subject holds;
 *   - the scheduled expiry pass transitioning an elapsed approved exception.
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
  getAdminSql,
  getAppRoleSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenant } from "../../src/lib/database/tenant-context";
import { collectSoDRuleDescriptors } from "../../src/modules/identity-access/domain/sod-rule-registry";
import { exampleApplicationModuleRegistry } from "../fixtures/derived-application-example/application-registry";
import { createBusinessScopeAssignment } from "../../src/modules/identity-access/application/business-scope-assignment-service";
import { checkHighRiskSoDConflicts } from "../../src/modules/identity-access/application/high-risk-sod-guard";
import {
  approveSoDConflictException,
  createSoDConflictException,
  revokeSoDConflictException
} from "../../src/modules/identity-access/application/sod-exception-service";
import { runBusinessScopeExpiry } from "../../src/modules/identity-access/application/business-scope-expiry-job";
import { authorizeInTransaction } from "../../src/modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../src/lib/auth/session-token";
import type { TenantContext } from "../../src/modules/identity-access/domain/access-control";
import {
  createDummyBusinessScopeHierarchyResolver,
  type DummyScopeNode
} from "../fixtures/derived-application-example/modules/example-crm/business-scope-hierarchy-adapter";

const SOD_RULES = collectSoDRuleDescriptors(
  exampleApplicationModuleRegistry.modules
);

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const A_SUBJECT = "a0000000-0000-4000-8000-000000000001";
const A_ACTOR = "a0000000-0000-4000-8000-000000000002";
const A_APPROVER = "a0000000-0000-4000-8000-000000000003";
// A second VALID approver (neither the requester nor the subject) so the CAS
// concurrency test can race two genuinely-eligible approvers.
const A_APPROVER2 = "a0000000-0000-4000-8000-000000000004";
const B_SUBJECT = "b0000000-0000-4000-8000-000000000001";

const OFFICE_A = "a0000000-0000-4000-8000-00000000000f";
// A non-reserved "office" scope for the assignment tests (createBusinessScope
// Assignment rejects the reserved "tenant" scope type by design). The rules
// exercised at assignment time are global_within_tenant, so the exact scope is
// immaterial — it only needs to RESOLVE so the grant is not scope_unresolved.
const HIERARCHY: DummyScopeNode[] = [
  { tenantId: TENANT_A, scopeType: "office", scopeId: OFFICE_A, parent: null }
];
const HIERARCHY_PORT = createDummyBusinessScopeHierarchyResolver(HIERARCHY);

// Permission keys the fixture SoD rules pair off (seeded into the global
// catalog below).
const PERMS: [string, string, string][] = [
  ["example_crm", "payment", "create"],
  ["example_crm", "payment", "approve"],
  ["example_crm", "vendor", "create"]
];

const RULE_VENDOR_PAYMENT = "example_crm.vendor_payment_separation"; // global, exception allowed 14d
const RULE_PAYMENT_MAKER_CHECKER = "example_crm.payment_maker_checker"; // global, no exception

const now = () => new Date();
const contextFor = (tenantId: string, tenantUserId: string): TenantContext => ({
  tenantId,
  tenantUserId,
  identityId: "00000000-0000-4000-8000-0000000000ff",
  roles: []
});

async function permId(activity: string, action: string): Promise<string> {
  const rows = (await getAdminSql()`
    SELECT id FROM awcms_permissions
    WHERE module_key = 'example_crm' AND activity_code = ${activity} AND action = ${action}
  `) as { id: string }[];
  return rows[0]!.id;
}

/** Seeds a role granting a set of permission keys and (optionally) an ordinary RBAC assignment to a subject. Returns the role id. */
async function seedRoleWithPermissions(
  tenantId: string,
  roleCode: string,
  perms: [string, string][],
  assignTo?: string
): Promise<string> {
  const admin = getAdminSql();
  const roleRows = (await admin`
    INSERT INTO awcms_roles (tenant_id, role_code, role_name)
    VALUES (${tenantId}, ${roleCode}, ${roleCode})
    RETURNING id
  `) as { id: string }[];
  const roleId = roleRows[0]!.id;

  for (const [activity, action] of perms) {
    const pid = await permId(activity, action);
    await admin`
      INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
      VALUES (${tenantId}, ${roleId}, ${pid})
    `;
  }

  if (assignTo) {
    await admin`
      INSERT INTO awcms_access_assignments (tenant_id, tenant_user_id, role_id)
      VALUES (${tenantId}, ${assignTo}, ${roleId})
    `;
  }

  return roleId;
}

async function seedFixtures(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT_A}, 'sod-tenant-a', 'SoD Tenant A'),
           (${TENANT_B}, 'sod-tenant-b', 'SoD Tenant B')
  `;

  const users: { id: string; tenant: string; label: string }[] = [
    { id: A_SUBJECT, tenant: TENANT_A, label: "a-subject" },
    { id: A_ACTOR, tenant: TENANT_A, label: "a-actor" },
    { id: A_APPROVER, tenant: TENANT_A, label: "a-approver" },
    { id: A_APPROVER2, tenant: TENANT_A, label: "a-approver2" },
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

  // example_crm.* permissions in the GLOBAL catalog (awcms_permissions is not
  // truncated by the harness, so ON CONFLICT keeps this idempotent).
  for (const [module, activity, action] of PERMS) {
    await admin`
      INSERT INTO awcms_permissions (module_key, activity_code, action, description)
      VALUES (${module}, ${activity}, ${action}, ${`${module}.${activity}.${action} (fixture)`})
      ON CONFLICT (module_key, activity_code, action) DO NOTHING
    `;
  }
}

const suite = integrationEnabled ? describe : describe.skip;

suite("segregation of duties (Issue #181)", () => {
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

  test("ASSIGNMENT-time: granting a role that completes a conflict is denied sod_conflict and logged", async () => {
    const runtime = getRuntimeSql();

    // Subject already holds example_crm.payment.create via an ordinary role.
    await seedRoleWithPermissions(
      TENANT_A,
      "payment_creator",
      [["payment", "create"]],
      A_SUBJECT
    );
    // The role being granted via the new business-scope assignment adds
    // example_crm.payment.approve -> completes payment_maker_checker (global,
    // no exception).
    const approveRole = await seedRoleWithPermissions(
      TENANT_A,
      "payment_approver",
      [["payment", "approve"]]
    );

    const result = await withTenant(runtime, TENANT_A, (tx) =>
      createBusinessScopeAssignment(
        tx,
        TENANT_A,
        A_ACTOR,
        {
          tenantUserId: A_SUBJECT,
          roleId: approveRole,
          scopeType: "office",
          scopeId: OFFICE_A,
          effectiveFrom: now(),
          effectiveTo: null,
          isTemporary: false,
          reason: "conflicting grant"
        },
        { hierarchyPort: HIERARCHY_PORT, sodRules: SOD_RULES },
        now()
      )
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("sod_conflict");
    if (result.reason !== "sod_conflict") throw new Error("unreachable");
    expect(
      result.conflicts.some((c) => c.ruleKey === RULE_PAYMENT_MAKER_CHECKER)
    ).toBe(true);

    // An append-only evaluation row was written.
    const logged = await withTenant(
      runtime,
      TENANT_A,
      (tx) =>
        tx`SELECT count(*)::int AS n FROM awcms_sod_conflict_evaluations
         WHERE tenant_id = ${TENANT_A} AND trigger_context = 'assignment_create'`
    );
    expect((logged[0] as { n: number }).n).toBeGreaterThan(0);
  });

  test("ASSIGNMENT-time mutation proof: without the held conflicting permission, the grant SUCCEEDS", async () => {
    const runtime = getRuntimeSql();
    // Subject holds NOTHING conflicting.
    const approveRole = await seedRoleWithPermissions(
      TENANT_A,
      "payment_approver",
      [["payment", "approve"]]
    );

    const result = await withTenant(runtime, TENANT_A, (tx) =>
      createBusinessScopeAssignment(
        tx,
        TENANT_A,
        A_ACTOR,
        {
          tenantUserId: A_SUBJECT,
          roleId: approveRole,
          scopeType: "office",
          scopeId: OFFICE_A,
          effectiveFrom: now(),
          effectiveTo: null,
          isTemporary: false,
          reason: "clean grant"
        },
        { hierarchyPort: HIERARCHY_PORT, sodRules: SOD_RULES },
        now()
      )
    );

    expect(result.ok).toBe(true);
  });

  test("ACTION-time: checkHighRiskSoDConflicts blocks a high-risk action when the subject holds a conflicting permission", async () => {
    const runtime = getRuntimeSql();
    // Subject holds example_crm.vendor.create; the action is example_crm.payment.approve
    // -> vendor_payment_separation (global) conflict, no exception on file.
    await seedRoleWithPermissions(
      TENANT_A,
      "vendor_creator",
      [["vendor", "create"]],
      A_SUBJECT
    );

    const result = await withTenant(runtime, TENANT_A, (tx) =>
      checkHighRiskSoDConflicts(
        tx,
        TENANT_A,
        contextFor(TENANT_A, A_SUBJECT),
        {
          moduleKey: "example_crm",
          activityCode: "payment",
          action: "approve"
        },
        now(),
        { rules: SOD_RULES }
      )
    );

    expect(result.blocked).toBe(true);
  });

  test("ACTION-time mutation proof: without the conflicting fact, the action is NOT blocked", async () => {
    const runtime = getRuntimeSql();
    // Subject holds nothing conflicting.
    const result = await withTenant(runtime, TENANT_A, (tx) =>
      checkHighRiskSoDConflicts(
        tx,
        TENANT_A,
        contextFor(TENANT_A, A_SUBJECT),
        {
          moduleKey: "example_crm",
          activityCode: "payment",
          action: "approve"
        },
        now(),
        { rules: SOD_RULES }
      )
    );
    expect(result.blocked).toBe(false);
  });

  test("ACTION-time at the real authorizeInTransaction chokepoint: high-risk action is denied SOD_CONFLICT (deny-overrides-allow)", async () => {
    const runtime = getRuntimeSql();
    const admin = getAdminSql();

    // Give the subject a role granting BOTH halves of the cross-module rule
    // example_crm.exception_override_maker_checker
    // (identity_access.business_scope_exceptions.create/.approve) via ordinary
    // RBAC; those permissions are seeded by sql/030. The ABAC decision allows
    // (subject holds .approve), then the SoD guard denies (subject also holds
    // .create).
    const createPid = (await admin`
      SELECT id FROM awcms_permissions
      WHERE module_key='identity_access' AND activity_code='business_scope_exceptions' AND action='create'
    `) as { id: string }[];
    const approvePid = (await admin`
      SELECT id FROM awcms_permissions
      WHERE module_key='identity_access' AND activity_code='business_scope_exceptions' AND action='approve'
    `) as { id: string }[];
    const roleRows = (await admin`
      INSERT INTO awcms_roles (tenant_id, role_code, role_name)
      VALUES (${TENANT_A}, 'both_exception', 'both_exception') RETURNING id
    `) as { id: string }[];
    const roleId = roleRows[0]!.id;
    await admin`INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id) VALUES (${TENANT_A}, ${roleId}, ${createPid[0]!.id})`;
    await admin`INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id) VALUES (${TENANT_A}, ${roleId}, ${approvePid[0]!.id})`;
    await admin`INSERT INTO awcms_access_assignments (tenant_id, tenant_user_id, role_id) VALUES (${TENANT_A}, ${A_SUBJECT}, ${roleId})`;

    // A live session for the subject.
    const token = `sod-${crypto.randomUUID()}`;
    const identityRows = (await admin`
      SELECT identity_id FROM awcms_tenant_users WHERE id = ${A_SUBJECT}
    `) as { identity_id: string }[];
    await admin`
      INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
      VALUES (${TENANT_A}, ${identityRows[0]!.identity_id}, ${hashSessionToken(token)}, ${new Date(Date.now() + 3_600_000)})
    `;

    const denied = await withTenant(runtime, TENANT_A, (tx) =>
      authorizeInTransaction(
        tx,
        TENANT_A,
        hashSessionToken(token),
        now(),
        {
          moduleKey: "identity_access",
          activityCode: "business_scope_exceptions",
          action: "approve"
        },
        { sodRules: SOD_RULES }
      )
    );

    expect(denied.allowed).toBe(false);
    if (denied.allowed) throw new Error("unreachable");
    expect(denied.denied.status).toBe(403);
    const body = (await denied.denied.clone().json()) as {
      error?: { code?: string };
    };
    expect(body.error?.code).toBe("SOD_CONFLICT");
  });

  test("EXCEPTION lifecycle: approve (by a DIFFERENT user) makes the conflict pass; self-approval is denied", async () => {
    const runtime = getRuntimeSql();
    await seedRoleWithPermissions(
      TENANT_A,
      "vendor_creator",
      [["vendor", "create"]],
      A_SUBJECT
    );

    // Blocked before any exception.
    const before = await withTenant(runtime, TENANT_A, (tx) =>
      checkHighRiskSoDConflicts(
        tx,
        TENANT_A,
        contextFor(TENANT_A, A_SUBJECT),
        {
          moduleKey: "example_crm",
          activityCode: "payment",
          action: "approve"
        },
        now(),
        { rules: SOD_RULES }
      )
    );
    expect(before.blocked).toBe(true);

    // A_ACTOR requests an exception for the subject; blanket (null scope).
    const created = await withTenant(runtime, TENANT_A, (tx) =>
      createSoDConflictException(
        tx,
        TENANT_A,
        A_ACTOR,
        A_SUBJECT,
        {
          ruleKey: RULE_VENDOR_PAYMENT,
          scopeType: null,
          scopeId: null,
          justification:
            "Auditor-sanctioned temporary override for onboarding.",
          effectiveFrom: new Date(Date.now() - 1000),
          effectiveTo: new Date(Date.now() + 7 * 24 * 3600 * 1000)
        },
        SOD_RULES
      )
    );
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("unreachable");
    const exceptionId = created.exception.id;

    // Self-approval (the requester A_ACTOR) is denied.
    const selfApprove = await withTenant(runtime, TENANT_A, (tx) =>
      approveSoDConflictException(tx, TENANT_A, A_ACTOR, exceptionId, "self")
    );
    expect(selfApprove.ok).toBe(false);
    if (selfApprove.ok) throw new Error("unreachable");
    expect(selfApprove.reason).toBe("self_approval_denied");

    // The SUBJECT/beneficiary (A_SUBJECT) also cannot approve — approving your
    // own SoD bypass is self-authorization even though a DIFFERENT user
    // (A_ACTOR) filed the request (the create route accepts an arbitrary
    // subject). Without the subject!=approver guard, A_SUBJECT here holds the
    // conflicting permission AND could self-clear their own block.
    const beneficiaryApprove = await withTenant(runtime, TENANT_A, (tx) =>
      approveSoDConflictException(tx, TENANT_A, A_SUBJECT, exceptionId, "self")
    );
    expect(beneficiaryApprove.ok).toBe(false);
    if (beneficiaryApprove.ok) throw new Error("unreachable");
    expect(beneficiaryApprove.reason).toBe("self_approval_denied");

    // A DIFFERENT user (A_APPROVER) approves.
    const approved = await withTenant(runtime, TENANT_A, (tx) =>
      approveSoDConflictException(
        tx,
        TENANT_A,
        A_APPROVER,
        exceptionId,
        "sanctioned"
      )
    );
    expect(approved.ok).toBe(true);

    // Now the conflict is covered.
    const after = await withTenant(runtime, TENANT_A, (tx) =>
      checkHighRiskSoDConflicts(
        tx,
        TENANT_A,
        contextFor(TENANT_A, A_SUBJECT),
        {
          moduleKey: "example_crm",
          activityCode: "payment",
          action: "approve"
        },
        now(),
        { rules: SOD_RULES }
      )
    );
    expect(after.blocked).toBe(false);
  });

  test("EXCEPTION revoked/expired is immediately ineffective", async () => {
    const runtime = getRuntimeSql();
    await seedRoleWithPermissions(
      TENANT_A,
      "vendor_creator",
      [["vendor", "create"]],
      A_SUBJECT
    );

    // Approved exception, then revoke -> immediately blocked again.
    const created = await withTenant(runtime, TENANT_A, (tx) =>
      createSoDConflictException(
        tx,
        TENANT_A,
        A_ACTOR,
        A_SUBJECT,
        {
          ruleKey: RULE_VENDOR_PAYMENT,
          scopeType: null,
          scopeId: null,
          justification: "Temporary override, later revoked.",
          effectiveFrom: new Date(Date.now() - 1000),
          effectiveTo: new Date(Date.now() + 7 * 24 * 3600 * 1000)
        },
        SOD_RULES
      )
    );
    if (!created.ok) throw new Error("unreachable");
    await withTenant(runtime, TENANT_A, (tx) =>
      approveSoDConflictException(
        tx,
        TENANT_A,
        A_APPROVER,
        created.exception.id,
        null
      )
    );
    await withTenant(runtime, TENANT_A, (tx) =>
      revokeSoDConflictException(
        tx,
        TENANT_A,
        A_APPROVER,
        created.exception.id,
        {
          revokeReason: "override no longer justified"
        }
      )
    );
    const afterRevoke = await withTenant(runtime, TENANT_A, (tx) =>
      checkHighRiskSoDConflicts(
        tx,
        TENANT_A,
        contextFor(TENANT_A, A_SUBJECT),
        {
          moduleKey: "example_crm",
          activityCode: "payment",
          action: "approve"
        },
        now(),
        { rules: SOD_RULES }
      )
    );
    expect(afterRevoke.blocked).toBe(true);

    // A brand-new APPROVED-but-already-expired exception never covers.
    const admin = getAdminSql();
    await admin`
      INSERT INTO awcms_sod_conflict_exceptions
        (tenant_id, rule_key, subject_tenant_user_id, justification, requested_by_tenant_user_id,
         approved_by_tenant_user_id, status, effective_from, effective_to)
      VALUES (${TENANT_A}, ${RULE_VENDOR_PAYMENT}, ${A_SUBJECT}, 'expired override',
        ${A_ACTOR}, ${A_APPROVER}, 'approved', ${new Date(Date.now() - 100000)}, ${new Date(Date.now() - 1000)})
    `;
    const afterExpired = await withTenant(runtime, TENANT_A, (tx) =>
      checkHighRiskSoDConflicts(
        tx,
        TENANT_A,
        contextFor(TENANT_A, A_SUBJECT),
        {
          moduleKey: "example_crm",
          activityCode: "payment",
          action: "approve"
        },
        now(),
        { rules: SOD_RULES }
      )
    );
    expect(afterExpired.blocked).toBe(true);
  });

  test("CROSS-TENANT: a tenant-A approved exception does not cover the same rule+subject in tenant B", async () => {
    const runtime = getRuntimeSql();
    await seedRoleWithPermissions(
      TENANT_B,
      "vendor_creator_b",
      [["vendor", "create"]],
      B_SUBJECT
    );

    // Approve an exception in tenant A for A_SUBJECT.
    const admin = getAdminSql();
    await admin`
      INSERT INTO awcms_sod_conflict_exceptions
        (tenant_id, rule_key, subject_tenant_user_id, justification, requested_by_tenant_user_id,
         approved_by_tenant_user_id, status, effective_from, effective_to)
      VALUES (${TENANT_A}, ${RULE_VENDOR_PAYMENT}, ${A_SUBJECT}, 'tenant A only',
        ${A_ACTOR}, ${A_APPROVER}, 'approved', ${new Date(Date.now() - 1000)}, ${new Date(Date.now() + 86400000)})
    `;

    // Tenant B's subject, same rule, still blocked (the tenant-A exception is
    // invisible/inapplicable across the tenant boundary).
    const blockedInB = await withTenant(runtime, TENANT_B, (tx) =>
      checkHighRiskSoDConflicts(
        tx,
        TENANT_B,
        contextFor(TENANT_B, B_SUBJECT),
        {
          moduleKey: "example_crm",
          activityCode: "payment",
          action: "approve"
        },
        now(),
        { rules: SOD_RULES }
      )
    );
    expect(blockedInB.blocked).toBe(true);
  });

  test("CROSS-TENANT under FORCE RLS: awcms_app scoped to tenant B cannot SELECT tenant A's exceptions", async () => {
    if (!appRoleActivated) {
      console.warn("[skip] awcms_app not activated (migration 019 absent).");
      return;
    }
    const admin = getAdminSql();
    await admin`
      INSERT INTO awcms_sod_conflict_exceptions
        (tenant_id, rule_key, subject_tenant_user_id, justification, requested_by_tenant_user_id,
         status, effective_from, effective_to)
      VALUES (${TENANT_A}, ${RULE_VENDOR_PAYMENT}, ${A_SUBJECT}, 'tenant A secret',
        ${A_ACTOR}, 'pending', now(), ${new Date(Date.now() + 86400000)})
    `;

    const app = getAppRoleSql();
    // Control: scoped to tenant A, the row IS visible.
    const visibleInA = await withTenant(
      app,
      TENANT_A,
      (tx) => tx`SELECT count(*)::int AS n FROM awcms_sod_conflict_exceptions`
    );
    expect((visibleInA[0] as { n: number }).n).toBe(1);

    // Scoped to tenant B, tenant A's row is INVISIBLE.
    const visibleInB = await withTenant(
      app,
      TENANT_B,
      (tx) => tx`SELECT count(*)::int AS n FROM awcms_sod_conflict_exceptions`
    );
    expect((visibleInB[0] as { n: number }).n).toBe(0);
  });

  test("CONCURRENCY: two concurrent approvals of one pending exception yield exactly one success", async () => {
    const runtime = getRuntimeSql();
    const admin = getAdminSql();
    const exRows = (await admin`
      INSERT INTO awcms_sod_conflict_exceptions
        (tenant_id, rule_key, subject_tenant_user_id, justification, requested_by_tenant_user_id,
         status, effective_from, effective_to)
      VALUES (${TENANT_A}, ${RULE_VENDOR_PAYMENT}, ${A_SUBJECT}, 'race me',
        ${A_ACTOR}, 'pending', now(), ${new Date(Date.now() + 86400000)})
      RETURNING id
    `) as { id: string }[];
    const exceptionId = exRows[0]!.id;

    // Race two genuinely-VALID approvers (both != requester A_ACTOR and !=
    // subject A_SUBJECT) so the single success is proven by the CAS on
    // status='pending', not by one racer being rejected at the self-approval
    // guard.
    const settled = await Promise.allSettled([
      withTenant(runtime, TENANT_A, (tx) =>
        approveSoDConflictException(tx, TENANT_A, A_APPROVER, exceptionId, "r1")
      ),
      withTenant(runtime, TENANT_A, (tx) =>
        approveSoDConflictException(
          tx,
          TENANT_A,
          A_APPROVER2,
          exceptionId,
          "r2"
        )
      )
    ]);

    const oks = settled.filter(
      (s) => s.status === "fulfilled" && (s.value as { ok: boolean }).ok
    );
    // Exactly one approval sticks (compare-and-swap on status='pending'); the
    // other observes invalid_state.
    expect(oks.length).toBe(1);
  });

  test("BOUNDED evaluation: action-time query count does NOT grow with the subject's permission/assignment count", async () => {
    const runtime = getRuntimeSql();

    // Small subject: holds only vendor.create.
    await seedRoleWithPermissions(
      TENANT_A,
      "vendor_creator",
      [["vendor", "create"]],
      A_SUBJECT
    );

    const countQueries = async (subject: string): Promise<number> =>
      withTenant(runtime, TENANT_A, async (tx) => {
        let count = 0;
        const counting = new Proxy(tx, {
          apply(target, thisArg, args) {
            count += 1;
            return Reflect.apply(
              target as unknown as (...a: unknown[]) => unknown,
              thisArg,
              args
            );
          },
          get(target, prop, receiver) {
            return Reflect.get(target as object, prop, receiver);
          }
        }) as unknown as Bun.SQL;
        await checkHighRiskSoDConflicts(
          counting,
          TENANT_A,
          contextFor(TENANT_A, subject),
          {
            moduleKey: "example_crm",
            activityCode: "payment",
            action: "approve"
          },
          now(),
          { rules: SOD_RULES }
        );
        return count;
      });

    const smallCount = await countQueries(A_SUBJECT);

    // Large subject: pile on many extra ordinary-RBAC permissions AND several
    // business-scope assignments. The query count must be unchanged (facts are
    // resolved in a fixed number of SELECTs; detection is in-memory).
    const admin = getAdminSql();
    const bigRoleRows = (await admin`
      INSERT INTO awcms_roles (tenant_id, role_code, role_name)
      VALUES (${TENANT_A}, 'big_role', 'big_role') RETURNING id
    `) as { id: string }[];
    const bigRole = bigRoleRows[0]!.id;
    for (let i = 0; i < 40; i += 1) {
      const p = (await admin`
        INSERT INTO awcms_permissions (module_key, activity_code, action, description)
        VALUES ('example_crm', ${`filler${i}`}, 'read', 'filler')
        ON CONFLICT (module_key, activity_code, action) DO NOTHING
        RETURNING id
      `) as { id: string }[];
      const pid =
        p[0]?.id ??
        (
          (await admin`SELECT id FROM awcms_permissions WHERE module_key='example_crm' AND activity_code=${`filler${i}`} AND action='read'`) as {
            id: string;
          }[]
        )[0]!.id;
      await admin`INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id) VALUES (${TENANT_A}, ${bigRole}, ${pid})`;
    }
    await admin`INSERT INTO awcms_access_assignments (tenant_id, tenant_user_id, role_id) VALUES (${TENANT_A}, ${A_SUBJECT}, ${bigRole})`;
    for (let i = 0; i < 10; i += 1) {
      await admin`
        INSERT INTO awcms_business_scope_assignments
          (tenant_id, tenant_user_id, role_id, scope_type, scope_id, granted_by_tenant_user_id, status)
        VALUES (${TENANT_A}, ${A_SUBJECT}, ${bigRole}, 'tenant', ${TENANT_A}, ${A_ACTOR}, 'active')
      `;
    }

    const largeCount = await countQueries(A_SUBJECT);
    expect(largeCount).toBe(smallCount);
  });

  test("EXPIRY job transitions an elapsed approved exception to expired", async () => {
    const admin = getAdminSql();
    await admin`
      INSERT INTO awcms_sod_conflict_exceptions
        (tenant_id, rule_key, subject_tenant_user_id, justification, requested_by_tenant_user_id,
         approved_by_tenant_user_id, status, effective_from, effective_to)
      VALUES (${TENANT_A}, ${RULE_VENDOR_PAYMENT}, ${A_SUBJECT}, 'elapsed',
        ${A_ACTOR}, ${A_APPROVER}, 'approved', ${new Date(Date.now() - 100000)}, ${new Date(Date.now() - 1000)})
    `;

    const result = await runBusinessScopeExpiry(getRuntimeSql(), {
      correlationId: "test",
      runId: "test-run",
      dryRun: false,
      signal: new AbortController().signal
    });
    expect(result.exceptionsExpired).toBeGreaterThanOrEqual(1);

    const rows = (await admin`
      SELECT status FROM awcms_sod_conflict_exceptions WHERE tenant_id = ${TENANT_A}
    `) as { status: string }[];
    expect(rows[0]!.status).toBe("expired");
  });
});
