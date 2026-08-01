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
import { describe, expect, test } from "bun:test";

import { encodeKeysetCursor } from "../src/modules/_shared/keyset-pagination";
import { parseBlogPostListQuery } from "../src/modules/blog-content/domain/blog-post-list-query";

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
