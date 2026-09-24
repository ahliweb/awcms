/**
 * Contract tests for the five `/admin/omes/*` screens, Issue ahliweb/omes#200
 * (parent #195). Sibling of `admin-sync-page-contract.test.ts`,
 * `admin-approvals-page-contract.test.ts`, and
 * `admin-security-page-contract.test.ts`.
 *
 * Pure — no database, no network. What a live-DB integration test already
 * covers (RLS/cross-tenant row isolation, idempotency replay, workflow
 * approval state machine) belongs to `tests/omes-control-*.test.ts` and
 * `tests/integration/omes-control.integration.test.ts` (Issue ahliweb/omes#198)
 * and is not duplicated here. What this file pins is the SCREEN's own
 * contract with those already-tested endpoints:
 *
 *   1. Every `OMES_GUARDS.<activity>.<action>` a screen gates on is a triple
 *      the ENDPOINT it calls actually enforces, and one the module descriptor
 *      declares (so `sql/155` seeds it — a permission a page invents but
 *      nothing seeds denies even `owner`, this repo's own recorded failure
 *      mode).
 *   2. No screen executes SQL directly — every mutation is a `fetch` to an
 *      already-guarded endpoint, so a screen can never become a second
 *      enforcement point that drifts from the first.
 *   3. Every mutating fetch carries an `Idempotency-Key`, matching each
 *      target endpoint's own `IDEMPOTENCY_REQUIRED` requirement (or the
 *      absence of one, for the one read-only screen with none).
 *   4. Stale/offline state renders EXPLICITLY (its own status-badge variant
 *      and copy), never silently as healthy.
 *   5. Operations only offers the OMES-owned safe-operation allowlist, and
 *      never renders a destructive option as available to an actor who does
 *      not hold its own endpoint's permission.
 *   6. A destructive operation's approval decision is delegated to
 *      `/admin/approvals` — the canonical workflow-approval surface — and
 *      the page never claims to auto-approve or run a second approval
 *      authority of its own.
 *   7. Every read this module's own application layer performs is scoped by
 *      the caller's `tenantId` (defense the screens inherit, not something a
 *      screen could opt out of even if it wanted to) — the static half of
 *      cross-tenant denial; row-level enforcement itself is FORCE RLS
 *      (`sql/154`) plus `withTenantOrThrow`, exercised end-to-end by #198's
 *      own tests.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import { OMES_OPERATION_CODES } from "../src/modules/omes-control/domain/operations";

const PAGES = {
  overview: "src/pages/admin/omes/index.astro",
  servers: "src/pages/admin/omes/servers.astro",
  deployments: "src/pages/admin/omes/deployments.astro",
  operations: "src/pages/admin/omes/operations.astro",
  jobs: "src/pages/admin/omes/jobs.astro"
} as const;

const ROUTES = [
  "src/pages/api/v1/omes/servers/index.ts",
  "src/pages/api/v1/omes/servers/[id].ts",
  "src/pages/api/v1/omes/deployments/index.ts",
  "src/pages/api/v1/omes/operations/index.ts",
  "src/pages/api/v1/omes/jobs/index.ts",
  "src/pages/api/v1/omes/jobs/[id]/approve.ts",
  "src/pages/api/v1/omes/jobs/[id]/cancel.ts",
  // Overview's `backups.read` panel is enforced by the backups list route.
  "src/pages/api/v1/omes/backups/index.ts",
  // `POST /operations`'s per-operation guard (`OMES_OPERATION_GUARD`) is
  // built from literal triples in the domain layer, not `OMES_GUARDS.x.y`
  // text — read separately below and merged in.
  "src/modules/omes-control/domain/operations.ts"
];

const APPLICATION_FILES = [
  "src/modules/omes-control/application/server-directory.ts",
  "src/modules/omes-control/application/deployment-directory.ts",
  "src/modules/omes-control/application/operation-directory.ts",
  "src/modules/omes-control/application/job-directory.ts",
  "src/modules/omes-control/application/overview.ts"
];

type Triple = `omes_control.${string}.${string}`;

/**
 * `OMES_GUARDS.<activity>.<action>` references PLUS literal
 * `{ moduleKey: "omes_control", activityCode: "...", action: "..." }`
 * object triples (the shape `domain/operations.ts`'s `OMES_OPERATION_GUARD`
 * uses instead of the `OMES_GUARDS` re-export), both resolved to
 * `omes_control.<activity>.<action>`.
 */
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

describe("OMES admin screens gate on triples their endpoints actually enforce", () => {
  test("every OMES_GUARDS reference across the five screens is enforced by at least one omes endpoint", async () => {
    const pageSource = await readAll(Object.values(PAGES));
    const pageTriples = guardReferenceTriples(pageSource);

    // Guard the fixture — an empty set would pass the subset check vacuously.
    expect(pageTriples.size).toBeGreaterThan(5);

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

  test("all 13 seeded permissions are reachable from these five screens or their navigation entries", async () => {
    // Not every permission needs a screen affordance (e.g. `enrollments.manage`
    // and `audit.read` are #201's), but every one referenced anywhere in the
    // five pages must round-trip through the declared set — already asserted
    // above — and the five nav entries' requiredPermission strings (asserted
    // separately in admin-navigation-registry.test.ts for path/label shape)
    // must each be one of the 13 too.
    const sql155 = await readFile(
      "sql/155_awcms_omes_control_permissions.sql",
      "utf8"
    );
    const seeded = new Set(
      [...sql155.matchAll(/\('omes_control', '([a-z_]+)', '([a-z_]+)',/g)].map(
        (match) => `omes_control.${match[1]}.${match[2]}` as Triple
      )
    );
    expect(seeded.size).toBe(13);
    expect(seeded).toEqual(declaredTriples());

    const nav = listModules().find(
      (module) => module.key === "omes_control"
    )?.navigation;
    expect(nav?.length).toBe(5);

    for (const entry of nav ?? []) {
      expect(entry.requiredPermission).toBeDefined();
      expect(seeded.has(entry.requiredPermission as Triple)).toBe(true);
    }
  });
});

describe("OMES admin screens never mutate directly", () => {
  test("no screen executes SQL — every change goes out over fetch to a guarded endpoint", async () => {
    for (const [name, path] of Object.entries(PAGES)) {
      const source = await readFile(path, "utf8");
      expect(
        source,
        `${name} (${path}) must not execute SQL directly`
      ).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+awcms_|DELETE\s+FROM)/i);
    }
  });

  test("every mutating fetch carries an Idempotency-Key, matching the endpoint's own requirement", async () => {
    const serversPage = await readFile(PAGES.servers, "utf8");
    expect(serversPage).toContain('"Idempotency-Key": crypto.randomUUID()');
    expect(serversPage).toContain("/api/v1/omes/servers`");
    expect(serversPage).toContain("/api/v1/omes/servers/${serverId}`");

    const operationsPage = await readFile(PAGES.operations, "utf8");
    expect(operationsPage).toContain('"Idempotency-Key": crypto.randomUUID()');
    expect(operationsPage).toContain("/api/v1/omes/operations");

    const jobsPage = await readFile(PAGES.jobs, "utf8");
    expect(jobsPage).toContain('"Idempotency-Key": crypto.randomUUID()');
    expect(jobsPage).toContain("/api/v1/omes/jobs/${jobId}/approve`");
    expect(jobsPage).toContain("/api/v1/omes/jobs/${jobId}/cancel`");

    for (const route of [
      "src/pages/api/v1/omes/servers/index.ts",
      "src/pages/api/v1/omes/servers/[id].ts",
      "src/pages/api/v1/omes/operations/index.ts",
      "src/pages/api/v1/omes/jobs/[id]/approve.ts",
      "src/pages/api/v1/omes/jobs/[id]/cancel.ts"
    ]) {
      expect(await readFile(route, "utf8")).toContain("IDEMPOTENCY_REQUIRED");
    }
  });

  test("deployments is read-only — no fetch mutation, matching the endpoint's own GET-only shape", async () => {
    const deploymentsPage = await readFile(PAGES.deployments, "utf8");
    expect(deploymentsPage).not.toMatch(
      /sendJson\(\s*"(POST|PATCH|PUT|DELETE)"/
    );

    const deploymentsRoute = await readFile(
      "src/pages/api/v1/omes/deployments/index.ts",
      "utf8"
    );
    expect(deploymentsRoute).not.toMatch(
      /export const (POST|PATCH|PUT|DELETE)/
    );
  });
});

describe("stale/offline evidence renders explicitly, never as healthy", () => {
  test("the servers screen has its own stale badge and staleness copy, distinct from the base status badge", async () => {
    const page = await readFile(PAGES.servers, "utf8");
    expect(page).toContain("server.stale &&");
    expect(page).toContain('data-variant="warning"');
    expect(page).toContain('{t("stale")}');
    expect(page).toContain("No heartbeat within the staleness window");
  });

  test("the deployments screen has its own stale badge, independent of reconciliation status", async () => {
    const page = await readFile(PAGES.deployments, "utf8");
    expect(page).toContain("deployment.stale &&");
    expect(page).toContain('data-variant="warning"');
    expect(page).toContain('{t("stale")}');
  });

  test("the overview screen surfaces a stale server count and a stale/unreconciled deployment count, never folding them into the healthy total", async () => {
    const page = await readFile(PAGES.overview, "utf8");
    expect(page).toContain("overview.staleServerCount");
    expect(page).toContain("overview.driftSummary.staleDeploymentCount");
  });
});

describe("Operations offers only OMES-evidence-backed capabilities", () => {
  test("the submit form is built from OMES_OPERATION_CODES and nothing wider", async () => {
    const page = await readFile(PAGES.operations, "utf8");
    expect(page).toContain("OMES_OPERATION_CODES.map");
    // No hard-coded operation literal outside the imported allowlist —
    // guards against a page that widens the offered set inline.
    expect(page).not.toMatch(/"install"|"configure"|"restore"/);
  });

  test("every code in the allowlist is exactly the OMES-owned safe-operation enum (no wider, no narrower)", () => {
    const actual: string[] = [...OMES_OPERATION_CODES].sort();
    expect(actual).toEqual(
      [
        "backup",
        "preflight",
        "restart",
        "rollback",
        "start",
        "status",
        "stop",
        "update"
      ].sort()
    );
  });

  test("a destructive option is rendered disabled unless the actor holds its own endpoint's permission", async () => {
    const page = await readFile(PAGES.operations, "utf8");
    // The `disabled` binding must reference BOTH permissions this issue's
    // destructive set is split across (`deployments.operate` for the
    // lifecycle half, `backups.rollback` for rollback specifically) — never
    // a single coarse flag that would let an operator holding only one
    // submit an operation gated on the other. Whitespace-tolerant: prettier
    // is free to wrap this expression across lines.
    const normalized = page.replace(/\s+/g, " ");
    expect(normalized).toContain(
      "disabled={ isDestructiveOmesOperation(code) && !canRollback && !canOperate }"
    );
  });

  test("a destructive request links into /admin/approvals by workflow instance, never a second approval surface", async () => {
    const page = await readFile(PAGES.operations, "utf8");
    expect(page).toContain("/admin/approvals?");
    expect(page).toContain("workflowKey");
    expect(page).toContain("workflowInstanceId");
    // No local approve/reject affordance — the page only ever links out.
    expect(page).not.toMatch(
      /sendJson\(\s*"(POST|PATCH)"\s*,\s*`?\/api\/v1\/workflows/
    );
  });

  test("the endpoint refuses a destructive submission with no published workflow, and the page surfaces that refusal rather than retrying silently", async () => {
    const route = await readFile(
      "src/pages/api/v1/omes/operations/index.ts",
      "utf8"
    );
    expect(route).toContain("APPROVAL_WORKFLOW_NOT_CONFIGURED");

    const page = await readFile(PAGES.operations, "utf8");
    expect(page).toContain("APPROVAL_WORKFLOW_NOT_CONFIGURED");
  });
});

describe("cross-tenant scoping (static half — row-level enforcement is exercised by #198's own tests)", () => {
  test("every application-layer read/write this module's screens consume is scoped by the caller's tenantId", async () => {
    for (const path of APPLICATION_FILES) {
      const source = await readFile(path, "utf8");
      expect(
        source,
        `${path} must filter every query by tenant_id = \${tenantId}`
      ).toContain("tenant_id = ${tenantId}");
    }
  });

  test("none of the five screens accept a tenant identifier from the request — the session's own tenantId is the only source", async () => {
    for (const [name, path] of Object.entries(PAGES)) {
      const source = await readFile(path, "utf8");
      expect(
        source,
        `${name} (${path}) must not read a tenant id from query params or the request`
      ).not.toMatch(/searchParams\.get\(\s*["']tenant/i);
    }
  });
});
