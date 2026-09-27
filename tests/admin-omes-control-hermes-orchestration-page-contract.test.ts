/**
 * Contract tests for the three new `/admin/omes/*` screens, Issue
 * ahliweb/omes#246 part 2 (OMES issue #183, ADR-0028; parent #195):
 * `orkestrasi-langsung.astro`, `hermes.astro`, `progres-hermes.astro`.
 * Sibling of `admin-omes-control-enrollments-page-contract.test.ts` — same
 * pattern, same standard.
 *
 * Pure — no database, no network. RLS/cross-tenant row isolation,
 * idempotent event replay, staleness recomputation, and disallowed-key
 * rejection are exercised at runtime by
 * `tests/integration/omes-control-hermes-orchestration.integration.test.ts`.
 * What this file pins is each screen's own permission-guard contract, and
 * `progres-hermes.astro`'s deliberate no-GitHub-integration/no-static-list
 * empty state (coordinator decision, ahliweb/omes#246).
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

const LIVE_TREE_PAGE = "src/pages/admin/omes/orkestrasi-langsung.astro";
const HERMES_PAGE = "src/pages/admin/omes/hermes.astro";
const PROGRESS_PAGE = "src/pages/admin/omes/progres-hermes.astro";

const ROUTES = [
  "src/pages/api/v1/omes/hermes-orchestration/tree.ts",
  "src/pages/api/v1/omes/hermes-orchestration/events.ts"
];

const APPLICATION_FILES = [
  "src/modules/omes-control/application/hermes-orchestration-directory.ts"
];

type Triple = `omes_control.${string}.${string}`;

/** `hermesOrchestration` -> `hermes_orchestration` — `OMES_GUARDS`'s camelCase
 * property names are the same activityCode string in camelCase form, by the
 * convention `domain/permissions.ts` establishes; this converts it back so
 * it round-trips with `declaredTriples()`'s snake_case `activityCode`. */
function camelToSnake(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function guardReferenceTriples(source: string): Set<Triple> {
  const found = new Set<Triple>();

  for (const match of source.matchAll(
    /OMES_GUARDS\.([a-zA-Z]+)\.([a-zA-Z]+)/g
  )) {
    found.add(`omes_control.${camelToSnake(match[1]!)}.${match[2]}` as Triple);
  }

  for (const match of source.matchAll(
    /moduleKey:\s*"omes_control",\s*activityCode:\s*"([a-zA-Z_]+)",\s*action:\s*"([a-zA-Z]+)"/g
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

describe("all three new screens gate on hermes_orchestration.read, enforced by their endpoints", () => {
  test("every OMES_GUARDS reference across the three pages is exactly omes_control.hermes_orchestration.read", async () => {
    const pageSource = await Promise.all(
      [LIVE_TREE_PAGE, HERMES_PAGE, PROGRESS_PAGE].map((path) =>
        readFile(path, "utf8")
      )
    ).then((contents) => contents.join("\n"));
    const pageTriples = guardReferenceTriples(pageSource);

    // Each page's docblock prose ALSO mentions `OMES_GUARDS.hermesOrchestration.read`
    // (explaining why the literal-object form is used instead — see
    // ai-privacy.astro's own comment for the same pattern), so the set may
    // contain more than one entry; what matters is that the one real,
    // enforced triple is present and nothing else claims a DIFFERENT
    // permission.
    expect(pageTriples.size).toBeGreaterThan(0);
    expect(pageTriples).toContain("omes_control.hermes_orchestration.read");
    for (const triple of pageTriples) {
      expect(triple).toBe("omes_control.hermes_orchestration.read");
    }
  });

  test("hermes_orchestration.read is enforced by both new read routes", async () => {
    for (const route of ROUTES) {
      const routeSource = await readFile(route, "utf8");
      const enforced = guardReferenceTriples(routeSource);
      expect(enforced.has("omes_control.hermes_orchestration.read")).toBe(true);
    }
  });

  test("hermes_orchestration.read is declared by the module descriptor, so sql/164 seeds it", async () => {
    const declared = declaredTriples();
    expect(declared.has("omes_control.hermes_orchestration.read")).toBe(true);

    const sql164 = await readFile(
      "sql/164_awcms_omes_hermes_orchestration_permissions.sql",
      "utf8"
    );
    expect(sql164).toContain(
      "('omes_control', 'hermes_orchestration', 'read',"
    );
  });

  test("all three nav entries require exactly hermes_orchestration.read", async () => {
    const nav = listModules().find(
      (module) => module.key === "omes_control"
    )?.navigation;

    for (const path of [
      "/admin/omes/orkestrasi-langsung",
      "/admin/omes/hermes",
      "/admin/omes/progres-hermes"
    ]) {
      const entry = (nav ?? []).find((item) => item.path === path);
      expect(entry).toBeDefined();
      expect(entry?.requiredPermission).toBe(
        "omes_control.hermes_orchestration.read"
      );
    }
  });
});

describe("none of the three screens executes SQL directly", () => {
  test("every page reads only through fetch/application calls, never a raw INSERT/UPDATE/DELETE", async () => {
    for (const path of [LIVE_TREE_PAGE, HERMES_PAGE, PROGRESS_PAGE]) {
      const source = await readFile(path, "utf8");
      expect(source).not.toMatch(
        /\b(INSERT\s+INTO|UPDATE\s+awcms_|DELETE\s+FROM)/i
      );
    }
  });
});

describe("cross-tenant scoping (static half — row-level enforcement is exercised by the integration suite)", () => {
  test("every application-layer read these screens consume is scoped by the caller's tenantId", async () => {
    for (const path of APPLICATION_FILES) {
      const source = await readFile(path, "utf8");
      expect(
        source,
        `${path} must filter by tenant_id = \${tenantId}`
      ).toContain("tenant_id = ${tenantId}");
    }
  });

  test("none of the three screens accepts a tenant identifier from the request — the session's own tenantId is the only source", async () => {
    for (const path of [LIVE_TREE_PAGE, HERMES_PAGE, PROGRESS_PAGE]) {
      const source = await readFile(path, "utf8");
      expect(source).not.toMatch(/searchParams\.get\(\s*["']tenant/i);
    }
  });
});

describe("Hermes screen: planner/budget are explicit 'not reported', never invented", () => {
  test("the page renders 'not reported' for planner and step budget and cites the v1-contract gap", async () => {
    const source = await readFile(HERMES_PAGE, "utf8");
    expect(source).toContain('t("Planner")');
    expect(source).toContain('t("Step budget")');
    expect(source).toContain('t("not reported")');
    expect(source).toContain('t("not available in the v1 contract")');
  });

  test("the page never fabricates a planner/budget value from tree/event fields — no field named planner or budget is read from the projection", async () => {
    const directory = await readFile(
      "src/modules/omes-control/application/hermes-orchestration-directory.ts",
      "utf8"
    );
    const domain = await readFile(
      "src/modules/omes-control/domain/hermes-orchestration.ts",
      "utf8"
    );
    expect(directory.toLowerCase()).not.toContain("planner");
    expect(directory.toLowerCase()).not.toContain("budget");
    expect(domain.toLowerCase()).not.toContain("planner");
    expect(domain.toLowerCase()).not.toContain("budget");
  });
});

describe("Progres Hermes: explicit empty state, no GitHub integration, no static list", () => {
  test("the page renders an explicit not-implemented empty state linking the tracking issue", async () => {
    const source = await readFile(PROGRESS_PAGE, "utf8");
    expect(source).toContain("https://github.com/ahliweb/omes/issues/249");
    expect(source).toContain('t("This view is not implemented yet")');
  });

  test("the page makes no GitHub API call and defines no static milestone/issue list", async () => {
    const source = await readFile(PROGRESS_PAGE, "utf8");
    expect(source).not.toMatch(/api\.github\.com/);
    expect(source).not.toMatch(/fetch\(/);
    // No MILESTONES/ISSUES-shaped literal array the redesign's own
    // prototype used — this screen carries no fabricated progress data.
    expect(source).not.toMatch(/const\s+MILESTONES\s*=/);
    expect(source).not.toMatch(/const\s+ISSUES\s*=/);
  });

  test("the page still enforces the permission guard server-side even though it renders no real data", async () => {
    const source = await readFile(PROGRESS_PAGE, "utf8");
    expect(source).toContain("loadAdminScreen");
    expect(source).toContain('activityCode: "hermes_orchestration"');
  });
});
