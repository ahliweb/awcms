import { describe, expect, test } from "bun:test";

import {
  compareSemver,
  isValidSemver,
  parseSemver,
  parseSemverRange,
  satisfiesSemverRange
} from "../src/lib/semver/compare";

describe("parseSemver (Issue #741)", () => {
  test("parses a valid MAJOR.MINOR.PATCH string", () => {
    expect(parseSemver("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  test("rejects pre-release/build metadata suffixes", () => {
    expect(parseSemver("1.2.3-rc.1")).toBeNull();
    expect(parseSemver("1.2.3+build.5")).toBeNull();
  });

  test("rejects a partial version", () => {
    expect(parseSemver("1.2")).toBeNull();
  });

  test("rejects non-numeric segments", () => {
    expect(parseSemver("a.b.c")).toBeNull();
  });

  test("isValidSemver mirrors parseSemver's null-ness", () => {
    expect(isValidSemver("0.23.5")).toBe(true);
    expect(isValidSemver("not-a-version")).toBe(false);
  });
});

describe("compareSemver (Issue #741)", () => {
  test("orders by major, then minor, then patch", () => {
    expect(compareSemver(parseSemver("1.0.0")!, parseSemver("2.0.0")!)).toBe(
      -1
    );
    expect(compareSemver(parseSemver("1.1.0")!, parseSemver("1.0.9")!)).toBe(1);
    expect(compareSemver(parseSemver("1.0.1")!, parseSemver("1.0.1")!)).toBe(0);
    expect(compareSemver(parseSemver("1.0.0")!, parseSemver("1.0.1")!)).toBe(
      -1
    );
  });
});

describe("parseSemverRange (Issue #741)", () => {
  test("parses a single unprefixed comparator as exact match", () => {
    expect(parseSemverRange("1.2.3")).toEqual([
      { operator: "=", version: { major: 1, minor: 2, patch: 3 } }
    ]);
  });

  test("parses a multi-token AND range", () => {
    expect(parseSemverRange(">=0.20.0 <1.0.0")).toEqual([
      { operator: ">=", version: { major: 0, minor: 20, patch: 0 } },
      { operator: "<", version: { major: 1, minor: 0, patch: 0 } }
    ]);
  });

  test("returns null for a malformed token", () => {
    expect(parseSemverRange(">=abc")).toBeNull();
    expect(parseSemverRange("")).toBeNull();
    expect(parseSemverRange("   ")).toBeNull();
  });
});

describe("satisfiesSemverRange (Issue #741)", () => {
  test("bare exact match", () => {
    expect(satisfiesSemverRange("1.2.3", "1.2.3")).toBe(true);
    expect(satisfiesSemverRange("1.2.4", "1.2.3")).toBe(false);
  });

  test("AND-composed range, matching this repo's own base-range convention", () => {
    expect(satisfiesSemverRange("0.23.5", ">=0.20.0 <1.0.0")).toBe(true);
    expect(satisfiesSemverRange("1.0.0", ">=0.20.0 <1.0.0")).toBe(false);
    expect(satisfiesSemverRange("0.19.9", ">=0.20.0 <1.0.0")).toBe(false);
  });

  test("caret: same major, >= specified", () => {
    expect(satisfiesSemverRange("0.23.9", "^0.23.0")).toBe(true);
    expect(satisfiesSemverRange("1.0.0", "^0.23.0")).toBe(false);
    expect(satisfiesSemverRange("0.22.9", "^0.23.0")).toBe(false);
  });

  test("tilde: same major.minor, >= specified", () => {
    expect(satisfiesSemverRange("0.23.9", "~0.23.5")).toBe(true);
    expect(satisfiesSemverRange("0.23.4", "~0.23.5")).toBe(false);
    expect(satisfiesSemverRange("0.24.0", "~0.23.5")).toBe(false);
  });

  test("null when the version string itself is invalid", () => {
    expect(satisfiesSemverRange("not-a-version", ">=1.0.0")).toBeNull();
  });

  test("null when the range string itself is invalid", () => {
    expect(satisfiesSemverRange("1.0.0", "not-a-range")).toBeNull();
  });
});
