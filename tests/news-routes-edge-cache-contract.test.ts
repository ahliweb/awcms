/**
 * ADR-0061 §3 — the contract between the `/news/**` route files and the edge
 * cache, asserted over their source text.
 *
 * ## Why source text, and why a test rather than a reviewer
 *
 * The rule these routes must follow is not expressible in a type and not
 * observable from a passing request: **publish the tenant only on the path that
 * actually serves the resource.** Both orderings compile, both serve correct
 * HTML, and both pass every functional test. The difference shows up only in a
 * response header, and only for a request that 404s.
 *
 * `/news/{slug}`, `/news/category/{slug}` and `/news/tag/{slug}` collapse
 * "unknown host", "module disabled", "family switched off" and "no such
 * post/term" into ONE generic 404, and `padUnresolvedHostRouteLatency` keeps
 * that true in the time domain. 404 is a cacheable status. So publishing the
 * tenant before the missing-resource branch annotates the missing-resource 404
 * with `Surrogate-Control` while the unknown-host 404 gets
 * `Cache-Control: private, no-store` — answering "does this hostname map to a
 * live tenant?" from one request, with no timing analysis, through the exact
 * channel the padding was built to close.
 *
 * Moving one line up in any of the three files reopens it silently. This test is
 * what makes that move loud, and it was mutation-proven: hoisting the publish
 * above each guard in turn makes it red.
 */
import { describe, expect, test } from "bun:test";

/** The host-resolved content routes, and whether each has a missing-resource branch. */
const NEWS_ROUTES = [
  {
    file: "src/pages/news/index.ts",
    // The index serves a 200 whenever the tenant is gated — its only other
    // outcome is the generic 404, already distinguishable by status. So there is
    // no branch to publish after, and none is required.
    missingResourceGuard: null
  },
  {
    file: "src/pages/news/[slug].ts",
    missingResourceGuard: "if (!post)"
  },
  {
    file: "src/pages/news/category/[slug].ts",
    missingResourceGuard: "if (!term)"
  },
  {
    file: "src/pages/news/tag/[slug].ts",
    missingResourceGuard: "if (!term)"
  }
] as const;

const PUBLISH_CALL = "publishEdgeCacheTenant(locals,";

async function readRoute(file: string): Promise<string> {
  return Bun.file(file).text();
}

describe("the /news/** family publishes its tenant to the edge cache", () => {
  test.each(NEWS_ROUTES.map((route) => [route.file] as const))(
    "%s publishes the resolved tenant",
    async (file) => {
      const source = await readRoute(file);

      // `locals` specifically: a route that publishes something it derived some
      // other way is not the contract, and would not be reached by middleware.
      expect(source).toContain(PUBLISH_CALL);
      expect(source).toContain(
        "publishEdgeCacheTenant(locals, tenant.tenantId)"
      );
    }
  );

  test.each(
    NEWS_ROUTES.filter((route) => route.missingResourceGuard !== null).map(
      (route) => [route.file, route.missingResourceGuard!] as const
    )
  )("%s publishes AFTER its %s branch, not before", async (file, guard) => {
    const source = await readRoute(file);

    const guardIndex = source.indexOf(guard);
    const publishIndex = source.indexOf(PUBLISH_CALL);

    // Both anchors must exist, or the assertion below would pass vacuously on
    // -1 < -1 style comparisons after a rename.
    expect(guardIndex).toBeGreaterThan(-1);
    expect(publishIndex).toBeGreaterThan(-1);

    expect(publishIndex).toBeGreaterThan(guardIndex);
  });

  test("no /news/** route publishes more than once", async () => {
    // A second publish is how the rule above gets quietly undone: leave the
    // correct late call in place, add an early one "for the index case", and the
    // late one becomes decoration.
    for (const route of NEWS_ROUTES) {
      const source = await readRoute(route.file);
      const occurrences = source.split(PUBLISH_CALL).length - 1;

      expect(occurrences).toBe(1);
    }
  });

  test("every /news/** route file is covered by this test", async () => {
    // The list above is hand-maintained, so a fifth route added tomorrow would
    // otherwise inherit zero of this file's guarantees. Compare against the
    // directory instead of trusting the constant.
    const found = new Set<string>();

    async function walk(dir: string): Promise<void> {
      for (const entry of await Array.fromAsync(
        new Bun.Glob("**/*.ts").scan({ cwd: dir })
      )) {
        found.add(`${dir}/${entry}`);
      }
    }

    await walk("src/pages/news");

    expect([...found].sort()).toEqual(
      NEWS_ROUTES.map((route) => route.file).sort()
    );
  });
});
