/**
 * Unit tests for `.admin-bulk-bar`'s pure client logic (Issue #862, wave 3 of
 * #858) — `src/lib/ui/admin-bulk-bar-client.ts`. No DOM, no server; these
 * cover the decision-narrowing and selection-state projection that
 * `comments.astro`'s `<script>` calls, matching this repo's existing split
 * between a pure, directly-tested module and inline DOM glue (see
 * `tests/admin-reason-panel-client.test.ts` for the sibling pattern).
 */
import { describe, expect, test } from "bun:test";

import {
  computeBulkBarState,
  fillCount,
  isBulkDecision
} from "../src/lib/ui/admin-bulk-bar-client";

describe("isBulkDecision", () => {
  test("accepts approve/reject/spam", () => {
    expect(isBulkDecision("approve")).toBe(true);
    expect(isBulkDecision("reject")).toBe(true);
    expect(isBulkDecision("spam")).toBe(true);
  });

  test("rejects the single-row-only actions (archive/restore) and anything else", () => {
    expect(isBulkDecision("archive")).toBe(false);
    expect(isBulkDecision("restore")).toBe(false);
    expect(isBulkDecision("delete")).toBe(false);
    expect(isBulkDecision("")).toBe(false);
    expect(isBulkDecision(undefined)).toBe(false);
  });
});

describe("fillCount", () => {
  test("substitutes the {count} placeholder", () => {
    expect(fillCount("{count} selected", 3)).toBe("3 selected");
  });

  test("substitutes only the first occurrence (the bar's templates carry exactly one)", () => {
    expect(fillCount("{count} of {count}", 2)).toBe("2 of {count}");
  });

  test("a template with no placeholder is returned unchanged", () => {
    expect(fillCount("Selected", 5)).toBe("Selected");
  });

  test("count 0 still substitutes (callers decide whether 0 is ever shown)", () => {
    expect(fillCount("{count} selected", 0)).toBe("0 selected");
  });
});

describe("computeBulkBarState", () => {
  test("no rows selected -> hidden, count text still filled", () => {
    const state = computeBulkBarState(10, 0, "{count} selected");

    expect(state.hidden).toBe(true);
    expect(state.countText).toBe("0 selected");
    expect(state.selectAllChecked).toBe(false);
    expect(state.selectAllIndeterminate).toBe(false);
  });

  test("some rows selected -> visible, select-all indeterminate", () => {
    const state = computeBulkBarState(10, 4, "{count} selected");

    expect(state.hidden).toBe(false);
    expect(state.countText).toBe("4 selected");
    expect(state.selectAllChecked).toBe(false);
    expect(state.selectAllIndeterminate).toBe(true);
  });

  test("all rows selected -> visible, select-all checked and not indeterminate", () => {
    const state = computeBulkBarState(10, 10, "{count} selected");

    expect(state.hidden).toBe(false);
    expect(state.selectAllChecked).toBe(true);
    expect(state.selectAllIndeterminate).toBe(false);
  });

  test("zero total rows never reports select-all as checked", () => {
    const state = computeBulkBarState(0, 0, "{count} selected");

    expect(state.selectAllChecked).toBe(false);
    expect(state.selectAllIndeterminate).toBe(false);
  });
});
