/**
 * Tenant module lifecycle against a real PostgreSQL, through the REAL route
 * handlers (Issue #154, adapted from awcms-mini's
 * `module-tenant-lifecycle.integration.test.ts`).
 *
 * THE INVARIANT THIS FILE EXISTS FOR is the last `describe` block:
 * "disabling a module actually blocks its OWN endpoints". PR #139 established
 * it by making `authorizeInTransaction` call `resolveModuleEnabled` BEFORE
 * looking up any permission, so a disabled module is refused `403
 * MODULE_DISABLED` no matter what the actor was granted. That check is a
 * single line in one shared function guarding every protected endpoint in the
 * codebase — which is exactly why it is both high-leverage and easy to delete
 * by accident. `tests/module-management-tenant-lifecycle.test.ts` is a pure
 * unit test of the DECISION functions; it cannot see that the guard is
 * actually wired into the request path. Only this can.
 *
 * WHY `workflow` IS THE MODULE UNDER TEST. It is the awcms analogue of mini's
 * `form_drafts`: a real, non-core module with real endpoints of its own
 * (`GET /api/v1/workflows/tasks`, guarded by `workflow.approval.read`) and
 * zero reverse dependents, so it is the one module a tenant can actually
 * disable. `form_drafts` does not exist in this repo and was dropped from the
 * port rather than substituted with a fiction.
 *
 * Routes are invoked directly with a synthetic Astro context (harness
 * `invoke()`) — no server, no build — but everything behind them is real: real
 * argon2 password hashing, real session tokens, real ABAC, real transactions.
 *
 * WORLD 2 (see harness.ts). Real route handlers call `getDatabaseClient()`
 * INTERNALLY, and that pool is process-wide memoized to the migrated
 * `DATABASE_URL` database — this harness cannot repoint it. So this file runs
 * against THAT database (not the ephemeral one the RLS suites build), seeding
 * and reading through `getHandlerAdminSql()`, a superuser connection to the
 * SAME database, so a fixture and the handler acting on it never diverge. The
 * assertions here are application-logic invariants that hold under any role;
 * RLS ENFORCEMENT is proved in `db-role-separation.integration.test.ts`, not
 * re-litigated here.
 *
 * Skipped unless `DATABASE_URL` is set (harness.ts §Gating) AND that database
 * carries the migrated schema (`ensureHandlerDatabaseReady()`), so a developer
 * pointing at a bare database gets a clean skip, never a red run.
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
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import { GET as listTenantModules } from "../../src/pages/api/v1/tenant/modules/index";
import { POST as enableModule } from "../../src/pages/api/v1/tenant/modules/[moduleKey]/enable";
import { POST as disableModule } from "../../src/pages/api/v1/tenant/modules/[moduleKey]/disable";
import { GET as listWorkflowTasks } from "../../src/pages/api/v1/workflows/tasks/index";
import { fetchTenantModuleEntry } from "../../src/modules/module-management/application/tenant-module-lifecycle";
import { withTenant } from "../../src/lib/database/tenant-context";

const OWNER_PASSWORD = "integration-test-owner-password";
const TENANT_B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/**
 * A non-core module with endpoints of its own and no reverse dependents —
 * i.e. one a tenant is actually allowed to disable. Verified against
 * `src/modules/index.ts`: nothing lists `workflow` in its `dependencies`.
 */
const DISABLABLE_MODULE = "workflow";

type Bootstrap = { tenantId: string; token: string; tenantUserId: string };

/**
 * Drives the REAL setup + login endpoints rather than seeding rows directly:
 * a hand-seeded fixture would silently diverge from what
 * `bootstrapPlatformTenant` actually writes (owner role, every permission
 * granted, access assignment), and then every 403 below would be ambiguous.
 *
 * `awcms_setup_state` is a singleton lock, so exactly one tenant per test can
 * be bootstrapped this way; `resetHandlerDatabase()` clears it between tests,
 * and tenant B (below) is inserted directly for the same reason.
 */
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

  const tenantUserRows = (await getHandlerAdminSql()`
    SELECT tu.id FROM awcms_tenant_users tu
    JOIN awcms_identities i ON i.id = tu.identity_id
    WHERE tu.tenant_id = ${tenantId} AND i.login_identifier = ${loginIdentifier}
  `) as { id: string }[];

  return {
    tenantId,
    token: login.body.data.token,
    tenantUserId: tenantUserRows[0]!.id
  };
}

function authHeaders(owner: Bootstrap): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-awcms-tenant-id": owner.tenantId,
    authorization: `Bearer ${owner.token}`
  };
}

/**
 * `reason` is `string | null`, NOT an optional with a default: a default
 * parameter fires on an explicitly-passed `undefined`, so `disable(owner, m,
 * undefined)` would silently send the default reason and the "disable requires
 * a reason" test would assert 400 against a perfectly well-formed request —
 * and pass only if the endpoint were broken. `null` means "omit the field".
 * (This bit once, before this comment existed.)
 */
function disable(
  owner: Bootstrap,
  moduleKey: string,
  reason: string | null = "Not used by this tenant."
) {
  return invoke<{
    error?: { code: string };
    data?: { tenantEnabled: boolean };
  }>(disableModule, {
    method: "POST",
    path: `/api/v1/tenant/modules/${moduleKey}/disable`,
    headers: authHeaders(owner),
    params: { moduleKey },
    body: reason === null ? {} : { reason }
  });
}

function enable(owner: Bootstrap, moduleKey: string) {
  return invoke<{
    error?: { code: string };
    data?: { tenantEnabled: boolean };
  }>(enableModule, {
    method: "POST",
    path: `/api/v1/tenant/modules/${moduleKey}/enable`,
    headers: authHeaders(owner),
    params: { moduleKey }
  });
}

const suite = integrationEnabled ? describe : describe.skip;

/**
 * Set in `beforeAll` once the handler database is confirmed migrated. Each
 * test checks it and returns early with a warning otherwise — `beforeAll`'s
 * async result cannot gate a `describe`, and a bare/un-migrated database must
 * skip cleanly rather than redden the run.
 */
let handlerReady = false;

function skipUnlessHandlerReady(): boolean {
  if (handlerReady) {
    return false;
  }

  console.warn(
    "[skip] handler database is not migrated — run 'bun run db:migrate' against DATABASE_URL. See ensureHandlerDatabaseReady()."
  );
  return true;
}

suite("tenant module lifecycle (Issue #154)", () => {
  beforeAll(async () => {
    handlerReady = await ensureHandlerDatabaseReady();
  });

  afterAll(async () => {
    await teardownHandlerDatabase();
  });

  beforeEach(async () => {
    if (!handlerReady) return;
    await resetHandlerDatabase();
  });

  describe("a disabled module blocks its OWN endpoints (the PR #139 invariant)", () => {
    test("GET /api/v1/workflows/tasks: 200 while enabled -> 403 MODULE_DISABLED once workflow is disabled", async () => {
      if (skipUnlessHandlerReady()) return;
      const owner = await bootstrap();

      // BEFORE. Establishes that this actor genuinely holds
      // `workflow.approval.read` — without this half, the 403 below would be
      // indistinguishable from "the owner never had access anyway", and the
      // test would pass against a build where the module guard did nothing.
      const before = await invoke(listWorkflowTasks, {
        method: "GET",
        path: "/api/v1/workflows/tasks",
        headers: authHeaders(owner)
      });
      expect(before.status).toBe(200);

      const disabled = await disable(owner, DISABLABLE_MODULE);
      expect(disabled.status).toBe(200);

      // AFTER. Same actor, same permissions, same endpoint — refused purely
      // because the module is off for this tenant.
      const after = await invoke<{ error: { code: string } }>(
        listWorkflowTasks,
        {
          method: "GET",
          path: "/api/v1/workflows/tasks",
          headers: authHeaders(owner)
        }
      );

      expect(after.status).toBe(403);
      expect(after.body.error.code).toBe("MODULE_DISABLED");
    });

    test("the refusal is recorded in the ABAC decision log as matchedPolicy=module_disabled, not silently dropped", async () => {
      if (skipUnlessHandlerReady()) return;
      const owner = await bootstrap();
      await disable(owner, DISABLABLE_MODULE);

      await invoke(listWorkflowTasks, {
        method: "GET",
        path: "/api/v1/workflows/tasks",
        headers: authHeaders(owner)
      });

      const rows = (await getHandlerAdminSql()`
        SELECT decision, matched_policy, module_key, action
        FROM awcms_abac_decision_logs
        WHERE tenant_id = ${owner.tenantId} AND matched_policy = 'module_disabled'
      `) as {
        decision: string;
        matched_policy: string;
        module_key: string;
        action: string;
      }[];

      expect(rows).toHaveLength(1);
      expect(rows[0]!.decision).toBe("deny");
      expect(rows[0]!.module_key).toBe(DISABLABLE_MODULE);
      expect(rows[0]!.action).toBe("read");
    });

    test("re-enabling restores access to the same endpoint (the block is state, not a one-way door)", async () => {
      if (skipUnlessHandlerReady()) return;
      const owner = await bootstrap();

      await disable(owner, DISABLABLE_MODULE);
      const blocked = await invoke(listWorkflowTasks, {
        method: "GET",
        path: "/api/v1/workflows/tasks",
        headers: authHeaders(owner)
      });
      expect(blocked.status).toBe(403);

      const reEnabled = await enable(owner, DISABLABLE_MODULE);
      expect(reEnabled.status).toBe(200);

      const restored = await invoke(listWorkflowTasks, {
        method: "GET",
        path: "/api/v1/workflows/tasks",
        headers: authHeaders(owner)
      });
      expect(restored.status).toBe(200);
    });

    test("module_management's OWN endpoints keep working while another module is disabled — a tenant can never lock itself out of re-enabling", async () => {
      if (skipUnlessHandlerReady()) return;
      const owner = await bootstrap();
      await disable(owner, DISABLABLE_MODULE);

      const listed = await invoke(listTenantModules, {
        method: "GET",
        path: "/api/v1/tenant/modules",
        headers: authHeaders(owner)
      });

      expect(listed.status).toBe(200);
    });
  });

  describe("enable/disable rules", () => {
    test("every module is enabled by default (no row in awcms_tenant_modules means available)", async () => {
      if (skipUnlessHandlerReady()) return;
      const owner = await bootstrap();

      const result = await invoke<{
        data: { modules: { moduleKey: string; tenantEnabled: boolean }[] };
      }>(listTenantModules, {
        method: "GET",
        path: "/api/v1/tenant/modules",
        headers: authHeaders(owner)
      });

      expect(result.status).toBe(200);
      expect(result.body.data.modules.length).toBeGreaterThan(0);
      expect(result.body.data.modules.every((m) => m.tenantEnabled)).toBe(true);

      const rows = (await getHandlerAdminSql()`
        SELECT count(*)::int AS count FROM awcms_tenant_modules
        WHERE tenant_id = ${owner.tenantId}
      `) as { count: number }[];

      // "Enabled by default" must mean the ABSENCE of state, not rows written
      // eagerly at bootstrap — otherwise a tenant created before a module
      // existed would report it disabled.
      expect(rows[0]!.count).toBe(0);
    });

    test("disabling a leaf module succeeds, persists the reason, and is audited", async () => {
      if (skipUnlessHandlerReady()) return;
      const owner = await bootstrap();

      const result = await disable(owner, DISABLABLE_MODULE, "Tidak dipakai.");
      expect(result.status).toBe(200);
      expect(result.body.data!.tenantEnabled).toBe(false);

      const entry = await withTenant(
        getHandlerDatabaseClient(),
        owner.tenantId,
        (tx) => fetchTenantModuleEntry(tx, owner.tenantId, DISABLABLE_MODULE)
      );
      expect(entry?.tenantEnabled).toBe(false);
      expect(entry?.disableReason).toBe("Tidak dipakai.");

      const auditRows = (await getHandlerAdminSql()`
        SELECT resource_id, attributes
        FROM awcms_audit_events
        WHERE tenant_id = ${owner.tenantId} AND action = 'tenant_module_disabled'
      `) as { resource_id: string; attributes: { reason: string } }[];

      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]!.resource_id).toBe(DISABLABLE_MODULE);
      expect(auditRows[0]!.attributes.reason).toBe("Tidak dipakai.");
    });

    test("re-enabling a disabled module is audited too", async () => {
      if (skipUnlessHandlerReady()) return;
      const owner = await bootstrap();
      await disable(owner, DISABLABLE_MODULE, "Temporary.");
      await enable(owner, DISABLABLE_MODULE);

      const rows = (await getHandlerAdminSql()`
        SELECT action FROM awcms_audit_events
        WHERE tenant_id = ${owner.tenantId} AND action = 'tenant_module_enabled'
      `) as { action: string }[];

      expect(rows).toHaveLength(1);
    });

    test("enabling an already-enabled module is rejected (409)", async () => {
      if (skipUnlessHandlerReady()) return;
      const owner = await bootstrap();

      const result = await enable(owner, DISABLABLE_MODULE);
      expect(result.status).toBe(409);
    });

    test("disabling a module another enabled module depends on is rejected (409) — identity_access has live reverse dependents", async () => {
      if (skipUnlessHandlerReady()) return;
      const owner = await bootstrap();

      const result = await disable(owner, "identity_access", "Trying anyway.");
      expect(result.status).toBe(409);

      // ...and nothing was written: a rejection must not half-apply.
      const rows = (await getHandlerAdminSql()`
        SELECT count(*)::int AS count FROM awcms_tenant_modules
        WHERE tenant_id = ${owner.tenantId} AND module_key = 'identity_access'
      `) as { count: number }[];
      expect(rows[0]!.count).toBe(0);
    });

    test("disabling a core module is rejected (409) — module_management cannot be turned off", async () => {
      if (skipUnlessHandlerReady()) return;
      const owner = await bootstrap();

      const result = await disable(owner, "module_management", "Nope.");
      expect(result.status).toBe(409);
    });

    test("an unknown module key is a 404 on both enable and disable", async () => {
      if (skipUnlessHandlerReady()) return;
      const owner = await bootstrap();

      expect((await enable(owner, "does_not_exist")).status).toBe(404);
      expect((await disable(owner, "does_not_exist", "n/a")).status).toBe(404);
    });

    test("disable requires a reason (400)", async () => {
      if (skipUnlessHandlerReady()) return;
      const owner = await bootstrap();

      const result = await disable(owner, DISABLABLE_MODULE, null);
      expect(result.status).toBe(400);

      // A rejected disable must leave no state behind.
      const rows = (await getHandlerAdminSql()`
        SELECT count(*)::int AS count FROM awcms_tenant_modules
        WHERE tenant_id = ${owner.tenantId}
      `) as { count: number }[];
      expect(rows[0]!.count).toBe(0);
    });

    test("an unauthenticated caller is refused before any module state is touched (401)", async () => {
      if (skipUnlessHandlerReady()) return;
      const owner = await bootstrap();

      const result = await invoke(disableModule, {
        method: "POST",
        path: `/api/v1/tenant/modules/${DISABLABLE_MODULE}/disable`,
        headers: {
          "content-type": "application/json",
          "x-awcms-tenant-id": owner.tenantId
        },
        params: { moduleKey: DISABLABLE_MODULE },
        body: { reason: "No token." }
      });

      expect(result.status).toBe(401);

      const rows = (await getHandlerAdminSql()`
        SELECT count(*)::int AS count FROM awcms_tenant_modules
        WHERE tenant_id = ${owner.tenantId}
      `) as { count: number }[];
      expect(rows[0]!.count).toBe(0);
    });
  });

  describe("tenant isolation", () => {
    test("disabling a module for tenant A leaves tenant B's module state untouched", async () => {
      if (skipUnlessHandlerReady()) return;
      const owner = await bootstrap();

      await getHandlerAdminSql()`
        INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
        VALUES (${TENANT_B_ID}, 'tenant-b', 'Tenant B')
      `;

      await disable(owner, DISABLABLE_MODULE, "Tenant A only.");

      const rows = (await getHandlerAdminSql()`
        SELECT count(*)::int AS count FROM awcms_tenant_modules
        WHERE tenant_id = ${TENANT_B_ID}
      `) as { count: number }[];

      expect(rows[0]!.count).toBe(0);
    });

    test("tenant A's session cannot drive tenant B's module lifecycle (401 — the session does not resolve under B's tenant context)", async () => {
      if (skipUnlessHandlerReady()) return;
      const owner = await bootstrap();

      await getHandlerAdminSql()`
        INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
        VALUES (${TENANT_B_ID}, 'tenant-b', 'Tenant B')
      `;

      // Tenant A's bearer token, tenant B's id in the header. The session
      // lookup is tenant-scoped AND RLS-protected, so the token resolves to
      // nothing under B's context.
      const result = await invoke(disableModule, {
        method: "POST",
        path: `/api/v1/tenant/modules/${DISABLABLE_MODULE}/disable`,
        headers: {
          "content-type": "application/json",
          "x-awcms-tenant-id": TENANT_B_ID,
          authorization: `Bearer ${owner.token}`
        },
        params: { moduleKey: DISABLABLE_MODULE },
        body: { reason: "Cross-tenant attempt." }
      });

      expect(result.status).toBe(401);

      const rows = (await getHandlerAdminSql()`
        SELECT count(*)::int AS count FROM awcms_tenant_modules
        WHERE tenant_id = ${TENANT_B_ID}
      `) as { count: number }[];
      expect(rows[0]!.count).toBe(0);
    });
  });
});
