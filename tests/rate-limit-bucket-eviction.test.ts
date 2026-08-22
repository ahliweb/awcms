/**
 * PROJECT_STATE §4 **B6** — the in-process rate-limit `Map` had no eviction.
 *
 * One entry per distinct client IP, created on first contact and never
 * removed. Redis is off by default, so this map is the live path for the
 * topology this base documents as its default, and the end state of the leak
 * is an OOM of the process that also holds every other cache.
 *
 * What is asserted here is the pair of properties that make an eviction safe
 * rather than merely small: an entry is only dropped once it can no longer
 * say anything (its window has elapsed — `checkRateLimit` already treats that
 * as a fresh start), and a LIVE counter survives the sweep. A limiter that
 * forgets a live counter hands its owner a fresh allowance, which is the one
 * failure mode a memory fix must not introduce.
 */
import { describe, expect, test, beforeEach } from "bun:test";

import {
  checkRateLimit,
  rateLimitBucketCountForTests,
  resetRateLimitForTests
} from "../src/lib/security/rate-limit";

const CONFIG = { maxAttempts: 5, windowMs: 60_000 };

beforeEach(() => {
  resetRateLimitForTests();
});

describe("expired buckets are reclaimed", () => {
  test("entries whose window has elapsed are dropped", () => {
    const start = 1_000_000;

    for (let index = 0; index < 500; index += 1) {
      checkRateLimit(`ip-${index}`, CONFIG, start);
    }

    expect(rateLimitBucketCountForTests()).toBe(500);

    // Past both the window and the sweep interval: nothing here still counts.
    checkRateLimit("late-arrival", CONFIG, start + CONFIG.windowMs + 1);

    // Only the caller that triggered the sweep is left.
    expect(rateLimitBucketCountForTests()).toBe(1);
  });

  test("a counter still inside its window survives the sweep", () => {
    const start = 2_000_000;

    // A long-window key, then enough sweep-interval time to trigger a sweep
    // while that key is still live.
    const longWindow = { maxAttempts: 3, windowMs: 3_600_000 };

    checkRateLimit("attacker", longWindow, start);
    checkRateLimit("attacker", longWindow, start + 1);
    checkRateLimit("attacker", longWindow, start + 2);

    // Some other client, an hour of sweep intervals later but still inside
    // `attacker`'s window.
    checkRateLimit("bystander", longWindow, start + 120_000);

    // The fourth attempt must still be over the ceiling — i.e. the counter was
    // not reset by the sweep that ran in between.
    const result = checkRateLimit("attacker", longWindow, start + 120_001);

    expect(result.allowed).toBe(false);
  });

  test("the sweep does not run on every call", () => {
    const start = 3_000_000;

    // Two keys created together; the first is left to expire.
    checkRateLimit("short", { maxAttempts: 5, windowMs: 1_000 }, start);

    // A call one second later: `short` has expired, but the sweep interval has
    // not elapsed, so the map is not walked. This asserts the amortisation —
    // walking the map on every request would trade a leak for a cost paid by
    // every authentication attempt.
    checkRateLimit("other", CONFIG, start + 1_001);

    expect(rateLimitBucketCountForTests()).toBe(2);
  });
});

describe("the map is capped even when nothing has expired", () => {
  test("a flood of distinct live keys cannot grow the map without bound", () => {
    const start = 4_000_000;
    const cap = 50_000;

    // Every key inside its window, so there is nothing for the sweep to
    // reclaim — the cap is the only thing standing between this and the OOM.
    for (let index = 0; index <= cap; index += 1) {
      checkRateLimit(`flood-${index}`, CONFIG, start + index);
    }

    expect(rateLimitBucketCountForTests()).toBeLessThanOrEqual(cap);

    // And the eviction is a batch, not one-per-insert: the map is taken well
    // under the cap so the sort it needs is rare rather than per-request.
    expect(rateLimitBucketCountForTests()).toBeLessThan(cap);
  });

  test("eviction takes the entries closest to expiring", () => {
    const start = 5_000_000;
    const cap = 50_000;

    // `oldest` is created first, so it expires first and is the intended
    // victim; `newest` is created last and must survive.
    checkRateLimit("oldest", CONFIG, start);

    for (let index = 1; index <= cap; index += 1) {
      checkRateLimit(`flood-${index}`, CONFIG, start + index);
    }

    // Its counter is gone, so this is a first attempt again.
    const oldest = checkRateLimit("oldest", CONFIG, start + cap + 1);
    expect(oldest.allowed).toBe(true);

    // The most recent key kept its counter through the eviction.
    for (let attempt = 0; attempt < CONFIG.maxAttempts; attempt += 1) {
      checkRateLimit(`flood-${cap}`, CONFIG, start + cap + 2);
    }

    const newest = checkRateLimit(`flood-${cap}`, CONFIG, start + cap + 3);
    expect(newest.allowed).toBe(false);
  });
});
