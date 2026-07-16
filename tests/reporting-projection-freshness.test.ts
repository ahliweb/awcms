import { describe, expect, test } from "bun:test";
import {
  computeProjectionFreshness,
  type ProjectionFreshnessFacts
} from "../src/modules/reporting/domain/freshness";
import type { ProjectionFreshnessPolicy } from "../src/modules/_shared/module-contract";

const POLICY: ProjectionFreshnessPolicy = {
  targetSeconds: 60,
  staleAfterSeconds: 300,
  errorAfterConsecutiveFailures: 3
};

const NOW = new Date("2026-07-14T12:00:00.000Z");

function facts(
  overrides: Partial<ProjectionFreshnessFacts> = {}
): ProjectionFreshnessFacts {
  return {
    lastSuccessAt: null,
    lastAttemptAt: null,
    consecutiveFailures: 0,
    lastErrorMessage: null,
    rebuildInProgress: false,
    ...overrides
  };
}

describe("computeProjectionFreshness (Issue #753)", () => {
  test("rebuildInProgress always wins, regardless of age or failure count", () => {
    const result = computeProjectionFreshness(
      facts({
        rebuildInProgress: true,
        lastSuccessAt: NOW,
        consecutiveFailures: 99
      }),
      POLICY,
      NOW
    );
    expect(result.status).toBe("rebuilding");
    expect(result.ageSeconds).toBeNull();
  });

  test("never having succeeded is always 'stale', never 'current'/'delayed'", () => {
    const result = computeProjectionFreshness(
      facts({ lastSuccessAt: null }),
      POLICY,
      NOW
    );
    expect(result.status).toBe("stale");
    expect(result.ageSeconds).toBeNull();
  });

  test("recently succeeded, under targetSeconds -> 'current'", () => {
    const lastSuccessAt = new Date(NOW.getTime() - 30_000); // 30s ago
    const result = computeProjectionFreshness(
      facts({ lastSuccessAt }),
      POLICY,
      NOW
    );
    expect(result.status).toBe("current");
    expect(result.ageSeconds).toBeCloseTo(30, 0);
  });

  test("between targetSeconds and staleAfterSeconds -> 'delayed'", () => {
    const lastSuccessAt = new Date(NOW.getTime() - 120_000); // 120s ago
    const result = computeProjectionFreshness(
      facts({ lastSuccessAt }),
      POLICY,
      NOW
    );
    expect(result.status).toBe("delayed");
  });

  test("at or beyond staleAfterSeconds -> 'stale'", () => {
    const lastSuccessAt = new Date(NOW.getTime() - 400_000); // 400s ago
    const result = computeProjectionFreshness(
      facts({ lastSuccessAt }),
      POLICY,
      NOW
    );
    expect(result.status).toBe("stale");
  });

  test("consecutiveFailures at/above the policy threshold -> 'failed', even if recently 'succeeded' at some earlier point", () => {
    const lastSuccessAt = new Date(NOW.getTime() - 10_000); // recent-looking
    const result = computeProjectionFreshness(
      facts({ lastSuccessAt, consecutiveFailures: 3 }),
      POLICY,
      NOW
    );
    expect(result.status).toBe("failed");
  });

  test("consecutiveFailures below threshold does not force 'failed' — normal age-based status applies", () => {
    const lastSuccessAt = new Date(NOW.getTime() - 10_000);
    const result = computeProjectionFreshness(
      facts({ lastSuccessAt, consecutiveFailures: 2 }),
      POLICY,
      NOW
    );
    expect(result.status).toBe("current");
  });

  test("CRITICAL: a worker that stops running entirely (no further writes at all) still ages the status from current -> delayed -> stale purely by elapsed time, with zero new writes — this is the whole point of computing status live rather than caching it", () => {
    const lastSuccessAt = new Date(NOW.getTime() - 30_000);
    const sameFacts = facts({ lastSuccessAt, consecutiveFailures: 0 });

    const atT0 = computeProjectionFreshness(sameFacts, POLICY, NOW);
    expect(atT0.status).toBe("current");

    const atT150s = computeProjectionFreshness(
      sameFacts,
      POLICY,
      new Date(NOW.getTime() + 150_000)
    );
    expect(atT150s.status).toBe("delayed");

    const atT400s = computeProjectionFreshness(
      sameFacts,
      POLICY,
      new Date(NOW.getTime() + 400_000)
    );
    expect(atT400s.status).toBe("stale");
  });
});
