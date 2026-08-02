/**
 * `GET /api/v1/blog/posts` query contract.
 *
 * Every refusal below exists because the ACCEPTING version of it fails
 * silently — the caller gets 200 and wrong data, and neither side can tell:
 *
 *   - a cursor over `updated_at` skips or repeats rows as posts are edited;
 *   - a malformed cursor read as "no cursor" restarts the traversal at page
 *     one, so a build re-reads what it already has and never terminates;
 *   - `view=full` over the mutable ordering hands back a first page that
 *     cannot be continued, because `cursor` is refused there;
 *   - an unknown `view` falling back to summaries returns rows without
 *     `contentJson` to a caller that asked for full posts. That exact defect
 *     — the contract promising `BlogPost` while the endpoint returned a
 *     summary — built an entire static site with every article body empty and
 *     nothing failing anywhere.
 *
 * These are pure over `URLSearchParams`: no database, no session, so they run
 * in the `quality` job rather than only where a Postgres is available.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { encodeKeysetCursor } from "../src/modules/_shared/keyset-pagination";
import {
  MAX_LOCALE_FILTER_LENGTH,
  parseBlogPostListQuery
} from "../src/modules/blog-content/domain/blog-post-list-query";

function parse(qs: string) {
  return parseBlogPostListQuery(new URLSearchParams(qs));
}

const CURSOR = encodeKeysetCursor(
  "2026-07-17T10:00:00.029058+00:00",
  "11111111-2222-4333-8444-555555555555"
);

describe("defaults", () => {
  test("an empty query is the admin table's traversal", () => {
    const result = parse("");
    expect(result.valid).toBe(true);
    if (!result.valid) return;

    expect(result.value.view).toBe("summary");
    expect(result.value.stableOrder).toBe(false);
    expect(result.value.cursor).toBeNull();
    expect(result.value.status).toBeUndefined();
    expect(result.value.limit).toBeUndefined();
  });

  test("order=created_at selects the cursor-capable traversal", () => {
    const result = parse("order=created_at");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.stableOrder).toBe(true);
  });
});

describe("refusals", () => {
  test.each([
    ["status=published", true],
    ["status=nonsense", false],
    ["limit=50", true],
    ["limit=0", false],
    ["limit=-1", false],
    ["limit=abc", false],
    ["order=created_at", true],
    ["order=title", false],
    ["view=summary", true],
    ["view=full&order=created_at", true],
    ["view=FULL&order=created_at", false],
    ["view=full", false]
  ])("%s -> valid=%p", (qs, valid) => {
    expect(parse(qs).valid).toBe(valid);
  });

  test("cursor over the mutable ordering is refused, not honoured", () => {
    const result = parse(`cursor=${CURSOR}`);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.message).toContain("order=created_at");
  });

  test("a malformed cursor is a 400, never treated as no cursor", () => {
    const result = parse("order=created_at&cursor=not-a-cursor");
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.message).toContain("malformed");
  });

  test("view=full names the ordering it needs instead of substituting one", () => {
    const result = parse("view=full");
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.message).toContain("order=created_at");
  });
});

describe("the build feed's own request", () => {
  test("parses whole, cursor included", () => {
    const result = parse(
      `status=published&order=created_at&view=full&limit=50&cursor=${CURSOR}`
    );

    expect(result.valid).toBe(true);
    if (!result.valid) return;

    expect(result.value).toMatchObject({
      status: "published",
      limit: 50,
      stableOrder: true,
      view: "full"
    });
    expect(result.value.cursor).toEqual({
      createdAt: "2026-07-17T10:00:00.029058+00:00",
      id: "11111111-2222-4333-8444-555555555555"
    });
  });
});

/**
 * `?locale=` closes awcms-astro ADR-0021 §2. Before it, a build for a
 * single-language site had to pull EVERY locale and discard most of it,
 * because there was no way to ask for one.
 *
 * The refusals here are the same class as the rest of this file: a caller that
 * meant to filter and silently got the unfiltered feed builds a site with every
 * translation of every article in it, and nothing anywhere fails.
 */
describe("locale", () => {
  test("is absent by default — every locale, which is right for the admin table", () => {
    const result = parse("");
    expect(result.valid).toBe(true);
    if (!result.valid) return;

    expect(result.value.locale).toBeUndefined();
  });

  test("is carried through, trimmed", () => {
    const result = parse("locale=%20en%20");
    expect(result.valid).toBe(true);
    if (!result.valid) return;

    expect(result.value.locale).toBe("en");
  });

  test("an empty value is REFUSED, not read as absent", () => {
    // `?locale=` reads as "I asked for a locale". Serving the unfiltered feed
    // for it is the silent-wrong-data shape this whole parser exists to avoid.
    expect(parse("locale=").valid).toBe(false);
    expect(parse("locale=%20%20").valid).toBe(false);
  });

  test("an absurdly long value is refused before it reaches the database", () => {
    expect(parse(`locale=${"x".repeat(MAX_LOCALE_FILTER_LENGTH)}`).valid).toBe(
      true
    );
    expect(
      parse(`locale=${"x".repeat(MAX_LOCALE_FILTER_LENGTH + 1)}`).valid
    ).toBe(false);
  });

  test("shape is NOT validated, deliberately", () => {
    // `awcms_blog_posts.locale` is plain `text` and the write path accepts any
    // non-empty string. A read filter stricter than the write path would make a
    // stored locale unreachable — a row that exists, that the admin table
    // shows, and that no query can select.
    for (const value of ["id", "en-GB", "zh-Hans-CN", "klingon", "xx_YY"]) {
      const result = parse(`locale=${encodeURIComponent(value)}`);
      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(result.value.locale).toBe(value);
    }
  });

  test("combines with the build feed's own requirements", () => {
    const result = parse("locale=en&view=full&order=created_at");
    expect(result.valid).toBe(true);
    if (!result.valid) return;

    expect(result.value.locale).toBe("en");
    expect(result.value.view).toBe("full");
    expect(result.value.stableOrder).toBe(true);
  });
});

/**
 * Parsing a parameter and USING it are different things, and the gap between
 * them is silent: the parser accepts `?locale=en`, the route ignores it, the
 * response is 200, and the caller gets every locale it meant to exclude.
 *
 * The route branches three ways on `view`/`order`, so a filter wired into two
 * of the three would stay invisible until someone changed a query string. This
 * asserts all three call sites forward it. That the filter then really filters
 * is proven against a real database in
 * `tests/integration/blog-post-locale-filter.integration.test.ts`.
 */
describe("the route forwards locale to every list function", () => {
  test("all three call sites pass it", async () => {
    const route = await readFile(
      "src/pages/api/v1/blog/posts/index.ts",
      "utf8"
    );

    expect(route).toContain("const { status, locale, limit");

    for (const fn of [
      "listBlogPostsFullPage",
      "listBlogPostsPage",
      "listBlogPosts"
    ]) {
      const call = route.slice(route.indexOf(`await ${fn}(tx, tenantId, {`));
      const args = call.slice(0, call.indexOf("});"));

      expect(args).toContain("status");
      expect(args).toContain("locale");
    }
  });
});
