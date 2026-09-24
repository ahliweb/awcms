/**
 * Issue ahliweb/omes#196 (ADR-0122) — OMES Control Center domain module descriptor & schema tests.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  omesControlModule,
  OMES_HEALTH_SNAPSHOTS_LIFECYCLE_KEY,
  OMES_JOBS_LIFECYCLE_KEY,
  OMES_AUDIT_PROJECTIONS_LIFECYCLE_KEY,
  OMES_SERVERS_LIFECYCLE_KEY,
  OMES_ENROLLMENTS_LIFECYCLE_KEY,
  OMES_DEPLOYMENTS_LIFECYCLE_KEY,
  OMES_OPERATION_REQUESTS_LIFECYCLE_KEY,
  OMES_BACKUP_SNAPSHOTS_LIFECYCLE_KEY
} from "../src/modules/omes-control/module";
import { getModuleByKey } from "../src/modules";

describe("omes_control module descriptor", () => {
  test("is registered in listModules()", () => {
    const mod = getModuleByKey("omes_control");
    expect(mod).toBeDefined();
    expect(mod?.key).toBe("omes_control");
    expect(mod?.name).toBe("OMES Control Center");
    expect(mod?.type).toBe("domain");
    expect(mod?.status).toBe("experimental");
    // Deliberately NOT "workflow" — see module.ts's own comment and
    // tests/module-boundary.test.ts's DOCUMENTED_EXCEPTIONS entry for
    // "omes_control -> workflow" (Issue ahliweb/omes#198): a hard
    // `dependencies` edge would make `workflow` un-disablable for any
    // tenant that has ever enabled omes_control.
    expect(mod?.dependencies).toEqual(["tenant_admin", "identity_access"]);
  });

  test("declares navigation for the five screens ahliweb/omes#200 landed", () => {
    // Was `toBeUndefined()` while the physical pages were staged work
    // (ahliweb/omes#196/#197/#198) — matching the push_delivery (ADR-0074)
    // precedent that a descriptor must not declare a path with no page
    // behind it (`tests/admin-navigation-registry.test.ts` enforces this in
    // both directions). ahliweb/omes#200 is exactly the issue that lands
    // those five pages, so this now asserts the populated shape instead.
    const nav = omesControlModule.navigation ?? [];
    expect(nav.map((entry) => entry.path).sort()).toEqual(
      [
        "/admin/omes",
        "/admin/omes/servers",
        "/admin/omes/deployments",
        "/admin/omes/operations",
        "/admin/omes/jobs"
      ].sort()
    );

    // Every requiredPermission must be one of the 13 permissions this same
    // descriptor declares below — a nav entry gated on a permission nothing
    // seeds denies even `owner` (this repo's own recorded failure mode).
    const declared = new Set(
      (omesControlModule.permissions ?? []).map(
        (permission) => `omes_control.${permission.activityCode}.${permission.action}`
      )
    );
    for (const entry of nav) {
      expect(entry.requiredPermission).toBeDefined();
      expect(declared.has(entry.requiredPermission as string)).toBe(true);
    }
  });

  test("defines 13 granular least-privilege permissions", () => {
    const permissions = omesControlModule.permissions ?? [];
    expect(permissions.length).toBe(13);

    const permKeys = permissions.map(
      (p) => `omes_control.${p.activityCode}.${p.action}`
    );
    expect(permKeys).toContain("omes_control.servers.read");
    expect(permKeys).toContain("omes_control.servers.register");
    expect(permKeys).toContain("omes_control.servers.delete");
    expect(permKeys).toContain("omes_control.deployments.read");
    expect(permKeys).toContain("omes_control.deployments.operate");
    expect(permKeys).toContain("omes_control.jobs.read");
    expect(permKeys).toContain("omes_control.jobs.approve");
    expect(permKeys).toContain("omes_control.jobs.cancel");
    expect(permKeys).toContain("omes_control.backups.read");
    expect(permKeys).toContain("omes_control.backups.restore");
    expect(permKeys).toContain("omes_control.backups.rollback");
    expect(permKeys).toContain("omes_control.audit.read");
    expect(permKeys).toContain("omes_control.enrollments.manage");
  });

  test("defines dataLifecycle descriptors for all 8 domain tables", () => {
    const lifecycles = omesControlModule.dataLifecycle ?? [];
    expect(lifecycles.length).toBe(8);

    const keys = lifecycles.map((l) => l.key);
    expect(keys).toContain(OMES_HEALTH_SNAPSHOTS_LIFECYCLE_KEY);
    expect(keys).toContain(OMES_JOBS_LIFECYCLE_KEY);
    expect(keys).toContain(OMES_AUDIT_PROJECTIONS_LIFECYCLE_KEY);
    expect(keys).toContain(OMES_SERVERS_LIFECYCLE_KEY);
    expect(keys).toContain(OMES_ENROLLMENTS_LIFECYCLE_KEY);
    expect(keys).toContain(OMES_DEPLOYMENTS_LIFECYCLE_KEY);
    expect(keys).toContain(OMES_OPERATION_REQUESTS_LIFECYCLE_KEY);
    expect(keys).toContain(OMES_BACKUP_SNAPSHOTS_LIFECYCLE_KEY);

    for (const desc of lifecycles) {
      expect(desc.scope).toBe("tenant");
      expect(desc.ownerModuleKey).toBe("omes_control");
      expect(desc.deletion.mode).toBe("hard_delete");
      // generic batching must include tenant_id in required indexes
      const tenantCovered = desc.requiredIndexes.some((idx) =>
        idx.columns.includes("tenant_id")
      );
      expect(tenantCovered).toBe(true);
    }
  });
});

describe("omes_control SQL migration sanity", () => {
  const schemaSql = readFileSync(
    join(import.meta.dir, "../sql/154_awcms_omes_control_schema.sql"),
    "utf8"
  );
  const permissionsSql = readFileSync(
    join(import.meta.dir, "../sql/155_awcms_omes_control_permissions.sql"),
    "utf8"
  );

  test("all 8 tables enforce ENABLE and FORCE ROW LEVEL SECURITY", () => {
    const expectedTables = [
      "awcms_omes_servers",
      "awcms_omes_enrollments",
      "awcms_omes_deployments",
      "awcms_omes_operation_requests",
      "awcms_omes_jobs",
      "awcms_omes_health_snapshots",
      "awcms_omes_backup_snapshots",
      "awcms_omes_audit_projections"
    ];

    for (const table of expectedTables) {
      expect(schemaSql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
      expect(schemaSql).toContain(
        `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`
      );
      expect(schemaSql).toContain(
        `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`
      );
      expect(schemaSql).toContain(
        `CREATE POLICY ${table}_tenant_isolation ON ${table}`
      );
    }
  });

  test("permissions migration seeds exactly the 13 declared module permissions", () => {
    const permissions = omesControlModule.permissions ?? [];
    for (const perm of permissions) {
      expect(permissionsSql).toContain(
        `('omes_control', '${perm.activityCode}', '${perm.action}',`
      );
    }
  });
});
