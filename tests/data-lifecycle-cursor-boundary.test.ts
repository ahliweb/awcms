/**
 * Regression test for the cursor-boundary safety margin
 * (`domain/cursor-boundary.ts`). `timestamptz` is microsecond-resolution but a
 * value read back through Bun.SQL as a JS `Date` only has millisecond
 * resolution, silently truncating the true value DOWN — so a comparison against
 * a row's own truncated stored value can spuriously exclude that very row at a
 * batch boundary. The 1ms upward pad is the fix; this test pins it so a future
 * refactor cannot quietly drop or change the margin.
 */
import { describe, expect, test } from "bun:test";

import {
  CURSOR_BOUNDARY_SAFETY_MARGIN_MS,
  applyCursorBoundarySafetyMargin
} from "../src/modules/data-lifecycle/domain/cursor-boundary";

describe("cursor boundary safety margin", () => {
  test("the margin is exactly 1ms (max Date-truncation is 999us; 1ms covers it)", () => {
    expect(CURSOR_BOUNDARY_SAFETY_MARGIN_MS).toBe(1);
  });

  test("padding shifts the boundary UP by exactly the margin", () => {
    const value = new Date("2026-07-01T00:00:00.500Z");
    const padded = applyCursorBoundarySafetyMargin(value);
    expect(padded.getTime()).toBe(
      value.getTime() + CURSOR_BOUNDARY_SAFETY_MARGIN_MS
    );
  });

  test("a row's own truncated value now satisfies its own `<=` upper bound", () => {
    // The bug: the true timestamptz was e.g. ...000.500123Z, read back truncated
    // to ...000.500Z. Comparing `stored <= readBackUnpadded` at the boundary
    // could fail. Padding the bound makes the boundary row inclusive.
    const trueStored = new Date("2026-07-01T00:00:00.500Z"); // JS-truncated value
    const unpaddedBound = trueStored;
    const paddedBound = applyCursorBoundarySafetyMargin(trueStored);
    // The boundary row is included under the padded bound, and never excluded.
    expect(trueStored.getTime() <= paddedBound.getTime()).toBe(true);
    // Documented direction: padded bound is strictly greater than the unpadded.
    expect(paddedBound.getTime()).toBeGreaterThan(unpaddedBound.getTime());
  });

  test("does not mutate its input", () => {
    const value = new Date("2026-07-01T00:00:00.000Z");
    const before = value.getTime();
    applyCursorBoundarySafetyMargin(value);
    expect(value.getTime()).toBe(before);
  });
});
