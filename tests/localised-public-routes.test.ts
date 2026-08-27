/**
 * The coverage whose absence shipped a 404 over the entire public blog.
 *
 * v10.0.0 moved the locale into the PATH (ADR-0098) and served the prefixed URL
 * by rewriting it back to the bare route. Every bare blog URL `307`d to its
 * prefixed spelling, and every prefixed spelling answered 404, because a
 * rewrite whose TARGET is a parameterised route resolves the route and computes
 * its params and then never executes it. CI was green through all of it: not
 * one test, at any level, ever fetched a locale-prefixed public URL.
 *
 * So the gate here is not "does the rewrite work" — there is no rewrite any
 * more. It is the structural property the rewrite was standing in for:
 *
 *   **every public path that REQUIRES a locale prefix has a route that serves
 *   the prefixed spelling, and that route is the bare route's own handler.**
 *
 * Derived from the filesystem rather than from a hand-written list, so a new
 * prefixed blog surface cannot be added without its prefixed route: the new
 * bare file appears here on its own, and the assertion fails until its mirror
 * exists.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { requiresPublicLocalePrefix } from "../src/lib/i18n/public-locale-path";
import { localisedPublicRoute } from "../src/lib/i18n/localised-route";

const REPO_ROOT = path.resolve(import.meta.dir, "..");
const BARE_DIR = path.join(REPO_ROOT, "src/pages/blog/[tenantCode]");
const PREFIXED_DIR = path.join(
  REPO_ROOT,
  "src/pages/[locale]/blog/[tenantCode]"
);

/** `category/[slug].ts` -> `/blog/acme/category/a-slug`; `index.ts` -> `/blog/acme`. */
function samplePathFor(relativeFile: string): string {
  const withoutExtension = relativeFile.replace(/\.ts$/, "");
  const segments = withoutExtension
    .split("/")
    .filter((segment) => segment !== "index")
    .map((segment) =>
      segment === "[slug]" ? "a-slug" : segment.replace("[tenantCode]", "acme")
    );

  return ["", "blog", "acme", ...segments].join("/").replace("//", "/");
}

/** Every `.ts` route file under a directory, relative to it, nested included. */
function routeFilesIn(dir: string): string[] {
  const walk = (current: string, prefix: string): string[] =>
    readdirSync(current, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(path.join(current, entry.name), `${prefix}${entry.name}/`)
        : entry.name.endsWith(".ts")
          ? [`${prefix}${entry.name}`]
          : []
    );

  return walk(dir, "").sort();
}

const bareRouteFiles = routeFilesIn(BARE_DIR);

describe("locale-prefixed public routes", () => {
  test("the fixture itself is non-vacuous", () => {
    // Guarding the guard: a `readdirSync` that silently returned nothing would
    // make every assertion below pass by having nothing to check.
    expect(bareRouteFiles.length).toBeGreaterThan(4);
    expect(bareRouteFiles).toContain("index.ts");
  });

  test("every bare blog surface that requires a prefix has a prefixed route", () => {
    const needingPrefix = bareRouteFiles.filter((file) =>
      requiresPublicLocalePrefix(samplePathFor(file))
    );

    // The four reader-facing surfaces: index, post, category, tag, page.
    expect(needingPrefix.length).toBeGreaterThan(0);

    const prefixedRouteFiles = routeFilesIn(PREFIXED_DIR);

    for (const file of needingPrefix) {
      expect(prefixedRouteFiles).toContain(file);
    }
  });

  test("a surface that must NOT be prefixed has no prefixed route", () => {
    // The converse, and it is not decoration: `feed.xml`, `sitemap-blog.xml`
    // and `search` are excluded from prefixing on purpose (a crawler will not
    // follow a redirect to find an inventory). A prefixed twin would publish a
    // second address for the same document.
    const neverPrefixed = bareRouteFiles.filter(
      (file) => !requiresPublicLocalePrefix(samplePathFor(file))
    );

    expect(neverPrefixed.length).toBeGreaterThan(0);

    const prefixedRouteFiles = routeFilesIn(PREFIXED_DIR);

    for (const file of neverPrefixed) {
      expect(prefixedRouteFiles).not.toContain(file);
    }
  });

  test("each prefixed route re-exports the bare handler, never a copy of it", () => {
    // The whole reason a `[locale]` tree is acceptable at all: it duplicates
    // route REGISTRATION, not logic. A prefixed file that grew its own handler
    // would drift from the bare one silently.
    for (const file of routeFilesIn(PREFIXED_DIR)) {
      const source = readFileSync(path.join(PREFIXED_DIR, file), "utf8");
      const withoutComments = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

      expect(withoutComments).toContain("localisedPublicRoute(bareGet)");
      expect(withoutComments).toMatch(
        /import \{ GET as bareGet \} from "[^"]*blog\/\[tenantCode\]/
      );
    }
  });

  test("the middleware no longer rewrites — it serves the prefixed URL", () => {
    // Source assertion, comments stripped FIRST: the explanation of the defect
    // that this line used to be is written directly above it, and a naive
    // `includes` would match the prose and pass while the code regressed.
    const middleware = readFileSync(
      path.join(REPO_ROOT, "src/middleware.ts"),
      "utf8"
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    expect(middleware).not.toContain("next(barePathname");
    expect(middleware).toContain("const response = await next();");
  });
});

describe("localisedPublicRoute", () => {
  const ok = new Response("served", { status: 200 });
  const handler = (() => ok) as Parameters<typeof localisedPublicRoute>[0];

  const contextWith = (locale: unknown) =>
    ({ params: { locale } }) as unknown as Parameters<
      ReturnType<typeof localisedPublicRoute>
    >[0];

  test("a supported locale reaches the wrapped handler", async () => {
    for (const locale of ["en", "id"]) {
      const response = await localisedPublicRoute(handler)(contextWith(locale));
      expect((response as Response).status).toBe(200);
    }
  });

  test("an unsupported segment 404s instead of serving the tenant", async () => {
    // `[locale]` is a dynamic segment, so `/anything/blog/acme` matches the
    // route pattern. Without this the tenant's content would be served under an
    // unbounded number of addresses, each its own cache key.
    for (const bogus of ["fr", "blog", "admin", "", "EN", undefined]) {
      const response = await localisedPublicRoute(handler)(contextWith(bogus));
      expect((response as Response).status).toBe(404);
    }
  });
});
