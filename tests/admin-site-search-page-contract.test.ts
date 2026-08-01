/**
 * `/admin/site-search` gates against the endpoints it drives.
 *
 * Sibling of `admin-security-page-contract.test.ts`, for the same silent
 * failure: a page that gates on a permission key NO migration seeds hides the
 * section from everyone — including the owner — and still looks like a working
 * screen with an empty area. This repo has shipped that bug twice, both times by
 * inventing a plausible action name.
 *
 * `site_search` is an easy place to repeat it, because its six permissions use
 * three DIFFERENT activity codes (`index`, `settings`, `diagnostics`) and two
 * non-CRUD actions (`reconcile`, `rebuild`). "Tidy" guesses like
 * `site_search.index.update` or `site_search.settings.configure` would each read
 * perfectly and deny everyone.
 *
 * Pure — no database, no network. Runs in `quality` on every PR.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

const PAGE = "src/pages/admin/site-search.astro";
const ROUTES = [
  "src/pages/api/v1/site-search/index/status.ts",
  "src/pages/api/v1/site-search/index/reconcile.ts",
  "src/pages/api/v1/site-search/index/rebuild.ts",
  "src/pages/api/v1/site-search/index/failures.ts",
  "src/pages/api/v1/site-search/settings.ts"
];

type Triple = `${string}.${string}.${string}`;

/** `{ moduleKey: …, activityCode: …, action: … }` → `module.activity.action`. */
function guardTriplesFrom(source: string): Set<Triple> {
  const found = new Set<Triple>();

  // The site-search routes build their guards from the shared constants
  // (`SITE_SEARCH_MODULE_KEY`, `SITE_SEARCH_INDEX_ACTIVITY_CODE`, …) rather than
  // string literals, so match the constant names and resolve them — a
  // literal-only regex would find nothing and pass vacuously.
  const pattern =
    /moduleKey:\s*SITE_SEARCH_MODULE_KEY,\s*activityCode:\s*(SITE_SEARCH_[A-Z_]+_ACTIVITY_CODE),\s*action:\s*"([a-z_]+)"/g;

  const activityByConstant: Record<string, string> = {
    SITE_SEARCH_INDEX_ACTIVITY_CODE: "index",
    SITE_SEARCH_SETTINGS_ACTIVITY_CODE: "settings",
    SITE_SEARCH_DIAGNOSTICS_ACTIVITY_CODE: "diagnostics"
  };

  for (const match of source.matchAll(pattern)) {
    const constantName = match[1];
    const action = match[2];
    if (!constantName || !action) continue;
    const activity = activityByConstant[constantName];
    if (activity) found.add(`site_search.${activity}.${action}` as Triple);
  }

  return found;
}

/** `permissionKey("site_search", "index", "read")` → the same shape. */
function pageTriplesFrom(source: string): Set<Triple> {
  const found = new Set<Triple>();
  const pattern =
    /permissionKey\(\s*"([a-z_]+)",\s*"([a-z_]+)",\s*"([a-z_]+)"\s*\)/g;

  for (const match of source.matchAll(pattern)) {
    found.add(`${match[1]}.${match[2]}.${match[3]}` as Triple);
  }

  return found;
}

describe("/admin/site-search permission gates", () => {
  test("the activity-code constants still resolve to the values assumed here", () => {
    // The guard extractor maps constant NAMES to values. If a constant's value
    // is ever changed, that map silently starts producing wrong triples, so pin
    // it against the descriptor rather than trusting the mapping.
    const declared = listModules().find(
      (module) => module.key === "site_search"
    );

    expect(declared).toBeDefined();
    const activityCodes = new Set(
      declared!.permissions?.map((permission) => permission.activityCode) ?? []
    );
    expect(activityCodes).toEqual(
      new Set(["index", "settings", "diagnostics"])
    );
  });

  test("every key the page gates on is one its endpoints actually enforce", async () => {
    const pageKeys = pageTriplesFrom(await readFile(PAGE, "utf8"));
    expect(pageKeys.size).toBe(6);

    const enforced = new Set<Triple>();
    for (const route of ROUTES) {
      for (const triple of guardTriplesFrom(await readFile(route, "utf8"))) {
        enforced.add(triple);
      }
    }

    // Guards really were parsed — an empty `enforced` would make the subset
    // check below pass vacuously, the shape of gate this repo has been burned by.
    expect(enforced.size).toBeGreaterThan(0);
    expect([...pageKeys].filter((key) => !enforced.has(key))).toEqual([]);
  });

  test("and is declared by the module descriptor, so a migration seeds it", async () => {
    const declared = new Set<Triple>(
      (listModules()
        .find((module) => module.key === "site_search")
        ?.permissions?.map(
          (permission) =>
            `site_search.${permission.activityCode}.${permission.action}`
        ) ?? []) as Triple[]
    );

    expect(declared.size).toBeGreaterThan(0);

    const missing = [...pageTriplesFrom(await readFile(PAGE, "utf8"))].filter(
      (key) => !declared.has(key)
    );

    expect(missing).toEqual([]);
  });

  test("the page never mutates directly — it posts to the guarded endpoints", async () => {
    const page = await readFile(PAGE, "utf8");

    // No SQL write anywhere in the screen: every change goes out over fetch, so
    // the endpoints' audit rows and idempotency records cannot be bypassed by
    // rendering a form that writes for itself.
    expect(page).not.toMatch(
      /\b(INSERT\s+INTO|UPDATE\s+awcms_|DELETE\s+FROM)/i
    );
    expect(page).toContain('"/api/v1/site-search/index/reconcile"');
    expect(page).toContain('"/api/v1/site-search/index/rebuild"');
    expect(page).toContain('"/api/v1/site-search/settings"');
  });

  test("all three mutations carry a fresh Idempotency-Key", async () => {
    const page = await readFile(PAGE, "utf8");

    // Reconcile, rebuild, and the settings PUT all reject a request without the
    // header (`IDEMPOTENCY_REQUIRED`), so a screen that omitted it would render
    // buttons that always fail. A per-click `crypto.randomUUID()` is also what
    // makes a deliberate SECOND run actually run, instead of replaying the
    // first run's stored response.
    expect(page).toContain('"Idempotency-Key": crypto.randomUUID()');
    expect(
      page.match(/"Idempotency-Key": crypto\.randomUUID\(\)/g)
    ).toHaveLength(2);
    // One is shared by reconcile+rebuild via `runIndexOperation`, the other is
    // the settings form — two occurrences covering three mutations.
    expect(page).toContain("async function runIndexOperation(");
  });

  test("the sidebar entry points at this page and is gated on a real permission", () => {
    const nav = listModules()
      .find((module) => module.key === "site_search")
      ?.navigation?.find((entry) => entry.path === "/admin/site-search");

    expect(nav).toBeDefined();
    expect(nav!.requiredPermission).toBe("site_search.index.read");
    // `admin-navigation-registry.test.ts` already binds path→file and
    // labelKey→SIDEBAR_LABELS; this pins the gate specifically.
  });
});
