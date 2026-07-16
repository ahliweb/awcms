import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "bun:test";
import { parse } from "yaml";

import { DOMAIN_EVENT_CONSUMERS } from "../src/modules/domain-event-runtime/infrastructure/consumer-registry";
import { DOMAIN_EVENT_TYPE_REGISTRY } from "../src/modules/domain-event-runtime/domain/event-type-registry";
import {
  isValidEventType,
  isValidEventVersion
} from "../src/modules/domain-event-runtime/domain/envelope";
import { listModules } from "../src/modules/index";
import { domainEventRuntimeModule } from "../src/modules/domain-event-runtime/module";

/**
 * Bidirectional parity between the runtime's own code-level registries and
 * the published AsyncAPI contract ("runtime registry and AsyncAPI event
 * types/versions pass bidirectional parity checks").
 *
 * Direction 1 (registry -> AsyncAPI): every `DOMAIN_EVENT_TYPE_REGISTRY`
 * entry must have a matching AsyncAPI channel.
 *
 * Direction 2 (AsyncAPI -> registry, scoped): every event type any
 * registered CONSUMER subscribes to must be present in
 * `DOMAIN_EVENT_TYPE_REGISTRY`.
 */

async function loadAsyncApiChannels(): Promise<Record<string, unknown>> {
  const filePath = path.join(
    import.meta.dir,
    "../asyncapi/awcms-domain-events.asyncapi.yaml"
  );
  const source = await readFile(filePath, "utf8");
  const document = parse(source) as { channels?: Record<string, unknown> };

  return document.channels ?? {};
}

describe("domain-event-runtime registry <-> AsyncAPI parity", () => {
  test("every DOMAIN_EVENT_TYPE_REGISTRY entry has a matching AsyncAPI channel", async () => {
    const channels = await loadAsyncApiChannels();

    for (const entry of DOMAIN_EVENT_TYPE_REGISTRY) {
      expect(channels[entry.eventType]).toBeDefined();
    }
  });

  test("every consumer's subscribed event type is present in DOMAIN_EVENT_TYPE_REGISTRY", () => {
    const registeredTypes = new Set(
      DOMAIN_EVENT_TYPE_REGISTRY.map((entry) => entry.eventType)
    );

    for (const consumer of DOMAIN_EVENT_CONSUMERS) {
      for (const eventType of consumer.eventTypes) {
        expect(registeredTypes.has(eventType)).toBe(true);
      }
    }
  });

  test("module.ts's events.publishes includes every domain_event_runtime-OWNED DOMAIN_EVENT_TYPE_REGISTRY entry", () => {
    const publishes = new Set(domainEventRuntimeModule.events?.publishes ?? []);
    const ownedEntries = DOMAIN_EVENT_TYPE_REGISTRY.filter((entry) =>
      entry.eventType.startsWith("awcms.domain-event-runtime.")
    );

    expect(ownedEntries.length).toBeGreaterThan(0);

    for (const entry of ownedEntries) {
      expect(publishes.has(entry.eventType)).toBe(true);
    }
  });

  test("every DOMAIN_EVENT_TYPE_REGISTRY entry is published by SOME module's module.ts", () => {
    const allPublishedEventTypes = new Set(
      listModules().flatMap((module) => module.events?.publishes ?? [])
    );

    for (const entry of DOMAIN_EVENT_TYPE_REGISTRY) {
      expect(allPublishedEventTypes.has(entry.eventType)).toBe(true);
    }
  });

  test("every DOMAIN_EVENT_TYPE_REGISTRY entry has a well-formed event type and version", () => {
    for (const entry of DOMAIN_EVENT_TYPE_REGISTRY) {
      expect(isValidEventType(entry.eventType)).toBe(true);
      expect(isValidEventVersion(entry.eventVersion)).toBe(true);
    }
  });

  test("no two DOMAIN_EVENT_TYPE_REGISTRY entries share the same (eventType, eventVersion) pair", () => {
    const seen = new Set<string>();

    for (const entry of DOMAIN_EVENT_TYPE_REGISTRY) {
      const key = `${entry.eventType}@${entry.eventVersion}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});
