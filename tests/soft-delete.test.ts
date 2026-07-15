import { describe, expect, test } from "bun:test";

import {
  activeRecordPredicate,
  deletedRecordPredicate,
  shouldIncludeDeleted,
  shouldOnlyListDeleted
} from "../src/modules/_shared/soft-delete";

describe("soft-delete list options", () => {
  test("shouldIncludeDeleted is false by default", () => {
    expect(shouldIncludeDeleted()).toBe(false);
    expect(shouldIncludeDeleted({})).toBe(false);
  });

  test("shouldIncludeDeleted is true when includeDeleted or onlyDeleted is set", () => {
    expect(shouldIncludeDeleted({ includeDeleted: true })).toBe(true);
    expect(shouldIncludeDeleted({ onlyDeleted: true })).toBe(true);
  });

  test("shouldOnlyListDeleted only follows onlyDeleted", () => {
    expect(shouldOnlyListDeleted({ includeDeleted: true })).toBe(false);
    expect(shouldOnlyListDeleted({ onlyDeleted: true })).toBe(true);
  });

  test("predicates default to the deleted_at column", () => {
    expect(activeRecordPredicate()).toBe("deleted_at IS NULL");
    expect(deletedRecordPredicate()).toBe("deleted_at IS NOT NULL");
    expect(activeRecordPredicate("archived_at")).toBe("archived_at IS NULL");
  });
});
