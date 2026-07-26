/**
 * `src/lib` is technical infrastructure. It must not carry a domain name.
 *
 * ## What went wrong
 *
 * `src/lib` had quietly become a SECOND module system that no gate watched.
 * Four namespaces — `seo`, `theming`, `comments`, `search` — carried the name of
 * an existing module and held code owned by that module, and
 * `seo_distribution`'s own application layer reached UP into `src/lib/seo`
 * along a path `modules:dag:check` cannot see, because that validator reads the
 * DECLARED graph and never an import statement.
 *
 * The cause was structural, not sloppiness: the module contract had nowhere to
 * put presentation/delivery code, so `src/lib/<module-name>/` was the only home
 * available. The fix names the home — `src/modules/<m>/presentation/` — and
 * this gate keeps the old one closed.
 *
 * ## Aliases are load-bearing
 *
 * Two of the four real cases (`seo` -> `seo_distribution`, `search` ->
 * `site_search`) do not match their module key as a string. A check that only
 * compared names verbatim would have waved both through, which is how
 * awcms-micro found the same thing when it built its version (ADR-0038 there).
 *
 * ## Injecting a violation, not just asserting green
 *
 * Every test below calls the real `findLibNamespaceViolations` with a planted
 * namespace. A gate that has only ever been observed passing has not been
 * observed at all.
 *
 * Pure — no filesystem, no database.
 */
import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import { findLibNamespaceViolations } from "../scripts/validate-module-graph";

const KEYS = listModules().map((module) => module.key);

describe("a src/lib namespace may not share a module's name", () => {
  test("an exact match is rejected", () => {
    const violations = findLibNamespaceViolations(["theming"], KEYS);

    expect(violations).toEqual([
      { namespace: "theming", moduleKey: "theming", viaAlias: false }
    ]);
  });

  test("a kebab-case namespace matches its snake_case key", () => {
    expect(
      findLibNamespaceViolations(["site-search"], KEYS)[0]?.moduleKey
    ).toBe("site_search");
  });

  test.each([
    ["seo", "seo_distribution"],
    ["search", "site_search"],
    ["media", "media_library"],
    ["blog", "blog_content"],
    ["analytics", "visitor_analytics"]
  ])("the domain alias `%s` is caught as %s", (namespace, moduleKey) => {
    // Without aliases, `seo` and `search` — two of the four namespaces this
    // change actually removed — would both have passed.
    const violations = findLibNamespaceViolations([namespace], KEYS);

    expect(violations).toEqual([{ namespace, moduleKey, viaAlias: true }]);
  });

  test("a genuinely technical namespace is fine", () => {
    expect(
      findLibNamespaceViolations(
        ["database", "auth", "security", "redis", "jobs", "semver"],
        KEYS
      )
    ).toEqual([]);
  });
});

describe("the `logging` exception is an exception, not a blind spot", () => {
  test("`logging` IS detected — it is silenced only by the exception table", () => {
    // The distinction that matters. If detection simply did not see `logging`,
    // the exception would be decoration and a real future collision could hide
    // behind the same gap. Passing a key list WITHOUT `logging` proves the
    // matcher would have fired.
    const withoutTheModule = findLibNamespaceViolations(
      ["logging"],
      KEYS.filter((key) => key !== "logging")
    );
    const withTheModule = findLibNamespaceViolations(["logging"], KEYS);

    expect(withoutTheModule).toEqual([]);
    // Excused by the table, despite `logging` being a real module key.
    expect(KEYS).toContain("logging");
    expect(withTheModule).toEqual([]);
  });
});

describe("the real src/lib tree", () => {
  test("no namespace on disk collides with a module", async () => {
    const namespaces: string[] = [];

    for await (const entry of new Bun.Glob("src/lib/*/").scan({
      cwd: process.cwd(),
      onlyFiles: false,
      dot: true
    })) {
      namespaces.push(entry.replace(/^src\/lib\//, "").replace(/\/$/, ""));
    }

    // Guard the fixture: an empty scan would pass vacuously.
    expect(namespaces.length).toBeGreaterThan(5);
    expect(findLibNamespaceViolations(namespaces, KEYS)).toEqual([]);
  });

  test("the four namespaces this change removed are really gone", async () => {
    for (const gone of ["seo", "theming", "comments", "search"]) {
      expect(await Bun.file(`src/lib/${gone}`).exists()).toBe(false);
    }
  });

  test("their code landed under the owning module's presentation layer", async () => {
    for (const file of [
      "src/modules/seo-distribution/presentation/discovery-route.ts",
      "src/modules/seo-distribution/presentation/redirect-middleware.ts",
      "src/modules/seo-distribution/presentation/discovery-providers.ts",
      "src/modules/theming/presentation/theme-media.ts",
      "src/modules/theming/presentation/theme-preview.ts",
      "src/modules/theming/presentation/theme-public-css.ts",
      "src/modules/comments/presentation/commentable-resources.ts",
      "src/modules/site-search/presentation/search-sources.ts"
    ]) {
      expect(await Bun.file(file).exists()).toBe(true);
    }
  });
});
