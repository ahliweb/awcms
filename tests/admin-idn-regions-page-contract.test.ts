/**
 * `/admin/idn-regions` gates against the endpoints it drives — and against the
 * platform scope those endpoints sit behind.
 *
 * Sibling of `admin-site-search-page-contract.test.ts` for the ordinary failure
 * (a page gating on a permission key no migration seeds hides a panel from
 * everyone, including the owner), plus one this screen is the first to have:
 *
 * **Holding the permission is not sufficient here.** ADR-0053 requires the
 * acting tenant to BE the platform tenant, so a screen that rendered its write
 * controls on `ssr.permissions.has(...)` alone would draw buttons that 403 for
 * every tenant that is not the platform — the failure looking like a broken
 * feature rather than a refused one. The page must check both halves.
 *
 * Issue #767 added a SECOND, independently-readable panel — the region
 * browser, gated on `region.read` — so the page's entry `authorize` became an
 * ANY-OF array (the same shape `/admin/domain-events` uses). A viewer holding
 * only `region.read` must still enter the page and see that one panel; a
 * viewer holding only `dataset.read` must still see the dataset console and
 * nothing the region browser needs.
 *
 * Pure — no database, no network. Runs in `quality` on every PR.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

const PAGE = "src/pages/admin/idn-regions.astro";
const ROUTES = [
  "src/pages/api/v1/idn-regions/datasets/index.ts",
  "src/pages/api/v1/idn-regions/datasets/[id]/activate.ts",
  "src/pages/api/v1/idn-regions/datasets/rollback.ts",
  "src/pages/api/v1/idn-regions/regions/index.ts",
  "src/pages/api/v1/idn-regions/regions/[code].ts"
];

type Triple = `${string}.${string}.${string}`;

/**
 * Permission triples the screen gates on, in BOTH spellings.
 *
 * Issue #450 is why the second exists: a screen routed through
 * `loadAdminScreen` states its guards as `AccessRequest` object literals — the
 * same shape the routes use — instead of `permissionKey(...)`.
 */
function pageTriplesFrom(source: string): Set<Triple> {
  const found = new Set<Triple>();

  for (const match of source.matchAll(
    /permissionKey\(\s*"([a-z_]+)",\s*"([a-z_]+)",\s*"([a-z_]+)"\s*\)/g
  )) {
    found.add(`${match[1]}.${match[2]}.${match[3]}` as Triple);
  }

  for (const match of source.matchAll(
    /moduleKey:\s*"([a-z_]+)",\s*activityCode:\s*"([a-z_]+)",\s*action:\s*"([a-z_]+)"/g
  )) {
    found.add(`${match[1]}.${match[2]}.${match[3]}` as Triple);
  }

  return found;
}

function declaredTriples(): Set<Triple> {
  return new Set<Triple>(
    (listModules()
      .find((module) => module.key === "idn_admin_regions")
      ?.permissions?.map(
        (permission) =>
          `idn_admin_regions.${permission.activityCode}.${permission.action}`
      ) ?? []) as Triple[]
  );
}

describe("/admin/idn-regions permission gates", () => {
  test("every key the page gates on is declared by the module descriptor", async () => {
    const pageKeys = pageTriplesFrom(await readFile(PAGE, "utf8"));
    // dataset.read + dataset.configure + dataset.restore + region.read
    // (Issue #767 added the fourth, for the region browser panel).
    expect(pageKeys.size).toBe(4);

    const declared = declaredTriples();
    expect(declared.size).toBe(4);

    expect([...pageKeys].filter((key) => !declared.has(key))).toEqual([]);
  });

  test("and is one the routes actually enforce", async () => {
    const enforced = new Set<string>();

    for (const route of ROUTES) {
      const source = await readFile(route, "utf8");
      // The routes compose their guard from the shared activity-code constants,
      // so match those rather than string literals — a literal-only regex would
      // find nothing here and pass vacuously.
      for (const match of source.matchAll(
        /activityCode:\s*IDN_(REGION|DATASET)_ACTIVITY_CODE,\s*\n?\s*action:\s*"([a-z_]+)"/g
      )) {
        enforced.add(
          `idn_admin_regions.${match[1]!.toLowerCase()}.${match[2]}`
        );
      }
    }

    expect(enforced.size).toBeGreaterThan(0);

    const pageKeys = pageTriplesFrom(await readFile(PAGE, "utf8"));
    expect([...pageKeys].filter((key) => !enforced.has(key))).toEqual([]);
  });

  test("write controls require the platform tenant, not just the permission", async () => {
    const page = await readFile(PAGE, "utf8");
    const permissions =
      listModules().find((module) => module.key === "idn_admin_regions")
        ?.permissions ?? [];
    const scopeOf = (action: string): string | undefined =>
      permissions.find(
        (permission) =>
          permission.activityCode === "dataset" && permission.action === action
      )?.scope;

    // The PROPERTY, proven from the descriptor plus the chokepoint, not from a
    // hand-written `holds… && isPlatformTenant` expression.
    //
    // That expression is what this used to pin, and issue #450 is why it is
    // gone: it was a SECOND copy of ADR-0053's rule living in this template.
    // `can(...)` runs `authorizeInTransaction`, which decides
    // `platform_scope_required` before permissions are even looked up — so the
    // two write controls are gated by the same code the endpoint uses, and the
    // duplicate that could drift from it no longer exists.
    expect(scopeOf("configure")).toBe("platform");
    expect(scopeOf("restore")).toBe("platform");
    expect(page).toMatch(/loadAdminScreen\(/);
    expect(page).not.toMatch(/ssr\.permissions\.has\(/);

    // And the read panel must NOT be gated that way — every tenant is entitled
    // to see which dataset version it is being served. This is the asymmetry
    // that makes the screen worth having on a non-platform tenant at all, so it
    // is asserted from the descriptor rather than inferred from the page.
    // `scope` is optional and absent MEANS tenant, so the claim is stated the
    // way the chokepoint reads it: anything that is not `platform` is tenant.
    expect(scopeOf("read")).not.toBe("platform");
    // Issue #767 — the entry gate is now an ANY-OF array (dataset.read OR
    // region.read), not a single request, so both tenant reads are asserted
    // as array entries rather than as the page's sole `authorize:` object.
    expect(page).toMatch(/authorize:\s*\[/);
    expect(page).toMatch(
      /\{\s*moduleKey:\s*"idn_admin_regions",\s*activityCode:\s*"dataset",\s*action:\s*"read"\s*\}/
    );
    expect(page).toMatch(
      /\{\s*moduleKey:\s*"idn_admin_regions",\s*activityCode:\s*"region",\s*action:\s*"read"\s*\}/
    );

    // `region.read` is tenant-scoped too — the region browser must not
    // acquire a platform check by accident.
    const regionReadScope = (
      listModules().find((module) => module.key === "idn_admin_regions")
        ?.permissions ?? []
    ).find(
      (permission) =>
        permission.activityCode === "region" && permission.action === "read"
    )?.scope;
    expect(regionReadScope).not.toBe("platform");
  });

  test("the page never mutates directly — it posts to the guarded endpoints", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).not.toMatch(
      /\b(INSERT\s+INTO|UPDATE\s+awcms_|DELETE\s+FROM)/i
    );
    expect(page).toContain("/api/v1/idn-regions/datasets/");
    expect(page).toContain('"/api/v1/idn-regions/datasets/rollback"');
  });

  test("both mutations carry a fresh Idempotency-Key", async () => {
    const page = await readFile(PAGE, "utf8");

    // Activation and rollback both reject a request without the header. One
    // occurrence covers both because they share `runLifecycleAction`; a
    // per-click `crypto.randomUUID()` is what makes a deliberate second action
    // run instead of replaying the first one's stored response.
    expect(page).toContain('"Idempotency-Key": crypto.randomUUID()');
    expect(page).toContain("async function runLifecycleAction(");
  });

  test("the sidebar entry points at this page and is gated on a real permission", () => {
    const nav = listModules()
      .find((module) => module.key === "idn_admin_regions")
      ?.navigation?.find((entry) => entry.path === "/admin/idn-regions");

    expect(nav).toBeDefined();
    // Deliberately the READ permission, not the platform one: the screen itself
    // is not cross-tenant, only two of its buttons are, and gating the link on
    // `dataset.configure` would hide provenance every tenant may read about the
    // data it is served.
    expect(nav!.requiredPermission).toBe("idn_admin_regions.dataset.read");
    expect(declaredTriples().has(nav!.requiredPermission as Triple)).toBe(true);
  });
});

describe("/admin/idn-regions region browser (Issue #767)", () => {
  test("reads through the module's own lookup functions, never raw SQL", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).toContain("queryRegions(");
    expect(page).toContain("getRegionByCode(");
    expect(page).toContain(
      'from "../../modules/idn-admin-regions/application/region-lookup"'
    );
  });

  test("ships zero client JavaScript — filtering and paging are GET links/forms", async () => {
    const page = await readFile(PAGE, "utf8");
    // Case-insensitive, and tolerant of attributes on BOTH tags. This guard's
    // whole job is to notice a second script block, so a pattern that only
    // matched a bare lower-case `<script>` would sail past `<SCRIPT>` or
    // `<script type="module">` and report 1 while there were 2 — a gate with a
    // blind spot for the thing it exists to catch (CodeQL `js/bad-tag-filter`,
    // alert #154). The closing form is widened in the same edit rather than one
    // variant per scan, since the rule reports these one at a time.
    const scriptBlocks = [
      ...page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script(?:[\s/][^>]*)?>/gi)
    ];

    expect(scriptBlocks.length).toBe(1);
    // The one <script> block belongs to the dataset console's activate/
    // rollback buttons (Idempotency-Key mutations); the region browser must
    // add nothing to it — no call to the lookup API, no reference to its
    // query params.
    expect(scriptBlocks[0]![1]).not.toContain("/api/v1/idn-regions/regions");
    expect(scriptBlocks[0]![1]).not.toContain("regionQueryLink");
    expect(scriptBlocks[0]![1]).not.toContain("queryRegions");

    expect(page).toMatch(/<form[^>]*method="get"[^>]*>/);
  });

  test("keyset-pages on nextCursor, not a bare limit", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).toContain("regionPage.nextCursor");
    expect(page).toContain("regionQueryLink({ after: regionPage.nextCursor })");
  });

  test("distinguishes no_active_dataset from an empty result set", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).toContain('regionReason === "no_active_dataset"');
    expect(page).toContain('regionReason === "dataset_not_found"');
    expect(page).toContain("idn-regions-browser-no-active-dataset");
    // A distinct id from the "no rows matched" empty state inside the table.
    expect(page).not.toMatch(
      /id="idn-regions-browser-no-active-dataset"[\s\S]{0,40}No regions match/
    );
  });

  test("drill-down uses level + parentCode, and honours dataset=<code>", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).toContain("parentCode: region.code");
    expect(page).toContain("level: String(region.level + 1)");
    expect(page).toContain("regionDatasetParam");
  });
});
