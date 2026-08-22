import { describe, expect, test } from "bun:test";

import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  keysetCursorCreatedAtSql,
  utcMicrosecondTextSql
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
    // Both halves matter and both are silent when wrong: without the zone the
    // value depends on the session `TimeZone`; with `MS` instead of `US` the
    // cursor loses the microseconds and Issue #158 comes back past page one.
    expect(keysetCursorCreatedAtSql()).toContain("AT TIME ZONE 'UTC'");
    expect(keysetCursorCreatedAtSql()).toContain(".US");
    expect(keysetCursorCreatedAtSql()).toContain("created_at");
  });

  test("takes a table alias, which the old constant could not", () => {
    // The reason there were twenty hand-written copies: the constant hardcoded
    // a bare `created_at` and its own docblock told callers to "wrap it in a
    // table alias at the call site", which is not a thing a string can do — so
    // every joined query wrote its own.
    expect(keysetCursorCreatedAtSql("t")).toContain("t.created_at");
    expect(keysetCursorCreatedAtSql()).not.toContain(".created_at");
  });

  test("refuses a column reference that is not an identifier", () => {
    // The expression is handed to `tx.unsafe` by every caller, so the column
    // reference is the one part that is not a literal. Every call site passes a
    // hard-coded string; this is what keeps that true rather than currently
    // true.
    for (const bad of [
      "created_at; DROP TABLE awcms_posts",
      "created_at'",
      "a.b.c",
      "",
      "1created_at"
    ]) {
      expect(() => utcMicrosecondTextSql(bad), bad).toThrow();
    }

    expect(() => utcMicrosecondTextSql("activated_at")).not.toThrow();
    expect(() => utcMicrosecondTextSql("t.created_at")).not.toThrow();
  });

  test("both offset spellings round-trip through the decoder", () => {
    // `+00:00` is what a cursor carries; `Z` is what the idn_admin_regions DTO
    // has always emitted. `decodeKeysetCursor` accepts either, which is why the
    // two surfaces can share one renderer without either changing what it
    // promised its readers.
    const id = "11111111-2222-4333-8444-555555555555";

    for (const suffix of ["+00:00", "Z"] as const) {
      expect(utcMicrosecondTextSql("created_at", suffix)).toContain(
        `"${suffix}"`
      );

      const cursor = encodeKeysetCursor(
        `2026-07-17T10:00:00.029058${suffix}`,
        id
      );
      expect(decodeKeysetCursor(cursor)).not.toBeNull();
    }
  });
});

describe("nothing writes the timestamp expression by hand (finding D13)", () => {
  test("no module inlines its own to_char(... AT TIME ZONE 'UTC' ...)", async () => {
    // The durable half of D13. Replacing twenty copies is a one-off; this is
    // what stops the twenty-first, and it is worth a test rather than a review
    // habit because the failure is silent, correct on page one, and only wrong
    // past a page boundary — where nothing was looking when Issue #158 shipped.
    const OWNER = "src/modules/_shared/keyset-pagination.ts";
    const offenders: string[] = [];

    for await (const file of new Bun.Glob("src/**/*.ts").scan({
      cwd: process.cwd()
    })) {
      if (file === OWNER) continue;

      const source = await Bun.file(file).text();

      // Deliberately matches the RENDERING, not the exact format string: an
      // edit that gets a character wrong is precisely the case this must catch,
      // and asserting the correct spelling would miss every incorrect one.
      if (/to_char\([^)]*AT TIME ZONE 'UTC'/.test(source)) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});
