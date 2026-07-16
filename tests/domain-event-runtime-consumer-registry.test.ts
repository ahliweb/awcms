import { describe, expect, test } from "bun:test";

import {
  DOMAIN_EVENT_CONSUMERS,
  getConsumerByName,
  getConsumersForEventType
} from "../src/modules/domain-event-runtime/infrastructure/consumer-registry";
import { SAMPLE_RECORDED_EVENT_TYPE } from "../src/modules/domain-event-runtime/domain/event-type-registry";

describe("DOMAIN_EVENT_CONSUMERS static registry", () => {
  test("ships at least two representative consumers", () => {
    expect(DOMAIN_EVENT_CONSUMERS.length).toBeGreaterThanOrEqual(2);
  });

  test("every consumer name is unique", () => {
    const names = DOMAIN_EVENT_CONSUMERS.map((consumer) => consumer.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("every consumer declares at least one event type and one event version", () => {
    for (const consumer of DOMAIN_EVENT_CONSUMERS) {
      expect(consumer.eventTypes.length).toBeGreaterThan(0);
      expect(consumer.eventVersions.length).toBeGreaterThan(0);
    }
  });

  test("every consumer has a non-empty description", () => {
    for (const consumer of DOMAIN_EVENT_CONSUMERS) {
      expect(consumer.description.length).toBeGreaterThan(0);
    }
  });

  test("getConsumersForEventType returns every consumer subscribed to the sample reference event", () => {
    const declaredSubscribers = DOMAIN_EVENT_CONSUMERS.filter((consumer) =>
      consumer.eventTypes.includes(SAMPLE_RECORDED_EVENT_TYPE)
    );
    const matched = getConsumersForEventType(SAMPLE_RECORDED_EVENT_TYPE);
    expect(matched.length).toBe(declaredSubscribers.length);
    expect(matched.length).toBeGreaterThanOrEqual(2);
  });

  test("getConsumersForEventType returns an empty array for an unregistered event type", () => {
    expect(getConsumersForEventType("awcms.nonexistent.thing")).toEqual([]);
  });

  test("getConsumerByName resolves a known consumer and returns undefined for an unknown one", () => {
    const first = DOMAIN_EVENT_CONSUMERS[0]!;
    expect(getConsumerByName(first.name)?.name).toBe(first.name);
    expect(getConsumerByName("not-a-real-consumer")).toBeUndefined();
  });
});
