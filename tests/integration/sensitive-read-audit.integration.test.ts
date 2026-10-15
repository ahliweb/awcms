/**
 * `recordSensitiveRead` against a real database (Issue #978, PS-18 (a)).
 *
 * The properties that matter are the ones a unit test over text cannot show:
 *
 * - browsing is COALESCED (one opening row, then rows only at decade
 *   milestones), so the log does not flood, while the count stays exact;
 * - the counter is ATOMIC under concurrency (twenty racing first reads are one
 *   opening row and a count of twenty, not twenty rows);
 * - an export is never coalesced;
 * - what is written is ids and counts: an amount, a name or any non-UUID id is
 *   refused and nothing is written, and the failure aborts the caller's
 *   transaction (fail-closed);
 * - the window table is tenant-isolated for the runtime role, and the runtime
 *   role cannot delete from it.
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
  assertRejected,
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import {
  MAX_AUDITED_RESOURCE_IDS,
  recordSensitiveRead,
  type SensitiveReadInput
} from "../../src/modules/logging/application/sensitive-read-audit";

const TENANT = "f9780000-0000-4000-8000-000000000001";
const OTHER_TENANT = "f9780000-0000-4000-8000-000000000002";
const ACTOR = "f9780000-0000-4000-8000-0000000000a1";
const OTHER_ACTOR = "f9780000-0000-4000-8000-0000000000a2";
const EMPLOYMENT_A = "f9780000-0000-4000-8000-0000000000e1";
const EMPLOYMENT_B = "f9780000-0000-4000-8000-0000000000e2";

const COMPENSATION = "hr_payroll.compensation.read";
const T0 = new Date("2026-10-15T08:00:00.000Z");

type AuditRow = {
  actor_tenant_user_id: string;
  module_key: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  severity: string;
  message: string;
  attributes: Record<string, unknown>;
};

async function read(
  overrides: Partial<SensitiveReadInput> = {},
  tenantId = TENANT
) {
  return withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
    recordSensitiveRead(tx, {
      tenantId,
      actorTenantUserId: ACTOR,
      permission: COMPENSATION,
      now: T0,
      ...overrides
    })
  );
}

async function auditRows(): Promise<AuditRow[]> {
  return (await getAdminSql()`
    SELECT actor_tenant_user_id, module_key, action, resource_type, resource_id,
           severity, message, attributes
    FROM awcms_audit_events
    WHERE tenant_id = ${TENANT}
    ORDER BY created_at, id
  `) as AuditRow[];
}

async function windowRows(): Promise<
  { read_count: number; item_count: string; window_start: Date }[]
> {
  return (await getAdminSql()`
    SELECT read_count, item_count, window_start
    FROM awcms_sensitive_read_windows
    WHERE tenant_id = ${TENANT} AND actor_tenant_user_id = ${ACTOR}
  `) as { read_count: number; item_count: string; window_start: Date }[];
}

const suite = integrationEnabled ? describe : describe.skip;

suite("recordSensitiveRead", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    const admin = getAdminSql();

    for (const [id, code] of [
      [TENANT, "sensitive-read"],
      [OTHER_TENANT, "sensitive-read-other"]
    ] as const) {
      await admin`
        INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
        VALUES (${id}, ${code}, ${code})
      `;
    }
  });

  test("the first read opens a window and writes ONE row: actor, kind, ids and counts", async () => {
    const outcome = await read({
      itemCount: 2,
      resourceIds: [EMPLOYMENT_A, EMPLOYMENT_B],
      correlationId: "corr-978"
    });

    expect(outcome).toMatchObject({
      audited: true,
      reason: "window_opened",
      readCount: 1,
      itemCount: 2
    });

    const rows = await auditRows();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_tenant_user_id: ACTOR,
      module_key: "hr_payroll",
      action: "sensitive_read.compensation",
      resource_type: "compensation",
      // Two ids: the row cannot name a single record, so it names none.
      resource_id: null,
      severity: "info",
      message: "Sensitive read recorded: compensation"
    });
    expect(rows[0]!.attributes).toMatchObject({
      permission: COMPENSATION,
      resourceIds: [EMPLOYMENT_A, EMPLOYMENT_B],
      windowReadCount: 1,
      windowItemCount: 2,
      windowSeconds: 300
    });
  });

  test("a single-record read names that record on the row", async () => {
    await read({ itemCount: 1, resourceIds: [EMPLOYMENT_A] });

    expect((await auditRows())[0]!.resource_id).toBe(EMPLOYMENT_A);
  });

  test("browsing within the window is coalesced and the count stays exact", async () => {
    for (let i = 0; i < 9; i += 1) {
      await read({ itemCount: 1 });
    }

    // Nine reads, one audit row - this is what stops a list screen flooding
    // the log.
    expect(await auditRows()).toHaveLength(1);
    expect(await windowRows()).toEqual([
      expect.objectContaining({ read_count: 9, item_count: "9" })
    ]);
  });

  test("the tenth read in a window is a milestone: a second row, at warning, with the running totals", async () => {
    for (let i = 0; i < 9; i += 1) {
      await read({ itemCount: 1 });
    }

    const tenth = await read({ itemCount: 1 });

    expect(tenth).toMatchObject({ audited: true, reason: "milestone" });

    const rows = await auditRows();

    expect(rows).toHaveLength(2);
    expect(rows[1]!.severity).toBe("warning");
    expect(rows[1]!.attributes).toMatchObject({
      reason: "milestone",
      windowReadCount: 10,
      windowItemCount: 10
    });

    // 11..99 add nothing; log growth is logarithmic in reads.
    for (let i = 0; i < 89; i += 1) {
      await read({ itemCount: 1 });
    }

    expect(await auditRows()).toHaveLength(2);

    // The hundredth read (which is also the hundredth record) is the next
    // decade: ONE more row, not two, even though both counters crossed.
    await read({ itemCount: 1 });

    const finalRows = await auditRows();

    expect(finalRows).toHaveLength(3);
    expect(finalRows[2]!.attributes).toMatchObject({ windowReadCount: 100 });
  });

  test("one call that returns a bulk of records is a warning on its own opening row", async () => {
    await read({ itemCount: 150 });

    const rows = await auditRows();

    expect(rows).toHaveLength(1);
    expect(rows[0]!.severity).toBe("warning");
    expect(rows[0]!.attributes).toMatchObject({ callItemCount: 150 });
  });

  test("a later window opens a fresh, audited window in the same row", async () => {
    await read({ itemCount: 1 });
    await read({ itemCount: 1 });

    const later = new Date(T0.getTime() + 301 * 1000);
    const outcome = await read({ itemCount: 1, now: later });

    expect(outcome).toMatchObject({
      audited: true,
      reason: "window_opened",
      readCount: 1
    });
    expect(await auditRows()).toHaveLength(2);

    const windows = await windowRows();

    // Bounded: still ONE row for this actor and kind.
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ read_count: 1, item_count: "1" });
  });

  test("a late-arriving read from an earlier window never rewinds the counter", async () => {
    const later = new Date(T0.getTime() + 301 * 1000);
    await read({ now: later });

    const outcome = await read({ now: T0 });

    expect(outcome).toMatchObject({
      audited: false,
      reason: "coalesced",
      readCount: 2
    });
    expect((await windowRows())[0]!.read_count).toBe(2);
  });

  test("actors and kinds have their own windows", async () => {
    await read();
    await read({ actorTenantUserId: OTHER_ACTOR });
    await read({ permission: "hr_payroll.runs.read" });

    const rows = await auditRows();

    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.action))).toEqual(
      new Set(["sensitive_read.compensation", "sensitive_read.run_lines"])
    );
  });

  test("twenty racing first reads are one opening row and a count of twenty", async () => {
    const outcomes = await Promise.all(
      Array.from({ length: 20 }, () => read({ itemCount: 1 }))
    );

    expect(
      outcomes.filter((outcome) => outcome.reason === "window_opened")
    ).toHaveLength(1);
    expect((await windowRows())[0]).toMatchObject({
      read_count: 20,
      item_count: "20"
    });
    // 1 opening + the milestone at 10 (readCount passes 10 exactly once).
    expect((await auditRows()).length).toBeLessThanOrEqual(2);
  });

  test("an export is never coalesced: every call is its own warning row, and no counter is kept", async () => {
    for (let i = 0; i < 3; i += 1) {
      await read({
        permission: "hr_payroll.payslips.export",
        itemCount: 40,
        resourceIds: [EMPLOYMENT_A]
      });
    }

    const rows = await auditRows();

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.severity === "warning")).toBe(true);
    expect(rows.every((row) => row.action === "sensitive_read.export")).toBe(
      true
    );
    // The row names the exact permission, since the policy is module-wide.
    expect(rows[0]!.attributes).toMatchObject({
      permission: "hr_payroll.payslips.export",
      reason: "uncoalesced",
      callItemCount: 40
    });
    expect(await windowRows()).toHaveLength(0);
  });

  test("a call naming more ids than one row holds is split across rows: no id is dropped", async () => {
    const ids = Array.from(
      { length: MAX_AUDITED_RESOURCE_IDS + 5 },
      (_, i) => `f9780000-0000-4000-8000-${String(i).padStart(12, "0")}`
    );

    await read({ itemCount: ids.length, resourceIds: ids });

    const rows = await auditRows();
    const recorded = rows.flatMap(
      (row) => row.attributes.resourceIds as string[]
    );

    expect(rows).toHaveLength(2);
    expect(new Set(recorded)).toEqual(new Set(ids));
    expect(rows[0]!.attributes.callItemCount).toBe(ids.length);
  });

  test("DECOY: one broad read then eight targeted single-record reads in the same window records EVERY id", async () => {
    const decoy = "f9780000-0000-4000-8000-0000000000d0";
    const targets = Array.from(
      { length: 8 },
      (_, i) =>
        `f9780000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`
    );

    await read({ itemCount: 1, resourceIds: [decoy] });

    for (const target of targets) {
      await read({ itemCount: 1, resourceIds: [target] });
    }

    const recorded = new Set(
      (await auditRows()).flatMap(
        (row) => row.attributes.resourceIds as string[]
      )
    );

    for (const id of [decoy, ...targets]) {
      expect(recorded.has(id)).toBe(true);
    }
  });

  test("a REPEAT read of an already-audited id adds no row, a new id does", async () => {
    await read({ resourceIds: [EMPLOYMENT_A] });
    const repeat = await read({ resourceIds: [EMPLOYMENT_A] });

    expect(repeat).toMatchObject({ audited: false, reason: "coalesced" });
    expect(await auditRows()).toHaveLength(1);

    const fresh = await read({ resourceIds: [EMPLOYMENT_A, EMPLOYMENT_B] });

    expect(fresh).toMatchObject({ audited: true, reason: "new_ids" });

    const rows = await auditRows();

    expect(rows).toHaveLength(2);
    // Only the NEW id is listed on the second row.
    expect(rows[1]!.attributes.resourceIds).toEqual([EMPLOYMENT_B]);
  });

  test("a new window forgets the old ids: the trail is per window", async () => {
    await read({ resourceIds: [EMPLOYMENT_A] });
    await read({
      resourceIds: [EMPLOYMENT_A],
      now: new Date(T0.getTime() + 301 * 1000)
    });

    expect(await auditRows()).toHaveLength(2);
  });

  test("an amount, a name or any non-UUID id is refused, nothing is written, and the caller's transaction aborts", async () => {
    for (const bad of ["1500000.00", "Budi Santoso", "IDR 4.500.000", ""]) {
      await expect(read({ resourceIds: [bad] })).rejects.toThrow(/UUID/);
    }

    expect(await auditRows()).toHaveLength(0);
    expect(await windowRows()).toHaveLength(0);
  });

  test("an unknown permission has no policy and is refused rather than silently unaudited", async () => {
    await expect(
      read({ permission: "hr_payroll.nonsense.read" })
    ).rejects.toThrow(/no policy/);
    expect(await auditRows()).toHaveLength(0);
  });

  test("fail-closed: when the audit insert fails the counter increment rolls back with the read", async () => {
    await expect(
      withTenantOrThrow(getRuntimeSql(), TENANT, async (tx) => {
        await recordSensitiveRead(tx, {
          tenantId: TENANT,
          actorTenantUserId: ACTOR,
          permission: COMPENSATION,
          now: T0
        });
        throw new Error("the read failed after the audit");
      })
    ).rejects.toThrow(/read failed/);

    // Nothing persisted: the window and the opening row are one transaction
    // with the read, so a read that did not happen leaves no record of one.
    expect(await windowRows()).toHaveLength(0);
    expect(await auditRows()).toHaveLength(0);
  });

  test("the window table is tenant-isolated for the runtime role and cannot be deleted from", async () => {
    await read();

    const visibleToOther = await withTenantOrThrow(
      getRuntimeSql(),
      OTHER_TENANT,
      (tx) =>
        tx`SELECT count(*)::int AS count FROM awcms_sensitive_read_windows`
    );

    expect((visibleToOther as { count: number }[])[0]!.count).toBe(0);

    await assertRejected(
      withTenantOrThrow(
        getRuntimeSql(),
        TENANT,
        (tx) => tx`DELETE FROM awcms_sensitive_read_windows`
      ),
      "a DELETE on the window table by the runtime role"
    );

    // WITH CHECK: another tenant's row cannot be forged either.
    await assertRejected(
      withTenantOrThrow(
        getRuntimeSql(),
        OTHER_TENANT,
        (tx) => tx`
          INSERT INTO awcms_sensitive_read_windows
            (tenant_id, actor_tenant_user_id, module_key, kind, window_start, read_count, item_count)
          VALUES (${TENANT}, ${ACTOR}, 'hr_payroll', 'sensitive_read.compensation', now(), 1, 0)
        `
      ),
      "a window row for another tenant"
    );
  });
});
