/**
 * Issue #698 (epic #679, "operational proof" wave) — proves
 * `acquireWorkClassSlot`/slot release mirror `gates[workClass]`'s
 * active/queued counts into `db_pool_work_class_active`/
 * `db_pool_work_class_queued` gauges, without changing
 * `getWorkClassSaturation`'s own existing behavior (covered separately by
 * `tests/database-pooling.test.ts`).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  acquireWorkClassSlot,
  resetWorkClassGatesForTests,
  WorkClassQueueFullError
} from "../src/lib/database/work-class";
import { createInMemoryMetricsPort } from "../src/lib/observability/in-memory-metrics-port";
import {
  resetMetricsPortForTests,
  setMetricsPort
} from "../src/lib/observability/metrics-port";

describe("work-class pool gauges (Issue #698)", () => {
  beforeEach(() => {
    resetWorkClassGatesForTests();
  });

  afterEach(() => {
    resetWorkClassGatesForTests();
    resetMetricsPortForTests();
  });

  test("acquiring a slot sets db_pool_work_class_active to the new active count", async () => {
    const port = createInMemoryMetricsPort();
    setMetricsPort(port);

    const slot = await acquireWorkClassSlot("maintenance", 50);

    expect(
      port.getSnapshot().gauges[
        "db_pool_work_class_active{workClass=maintenance}"
      ]
    ).toBe(1);
    expect(
      port.getSnapshot().gauges[
        "db_pool_work_class_queued{workClass=maintenance}"
      ]
    ).toBe(0);

    slot.release();
  });

  test("releasing a slot brings db_pool_work_class_active back down", async () => {
    const port = createInMemoryMetricsPort();
    setMetricsPort(port);

    const slot = await acquireWorkClassSlot("maintenance", 50);
    slot.release();

    expect(
      port.getSnapshot().gauges[
        "db_pool_work_class_active{workClass=maintenance}"
      ]
    ).toBe(0);
  });

  test("a queued waiter is reflected in db_pool_work_class_queued", async () => {
    const port = createInMemoryMetricsPort();
    setMetricsPort(port);

    const first = await acquireWorkClassSlot("maintenance", 200);
    const secondPromise = acquireWorkClassSlot("maintenance", 200);
    await Promise.resolve();

    expect(
      port.getSnapshot().gauges[
        "db_pool_work_class_queued{workClass=maintenance}"
      ]
    ).toBe(1);

    first.release();
    const second = await secondPromise;
    second.release();
  });
});

// Issue #743 — bounded-queue rejection counter and queued-caller wait-time
// histogram, added alongside the existing active/queued gauges above.
describe("work-class rejection/wait-time metrics (Issue #743)", () => {
  beforeEach(() => {
    resetWorkClassGatesForTests();
  });

  afterEach(() => {
    resetWorkClassGatesForTests();
    resetMetricsPortForTests();
  });

  test("an immediate (non-queued) acquisition does NOT record a wait_ms observation", async () => {
    const port = createInMemoryMetricsPort();
    setMetricsPort(port);

    const slot = await acquireWorkClassSlot("maintenance", 50);

    expect(port.getSnapshot().histograms).toEqual({});

    slot.release();
  });

  test("a caller that queues and then acquires records db_pool_work_class_wait_ms with outcome=acquired", async () => {
    const port = createInMemoryMetricsPort();
    setMetricsPort(port);

    const first = await acquireWorkClassSlot("maintenance", 500);
    const secondPromise = acquireWorkClassSlot("maintenance", 500);
    await Promise.resolve();

    first.release();
    const second = await secondPromise;

    const histogram =
      port.getSnapshot().histograms[
        "db_pool_work_class_wait_ms{outcome=acquired,workClass=maintenance}"
      ];
    expect(histogram?.count).toBe(1);
    expect(histogram?.sum).toBeGreaterThanOrEqual(0);

    second.release();
  });

  test("a caller that queues and then times out records db_pool_work_class_wait_ms with outcome=timeout", async () => {
    const port = createInMemoryMetricsPort();
    setMetricsPort(port);

    const first = await acquireWorkClassSlot("maintenance", 500);

    await expect(
      acquireWorkClassSlot("maintenance", 20)
    ).rejects.toBeInstanceOf(Error);

    const histogram =
      port.getSnapshot().histograms[
        "db_pool_work_class_wait_ms{outcome=timeout,workClass=maintenance}"
      ];
    expect(histogram?.count).toBe(1);

    first.release();
  });

  test("a rejection (queue already full) increments db_pool_work_class_rejected_total, not the wait-time histogram", async () => {
    const port = createInMemoryMetricsPort();
    setMetricsPort(port);

    const active = await acquireWorkClassSlot("maintenance", 500);
    const queued = [
      acquireWorkClassSlot("maintenance", 500),
      acquireWorkClassSlot("maintenance", 500),
      acquireWorkClassSlot("maintenance", 500),
      acquireWorkClassSlot("maintenance", 500)
    ];
    await Promise.resolve();

    await expect(
      acquireWorkClassSlot("maintenance", 500)
    ).rejects.toBeInstanceOf(WorkClassQueueFullError);

    expect(
      port.getSnapshot().counters[
        "db_pool_work_class_rejected_total{workClass=maintenance}"
      ]
    ).toBe(1);
    // The rejected caller never queued, so it must not appear in the
    // wait-time histogram under any outcome.
    expect(
      port.getSnapshot().histograms[
        "db_pool_work_class_wait_ms{outcome=acquired,workClass=maintenance}"
      ]
    ).toBeUndefined();

    active.release();
    for (const promise of queued) {
      (await promise).release();
    }
  });
});
