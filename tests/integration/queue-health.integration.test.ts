/**
 * Delivery-queue health probes against a real PostgreSQL, as the
 * least-privilege `awcms_worker` role (Issue #1412).
 *
 * The unit test proves aggregation and label bounds against a fake; this proves
 * the probe SQL itself: it counts only waiting rows, ages only OVERDUE rows (a
 * `retry_wait` row backing off into the future is waiting, not stuck), counts
 * only expired leases, ignores terminal rows, is tenant-scoped under RLS, and
 * is readable by the worker role the dispatchers run as.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
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
  getWorkerRoleSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
  workerRoleActivated
} from "./harness";
import { createInMemoryMetricsPort } from "../../src/lib/observability/in-memory-metrics-port";
import {
  resetMetricsPortForTests,
  setMetricsPort
} from "../../src/lib/observability/metrics-port";
import { createQueueHealthRecorder } from "../../src/lib/observability/queue-health";

const TENANT = "14120000-0000-4000-8000-000000000001";
const OTHER_TENANT = "14120000-0000-4000-8000-000000000002";

const admin = () => getAdminSql();

async function seedTenants(): Promise<void> {
  await admin()`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT}, 'q1412a', 'q1412a'), (${OTHER_TENANT}, 'q1412b', 'q1412b')
  `;
}

async function seedEmail(
  tenantId: string,
  status: string,
  nextAttemptSql: "null" | "past_10m" | "past_1h" | "future_1h"
): Promise<void> {
  const next = {
    null: null,
    past_10m: new Date(Date.now() - 10 * 60_000),
    past_1h: new Date(Date.now() - 60 * 60_000),
    future_1h: new Date(Date.now() + 60 * 60_000)
  }[nextAttemptSql];

  await admin()`
    INSERT INTO awcms_email_messages
      (tenant_id, category, to_address, to_address_hash, to_address_masked,
       subject, status, next_attempt_at, created_at)
    VALUES (${tenantId}, 'auth.password_reset', 'user@example.test',
            ${"h".repeat(64)}, 'u***@example.test', 'Subject', ${status},
            ${next}, now() - interval '2 hours')
  `;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("delivery queue health probes against PostgreSQL (Issue #1412)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    resetMetricsPortForTests();
    await resetDatabase();
    await seedTenants();
  });

  test("email: counts waiting rows, ages only the overdue one, counts the expired lease, ignores terminal and future rows and other tenants", async () => {
    if (!workerRoleActivated) return;

    const port = createInMemoryMetricsPort();

    setMetricsPort(port);

    // Waiting and overdue 1h: the oldest due row.
    await seedEmail(TENANT, "retry_wait", "past_1h");
    // Waiting and overdue 10m.
    await seedEmail(TENANT, "queued", "past_10m");
    // Waiting but NOT due yet: counted as pending, never as age.
    await seedEmail(TENANT, "retry_wait", "future_1h");
    // Never scheduled: due now, aged from its creation (2h).
    await seedEmail(TENANT, "queued", "null");
    // Lease expired 10m ago: a stuck worker.
    await seedEmail(TENANT, "sending", "past_10m");
    // Lease still held: not stuck.
    await seedEmail(TENANT, "sending", "future_1h");
    // Terminal: invisible to the probe.
    await seedEmail(TENANT, "failed", "past_1h");
    await seedEmail(TENANT, "sent", "past_1h");
    // Another tenant's rows must not leak into this tenant's numbers.
    await seedEmail(OTHER_TENANT, "queued", "past_1h");

    const recorder = createQueueHealthRecorder("email");

    await recorder.observeTenant(getWorkerRoleSql(), TENANT);

    const snapshot = recorder.flush();

    expect(snapshot).not.toBeNull();
    expect(snapshot!.pending).toBe(4);
    // The never-scheduled row (created 2h ago) is the oldest due row.
    expect(snapshot!.oldestDueAgeSeconds).toBeGreaterThanOrEqual(2 * 3600 - 5);
    expect(snapshot!.oldestDueAgeSeconds).toBeLessThan(2 * 3600 + 120);
    expect(snapshot!.expiredLeases).toBe(1);

    expect(
      port.getSnapshot().gauges["queue_expired_lease_count{queue=email}"]
    ).toBe(1);
  });

  test("an empty queue records zeros, not nothing (the probe succeeded and found the queue healthy)", async () => {
    if (!workerRoleActivated) return;

    const recorder = createQueueHealthRecorder("whatsapp");

    await recorder.observeTenant(getWorkerRoleSql(), TENANT);

    expect(recorder.flush()).toEqual({
      pending: 0,
      oldestDueAgeSeconds: 0,
      expiredLeases: 0
    });
  });

  test("every probe parses and the worker role may run it (push, telegram, whatsapp, object_sync)", async () => {
    if (!workerRoleActivated) return;

    for (const queue of [
      "push",
      "telegram",
      "whatsapp",
      "object_sync"
    ] as const) {
      const recorder = createQueueHealthRecorder(queue);

      await recorder.observeTenant(getWorkerRoleSql(), TENANT);

      // A permission or syntax error is swallowed by the recorder and would
      // leave this null, so a null here IS the failure.
      expect(recorder.flush()).toEqual({
        pending: 0,
        oldestDueAgeSeconds: 0,
        expiredLeases: 0
      });
    }
  });
});
