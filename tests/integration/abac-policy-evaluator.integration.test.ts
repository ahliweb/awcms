/**
 * Integration tests for the dynamic ABAC policy evaluator (Issue #179),
 * against a real PostgreSQL through the REAL route handlers (WORLD 2 — see
 * harness.ts). Everything behind the routes is real: real setup/login, real
 * argon2, real sessions, real transactions, real ABAC.
 *
 * Routes exercised:
 *   - POST /api/v1/access/policies              (authoring; only valid DSL)
 *   - POST /api/v1/access/policies/{id}/enable | /disable
 *   - POST /api/v1/access/policies/simulate     (read-only preview, audited)
 *   - POST /api/v1/access/evaluate              (consumes active policies)
 *
 * Proves: create → enable → evaluate flips the decision (deny overrides an RBAC
 * allow) and disable restores it WITHOUT a restart (cache invalidation); the
 * allow-as-constraint narrows a granted permission (ownership); a tenant-A
 * policy does NOT load for tenant B (tenant-keyed cache); the decision log
 * records policy/version/reason with no raw attribute VALUES; the simulation is
 * read-only (no decision-log row for the simulated request) but audited; and
 * the FOREIGN-SUBJECT simulation gate — an analyze-only principal cannot probe
 * a DIFFERENT tenant user's access without `access_control.read`, and when a
 * principal that DOES hold it probes one, the victim is recorded in the audit.
 *
 * Skipped unless DATABASE_URL is set AND the handler database is migrated
 * (harness.ts §Gating + ensureHandlerDatabaseReady()).
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
  createCookieJar,
  ensureHandlerDatabaseReady,
  getHandlerAdminSql,
  getHandlerDatabaseClient,
  integrationEnabled,
  invoke,
  resetHandlerDatabase,
  teardownHandlerDatabase
} from "./harness";
import { withTenant } from "../../src/lib/database/tenant-context";
import { hashSessionToken } from "../../src/lib/auth/session-token";
import { loadActivePolicies } from "../../src/modules/identity-access/application/policy-cache";
import { resetPolicyCache } from "../../src/modules/identity-access/application/policy-cache";

import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import { POST as accessEvaluate } from "../../src/pages/api/v1/access/evaluate";
import { POST as createPolicyRoute } from "../../src/pages/api/v1/access/policies/index";
import { POST as enablePolicy } from "../../src/pages/api/v1/access/policies/[id]/enable";
import { POST as disablePolicy } from "../../src/pages/api/v1/access/policies/[id]/disable";
import { POST as simulatePolicy } from "../../src/pages/api/v1/access/policies/simulate";

const OWNER_PASSWORD = "integration-test-owner-password";
const TENANT_B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// The evaluation target throughout — a module/activity/action the setup-wizard
// owner holds via RBAC. It is DELIBERATELY not `abac_policies.*`, so a policy
// authored against it never locks the owner out of managing policies.
const TARGET = {
  moduleKey: "identity_access",
  activityCode: "access_control",
  action: "read"
};

type Bootstrap = { tenantId: string; token: string; tenantUserId: string };

async function bootstrap(): Promise<Bootstrap> {
  const loginIdentifier = "owner@example.com";

  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "Acme",
      tenantCode: "acme",
      officeCode: "hq",
      officeName: "HQ",
      ownerLoginIdentifier: loginIdentifier,
      ownerPassword: OWNER_PASSWORD,
      ownerDisplayName: "Owner"
    }
  });
  expect(setup.status).toBe(200);
  const tenantId = setup.body.data.tenantId;

  const login = await invoke<{ data: { token: string } }>(authLogin, {
    method: "POST",
    path: "/api/v1/auth/login",
    headers: {
      "content-type": "application/json",
      "x-awcms-tenant-id": tenantId
    },
    body: { loginIdentifier, password: OWNER_PASSWORD },
    cookies: createCookieJar()
  });
  expect(login.status).toBe(200);

  const rows = (await getHandlerAdminSql()`
    SELECT tu.id FROM awcms_tenant_users tu
    JOIN awcms_identities i ON i.id = tu.identity_id
    WHERE tu.tenant_id = ${tenantId} AND i.login_identifier = ${loginIdentifier}
  `) as { id: string }[];

  return { tenantId, token: login.body.data.token, tenantUserId: rows[0]!.id };
}

function headers(owner: {
  tenantId: string;
  token: string;
}): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-awcms-tenant-id": owner.tenantId,
    authorization: `Bearer ${owner.token}`
  };
}

async function createPolicy(
  owner: Bootstrap,
  body: Record<string, unknown>
): Promise<{ status: number; id?: string }> {
  const res = await invoke<{ data: { policy: { id: string } } }>(
    createPolicyRoute,
    {
      method: "POST",
      path: "/api/v1/access/policies",
      headers: headers(owner),
      body
    }
  );
  return { status: res.status, id: res.body?.data?.policy?.id };
}

function setActive(
  owner: Bootstrap,
  id: string,
  active: boolean
): Promise<{ status: number; body: unknown }> {
  const handler = active ? enablePolicy : disablePolicy;
  return invoke(handler, {
    method: "POST",
    path: `/api/v1/access/policies/${id}/${active ? "enable" : "disable"}`,
    headers: headers(owner),
    params: { id }
  });
}

async function evaluate(
  owner: Bootstrap,
  resourceAttributes?: Record<string, unknown>
): Promise<{
  status: number;
  allowed: boolean;
  matchedPolicy?: string;
  matchedPolicyVersion?: number;
}> {
  const res = await invoke<{
    data: {
      allowed: boolean;
      matchedPolicy?: string;
      matchedPolicyVersion?: number;
    };
  }>(accessEvaluate, {
    method: "POST",
    path: "/api/v1/access/evaluate",
    headers: headers(owner),
    body: { ...TARGET, resourceAttributes }
  });
  return {
    status: res.status,
    allowed: res.body?.data?.allowed,
    matchedPolicy: res.body?.data?.matchedPolicy,
    matchedPolicyVersion: res.body?.data?.matchedPolicyVersion
  };
}

/**
 * Seeds a second tenant user holding ONLY the given permission keys, with a
 * live session, directly via admin SQL (the setup wizard is a one-time
 * singleton, so a second principal must be seeded). Returns its
 * tenantUserId + bearer token.
 */
async function seedUserWithPermissions(
  tenantId: string,
  label: string,
  perms: [string, string, string][]
): Promise<{ tenantUserId: string; token: string }> {
  const admin = getHandlerAdminSql();

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
  const tenantUser = (await admin`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id})
    RETURNING id
  `) as { id: string }[];

  const role = (await admin`
    INSERT INTO awcms_roles (tenant_id, role_code, role_name)
    VALUES (${tenantId}, ${label}, ${label})
    RETURNING id
  `) as { id: string }[];

  for (const [moduleKey, activityCode, action] of perms) {
    const pid = (await admin`
      SELECT id FROM awcms_permissions
      WHERE module_key = ${moduleKey} AND activity_code = ${activityCode} AND action = ${action}
    `) as { id: string }[];
    await admin`
      INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
      VALUES (${tenantId}, ${role[0]!.id}, ${pid[0]!.id})
    `;
  }

  await admin`
    INSERT INTO awcms_access_assignments (tenant_id, tenant_user_id, role_id)
    VALUES (${tenantId}, ${tenantUser[0]!.id}, ${role[0]!.id})
  `;

  const token = `it-token-${label}-${Date.now()}`;
  await admin`
    INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
    VALUES (${tenantId}, ${identity[0]!.id}, ${hashSessionToken(token)}, ${new Date(Date.now() + 3_600_000)})
  `;

  return { tenantUserId: tenantUser[0]!.id, token };
}

const suite = integrationEnabled ? describe : describe.skip;

let handlerReady = false;

function skipUnlessHandlerReady(): boolean {
  if (handlerReady) return false;
  console.warn(
    "[skip] handler database is not migrated — run 'bun run db:migrate' against DATABASE_URL. See ensureHandlerDatabaseReady()."
  );
  return true;
}

suite("dynamic ABAC policy evaluator (Issue #179)", () => {
  beforeAll(async () => {
    handlerReady = await ensureHandlerDatabaseReady();
  });

  afterAll(async () => {
    await teardownHandlerDatabase();
  });

  beforeEach(async () => {
    if (!handlerReady) return;
    await resetHandlerDatabase();
    resetPolicyCache();
  });

  describe("create → enable → evaluate → disable (deny overrides RBAC; cache invalidation)", () => {
    test("an enabled deny policy flips a granted permission to deny, and disabling restores it — no restart", async () => {
      if (skipUnlessHandlerReady()) return;
      const owner = await bootstrap();

      // Baseline: the owner holds access_control.read via RBAC.
      const baseline = await evaluate(owner);
      expect(baseline.allowed).toBe(true);
      expect(baseline.matchedPolicy).toBe("role_permission");

      // Author a deny targeting exactly that permission, initially DISABLED.
      const created = await createPolicy(owner, {
        policyCode: "test.deny-access-read",
        effect: "deny",
        moduleKey: TARGET.moduleKey,
        activityCode: TARGET.activityCode,
        action: TARGET.action,
        conditions: { allOf: [] }
      });
      expect(created.status).toBe(200);
      const id = created.id!;

      // Still allowed — the policy exists but is inactive.
      expect((await evaluate(owner)).allowed).toBe(true);

      // Enable → the very next evaluate is denied (cache invalidated, no restart).
      expect((await setActive(owner, id, true)).status).toBe(200);
      const denied = await evaluate(owner);
      expect(denied.allowed).toBe(false);
      expect(denied.matchedPolicy).toBe("test.deny-access-read");
      expect(denied.matchedPolicyVersion).toBe(1);

      // Disable → allowed again (invalidation restores, still no restart).
      expect((await setActive(owner, id, false)).status).toBe(200);
      expect((await evaluate(owner)).allowed).toBe(true);
    });

    test("an invalid DSL policy is rejected at authoring and can never be stored", async () => {
      if (skipUnlessHandlerReady()) return;
      const owner = await bootstrap();

      const res = await invoke<{ error: { code: string } }>(createPolicyRoute, {
        method: "POST",
        path: "/api/v1/access/policies",
        headers: headers(owner),
        body: {
          policyCode: "test.bad",
          effect: "allow",
          conditions: { attr: "subject.evil", op: "eq", value: "x" }
        }
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");

      const rows = (await getHandlerAdminSql()`
        SELECT count(*)::int AS count FROM awcms_abac_policies
        WHERE tenant_id = ${owner.tenantId}
      `) as { count: number }[];
      expect(rows[0]!.count).toBe(0);
    });
  });

  describe("allow-as-constraint (ownership narrows a granted permission)", () => {
    test("a satisfied ownership allow permits; an unsatisfied one denies", async () => {
      if (skipUnlessHandlerReady()) return;
      const owner = await bootstrap();

      const created = await createPolicy(owner, {
        policyCode: "test.own-only",
        effect: "allow",
        moduleKey: TARGET.moduleKey,
        activityCode: TARGET.activityCode,
        action: TARGET.action,
        conditions: {
          attr: "resource.ownerTenantUserId",
          op: "eq",
          valueAttr: "subject.tenantUserId"
        },
        isActive: true
      });
      expect(created.status).toBe(200);

      const own = await evaluate(owner, {
        ownerTenantUserId: owner.tenantUserId
      });
      expect(own.allowed).toBe(true);
      expect(own.matchedPolicy).toBe("test.own-only");

      const foreign = await evaluate(owner, {
        ownerTenantUserId: "00000000-0000-4000-8000-0000000000aa"
      });
      expect(foreign.allowed).toBe(false);
      expect(foreign.matchedPolicy).toBe("abac_allow_unsatisfied");
    });
  });

  describe("tenant isolation (tenant-keyed cache)", () => {
    test("a tenant-A policy is not loaded for tenant B", async () => {
      if (skipUnlessHandlerReady()) return;
      const owner = await bootstrap();

      const created = await createPolicy(owner, {
        policyCode: "test.deny-access-read",
        effect: "deny",
        moduleKey: TARGET.moduleKey,
        activityCode: TARGET.activityCode,
        action: TARGET.action,
        conditions: { allOf: [] },
        isActive: true
      });
      expect(created.status).toBe(200);

      await getHandlerAdminSql()`
        INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
        VALUES (${TENANT_B_ID}, 'tenant-b', 'Tenant B')
      `;

      const client = getHandlerDatabaseClient();
      const aPolicies = await withTenant(client, owner.tenantId, (tx) =>
        loadActivePolicies(tx, owner.tenantId)
      );
      const bPolicies = await withTenant(client, TENANT_B_ID, (tx) =>
        loadActivePolicies(tx, TENANT_B_ID)
      );

      expect(aPolicies.length).toBe(1);
      expect(bPolicies.length).toBe(0);
    });
  });

  describe("decision log records policy/version/reason with no raw PII", () => {
    test("a policy-denied evaluate logs code+version+static reason only", async () => {
      if (skipUnlessHandlerReady()) return;
      const owner = await bootstrap();

      const created = await createPolicy(owner, {
        policyCode: "test.deny-access-read",
        effect: "deny",
        moduleKey: TARGET.moduleKey,
        activityCode: TARGET.activityCode,
        action: TARGET.action,
        conditions: { allOf: [] },
        isActive: true
      });
      expect(created.status).toBe(200);

      // Include a resource attribute VALUE that must NEVER appear in the log.
      const secret = "9e1f2c3d-secret-owner-value";
      await evaluate(owner, { ownerTenantUserId: secret });

      const rows = (await getHandlerAdminSql()`
        SELECT decision, matched_policy, matched_policy_version, reason
        FROM awcms_abac_decision_logs
        WHERE tenant_id = ${owner.tenantId}
          AND module_key = ${TARGET.moduleKey}
          AND activity_code = ${TARGET.activityCode}
          AND action = ${TARGET.action}
          AND decision = 'deny'
      `) as {
        decision: string;
        matched_policy: string;
        matched_policy_version: number;
        reason: string;
      }[];

      expect(rows.length).toBeGreaterThanOrEqual(1);
      const row = rows[0]!;
      expect(row.matched_policy).toBe("test.deny-access-read");
      expect(row.matched_policy_version).toBe(1);
      expect(row.reason.length).toBeGreaterThan(0);
      // No raw resource attribute VALUE leaks into the decision log.
      expect(row.reason).not.toContain(secret);
      expect(row.matched_policy).not.toContain(secret);
    });
  });

  describe("simulation is read-only + audited", () => {
    test("simulate writes NO decision-log row for the simulated request but IS audited", async () => {
      if (skipUnlessHandlerReady()) return;
      const owner = await bootstrap();

      const res = await invoke<{
        data: {
          decision: { allowed: boolean };
          evaluatedPolicies: unknown[];
        };
      }>(simulatePolicy, {
        method: "POST",
        path: "/api/v1/access/policies/simulate",
        headers: headers(owner),
        body: {
          request: {
            moduleKey: "sales",
            activityCode: "invoice",
            action: "update"
          }
        }
      });
      expect(res.status).toBe(200);
      expect(typeof res.body.data.decision.allowed).toBe("boolean");
      expect(Array.isArray(res.body.data.evaluatedPolicies)).toBe(true);

      // The SIMULATED request (module 'sales') must not have produced a
      // decision-log row — the outcome is hypothetical.
      const logs = (await getHandlerAdminSql()`
        SELECT count(*)::int AS count FROM awcms_abac_decision_logs
        WHERE tenant_id = ${owner.tenantId} AND module_key = 'sales'
      `) as { count: number }[];
      expect(logs[0]!.count).toBe(0);

      // The simulation itself IS audited.
      const audit = (await getHandlerAdminSql()`
        SELECT count(*)::int AS count FROM awcms_audit_events
        WHERE tenant_id = ${owner.tenantId}
          AND action = 'analyze' AND resource_type = 'abac_simulation'
      `) as { count: number }[];
      expect(audit[0]!.count).toBe(1);
    });
  });

  describe("simulation foreign-subject authority gate (hardening)", () => {
    test("an analyze-only principal cannot probe a DIFFERENT tenant user's access", async () => {
      if (skipUnlessHandlerReady()) return;
      const owner = await bootstrap();

      // A principal holding ONLY abac_policies.analyze (NOT access_control.read).
      const analyst = await seedUserWithPermissions(owner.tenantId, "analyst", [
        ["identity_access", "abac_policies", "analyze"]
      ]);

      // Self / hypothetical-role simulation is fine.
      const selfSim = await invoke(simulatePolicy, {
        method: "POST",
        path: "/api/v1/access/policies/simulate",
        headers: headers({ tenantId: owner.tenantId, token: analyst.token }),
        body: {
          request: {
            moduleKey: "sales",
            activityCode: "invoice",
            action: "update"
          }
        }
      });
      expect(selfSim.status).toBe(200);

      // Probing a DIFFERENT existing user (the owner) is refused 403.
      const foreignSim = await invoke<{ error: { code: string } }>(
        simulatePolicy,
        {
          method: "POST",
          path: "/api/v1/access/policies/simulate",
          headers: headers({ tenantId: owner.tenantId, token: analyst.token }),
          body: {
            subject: { tenantUserId: owner.tenantUserId },
            request: {
              moduleKey: "sales",
              activityCode: "invoice",
              action: "update"
            }
          }
        }
      );
      expect(foreignSim.status).toBe(403);
      expect(foreignSim.body.error.code).toBe("ACCESS_DENIED");
    });

    test("a principal WITH access_control.read may probe a foreign subject, and the victim is recorded in the audit", async () => {
      if (skipUnlessHandlerReady()) return;
      const owner = await bootstrap(); // owner holds access_control.read
      const analyst = await seedUserWithPermissions(owner.tenantId, "analyst", [
        ["identity_access", "abac_policies", "analyze"]
      ]);

      const res = await invoke<{ data: { decision: { allowed: boolean } } }>(
        simulatePolicy,
        {
          method: "POST",
          path: "/api/v1/access/policies/simulate",
          headers: headers(owner),
          body: {
            subject: { tenantUserId: analyst.tenantUserId },
            request: {
              moduleKey: "sales",
              activityCode: "invoice",
              action: "update"
            }
          }
        }
      );
      expect(res.status).toBe(200);

      const rows = (await getHandlerAdminSql()`
        SELECT attributes FROM awcms_audit_events
        WHERE tenant_id = ${owner.tenantId}
          AND action = 'analyze' AND resource_type = 'abac_simulation'
        ORDER BY created_at DESC
        LIMIT 1
      `) as { attributes: { simulatedSubjectTenantUserId: string | null } }[];

      expect(rows[0]!.attributes.simulatedSubjectTenantUserId).toBe(
        analyst.tenantUserId
      );
    });
  });
});
