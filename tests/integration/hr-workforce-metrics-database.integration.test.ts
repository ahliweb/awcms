/**
 * Workforce metrics against a real PostgreSQL, as the least-privilege runtime
 * role with FORCE RLS in force, and the reporting projection as the worker role
 * (Issue #953, `docs/awcms/workforce-metrics.md`) -- WORLD-1 of the harness.
 *
 * Proves what the pure tests cannot:
 *   * the SQL feeds `computeFacts` the EFFECTIVE record (a superseded event is
 *     gone), published work shifts only (draft, cancelled and time off are not
 *     scheduled), and the window edges;
 *   * tenant isolation: another tenant's employment id in the scope reads nothing;
 *   * the direct-reports basis is ONE level (the attendance list walks the chain,
 *     this does not) and a soft-deleted report is not covered;
 *   * a group of five contributors is reported, a group of four returns no
 *     number, an employee with nothing to report does not count toward five, and
 *     the aggregate carries no tenant-wide total;
 *   * the `hr_workforce.attendance_events` projection counts every kind once,
 *     reconciles, survives a rebuild and does not double count after one.
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
  getRuntimeSql,
  getWorkerRoleSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import {
  directReportIdsOf,
  employmentWithinMetricsBasis,
  listEmployeeFacts,
  listGroupFigures
} from "../../src/modules/hr-workforce/application/hr-workforce-metrics-directory";
import {
  HR_WORKFORCE_REPORTING_PROJECTIONS,
  WORKFORCE_EVENT_METRIC_KEYS
} from "../../src/modules/hr-workforce/domain/hr-workforce-reporting";
import { runIncrementalUpdateForTenant } from "../../src/modules/reporting/application/projection-incremental-worker";
import { getProjectionMetrics } from "../../src/modules/reporting/application/projection-metric-store";
import {
  continueRebuildPasses,
  triggerOrResumeRebuild
} from "../../src/modules/reporting/application/projection-rebuild";
import { reconcileProjection } from "../../src/modules/reporting/application/projection-reconciliation";

// The projection scan stops at `now() - lag` (finding C4); the test reads its own
// writes at once, so it runs with no lag.
process.env.REPORTING_PROJECTION_LAG_SECONDS = "0";

const TENANT_A = "a9530000-0000-4000-8000-00000000000a";
const TENANT_B = "a9530000-0000-4000-8000-00000000000b";

const PROJECTION = HR_WORKFORCE_REPORTING_PROJECTIONS[0]!;

/** Three days ago at 00:00 UTC: inside the seven-day replay bound for every event below. */
const DAY = new Date();
DAY.setUTCHours(0, 0, 0, 0);
DAY.setUTCDate(DAY.getUTCDate() - 3);

const WINDOW = {
  from: new Date(DAY.getTime()),
  to: new Date(DAY.getTime() + 24 * 3_600_000)
};
const NOW = new Date();

const at = (hours: number, minutes = 0): string =>
  new Date(DAY.getTime() + (hours * 60 + minutes) * 60_000).toISOString();

function inTenant<T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return withTenantOrThrow(getRuntimeSql(), tenantId, fn);
}

let counter = 0;

async function seedOffice(tenantId: string): Promise<string> {
  counter += 1;
  const rows = (await getAdminSql()`
    INSERT INTO awcms_offices (tenant_id, office_code, office_name)
    VALUES (${tenantId}, ${`of-${counter}`}, ${`Office ${counter}`})
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

async function employ(
  tenantId: string,
  extra: { managerId?: string | null; officeId?: string | null } = {}
): Promise<string> {
  counter += 1;
  const profile = (await getAdminSql()`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`Person ${counter}`})
    RETURNING id
  `) as { id: string }[];

  return inTenant(tenantId, async (tx) => {
    const header = (await tx`
      INSERT INTO awcms_hr_employments (tenant_id, profile_id, employee_no, hired_on)
      VALUES (${tenantId}, ${profile[0]!.id}, ${`N-${counter}`}, '2026-01-01')
      RETURNING id
    `) as { id: string }[];

    await tx`
      INSERT INTO awcms_hr_employment_terms
        (tenant_id, employment_id, manager_employment_id, office_id,
         employment_type, status, effective_from)
      VALUES (${tenantId}, ${header[0]!.id}, ${extra.managerId ?? null},
              ${extra.officeId ?? null}, 'permanent', 'active', '2026-01-01')
    `;

    return header[0]!.id;
  });
}

/** A kiosk replay event: the only source that may claim a time days ago. */
async function event(
  tenantId: string,
  employmentId: string,
  kind: string,
  occurredAt: string
): Promise<string> {
  counter += 1;

  return inTenant(tenantId, async (tx) => {
    const rows = (await tx`
      INSERT INTO awcms_hr_attendance_events
        (tenant_id, employment_id, kind, occurred_at, source, client_event_key)
      VALUES (${tenantId}, ${employmentId}, ${kind}, ${occurredAt}::timestamptz,
              'kiosk', ${`k-${counter}`})
      RETURNING id
    `) as { id: string }[];

    return rows[0]!.id;
  });
}

async function shift(
  tenantId: string,
  employmentId: string,
  from: string,
  to: string,
  extra: { status?: string; kind?: string } = {}
): Promise<void> {
  const status = extra.status ?? "published";
  const kind = extra.kind ?? "work";

  await inTenant(tenantId, async (tx) => {
    // A shift assignment is born a draft; the guard allows only forward moves.
    const rows = (await tx`
      INSERT INTO awcms_hr_shift_assignments
        (tenant_id, employment_id, kind, time_off_kind, starts_at, ends_at,
         time_zone)
      VALUES (${tenantId}, ${employmentId}, ${kind},
              ${kind === "time_off" ? "leave" : null}, ${from}::timestamptz,
              ${to}::timestamptz, 'Asia/Jakarta')
      RETURNING id
    `) as { id: string }[];

    if (status === "published") {
      await tx`
        UPDATE awcms_hr_shift_assignments
        SET status = 'published', published_at = now()
        WHERE tenant_id = ${tenantId} AND id = ${rows[0]!.id}
      `;
    } else if (status === "cancelled") {
      await tx`
        UPDATE awcms_hr_shift_assignments
        SET status = 'cancelled', cancelled_at = now()
        WHERE tenant_id = ${tenantId} AND id = ${rows[0]!.id}
      `;
    }
  });
}

/** A full, punctual day for one employment: one shift, clock in at the start, out at the end. */
async function workedDay(tenantId: string, employmentId: string) {
  await shift(tenantId, employmentId, at(8), at(16));
  await event(tenantId, employmentId, "clock_in", at(8));
  await event(tenantId, employmentId, "clock_out", at(16));
}

function facts(tenantId: string, employmentId: string, scope?: string) {
  return inTenant(tenantId, (tx) =>
    listEmployeeFacts(tx, tenantId, { mode: "all" }, WINDOW, {
      employmentId: scope ?? employmentId,
      now: NOW
    })
  );
}

const suite = integrationEnabled ? describe : describe.skip;

suite("hr_workforce workforce metrics against PostgreSQL (Issue #953)", () => {
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
      VALUES (${TENANT_A}, 'wm-a', 'Metrics A'), (${TENANT_B}, 'wm-b', 'Metrics B')
    `;
  });

  describe("the facts come from the effective record", () => {
    test("late arrival, missed shift, worked time, breaks and ratios match the contract", async () => {
      const emp = await employ(TENANT_A);

      await shift(TENANT_A, emp, at(8), at(16));
      await shift(TENANT_A, emp, at(17), at(20)); // never attended
      await event(TENANT_A, emp, "clock_in", at(8, 10)); // 10 minutes late
      await event(TENANT_A, emp, "break_start", at(12));
      await event(TENANT_A, emp, "break_end", at(12, 30));
      await event(TENANT_A, emp, "clock_out", at(16, 30));

      const page = await facts(TENANT_A, emp);

      expect(page.employees).toHaveLength(1);
      expect(page.employees[0]!.facts).toEqual({
        scheduledShifts: 2,
        attendedShifts: 1,
        missedShifts: 1,
        lateArrivals: 1,
        scheduledMinutes: 8 * 60 + 3 * 60,
        workedMinutes: 8 * 60 + 20 - 30,
        breakMinutes: 30,
        incompleteSessions: 0,
        coverageRatio: 0.5,
        workedToScheduledRatio: 0.7121
      });
    });

    test("a superseded event is not part of the record; the superseding one is", async () => {
      const emp = await employ(TENANT_A);

      await shift(TENANT_A, emp, at(8), at(16));
      const wrong = await event(TENANT_A, emp, "clock_in", at(11)); // would be 3h late
      await event(TENANT_A, emp, "clock_out", at(16));

      // The approved correction's effect, written the way a maintenance session
      // does (the correction machinery has its own tests): a NEW event that
      // supersedes the old one, claiming the right time.
      await getAdminSql().begin(async (tx) => {
        await tx.unsafe("SET LOCAL session_replication_role = replica");
        await tx`
          INSERT INTO awcms_hr_attendance_events
            (tenant_id, employment_id, kind, occurred_at, source,
             client_event_key, supersedes_event_id, correction_id)
          VALUES (${TENANT_A}, ${emp}, 'clock_in', ${at(8)}::timestamptz,
                  'correction', 'fix-1', ${wrong}, ${crypto.randomUUID()})
        `;
      });

      const record = (await facts(TENANT_A, emp)).employees[0]!.facts;

      expect(record.lateArrivals).toBe(0);
      expect(record.attendedShifts).toBe(1);
      expect(record.workedMinutes).toBe(8 * 60);
    });

    test("draft, cancelled and time-off assignments are not scheduled work", async () => {
      const emp = await employ(TENANT_A);

      await shift(TENANT_A, emp, at(8), at(12), { status: "draft" });
      await shift(TENANT_A, emp, at(12), at(14), { status: "cancelled" });
      await shift(TENANT_A, emp, at(14), at(18), {
        kind: "time_off",
        status: "published"
      });

      const record = (await facts(TENANT_A, emp)).employees[0]!.facts;

      expect(record.scheduledShifts).toBe(0);
      expect(record.missedShifts).toBe(0);
      expect(record.coverageRatio).toBeNull();
    });

    test("a shift outside the window is not counted", async () => {
      const emp = await employ(TENANT_A);

      await shift(
        TENANT_A,
        emp,
        new Date(DAY.getTime() + 25 * 3_600_000).toISOString(),
        new Date(DAY.getTime() + 33 * 3_600_000).toISOString()
      );

      expect(
        (await facts(TENANT_A, emp)).employees[0]!.facts.scheduledShifts
      ).toBe(0);
    });
  });

  describe("tenant isolation (RLS) and the ownership bases", () => {
    test("another tenant's employment id reads nothing, under either tenant's context", async () => {
      const empA = await employ(TENANT_A);
      const empB = await employ(TENANT_B);

      await workedDay(TENANT_A, empA);
      await workedDay(TENANT_B, empB);

      const asB = await facts(TENANT_B, empA);
      const asA = await facts(TENANT_A, empB);

      expect(asB.employees).toEqual([]);
      expect(asA.employees).toEqual([]);
      expect(
        await inTenant(TENANT_B, (tx) =>
          employmentWithinMetricsBasis(tx, TENANT_B, empA, { mode: "all" })
        )
      ).toBe(true); // `all` is the PERMISSION; the row itself is still invisible
    });

    test("the direct-reports basis is one level, and a deleted report is not covered", async () => {
      const manager = await employ(TENANT_A);
      const r1 = await employ(TENANT_A, { managerId: manager });
      const r2 = await employ(TENANT_A, { managerId: manager });
      const skip = await employ(TENANT_A, { managerId: r1 });
      const tenantUser = await linkLogin(TENANT_A, manager);

      const direct = await inTenant(TENANT_A, (tx) =>
        directReportIdsOf(tx, TENANT_A, tenantUser)
      );

      expect([...direct].sort()).toEqual([r1, r2].sort());
      expect(direct).not.toContain(skip);
      expect(
        await inTenant(TENANT_A, (tx) =>
          employmentWithinMetricsBasis(tx, TENANT_A, skip, {
            mode: "reports",
            tenantUserId: tenantUser
          })
        )
      ).toBe(false);

      await getAdminSql()`
        UPDATE awcms_hr_employments SET deleted_at = now(), deleted_by = NULL
        WHERE id = ${r2}
      `;

      expect(
        await inTenant(TENANT_A, (tx) =>
          directReportIdsOf(tx, TENANT_A, tenantUser)
        )
      ).toEqual([r1]);
    });
  });

  describe("small-group suppression", () => {
    test("five contributors are reported, four return no number, and there is no total", async () => {
      const big = await seedOffice(TENANT_A);
      const small = await seedOffice(TENANT_A);

      for (let index = 0; index < 5; index += 1) {
        await workedDay(TENANT_A, await employ(TENANT_A, { officeId: big }));
      }
      for (let index = 0; index < 4; index += 1) {
        await workedDay(TENANT_A, await employ(TENANT_A, { officeId: small }));
      }

      const result = await inTenant(TENANT_A, (tx) =>
        listGroupFigures(tx, TENANT_A, WINDOW, NOW)
      );

      expect(result.tooLarge).toBe(false);
      if (result.tooLarge) return;

      const reported = result.groups.find((g) => g.group.officeId === big)!;
      const withheld = result.groups.find((g) => g.group.officeId === small)!;

      expect(reported.suppressed).toBe(false);
      if (!reported.suppressed) {
        expect(reported.contributorsBand).toBe("5-9");
        expect(reported.facts.scheduledShifts).toBe(5);
        expect(reported.facts.workedMinutes).toBe(5 * 8 * 60);
        expect(reported.facts.coverageRatio).toBe(1);
      }
      expect(withheld).toEqual({
        group: { officeId: small },
        suppressed: true,
        reason: "small_group"
      });
      expect(Object.keys(result)).toEqual(["tooLarge", "groups"]);
    });

    test("M2: a tenant over the cap is refused from a COUNT, before any page is read", async () => {
      for (let index = 0; index < 3; index += 1) {
        await workedDay(TENANT_A, await employ(TENANT_A));
      }

      const refused = await inTenant(TENANT_A, (tx) =>
        listGroupFigures(tx, TENANT_A, WINDOW, NOW, 2)
      );
      const allowed = await inTenant(TENANT_A, (tx) =>
        listGroupFigures(tx, TENANT_A, WINDOW, NOW, 3)
      );

      expect(refused).toEqual({ tooLarge: true });
      expect(allowed.tooLarge).toBe(false);
    });

    test("H2: employees under the contributor floor are neither counted nor summed", async () => {
      const office = await seedOffice(TENANT_A);

      await workedDay(TENANT_A, await employ(TENANT_A, { officeId: office }));
      for (let index = 0; index < 6; index += 1) {
        const planted = await employ(TENANT_A, { officeId: office });

        await shift(TENANT_A, planted, at(8), at(8, 15));
        await event(TENANT_A, planted, "clock_in", at(8));
        await event(TENANT_A, planted, "clock_out", at(8, 15));
      }

      const result = await inTenant(TENANT_A, (tx) =>
        listGroupFigures(tx, TENANT_A, WINDOW, NOW)
      );

      expect(result.tooLarge).toBe(false);
      if (!result.tooLarge) {
        expect(result.groups).toEqual([
          {
            group: { officeId: office },
            suppressed: true,
            reason: "small_group"
          }
        ]);
      }
    });

    test("an employee with nothing to report does not make a group of four into five", async () => {
      const office = await seedOffice(TENANT_A);

      for (let index = 0; index < 4; index += 1) {
        await workedDay(TENANT_A, await employ(TENANT_A, { officeId: office }));
      }
      await employ(TENANT_A, { officeId: office }); // employed, no shifts, no events

      const result = await inTenant(TENANT_A, (tx) =>
        listGroupFigures(tx, TENANT_A, WINDOW, NOW)
      );

      expect(result.tooLarge).toBe(false);
      if (!result.tooLarge) {
        expect(result.groups).toHaveLength(1);
        expect(result.groups[0]!.suppressed).toBe(true);
      }
    });

    test("another tenant's employees are never in a group", async () => {
      const office = await seedOffice(TENANT_A);

      for (let index = 0; index < 5; index += 1) {
        await workedDay(TENANT_B, await employ(TENANT_B));
      }
      await workedDay(TENANT_A, await employ(TENANT_A, { officeId: office }));

      const result = await inTenant(TENANT_A, (tx) =>
        listGroupFigures(tx, TENANT_A, WINDOW, NOW)
      );

      expect(result.tooLarge).toBe(false);
      if (!result.tooLarge) {
        expect(result.groups).toEqual([
          {
            group: { officeId: office },
            suppressed: true,
            reason: "small_group"
          }
        ]);
      }
    });
  });

  describe("the hr_workforce.attendance_events projection", () => {
    async function refresh(tenantId: string) {
      const outcome = await runIncrementalUpdateForTenant(
        getWorkerRoleSql(),
        PROJECTION,
        tenantId
      );

      expect(outcome.failed).toBe(false);
    }

    async function counters(tenantId: string): Promise<Record<string, number>> {
      const all = await inTenant(tenantId, (tx) =>
        getProjectionMetrics(tx, tenantId, PROJECTION.key)
      );

      return Object.fromEntries(
        Object.entries(all).filter(([, value]) => value)
      );
    }

    async function reconcile(tenantId: string) {
      return inTenant(tenantId, (tx) =>
        reconcileProjection(tx, tenantId, PROJECTION, null)
      );
    }

    async function seedEvents(tenantId: string) {
      const emp = await employ(tenantId);

      await event(tenantId, emp, "clock_in", at(8));
      await event(tenantId, emp, "break_start", at(12));
      await event(tenantId, emp, "break_end", at(12, 30));
      await event(tenantId, emp, "clock_out", at(16));
      await event(tenantId, emp, "clock_in", at(17));
    }

    test("counts every kind once, reconciles, and never reads another tenant's events", async () => {
      await seedEvents(TENANT_A);
      await seedEvents(TENANT_B);
      await refresh(TENANT_A);
      await refresh(TENANT_A);

      expect(await counters(TENANT_A)).toEqual({
        [WORKFORCE_EVENT_METRIC_KEYS.clockIn]: 2,
        [WORKFORCE_EVENT_METRIC_KEYS.clockOut]: 1,
        [WORKFORCE_EVENT_METRIC_KEYS.breakStart]: 1,
        [WORKFORCE_EVENT_METRIC_KEYS.breakEnd]: 1
      });
      expect(await counters(TENANT_B)).toEqual({});
      expect((await reconcile(TENANT_A)).mismatch).toBe(false);
    });

    test("a rebuild reproduces the figures and an incremental pass after it does not double count", async () => {
      await seedEvents(TENANT_A);
      await refresh(TENANT_A);

      const before = await counters(TENANT_A);
      const trigger = await inTenant(TENANT_A, (tx) =>
        triggerOrResumeRebuild(tx, TENANT_A, PROJECTION, {
          requestedBy: null,
          reason: "test"
        })
      );
      const done = await continueRebuildPasses(
        getWorkerRoleSql(),
        TENANT_A,
        PROJECTION,
        trigger.run.id
      );

      expect(done.status).toBe("completed");
      expect(await counters(TENANT_A)).toEqual(before);

      await refresh(TENANT_A);

      expect(await counters(TENANT_A)).toEqual(before);
      expect((await reconcile(TENANT_A)).mismatch).toBe(false);
    });
  });
});

/** Links a fresh login to an employment, as an administrator would, and returns the tenant user id. */
async function linkLogin(
  tenantId: string,
  employmentId: string
): Promise<string> {
  counter += 1;
  const sql = getAdminSql();
  const employment = (await sql`
    SELECT profile_id FROM awcms_hr_employments WHERE id = ${employmentId}
  `) as { profile_id: string }[];
  const identity = (await sql`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${employment[0]!.profile_id}, ${`wm${counter}@example.com`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const user = (await sql`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id})
    RETURNING id
  `) as { id: string }[];

  await sql`
    UPDATE awcms_hr_employments SET tenant_user_id = ${user[0]!.id}
    WHERE id = ${employmentId}
  `;

  return user[0]!.id;
}
