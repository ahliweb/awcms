import type { AdRotationMode } from "./ad-placement-policy";

/**
 * Pure rotation-selection logic for news portal ad placements (Issue #638).
 * Given the full set of currently-eligible (active, in-schedule, tenant-
 * scoped, media-verified — all decided by the caller before this runs) ad
 * rows for ONE placement, picks at most `maxItems` of them in the order the
 * given `rotationMode` implies. No I/O, no `Bun.SQL` — same "selection
 * logic is pure, existence/safety checks happen in the application layer"
 * split `homepage-section-rendering.ts`/`content-block-rendering.ts` already
 * use.
 *
 * `randomFn` is injectable (defaults to `Math.random`) purely so
 * `random_safe`/`weighted` are deterministically testable — never used for
 * anything security-sensitive (this only decides *display order/subset* of
 * already-authorized-to-render ads, not access control), so `Math.random`
 * is an appropriate default; there is no need for `crypto.getRandomValues`
 * here.
 */
export type AdRotationCandidate = {
  id: string;
  priority: number;
  createdAt: Date;
};

function sortByLatest<T extends AdRotationCandidate>(
  candidates: readonly T[]
): T[] {
  return [...candidates].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );
}

function sortByPriority<T extends AdRotationCandidate>(
  candidates: readonly T[]
): T[] {
  return [...candidates].sort((a, b) => {
    if (b.priority !== a.priority) {
      return b.priority - a.priority;
    }
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

/** Fisher-Yates shuffle — every permutation equally likely given a uniform `randomFn`. */
function shuffle<T>(items: readonly T[], randomFn: () => number): T[] {
  const result = [...items];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(randomFn() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }

  return result;
}

/**
 * Weighted sampling WITHOUT replacement — weight = `priority + 1` (so a
 * `priority: 0` row still has a non-zero chance of being picked/ordered
 * first, rather than being permanently locked out whenever any higher-
 * priority row exists). Higher `priority` is proportionally more likely to
 * be selected earlier, but never guaranteed — this is what distinguishes
 * `weighted` from the deterministic `priority` mode.
 */
function weightedSampleWithoutReplacement<T extends AdRotationCandidate>(
  candidates: readonly T[],
  count: number,
  randomFn: () => number
): T[] {
  const pool = [...candidates];
  const result: T[] = [];

  while (result.length < count && pool.length > 0) {
    const weights = pool.map((candidate) => candidate.priority + 1);
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let roll = randomFn() * totalWeight;
    let selectedIndex = pool.length - 1;

    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i]!;
      if (roll <= 0) {
        selectedIndex = i;
        break;
      }
    }

    result.push(pool[selectedIndex]!);
    pool.splice(selectedIndex, 1);
  }

  return result;
}

/**
 * Selects at most `maxItems` candidates from `candidates` in the order
 * `rotationMode` implies. `maxItems <= 0` returns an empty array;
 * `maxItems` is clamped to `candidates.length` (never pads/repeats).
 */
export function selectAdsForRotation<T extends AdRotationCandidate>(
  candidates: readonly T[],
  rotationMode: AdRotationMode,
  maxItems: number,
  randomFn: () => number = Math.random
): T[] {
  if (maxItems <= 0 || candidates.length === 0) {
    return [];
  }

  const cappedCount = Math.min(maxItems, candidates.length);

  switch (rotationMode) {
    case "latest":
      return sortByLatest(candidates).slice(0, cappedCount);
    case "priority":
      return sortByPriority(candidates).slice(0, cappedCount);
    case "random_safe":
      return shuffle(candidates, randomFn).slice(0, cappedCount);
    case "weighted":
      return weightedSampleWithoutReplacement(
        candidates,
        cappedCount,
        randomFn
      );
    default: {
      const exhaustiveCheck: never = rotationMode;
      throw new Error(`Unknown rotation mode: ${String(exhaustiveCheck)}`);
    }
  }
}
