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
  OMES_BACKUP_SNAPSHOTS_LIFECYCLE_KEY,
  OMES_AI_PRIVACY_POSTURE_LIFECYCLE_KEY,
  OMES_AI_EGRESS_APPROVALS_LIFECYCLE_KEY,
  OMES_HERMES_ORCHESTRATION_TREES_LIFECYCLE_KEY,
  OMES_HERMES_ORCHESTRATION_EVENTS_LIFECYCLE_KEY,
  OMES_REPOSITORY_PROGRESS_CONFIG_LIFECYCLE_KEY,
  OMES_REPOSITORY_PROGRESS_LIFECYCLE_KEY
} from "../src/modules/omes-control/module";
import { getModuleByKey } from "../src/modules";

describe("omes_control module descriptor", () => {
  test("is registered in listModules()", () => {
    const mod = getModuleByKey("omes_control");
    expect(mod).toBeDefined();
    expect(mod?.key).toBe("omes_control");
    expect(mod?.name).toBe("OMES Control Center");
    expect(mod?.type).toBe("domain");
    // "active" as of Issue ahliweb/omes#201 — all eight planned
    // /admin/omes/* screens now exist (see module.ts's own comment for the
    // ADR-0021/push_delivery reasoning).
    expect(mod?.status).toBe("active");
    // Deliberately NOT "workflow" — see module.ts's own comment and
    // tests/module-boundary.test.ts's DOCUMENTED_EXCEPTIONS entry for
    // "omes_control -> workflow" (Issue ahliweb/omes#198): a hard
    // `dependencies` edge would make `workflow` un-disablable for any
    // tenant that has ever enabled omes_control.
    expect(mod?.dependencies).toEqual(["tenant_admin", "identity_access"]);
  });

  test("declares navigation for all fourteen screens ahliweb/omes#200, #201, #233, #232, and #246 (parts 2 and 3) landed", () => {
    // Was `toBeUndefined()` while the physical pages were staged work
    // (ahliweb/omes#196/#197/#198) — matching the push_delivery (ADR-0074)
    // precedent that a descriptor must not declare a path with no page
    // behind it (`tests/admin-navigation-registry.test.ts` enforces this in
    // both directions). ahliweb/omes#200 landed the first five; #201 added
    // health, backups, and audit; #233 added the ninth, enrollments; #232
    // added the tenth, AI privacy; #246 part 2 adds live orchestration,
    // Hermes, and Hermes progress; #246 part 3 adds the fourteenth,
    // Arsitektur (architecture).
    const nav = omesControlModule.navigation ?? [];
    expect(nav.map((entry) => entry.path).sort()).toEqual(
      [
        "/admin/omes",
        "/admin/omes/servers",
        "/admin/omes/deployments",
        "/admin/omes/operations",
        "/admin/omes/jobs",
        "/admin/omes/health",
        "/admin/omes/backups",
        "/admin/omes/audit",
        "/admin/omes/enrollments",
        "/admin/omes/ai-privacy",
        "/admin/omes/orkestrasi-langsung",
        "/admin/omes/hermes",
        "/admin/omes/progres-hermes",
        "/admin/omes/arsitektur"
      ].sort()
    );

    // Every requiredPermission must be one of the permissions this same
    // descriptor declares below — a nav entry gated on a permission nothing
    // seeds denies even `owner` (this repo's own recorded failure mode).
    const declared = new Set(
      (omesControlModule.permissions ?? []).map(
        (permission) =>
          `omes_control.${permission.activityCode}.${permission.action}`
      )
    );
    for (const entry of nav) {
      expect(entry.requiredPermission).toBeDefined();
      expect(declared.has(entry.requiredPermission as string)).toBe(true);
    }
  });

  test("defines 18 granular least-privilege permissions", () => {
    // 13 original (#196/#198/#233) + ai_privacy.read + ai_privacy.approve
    // (ahliweb/omes#232, sql/161) + hermes_orchestration.read
    // (ahliweb/omes#246 part 2, sql/164) + architecture.read
    // (ahliweb/omes#246 part 3, sql/165) + repository_progress.configure
    // (ahliweb/omes#249, ADR-0030, sql/167).
    const permissions = omesControlModule.permissions ?? [];
    expect(permissions.length).toBe(18);

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
    expect(permKeys).toContain("omes_control.ai_privacy.read");
    expect(permKeys).toContain("omes_control.ai_privacy.approve");
    expect(permKeys).toContain("omes_control.hermes_orchestration.read");
    expect(permKeys).toContain("omes_control.architecture.read");
    expect(permKeys).toContain("omes_control.repository_progress.configure");
  });

  test("defines dataLifecycle descriptors for all 16 domain tables", () => {
    // 8 original (#196) + awcms_omes_worker_nonces + awcms_omes_worker_results
    // (ahliweb/omes#199, sql/159) + awcms_omes_ai_privacy_posture +
    // awcms_omes_ai_egress_approvals (ahliweb/omes#232, sql/160) +
    // awcms_omes_hermes_orchestration_trees + _events (ahliweb/omes#246,
    // sql/163) + awcms_omes_repository_progress_config +
    // awcms_omes_repository_progress (ahliweb/omes#249, ADR-0030, sql/166).
    const lifecycles = omesControlModule.dataLifecycle ?? [];
    expect(lifecycles.length).toBe(16);

    const keys = lifecycles.map((l) => l.key);
    expect(keys).toContain(OMES_HEALTH_SNAPSHOTS_LIFECYCLE_KEY);
    expect(keys).toContain(OMES_JOBS_LIFECYCLE_KEY);
    expect(keys).toContain(OMES_AUDIT_PROJECTIONS_LIFECYCLE_KEY);
    expect(keys).toContain(OMES_SERVERS_LIFECYCLE_KEY);
    expect(keys).toContain(OMES_ENROLLMENTS_LIFECYCLE_KEY);
    expect(keys).toContain(OMES_DEPLOYMENTS_LIFECYCLE_KEY);
    expect(keys).toContain(OMES_OPERATION_REQUESTS_LIFECYCLE_KEY);
    expect(keys).toContain(OMES_BACKUP_SNAPSHOTS_LIFECYCLE_KEY);
    expect(keys).toContain(OMES_AI_PRIVACY_POSTURE_LIFECYCLE_KEY);
    expect(keys).toContain(OMES_AI_EGRESS_APPROVALS_LIFECYCLE_KEY);
    expect(keys).toContain(OMES_HERMES_ORCHESTRATION_TREES_LIFECYCLE_KEY);
    expect(keys).toContain(OMES_HERMES_ORCHESTRATION_EVENTS_LIFECYCLE_KEY);
    expect(keys).toContain(OMES_REPOSITORY_PROGRESS_CONFIG_LIFECYCLE_KEY);
    expect(keys).toContain(OMES_REPOSITORY_PROGRESS_LIFECYCLE_KEY);

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
  const permissionsSql =
    readFileSync(
      join(import.meta.dir, "../sql/155_awcms_omes_control_permissions.sql"),
      "utf8"
    ) +
    // ahliweb/omes#232 added two more module permissions (ai_privacy.read/
    // .approve) via a NEW migration rather than editing the already-applied
    // sql/155 — this repo's own immutable-migration rule. This test's own
    // "seeds exactly the declared permissions" claim must therefore look
    // across every migration that ever added an omes_control permission,
    // not only the first one.
    readFileSync(
      join(import.meta.dir, "../sql/161_awcms_omes_ai_privacy_permissions.sql"),
      "utf8"
    ) +
    // ahliweb/omes#246 part 2 adds the sixteenth the same way, via sql/164.
    readFileSync(
      join(
        import.meta.dir,
        "../sql/164_awcms_omes_hermes_orchestration_permissions.sql"
      ),
      "utf8"
    ) +
    // ahliweb/omes#246 part 3 adds the seventeenth, via sql/165 — no schema
    // migration accompanies it (the Architecture screen has no table; see
    // sql/165's own header comment).
    readFileSync(
      join(
        import.meta.dir,
        "../sql/165_awcms_omes_architecture_permissions.sql"
      ),
      "utf8"
    ) +
    // ahliweb/omes#249 (ADR-0030) adds the eighteenth, via sql/167.
    readFileSync(
      join(
        import.meta.dir,
        "../sql/167_awcms_omes_repository_progress_permissions.sql"
      ),
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

  test("the permissions migrations seed exactly the 18 declared module permissions", () => {
    const permissions = omesControlModule.permissions ?? [];
    for (const perm of permissions) {
      expect(permissionsSql).toContain(
        `('omes_control', '${perm.activityCode}', '${perm.action}',`
      );
    }
  });
});
