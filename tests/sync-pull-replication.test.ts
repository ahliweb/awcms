/**
 * `POST /api/v1/sync/pull` after the second outbox was retired (ADR-0077,
 * Issue #477).
 *
 * The endpoint's OBSERVABLE behaviour is unchanged — it answered with an empty
 * event list before and it answers with one now. That is precisely why this
 * file asserts against the SOURCE rather than the response: a test that only
 * checked "returns []" would have passed identically against the table that
 * never worked, which is the whole defect it is supposed to guard.
 *
 * Pure: no database, no network.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  isReplicableToSyncNodes,
  SYNC_REPLICABLE_EVENT_TYPES,
  syncReplicationIsDisabled
} from "../src/modules/sync-storage/domain/sync-replication";
import { DOMAIN_EVENT_TYPE_REGISTRY } from "../src/modules/domain-event-runtime/domain/event-type-registry";

const ROUTE = readFileSync("src/pages/api/v1/sync/pull.ts", "utf8");

describe("the allow-list ships empty, and empty means no query at all", () => {
  test("nothing is replicable yet", () => {
    // Not a placeholder assertion. Adding an entry here without the payload
    // projection and the commit-visibility fix ships silent, permanent event
    // loss for every node — so the emptiness is the safety property, and this
    // is the test that has to be argued with before it changes.
    expect(SYNC_REPLICABLE_EVENT_TYPES).toEqual([]);
    expect(syncReplicationIsDisabled()).toBe(true);
    expect(
      isReplicableToSyncNodes("awcms.domain-event-runtime.sample.recorded")
    ).toBe(false);
  });

  test("the route short-circuits on it instead of running an empty-predicate scan", () => {
    // `event_type = ANY('{}')` matches nothing and would be correct — and it
    // would also leave a cursor scan over `awcms_domain_events` sitting in the
    // route, which reads as "replication works". The short-circuit keeps the
    // code and the policy saying the same thing.
    expect(ROUTE).toContain("syncReplicationIsDisabled()");
    expect(ROUTE.indexOf("syncReplicationIsDisabled()")).toBeLessThan(
      ROUTE.indexOf("FROM awcms_domain_events")
    );
  });
});

describe("the source really moved", () => {
  test("the route reads awcms_domain_events and no longer names the retired table", () => {
    expect(ROUTE).toContain("FROM awcms_domain_events");
    expect(ROUTE).not.toContain("awcms_sync_outbox");
  });

  test("it cursors on event_sequence, the column that replaces the old one", () => {
    // `awcms_sync_outbox.sequence` and `awcms_domain_events.event_sequence` are
    // both `bigint GENERATED ALWAYS AS IDENTITY`, so `last_pull_sequence` needs
    // no migration — and every node still holds 0, because the old query could
    // never advance it.
    expect(ROUTE).toContain("event_sequence > ${sinceSequence}");
    expect(ROUTE).toContain("ORDER BY event_sequence ASC");
  });

  test("the tenant predicate is still there — the cursor is not tenant-global", () => {
    expect(ROUTE).toContain("WHERE tenant_id = ${tenantId}");
  });

  test("the cursor index this query needs is created by the retiring migration", () => {
    const migration = readFileSync(
      "sql/099_awcms_sync_outbox_retire.sql",
      "utf8"
    );

    expect(migration).toContain("awcms_domain_events_tenant_sequence_idx");
    expect(migration).toContain("(tenant_id, event_sequence)");
  });
});

describe("the migration refuses rather than destroys", () => {
  const migration = readFileSync(
    "sql/099_awcms_sync_outbox_retire.sql",
    "utf8"
  );

  test("it counts rows before dropping and raises if it finds any", () => {
    // The table is provably empty in this codebase. "Provably" covers what the
    // code does, not what somebody once ran by hand against production — and
    // those rows would be the only evidence of whatever put them there.
    expect(migration).toContain("RAISE EXCEPTION");
    // Matched against the STATEMENT, not the word: the file's own comment
    // discusses `DROP TABLE`, and matching prose would make this pass on a
    // migration that dropped first and checked afterwards.
    expect(migration.indexOf("RAISE EXCEPTION")).toBeLessThan(
      migration.indexOf("DROP TABLE IF EXISTS awcms_sync_outbox;")
    );
  });

  test("it is idempotent", () => {
    expect(migration).toContain(
      "to_regclass('public.awcms_sync_outbox') IS NULL"
    );
    expect(migration).toContain("DROP TABLE IF EXISTS");
  });
});

describe("an entry would have to be a registered event type", () => {
  test("every allow-listed type exists in the domain-event registry", () => {
    // Vacuous today, and deliberately kept: the first entry added here is the
    // one most likely to be a typo, and a typo would silently replicate
    // nothing while looking configured.
    const registered = new Set(
      DOMAIN_EVENT_TYPE_REGISTRY.map((entry) => entry.eventType)
    );

    for (const eventType of SYNC_REPLICABLE_EVENT_TYPES) {
      expect(registered.has(eventType)).toBe(true);
    }
  });
});
