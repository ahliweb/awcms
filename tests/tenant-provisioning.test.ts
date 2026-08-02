/**
 * Tenant provisioning (ADR-0054): one creation path, platform-gated, and a
 * provisioned tenant that never receives platform authority.
 *
 * ## The two regressions this defends
 *
 * 1. **A second copy of the creation code.** `createTenantWithOwner` is shared
 *    with the setup wizard specifically so `WHERE scope = 'tenant'` on the owner
 *    grant exists once. A provisioning routine written independently — which is
 *    the obvious way to build this — would carry a copy of an INSERT that, for
 *    most of this repo's life, did NOT have that filter. The result is every
 *    customer holding authority over every other customer's served data, and it
 *    would review cleanly.
 *
 * 2. **`grantPlatformScope: true` on the wrong call site.** One boolean. The
 *    setup wizard needs it (the tenant it creates IS the platform tenant);
 *    provisioning must never have it.
 *
 * Pure — no database, no network. Runs in `quality` on every PR.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import {
  isPlatformScopedPermissionKey,
  resetPlatformScopeCacheForTests
} from "../src/modules/identity-access/domain/platform-scope";

const BOOTSTRAP = "src/modules/tenant-admin/application/platform-bootstrap.ts";
const PROVISIONING =
  "src/modules/tenant-admin/application/tenant-provisioning.ts";
const ROUTE = "src/pages/api/v1/tenants/index.ts";
const PAGE = "src/pages/admin/tenants.astro";
const MIGRATION = "sql/086_awcms_tenant_provisioning_permissions.sql";

/**
 * Removes block and line comments before counting call sites.
 *
 * Without this, a doc comment that MENTIONS `grantPlatformScope: true` — which
 * `bootstrapPlatformTenant`'s does, correctly — counts as a call site, and the
 * assertion below fails for a reason that has nothing to do with the code. The
 * fix is to count code, not prose; loosening the count would have hidden a real
 * second call site later.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("tenant provisioning is platform-scoped", () => {
  test("both provisioning permissions are declared PLATFORM-scoped", () => {
    resetPlatformScopeCacheForTests();

    const permissions =
      listModules().find((module) => module.key === "tenant_admin")
        ?.permissions ?? [];

    const provisioning = permissions.filter(
      (permission) => permission.activityCode === "tenant_provisioning"
    );

    expect(provisioning.map((p) => p.action).sort()).toEqual([
      "create",
      "read"
    ]);

    for (const permission of provisioning) {
      expect(permission.scope).toBe("platform");
    }

    // `read` being platform-scoped is the easy one to "fix" by mistake: it
    // looks like an ordinary list endpoint. It lists EVERY tenant, so a
    // tenant-scoped read lets any customer enumerate the platform's customers.
    expect(
      isPlatformScopedPermissionKey("tenant_admin.tenant_provisioning.read")
    ).toBe(true);
    expect(
      isPlatformScopedPermissionKey("tenant_admin.tenant_provisioning.create")
    ).toBe(true);
  });

  test("ordinary tenant_admin permissions stay tenant-scoped", () => {
    const permissions =
      listModules().find((module) => module.key === "tenant_admin")
        ?.permissions ?? [];

    for (const permission of permissions) {
      if (permission.activityCode !== "tenant_provisioning") {
        expect(permission.scope ?? "tenant").toBe("tenant");
      }
    }
  });

  test("the migration seeds them as platform and grants only the setup tenant", async () => {
    const sql = await readFile(MIGRATION, "utf8");

    expect(sql).toContain("'tenant_admin', 'tenant_provisioning', 'read'");
    expect(sql).toContain("'tenant_admin', 'tenant_provisioning', 'create'");
    expect(sql).toContain("'platform'");
    expect(sql).toContain("FROM awcms_setup_state");
    expect(sql).toContain("role_code = 'owner'");
  });
});

describe("there is exactly one tenant-creation path", () => {
  test("provisioning delegates to the shared creator instead of copying it", async () => {
    const source = await readFile(PROVISIONING, "utf8");

    expect(source).toContain("createTenantWithOwner");
    // A copy would be visible as raw INSERTs here. The grant INSERT is the one
    // that matters, but any of them means the paths have forked.
    expect(source).not.toMatch(/INSERT\s+INTO\s+awcms_tenants/i);
    expect(source).not.toMatch(/INSERT\s+INTO\s+awcms_role_permissions/i);
    expect(source).not.toMatch(/INSERT\s+INTO\s+awcms_roles/i);
  });

  test("the shared creator filters the owner grant on scope", async () => {
    const source = await readFile(BOOTSTRAP, "utf8");

    expect(source).toContain("WHERE scope = 'tenant'");
    // And the platform half is behind the flag, not unconditional.
    expect(source).toContain("if (options.grantPlatformScope)");
  });

  test("provisioning never asks for the platform catalogue", async () => {
    const source = stripComments(await readFile(PROVISIONING, "utf8"));

    expect(source).toContain("grantPlatformScope: false");
    expect(source).not.toContain("grantPlatformScope: true");
  });

  test("only the setup wizard asks for it", async () => {
    const source = stripComments(await readFile(BOOTSTRAP, "utf8"));
    const calls = source.match(/grantPlatformScope:\s*true/g) ?? [];

    // Exactly one call site, and it is the bootstrap — the tenant it creates
    // becomes `awcms_setup_state.tenant_id`, i.e. the platform tenant.
    expect(calls).toHaveLength(1);
    expect(source).toContain("bootstrapPlatformTenant");
  });
});

describe("the route and screen behave", () => {
  test("the route guards both verbs on the provisioning permissions", async () => {
    const source = await readFile(ROUTE, "utf8");

    expect(source).toContain('action: "read"');
    expect(source).toContain('action: "create"');
    expect(source).toContain("TENANT_PROVISIONING_ACTIVITY_CODE");
    // High-risk mutation: an Idempotency-Key is mandatory, so a retried
    // provision cannot create a second tenant.
    expect(source).toContain("IDEMPOTENCY_REQUIRED");
  });

  test("the owner password never reaches the idempotency record", async () => {
    const source = await readFile(ROUTE, "utf8");

    // `computeRequestHash` output is STORED. Hashing the password would put a
    // credential at rest in a table nobody thinks of as credential storage.
    const hashCall = source.slice(
      source.indexOf("const requestHash = computeRequestHash("),
      source.indexOf("const existing = await findIdempotencyRecord(")
    );

    expect(hashCall.length).toBeGreaterThan(0);
    expect(hashCall).not.toContain("ownerPassword");
  });

  test("the screen requires the platform tenant, not just the permission", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).toContain("resolvePlatformTenant");
    expect(page).toMatch(/const canRead = holdsRead && isPlatformTenant/);
    expect(page).toMatch(/const canCreate = holdsCreate && isPlatformTenant/);
    expect(page).not.toMatch(
      /\b(INSERT\s+INTO|UPDATE\s+awcms_|DELETE\s+FROM)/i
    );
  });

  test("the sidebar entry is gated on the platform permission", () => {
    const nav = listModules()
      .find((module) => module.key === "tenant_admin")
      ?.navigation?.find((entry) => entry.path === "/admin/tenants");

    expect(nav).toBeDefined();
    // Unlike `/admin/idn-regions`, this screen has no tenant-readable half, so
    // ADR-0051 §Keputusan butir 3 applies literally: the link is gated on the
    // platform permission.
    expect(nav!.requiredPermission).toBe(
      "tenant_admin.tenant_provisioning.read"
    );
  });
});
