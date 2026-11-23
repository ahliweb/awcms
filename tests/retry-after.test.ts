import { describe, expect, test } from "bun:test";

import { parseRetryAfterClamped } from "../src/lib/integration/retry-after";
import {
  OBJECT_SYNC_MAX_RETRY_AFTER_MS,
  evaluateObjectRetry
} from "../src/modules/sync-storage/domain/object-queue";

const NOW = new Date("2026-01-01T00:00:00Z");

describe("parseRetryAfterClamped (#1432)", () => {
  test("absent or junk is undefined", () => {
    for (const v of [null, undefined, "", "abc", "-5", "1.5", "99999999999"]) {
      expect(parseRetryAfterClamped(v, NOW, 1000, 60_000)).toBeUndefined();
    }
  });

  test("delta-seconds converts to ms and clamps both ways", () => {
    expect(parseRetryAfterClamped("10", NOW, 1000, 60_000)).toBe(10_000);
    expect(parseRetryAfterClamped("0", NOW, 1000, 60_000)).toBe(1000);
    expect(parseRetryAfterClamped("86400", NOW, 1000, 60_000)).toBe(60_000);
  });

  test("HTTP-date is relative to now; past dates clamp to the floor", () => {
    expect(
      parseRetryAfterClamped("Thu, 01 Jan 2026 00:00:30 GMT", NOW, 1000, 60_000)
    ).toBe(30_000);
    expect(
      parseRetryAfterClamped("Wed, 31 Dec 2025 00:00:00 GMT", NOW, 1000, 60_000)
    ).toBe(1000);
  });
});

describe("evaluateObjectRetry with Retry-After (#1432)", () => {
  test("never shortens the exponential backoff", () => {
    const r = evaluateObjectRetry(2, NOW, 1000);

    expect(r.nextRetryAt!.getTime()).toBe(NOW.getTime() + 4 * 60_000);
  });

  test("lengthens it when the provider asks for more, capped", () => {
    expect(evaluateObjectRetry(0, NOW, 600_000).nextRetryAt!.getTime()).toBe(
      NOW.getTime() + 600_000
    );
    expect(evaluateObjectRetry(0, NOW, 10 ** 12).nextRetryAt!.getTime()).toBe(
      NOW.getTime() + OBJECT_SYNC_MAX_RETRY_AFTER_MS
    );
  });

  test("omitted keeps the old behaviour", () => {
    expect(evaluateObjectRetry(0, NOW).nextRetryAt!.getTime()).toBe(
      NOW.getTime() + 60_000
    );
  });
});
