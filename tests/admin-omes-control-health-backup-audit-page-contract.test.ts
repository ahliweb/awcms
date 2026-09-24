/**
 * Contract tests for the three `/admin/omes/{health,backups,audit}` screens,
 * Issue ahliweb/omes#201 (parent #195). Sibling of
 * `admin-omes-control-page-contract.test.ts` (the first five #200 screens),
 * same pattern, same standard: these assertions are written to catch a
 * swapped or weakened permission and an unseeded permission, not merely to
 * confirm the file exists and imports the right module.
 *
 * Pure — no database, no network. RLS/cross-tenant row isolation and the
 * workflow-approval state machine itself are exercised by
 * `tests/omes-control-*.test.ts` and the #198 integration suite; this file
 * pins the SCREEN's own contract with those already-tested endpoints.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

const PAGES = {
  health: "src/pages/admin/omes/health.astro",
  backups: "src/pages/admin/omes/backups.astro",
  audit: "src/pages/admin/omes/audit.astro"
} as const;

const ROUTES = [
  "src/pages/api/v1/omes/health/index.ts",
  "src/pages/api/v1/omes/backups/index.ts",
  "src/pages/api/v1/omes/backups/[id].ts",
  "src/pages/api/v1/omes/backups/[id]/restore.ts",
  "src/pages/api/v1/omes/audit/index.ts"
];

const APPLICATION_FILES = [
  "src/modules/omes-control/application/health-directory.ts",
  "src/modules/omes-control/application/backup-directory.ts",
  "src/modules/omes-control/application/backup-restore.ts",
  "src/modules/omes-control/application/audit-directory.ts",
  // The backups screen reuses this for its restore-requests list.
  "src/modules/omes-control/application/operation-directory.ts"
];

type Triple = `omes_control.${string}.${string}`;

function guardReferenceTriples(source: string): Set<Triple> {
  const found = new Set<Triple>();

  for (const match of source.matchAll(
    /OMES_GUARDS\.([a-zA-Z]+)\.([a-zA-Z]+)/g
  )) {
    found.add(`omes_control.${match[1]}.${match[2]}` as Triple);
  }

  for (const match of source.matchAll(
    /moduleKey:\s*"omes_control",\s*activityCode:\s*"([a-zA-Z]+)",\s*action:\s*"([a-zA-Z]+)"/g
  )) {
    found.add(`omes_control.${match[1]}.${match[2]}` as Triple);
  }

  return found;
}

function declaredTriples(): Set<Triple> {
  return new Set<Triple>(
    (listModules()
      .find((module) => module.key === "omes_control")
      ?.permissions?.map(
        (permission) =>
          `omes_control.${permission.activityCode}.${permission.action}`
      ) ?? []) as Triple[]
  );
}

async function readAll(paths: string[]): Promise<string> {
  const contents = await Promise.all(
    paths.map((path) => readFile(path, "utf8"))
  );
  return contents.join("\n");
}

describe("health/backups/audit screens gate on triples their endpoints actually enforce", () => {
  test("every OMES_GUARDS reference across the three screens is enforced by at least one omes endpoint", async () => {
    const pageSource = await readAll(Object.values(PAGES));
    const pageTriples = guardReferenceTriples(pageSource);

    expect(pageTriples.size).toBeGreaterThan(1);

    const routeSource = await readAll(ROUTES);
    const enforced = guardReferenceTriples(routeSource);
    expect(enforced.size).toBeGreaterThan(0);

    const unenforced = [...pageTriples].filter(
      (triple) => !enforced.has(triple)
    );
    expect(unenforced).toEqual([]);
  });

  test("every OMES_GUARDS reference is declared by the module descriptor, so sql/155 seeds it", async () => {
    const declared = declaredTriples();
    expect(declared.size).toBe(13);

    const pageSource = await readAll(Object.values(PAGES));
    const missing = [...guardReferenceTriples(pageSource)].filter(
      (triple) => !declared.has(triple)
    );

    expect(missing).toEqual([]);
  });

  test("the three new nav entries reuse a seeded permission, and health specifically reuses servers.read", async () => {
    const sql155 = await readFile(
      "sql/155_awcms_omes_control_permissions.sql",
      "utf8"
    );
    const seeded = new Set(
      [...sql155.matchAll(/\('omes_control', '([a-z_]+)', '([a-z_]+)',/g)].map(
        (match) => `omes_control.${match[1]}.${match[2]}` as Triple
      )
    );

    const nav = listModules().find(
      (module) => module.key === "omes_control"
    )?.navigation;
    const byPath = new Map((nav ?? []).map((entry) => [entry.path, entry]));

    const health = byPath.get("/admin/omes/health");
    const backups = byPath.get("/admin/omes/backups");
    const audit = byPath.get("/admin/omes/audit");

    expect(health?.requiredPermission).toBe("omes_control.servers.read");
    expect(backups?.requiredPermission).toBe("omes_control.backups.read");
    expect(audit?.requiredPermission).toBe("omes_control.audit.read");

    for (const entry of [health, backups, audit]) {
      expect(entry?.requiredPermission).toBeDefined();
      expect(seeded.has(entry?.requiredPermission as Triple)).toBe(true);
    }
  });
});

describe("health/backups/audit screens never mutate directly", () => {
  test("no screen executes SQL — every change goes out over fetch to a guarded endpoint", async () => {
    for (const [name, path] of Object.entries(PAGES)) {
      const source = await readFile(path, "utf8");
      expect(
        source,
        `${name} (${path}) must not execute SQL directly`
      ).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+awcms_|DELETE\s+FROM)/i);
    }
  });

  test("health and audit are read-only — no fetch mutation, matching their endpoints' GET-only shape", async () => {
    for (const name of ["health", "audit"] as const) {
      const page = await readFile(PAGES[name], "utf8");
      expect(page).not.toMatch(/sendJson\(\s*"(POST|PATCH|PUT|DELETE)"/);
    }

    const healthRoute = await readFile(
      "src/pages/api/v1/omes/health/index.ts",
      "utf8"
    );
    expect(healthRoute).not.toMatch(/export const (POST|PATCH|PUT|DELETE)/);

    const auditRoute = await readFile(
      "src/pages/api/v1/omes/audit/index.ts",
      "utf8"
    );
    expect(auditRoute).not.toMatch(/export const (POST|PATCH|PUT|DELETE)/);
  });

  test("backups' one mutation (restore) carries an Idempotency-Key, matching the endpoint's own requirement", async () => {
    const backupsPage = await readFile(PAGES.backups, "utf8");
    expect(backupsPage).toContain('"Idempotency-Key": crypto.randomUUID()');
    expect(backupsPage).toContain("/api/v1/omes/backups/${backupId}/restore`");

    const restoreRoute = await readFile(
      "src/pages/api/v1/omes/backups/[id]/restore.ts",
      "utf8"
    );
    expect(restoreRoute).toContain("IDEMPOTENCY_REQUIRED");
  });
});

describe("stale/missing health evidence renders explicitly, never as healthy", () => {
  test("the health screen has its own stale badge, distinct from the base overallStatus badge", async () => {
    const page = await readFile(PAGES.health, "utf8");
    expect(page).toContain("snapshot.stale &&");
    expect(page).toContain('data-variant="warning"');
    expect(page).toContain('{t("stale")}');
    // The base status badge's variant is looked up separately from the
    // staleness badge, so a stale-but-"healthy" snapshot cannot render a
    // single success-only badge.
    expect(page).toContain("STATUS_VARIANT[snapshot.overallStatus]");
  });

  test("health-directory.ts computes staleness from the snapshot's own captured_at, not inferred from absence", async () => {
    const source = await readFile(
      "src/modules/omes-control/application/health-directory.ts",
      "utf8"
    );
    expect(source).toContain("isHeartbeatStale(row.captured_at, now)");
    expect(source).toContain("stale: boolean");
  });

  test("the health summary card shows a stale-snapshot count as its own stat, never folded into a healthy total", async () => {
    const page = await readFile(PAGES.health, "utf8");
    expect(page).toContain("staleCount");
    expect(page).toContain('{t("Stale snapshots")}');
  });

  test("backups shows an explicit not-fresh badge (age-derived) independent of the completed/verified status badge", async () => {
    const page = await readFile(PAGES.backups, "utf8");
    expect(page).toContain("!backup.fresh &&");
    expect(page).toContain('data-variant="warning"');
    expect(page).toContain('{t("not fresh")}');
  });
});

describe("backup restore remains approval-gated, never a second approval authority", () => {
  test("the restore button is rendered only for an actor holding backups.restore, the endpoint's own permission", async () => {
    const page = await readFile(PAGES.backups, "utf8");
    // canRestore must be assigned from OMES_GUARDS.backups.restore, not a
    // coarser read permission that would let a read-only actor see the
    // button an endpoint denial would then reject.
    const canRestoreAssignment = page.match(
      /const canRestore = screen\.state === "allowed" && screen\.data\.canRestore;/
    );
    expect(canRestoreAssignment).not.toBeNull();
    expect(page).toContain("await can(OMES_GUARDS.backups.restore)");
  });

  test("a submitted restore links into /admin/approvals by workflow instance, never a second approval surface", async () => {
    const page = await readFile(PAGES.backups, "utf8");
    expect(page).toContain("/admin/approvals?");
    expect(page).toContain("workflowKey");
    expect(page).toContain("workflowInstanceId");
    expect(page).not.toMatch(
      /sendJson\(\s*"(POST|PATCH)"\s*,\s*`?\/api\/v1\/workflows/
    );
  });

  test("the restore endpoint itself routes through startWorkflowInstance, and refuses when no workflow is published", async () => {
    const application = await readFile(
      "src/modules/omes-control/application/backup-restore.ts",
      "utf8"
    );
    expect(application).toContain("startWorkflowInstance");
    expect(application).toContain("approval_workflow_not_configured");

    const route = await readFile(
      "src/pages/api/v1/omes/backups/[id]/restore.ts",
      "utf8"
    );
    expect(route).toContain("APPROVAL_WORKFLOW_NOT_CONFIGURED");

    const page = await readFile(PAGES.backups, "utf8");
    expect(page).toContain("APPROVAL_WORKFLOW_NOT_CONFIGURED");
  });

  test("restore is never folded into the safe-operation allowlist", async () => {
    const page = await readFile(PAGES.backups, "utf8");
    expect(page).not.toMatch(/OMES_OPERATION_CODES/);
  });
});

describe("audit source-labelling: two feeds, never merged into one", () => {
  test("the audit screen reads BOTH the canonical control-plane log and the remote OMES projection, as separate calls", async () => {
    const page = await readFile(PAGES.audit, "utf8");
    expect(page).toContain("listAuditEvents(tx, ssr.tenantId,");
    expect(page).toContain("fetchAuditProjections(tx, ssr.tenantId,");
  });

  test("the canonical control-plane query is narrowed to the omes_control module, not every module's events", async () => {
    const page = await readFile(PAGES.audit, "utf8");
    expect(page).toContain('moduleKey: "omes_control"');
  });

  test("the two feeds render in separate, distinctly-sourced sections, not one shared loop", async () => {
    const page = await readFile(PAGES.audit, "utf8");
    expect(page).toContain('data-source="awcms-control-plane"');
    expect(page).toContain('data-source="omes-host"');
    expect(page).toContain("controlPlaneEvents.map(");
    expect(page).toContain("projections.map(");
    // No single array concatenation/merge of the two result sets.
    expect(page).not.toMatch(
      /controlPlaneEvents\.concat\(|\[\.\.\.controlPlaneEvents,\s*\.\.\.projections\]/
    );
  });

  test("listAuditEvents' moduleKey filter is additive — every existing caller is unaffected", async () => {
    const source = await readFile(
      "src/modules/logging/application/audit-log.ts",
      "utf8"
    );
    expect(source).toContain("moduleKey?: string");
    expect(source).toContain(
      "AND (${moduleKey}::text IS NULL OR module_key = ${moduleKey})"
    );

    // The pre-existing audit-trail screen and its API route must not have
    // been forced to pass the new option — their own `listAuditEvents(...)`
    // call sites are unchanged (only their unrelated `authorize: {
    // moduleKey: "logging", ... }` guard objects legitimately contain the
    // substring "moduleKey", so this checks the call site specifically).
    const auditTrailPage = await readFile(
      "src/pages/admin/audit-trail.astro",
      "utf8"
    );
    const auditTrailCallSite = auditTrailPage.match(
      /listAuditEvents\(tx, ssr\.tenantId, \{[^}]*\}\)/
    )?.[0];
    expect(auditTrailCallSite).toBeDefined();
    expect(auditTrailCallSite).not.toContain("moduleKey");

    const auditApiRoute = await readFile(
      "src/pages/api/v1/logs/audit.ts",
      "utf8"
    );
    const auditApiCallSite = auditApiRoute.match(
      /listAuditEvents\([^)]*\)/
    )?.[0];
    expect(auditApiCallSite).toBeDefined();
    expect(auditApiCallSite).not.toContain("moduleKey");
  });
});

describe("cross-tenant scoping (static half — row-level enforcement is exercised by #198's own tests)", () => {
  test("every application-layer read/write these three screens consume is scoped by the caller's tenantId", async () => {
    for (const path of APPLICATION_FILES) {
      const source = await readFile(path, "utf8");
      expect(
        source,
        `${path} must filter every query by tenant_id = \${tenantId}`
      ).toContain("tenant_id = ${tenantId}");
    }
  });

  test("submitBackupRestore resolves the target server from the CALLER's own tenant-scoped backup row, never a foreign one", async () => {
    const source = await readFile(
      "src/modules/omes-control/application/backup-restore.ts",
      "utf8"
    );
    expect(source).toContain(
      "WHERE tenant_id = ${tenantId} AND id = ${backupId}"
    );
    expect(source).toContain('outcome: "backup_not_found"');
  });

  test("none of the three screens accept a tenant identifier from the request — the session's own tenantId is the only source", async () => {
    for (const [name, path] of Object.entries(PAGES)) {
      const source = await readFile(path, "utf8");
      expect(
        source,
        `${name} (${path}) must not read a tenant id from query params or the request`
      ).not.toMatch(/searchParams\.get\(\s*["']tenant/i);
    }
  });
});

describe("evidence is escaped, never raw HTML, and no raw backup contents are exposed", () => {
  test("every JSON evidence block in the three screens uses set:text, never set:html", async () => {
    for (const [name, path] of Object.entries(PAGES)) {
      const source = await readFile(path, "utf8");
      expect(source, `${name} (${path}) must not use set:html`).not.toMatch(
        /set:html/
      );
    }
  });

  test("the backups screen renders only the manifest, never a raw backup content/body field", async () => {
    const page = await readFile(PAGES.backups, "utf8");
    expect(page).toContain("backup.manifest");
    expect(page).not.toMatch(/backup\.(content|contents|body|payloadBytes)/);
  });
});
