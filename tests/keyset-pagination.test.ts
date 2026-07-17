import { describe, expect, test } from "bun:test";

import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  KEYSET_CURSOR_CREATED_AT_SQL
} from "../src/modules/_shared/keyset-pagination";

const id = "11111111-2222-4333-8444-555555555555";
// Full microsecond precision — the whole point of Issue #158. A JS `Date`
// could not represent the `.029058` tail; the cursor carries it as text.
const createdAt = "2026-01-02T03:04:05.029058+00:00";

describe("keyset pagination cursor", () => {
  test("round-trips (created_at, id) through an opaque cursor at microsecond precision", () => {
    const decoded = decodeKeysetCursor(encodeKeysetCursor(createdAt, id));

    expect(decoded).not.toBeNull();
    expect(decoded!.id).toBe(id);
    // Verbatim string, NOT a Date — the microseconds survive untouched.
    expect(decoded!.createdAt).toBe(createdAt);
  });

  test("preserves microseconds a JS Date would floor to milliseconds", () => {
    // Three instants a JS Date collapses onto the same `.029Z` (the exact bug
    // in Issue #158) stay distinct through the cursor.
    for (const micro of [
      "2026-01-02T03:04:05.029058+00:00",
      "2026-01-02T03:04:05.029958+00:00",
      "2026-01-02T03:04:05.029999+00:00"
    ]) {
      const decoded = decodeKeysetCursor(encodeKeysetCursor(micro, id));
      expect(decoded!.createdAt).toBe(micro);
      // The collapse the fix avoids: all three floor to the same Date.
      expect(new Date(decoded!.createdAt).toISOString()).toBe(
        "2026-01-02T03:04:05.029Z"
      );
    }
  });

  test("still accepts a legacy millisecond `Z` cursor (backward compatible)", () => {
    const legacy = Buffer.from(
      `2026-01-02T03:04:05.678Z|${id}`,
      "utf-8"
    ).toString("base64url");
    const decoded = decodeKeysetCursor(legacy);
    expect(decoded).not.toBeNull();
    expect(decoded!.createdAt).toBe("2026-01-02T03:04:05.678Z");
  });

  test("rejects a forged/garbage cursor with null (never treated as page 1)", () => {
    expect(decodeKeysetCursor("not-a-cursor")).toBeNull();
    expect(decodeKeysetCursor("")).toBeNull();
  });

  test("rejects a cursor whose id is not a UUID", () => {
    const bad = Buffer.from(`${createdAt}|not-a-uuid`, "utf-8").toString(
      "base64url"
    );
    expect(decodeKeysetCursor(bad)).toBeNull();
  });

  test("rejects a cursor whose timestamp is malformed", () => {
    const bad = Buffer.from(`not-a-date|${id}`, "utf-8").toString("base64url");
    expect(decodeKeysetCursor(bad)).toBeNull();
  });

  test("rejects a shaped-but-out-of-range timestamp before it reaches SQL", () => {
    // Passes the shape regex but is not a real instant — must not slip through
    // to become a 500 at the `::timestamptz` bind.
    const bad = Buffer.from(
      `2026-13-45T99:99:99.000000+00:00|${id}`,
      "utf-8"
    ).toString("base64url");
    expect(decodeKeysetCursor(bad)).toBeNull();
  });

  test("exposes the SQL expression that emits the full-precision cursor text", () => {
    expect(KEYSET_CURSOR_CREATED_AT_SQL).toContain("AT TIME ZONE 'UTC'");
    expect(KEYSET_CURSOR_CREATED_AT_SQL).toContain("US");
  });
});
