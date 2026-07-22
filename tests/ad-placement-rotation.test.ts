import { describe, expect, test } from "bun:test";

import {
  selectAdsForRotation,
  type AdRotationCandidate
} from "../src/modules/news-portal/domain/ad-placement-rotation";

function candidate(
  id: string,
  priority: number,
  createdAtMs: number
): AdRotationCandidate {
  return { id, priority, createdAt: new Date(createdAtMs) };
}

/** Deterministic sequence generator for tests that need a fixed `randomFn`. */
function fixedSequence(values: readonly number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

describe("selectAdsForRotation (Issue #638)", () => {
  test("returns an empty array for an empty candidate list or maxItems <= 0", () => {
    expect(selectAdsForRotation([], "latest", 3)).toEqual([]);
    expect(selectAdsForRotation([candidate("a", 0, 1)], "latest", 0)).toEqual(
      []
    );
    expect(selectAdsForRotation([candidate("a", 0, 1)], "latest", -1)).toEqual(
      []
    );
  });

  test("clamps maxItems to the candidate pool size (never pads/repeats)", () => {
    const candidates = [candidate("a", 0, 1), candidate("b", 0, 2)];
    expect(selectAdsForRotation(candidates, "latest", 10)).toHaveLength(2);
  });

  test('"latest" orders by createdAt descending', () => {
    const candidates = [
      candidate("old", 0, 1000),
      candidate("newest", 0, 3000),
      candidate("mid", 0, 2000)
    ];
    const selected = selectAdsForRotation(candidates, "latest", 2);
    expect(selected.map((c) => c.id)).toEqual(["newest", "mid"]);
  });

  test('"priority" orders by priority descending, tie-broken by createdAt descending', () => {
    const candidates = [
      candidate("low", 1, 1000),
      candidate("high", 10, 500),
      candidate("high-newer", 10, 2000)
    ];
    const selected = selectAdsForRotation(candidates, "priority", 3);
    expect(selected.map((c) => c.id)).toEqual(["high-newer", "high", "low"]);
  });

  test('"random_safe" returns every candidate exactly once when maxItems equals pool size (a permutation, not a lossy sample)', () => {
    const candidates = [
      candidate("a", 0, 1),
      candidate("b", 0, 2),
      candidate("c", 0, 3),
      candidate("d", 0, 4)
    ];
    const selected = selectAdsForRotation(
      candidates,
      "random_safe",
      4,
      fixedSequence([0.9, 0.1, 0.5, 0.0])
    );
    expect(selected.map((c) => c.id).sort()).toEqual(["a", "b", "c", "d"]);
  });

  test('"random_safe" caps to maxItems', () => {
    const candidates = [
      candidate("a", 0, 1),
      candidate("b", 0, 2),
      candidate("c", 0, 3)
    ];
    const selected = selectAdsForRotation(
      candidates,
      "random_safe",
      2,
      fixedSequence([0.1, 0.2, 0.3])
    );
    expect(selected).toHaveLength(2);
    // Every selected id must come from the real pool — never a fabricated one.
    for (const item of selected) {
      expect(["a", "b", "c"]).toContain(item.id);
    }
  });

  test('"weighted" never selects the same candidate twice and respects maxItems', () => {
    const candidates = [
      candidate("a", 0, 1),
      candidate("b", 5, 2),
      candidate("c", 10, 3)
    ];
    const selected = selectAdsForRotation(
      candidates,
      "weighted",
      3,
      fixedSequence([0.01, 0.5, 0.99])
    );
    expect(selected).toHaveLength(3);
    expect(new Set(selected.map((c) => c.id)).size).toBe(3);
  });

  test('"weighted" still gives a priority: 0 candidate a chance (weight = priority + 1, never zero)', () => {
    const candidates = [candidate("zero-priority", 0, 1)];
    // randomFn always returns 0 -- with weight priority+1=1 and only one
    // candidate in the pool, it must still be selected (no division by zero,
    // no permanent lockout).
    const selected = selectAdsForRotation(candidates, "weighted", 1, () => 0);
    expect(selected.map((c) => c.id)).toEqual(["zero-priority"]);
  });

  test("Math.random is a valid default randomFn (no crash, always returns a real subset)", () => {
    const candidates = [
      candidate("a", 1, 1),
      candidate("b", 2, 2),
      candidate("c", 3, 3)
    ];
    const selectedRandom = selectAdsForRotation(candidates, "random_safe", 2);
    const selectedWeighted = selectAdsForRotation(candidates, "weighted", 2);
    expect(selectedRandom).toHaveLength(2);
    expect(selectedWeighted).toHaveLength(2);
  });
});
