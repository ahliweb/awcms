/**
 * The audit summary's limit is a ceiling, not a suggestion.
 *
 * This endpoint takes a caller-supplied `?limit=`, and the row source is the
 * audit log — the highest-volume table a tenant owns. An unbounded or
 * NaN-poisoned limit turns an admin panel into an export, so the clamp is the
 * part worth pinning; everything else here is a `SELECT` with two predicates.
 *
 * Pure — no database.
 */
import { describe, expect, test } from "bun:test";

import {
  boundAuditSummaryLimit,
  MODULE_AUDIT_SUMMARY_DEFAULT_LIMIT,
  MODULE_AUDIT_SUMMARY_MAX_LIMIT
} from "../src/modules/module-management/application/module-audit-summary";

describe("limit bounding", () => {
  test.each([
    [1, 1],
    [20, 20],
    [50, 50]
  ])("passes a valid limit through (%i)", (input, expected) => {
    expect(boundAuditSummaryLimit(input)).toBe(expected);
  });

  test.each([
    [0, 1],
    [-5, 1],
    [51, MODULE_AUDIT_SUMMARY_MAX_LIMIT],
    [10_000, MODULE_AUDIT_SUMMARY_MAX_LIMIT]
  ])("clamps out-of-range %i to %i", (input, expected) => {
    expect(boundAuditSummaryLimit(input)).toBe(expected);
  });

  test.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["a string", "20"],
    ["null", null],
    ["undefined", undefined],
    ["an object", {}]
  ])("falls back to the default for %s", (_label, input) => {
    // `Number(url.searchParams.get("limit"))` yields NaN for `?limit=abc` and
    // Infinity for a large enough literal. Neither may reach `LIMIT`.
    expect(boundAuditSummaryLimit(input)).toBe(
      MODULE_AUDIT_SUMMARY_DEFAULT_LIMIT
    );
  });

  test("a fractional limit truncates rather than reaching SQL as a float", () => {
    expect(boundAuditSummaryLimit(7.9)).toBe(7);
  });

  test("the default is inside the allowed range", () => {
    expect(MODULE_AUDIT_SUMMARY_DEFAULT_LIMIT).toBeLessThanOrEqual(
      MODULE_AUDIT_SUMMARY_MAX_LIMIT
    );
    expect(MODULE_AUDIT_SUMMARY_DEFAULT_LIMIT).toBeGreaterThan(0);
  });
});
