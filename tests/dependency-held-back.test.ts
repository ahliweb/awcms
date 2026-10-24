/**
 * The held-back register cannot rot (Issue #1173).
 *
 * Every entry must say why, who, and until when — and `reviewDate` is a real
 * deadline: this test fails the day after it, so a hold is re-justified with a
 * new date or removed, never left to look current. (The audit-exception list
 * expires by matching an advisory; a hold has no advisory to match, so it
 * expires by clock.)
 */
import { describe, expect, test } from "bun:test";

import { HELD_BACK } from "../scripts/dependency-held-back";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

describe("HELD_BACK register", () => {
  test("every entry names a package, a held version, a real reason, an owner and a review date", () => {
    for (const entry of HELD_BACK) {
      const label = `${entry.packageName}@${entry.heldVersion}`;

      expect(entry.packageName.trim(), label).not.toBe("");
      expect(entry.heldVersion.trim(), label).not.toBe("");
      expect(entry.owner.trim(), label).not.toBe("");
      expect(entry.reviewDate, label).toMatch(ISO_DATE);
      // "low risk" is a verdict, not a reason. Force a sentence's worth.
      expect(entry.reason.trim().length, label).toBeGreaterThanOrEqual(60);
    }
  });

  test("no entry is past its review date", () => {
    const today = new Date().toISOString().slice(0, 10);
    const expired = HELD_BACK.filter((entry) => entry.reviewDate < today);

    expect(
      expired.map(
        (entry) => `${entry.packageName} (review was ${entry.reviewDate})`
      ),
      "Re-justify these holds with a new reviewDate or remove them — scripts/dependency-held-back.ts"
    ).toEqual([]);
  });

  test("a review date is a real calendar date", () => {
    for (const entry of HELD_BACK) {
      const parsed = new Date(`${entry.reviewDate}T00:00:00Z`);

      expect(parsed.toISOString().slice(0, 10), entry.packageName).toBe(
        entry.reviewDate
      );
    }
  });

  test("no package is registered twice", () => {
    const names = HELD_BACK.map((entry) => entry.packageName);

    expect(new Set(names).size).toBe(names.length);
  });
});
