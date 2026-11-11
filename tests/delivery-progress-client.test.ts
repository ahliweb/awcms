/**
 * The pure parts of the live progress panel (Issue #1171, ADR-0154 section 6):
 * frames are parsed defensively, announcements are rate-limited, and reconnects
 * back off with jitter.
 */
import { describe, expect, test } from "bun:test";

import {
  ANNOUNCE_INTERVAL_MS,
  backoffDelayMs,
  parseProgressCounts,
  shouldAnnounce
} from "../src/lib/ui/delivery-progress-client";

describe("parseProgressCounts", () => {
  test("reads a v1 envelope's counts", () => {
    expect(
      parseProgressCounts({ v: 1, counts: { sent: 3, failed: 1 } })
    ).toEqual({
      sent: 3,
      failed: 1
    });
  });

  test("ignores an unknown version, a missing counts object and non-integer values", () => {
    expect(parseProgressCounts({ v: 2, counts: { sent: 3 } })).toBeNull();
    expect(parseProgressCounts({ v: 1 })).toBeNull();
    expect(parseProgressCounts(null)).toBeNull();
    expect(
      parseProgressCounts({
        v: 1,
        counts: { sent: -1, failed: 1.5, queued: "4", expired: 2, other: 9 }
      })
    ).toEqual({ expired: 2 });
  });
});

describe("announcements", () => {
  test("at most one per interval, except urgent ones", () => {
    expect(shouldAnnounce(null, 0, false)).toBe(true);
    expect(shouldAnnounce(0, ANNOUNCE_INTERVAL_MS - 1, false)).toBe(false);
    expect(shouldAnnounce(0, ANNOUNCE_INTERVAL_MS, false)).toBe(true);
    expect(shouldAnnounce(0, 1, true)).toBe(true);
  });
});

describe("reconnect backoff", () => {
  test("grows, is jittered, and is capped", () => {
    expect(backoffDelayMs(0, () => 0)).toBe(1_000);
    expect(backoffDelayMs(0, () => 0.999)).toBeLessThan(3_000);
    expect(backoffDelayMs(3, () => 0.999)).toBeGreaterThan(
      backoffDelayMs(1, () => 0.999)
    );
    expect(backoffDelayMs(30, () => 0.999)).toBeLessThanOrEqual(61_000);
  });
});
