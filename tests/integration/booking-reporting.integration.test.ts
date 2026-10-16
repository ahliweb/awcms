/**
 * The `booking` reporting projections and report routes' queries against a real
 * PostgreSQL (Issue #944, ADR-0131; docs/awcms/booking.md section 7.2) -- WORLD-1
 * of the harness: the reservation application layer driven as `awcms_app`
 * (FORCE RLS in effect) and the `reporting` engine driven as `awcms_worker`, the
 * role the scheduled refresh runs as.
 *
 * What this proves that the unit tests cannot:
 *
 *   * the three registered projections count the right things from the real
 *     history: transitions per kind, `late_cancelled` as a subset of
 *     `cancelled`, booked/released SECONDS (service interval, buffers excluded),
 *     booked/released UNIT-NIGHTS (one per unit and night), a hold never booked;
 *   * a reschedule books the replacement and releases the original, so net
 *     nights equal the live stay;
 *   * the worker role can scan the event table (sql/180 grant) and write only its
 *     own projection rows;
 *   * reconciliation agrees with the incremental result, a rebuild reproduces the
 *     same figures and a second rebuild changes nothing (idempotent), and an
 *     incremental pass after a rebuild does not double count;
 *   * a page boundary that falls between two history rows written in one
 *     transaction loses neither (the tie-safe boundary);
 *   * the report queries: the worked villa example (units claimed per
 *     unit-night, a hold beside occupancy and never in it, blocked nights),
 *     Asia/Jakarta day windows (a booking across Jakarta midnight splits between
 *     the two days), the hold pipeline, lead time, cancellation and small-group
 *     suppression;
 *   * the live reports and the projections agree on net booked nights/seconds;
 *   * tenant isolation: another tenant's events never reach this tenant's
 *     projection and another tenant's resource id yields an empty report.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
 */
import { NO_OP_STAFF_AVAILABILITY } from "../../src/modules/booking/domain/booking-staff-availability";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  createRuntimePool,
  getAdminSql,
  getRuntimeSql,
  getWorkerRoleSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { createBlock } from "../../src/modules/booking/application/booking-block-service";
import {
  occupancyReport,
  reservationsReport,
  utilizationReport
} from "../../src/modules/booking/application/booking-report-directory";
import {
  createReservation,
  rescheduleReservation,
  transitionReservation,
  type TransitionAction
} from "../../src/modules/booking/application/booking-reservation-service";
import type { PlaceHoldInput } from "../../src/modules/booking/domain/booking-allocation";
import { BOOKING_REPORTING_PROJECTIONS } from "../../src/modules/booking/domain/booking-reporting";
import { addDays } from "../../src/modules/booking/domain/booking-time";
import { getProjectionMetrics } from "../../src/modules/reporting/application/projection-metric-store";
import { runIncrementalUpdateForTenant } from "../../src/modules/reporting/application/projection-incremental-worker";
import {
  continueRebuildPasses,
  triggerOrResumeRebuild
} from "../../src/modules/reporting/application/projection-rebuild";
import { reconcileProjection } from "../../src/modules/reporting/application/projection-reconciliation";

const TENANT_A = "b9440000-0000-4000-8000-00000000000a";
const TENANT_B = "b9440000-0000-4000-8000-00000000000b";
const ACTORS = new Map<string, string>();

// The projection scan stops at `now() - lag` (finding C4); the test reads its own
// writes at once, so it runs with no lag.
process.env.REPORTING_PROJECTION_LAG_SECONDS = "0";

const [RESERVATIONS, TIME, NIGHTS] = [
  "booking.reservations",
  "booking.time",
  "booking.nights"
].map((key) => BOOKING_REPORTING_PROJECTIONS.find((d) => d.key === key)!) as [
  (typeof BOOKING_REPORTING_PROJECTIONS)[number],
  (typeof BOOKING_REPORTING_PROJECTIONS)[number],
  (typeof BOOKING_REPORTING_PROJECTIONS)[number]
];

/** The Jakarta calendar date `days` from now. */
function jakartaDate(days: number): string {
  const jakartaToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta"
  }).format(new Date());

  return addDays(jakartaToday, days);
}

let pool: Bun.SQL;
let sequence = 0;

function tenantTx<T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return pool.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
    return fn(tx);
  });
}

function ctxOf(tenantId: string) {
  return {
    tenantId,
    staff: NO_OP_STAFF_AVAILABILITY,
    actorTenantUserId: ACTORS.get(tenantId) ?? null,
    correlationId: crypto.randomUUID()
  };
}

async function seedTenant(tenantId: string, code: string): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${tenantId}, ${code}, ${`Booking ${code}`})
  `;

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`Actor ${code}`})
    RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${code}@example.com`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const user = (await admin`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id})
    RETURNING id
  `) as { id: string }[];

  ACTORS.set(tenantId, user[0]!.id);
}

type Fixture = { resourceId: string; unitIds: string[]; offeringId: string };

type FixtureOptions = {
  capacity?: number;
  mode?: "slot" | "stay";
  confirmation?: "immediate" | "hold_then_confirm";
  cutoffSeconds?: number | null;
  setupSeconds?: number;
  cleanupSeconds?: number;
};

/** A Jakarta-zone resource with `capacity` units, an offering and (slot) a schedule open all day, every day. */
async function newFixture(
  tenantId: string,
  options: FixtureOptions = {}
): Promise<Fixture> {
  const admin = getAdminSql();
  sequence += 1;
  const code = `r${sequence}`;
  const capacity = options.capacity ?? 1;
  const mode = options.mode ?? "slot";
  const resource = (await admin`
    INSERT INTO awcms_booking_resources
      (tenant_id, code, name, kind, capacity, timezone, booking_mode,
       stay_check_in_time, stay_check_out_time)
    VALUES (${tenantId}, ${code}, ${`Villa ${code}`}, 'room', ${capacity},
            'Asia/Jakarta', ${mode},
            ${mode === "stay" ? "14:00" : null}::time,
            ${mode === "stay" ? "12:00" : null}::time)
    RETURNING id
  `) as { id: string }[];
  const unitIds: string[] = [];

  for (let ordinal = 1; ordinal <= capacity; ordinal += 1) {
    const unit = (await admin`
      INSERT INTO awcms_booking_resource_units (tenant_id, resource_id, ordinal)
      VALUES (${tenantId}, ${resource[0]!.id}, ${ordinal})
      RETURNING id
    `) as { id: string }[];

    unitIds.push(unit[0]!.id);
  }

  if (mode === "slot") {
    const day = [{ from: "00:00", to: "24:00" }];

    await admin`
      INSERT INTO awcms_booking_schedules
        (tenant_id, resource_id, timezone, effective_from, rules)
      VALUES (${tenantId}, ${resource[0]!.id}, 'Asia/Jakarta', '2020-01-01',
              ${{ weekly: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day } }}::jsonb)
    `;
  }

  const confirmation = options.confirmation ?? "hold_then_confirm";
  const offering =
    mode === "stay"
      ? ((await admin`
          INSERT INTO awcms_booking_service_offerings
            (tenant_id, code, name, granularity, min_nights, max_nights,
             max_party, confirmation_mode, cancellation_cutoff_seconds)
          VALUES (${tenantId}, ${`night-${code}`}, 'Night', 'stay', 1, 30, 20,
                  ${confirmation}, ${options.cutoffSeconds ?? null})
          RETURNING id
        `) as { id: string }[])
      : ((await admin`
          INSERT INTO awcms_booking_service_offerings
            (tenant_id, code, name, granularity, duration_seconds, setup_seconds,
             cleanup_seconds, slot_step_seconds, max_party, confirmation_mode,
             cancellation_cutoff_seconds)
          VALUES (${tenantId}, ${`hour-${code}`}, 'Hour', 'time', 3600,
                  ${options.setupSeconds ?? 0}, ${options.cleanupSeconds ?? 0},
                  900, 20, ${confirmation}, ${options.cutoffSeconds ?? null})
          RETURNING id
        `) as { id: string }[]);

  return {
    resourceId: resource[0]!.id,
    unitIds,
    offeringId: offering[0]!.id
  };
}

function claim(
  fixture: Fixture,
  overrides: Partial<PlaceHoldInput>
): PlaceHoldInput {
  return {
    offeringId: fixture.offeringId,
    resourceId: fixture.resourceId,
    partySize: 1,
    quantity: 1,
    ...overrides
  };
}

async function create(tenantId: string, input: PlaceHoldInput) {
  const outcome = await tenantTx(tenantId, (tx) =>
    createReservation(
      tx,
      ctxOf(tenantId),
      { claim: input, overridePolicy: true },
      true
    )
  );

  if (outcome.outcome !== "ok") {
    throw new Error(`expected a reservation, got ${JSON.stringify(outcome)}`);
  }

  return outcome.reservation;
}

async function move(
  tenantId: string,
  reservationId: string,
  action: TransitionAction
) {
  const outcome = await tenantTx(tenantId, (tx) =>
    transitionReservation(tx, ctxOf(tenantId), reservationId, action, {})
  );

  if (outcome.outcome !== "ok") {
    throw new Error(`expected ${action}, got ${JSON.stringify(outcome)}`);
  }

  return outcome.reservation;
}

/** A hold, confirmed. */
async function confirmed(tenantId: string, input: PlaceHoldInput) {
  const hold = await create(tenantId, input);

  return move(tenantId, hold.id, "confirm");
}

async function refresh(tenantId: string): Promise<void> {
  for (const descriptor of BOOKING_REPORTING_PROJECTIONS) {
    const outcome = await runIncrementalUpdateForTenant(
      getWorkerRoleSql(),
      descriptor,
      tenantId
    );

    expect(outcome.failed).toBe(false);
  }
}

/** The non-zero metrics: a rebuild's reset writes explicit zero rows, an incremental pass writes none -- the same figure. */
async function metrics(
  tenantId: string,
  key: string
): Promise<Record<string, number>> {
  const all = await withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
    getProjectionMetrics(tx, tenantId, key)
  );

  return Object.fromEntries(Object.entries(all).filter(([, value]) => value));
}

async function rebuild(
  tenantId: string,
  descriptor: (typeof BOOKING_REPORTING_PROJECTIONS)[number]
): Promise<void> {
  const trigger = await withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
    triggerOrResumeRebuild(tx, tenantId, descriptor, {
      requestedBy: null,
      reason: "test"
    })
  );
  const done = await continueRebuildPasses(
    getWorkerRoleSql(),
    tenantId,
    descriptor,
    trigger.run.id
  );

  expect(done.status).toBe("completed");
}

async function reconcile(
  tenantId: string,
  descriptor: (typeof BOOKING_REPORTING_PROJECTIONS)[number]
) {
  return withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
    reconcileProjection(tx, tenantId, descriptor, null)
  );
}

function reportTx<T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return tenantTx(tenantId, fn);
}

const suite = integrationEnabled ? describe : describe.skip;

suite("booking reporting projections and reports (Issue #944)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
    await resetDatabase();
    pool = createRuntimePool(24);
    await seedTenant(TENANT_A, "rep-a");
    await seedTenant(TENANT_B, "rep-b");
  });

  afterAll(async () => {
    await pool?.close({ timeout: 1 });
    await teardownIntegrationDatabase();
  });

  describe("projection correctness", () => {
    // Tenant A's story: a slot hour with buffers, a 3-unit villa stay, a
    // cancellation, a late cancellation, a reschedule and a hold left open.
    const S = {
      slot: null as unknown as Fixture,
      villa: null as unknown as Fixture,
      lateVilla: null as unknown as Fixture
    };

    test("seed: transitions of tenant A", async () => {
      S.slot = await newFixture(TENANT_A, {
        capacity: 2,
        setupSeconds: 600,
        cleanupSeconds: 600
      });
      S.villa = await newFixture(TENANT_A, { capacity: 3, mode: "stay" });
      S.lateVilla = await newFixture(TENANT_A, {
        capacity: 1,
        mode: "stay",
        cutoffSeconds: 90 * 86_400
      });

      const hourAt = Date.parse(`${jakartaDate(5)}T10:00:00+07:00`);

      // 1. slot hour, confirmed: 3600 booked seconds (the buffers are NOT booked).
      await confirmed(TENANT_A, claim(S.slot, { startsAtMs: hourAt }));

      // 2. villa, 2 nights on 3 units, confirmed: 6 unit-nights.
      await confirmed(
        TENANT_A,
        claim(S.villa, {
          stay: {
            checkInDate: jakartaDate(10),
            checkOutDate: jakartaDate(12)
          },
          quantity: 3
        })
      );

      // 3. villa, 1 unit 2 nights confirmed, then cancelled (released): books 2, releases 2.
      const second = await confirmed(
        TENANT_A,
        claim(S.lateVilla, {
          stay: {
            checkInDate: jakartaDate(20),
            checkOutDate: jakartaDate(22)
          }
        })
      );
      await move(TENANT_A, second.id, "cancel"); // inside the 90-day cutoff: late

      // 4. a stay rescheduled from 2 nights to 3: books 2, releases 2, books 3.
      const original = await confirmed(
        TENANT_A,
        claim(S.villa, {
          stay: {
            checkInDate: jakartaDate(30),
            checkOutDate: jakartaDate(32)
          }
        })
      );
      const moved = await tenantTx(TENANT_A, (tx) =>
        rescheduleReservation(
          tx,
          ctxOf(TENANT_A),
          original.id,
          {
            stay: {
              checkInDate: jakartaDate(30),
              checkOutDate: jakartaDate(33)
            },
            overridePolicy: true
          },
          true
        )
      );

      expect(moved.outcome).toBe("ok");

      // 5. a hold left open: held, never booked.
      await create(
        TENANT_A,
        claim(S.villa, {
          stay: {
            checkInDate: jakartaDate(40),
            checkOutDate: jakartaDate(42)
          }
        })
      );
    });

    test("every event carries the quantities the projections sum", async () => {
      const rows = (await getAdminSql()`
        SELECT kind, from_status, booked_seconds::int AS bs, released_seconds::int AS rs,
               booked_nights::int AS bn, released_nights::int AS rn
        FROM awcms_booking_reservation_events
        WHERE tenant_id = ${TENANT_A}
          AND (booked_seconds + released_seconds + booked_nights + released_nights) > 0
        ORDER BY created_at, seq
      `) as {
        kind: string;
        from_status: string | null;
        bs: number;
        rs: number;
        bn: number;
        rn: number;
      }[];

      // The slot confirmation books 3600 seconds, the buffers (600 + 600) are not in it.
      expect(rows.filter((row) => row.bs > 0)).toEqual([
        expect.objectContaining({ kind: "confirmed", bs: 3600 })
      ]);
      // Booked nights: 6 (3 units x 2) + 2 + 2 (original) + 3 (replacement); released: 2 (cancel) + 2 (reschedule).
      const bookedNights = rows.reduce((sum, row) => sum + row.bn, 0);
      const releasedNights = rows.reduce((sum, row) => sum + row.rn, 0);

      expect(bookedNights).toBe(6 + 2 + 2 + 3);
      expect(releasedNights).toBe(2 + 2);
      // Only confirmed books; only a cancel/reschedule FROM confirmed releases.
      for (const row of rows) {
        if (row.bn + row.bs > 0) {
          expect(row.kind).toBe("confirmed");
        }
        if (row.rn + row.rs > 0) {
          expect(["cancelled", "rescheduled"]).toContain(row.kind);
          expect(row.from_status).toBe("confirmed");
        }
      }
    });

    test("the worker role counts the history into the three projections", async () => {
      await refresh(TENANT_A);

      const reservations = await metrics(TENANT_A, RESERVATIONS.key);
      const time = await metrics(TENANT_A, TIME.key);
      const nights = await metrics(TENANT_A, NIGHTS.key);

      // 6 reservations created in total (5 above + the replacement).
      expect(reservations.created).toBe(6);
      // Holds placed: every hold_then_confirm claim (slot, villa, lateVilla, original, open hold) = 5.
      expect(reservations.held).toBe(5);
      // Confirmed: the 4 holds confirmed + the replacement's own confirmation.
      expect(reservations.confirmed).toBe(5);
      expect(reservations.cancelled).toBe(1);
      expect(reservations.late_cancelled).toBe(1);
      expect(reservations.rescheduled).toBe(1);
      expect(reservations.expired ?? 0).toBe(0);
      expect(reservations.checked_in ?? 0).toBe(0);
      expect(reservations.no_show ?? 0).toBe(0);

      expect(time.booked_seconds).toBe(3600);
      expect(time.released_seconds ?? 0).toBe(0);
      expect(nights.booked_nights).toBe(13);
      expect(nights.released_nights).toBe(4);
      // net: 13 - 4 = 9 live unit-nights = 6 (3-unit stay) + 3 (the rescheduled stay).
      expect(nights.booked_nights! - nights.released_nights!).toBe(9);
    });

    test("late_cancelled never exceeds cancelled", async () => {
      const reservations = await metrics(TENANT_A, RESERVATIONS.key);

      expect(reservations.late_cancelled).toBeLessThanOrEqual(
        reservations.cancelled!
      );
    });

    test("reconciliation agrees with the incremental result for all three", async () => {
      for (const descriptor of BOOKING_REPORTING_PROJECTIONS) {
        const run = await reconcile(TENANT_A, descriptor);

        expect(run.mismatch).toBe(false);
      }
    });

    test("the live reports agree with the projections on net booked nights and seconds", async () => {
      const occupancy = await reportTx(TENANT_A, (tx) =>
        occupancyReport(tx, TENANT_A, {
          from: jakartaDate(0),
          to: jakartaDate(60),
          resourceId: null
        })
      );
      const occupiedNights = occupancy.resources.reduce(
        (sum, resource) => sum + resource.totals.occupiedUnitNights,
        0
      );
      const utilization = await reportTx(TENANT_A, (tx) =>
        utilizationReport(tx, TENANT_A, {
          from: jakartaDate(0),
          to: jakartaDate(60),
          resourceId: null
        })
      );
      const bookedSeconds = utilization.resources.reduce(
        (sum, resource) => sum + resource.totals.bookedSeconds,
        0
      );
      const nights = await metrics(TENANT_A, NIGHTS.key);
      const time = await metrics(TENANT_A, TIME.key);

      expect(occupiedNights).toBe(
        nights.booked_nights! - nights.released_nights!
      );
      expect(bookedSeconds).toBe(
        time.booked_seconds! - (time.released_seconds ?? 0)
      );
    });

    test("a rebuild reproduces the figures and a second rebuild changes nothing", async () => {
      const before = {
        reservations: await metrics(TENANT_A, RESERVATIONS.key),
        time: await metrics(TENANT_A, TIME.key),
        nights: await metrics(TENANT_A, NIGHTS.key)
      };

      for (const descriptor of BOOKING_REPORTING_PROJECTIONS) {
        await rebuild(TENANT_A, descriptor);
      }

      expect(await metrics(TENANT_A, RESERVATIONS.key)).toEqual(
        before.reservations
      );
      expect(await metrics(TENANT_A, TIME.key)).toEqual(before.time);
      expect(await metrics(TENANT_A, NIGHTS.key)).toEqual(before.nights);

      for (const descriptor of BOOKING_REPORTING_PROJECTIONS) {
        await rebuild(TENANT_A, descriptor);
      }

      expect(await metrics(TENANT_A, RESERVATIONS.key)).toEqual(
        before.reservations
      );
      expect(await metrics(TENANT_A, NIGHTS.key)).toEqual(before.nights);

      // An incremental pass after a rebuild finds nothing new: no double count.
      await refresh(TENANT_A);

      expect(await metrics(TENANT_A, RESERVATIONS.key)).toEqual(
        before.reservations
      );
      expect(await metrics(TENANT_A, TIME.key)).toEqual(before.time);
      expect(await metrics(TENANT_A, NIGHTS.key)).toEqual(before.nights);

      for (const descriptor of BOOKING_REPORTING_PROJECTIONS) {
        expect((await reconcile(TENANT_A, descriptor)).mismatch).toBe(false);
      }
    });

    test("a new transition after a rebuild is counted exactly once", async () => {
      const fixture = await newFixture(TENANT_A, { capacity: 1, mode: "stay" });
      const before = await metrics(TENANT_A, NIGHTS.key);

      await confirmed(
        TENANT_A,
        claim(fixture, {
          stay: {
            checkInDate: jakartaDate(50),
            checkOutDate: jakartaDate(54)
          }
        })
      );
      await refresh(TENANT_A);
      await refresh(TENANT_A);

      const after = await metrics(TENANT_A, NIGHTS.key);

      expect(after.booked_nights! - before.booked_nights!).toBe(4);
      expect((await reconcile(TENANT_A, NIGHTS)).mismatch).toBe(false);
    });

    test("a page boundary between two history rows of one transaction loses neither", async () => {
      // Page of 2 over the `created` + `held` pair of each reservation: without the
      // tie-safe boundary a pass would end between the pair and drop the `held`.
      const tiny = {
        ...RESERVATIONS,
        key: "booking.reservations",
        batchLimit: 2
      };
      const fixture = await newFixture(TENANT_A, { capacity: 6, mode: "stay" });
      const heldBefore = (await metrics(TENANT_A, RESERVATIONS.key)).held ?? 0;
      const createdBefore =
        (await metrics(TENANT_A, RESERVATIONS.key)).created ?? 0;

      // One reservation whose history is three rows (created, held, confirmed)
      // puts the page boundary (2 rows) between the pair of the NEXT reservation.
      await confirmed(
        TENANT_A,
        claim(fixture, {
          stay: {
            checkInDate: jakartaDate(55),
            checkOutDate: jakartaDate(57)
          }
        })
      );

      for (let index = 0; index < 5; index += 1) {
        await create(
          TENANT_A,
          claim(fixture, {
            stay: {
              checkInDate: jakartaDate(60 + index * 3),
              checkOutDate: jakartaDate(62 + index * 3)
            }
          })
        );
      }

      const outcome = await runIncrementalUpdateForTenant(
        getWorkerRoleSql(),
        tiny,
        TENANT_A
      );

      expect(outcome.failed).toBe(false);

      const after = await metrics(TENANT_A, RESERVATIONS.key);

      expect((after.created ?? 0) - createdBefore).toBe(6);
      expect((after.held ?? 0) - heldBefore).toBe(6);
      expect((await reconcile(TENANT_A, RESERVATIONS)).mismatch).toBe(false);
    });
  });

  describe("a millisecond wider than the page", () => {
    test("limit + 1 history rows in one millisecond fail the pass loudly, change nothing and clear once the limit is raised", async () => {
      const fixture = await newFixture(TENANT_A, { capacity: 1, mode: "stay" });
      const before = await metrics(TENANT_A, RESERVATIONS.key);

      // One reservation: `created` + `held` share the transaction's instant, and
      // a page of ONE row cannot end between them.
      await create(
        TENANT_A,
        claim(fixture, {
          stay: {
            checkInDate: jakartaDate(70),
            checkOutDate: jakartaDate(72)
          }
        })
      );

      const outcome = await runIncrementalUpdateForTenant(
        getWorkerRoleSql(),
        { ...RESERVATIONS, batchLimit: 1 },
        TENANT_A
      );

      expect(outcome.failed).toBe(true);
      // Nothing applied, cursor not moved: the rows are still to be counted.
      expect(await metrics(TENANT_A, RESERVATIONS.key)).toEqual(before);

      // The fix is configuration: the normal limit counts both rows.
      await refresh(TENANT_A);

      const after = await metrics(TENANT_A, RESERVATIONS.key);

      expect((after.created ?? 0) - (before.created ?? 0)).toBe(1);
      expect((after.held ?? 0) - (before.held ?? 0)).toBe(1);
      expect((await reconcile(TENANT_A, RESERVATIONS)).mismatch).toBe(false);
    });
  });

  describe("tenant isolation", () => {
    test("another tenant's events never reach this tenant's projection, and its resource id reports nothing", async () => {
      const aBefore = await metrics(TENANT_A, RESERVATIONS.key);
      const fixtureB = await newFixture(TENANT_B, {
        capacity: 2,
        mode: "stay"
      });

      await confirmed(
        TENANT_B,
        claim(fixtureB, {
          stay: {
            checkInDate: jakartaDate(10),
            checkOutDate: jakartaDate(13)
          },
          quantity: 2
        })
      );
      await refresh(TENANT_B);
      await refresh(TENANT_A);

      expect(await metrics(TENANT_A, RESERVATIONS.key)).toEqual(aBefore);

      const bNights = await metrics(TENANT_B, NIGHTS.key);
      const bReservations = await metrics(TENANT_B, RESERVATIONS.key);

      expect(bNights.booked_nights).toBe(6);
      expect(bReservations.created).toBe(1);
      expect(bReservations.confirmed).toBe(1);

      // Tenant A asking about tenant B's resource sees nothing, not a 403.
      const empty = await reportTx(TENANT_A, (tx) =>
        occupancyReport(tx, TENANT_A, {
          from: jakartaDate(0),
          to: jakartaDate(30),
          resourceId: fixtureB.resourceId
        })
      );

      expect(empty.resources).toEqual([]);

      const own = await reportTx(TENANT_B, (tx) =>
        occupancyReport(tx, TENANT_B, {
          from: jakartaDate(0),
          to: jakartaDate(30),
          resourceId: fixtureB.resourceId
        })
      );

      expect(own.resources[0]!.totals.occupiedUnitNights).toBe(6);
    });
  });

  describe("occupancy: the worked villa", () => {
    test("units claimed per unit-night, a hold beside occupancy and never in it, blocked nights apart", async () => {
      const villa = await newFixture(TENANT_A, { capacity: 3, mode: "stay" });
      const D = (n: number) => jakartaDate(100 + n);

      // Two of the three villas, nights D10 and D11, confirmed.
      await confirmed(
        TENANT_A,
        claim(villa, {
          stay: { checkInDate: D(10), checkOutDate: D(12) },
          quantity: 2
        })
      );
      // The third villa held (not confirmed), nights D11 and D12.
      await create(
        TENANT_A,
        claim(villa, { stay: { checkInDate: D(11), checkOutDate: D(13) } })
      );
      // A resource-wide block, nights D14 and D15.
      const blocked = await tenantTx(TENANT_A, (tx) =>
        createBlock(
          tx,
          { ...ctxOf(TENANT_A), revealConflicts: false },
          {
            resourceId: villa.resourceId,
            fromDate: D(14),
            toDate: D(16),
            reasonCode: "maintenance"
          }
        )
      );

      expect(blocked.outcome).toBe("ok");

      const report = await reportTx(TENANT_A, (tx) =>
        occupancyReport(tx, TENANT_A, {
          from: D(9),
          to: D(17),
          resourceId: villa.resourceId
        })
      );
      const resource = report.resources[0]!;
      const day = (n: number) =>
        resource.days.find((candidate) => candidate.date === D(n))!;

      expect(resource.units).toBe(3);
      expect(resource.days).toHaveLength(8);
      // D9: nothing.
      expect(day(9)).toMatchObject({
        occupiedUnitNights: 0,
        heldUnitNights: 0,
        blockedUnitNights: 0,
        occupancyRate: 0
      });
      // D10: two units occupied of three.
      expect(day(10)).toMatchObject({
        occupiedUnitNights: 2,
        heldUnitNights: 0,
        occupancyRate: 0.6667
      });
      // D11: the hold is the pipeline, NOT occupancy: still 2 of 3.
      expect(day(11)).toMatchObject({
        occupiedUnitNights: 2,
        heldUnitNights: 1,
        occupancyRate: 0.6667
      });
      // D12: the confirmed stay checked out on D12 (half-open); only the hold remains.
      expect(day(12)).toMatchObject({
        occupiedUnitNights: 0,
        heldUnitNights: 1,
        occupancyRate: 0
      });
      expect(day(13)).toMatchObject({
        occupiedUnitNights: 0,
        heldUnitNights: 0
      });
      // D14 and D15: the block covers all three units, apart from occupancy.
      expect(day(14)).toMatchObject({
        occupiedUnitNights: 0,
        blockedUnitNights: 3
      });
      expect(day(15)).toMatchObject({ blockedUnitNights: 3 });
      expect(day(16)).toMatchObject({ blockedUnitNights: 0 });

      expect(resource.totals).toMatchObject({
        unitNights: 24,
        occupiedUnitNights: 4,
        heldUnitNights: 2,
        blockedUnitNights: 6
      });
    });
  });

  describe("utilization: Asia/Jakarta day windows", () => {
    test("a booking across Jakarta midnight splits between the two days; a hold is not booked", async () => {
      const room = await newFixture(TENANT_A, { capacity: 1 });
      const day = jakartaDate(7);
      const nextDay = jakartaDate(8);
      const acrossMidnight = Date.parse(`${day}T23:30:00+07:00`);

      await confirmed(TENANT_A, claim(room, { startsAtMs: acrossMidnight }));
      // A hold on another hour of the same resource: pipeline, never booked.
      await create(
        TENANT_A,
        claim(room, {
          startsAtMs: Date.parse(`${nextDay}T09:00:00+07:00`)
        })
      );

      const report = await reportTx(TENANT_A, (tx) =>
        utilizationReport(tx, TENANT_A, {
          from: day,
          to: jakartaDate(9),
          resourceId: room.resourceId
        })
      );
      const resource = report.resources[0]!;

      expect(report.timezone).toBe("Asia/Jakarta");
      expect(resource.days.map((entry) => entry.date)).toEqual([day, nextDay]);
      // 23:30-24:00 on the first day, 00:00-00:30 on the second.
      expect(resource.days[0]!.bookedSeconds).toBe(1800);
      expect(resource.days[1]!.bookedSeconds).toBe(1800);
      // The schedule is open all day, so the denominator is 86 400 s per unit.
      expect(resource.days[0]!.availableSeconds).toBe(86_400);
      expect(resource.days[0]!.utilization).toBe(0.0208);
      expect(resource.totals.bookedSeconds).toBe(3600);
    });

    test("a closed day contributes no available time and no ratio", async () => {
      const room = await newFixture(TENANT_A, { capacity: 2 });
      const day = jakartaDate(12);

      await getAdminSql()`
        INSERT INTO awcms_booking_schedule_exceptions
          (tenant_id, resource_id, local_from, local_to, kind)
        VALUES (${TENANT_A}, ${room.resourceId}, ${day}::date,
                ${addDays(day, 1)}::date, 'closed')
      `;

      const report = await reportTx(TENANT_A, (tx) =>
        utilizationReport(tx, TENANT_A, {
          from: day,
          to: addDays(day, 2),
          resourceId: room.resourceId
        })
      );
      const days = report.resources[0]!.days;

      expect(days[0]).toMatchObject({ availableSeconds: 0, utilization: null });
      // Two units open all the next day.
      expect(days[1]!.availableSeconds).toBe(2 * 86_400);
    });
  });

  describe("hold pipeline, lead time, cancellation and small-group suppression", () => {
    test("a cohort of six shows its rates; the hold pipeline sits apart", async () => {
      const room = await newFixture(TENANT_A, {
        capacity: 8,
        confirmation: "hold_then_confirm"
      });
      const at = (hours: number) =>
        Date.parse(
          `${jakartaDate(5)}T${String(hours).padStart(2, "0")}:00:00+07:00`
        );
      const placed: string[] = [];

      for (let index = 0; index < 8; index += 1) {
        const hold = await create(
          TENANT_A,
          claim(room, { startsAtMs: at(10) })
        );

        placed.push(hold.id);
      }

      // 6 confirmed (lead time 4-7 days), 1 cancelled while held, 1 left open.
      for (const id of placed.slice(0, 6)) {
        await move(TENANT_A, id, "confirm");
      }

      await move(TENANT_A, placed[6]!, "cancel");
      // One confirmed booking cancelled afterwards.
      await move(TENANT_A, placed[0]!, "cancel");

      const report = await reportTx(TENANT_A, (tx) =>
        reservationsReport(tx, TENANT_A, {
          from: jakartaDate(0),
          to: jakartaDate(1),
          resourceId: room.resourceId
        })
      );

      expect(report.pipeline).toMatchObject({
        placed: 8,
        converted: 6,
        expired: 0,
        cancelledHeld: 1,
        openHoldsNow: 1,
        heldUnitsNow: 1
      });
      expect(report.pipeline.conversionRate).toEqual({
        suppressed: false,
        value: 0.75
      });

      expect(report.leadTime.reservations).toBe(6);
      expect(
        report.leadTime.buckets.find((bucket) => bucket.key === "4_7_days")!
          .reservations
      ).toBe(6);
      expect(
        report.leadTime.buckets.find((bucket) => bucket.key === "same_day")!
          .reservations
      ).toBe(0);
      expect(report.leadTime.meanDays.suppressed).toBe(false);
      expect(report.leadTime.meanDays.value).toBeGreaterThan(4);
      expect(report.leadTime.meanDays.value).toBeLessThan(6);

      expect(report.outcomes).toMatchObject({
        confirmed: 6,
        cancelled: 1,
        lateCancelled: 0,
        noShow: 0,
        arrived: 0
      });
      expect(report.outcomes.cancellationRate).toEqual({
        suppressed: false,
        value: 0.1667
      });
      // Nobody has arrived or failed to: no resolved arrivals, so no no-show rate.
      expect(report.outcomes.noShowRate.suppressed).toBe(true);
    });

    test("a cohort under five reports counts but no rate", async () => {
      const room = await newFixture(TENANT_A, {
        capacity: 3,
        confirmation: "immediate"
      });
      const startsAtMs = Date.parse(`${jakartaDate(6)}T10:00:00+07:00`);

      for (let index = 0; index < 3; index += 1) {
        await create(TENANT_A, claim(room, { startsAtMs }));
      }

      const report = await reportTx(TENANT_A, (tx) =>
        reservationsReport(tx, TENANT_A, {
          from: jakartaDate(0),
          to: jakartaDate(1),
          resourceId: room.resourceId
        })
      );

      expect(report.outcomes.confirmed).toBe(3);
      expect(report.outcomes.cancellationRate).toEqual({
        suppressed: true,
        value: null
      });
      expect(report.leadTime.meanDays).toEqual({
        suppressed: true,
        value: null
      });
      expect(report.pipeline.conversionRate.suppressed).toBe(true);
    });

    test("a window in the past or future of every event is empty, not an error", async () => {
      const report = await reportTx(TENANT_A, (tx) =>
        reservationsReport(tx, TENANT_A, {
          from: "2020-01-01",
          to: "2020-01-08",
          resourceId: null
        })
      );

      expect(report.pipeline.placed).toBe(0);
      expect(report.outcomes.confirmed).toBe(0);
      expect(report.outcomes.cancellationRate.suppressed).toBe(true);
    });
  });

  describe("no person and no money in the projections' source", () => {
    test("the columns the three streams read hold only a status word and four integers", async () => {
      const read = new Set<string>();

      for (const descriptor of BOOKING_REPORTING_PROJECTIONS) {
        for (const stream of descriptor.rebuildSource.streams) {
          read.add(stream.cursorColumn);

          for (const rule of stream.metrics) {
            if (rule.matchColumn) {
              read.add(rule.matchColumn);
            }
            if (rule.sumColumn) {
              read.add(rule.sumColumn);
            }
          }
        }
      }

      expect([...read].sort()).toEqual([
        "booked_nights",
        "booked_seconds",
        "created_at",
        "kind",
        "projection_kind",
        "released_nights",
        "released_seconds"
      ]);
    });
  });
});
