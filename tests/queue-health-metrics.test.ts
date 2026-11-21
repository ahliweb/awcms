/**
 * Issue #1412 — provider-outage observability for the delivery queues.
 *
 * Drives the recorder against a fake `Bun.SQL` (the same "implement just the
 * calls the code under test makes" approach as `email-dispatch-lease.test.ts`)
 * and the in-memory metrics port. The real-PostgreSQL probe SQL is covered by
 * `tests/integration/queue-health.integration.test.ts`.
 *
 * What it proves: the four new metrics carry ONLY the bounded `queue` label
 * (a tenant id handed in is dropped, not forwarded); one run over several
 * tenants records a cross-tenant aggregate (sum / max) instead of letting the
 * last tenant overwrite the gauge; a failed probe never throws and never
 * reports a false all-clear zero; and the domain-event backlog gauges now
 * aggregate the same way.
 */
import { afterEach, describe, expect, test } from "bun:test";

import { createInMemoryMetricsPort } from "../src/lib/observability/in-memory-metrics-port";
import {
  METRIC_DEFINITIONS,
  recordCounter,
  resetMetricsPortForTests,
  setMetricsPort
} from "../src/lib/observability/metrics-port";
import {
  DELIVERY_QUEUES,
  createQueueHealthRecorder,
  formatQueueHealthLine,
  mergeQueueHealth
} from "../src/lib/observability/queue-health";
import {
  flushDomainEventBacklogGauges,
  foldDomainEventBacklogRows,
  type DomainEventBacklogAggregate
} from "../src/modules/domain-event-runtime/application/dispatch-domain-events";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const NEW_METRICS = [
  "queue_pending_count",
  "queue_oldest_due_age_seconds",
  "queue_expired_lease_count",
  "queue_uncertain_outcome_total"
] as const;

function createFakeSql(): Bun.SQL {
  const run = () => Promise.resolve([]);

  run.unsafe = () => Promise.resolve([]);
  run.array = (values: unknown[], type: string) => ({ values, type });
  run.begin = (callback: (tx: Bun.TransactionSQL) => Promise<unknown>) =>
    callback(run as unknown as Bun.TransactionSQL);

  return run as unknown as Bun.SQL;
}

function rowFor(pending: number, age: number, leases: number) {
  return [
    {
      pending,
      oldest_due_age_seconds: age,
      expired_leases: leases
    }
  ];
}

afterEach(() => {
  resetMetricsPortForTests();
});

describe("new queue metrics are bounded (Issue #1412)", () => {
  test("each carries only the `queue` label, with a privacy note", () => {
    for (const name of NEW_METRICS) {
      const definition = METRIC_DEFINITIONS[name];

      expect([...definition.allowedLabelKeys]).toEqual(["queue"]);
      expect(definition.privacyNote.length).toBeGreaterThan(20);
    }
  });

  test("a tenant id or free-text label handed to a new metric is dropped before the adapter sees it", () => {
    const port = createInMemoryMetricsPort();

    setMetricsPort(port);
    recordCounter(
      "queue_uncertain_outcome_total",
      { queue: "email", tenantId: TENANT_A, recipient: "user@example.test" },
      2
    );

    expect(port.getSnapshot().counters).toEqual({
      "queue_uncertain_outcome_total{queue=email}": 2
    });
  });

  test("the queue label values are a small fixed set, none shaped like an id", () => {
    expect(DELIVERY_QUEUES.length).toBeLessThanOrEqual(8);

    for (const queue of DELIVERY_QUEUES) {
      expect(queue).toMatch(/^[a-z_]+$/);
    }
  });
});

describe("queue health recorder (Issue #1412)", () => {
  test("mergeQueueHealth adds depth and leases, and keeps the WORST age", () => {
    expect(
      mergeQueueHealth(
        { pending: 3, oldestDueAgeSeconds: 40, expiredLeases: 1 },
        { pending: 2, oldestDueAgeSeconds: 900, expiredLeases: 0 }
      )
    ).toEqual({ pending: 5, oldestDueAgeSeconds: 900, expiredLeases: 1 });
  });

  test("two tenants record ONE aggregate, not whichever ran last", async () => {
    const port = createInMemoryMetricsPort();

    setMetricsPort(port);

    const results = new Map([
      [TENANT_A, rowFor(4, 1200, 0)],
      [TENANT_B, rowFor(1, 30, 2)]
    ]);
    const recorder = createQueueHealthRecorder("email", (_tx, tenantId) =>
      Promise.resolve(results.get(tenantId))
    );
    const sql = createFakeSql();

    await recorder.observeTenant(sql, TENANT_A);
    await recorder.observeTenant(sql, TENANT_B);

    expect(recorder.flush()).toEqual({
      pending: 5,
      oldestDueAgeSeconds: 1200,
      expiredLeases: 2
    });

    const { gauges } = port.getSnapshot();

    expect(gauges["queue_pending_count{queue=email}"]).toBe(5);
    expect(gauges["queue_oldest_due_age_seconds{queue=email}"]).toBe(1200);
    expect(gauges["queue_expired_lease_count{queue=email}"]).toBe(2);

    // No series key carries a tenant id.
    for (const key of Object.keys(gauges)) {
      expect(key).not.toContain(TENANT_A);
      expect(key).not.toContain(TENANT_B);
    }
  });

  test("a failed probe never throws and never reports a false all-clear zero", async () => {
    const port = createInMemoryMetricsPort();

    setMetricsPort(port);

    const recorder = createQueueHealthRecorder("push", () =>
      Promise.reject(new Error("permission denied for table"))
    );

    await recorder.observeTenant(createFakeSql(), TENANT_A);

    expect(recorder.flush()).toBeNull();
    expect(
      Object.keys(port.getSnapshot().gauges).filter((key) =>
        key.startsWith("queue_")
      )
    ).toEqual([]);
  });

  test("one failing tenant does not hide the others", async () => {
    const port = createInMemoryMetricsPort();

    setMetricsPort(port);

    const recorder = createQueueHealthRecorder("whatsapp", (_tx, tenantId) =>
      tenantId === TENANT_A
        ? Promise.reject(new Error("boom"))
        : Promise.resolve(rowFor(7, 61, 0))
    );
    const sql = createFakeSql();

    await recorder.observeTenant(sql, TENANT_A);
    await recorder.observeTenant(sql, TENANT_B);
    recorder.flush();

    expect(
      port.getSnapshot().gauges["queue_pending_count{queue=whatsapp}"]
    ).toBe(7);
  });

  test("null / string aggregates from the driver are coerced to non-negative integers", async () => {
    const port = createInMemoryMetricsPort();

    setMetricsPort(port);

    const recorder = createQueueHealthRecorder("telegram", () =>
      Promise.resolve([
        { pending: "3", oldest_due_age_seconds: null, expired_leases: "-1" }
      ])
    );

    await recorder.observeTenant(createFakeSql(), TENANT_A);

    expect(recorder.flush()).toEqual({
      pending: 3,
      oldestDueAgeSeconds: 0,
      expiredLeases: 0
    });
  });
});

describe("queue health job-log line (Issue #1412)", () => {
  test("the line shape the runbook greps is fixed and carries counts only", () => {
    const line = formatQueueHealthLine("email:dispatch", {
      pending: 12,
      oldestDueAgeSeconds: 1800,
      expiredLeases: 1
    });

    expect(line).toBe(
      "email:dispatch queue — pending=12 oldestDueAgeSeconds=1800 expiredLeases=1"
    );
    expect(line).toMatch(
      /^[a-z:]+ queue — pending=\d+ oldestDueAgeSeconds=\d+ expiredLeases=\d+$/
    );
  });

  test("every lease-based dispatcher script records and prints the line, and none passes a tenant id to it", async () => {
    const scripts = [
      ["email-dispatch.ts", "email"],
      ["whatsapp-dispatch.ts", "whatsapp"],
      ["telegram-dispatch.ts", "telegram"],
      ["push-dispatch.ts", "push"],
      ["object-sync-dispatch.ts", "object_sync"]
    ] as const;

    for (const [file, queue] of scripts) {
      const source = await Bun.file(
        new URL(`../scripts/${file}`, import.meta.url)
      ).text();

      expect(source).toContain(`createQueueHealthRecorder("${queue}")`);
      expect(source).toContain("formatQueueHealthLine(");
      expect(source).toContain("queueHealth.flush()");
    }
  });
});

describe("domain-event backlog gauges aggregate across tenants (Issue #1412)", () => {
  test("a lagging tenant in the middle of the loop is not overwritten by a healthy last one", () => {
    const port = createInMemoryMetricsPort();

    setMetricsPort(port);

    const aggregate: DomainEventBacklogAggregate = new Map();

    foldDomainEventBacklogRows(aggregate, [
      {
        consumer_name: "reporting",
        status: "pending",
        row_count: 50,
        oldest_age_seconds: 3600
      },
      {
        consumer_name: "reporting",
        status: "dead_letter",
        row_count: 2,
        oldest_age_seconds: 9000
      }
    ]);
    // The "last tenant" is healthy: one fresh pending row.
    foldDomainEventBacklogRows(aggregate, [
      {
        consumer_name: "reporting",
        status: "pending",
        row_count: 1,
        oldest_age_seconds: 2
      }
    ]);
    flushDomainEventBacklogGauges(aggregate);

    const { gauges } = port.getSnapshot();

    expect(
      gauges[
        "domain_event_delivery_backlog{consumerName=reporting,status=pending}"
      ]
    ).toBe(51);
    expect(
      gauges[
        "domain_event_delivery_backlog{consumerName=reporting,status=dead_letter}"
      ]
    ).toBe(2);
    expect(
      gauges[
        "domain_event_delivery_oldest_pending_seconds{consumerName=reporting}"
      ]
    ).toBe(3600);
  });
});
