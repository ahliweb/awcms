import { describe, expect, test } from "bun:test";

import {
  DOMAIN_EVENT_DELIVERY_BASE_DELAY_SECONDS,
  DOMAIN_EVENT_DELIVERY_MAX_DELAY_SECONDS,
  evaluateDomainEventDeliveryRetry
} from "../src/modules/domain-event-runtime/domain/delivery-retry";

const NOW = new Date("2026-07-16T00:00:00.000Z");

describe("evaluateDomainEventDeliveryRetry", () => {
  test("a retryable error with attempts remaining is eligible with exponential backoff", () => {
    const error = new Error("ECONNRESET");
    const result = evaluateDomainEventDeliveryRetry(error, 1, 8, NOW);

    expect(result.eligible).toBe(true);
    if (result.eligible) {
      expect(result.classification).toBe("retryable");
      const expectedDelayMs = DOMAIN_EVENT_DELIVERY_BASE_DELAY_SECONDS * 1000;
      expect(result.nextAttemptAt.getTime() - NOW.getTime()).toBe(
        expectedDelayMs
      );
    }
  });

  test("delay grows exponentially with attempt count", () => {
    const error = new Error("ECONNRESET");
    const first = evaluateDomainEventDeliveryRetry(error, 1, 8, NOW);
    const second = evaluateDomainEventDeliveryRetry(error, 2, 8, NOW);
    const third = evaluateDomainEventDeliveryRetry(error, 3, 8, NOW);

    expect(first.eligible && second.eligible && third.eligible).toBe(true);
    if (first.eligible && second.eligible && third.eligible) {
      const firstDelay = first.nextAttemptAt.getTime() - NOW.getTime();
      const secondDelay = second.nextAttemptAt.getTime() - NOW.getTime();
      const thirdDelay = third.nextAttemptAt.getTime() - NOW.getTime();
      expect(secondDelay).toBe(firstDelay * 2);
      expect(thirdDelay).toBe(firstDelay * 4);
    }
  });

  test("delay is capped at the maximum, never unbounded", () => {
    const error = new Error("ECONNRESET");
    const result = evaluateDomainEventDeliveryRetry(error, 7, 8, NOW);

    expect(result.eligible).toBe(true);
    if (result.eligible) {
      const delayMs = result.nextAttemptAt.getTime() - NOW.getTime();
      expect(delayMs).toBeLessThanOrEqual(
        DOMAIN_EVENT_DELIVERY_MAX_DELAY_SECONDS * 1000
      );
    }
  });

  test("not eligible once attemptCount reaches maxAttempts, even for a retryable error", () => {
    const error = new Error("ECONNRESET");
    const result = evaluateDomainEventDeliveryRetry(error, 8, 8, NOW);

    expect(result.eligible).toBe(false);
    expect(result.classification).toBe("retryable");
  });

  test("a not_retryable error goes straight to dead-letter regardless of remaining attempt budget", () => {
    const error = new Bun.SQL.PostgresError("duplicate key value", {
      code: "23505",
      errno: "23505"
    });
    const result = evaluateDomainEventDeliveryRetry(error, 1, 8, NOW);

    expect(result.eligible).toBe(false);
    expect(result.classification).toBe("not_retryable");
  });

  test("an unknown-classification error is still retried while budget remains", () => {
    const error = new Error("something went wrong");
    const result = evaluateDomainEventDeliveryRetry(error, 1, 8, NOW);

    expect(result.eligible).toBe(true);
    expect(result.classification).toBe("unknown");
  });
});
