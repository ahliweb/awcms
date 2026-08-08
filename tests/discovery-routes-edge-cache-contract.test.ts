/**
 * ADR-0061 §B — the contract between the root discovery routes and the edge
 * cache, asserted over source text for the same reason its `/news/**`
 * counterpart did (that file went out with the routes ADR-0071 removed): both orderings
 * compile, both serve identical bytes, and the difference appears only in a
 * response header on a request that 404s.
 *
 * The six routes are thin delegators, so the rule lives in ONE place —
 * `serveDiscovery` publishes, after `build(ctx)` returns a payload. That makes
 * two things checkable, and both are needed:
 *
 * 1. `serveDiscovery` publishes only on the payload path. `build` returns `null`
 *    for "sitemaps disabled", "feeds disabled" and "page out of range", each of
 *    which collapses into the same generic 404 as an unresolved host — and 404
 *    is a cacheable status.
 * 2. All six callers actually forward `locals`. A route that forgets is not
 *    broken, just never cached, which is precisely the kind of regression that
 *    survives review: nothing fails, a surface silently stops being fast.
 */
import { describe, expect, test } from "bun:test";

const PIPELINE = "src/modules/seo-distribution/presentation/discovery-route.ts";

/** The six root discovery routes ADR-0038 serves, all host-resolved. */
const DISCOVERY_ROUTES = [
  "src/pages/robots.txt.ts",
  "src/pages/sitemap.xml.ts",
  "src/pages/sitemap-[page].xml.ts",
  "src/pages/feed.xml.ts",
  "src/pages/atom.xml.ts",
  "src/pages/feed.json.ts"
] as const;

describe("root discovery routes publish their tenant", () => {
  test("serveDiscovery publishes only when a payload was built", async () => {
    const source = await Bun.file(PIPELINE).text();

    const buildIndex = source.indexOf("const built = await build(ctx)");
    const guardIndex = source.indexOf("if (built)");
    const publishIndex = source.indexOf("publishEdgeCacheTenant(locals,");

    expect(buildIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(buildIndex);
    expect(publishIndex).toBeGreaterThan(guardIndex);
  });

  test("serveDiscovery publishes exactly once", async () => {
    // A second, unguarded call anywhere in the pipeline would restore the leak
    // while leaving the correct guarded call in place to read as the rule.
    const source = await Bun.file(PIPELINE).text();

    expect(source.split("publishEdgeCacheTenant(").length - 1).toBe(1);
  });

  test.each(DISCOVERY_ROUTES.map((file) => [file] as const))(
    "%s forwards locals to serveDiscovery",
    async (file) => {
      const source = await Bun.file(file).text();

      // Both halves: destructured from the Astro context AND passed on. A route
      // that destructures without passing would satisfy a laxer check while
      // caching nothing.
      expect(source).toMatch(/APIRoute = \(\{[^}]*\blocals\b[^}]*\}\)/);
      expect(source).toMatch(/,\s*\n\s*locals\s*\n\s*\)/);
    }
  );

  test("every serveDiscovery caller is covered by this test", async () => {
    // Guards against a seventh discovery route inheriting none of the above.
    const found: string[] = [];

    for (const entry of await Array.fromAsync(
      new Bun.Glob("**/*.ts").scan({ cwd: "src/pages" })
    )) {
      const path = `src/pages/${entry}`;
      const source = await Bun.file(path).text();

      if (source.includes("serveDiscovery(")) {
        found.push(path);
      }
    }

    expect(found.sort()).toEqual([...DISCOVERY_ROUTES].sort());
  });
});
