/**
 * No module may subscribe to an event its producer publishes under a database
 * role that cannot write `awcms_domain_event_deliveries` (the #1275 audit, L-6).
 *
 * `appendDomainEvent` writes one delivery row per subscribed consumer IN THE
 * PRODUCER'S TRANSACTION. The customer bot dispatcher
 * (`awcms_telegram_engagement_dispatch`) and the social publisher
 * (`awcms_social_dispatch`) hold no delivery INSERT, on purpose (sql/373,
 * sql/374: the #1271 audit, M1, a delivery INSERT let a role forge another
 * module's delivery). A subscription to one of their events therefore fails the
 * producer with "permission denied": a blocked bot's consent would never be
 * recorded. It happened once, in the first version of #1164, and was caught
 * only by an integration suite; this pins it for every module, without a
 * database.
 *
 * The list is anchored to the migrations: each event type must still be one
 * the named restrictive policy lets that role insert or read, and the role must
 * still hold no delivery grant, so the list cannot rot silently.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { listModules } from "../src/modules/index";

const SQL_DIR = join(import.meta.dir, "..", "sql");

const PRODUCED_UNDER_DELIVERY_LESS_ROLES: {
  role: string;
  migration: string;
  eventTypes: string[];
}[] = [
  {
    role: "awcms_telegram_engagement_dispatch",
    migration: "374_awcms_telegram_dispatch_outbox_bounds.sql",
    eventTypes: ["awcms.telegram_engagement.consent.changed"]
  },
  {
    role: "awcms_social_dispatch",
    migration: "373_awcms_social_dispatch_runtime_grants.sql",
    eventTypes: [
      "awcms.social_publishing.job.published",
      "awcms.social_publishing.job.failed"
    ]
  }
];

describe("descriptor consumers vs delivery-less producer roles (#1275 L-6)", () => {
  for (const entry of PRODUCED_UNDER_DELIVERY_LESS_ROLES) {
    test(`${entry.role}: the migration still names these events and grants no delivery INSERT`, () => {
      const text = readFileSync(join(SQL_DIR, entry.migration), "utf8");

      for (const eventType of entry.eventTypes) {
        expect(text).toContain(`'${eventType}'`);
      }

      expect(text).toContain(`TO ${entry.role}`);
      expect(
        new RegExp(
          `GRANT[^;]*INSERT[^;]*ON\\s+awcms_domain_event_deliveries[^;]*TO\\s+${entry.role}`,
          "i"
        ).test(text)
      ).toBe(false);
    });
  }

  test("no module's domain-event consumer subscribes to one of them", () => {
    const forbidden = new Set(
      PRODUCED_UNDER_DELIVERY_LESS_ROLES.flatMap((entry) => entry.eventTypes)
    );
    const offenders: string[] = [];

    for (const module of listModules()) {
      for (const consumer of module.domainEventConsumers ?? []) {
        for (const eventType of consumer.eventTypes) {
          if (forbidden.has(eventType)) {
            offenders.push(`${consumer.name} -> ${eventType}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
