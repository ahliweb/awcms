/**
 * The retirement mapping `/news/**` → `/blog/{tenantCode}/**` (ADR-0071 §4).
 *
 * ## Why this file exists
 *
 * The four `/news/**` routes were live and ON by default, and their URLs are in
 * sitemaps and feeds this repo published. Removing them without a successor
 * would have broken every one of those links; this mapping is the successor,
 * and it is a 301 — permanent, cached by browsers and intermediaries, and not
 * undone by a later config change. A mapping that is wrong is therefore wrong
 * forever, which is the whole reason it is asserted here rather than reviewed.
 *
 * The path mapping is pure, so it is tested directly. The two conditions that
 * govern whether it is USED at all — a resolvable tenant with a verified
 * primary host, and `legacyTenantRouteEnabled` — live in the resolution service
 * and need a database, so they are stated in the ADR and exercised by the
 * integration suite rather than mocked into a lie here.
 *
 * ## The direction is the thing to watch
 *
 * This mapping replaced its own inverse. Through ADR-0039/0059 the file that
 * stood here pointed `/blog/{tenantCode}` AT `/news`, because `/news` was
 * meant to be canonical. Getting the direction wrong does not throw, does not
 * fail a typecheck, and produces a redirect loop only for tenants that happen
 * to have both shapes live. So the first test below is about direction, and it
 * names what it is guarding against.
 */
import { describe, expect, test } from "bun:test";

import {
  buildLegacyBlogPath,
  parseRetiredNewsPath,
  RETIRED_NEWS_BASE_PATH
} from "../src/modules/seo-distribution/domain/retired-news-redirect";

describe("direction (ADR-0071 §4 inverted ADR-0039's mapping)", () => {
  test("the retired family is the SOURCE, and /blog is the destination", () => {
    const rest = parseRetiredNewsPath("/news/hello");
    expect(rest).toBe("/hello");
    expect(buildLegacyBlogPath("acme", rest!)).toBe("/blog/acme/hello");
  });

  test("a /blog path is NOT a source — the old direction is gone", () => {
    expect(parseRetiredNewsPath("/blog/acme")).toBeNull();
    expect(parseRetiredNewsPath("/blog/acme/hello")).toBeNull();
  });
});

describe("parseRetiredNewsPath", () => {
  test("the family root maps to an empty remainder", () => {
    expect(parseRetiredNewsPath(RETIRED_NEWS_BASE_PATH)).toBe("");
  });

  test.each([
    ["/news/hello-world", "/hello-world"],
    ["/news/category/updates", "/category/updates"],
    ["/news/tag/release", "/tag/release"],
    ["/news/a/b/c", "/a/b/c"]
  ])("%s -> remainder %s", (pathname, expected) => {
    expect(parseRetiredNewsPath(pathname)).toBe(expected);
  });

  /**
   * The segment boundary, and it is not hypothetical: this repo has shipped a
   * `newsletter` capability name since ADR-0035, so a bare `startsWith("/news")`
   * would 301 `/newsletter` into `/blog/{tenantCode}letter`.
   */
  test.each(["/newsletter", "/newsletters/weekly", "/newsroom"])(
    "%s is NOT in the retired family — prefix without a segment boundary",
    (pathname) => {
      expect(parseRetiredNewsPath(pathname)).toBeNull();
    }
  );

  test.each(["/", "/blog", "/search", "/admin/news", "", "/ne"])(
    "%s is not a retired path",
    (pathname) => {
      expect(parseRetiredNewsPath(pathname)).toBeNull();
    }
  );

  test("a trailing slash is carried, not swallowed", () => {
    expect(parseRetiredNewsPath("/news/")).toBe("/");
  });

  // One test rather than `test.each`: an `undefined` row makes bun read the
  // callback's parameter as its done-callback and the case hangs for 5s before
  // failing on a timeout that has nothing to do with the assertion.
  test("non-string input returns null instead of throwing", () => {
    for (const value of [null, undefined, 42, {}, []]) {
      expect(parseRetiredNewsPath(value as unknown as string)).toBeNull();
    }
  });
});

describe("buildLegacyBlogPath", () => {
  test("the family root maps to the tenant's blog root", () => {
    expect(buildLegacyBlogPath("acme", "")).toBe("/blog/acme");
  });

  test("the remainder is appended verbatim", () => {
    expect(buildLegacyBlogPath("acme", "/category/updates")).toBe(
      "/blog/acme/category/updates"
    );
  });

  /**
   * Round-trip: every shape the removed family could serve lands on a shape the
   * surviving family serves. `/news/category/{slug}` and `/news/tag/{slug}` had
   * their counterparts under `/blog/{tenantCode}` all along — that is why this
   * retirement is a redirect rather than a 410.
   */
  test.each([
    ["/news", "/blog/acme"],
    ["/news/hello", "/blog/acme/hello"],
    ["/news/category/updates", "/blog/acme/category/updates"],
    ["/news/tag/release", "/blog/acme/tag/release"]
  ])("%s round-trips to %s", (from, to) => {
    const rest = parseRetiredNewsPath(from);
    expect(rest).not.toBeNull();
    expect(buildLegacyBlogPath("acme", rest!)).toBe(to);
  });
});
