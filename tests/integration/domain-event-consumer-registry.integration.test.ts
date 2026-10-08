/**
 * Descriptor-declared consumers end to end against a real PostgreSQL
 * (ADR-0134, Issue #918): publish -> fan-out -> dispatch -> effect ledger, and
 * the redelivery case the registry's wrapper exists for.
 *
 * Proves what a unit test cannot: that moving the three consumers into their
 * modules' descriptors changed neither their names (the effect ledger and the
 * delivery rows are keyed by them) nor their at-most-once effect under a
 * redelivered event.
 *
 * Skipped entirely unless `DATABASE_URL` is set (see harness.ts §Gating).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import {
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { appendDomainEvent } from "../../src/modules/domain-event-runtime/application/append-domain-event";
import { dispatchDomainEventsForTenant } from "../../src/modules/domain-event-runtime/application/dispatch-domain-events";
import {
  SAMPLE_RECORDED_EVENT_TYPE,
  SAMPLE_RECORDED_EVENT_VERSION
} from "../../src/modules/domain-event-runtime/domain/event-type-registry";
import { getProjectionMetrics } from "../../src/modules/reporting/application/projection-metric-store";
import {
  EVENT_ACTIVITY_METRIC_KEYS,
  EVENT_ACTIVITY_SUMMARY_PROJECTION_KEY
} from "../../src/modules/reporting/domain/projection-keys";

const TENANT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const NAMES = [
  "domain_event_runtime.activity_rollup_projector",
  "logging.sample_event_audit_projector",
  "reporting.event_activity_projector"
];

const suite = integrationEnabled ? describe : describe.skip;

async function effectNames(): Promise<string[]> {
  const rows = (await getAdminSql()`
    SELECT consumer_name FROM awcms_domain_event_consumer_effects
    WHERE tenant_id = ${TENANT} ORDER BY consumer_name
  `) as { consumer_name: string }[];

  return rows.map((row) => row.consumer_name);
}

async function sampleMetric(): Promise<number> {
  const metrics = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
    getProjectionMetrics(tx, TENANT, EVENT_ACTIVITY_SUMMARY_PROJECTION_KEY)
  );

  return metrics[EVENT_ACTIVITY_METRIC_KEYS.sampleRecordedCount] ?? 0;
}

suite("descriptor-declared domain-event consumers (ADR-0134)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await getAdminSql()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${TENANT}, 'consumer-reg', 'Consumer Registry')
    `;
  });

  test("a published event fans out to all three declared consumers under their unchanged names, and each runs once", async () => {
    const appended = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      appendDomainEvent(tx, TENANT, {
        eventType: SAMPLE_RECORDED_EVENT_TYPE,
        eventVersion: SAMPLE_RECORDED_EVENT_VERSION,
        aggregateType: "sample",
        aggregateId: crypto.randomUUID(),
        producerModule: "domain_event_runtime",
        payload: { note: "registry" }
      })
    );
    expect(appended.deliveriesCreated).toBe(3);

    const pass = await dispatchDomainEventsForTenant(getRuntimeSql(), TENANT);
    expect(pass.delivered).toBe(3);
    expect(pass.deadLettered).toBe(0);
    expect(await effectNames()).toEqual(NAMES);
    expect(await sampleMetric()).toBe(1);

    const [rollup] = (await getAdminSql()`
      SELECT event_count FROM awcms_domain_event_activity_daily
      WHERE tenant_id = ${TENANT}
    `) as { event_count: number }[];
    expect(Number(rollup!.event_count)).toBe(1);
  });

  test("a redelivered event does not run any effect twice", async () => {
    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      appendDomainEvent(tx, TENANT, {
        eventType: SAMPLE_RECORDED_EVENT_TYPE,
        eventVersion: SAMPLE_RECORDED_EVENT_VERSION,
        aggregateType: "sample",
        aggregateId: crypto.randomUUID(),
        producerModule: "domain_event_runtime",
        payload: { note: "redelivery" }
      })
    );
    await dispatchDomainEventsForTenant(getRuntimeSql(), TENANT);

    // The crash-after-handler-before-finalize case: delivery back to pending,
    // effect markers still committed.
    await getAdminSql()`
      UPDATE awcms_domain_event_deliveries
      SET status = 'pending', next_attempt_at = now() - interval '1 second'
      WHERE tenant_id = ${TENANT}
    `;
    const second = await dispatchDomainEventsForTenant(getRuntimeSql(), TENANT);

    expect(second.delivered).toBe(3);
    expect(await effectNames()).toEqual(NAMES);
    expect(await sampleMetric()).toBe(1);

    const [rollup] = (await getAdminSql()`
      SELECT event_count FROM awcms_domain_event_activity_daily
      WHERE tenant_id = ${TENANT}
    `) as { event_count: number }[];
    expect(Number(rollup!.event_count)).toBe(1);
  });
});
