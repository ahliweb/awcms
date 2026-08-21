/**
 * `GET /api/v1/blog/terms` query contract (Issue #597 item 1).
 *
 * The endpoint gained a traversal because the list it had could not be walked
 * to the end, and did not say so. Every refusal pinned below exists because
 * the ACCEPTING version of it returns `200` with a vocabulary that is missing
 * entries:
 *
 *   - a cursor over the `name` ordering skips or repeats terms as they are
 *     renamed, and neither side can tell;
 *   - a malformed cursor read as "no cursor" restarts the traversal at page
 *     one, so a build re-reads what it already has and never terminates;
 *   - an unknown `order` silently falling back to the alphabetical list hands
 *     a caller that asked for the whole vocabulary the first page of it.
 *
 * The last one is the reason this endpoint was worth changing at all. A tag
 * vocabulary grown over the 23,906-article archive of Issue #599 runs to
 * thousands of entries; the old answer was the alphabetically-first hundred,
 * with no field anywhere indicating that more existed.
 *
 * Pure over `URLSearchParams`: no database, no session, so these run in the
 * `quality` job rather than only where a Postgres is available.
 */
import { describe, expect, test } from "bun:test";

import { encodeKeysetCursor } from "../src/modules/_shared/keyset-pagination";
import { parseBlogTermListQuery } from "../src/modules/blog-content/domain/blog-term-list-query";

function parse(qs: string) {
  return parseBlogTermListQuery(new URLSearchParams(qs));
}

const CURSOR = encodeKeysetCursor(
  "2026-07-17T10:00:00.029058+00:00",
  "11111111-2222-4333-8444-555555555555"
);

describe("defaults", () => {
  test("an empty query is the admin screen's alphabetical list", () => {
    const result = parse("");
    expect(result.valid).toBe(true);
    if (!result.valid) return;

    expect(result.value.stableOrder).toBe(false);
    expect(result.value.cursor).toBeNull();
    expect(result.value.taxonomyType).toBeUndefined();
    expect(result.value.limit).toBeUndefined();
  });

  test("order=created_at selects the cursor-capable traversal", () => {
    const result = parse("order=created_at");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.stableOrder).toBe(true);
  });

  test("order=name is accepted and is NOT the traversal", () => {
    // Spelling the default out loud must not quietly buy a cursor.
    const result = parse("order=name");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.stableOrder).toBe(false);
  });
});

describe("taxonomyType", () => {
  test("every vocabulary the module has is accepted", () => {
    for (const type of ["category", "tag", "channel", "topic"]) {
      const result = parse(`taxonomyType=${type}`);
      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(result.value.taxonomyType).toBe(type as never);
    }
  });

  test("an unknown vocabulary is refused, not ignored", () => {
    // Ignoring it returns EVERY term to a caller that asked for one kind —
    // a tag archive built from that list would also generate a page per
    // category, at the tag URL.
    const result = parse("taxonomyType=institution");
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.message).toContain("category, tag, channel, topic");
  });
});

describe("cursor is refused over the mutable ordering", () => {
  test("a cursor without order=created_at is a 400", () => {
    const result = parse(`cursor=${CURSOR}`);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.message).toContain("order=created_at");
  });

  test("a cursor with the explicit name ordering is refused too", () => {
    const result = parse(`order=name&cursor=${CURSOR}`);
    expect(result.valid).toBe(false);
  });

  test("a cursor with order=created_at decodes to its two parts", () => {
    const result = parse(`order=created_at&cursor=${CURSOR}`);
    expect(result.valid).toBe(true);
    if (!result.valid) return;

    expect(result.value.cursor).toEqual({
      createdAt: "2026-07-17T10:00:00.029058+00:00",
      id: "11111111-2222-4333-8444-555555555555"
    });
  });

  test("the cursor keeps its MICROSECONDS", () => {
    // A cursor routed through a JS `Date` denotes an instant strictly earlier
    // than the row it came from, so the traversal skips every row sharing that
    // millisecond — the Issue #158 defect, re-pinned here because a term
    // catalogue is exactly the kind of table that gets seeded in one batch
    // insert sharing a single millisecond.
    const result = parse(`order=created_at&cursor=${CURSOR}`);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.cursor?.createdAt).toContain(".029058");
  });

  test("a malformed cursor is a 400, never treated as page one", () => {
    const result = parse("order=created_at&cursor=not-a-cursor");
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.message).toContain("malformed");
  });
});

describe("limit", () => {
  test("a positive limit is carried through", () => {
    const result = parse("limit=25");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.limit).toBe(25);
  });

  test("zero, negative and non-numeric limits are refused", () => {
    for (const value of ["0", "-1", "abc"]) {
      expect(parse(`limit=${value}`).valid).toBe(false);
    }
  });
});

describe("order", () => {
  test("an unknown order is refused, never a silent fallback", () => {
    // Falling back would hand the alphabetical FIRST PAGE to a caller that
    // asked for a traversal, which is the whole failure this endpoint change
    // exists to end.
    const result = parse("order=updated_at");
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.message).toContain("created_at, name");
  });
});
