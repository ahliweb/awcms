/**
 * Contract tests for the three `/admin/omes/*` screens Issue
 * ahliweb/omes#246 part 2 (OMES issue #183, ADR-0028; parent #195) added:
 * `orkestrasi-langsung.astro`, `hermes.astro`, `progres-hermes.astro`.
 * Sibling of `admin-omes-control-enrollments-page-contract.test.ts` — same
 * pattern, same standard.
 *
 * Issue ahliweb/omes#249 (ADR-0030 in `ahliweb/omes`) replaced
 * `progres-hermes.astro`'s former "not implemented yet" empty state with a
 * real, polled GitHub repository-progress projection — see the dedicated
 * describe block below, which supersedes this file's former "explicit empty
 * state, no GitHub integration, no static list" assertions.
 *
 * Pure — no database, no network. RLS/cross-tenant row isolation, upsert
 * idempotency, error retention, and stale-freshness recomputation are
 * exercised at runtime by
 * `tests/integration/omes-control-hermes-orchestration.integration.test.ts`
 * and `tests/integration/omes-control-repository-progress.integration.test.ts`.
 * What this file pins is each screen's own permission-guard contract.
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
  "src/modules/omes-control/application/hermes-orchestration-directory.ts",
  "src/modules/omes-control/application/repository-progress-directory.ts",
  "src/modules/omes-control/application/repository-progress-config.ts"
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

describe("orkestrasi-langsung.astro and hermes.astro gate on hermes_orchestration.read ONLY", () => {
  test("every OMES_GUARDS reference across these two pages is exactly omes_control.hermes_orchestration.read", async () => {
    const pageSource = await Promise.all(
      [LIVE_TREE_PAGE, HERMES_PAGE].map((path) => readFile(path, "utf8"))
    ).then((contents) => contents.join("\n"));
    const pageTriples = guardReferenceTriples(pageSource);

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

describe("progres-hermes.astro gates its configuration form on the NEW repository_progress.configure permission (ahliweb/omes#249)", () => {
  test("the page references BOTH hermes_orchestration.read (view) and repository_progress.configure (form), and nothing else", async () => {
    const source = await readFile(PROGRESS_PAGE, "utf8");
    const triples = guardReferenceTriples(source);

    expect(triples.has("omes_control.hermes_orchestration.read")).toBe(true);
    expect(triples.has("omes_control.repository_progress.configure")).toBe(
      true
    );
    for (const triple of triples) {
      expect([
        "omes_control.hermes_orchestration.read",
        "omes_control.repository_progress.configure"
      ]).toContain(triple);
    }
  });

  test("the write routes (PUT/DELETE config) enforce repository_progress.configure, not the read permission", async () => {
    const source = await readFile(
      "src/pages/api/v1/omes/repository-progress/config.ts",
      "utf8"
    );
    const enforced = guardReferenceTriples(source);
    expect(enforced.has("omes_control.repository_progress.configure")).toBe(
      true
    );
  });

  test("the read routes (GET progress, GET config) enforce hermes_orchestration.read", async () => {
    for (const route of [
      "src/pages/api/v1/omes/repository-progress/index.ts",
      "src/pages/api/v1/omes/repository-progress/config.ts"
    ]) {
      const source = await readFile(route, "utf8");
      const enforced = guardReferenceTriples(source);
      expect(enforced.has("omes_control.hermes_orchestration.read")).toBe(true);
    }
  });

  test("repository_progress.configure is declared by the module descriptor, so sql/167 seeds it", async () => {
    const declared = declaredTriples();
    expect(declared.has("omes_control.repository_progress.configure")).toBe(
      true
    );

    const sql167 = await readFile(
      "sql/167_awcms_omes_repository_progress_permissions.sql",
      "utf8"
    );
    expect(sql167).toContain(
      "('omes_control', 'repository_progress', 'configure',"
    );
  });

  test("the mutating routes require an Idempotency-Key header", async () => {
    const source = await readFile(
      "src/pages/api/v1/omes/repository-progress/config.ts",
      "utf8"
    );
    expect(source.match(/idempotency-key/gi)?.length ?? 0).toBeGreaterThan(1);
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

describe("stale/unknown sessions never render nodes/events with live-state coloring", () => {
  test("orkestrasi-langsung.astro renders the historical/muted treatment for tree nodes and activity rows", async () => {
    const source = await readFile(LIVE_TREE_PAGE, "utf8");
    expect(source).toContain("node.isHistorical");
    expect(source).toContain("event.isHistorical");
    expect(source).toContain('t("last reported: {state}"');
    expect(source).toContain("data-historical=");
  });

  test("hermes.astro renders the historical/muted treatment for the current task's root node and log rows", async () => {
    const source = await readFile(HERMES_PAGE, "utf8");
    expect(source).toContain("rootNode.isHistorical");
    expect(source).toContain("event.isHistorical");
    expect(source).toContain('t("last reported: {state}"');
  });

  test("the domain layer stamps every node/event with isHistorical, recomputed from freshness — never a stored flag", async () => {
    const domain = await readFile(
      "src/modules/omes-control/domain/hermes-orchestration.ts",
      "utf8"
    );
    expect(domain).toContain("isHistorical");
  });
});

describe("Progres Hermes: real, polled projection (ahliweb/omes#249, ADR-0030) — never a live GitHub call from the page", () => {
  test("the page performs no direct GitHub API call — it only reads AWCMS's own polled projection", async () => {
    const source = await readFile(PROGRESS_PAGE, "utf8");
    // The screen must never call GitHub directly — only the scheduled poller
    // (scripts/omes-repository-progress-poll.ts) does that, outside any
    // request/response cycle. No literal api.github.com host anywhere in the
    // page, and no bare top-level `fetch(` in the server frontmatter (the
    // client `<script>` block's `sendJson`/`mutateAndReload` helpers wrap
    // `fetch` themselves and only ever hit this app's own `/api/v1/...`).
    expect(source).not.toContain("api.github.com");
    expect(source.split("---")[1] ?? "").not.toMatch(/\bfetch\(/);
  });

  test("renders the three explicit states — unconfigured, configured (with freshness), and error — never silently as empty", async () => {
    const source = await readFile(PROGRESS_PAGE, "utf8");
    expect(source).toContain('progress.state === "unconfigured"');
    expect(source).toContain('progress.state === "configured"');
    expect(source).toContain('t("No repository configured yet")');
    expect(source).toContain('t("Awaiting first poll")');
    expect(source).toContain('t("Stale")');
    expect(source).toContain('t("Fresh")');
    expect(source).toContain('t("Last poll failed")');
  });

  test("a poll error never surfaces a raw provider error body — only a translated error-class label", async () => {
    const source = await readFile(PROGRESS_PAGE, "utf8");
    expect(source).toContain("ERROR_CLASS_LABELS");
    // The raw `lastErrorClass` string itself is only ever used as a fallback
    // key lookup (`?? progress.lastErrorClass`), never rendered as a
    // provider-supplied message/body.
    expect(source).not.toMatch(/lastError(Message|Body|Detail)/);
  });

  test("milestone progress bars are accessible — a native <progress> with an aria-label, or role=progressbar with aria-valuenow", async () => {
    const source = await readFile(PROGRESS_PAGE, "utf8");
    const usesNativeProgress = /<progress[\s\S]*?aria-label=/.test(source);
    const usesAriaProgressbar =
      source.includes('role="progressbar"') && source.includes("aria-valuenow");
    expect(usesNativeProgress || usesAriaProgressbar).toBe(true);
  });

  test("issues link out to GitHub and show number/title/state/kind/milestone", async () => {
    const source = await readFile(PROGRESS_PAGE, "utf8");
    expect(source).toContain("issue.htmlUrl");
    expect(source).toContain("issue.number");
    expect(source).toContain("issue.title");
    expect(source).toContain("issue.state");
    expect(source).toContain("issue.kind");
    expect(source).toContain("issue.milestoneNumber");
  });

  // ahliweb/omes#249 UX polish follow-up (three fixes below).

  test("the issues table's Milestone column resolves the number to that milestone's TITLE, not the bare number", async () => {
    const source = await readFile(PROGRESS_PAGE, "utf8");
    // Looked up from the SAME poll's milestones list (never a second fetch),
    // falling back to `#<n>` when the number isn't in that list rather than
    // silently rendering nothing.
    expect(source).toContain("milestoneByNumber");
    expect(source).toContain("milestoneCellFor");
    expect(source).toMatch(/`#\$\{milestoneNumber\}`/);
    // The bare number is no longer rendered directly into the cell — only
    // ever read to key the lookup above.
    expect(source).not.toMatch(
      /<td[^>]*>\s*<span class="cell-muted">\s*\{issue\.milestoneNumber/
    );
  });

  test('"Clear configuration" uses the existing outlined .btn-danger vocabulary, not the same filled style as "Save"', async () => {
    const source = await readFile(PROGRESS_PAGE, "utf8");
    expect(source).toContain('id="repo-progress-config-clear"');
    expect(source).toMatch(
      /id="repo-progress-config-clear"[\s\S]{0,40}class="btn btn-danger"/
    );
    // Not the old, unstyled, invented class this screen shipped with.
    expect(source).not.toContain("button-secondary");
    // It already requires confirmation before the destructive DELETE —
    // this screen's own `window.confirm`, the same pattern every other
    // destructive admin action in this codebase uses.
    expect(source).toContain("window.confirm");
  });

  test('"Use a GitHub token" is a real, normally-sized checkbox — not the `.admin-create-form input` text-field box model', async () => {
    const source = await readFile(PROGRESS_PAGE, "utf8");
    expect(source).toContain('id="repo-progress-use-token"');
    expect(source).toContain('type="checkbox"');
  });

  test("the page still enforces the read permission guard server-side, and the configuration form re-checks its own permission via `can()`", async () => {
    const source = await readFile(PROGRESS_PAGE, "utf8");
    expect(source).toContain("loadAdminScreen");
    expect(source).toContain("authorize: HERMES_ORCHESTRATION_READ_GUARD");
    expect(source).toContain("can(REPOSITORY_PROGRESS_CONFIGURE_GUARD)");
  });

  test("the page is wrapped in the shared .omes-cc design system and introduces no inline style attributes (CSP)", async () => {
    const source = await readFile(PROGRESS_PAGE, "utf8");
    expect(source).toContain('class="omes-cc"');
    expect(source).not.toMatch(/\sstyle=["'{]/);
  });
});
