import { describe, expect, test } from "bun:test";

import { evaluateEmailRetry } from "../src/modules/email/domain/email-retry";

describe("evaluateEmailRetry", () => {
  test("eligible with exponential backoff before maxRetries is reached", () => {
    const now = new Date("2026-01-01T00:00:00Z");

    const first = evaluateEmailRetry(0, 5, now);
    expect(first.eligible).toBe(true);
    expect(first.nextAttemptAt).toEqual(new Date("2026-01-01T00:01:00Z"));

    const second = evaluateEmailRetry(1, 5, now);
    expect(second.eligible).toBe(true);
    expect(second.nextAttemptAt).toEqual(new Date("2026-01-01T00:02:00Z"));

    const third = evaluateEmailRetry(2, 5, now);
    expect(third.nextAttemptAt).toEqual(new Date("2026-01-01T00:04:00Z"));
  });

  test("delay is capped at EMAIL_MAX_RETRY_DELAY_MINUTES", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const evaluation = evaluateEmailRetry(10, 20, now);

    expect(evaluation.eligible).toBe(true);
    expect(evaluation.nextAttemptAt).toEqual(new Date("2026-01-01T01:00:00Z"));
  });

  test("ineligible once retryCount reaches maxRetries", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const evaluation = evaluateEmailRetry(5, 5, now);

    expect(evaluation.eligible).toBe(false);
    expect(evaluation.nextAttemptAt).toBeUndefined();
  });
});

describe("evaluateEmailRetry — provider Retry-After (Issue #1159)", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  test("a longer Retry-After wins over the backoff", () => {
    expect(evaluateEmailRetry(0, 5, now, 600_000).nextAttemptAt).toEqual(
      new Date("2026-01-01T00:10:00Z")
    );
  });

  test("a shorter Retry-After never shortens the backoff", () => {
    expect(evaluateEmailRetry(2, 5, now, 1_000).nextAttemptAt).toEqual(
      new Date("2026-01-01T00:04:00Z")
    );
  });

  test("Retry-After is capped at the maximum delay", () => {
    expect(evaluateEmailRetry(0, 5, now, 99 * 3_600_000).nextAttemptAt).toEqual(
      new Date("2026-01-01T01:00:00Z")
    );
  });

  test("does not make an exhausted message eligible", () => {
    expect(evaluateEmailRetry(5, 5, now, 1_000).eligible).toBe(false);
  });
});
