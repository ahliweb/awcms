/**
 * `booking` stays and blocked nights under real concurrency (Issue #940,
 * ADR-0135; docs/awcms/booking.md section 8.3, tests T9 to T13).
 *
 * The second exclusion constraint (`daterange(stay_from, stay_to, '[)')` over
 * live `granularity = 'stay'` rows) is the guarantee; this file proves it, and
 * the allocator, the block service and the lazy reclaim built on it, with
 * transactions that genuinely overlap:
 *
 *   * T9  -- the database level, interleaving PROVEN through `pg_stat_activity`:
 *            an overlapping stay blocks on an uncommitted one, then fails 23P01
 *            on commit and succeeds on rollback; adjacent ranges (same-day
 *            turnover) both commit; a one-night overlap conflicts; a released
 *            stay frees its nights;
 *   * T10 -- the final room, 20 contenders, repeated 50 times; a capacity-3
 *            variant where no stay is ever split across units;
 *   * T11 -- blocks against bookings: a block and a booking racing for one night
 *            are decided by the database (both orders, deterministically, and
 *            as a soak); a block over a live stay is BLOCK_CONFLICT and cancels
 *            nothing; a released block frees its nights; an elapsed unswept
 *            hold does not refuse a block; a block over several units is
 *            all-or-none;
 *   * T12 -- DST and zones through a real claim: the night count and the
 *            snapshot (zone, local times, derived instants) stored on the item;
 *   * T13 -- the test detects the defect: WITHOUT the stay constraint the same
 *            interleavings double-book; and the granularity guard.
 *
 * Plus what the stay slice adds around the constraint: lazy reclaim and the
 * `awcms_worker` sweep for a STAY hold (sql/200 needs no change: the expiry is
 * the same column and the release the same item join), the reconciliation
 * checks for blocks, the guards of `sql/204`, and the refusal values.
 *
 * Runs as the runtime role `awcms_app` (FORCE RLS in effect), each contender on
 * its own pooled connection and its own transaction. Time is driven by the
 * database clock: a hold is backdated through SQL, never by sleeping. T13 is the
 * LAST describe: it drops and restores a constraint.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
 */
import { NO_OP_STAFF_AVAILABILITY } from "../../src/modules/booking/domain/booking-staff-availability";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  assertRejected as assertRejectedByDatabase,
  createRuntimePool,
  getAdminSql,
  getWorkerRoleSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { answerAvailability } from "../../src/modules/booking/application/booking-availability-directory";
import {
  createBlock,
  releaseBlock,
  type CreateBlockOutcome
} from "../../src/modules/booking/application/booking-block-service";
import {
  expireDueHolds,
  reclaimExpiredHolds
} from "../../src/modules/booking/application/booking-hold-expiry";
import {
  placeHold,
  type PlaceHoldOutcome
} from "../../src/modules/booking/application/booking-hold-service";
import { runReconciliation } from "../../src/modules/booking/application/booking-reconciliation";
import type { PlaceHoldInput } from "../../src/modules/booking/domain/booking-allocation";
import type { CreateBlockInput } from "../../src/modules/booking/domain/booking-stay";

const TENANT_A = "b9400000-0000-4000-8000-00000000000a";
const TENANT_B = "b9400000-0000-4000-8000-00000000000b";
const ACTORS = new Map<string, string>();

let pool: Bun.SQL;
let sequence = 0;

/** The production transaction shape (`withTenant`) without the in-process work-class gate, so the DATABASE sees every contender at once. */
function tenantTx<T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return pool.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
    return fn(tx);
  });
}

/** The scheduled job's transaction shape: the BACKGROUND role under a per-tenant context. */
function workerTx<T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return getWorkerRoleSql().begin(async (tx) => {
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

function place(
  tenantId: string,
  input: PlaceHoldInput
): Promise<PlaceHoldOutcome> {
  return tenantTx(tenantId, (tx) => placeHold(tx, ctxOf(tenantId), input));
}

function block(
  tenantId: string,
  input: CreateBlockInput,
  reveal = false
): Promise<CreateBlockOutcome> {
  return tenantTx(tenantId, (tx) =>
    createBlock(tx, { ...ctxOf(tenantId), revealConflicts: reveal }, input)
  );
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

type Fixture = {
  resourceId: string;
  unitIds: string[];
  offeringId: string;
};

type FixtureOptions = {
  capacity?: number;
  mode?: "slot" | "stay";
  timezone?: string;
  checkIn?: string;
  checkOut?: string;
  minNights?: number;
  maxNights?: number;
  confirmation?: "immediate" | "hold_then_confirm";
  poolId?: string | null;
  sortOrder?: number;
};

/** A resource with `capacity` units and an offering of the matching granularity. Fresh codes, so tests share a tenant without truncating. */
async function newFixture(
  tenantId: string,
  options: FixtureOptions = {}
): Promise<Fixture> {
  const admin = getAdminSql();
  sequence += 1;
  const code = `s${sequence}`;
  const capacity = options.capacity ?? 1;
  const mode = options.mode ?? "stay";
  const resource = (await admin`
    INSERT INTO awcms_booking_resources
      (tenant_id, code, name, kind, capacity, timezone, sort_order, pool_id,
       booking_mode, stay_check_in_time, stay_check_out_time)
    VALUES (${tenantId}, ${code}, ${`Room ${code}`}, 'room', ${capacity},
            ${options.timezone ?? "Asia/Pontianak"}, ${options.sortOrder ?? 0},
            ${options.poolId ?? null}, ${mode},
            ${mode === "stay" ? (options.checkIn ?? "14:00") : null}::time,
            ${mode === "stay" ? (options.checkOut ?? "12:00") : null}::time)
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

  const confirmation = options.confirmation ?? "hold_then_confirm";
  const offering =
    mode === "stay"
      ? ((await admin`
          INSERT INTO awcms_booking_service_offerings
            (tenant_id, code, name, granularity, min_nights, max_nights,
             max_party, confirmation_mode)
          VALUES (${tenantId}, ${`night-${code}`}, 'Night', 'stay',
                  ${options.minNights ?? 1}, ${options.maxNights ?? 30}, 4,
                  ${confirmation})
          RETURNING id
        `) as { id: string }[])
      : ((await admin`
          INSERT INTO awcms_booking_service_offerings
            (tenant_id, code, name, granularity, duration_seconds, setup_seconds,
             cleanup_seconds, slot_step_seconds, max_party, confirmation_mode)
          VALUES (${tenantId}, ${`hour-${code}`}, 'Hour', 'time', 3600, 0, 0, 900,
                  4, ${confirmation})
          RETURNING id
        `) as { id: string }[]);

  return {
    resourceId: resource[0]!.id,
    unitIds,
    offeringId: offering[0]!.id
  };
}

/** Nights far enough ahead that "today" in any zone is before them. */
const D = (day: number, month = 6, year = 2031): string =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

function stayClaim(
  fixture: Fixture,
  checkInDate: string,
  checkOutDate: string,
  overrides: Partial<PlaceHoldInput> = {}
): PlaceHoldInput {
  return {
    offeringId: fixture.offeringId,
    resourceId: fixture.resourceId,
    stay: { checkInDate, checkOutDate },
    partySize: 1,
    quantity: 1,
    ...overrides
  };
}

function blockOf(
  fixture: Fixture,
  fromDate: string,
  toDate: string,
  overrides: Partial<CreateBlockInput> = {}
): CreateBlockInput {
  return {
    resourceId: fixture.resourceId,
    fromDate,
    toDate,
    reasonCode: "maintenance",
    ...overrides
  };
}

async function placedStay(
  tenantId: string,
  fixture: Fixture,
  checkIn: string,
  checkOut: string,
  overrides: Partial<PlaceHoldInput> = {}
) {
  const outcome = await place(
    tenantId,
    stayClaim(fixture, checkIn, checkOut, overrides)
  );

  if (outcome.outcome !== "ok") {
    throw new Error(`expected a placed stay, got ${JSON.stringify(outcome)}`);
  }

  return outcome.reservation;
}

async function placedBlock(
  tenantId: string,
  input: CreateBlockInput
): Promise<string> {
  const outcome = await block(tenantId, input);

  if (outcome.outcome !== "ok") {
    throw new Error(`expected a block, got ${JSON.stringify(outcome)}`);
  }

  return outcome.block.blockId;
}

async function liveAllocations(resourceId: string): Promise<number> {
  const rows = (await getAdminSql()`
    SELECT count(*)::int AS n
    FROM awcms_booking_resource_allocations
    WHERE resource_id = ${resourceId} AND released_at IS NULL
  `) as { n: number }[];

  return rows[0]!.n;
}

async function liveBlockRows(blockId: string): Promise<number> {
  const rows = (await getAdminSql()`
    SELECT count(*)::int AS n
    FROM awcms_booking_resource_allocations
    WHERE block_id = ${blockId} AND released_at IS NULL
  `) as { n: number }[];

  return rows[0]!.n;
}

async function reservationCount(tenantId: string): Promise<number> {
  const rows = (await getAdminSql()`
    SELECT count(*)::int AS n FROM awcms_booking_reservations
    WHERE tenant_id = ${tenantId}
  `) as { n: number }[];

  return rows[0]!.n;
}

async function blockCount(tenantId: string): Promise<number> {
  const rows = (await getAdminSql()`
    SELECT count(*)::int AS n FROM awcms_booking_resource_blocks
    WHERE tenant_id = ${tenantId}
  `) as { n: number }[];

  return rows[0]!.n;
}

/** Live overlapping pairs on one unit among a resource's stay rows: the double-booking, counted. */
async function overlappingStayPairs(resourceId: string): Promise<number> {
  const rows = (await getAdminSql()`
    SELECT count(*)::int AS n
    FROM awcms_booking_resource_allocations a
    JOIN awcms_booking_resource_allocations b
      ON a.resource_unit_id = b.resource_unit_id AND a.id < b.id
    WHERE a.resource_id = ${resourceId}
      AND a.released_at IS NULL AND b.released_at IS NULL
      AND a.granularity = 'stay' AND b.granularity = 'stay'
      AND daterange(a.stay_from, a.stay_to, '[)')
          && daterange(b.stay_from, b.stay_to, '[)')
  `) as { n: number }[];

  return rows[0]!.n;
}

/** Runs the contenders to completion and fails loudly if ANY threw: a lost race is a refusal VALUE, never an error. */
async function race<T = PlaceHoldOutcome>(
  contenders: ReadonlyArray<() => Promise<T>>
): Promise<T[]> {
  let go!: () => void;
  const start = new Promise<void>((resolve) => {
    go = resolve;
  });
  const running = contenders.map(async (contender) => {
    await start;
    return contender();
  });

  go();

  const settled = await Promise.allSettled(running);
  const errors = settled.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );

  if (errors.length > 0) {
    throw new Error(
      `${errors.length} contender(s) threw instead of returning a refusal: ${errors
        .map((error) => String(error.reason?.message ?? error.reason))
        .join(" | ")}`
    );
  }

  return settled.map((result) => (result as PromiseFulfilledResult<T>).value);
}

function tally(outcomes: readonly PlaceHoldOutcome[]) {
  const codes = new Map<string, number>();
  let ok = 0;

  for (const outcome of outcomes) {
    if (outcome.outcome === "ok") {
      ok += 1;
    } else if (outcome.outcome === "refused") {
      codes.set(outcome.code, (codes.get(outcome.code) ?? 0) + 1);
    } else {
      codes.set("INVALID", (codes.get("INVALID") ?? 0) + 1);
    }
  }

  return { ok, codes };
}

/** Test-only: shorten a hold through SQL (the update guard forbids shortening, the database clock is the only clock). */
async function backdateHold(reservationId: string): Promise<void> {
  const admin = getAdminSql();

  await admin.begin(async (tx) => {
    await tx.unsafe(
      "ALTER TABLE awcms_booking_reservations DISABLE TRIGGER awcms_booking_reservations_update_guard"
    );
    await tx`
      UPDATE awcms_booking_reservations
      SET hold_expires_at = clock_timestamp() - interval '2 seconds'
      WHERE id = ${reservationId}
    `;
    await tx.unsafe(
      "ALTER TABLE awcms_booking_reservations ENABLE TRIGGER awcms_booking_reservations_update_guard"
    );
  });
}

/** Polls until a backend is blocked on a heavyweight lock inside an allocation INSERT. */
async function waitForBlockedAllocationInsert(): Promise<void> {
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    const rows = (await getAdminSql()`
      SELECT count(*)::int AS n
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND query ILIKE '%INSERT INTO awcms_booking_resource_allocations%'
    `) as { n: number }[];

    if (rows[0]!.n > 0) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(
    "the second allocation INSERT never blocked on the first: the interleaving was not proven"
  );
}

/**
 * Runs `work` inside a tenant transaction and returns a handle that keeps the
 * transaction OPEN (its rows uncommitted) until `commit()` or `abort()`.
 */
function openTransaction<T>(
  tenantId: string,
  work: (tx: Bun.TransactionSQL) => Promise<T>
): {
  opened: Promise<T>;
  commit: () => Promise<void>;
  abort: () => Promise<void>;
} {
  class Abort extends Error {}

  let release!: (mode: "commit" | "abort") => void;
  const gate = new Promise<"commit" | "abort">((resolve) => {
    release = resolve;
  });
  let opened!: (value: T) => void;
  const openedPromise = new Promise<T>((resolve) => {
    opened = resolve;
  });
  const finished = tenantTx(tenantId, async (tx) => {
    opened(await work(tx));

    if ((await gate) === "abort") {
      throw new Abort("abort");
    }
  }).catch((error) => {
    if (!(error instanceof Abort)) {
      throw error;
    }
  });

  return {
    opened: openedPromise,
    commit: async () => {
      release("commit");
      await finished;
    },
    abort: async () => {
      release("abort");
      await finished;
    }
  };
}

type RawStay = { reservationId: string; itemId: string };

/**
 * Inserts a held reservation, a stay item and a stay allocation for `unitId`
 * with RAW SQL (no `ON CONFLICT`), in the given transaction. This is the shape
 * T9 needs: the constraint's own verdict, not the allocator's absorption of it.
 */
async function rawStayAllocation(
  tx: Bun.TransactionSQL,
  tenantId: string,
  fixture: Fixture,
  unitId: string,
  checkIn: string,
  checkOut: string
): Promise<RawStay> {
  const reservation = (await tx`
    INSERT INTO awcms_booking_reservations
      (tenant_id, status, starts_at, ends_at, hold_expires_at, created_by)
    VALUES (${tenantId}, 'held', ${`${checkIn}T07:00:00Z`}::timestamptz,
            ${`${checkOut}T05:00:00Z`}::timestamptz,
            clock_timestamp() + interval '15 minutes', ${ACTORS.get(tenantId)!})
    RETURNING id
  `) as { id: string }[];
  const item = (await tx`
    INSERT INTO awcms_booking_reservation_items
      (tenant_id, reservation_id, line_no, offering_id, offering_code,
       offering_name, granularity, starts_at, ends_at, check_in_date,
       check_out_date, nights, check_in_local_time, check_out_local_time, timezone)
    VALUES (${tenantId}, ${reservation[0]!.id}, 1, ${fixture.offeringId}, 'night',
            'Night', 'stay', ${`${checkIn}T07:00:00Z`}::timestamptz,
            ${`${checkOut}T05:00:00Z`}::timestamptz, ${checkIn}::date,
            ${checkOut}::date, ${checkOut}::date - ${checkIn}::date, '14:00',
            '12:00', 'Asia/Pontianak')
    RETURNING id
  `) as { id: string }[];

  await tx`
    INSERT INTO awcms_booking_resource_allocations
      (tenant_id, item_id, resource_id, resource_unit_id, granularity, starts_at,
       ends_at, stay_from, stay_to)
    VALUES (${tenantId}, ${item[0]!.id}, ${fixture.resourceId}, ${unitId}, 'stay',
            ${`${checkIn}T07:00:00Z`}::timestamptz,
            ${`${checkOut}T05:00:00Z`}::timestamptz, ${checkIn}::date, ${checkOut}::date)
  `;

  return { reservationId: reservation[0]!.id, itemId: item[0]!.id };
}

/** Polls until a backend whose query matches `pattern` is waiting on a heavyweight lock. */
async function waitForLockWait(pattern: string): Promise<void> {
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    const rows = (await getAdminSql()`
      SELECT count(*)::int AS n
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND query ILIKE ${`%${pattern}%`}
    `) as { n: number }[];

    if (rows[0]!.n > 0) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`nothing waited on a lock inside "${pattern}"`);
}

async function addUnit(
  tx: Bun.SQL,
  tenantId: string,
  resourceId: string,
  ordinal: number
): Promise<string> {
  const rows = (await tx`
    INSERT INTO awcms_booking_resource_units (tenant_id, resource_id, ordinal)
    VALUES (${tenantId}, ${resourceId}, ${ordinal})
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

/** Units of a resource that hold NO live row of an active resource-wide block over them. */
async function uncoveredUnits(resourceId: string): Promise<number> {
  const rows = (await getAdminSql()`
    SELECT count(*)::int AS n
    FROM awcms_booking_resource_blocks b
    JOIN awcms_booking_resource_units u
      ON u.tenant_id = b.tenant_id AND u.resource_id = b.resource_id
    WHERE b.resource_id = ${resourceId} AND b.resource_unit_id IS NULL
      AND b.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM awcms_booking_resource_allocations a
        WHERE a.tenant_id = b.tenant_id AND a.block_id = b.id
          AND a.resource_unit_id = u.id AND a.released_at IS NULL)
  `) as { n: number }[];

  return rows[0]!.n;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("booking stays and blocked nights (Issue #940, ADR-0135)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
    await resetDatabase();
    pool = createRuntimePool(32);
    await seedTenant(TENANT_A, "stay-a");
    await seedTenant(TENANT_B, "stay-b");
  });

  afterAll(async () => {
    await pool?.close({ timeout: 1 });
    await teardownIntegrationDatabase();
  });

  describe("T9 -- stays at the database level, the interleaving proven", () => {
    test("(a) an overlapping stay BLOCKS on an uncommitted one, then fails 23P01 when it commits", async () => {
      const fixture = await newFixture(TENANT_A);
      const unit = fixture.unitIds[0]!;
      const first = openTransaction(TENANT_A, (tx) =>
        rawStayAllocation(tx, TENANT_A, fixture, unit, D(10), D(12))
      );

      await first.opened;

      // B overlaps A on the 11th and starts WITHOUT awaiting.
      let outcome: unknown = "pending";
      const second = tenantTx(TENANT_A, (tx) =>
        rawStayAllocation(tx, TENANT_A, fixture, unit, D(11), D(13))
      ).then(
        () => {
          outcome = "committed";
        },
        (error) => {
          outcome = error;
        }
      );

      await waitForBlockedAllocationInsert();
      expect(outcome).toBe("pending");

      await first.commit();
      await second;

      expect(String((outcome as { errno?: unknown }).errno)).toBe("23P01");
      expect(await liveAllocations(fixture.resourceId)).toBe(1);
    });

    test("(a) when the first ROLLS BACK the blocked stay takes the nights", async () => {
      const fixture = await newFixture(TENANT_A);
      const unit = fixture.unitIds[0]!;
      const first = openTransaction(TENANT_A, (tx) =>
        rawStayAllocation(tx, TENANT_A, fixture, unit, D(10), D(12))
      );

      await first.opened;

      const second = tenantTx(TENANT_A, (tx) =>
        rawStayAllocation(tx, TENANT_A, fixture, unit, D(11), D(13))
      );

      await waitForBlockedAllocationInsert();
      await first.abort();
      await second;

      expect(await liveAllocations(fixture.resourceId)).toBe(1);
    });

    test("(a') the ALLOCATOR's ON CONFLICT DO NOTHING waits for the in-doubt stay, then skips it (commit) or takes the unit (rollback)", async () => {
      const lost = await newFixture(TENANT_A);
      const firstLost = openTransaction(TENANT_A, (tx) =>
        placeHold(tx, ctxOf(TENANT_A), stayClaim(lost, D(10), D(12)))
      );

      expect((await firstLost.opened).outcome).toBe("ok");

      const secondLost = place(TENANT_A, stayClaim(lost, D(11), D(13)));

      await waitForBlockedAllocationInsert();
      await firstLost.commit();
      expect(await secondLost).toMatchObject({
        outcome: "refused",
        code: "SLOT_UNAVAILABLE"
      });
      expect(await liveAllocations(lost.resourceId)).toBe(1);

      const won = await newFixture(TENANT_A);
      const firstWon = openTransaction(TENANT_A, (tx) =>
        placeHold(tx, ctxOf(TENANT_A), stayClaim(won, D(10), D(12)))
      );

      expect((await firstWon.opened).outcome).toBe("ok");

      const secondWon = place(TENANT_A, stayClaim(won, D(11), D(13)));

      await waitForBlockedAllocationInsert();
      await firstWon.abort();
      expect((await secondWon).outcome).toBe("ok");
      expect(await liveAllocations(won.resourceId)).toBe(1);
    });

    test("(b) adjacent stays both commit: the 12th is one's check-out and the other's check-in (same-day turnover)", async () => {
      const fixture = await newFixture(TENANT_A);

      await placedStay(TENANT_A, fixture, D(10), D(12));
      await placedStay(TENANT_A, fixture, D(12), D(14));
      await placedStay(TENANT_A, fixture, D(8), D(10));
      expect(await liveAllocations(fixture.resourceId)).toBe(3);
      expect(await overlappingStayPairs(fixture.resourceId)).toBe(0);
    });

    test("(c) a one-night overlap conflicts: [10th, 12th) and [11th, 12th) share night 11", async () => {
      const fixture = await newFixture(TENANT_A);

      await placedStay(TENANT_A, fixture, D(10), D(12));
      expect(
        await place(TENANT_A, stayClaim(fixture, D(11), D(12)))
      ).toMatchObject({ outcome: "refused", code: "SLOT_UNAVAILABLE" });
      // Containing and contained, and the edges on either side.
      expect(
        await place(TENANT_A, stayClaim(fixture, D(9), D(13)))
      ).toMatchObject({ outcome: "refused", code: "SLOT_UNAVAILABLE" });
      expect(
        await place(TENANT_A, stayClaim(fixture, D(9), D(11)))
      ).toMatchObject({ outcome: "refused", code: "SLOT_UNAVAILABLE" });
      expect(await liveAllocations(fixture.resourceId)).toBe(1);
    });

    test("(d) a released stay no longer blocks its nights", async () => {
      const fixture = await newFixture(TENANT_A);
      const stay = await placedStay(TENANT_A, fixture, D(10), D(12));

      expect(
        await place(TENANT_A, stayClaim(fixture, D(10), D(12)))
      ).toMatchObject({ outcome: "refused", code: "SLOT_UNAVAILABLE" });

      await getAdminSql()`
        UPDATE awcms_booking_reservations
        SET status = 'cancelled', cancel_reason_code = 'guest_request'
        WHERE id = ${stay.reservationId}
      `;
      await getAdminSql()`
        UPDATE awcms_booking_resource_allocations a
        SET released_at = clock_timestamp(), released_reason = 'cancelled'
        FROM awcms_booking_reservation_items i
        WHERE i.id = a.item_id AND i.reservation_id = ${stay.reservationId}
      `;

      expect(
        (await place(TENANT_A, stayClaim(fixture, D(10), D(12)))).outcome
      ).toBe("ok");
    });

    test("different units of one resource are independent; a stay stays on ONE unit for all its nights", async () => {
      const fixture = await newFixture(TENANT_A, { capacity: 2 });
      const first = await placedStay(TENANT_A, fixture, D(10), D(14));
      const second = await placedStay(TENANT_A, fixture, D(12), D(16));

      expect(first.units[0]!.unitId).not.toBe(second.units[0]!.unitId);

      // One row per unit, carrying the WHOLE range: never one row per night.
      const rows = (await getAdminSql()`
        SELECT to_char(stay_from, 'YYYY-MM-DD') AS stay_from,
               to_char(stay_to, 'YYYY-MM-DD') AS stay_to
        FROM awcms_booking_resource_allocations
        WHERE resource_id = ${fixture.resourceId}
        ORDER BY stay_from
      `) as { stay_from: string; stay_to: string }[];

      expect(rows).toEqual([
        { stay_from: D(10), stay_to: D(14) },
        { stay_from: D(12), stay_to: D(16) }
      ]);
    });
  });

  describe("T10 -- the final room, many contenders", () => {
    test("20 parallel claims for the last room: exactly one wins, nineteen are SLOT_UNAVAILABLE, one live allocation -- repeated 50 times", async () => {
      for (let round = 0; round < 50; round += 1) {
        const fixture = await newFixture(TENANT_A);
        const outcomes = await race(
          Array.from(
            { length: 20 },
            (_, index) => () =>
              place(
                TENANT_A,
                stayClaim(fixture, D(10), D(12), {
                  externalCustomerRef: `cust-${round}-${index}`
                })
              )
          )
        );
        const { ok, codes } = tally(outcomes);

        expect({ round, ok }).toEqual({ round, ok: 1 });
        expect({ round, codes: Object.fromEntries(codes) }).toEqual({
          round,
          codes: { SLOT_UNAVAILABLE: 19 }
        });
        expect(await liveAllocations(fixture.resourceId)).toBe(1);
      }
    }, 240_000);

    test("the losers wrote NOTHING: one reservation, one item, one allocation, two history rows", async () => {
      const fixture = await newFixture(TENANT_A);
      const before = await reservationCount(TENANT_A);

      await race(
        Array.from(
          { length: 12 },
          () => () => place(TENANT_A, stayClaim(fixture, D(10), D(12)))
        )
      );

      expect((await reservationCount(TENANT_A)) - before).toBe(1);

      const rows = (await getAdminSql()`
        SELECT (SELECT count(*) FROM awcms_booking_reservation_items i
                WHERE i.offering_id = ${fixture.offeringId})::int AS items,
               (SELECT count(*) FROM awcms_booking_reservation_events e
                JOIN awcms_booking_reservation_items i
                  ON i.reservation_id = e.reservation_id
                WHERE i.offering_id = ${fixture.offeringId})::int AS events
      `) as { items: number; events: number }[];

      expect(rows[0]).toEqual({ items: 1, events: 2 });
    });

    test("capacity 3, 10 contenders: exactly 3 win on 3 distinct units, and no stay is ever split across units", async () => {
      const fixture = await newFixture(TENANT_A, { capacity: 3 });
      const outcomes = await race(
        Array.from(
          { length: 10 },
          () => () => place(TENANT_A, stayClaim(fixture, D(10), D(13)))
        )
      );
      const { ok, codes } = tally(outcomes);

      expect(ok).toBe(3);
      expect(Object.fromEntries(codes)).toEqual({ SLOT_UNAVAILABLE: 7 });

      const units = outcomes.flatMap((outcome) =>
        outcome.outcome === "ok"
          ? outcome.reservation.units.map((unit) => unit.unitId)
          : []
      );

      expect([...new Set(units)].sort()).toEqual([...fixture.unitIds].sort());
      expect(await liveAllocations(fixture.resourceId)).toBe(3);

      // Each winning item owns ONE row for the WHOLE range.
      const perItem = (await getAdminSql()`
        SELECT count(*)::int AS rows,
               count(DISTINCT a.resource_unit_id)::int AS units,
               min(to_char(a.stay_from, 'YYYY-MM-DD')) AS stay_from,
               max(to_char(a.stay_to, 'YYYY-MM-DD')) AS stay_to
        FROM awcms_booking_resource_allocations a
        WHERE a.resource_id = ${fixture.resourceId} AND a.released_at IS NULL
        GROUP BY a.item_id
      `) as {
        rows: number;
        units: number;
        stay_from: string;
        stay_to: string;
      }[];

      expect(perItem).toHaveLength(3);

      for (const item of perItem) {
        expect(item).toEqual({
          rows: 1,
          units: 1,
          stay_from: D(10),
          stay_to: D(13)
        });
      }
    });

    test("4 rooms, 6 contenders for 2 rooms each: exactly 2 win, nobody holds half", async () => {
      const fixture = await newFixture(TENANT_A, { capacity: 4 });
      const outcomes = await race(
        Array.from(
          { length: 6 },
          () => () =>
            place(TENANT_A, stayClaim(fixture, D(10), D(12), { quantity: 2 }))
        )
      );
      const { ok } = tally(outcomes);

      expect(ok).toBe(2);
      expect(await liveAllocations(fixture.resourceId)).toBe(4);
      expect(await overlappingStayPairs(fixture.resourceId)).toBe(0);

      const perItem = (await getAdminSql()`
        SELECT count(*)::int AS rows
        FROM awcms_booking_resource_allocations
        WHERE resource_id = ${fixture.resourceId} AND released_at IS NULL
        GROUP BY item_id
      `) as { rows: number }[];

      expect(perItem.map((item) => item.rows)).toEqual([2, 2]);
    });

    test("a claim for 2 rooms when 1 remains is refused and leaves NO partial allocation", async () => {
      const fixture = await newFixture(TENANT_A, { capacity: 2 });

      await placedStay(TENANT_A, fixture, D(10), D(12));

      const before = await reservationCount(TENANT_A);
      const outcome = await place(
        TENANT_A,
        stayClaim(fixture, D(10), D(12), { quantity: 2 })
      );

      expect(outcome).toMatchObject({
        outcome: "refused",
        code: "SLOT_UNAVAILABLE"
      });
      expect(await liveAllocations(fixture.resourceId)).toBe(1);
      expect(await reservationCount(TENANT_A)).toBe(before);
    });

    test("a mixed soak -- overlapping ranges on 2 rooms, 1 or 2 rooms each: no unit is ever held twice over overlapping nights", async () => {
      const fixture = await newFixture(TENANT_A, { capacity: 2 });
      let seed = 7;
      const next = () => {
        seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
        return seed;
      };
      const contenders = Array.from({ length: 24 }, () => {
        const from = 10 + (next() % 8);
        const nights = 1 + (next() % 4);
        const quantity = 1 + (next() % 2);

        return () =>
          place(
            TENANT_A,
            stayClaim(fixture, D(from), D(from + nights), { quantity })
          );
      });
      const outcomes = await race(contenders);

      expect(tally(outcomes).ok).toBeGreaterThan(0);
      expect(await overlappingStayPairs(fixture.resourceId)).toBe(0);

      // Every win owns exactly its quantity of distinct units.
      for (const outcome of outcomes) {
        if (outcome.outcome === "ok") {
          const units = outcome.reservation.units.map((unit) => unit.unitId);

          expect(new Set(units).size).toBe(outcome.reservation.quantity);
        }
      }
    });

    test("a slot resource and a stay resource never contend: both races each have exactly one winner at once", async () => {
      const stay = await newFixture(TENANT_A);
      const slot = await newFixture(TENANT_A, { mode: "slot" });
      const outcomes = await race([
        ...Array.from(
          { length: 8 },
          () => () => place(TENANT_A, stayClaim(stay, D(10), D(12)))
        ),
        ...Array.from(
          { length: 8 },
          () => () =>
            place(TENANT_A, {
              offeringId: slot.offeringId,
              resourceId: slot.resourceId,
              startsAtMs: Date.parse("2031-06-10T07:00:00Z"),
              partySize: 1,
              quantity: 1
            })
        )
      ]);

      expect(tally(outcomes).ok).toBe(2);
      expect(await liveAllocations(stay.resourceId)).toBe(1);
      expect(await liveAllocations(slot.resourceId)).toBe(1);
    });
  });

  describe("T11 -- blocks against bookings", () => {
    test("(a) a block and a booking racing for one night: whoever commits first wins, the other is refused -- BOTH orders, deterministic", async () => {
      // The block holds the night, uncommitted; the booking waits, then loses.
      const blockFirst = await newFixture(TENANT_A);
      const openBlock = openTransaction(TENANT_A, (tx) =>
        createBlock(tx, ctxOf(TENANT_A), blockOf(blockFirst, D(10), D(12)))
      );

      expect((await openBlock.opened).outcome).toBe("ok");

      const booking = place(TENANT_A, stayClaim(blockFirst, D(11), D(13)));

      await waitForBlockedAllocationInsert();
      await openBlock.commit();
      expect(await booking).toMatchObject({
        outcome: "refused",
        code: "SLOT_UNAVAILABLE"
      });
      expect(await liveAllocations(blockFirst.resourceId)).toBe(1);

      // The booking holds the night, uncommitted; the block waits, then loses.
      const bookingFirst = await newFixture(TENANT_A);
      const openBooking = openTransaction(TENANT_A, (tx) =>
        placeHold(tx, ctxOf(TENANT_A), stayClaim(bookingFirst, D(11), D(13)))
      );

      expect((await openBooking.opened).outcome).toBe("ok");

      const blocked = block(TENANT_A, blockOf(bookingFirst, D(10), D(12)));

      await waitForBlockedAllocationInsert();
      await openBooking.commit();
      expect(await blocked).toMatchObject({
        outcome: "refused",
        code: "BLOCK_CONFLICT"
      });
      expect(await liveAllocations(bookingFirst.resourceId)).toBe(1);
      expect(await blockCount(TENANT_A)).toBeGreaterThan(0);
    });

    test("(a) and when the booking ROLLS BACK the waiting block takes the nights", async () => {
      const fixture = await newFixture(TENANT_A);
      const openBooking = openTransaction(TENANT_A, (tx) =>
        placeHold(tx, ctxOf(TENANT_A), stayClaim(fixture, D(10), D(12)))
      );

      expect((await openBooking.opened).outcome).toBe("ok");

      const blocked = block(TENANT_A, blockOf(fixture, D(10), D(12)));

      await waitForBlockedAllocationInsert();
      await openBooking.abort();
      expect((await blocked).outcome).toBe("ok");
      expect(await liveAllocations(fixture.resourceId)).toBe(1);
    });

    test("(a) a soak of 10 bookings and 5 blocks for the same night: exactly one commits, 30 times", async () => {
      for (let round = 0; round < 30; round += 1) {
        const fixture = await newFixture(TENANT_A);
        const contenders: Array<() => Promise<"booking" | "block" | "lost">> = [
          ...Array.from(
            { length: 10 },
            () => async () =>
              (await place(TENANT_A, stayClaim(fixture, D(10), D(12))))
                .outcome === "ok"
                ? ("booking" as const)
                : ("lost" as const)
          ),
          ...Array.from(
            { length: 5 },
            () => async () =>
              (await block(TENANT_A, blockOf(fixture, D(11), D(13))))
                .outcome === "ok"
                ? ("block" as const)
                : ("lost" as const)
          )
        ];
        const results = await race(contenders);
        const winners = results.filter((result) => result !== "lost");

        expect({ round, winners: winners.length }).toEqual({
          round,
          winners: 1
        });
        expect(await liveAllocations(fixture.resourceId)).toBe(1);
        expect(await overlappingStayPairs(fixture.resourceId)).toBe(0);
      }
    }, 240_000);

    test("(a) the losers of a block race wrote NOTHING: no block row, no allocation, no audit", async () => {
      const fixture = await newFixture(TENANT_A);
      const before = await blockCount(TENANT_A);

      await race(
        Array.from(
          { length: 8 },
          () => () => block(TENANT_A, blockOf(fixture, D(10), D(12)))
        )
      );

      expect((await blockCount(TENANT_A)) - before).toBe(1);
      expect(await liveAllocations(fixture.resourceId)).toBe(1);

      const audit = (await getAdminSql()`
        SELECT count(*)::int AS n FROM awcms_audit_events
        WHERE tenant_id = ${TENANT_A} AND action = 'booking.block.created'
          AND attributes->>'resourceId' = ${fixture.resourceId}
      `) as { n: number }[];

      expect(audit[0]!.n).toBe(1);
    });

    test("(b) a block over an existing stay is BLOCK_CONFLICT, writes nothing and cancels nothing", async () => {
      const fixture = await newFixture(TENANT_A, { capacity: 2 });
      const stay = await placedStay(TENANT_A, fixture, D(10), D(14), {
        externalCustomerRef: "private-guest-ref"
      });
      const blocksBefore = await blockCount(TENANT_A);
      const refused = await block(
        TENANT_A,
        blockOf(fixture, D(12), D(16)),
        true
      );

      expect(refused).toMatchObject({
        outcome: "refused",
        code: "BLOCK_CONFLICT",
        httpStatus: 409
      });
      // The operator is told WHICH reservation to move first, and nothing else.
      expect(
        refused.outcome === "refused" ? refused.conflicts?.reservations : []
      ).toEqual([
        {
          reservationId: stay.reservationId,
          reservationNo: stay.reservationNo,
          status: "held",
          checkInDate: D(10),
          checkOutDate: D(14)
        }
      ]);
      expect(JSON.stringify(refused)).not.toContain("private-guest-ref");
      expect(await blockCount(TENANT_A)).toBe(blocksBefore);

      // Nothing was cancelled: the reservation is untouched with its live nights,
      // and the unit that was free got no block row either (all-or-none).
      const state = (await getAdminSql()`
        SELECT r.status,
               (SELECT count(*) FROM awcms_booking_resource_allocations a
                WHERE a.resource_id = ${fixture.resourceId}
                  AND a.released_at IS NULL)::int AS live
        FROM awcms_booking_reservations r WHERE r.id = ${stay.reservationId}
      `) as { status: string; live: number }[];

      expect(state[0]).toEqual({ status: "held", live: 1 });
    });

    test("(b) without `revealConflicts` a refused block says nights are taken, not by whom", async () => {
      const fixture = await newFixture(TENANT_A);

      await placedStay(TENANT_A, fixture, D(10), D(12));

      const refused = await block(TENANT_A, blockOf(fixture, D(10), D(12)));

      expect(refused).toMatchObject({
        outcome: "refused",
        code: "BLOCK_CONFLICT"
      });
      expect(
        refused.outcome === "refused" ? refused.conflicts : "x"
      ).toBeUndefined();
    });

    test("(b) a block over another block conflicts too, and names it", async () => {
      const fixture = await newFixture(TENANT_A);
      const first = await placedBlock(TENANT_A, blockOf(fixture, D(10), D(14)));
      const second = await block(
        TENANT_A,
        blockOf(fixture, D(12), D(16), { reasonCode: "owner_use" }),
        true
      );

      expect(second).toMatchObject({
        outcome: "refused",
        code: "BLOCK_CONFLICT"
      });
      expect(
        second.outcome === "refused"
          ? second.conflicts?.blocks.map((b) => b.blockId)
          : []
      ).toEqual([first]);
    });

    test("a stay cannot be placed on a blocked night, but the nights either side are free", async () => {
      const fixture = await newFixture(TENANT_A);

      await placedBlock(TENANT_A, blockOf(fixture, D(10), D(12)));

      expect(
        await place(TENANT_A, stayClaim(fixture, D(11), D(13)))
      ).toMatchObject({ outcome: "refused", code: "SLOT_UNAVAILABLE" });
      expect(
        await place(TENANT_A, stayClaim(fixture, D(9), D(11)))
      ).toMatchObject({ outcome: "refused", code: "SLOT_UNAVAILABLE" });
      // [12th, 14th) starts on the block's exclusive end; [8th, 10th) ends on its start.
      expect(
        (await place(TENANT_A, stayClaim(fixture, D(12), D(14)))).outcome
      ).toBe("ok");
      expect(
        (await place(TENANT_A, stayClaim(fixture, D(8), D(10)))).outcome
      ).toBe("ok");
    });

    test("(c) a released block frees its nights; releasing again is a replay that writes nothing", async () => {
      const fixture = await newFixture(TENANT_A);
      const blockId = await placedBlock(
        TENANT_A,
        blockOf(fixture, D(10), D(12))
      );

      expect(
        await place(TENANT_A, stayClaim(fixture, D(10), D(12)))
      ).toMatchObject({ outcome: "refused", code: "SLOT_UNAVAILABLE" });

      const released = await tenantTx(TENANT_A, (tx) =>
        releaseBlock(tx, ctxOf(TENANT_A), blockId)
      );

      expect(released).toEqual({
        outcome: "ok",
        blockId,
        replayed: false,
        releasedAllocations: 1
      });
      expect(await liveBlockRows(blockId)).toBe(0);
      expect(
        (await place(TENANT_A, stayClaim(fixture, D(10), D(12)))).outcome
      ).toBe("ok");

      const reason = (await getAdminSql()`
        SELECT released_reason FROM awcms_booking_resource_allocations
        WHERE block_id = ${blockId}
      `) as { released_reason: string }[];

      expect(reason).toEqual([{ released_reason: "block_released" }]);

      const audits = (await getAdminSql()`
        SELECT count(*)::int AS n FROM awcms_audit_events
        WHERE tenant_id = ${TENANT_A} AND resource_id = ${blockId}
      `) as { n: number }[];
      const again = await tenantTx(TENANT_A, (tx) =>
        releaseBlock(tx, ctxOf(TENANT_A), blockId)
      );
      const auditsAfter = (await getAdminSql()`
        SELECT count(*)::int AS n FROM awcms_audit_events
        WHERE tenant_id = ${TENANT_A} AND resource_id = ${blockId}
      `) as { n: number }[];

      expect(again).toMatchObject({ outcome: "ok", replayed: true });
      expect(auditsAfter[0]!.n).toBe(audits[0]!.n);
    });

    test("(c) two concurrent releases of one block: one releases, the other replays", async () => {
      const fixture = await newFixture(TENANT_A, { capacity: 3 });
      const blockId = await placedBlock(
        TENANT_A,
        blockOf(fixture, D(10), D(12))
      );
      const results = await race(
        Array.from(
          { length: 6 },
          () => () =>
            tenantTx(TENANT_A, (tx) =>
              releaseBlock(tx, ctxOf(TENANT_A), blockId)
            )
        )
      );
      const fresh = results.filter(
        (result) => result.outcome === "ok" && !result.replayed
      );

      expect(fresh).toHaveLength(1);
      expect(fresh[0]).toMatchObject({ releasedAllocations: 3 });
      expect(await liveBlockRows(blockId)).toBe(0);
    });

    test("(d) an elapsed, unswept hold on the nights does not refuse a block (lazy reclaim)", async () => {
      const fixture = await newFixture(TENANT_A);
      const hold = await placedStay(TENANT_A, fixture, D(10), D(12));

      // Before it elapses the nights are genuinely held.
      expect(
        await block(TENANT_A, blockOf(fixture, D(11), D(13)))
      ).toMatchObject({ outcome: "refused", code: "BLOCK_CONFLICT" });

      await backdateHold(hold.reservationId);

      const outcome = await block(TENANT_A, blockOf(fixture, D(11), D(13)));

      expect(outcome.outcome).toBe("ok");

      const rows = (await getAdminSql()`
        SELECT r.status,
               (SELECT detail->>'trigger' FROM awcms_booking_reservation_events e
                WHERE e.reservation_id = r.id AND e.kind = 'expired') AS via
        FROM awcms_booking_reservations r WHERE r.id = ${hold.reservationId}
      `) as { status: string; via: string }[];

      expect(rows[0]).toEqual({ status: "expired", via: "lazy_reclaim" });
      expect(await liveAllocations(fixture.resourceId)).toBe(1);
    });

    test("(e) a block over several units is all-or-none: one unit held means NO unit blocked", async () => {
      const fixture = await newFixture(TENANT_A, { capacity: 3 });

      // The LAST unit (ordinal 3) is booked, so a resource-wide block takes
      // units 1 and 2 first and then loses unit 3.
      await placedStay(TENANT_A, fixture, D(10), D(12));
      await placedStay(TENANT_A, fixture, D(10), D(12));
      await placedStay(TENANT_A, fixture, D(10), D(12));
      await getAdminSql()`
        UPDATE awcms_booking_resource_allocations
        SET released_at = clock_timestamp(), released_reason = 'cancelled'
        WHERE resource_id = ${fixture.resourceId}
          AND resource_unit_id IN (${fixture.unitIds[0]!}, ${fixture.unitIds[1]!})
      `;

      expect(await liveAllocations(fixture.resourceId)).toBe(1);

      const blocksBefore = await blockCount(TENANT_A);

      expect(
        await block(TENANT_A, blockOf(fixture, D(10), D(12)))
      ).toMatchObject({ outcome: "refused", code: "BLOCK_CONFLICT" });
      expect(await blockCount(TENANT_A)).toBe(blocksBefore);
      expect(await liveAllocations(fixture.resourceId)).toBe(1);

      // Naming a free unit works and takes exactly that one.
      const one = await block(
        TENANT_A,
        blockOf(fixture, D(10), D(12), { unitId: fixture.unitIds[0]! })
      );

      expect(one.outcome === "ok" ? one.block.units : []).toHaveLength(1);
      expect(await liveAllocations(fixture.resourceId)).toBe(2);
    });

    test("a resource-wide block takes one row per unit, in a stable order, under one block", async () => {
      const fixture = await newFixture(TENANT_A, { capacity: 4 });
      const outcome = await block(TENANT_A, blockOf(fixture, D(10), D(20)));

      expect(outcome.outcome).toBe("ok");

      if (outcome.outcome === "ok") {
        expect(outcome.block.nights).toBe(10);
        expect(outcome.block.units.map((unit) => unit.unitId)).toEqual(
          fixture.unitIds
        );
        expect(await liveBlockRows(outcome.block.blockId)).toBe(4);
      }

      expect(
        await place(TENANT_A, stayClaim(fixture, D(15), D(16)))
      ).toMatchObject({ outcome: "refused", code: "SLOT_UNAVAILABLE" });
    });

    test("availability still says BLOCKED, not NO_UNIT_AVAILABLE, once a block owns allocation rows", async () => {
      const fixture = await newFixture(TENANT_A);

      // Inside the default one-year horizon, so BEYOND_HORIZON is not in play.
      const soon = (day: number) => D(day, 12, 2026);

      await placedBlock(TENANT_A, blockOf(fixture, soon(10), soon(12)));

      const answer = await tenantTx(TENANT_A, (tx) =>
        answerAvailability(tx, TENANT_A, {
          mode: "stay",
          resourceId: fixture.resourceId,
          offeringId: fixture.offeringId,
          checkInDate: soon(10),
          checkOutDate: soon(12),
          quantity: 1
        } as Parameters<typeof answerAvailability>[2])
      );

      expect(answer.outcome).toBe("ok");
      expect(
        answer.outcome === "ok" && answer.answer.mode === "stay"
          ? answer.answer.reasons.map((reason) => reason.code)
          : []
      ).toEqual(["BLOCKED"]);
    });

    test("refusals: a slot resource, an unknown unit, another tenant's resource, dates the zone has not, and malformed input", async () => {
      const slot = await newFixture(TENANT_A, { mode: "slot" });
      const stay = await newFixture(TENANT_A);
      const other = await newFixture(TENANT_B);
      const before = await blockCount(TENANT_A);

      expect(await block(TENANT_A, blockOf(slot, D(10), D(12)))).toMatchObject({
        outcome: "refused",
        code: "BOOKING_MODE_MISMATCH"
      });
      expect(
        await block(
          TENANT_A,
          blockOf(stay, D(10), D(12), { unitId: crypto.randomUUID() })
        )
      ).toMatchObject({ outcome: "refused", code: "UNIT_NOT_FOUND" });
      expect(await block(TENANT_A, blockOf(other, D(10), D(12)))).toMatchObject(
        {
          outcome: "refused",
          code: "RESOURCE_NOT_FOUND",
          httpStatus: 404
        }
      );
      expect(
        await block(TENANT_A, {
          ...blockOf(stay, "2011-12-29", "2011-12-30"),
          resourceId: (await newFixture(TENANT_A, { timezone: "Pacific/Apia" }))
            .resourceId
        })
      ).toMatchObject({ outcome: "refused", code: "STAY_DATES_INVALID" });
      expect(
        await block(
          TENANT_A,
          blockOf(stay, D(12), D(10), { reasonCode: "a free text reason" })
        )
      ).toMatchObject({ outcome: "invalid" });
      expect(await blockCount(TENANT_A)).toBe(before);
    });

    test("another tenant's block cannot be released: BLOCK_NOT_FOUND, and it stays active", async () => {
      const fixture = await newFixture(TENANT_B);
      const blockId = await placedBlock(
        TENANT_B,
        blockOf(fixture, D(10), D(12))
      );
      const outcome = await tenantTx(TENANT_A, (tx) =>
        releaseBlock(tx, ctxOf(TENANT_A), blockId)
      );

      expect(outcome).toMatchObject({
        outcome: "refused",
        code: "BLOCK_NOT_FOUND",
        httpStatus: 404
      });
      expect(await liveBlockRows(blockId)).toBe(1);
    });

    test("the audit rows carry ids, dates and the reason code, never a customer reference", async () => {
      const fixture = await newFixture(TENANT_A);
      const stay = await placedStay(TENANT_A, fixture, D(20), D(22), {
        externalCustomerRef: "audit-private-ref",
        customerNote: "audit private note"
      });
      const blockId = await placedBlock(
        TENANT_A,
        blockOf(fixture, D(10), D(12))
      );

      await block(TENANT_A, blockOf(fixture, D(20), D(21)), true);
      await tenantTx(TENANT_A, (tx) =>
        releaseBlock(tx, ctxOf(TENANT_A), blockId)
      );

      const audit = (await getAdminSql()`
        SELECT action, severity, message, attributes::text AS attributes
        FROM awcms_audit_events
        WHERE tenant_id = ${TENANT_A} AND module_key = 'booking'
          AND (resource_id = ${blockId} OR resource_id = ${stay.reservationId})
        ORDER BY created_at
      `) as {
        action: string;
        severity: string;
        message: string;
        attributes: string | null;
      }[];

      expect(audit.map((row) => [row.action, row.severity])).toEqual([
        ["booking.reservation.created", "info"],
        ["booking.block.created", "warning"],
        ["booking.block.released", "info"]
      ]);

      const everything = JSON.stringify(audit);

      expect(everything).not.toContain("audit-private-ref");
      expect(everything).not.toContain("audit private note");
      expect(everything).toContain("maintenance");
      expect(everything).toContain(D(10));
    });
  });

  describe("T12 -- DST and zones, through a real claim", () => {
    const berlin = { timezone: "Europe/Berlin" } as const;

    async function itemOf(reservationId: string) {
      const rows = (await getAdminSql()`
        SELECT i.granularity, i.nights, i.timezone,
               to_char(i.check_in_date, 'YYYY-MM-DD') AS check_in_date,
               to_char(i.check_out_date, 'YYYY-MM-DD') AS check_out_date,
               to_char(i.check_in_local_time, 'HH24:MI') AS check_in_time,
               to_char(i.check_out_local_time, 'HH24:MI') AS check_out_time,
               to_char(i.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS starts_at,
               to_char(i.ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS ends_at
        FROM awcms_booking_reservation_items i
        WHERE i.reservation_id = ${reservationId}
      `) as {
        granularity: string;
        nights: number;
        timezone: string;
        check_in_date: string;
        check_out_date: string;
        check_in_time: string;
        check_out_time: string;
        starts_at: string;
        ends_at: string;
      }[];

      return rows[0]!;
    }

    test("a stay across the spring-forward date (a 23-hour day) has nights = check_out - check_in, stored with its zone and local times", async () => {
      const fixture = await newFixture(TENANT_A, berlin);
      // 2031-03-30 is the 23-hour day in Berlin.
      const stay = await placedStay(
        TENANT_A,
        fixture,
        "2031-03-29",
        "2031-03-31"
      );
      const item = await itemOf(stay.reservationId);

      expect(item).toMatchObject({
        granularity: "stay",
        nights: 2,
        timezone: "Europe/Berlin",
        check_in_date: "2031-03-29",
        check_out_date: "2031-03-31",
        check_in_time: "14:00",
        check_out_time: "12:00"
      });
      // 14:00 CET (+1) and 12:00 CEST (+2).
      expect(item.starts_at).toBe("2031-03-29T13:00:00Z");
      expect(item.ends_at).toBe("2031-03-31T10:00:00Z");
      expect(stay.stay).toEqual({
        checkInDate: "2031-03-29",
        checkOutDate: "2031-03-31",
        nights: 2,
        timezone: "Europe/Berlin"
      });
      expect(stay.occupiedFrom).toBeNull();
    });

    test("a stay across the fall-back date (a 25-hour day) has nights = check_out - check_in", async () => {
      const fixture = await newFixture(TENANT_A, berlin);
      // 2031-10-26 is the 25-hour day in Berlin.
      const stay = await placedStay(
        TENANT_A,
        fixture,
        "2031-10-25",
        "2031-10-27"
      );
      const item = await itemOf(stay.reservationId);

      expect(item.nights).toBe(2);
      // 14:00 CEST (+2) and 12:00 CET (+1).
      expect(item.starts_at).toBe("2031-10-25T12:00:00Z");
      expect(item.ends_at).toBe("2031-10-27T11:00:00Z");
    });

    test("adjacent stays on a transition date do not conflict, one night on it is one night, and a one-night overlap there still conflicts", async () => {
      const fixture = await newFixture(TENANT_A, berlin);

      await placedStay(TENANT_A, fixture, "2031-03-29", "2031-03-30");
      await placedStay(TENANT_A, fixture, "2031-03-30", "2031-03-31");
      await placedStay(TENANT_A, fixture, "2031-03-31", "2031-04-02");
      expect(await liveAllocations(fixture.resourceId)).toBe(3);
      expect(
        await place(TENANT_A, stayClaim(fixture, "2031-03-30", "2031-03-31"))
      ).toMatchObject({ outcome: "refused", code: "SLOT_UNAVAILABLE" });

      const fall = await newFixture(TENANT_A, berlin);

      await placedStay(TENANT_A, fall, "2031-10-25", "2031-10-26");
      await placedStay(TENANT_A, fall, "2031-10-26", "2031-10-27");
      expect(
        await place(TENANT_A, stayClaim(fall, "2031-10-26", "2031-10-27"))
      ).toMatchObject({ outcome: "refused", code: "SLOT_UNAVAILABLE" });
      expect(await overlappingStayPairs(fall.resourceId)).toBe(0);
    });

    test("a check-in time inside the spring-forward gap takes the offset BEFORE the gap; inside the fold, the FIRST occurrence -- snapshotted on the item", async () => {
      const gap = await newFixture(TENANT_A, { ...berlin, checkIn: "02:30" });
      const inGap = await placedStay(TENANT_A, gap, "2031-03-30", "2031-03-31");
      const gapItem = await itemOf(inGap.reservationId);

      // 02:30 does not exist; read at +01:00 it is 01:30Z (03:30 CEST).
      expect(gapItem.starts_at).toBe("2031-03-30T01:30:00Z");
      expect(gapItem.check_in_time).toBe("02:30");

      const fold = await newFixture(TENANT_A, { ...berlin, checkIn: "02:30" });
      const inFold = await placedStay(
        TENANT_A,
        fold,
        "2031-10-26",
        "2031-10-27"
      );
      const foldItem = await itemOf(inFold.reservationId);

      // 02:30 happens twice; the first is CEST (+2): 00:30Z.
      expect(foldItem.starts_at).toBe("2031-10-26T00:30:00Z");
    });

    test("the snapshot is a FACT: changing the resource's check-in time later moves nothing already claimed", async () => {
      const fixture = await newFixture(TENANT_A, berlin);
      const stay = await placedStay(
        TENANT_A,
        fixture,
        "2031-05-10",
        "2031-05-12"
      );
      const before = await itemOf(stay.reservationId);

      await getAdminSql()`
        UPDATE awcms_booking_resources SET stay_check_in_time = '16:00'
        WHERE id = ${fixture.resourceId}
      `;

      expect(await itemOf(stay.reservationId)).toEqual(before);

      const later = await placedStay(
        TENANT_A,
        fixture,
        "2031-05-12",
        "2031-05-14"
      );

      expect((await itemOf(later.reservationId)).check_in_time).toBe("16:00");
    });

    test("a zone with no daylight saving (Asia/Pontianak) derives plain instants", async () => {
      const fixture = await newFixture(TENANT_A);
      const stay = await placedStay(TENANT_A, fixture, D(10), D(12));
      const item = await itemOf(stay.reservationId);

      expect(item.starts_at).toBe(`${D(10)}T07:00:00Z`);
      expect(item.ends_at).toBe(`${D(12)}T05:00:00Z`);
    });

    test("changing the resource's timezone while live stays exist is TIMEZONE_IN_USE; its booking_mode, BOOKING_MODE_IN_USE", async () => {
      const fixture = await newFixture(TENANT_A);
      const admin = getAdminSql();

      await placedStay(TENANT_A, fixture, D(10), D(12));

      const timezone = await assertRejectedByDatabase(
        admin`UPDATE awcms_booking_resources SET timezone = 'Asia/Jakarta'
              WHERE id = ${fixture.resourceId}`,
        "a timezone change under a live stay"
      );
      const mode = await assertRejectedByDatabase(
        admin`UPDATE awcms_booking_resources
              SET booking_mode = 'slot', stay_check_in_time = NULL, stay_check_out_time = NULL
              WHERE id = ${fixture.resourceId}`,
        "a mode change under a live stay"
      );

      expect(timezone.message).toMatch(/TIMEZONE_IN_USE/);
      expect(mode.message).toMatch(/BOOKING_MODE_IN_USE/);
    });

    test("a live block also pins the timezone and the mode, and releasing it lifts both", async () => {
      const fixture = await newFixture(TENANT_A);
      const admin = getAdminSql();
      const blockId = await placedBlock(
        TENANT_A,
        blockOf(fixture, D(10), D(12))
      );

      await assertRejectedByDatabase(
        admin`UPDATE awcms_booking_resources SET timezone = 'Asia/Jakarta'
              WHERE id = ${fixture.resourceId}`,
        "a timezone change under a live block"
      );

      await tenantTx(TENANT_A, (tx) =>
        releaseBlock(tx, ctxOf(TENANT_A), blockId)
      );
      await admin`UPDATE awcms_booking_resources SET timezone = 'Asia/Jakarta'
                  WHERE id = ${fixture.resourceId}`;

      const rows = (await admin`
        SELECT timezone FROM awcms_booking_resources WHERE id = ${fixture.resourceId}
      `) as { timezone: string }[];

      expect(rows[0]!.timezone).toBe("Asia/Jakarta");
    });

    test("a date the zone skipped is STAY_DATES_INVALID; so are a past check-in, an instant and an out-of-order range", async () => {
      const apia = await newFixture(TENANT_A, { timezone: "Pacific/Apia" });
      const fixture = await newFixture(TENANT_A);
      const before = await reservationCount(TENANT_A);

      for (const input of [
        stayClaim(apia, "2011-12-29", "2011-12-31"),
        stayClaim(fixture, "2020-01-01", "2020-01-03"),
        stayClaim(fixture, D(12), D(10)),
        stayClaim(fixture, D(10), D(10))
      ]) {
        expect(await place(TENANT_A, input)).toMatchObject({
          outcome: "refused",
          code: "STAY_DATES_INVALID",
          httpStatus: 400
        });
      }

      // An instant is structurally invalid, with the field named.
      const instant = await place(
        TENANT_A,
        stayClaim(fixture, `${D(10)}T14:00:00Z`, D(12))
      );

      expect(instant).toMatchObject({ outcome: "invalid" });
      expect(
        instant.outcome === "invalid" ? instant.errors[0]!.code : null
      ).toBe("STAY_DATES_INVALID");
      expect(await reservationCount(TENANT_A)).toBe(before);
    });

    test("366 nights is accepted even when check-out is LATER in the day than check-in (the instants span more than 366 days)", async () => {
      const fixture = await newFixture(TENANT_A, {
        checkIn: "00:30",
        checkOut: "23:30",
        maxNights: 366,
        timezone: "Europe/Berlin"
      });
      const stay = await placedStay(
        TENANT_A,
        fixture,
        "2031-04-01",
        "2032-04-01"
      );

      expect(stay.stay?.nights).toBe(366);
      expect(
        Date.parse(stay.endsAt) - Date.parse(stay.startsAt)
      ).toBeGreaterThan(366 * 86_400_000);
      expect(
        await place(
          TENANT_A,
          stayClaim(fixture, "2031-04-01", "2032-04-02", { quantity: 1 })
        )
      ).toMatchObject({ outcome: "refused", code: "STAY_DATES_INVALID" });
    });
  });

  describe("stay claims: policy of the claim, refusals as values", () => {
    test("min and max nights of the offering are 409s of their own", async () => {
      const fixture = await newFixture(TENANT_A, {
        minNights: 2,
        maxNights: 4
      });
      const before = await reservationCount(TENANT_A);

      expect(
        await place(TENANT_A, stayClaim(fixture, D(10), D(11)))
      ).toMatchObject({
        outcome: "refused",
        code: "MIN_STAY_VIOLATION",
        httpStatus: 409
      });
      expect(
        await place(TENANT_A, stayClaim(fixture, D(10), D(15)))
      ).toMatchObject({
        outcome: "refused",
        code: "MAX_STAY_EXCEEDED",
        httpStatus: 409
      });
      expect(
        (await place(TENANT_A, stayClaim(fixture, D(10), D(12)))).outcome
      ).toBe("ok");
      expect(
        (await place(TENANT_A, stayClaim(fixture, D(12), D(16)))).outcome
      ).toBe("ok");
      expect((await reservationCount(TENANT_A)) - before).toBe(2);
    });

    test("a slot claim on a stay resource, and the reverse, are BOOKING_MODE_MISMATCH", async () => {
      const stay = await newFixture(TENANT_A);
      const slot = await newFixture(TENANT_A, { mode: "slot" });

      expect(
        await place(TENANT_A, {
          offeringId: stay.offeringId,
          resourceId: stay.resourceId,
          startsAtMs: Date.parse("2031-06-10T07:00:00Z"),
          partySize: 1,
          quantity: 1
        })
      ).toMatchObject({ outcome: "refused", code: "BOOKING_MODE_MISMATCH" });
      expect(
        await place(TENANT_A, stayClaim(slot, D(10), D(12)))
      ).toMatchObject({ outcome: "refused", code: "BOOKING_MODE_MISMATCH" });
      // A time offering on a stay resource, with dates.
      expect(
        await place(TENANT_A, {
          ...stayClaim(stay, D(10), D(12)),
          offeringId: slot.offeringId
        })
      ).toMatchObject({ outcome: "refused", code: "BOOKING_MODE_MISMATCH" });
      expect(await liveAllocations(stay.resourceId)).toBe(0);
      expect(await liveAllocations(slot.resourceId)).toBe(0);
    });

    test("a pool of stay resources with different zones is refused, not snapshotted by accident", async () => {
      const admin = getAdminSql();
      const poolRows = (await admin`
        INSERT INTO awcms_booking_resource_pools (tenant_id, code, name)
        VALUES (${TENANT_A}, ${`pool-${++sequence}`}, 'Rooms')
        RETURNING id
      `) as { id: string }[];
      const poolId = poolRows[0]!.id;
      const east = await newFixture(TENANT_A, { poolId });

      await newFixture(TENANT_A, { poolId, timezone: "Asia/Jakarta" });

      expect(
        await place(TENANT_A, {
          offeringId: east.offeringId,
          poolId,
          stay: { checkInDate: D(10), checkOutDate: D(12) },
          partySize: 1,
          quantity: 1
        })
      ).toMatchObject({
        outcome: "refused",
        code: "STAY_POOL_INCONSISTENT"
      });
    });

    test("a pool of stay resources with the same terms claims first-free across resources, by sort_order", async () => {
      const admin = getAdminSql();
      const poolRows = (await admin`
        INSERT INTO awcms_booking_resource_pools (tenant_id, code, name)
        VALUES (${TENANT_A}, ${`pool-${++sequence}`}, 'Rooms')
        RETURNING id
      `) as { id: string }[];
      const poolId = poolRows[0]!.id;
      const first = await newFixture(TENANT_A, { poolId, sortOrder: 1 });
      const second = await newFixture(TENANT_A, { poolId, sortOrder: 2 });
      const claim = (): PlaceHoldInput => ({
        offeringId: first.offeringId,
        poolId,
        stay: { checkInDate: D(10), checkOutDate: D(12) },
        partySize: 1,
        quantity: 1
      });
      const a = await place(TENANT_A, claim());
      const b = await place(TENANT_A, claim());
      const c = await place(TENANT_A, claim());

      expect(a.outcome === "ok" && a.reservation.units[0]!.resourceId).toBe(
        first.resourceId
      );
      expect(b.outcome === "ok" && b.reservation.units[0]!.resourceId).toBe(
        second.resourceId
      );
      expect(c).toMatchObject({ outcome: "refused", code: "SLOT_UNAVAILABLE" });
    });

    test("an immediate offering confirms the stay at once: no hold, no expiry; history and audit carry the dates, never a person", async () => {
      const fixture = await newFixture(TENANT_A, { confirmation: "immediate" });
      const stay = await placedStay(TENANT_A, fixture, D(10), D(12), {
        externalCustomerRef: "history-private-ref",
        customerNote: "history private note"
      });

      expect(stay.status).toBe("confirmed");
      expect(stay.holdExpiresAt).toBeNull();

      const rows = (await getAdminSql()`
        SELECT e.kind, e.detail::text AS detail
        FROM awcms_booking_reservation_events e
        WHERE e.reservation_id = ${stay.reservationId}
        ORDER BY e.seq
      `) as { kind: string; detail: string }[];

      expect(rows.map((row) => row.kind)).toEqual(["created", "confirmed"]);
      expect(rows[0]!.detail).toContain(`"checkInDate": "${D(10)}"`);
      expect(rows[0]!.detail).toContain('"nights": 2');
      expect(JSON.stringify(rows)).not.toContain("history-private-ref");
      expect(JSON.stringify(rows)).not.toContain("history private note");
    });

    test("holds on stays are capped like holds on slots (a SUM, under the tenant lock)", async () => {
      const tenantId = "b9400000-0000-4000-8000-0000000000c1";

      await seedTenant(tenantId, "stay-cap");
      await getAdminSql()`
        INSERT INTO awcms_booking_settings (tenant_id, max_active_holds_per_tenant)
        VALUES (${tenantId}, 2)
      `;

      const fixtures = await Promise.all(
        Array.from({ length: 6 }, () => newFixture(tenantId))
      );
      const outcomes = await race(
        fixtures.map(
          (fixture) => () => place(tenantId, stayClaim(fixture, D(10), D(12)))
        )
      );
      const { ok, codes } = tally(outcomes);

      expect(ok).toBe(2);
      expect(Object.fromEntries(codes)).toEqual({ HOLD_LIMIT_EXCEEDED: 4 });
    });
  });

  describe("stay holds expire exactly like slot holds (sql/200 needs no change)", () => {
    test("with the reaper STOPPED, an elapsed stay hold does not block a new stay (lazy reclaim) and is left expired with its nights released", async () => {
      const fixture = await newFixture(TENANT_A);
      const hold = await placedStay(TENANT_A, fixture, D(10), D(12));

      expect(
        await place(TENANT_A, stayClaim(fixture, D(11), D(13)))
      ).toMatchObject({ outcome: "refused", code: "SLOT_UNAVAILABLE" });

      await backdateHold(hold.reservationId);

      expect(
        (await place(TENANT_A, stayClaim(fixture, D(11), D(13)))).outcome
      ).toBe("ok");

      const rows = (await getAdminSql()`
        SELECT r.status,
               (SELECT count(*) FROM awcms_booking_resource_allocations a
                JOIN awcms_booking_reservation_items i ON i.id = a.item_id
                WHERE i.reservation_id = r.id AND a.released_reason = 'expired')::int
                 AS released,
               (SELECT detail->>'trigger' FROM awcms_booking_reservation_events e
                WHERE e.reservation_id = r.id AND e.kind = 'expired') AS via
        FROM awcms_booking_reservations r WHERE r.id = ${hold.reservationId}
      `) as { status: string; released: number; via: string }[];

      expect(rows[0]).toEqual({
        status: "expired",
        released: 1,
        via: "lazy_reclaim"
      });
    });

    test("a slot claim never reclaims a stay hold, and the reverse (each probes its own kind of row)", async () => {
      const stay = await newFixture(TENANT_A);
      const hold = await placedStay(TENANT_A, stay, D(10), D(12));

      await backdateHold(hold.reservationId);

      const outcome = await tenantTx(TENANT_A, (tx) =>
        reclaimExpiredHolds(tx, TENANT_A, [stay.resourceId], {
          kind: "time",
          fromMs: Date.parse("2031-06-09T00:00:00Z"),
          toMs: Date.parse("2031-06-13T00:00:00Z")
        })
      );

      expect(outcome).toMatchObject({ expired: 0, releasedAllocations: 0 });

      const forStay = await tenantTx(TENANT_A, (tx) =>
        reclaimExpiredHolds(tx, TENANT_A, [stay.resourceId], {
          kind: "stay",
          fromDate: D(11),
          toDate: D(12)
        })
      );

      expect(forStay).toMatchObject({ expired: 1, releasedAllocations: 1 });
    });

    test("the reaper (awcms_worker, through the narrow sweep) expires an elapsed stay hold, releases its nights, and leaves a block alone", async () => {
      const tenantId = "b9400000-0000-4000-8000-0000000000c2";

      await seedTenant(tenantId, "stay-reaper");

      const fixture = await newFixture(tenantId, { capacity: 2 });
      const hold = await placedStay(tenantId, fixture, D(10), D(12));
      const blocked = await placedBlock(
        tenantId,
        blockOf(fixture, D(20), D(22), { unitId: fixture.unitIds[1]! })
      );

      await backdateHold(hold.reservationId);

      const outcome = await workerTx(tenantId, (tx) =>
        expireDueHolds(tx, tenantId)
      );

      expect(outcome).toMatchObject({ expired: 1, releasedAllocations: 1 });
      expect(await liveBlockRows(blocked)).toBe(1);

      const rows = (await getAdminSql()`
        SELECT r.status, r.status_changed_by IS NULL AS system_actor,
               (SELECT count(*) FROM awcms_booking_resource_allocations a
                JOIN awcms_booking_reservation_items i ON i.id = a.item_id
                WHERE i.reservation_id = r.id AND a.released_reason = 'expired')::int
                 AS released,
               (SELECT detail->>'trigger' FROM awcms_booking_reservation_events e
                WHERE e.reservation_id = r.id AND e.kind = 'expired') AS via
        FROM awcms_booking_reservations r WHERE r.id = ${hold.reservationId}
      `) as {
        status: string;
        system_actor: boolean;
        released: number;
        via: string;
      }[];

      expect(rows[0]).toEqual({
        status: "expired",
        system_actor: true,
        released: 1,
        via: "reaper"
      });
      // The nights are free again.
      expect(
        (await place(tenantId, stayClaim(fixture, D(10), D(12)))).outcome
      ).toBe("ok");
    });

    test("the reaper still expires holds under a generic plan: the update guard never reads the blocks table for a guest row", async () => {
      // Review finding B1: with the blocks-table check AND-ed into one IF, a
      // generic plan keeps the subquery, its permissions are checked at executor
      // start, and the sweep role (no SELECT on the blocks table) is refused.
      const tenantId = "b9400000-0000-4000-8000-0000000000c3";

      await seedTenant(tenantId, "stay-reaper-generic");

      const fixture = await newFixture(tenantId, { capacity: 2 });
      const holds = [
        await placedStay(tenantId, fixture, D(10), D(12)),
        await placedStay(tenantId, fixture, D(14), D(16))
      ];

      for (const hold of holds) await backdateHold(hold.reservationId);

      const outcome = await workerTx(tenantId, async (tx) => {
        await tx.unsafe("SET LOCAL plan_cache_mode = force_generic_plan");
        return expireDueHolds(tx, tenantId);
      });

      expect(outcome).toMatchObject({ expired: 2, releasedAllocations: 2 });
    });

    test("the sweep cannot release a block's nights: a block row is released only by releasing its block", async () => {
      const fixture = await newFixture(TENANT_A);
      const blockId = await placedBlock(
        TENANT_A,
        blockOf(fixture, D(10), D(12))
      );
      const error = await assertRejectedByDatabase(
        getAdminSql()`
          UPDATE awcms_booking_resource_allocations
          SET released_at = clock_timestamp(), released_reason = 'block_released'
          WHERE block_id = ${blockId}`,
        "releasing a block's night behind the block's back"
      );

      expect(error.message).toMatch(/released only by releasing its block/);
      expect(await liveBlockRows(blockId)).toBe(1);
    });
  });

  describe("the guards of sql/204", () => {
    test("a row is a guest's night or a blocked night, never both and never neither", async () => {
      const fixture = await newFixture(TENANT_A);
      const blockId = await placedBlock(
        TENANT_A,
        blockOf(fixture, D(10), D(12))
      );
      const admin = getAdminSql();
      const stay = await placedStay(TENANT_A, fixture, D(20), D(22));
      const itemRows = (await admin`
        SELECT id FROM awcms_booking_reservation_items
        WHERE reservation_id = ${stay.reservationId}
      `) as { id: string }[];
      const itemId = itemRows[0]!.id;

      await assertRejectedByDatabase(
        admin`INSERT INTO awcms_booking_resource_allocations
                (tenant_id, item_id, block_id, resource_id, resource_unit_id,
                 granularity, starts_at, ends_at, stay_from, stay_to)
              VALUES (${TENANT_A}, ${itemId}, ${blockId}, ${fixture.resourceId},
                      ${fixture.unitIds[0]!}, 'stay', now(), now() + interval '1 day',
                      ${D(25)}, ${D(26)})`,
        "an allocation owned by both an item and a block"
      );
      await assertRejectedByDatabase(
        admin`INSERT INTO awcms_booking_resource_allocations
                (tenant_id, resource_id, resource_unit_id, granularity,
                 stay_from, stay_to)
              VALUES (${TENANT_A}, ${fixture.resourceId}, ${fixture.unitIds[0]!},
                      'stay', ${D(25)}, ${D(26)})`,
        "an allocation owned by neither"
      );
    });

    test("a block row has no instants and a guest's stay row must have them", async () => {
      const fixture = await newFixture(TENANT_A);
      const admin = getAdminSql();
      const blockRows = (await admin`
        INSERT INTO awcms_booking_resource_blocks
          (tenant_id, resource_id, block_from, block_to, reason_code)
        VALUES (${TENANT_A}, ${fixture.resourceId}, ${D(10)}, ${D(12)}, 'other')
        RETURNING id
      `) as { id: string }[];

      await assertRejectedByDatabase(
        admin`INSERT INTO awcms_booking_resource_allocations
                (tenant_id, block_id, resource_id, resource_unit_id, granularity,
                 starts_at, ends_at, stay_from, stay_to)
              VALUES (${TENANT_A}, ${blockRows[0]!.id}, ${fixture.resourceId},
                      ${fixture.unitIds[0]!}, 'stay', now(), now() + interval '1 day',
                      ${D(10)}, ${D(12)})`,
        "a block row with instants"
      );
      // And the legal form works.
      await admin`INSERT INTO awcms_booking_resource_allocations
                    (tenant_id, block_id, resource_id, resource_unit_id,
                     granularity, stay_from, stay_to)
                  VALUES (${TENANT_A}, ${blockRows[0]!.id}, ${fixture.resourceId},
                          ${fixture.unitIds[0]!}, 'stay', ${D(10)}, ${D(12)})`;
      expect(await liveBlockRows(blockRows[0]!.id)).toBe(1);
    });

    test("a block row must equal its block: other dates, another resource's unit, a released block", async () => {
      const fixture = await newFixture(TENANT_A, { capacity: 2 });
      const other = await newFixture(TENANT_A);
      const admin = getAdminSql();
      const blockRows = (await admin`
        INSERT INTO awcms_booking_resource_blocks
          (tenant_id, resource_id, resource_unit_id, block_from, block_to, reason_code)
        VALUES (${TENANT_A}, ${fixture.resourceId}, ${fixture.unitIds[0]!},
                ${D(10)}, ${D(12)}, 'other')
        RETURNING id
      `) as { id: string }[];
      const blockId = blockRows[0]!.id;
      const insert = (
        unitId: string,
        resourceId: string,
        from: string,
        to: string
      ) =>
        admin`INSERT INTO awcms_booking_resource_allocations
                (tenant_id, block_id, resource_id, resource_unit_id, granularity,
                 stay_from, stay_to)
              VALUES (${TENANT_A}, ${blockId}, ${resourceId}, ${unitId}, 'stay',
                      ${from}::date, ${to}::date)`;

      // Other dates than the block's.
      expect(
        (
          await assertRejectedByDatabase(
            insert(fixture.unitIds[0]!, fixture.resourceId, D(10), D(13)),
            "other dates"
          )
        ).message
      ).toMatch(/disagrees with its block/);
      // A different unit than the block names.
      expect(
        (
          await assertRejectedByDatabase(
            insert(fixture.unitIds[1]!, fixture.resourceId, D(10), D(12)),
            "another unit"
          )
        ).message
      ).toMatch(/disagrees with its block/);
      // Another resource's unit (composite foreign key and the block's resource).
      await assertRejectedByDatabase(
        insert(other.unitIds[0]!, other.resourceId, D(10), D(12)),
        "another resource"
      );

      await admin`
        UPDATE awcms_booking_resource_blocks
        SET status = 'released', released_at = now() WHERE id = ${blockId}
      `;
      expect(
        (
          await assertRejectedByDatabase(
            insert(fixture.unitIds[0]!, fixture.resourceId, D(10), D(12)),
            "a released block"
          )
        ).message
      ).toMatch(/only under an active block/);
    });

    test("releasing a block in SQL releases its nights in the same statement, for any writer", async () => {
      const fixture = await newFixture(TENANT_A, { capacity: 3 });
      const blockId = await placedBlock(
        TENANT_A,
        blockOf(fixture, D(10), D(12))
      );

      expect(await liveBlockRows(blockId)).toBe(3);

      await getAdminSql()`
        UPDATE awcms_booking_resource_blocks
        SET status = 'released', released_at = now() WHERE id = ${blockId}
      `;

      expect(await liveBlockRows(blockId)).toBe(0);
    });

    test("a block reason is a closed code and a block spans at most 366 nights", async () => {
      const fixture = await newFixture(TENANT_A);

      expect(
        (
          await block(
            TENANT_A,
            blockOf(fixture, D(10), D(12), { reasonCode: "other" })
          )
        ).outcome
      ).toBe("ok");
      expect(
        (
          await block(
            TENANT_A,
            blockOf(fixture, "2032-01-01", "2033-01-02", {
              reasonCode: "other"
            })
          )
        ).outcome
      ).toBe("invalid");
    });

    test("RLS: the application role sees only its own tenant's blocks and block rows", async () => {
      const fixtureA = await newFixture(TENANT_A);
      const fixtureB = await newFixture(TENANT_B);
      const blockA = await placedBlock(
        TENANT_A,
        blockOf(fixtureA, D(10), D(12))
      );
      const blockB = await placedBlock(
        TENANT_B,
        blockOf(fixtureB, D(10), D(12))
      );
      const seen = await tenantTx(TENANT_A, async (tx) => ({
        blocks: (await tx`
          SELECT id FROM awcms_booking_resource_blocks
          WHERE id IN (${blockA}, ${blockB})`) as { id: string }[],
        rows: (await tx`
          SELECT block_id FROM awcms_booking_resource_allocations
          WHERE block_id IN (${blockA}, ${blockB})`) as { block_id: string }[]
      }));

      expect(seen.blocks.map((row) => row.id)).toEqual([blockA]);
      expect(seen.rows.map((row) => row.block_id)).toEqual([blockA]);
    });
  });

  describe("reconciliation of stays and blocks", () => {
    test("a tenant that only used stays and blocks has zero drift", async () => {
      const tenantId = "b9400000-0000-4000-8000-0000000000d1";

      await seedTenant(tenantId, "stay-recon");

      const fixture = await newFixture(tenantId, { capacity: 3 });

      await placedStay(tenantId, fixture, D(10), D(12));
      await placedStay(tenantId, fixture, D(11), D(14), { quantity: 2 });
      await placedBlock(tenantId, blockOf(fixture, D(20), D(25)));

      const released = await placedBlock(
        tenantId,
        blockOf(fixture, D(26), D(28), { unitId: fixture.unitIds[2]! })
      );

      await tenantTx(tenantId, (tx) =>
        releaseBlock(tx, ctxOf(tenantId), released)
      );

      const report = await tenantTx(tenantId, (tx) =>
        runReconciliation(tx, tenantId)
      );

      expect(report.findings.filter((finding) => finding.count > 0)).toEqual(
        []
      );
      expect(report.drift).toBe(0);
    });

    test("it names a block released behind the trigger, an extra unit the block does not cover, and a block row that drifted from its block", async () => {
      const tenantId = "b9400000-0000-4000-8000-0000000000d2";

      await seedTenant(tenantId, "stay-recon-drift");

      const admin = getAdminSql();
      const orphaned = await newFixture(tenantId);
      const orphanBlock = await placedBlock(
        tenantId,
        blockOf(orphaned, D(10), D(12))
      );
      const growing = await newFixture(tenantId, { capacity: 2 });
      const growingBlock = await placedBlock(
        tenantId,
        blockOf(growing, D(10), D(12))
      );
      const drifting = await newFixture(tenantId);
      const driftBlock = await placedBlock(
        tenantId,
        blockOf(drifting, D(10), D(12))
      );

      // 1. A release that did not go through the trigger.
      await admin.begin(async (tx) => {
        await tx.unsafe(
          "ALTER TABLE awcms_booking_resource_blocks DISABLE TRIGGER awcms_booking_resource_blocks_release_nights"
        );
        await tx`UPDATE awcms_booking_resource_blocks
                 SET status = 'released', released_at = now() WHERE id = ${orphanBlock}`;
        await tx.unsafe(
          "ALTER TABLE awcms_booking_resource_blocks ENABLE TRIGGER awcms_booking_resource_blocks_release_nights"
        );
      });
      // 2. A unit added after the block was placed, BEHIND the cover trigger of
      //    sql/240 (through it the unit is covered: see "Issue #1012").
      await admin.begin(async (tx) => {
        await tx.unsafe(
          "ALTER TABLE awcms_booking_resource_units DISABLE TRIGGER awcms_booking_resource_units_cover_blocks"
        );
        await tx`INSERT INTO awcms_booking_resource_units (tenant_id, resource_id, ordinal)
                 VALUES (${tenantId}, ${growing.resourceId}, 3)`;
        await tx.unsafe(
          "ALTER TABLE awcms_booking_resource_units ENABLE TRIGGER awcms_booking_resource_units_cover_blocks"
        );
      });
      // 3. A row whose dates drifted from its block's.
      await admin.begin(async (tx) => {
        await tx.unsafe(
          "ALTER TABLE awcms_booking_resource_allocations DISABLE TRIGGER awcms_booking_resource_allocations_update_guard"
        );
        await tx`UPDATE awcms_booking_resource_allocations
                 SET stay_to = ${D(13)}::date WHERE block_id = ${driftBlock}`;
        await tx.unsafe(
          "ALTER TABLE awcms_booking_resource_allocations ENABLE TRIGGER awcms_booking_resource_allocations_update_guard"
        );
      });

      const report = await tenantTx(tenantId, (tx) =>
        runReconciliation(tx, tenantId)
      );
      const byCheck = new Map(
        report.findings.map((finding) => [finding.check, finding])
      );

      expect(byCheck.get("block_allocation_orphan")).toMatchObject({
        count: 1
      });
      expect(byCheck.get("block_missing_allocation")).toMatchObject({
        count: 1,
        sampleIds: [growingBlock]
      });
      expect(byCheck.get("block_allocation_mismatch")).toMatchObject({
        count: 1
      });
      expect(report.drift).toBeGreaterThanOrEqual(3);
    });
  });

  describe("Issue #1012 -- follow-ups of the #940 review", () => {
    describe("N1 -- a resource-wide block covers units added later (sql/240)", () => {
      test("a unit added afterwards gets its block row, cannot be booked, and is released with the block", async () => {
        const fixture = await newFixture(TENANT_A, { capacity: 2 });
        const blockId = await placedBlock(
          TENANT_A,
          blockOf(fixture, D(10), D(14))
        );

        expect(await liveBlockRows(blockId)).toBe(2);

        const added = await tenantTx(TENANT_A, (tx) =>
          addUnit(tx, TENANT_A, fixture.resourceId, 3)
        );

        expect(await liveBlockRows(blockId)).toBe(3);
        expect(await uncoveredUnits(fixture.resourceId)).toBe(0);

        // Availability said BLOCKED for the unit and now the claim agrees.
        expect(
          await place(TENANT_A, stayClaim(fixture, D(11), D(12)))
        ).toMatchObject({ outcome: "refused", code: "SLOT_UNAVAILABLE" });
        // The added unit specifically: it holds a live block row of its own.
        const addedRows = (await getAdminSql()`
          SELECT count(*)::int AS n
          FROM awcms_booking_resource_allocations
          WHERE block_id = ${blockId} AND resource_unit_id = ${added}
            AND released_at IS NULL
        `) as { n: number }[];

        expect(addedRows[0]!.n).toBe(1);

        const report = await tenantTx(TENANT_A, (tx) =>
          runReconciliation(tx, TENANT_A)
        );

        expect(
          report.findings
            .filter((finding) => finding.check === "block_missing_allocation")
            .map((finding) => finding.sampleIds ?? [])
            .flat()
        ).not.toContain(blockId);

        const released = await tenantTx(TENANT_A, (tx) =>
          releaseBlock(tx, ctxOf(TENANT_A), blockId)
        );

        expect(released).toMatchObject({
          outcome: "ok",
          replayed: false,
          releasedAllocations: 3
        });
        expect(await liveBlockRows(blockId)).toBe(0);
        expect(
          (await place(TENANT_A, stayClaim(fixture, D(11), D(12)))).outcome
        ).toBe("ok");
      });

      test("only ACTIVE RESOURCE-WIDE blocks of THAT resource extend: a unit block, a released block and another resource's block do not", async () => {
        const fixture = await newFixture(TENANT_A, { capacity: 2 });
        const other = await newFixture(TENANT_A, { capacity: 1 });
        const unitBlock = await placedBlock(
          TENANT_A,
          blockOf(fixture, D(10), D(12), { unitId: fixture.unitIds[0]! })
        );
        const releasedWide = await placedBlock(
          TENANT_A,
          blockOf(fixture, D(20), D(22))
        );
        const otherBlock = await placedBlock(
          TENANT_A,
          blockOf(other, D(10), D(12))
        );
        const wide = await placedBlock(
          TENANT_A,
          blockOf(fixture, D(25), D(27))
        );

        await tenantTx(TENANT_A, (tx) =>
          releaseBlock(tx, ctxOf(TENANT_A), releasedWide)
        );
        await tenantTx(TENANT_A, (tx) =>
          addUnit(tx, TENANT_A, fixture.resourceId, 3)
        );

        expect(await liveBlockRows(unitBlock)).toBe(1);
        expect(await liveBlockRows(releasedWide)).toBe(0);
        expect(await liveBlockRows(otherBlock)).toBe(1);
        expect(await liveBlockRows(wide)).toBe(3);
      });

      test("a unit added to ANOTHER TENANT's resource is untouched by this tenant's blocks (RLS)", async () => {
        const mine = await newFixture(TENANT_A, { capacity: 1 });
        const theirs = await newFixture(TENANT_B, { capacity: 1 });
        const theirBefore = await blockCount(TENANT_B);
        const myBlock = await placedBlock(
          TENANT_A,
          blockOf(mine, D(10), D(12))
        );

        await tenantTx(TENANT_B, (tx) =>
          addUnit(tx, TENANT_B, theirs.resourceId, 2)
        );

        expect(await liveBlockRows(myBlock)).toBe(1);
        expect(await blockCount(TENANT_B)).toBe(theirBefore);
      });

      test("a unit insert that commits FIRST is read by the block (the block waits for the resource lock)", async () => {
        const fixture = await newFixture(TENANT_A, { capacity: 2 });
        const unitTx = openTransaction(TENANT_A, (tx) =>
          addUnit(tx, TENANT_A, fixture.resourceId, 3)
        );

        await unitTx.opened;

        let outcome: unknown = "pending";
        const blocking = block(TENANT_A, blockOf(fixture, D(10), D(12))).then(
          (result) => {
            outcome = result;
          }
        );

        await waitForLockWait("INSERT INTO awcms_booking_resource_blocks");
        expect(outcome).toBe("pending");

        await unitTx.commit();
        await blocking;

        expect(outcome).toMatchObject({ outcome: "ok" });
        expect(await liveAllocations(fixture.resourceId)).toBe(3);
        expect(await uncoveredUnits(fixture.resourceId)).toBe(0);
      });

      test("a unit insert that arrives while a block is UNCOMMITTED waits for it, then is covered", async () => {
        const fixture = await newFixture(TENANT_A, { capacity: 2 });
        const blockTx = openTransaction(TENANT_A, (tx) =>
          createBlock(tx, ctxOf(TENANT_A), blockOf(fixture, D(10), D(12)))
        );

        await blockTx.opened;

        let done = false;
        const adding = tenantTx(TENANT_A, (tx) =>
          addUnit(tx, TENANT_A, fixture.resourceId, 3)
        ).then(() => {
          done = true;
        });

        await waitForLockWait("INSERT INTO awcms_booking_resource_units");
        expect(done).toBe(false);

        await blockTx.commit();
        await adding;

        expect(await liveAllocations(fixture.resourceId)).toBe(3);
        expect(await uncoveredUnits(fixture.resourceId)).toBe(0);
      });

      test("a soak of blocks racing unit inserts leaves NO unit uncovered, in either order", async () => {
        for (let round = 0; round < 15; round += 1) {
          const fixture = await newFixture(TENANT_A, { capacity: 2 });
          const outcomes = await race<unknown>([
            () => block(TENANT_A, blockOf(fixture, D(10), D(12))),
            () =>
              tenantTx(TENANT_A, (tx) =>
                addUnit(tx, TENANT_A, fixture.resourceId, 3)
              ),
            () =>
              tenantTx(TENANT_A, (tx) =>
                addUnit(tx, TENANT_A, fixture.resourceId, 4)
              )
          ]);

          expect(outcomes[0]).toMatchObject({ outcome: "ok" });
          expect(await uncoveredUnits(fixture.resourceId)).toBe(0);
          expect(await liveAllocations(fixture.resourceId)).toBe(4);
        }
      });
    });

    describe("N3 -- lazy reclaim on a block targets only the covered unit(s)", () => {
      async function unitOfReservation(reservationId: string) {
        const rows = (await getAdminSql()`
          SELECT a.resource_unit_id
          FROM awcms_booking_reservation_items i
          JOIN awcms_booking_resource_allocations a ON a.item_id = i.id
          WHERE i.reservation_id = ${reservationId}
        `) as { resource_unit_id: string }[];

        return rows[0]!.resource_unit_id;
      }

      async function statusOf(reservationId: string): Promise<string> {
        const rows = (await getAdminSql()`
          SELECT status FROM awcms_booking_reservations WHERE id = ${reservationId}
        `) as { status: string }[];

        return rows[0]!.status;
      }

      test("a block of ONE unit expires the elapsed hold on that unit and leaves the elapsed hold on another unit for its own sweep", async () => {
        const fixture = await newFixture(TENANT_A, { capacity: 2 });
        const a = await placedStay(TENANT_A, fixture, D(10), D(12));
        const b = await placedStay(TENANT_A, fixture, D(10), D(12));

        await backdateHold(a.reservationId);
        await backdateHold(b.reservationId);

        const target = await unitOfReservation(a.reservationId);

        expect(await unitOfReservation(b.reservationId)).not.toBe(target);
        expect(
          (
            await block(
              TENANT_A,
              blockOf(fixture, D(10), D(12), { unitId: target })
            )
          ).outcome
        ).toBe("ok");
        expect(await statusOf(a.reservationId)).toBe("expired");
        // Elapsed, but on a unit this block does not cover: not this call's business.
        expect(await statusOf(b.reservationId)).toBe("held");

        const audit = (await getAdminSql()`
          SELECT message, attributes
          FROM awcms_audit_events
          WHERE tenant_id = ${TENANT_A} AND action = 'booking.reservation.expired'
            AND attributes->>'resourceId' = ${fixture.resourceId}
        `) as { message: string; attributes: Record<string, unknown> }[];

        expect(audit).toHaveLength(1);
        expect(audit[0]!.message).toContain("block's unit(s)");
        expect(audit[0]!.attributes).toMatchObject({
          expiredCount: 1,
          unitId: target,
          trigger: "lazy_reclaim"
        });
      });

      test("a resource-wide block covers every unit, so it reclaims the elapsed holds on all of them", async () => {
        const fixture = await newFixture(TENANT_A, { capacity: 2 });
        const a = await placedStay(TENANT_A, fixture, D(10), D(12));
        const b = await placedStay(TENANT_A, fixture, D(10), D(12));

        await backdateHold(a.reservationId);
        await backdateHold(b.reservationId);

        expect(
          (await block(TENANT_A, blockOf(fixture, D(10), D(12)))).outcome
        ).toBe("ok");
        expect(await statusOf(a.reservationId)).toBe("expired");
        expect(await statusOf(b.reservationId)).toBe("expired");
      });
    });

    describe("N4 -- one release instant for a block and its rows (sql/241)", () => {
      test("the block's released_at equals every one of its rows' released_at, to the microsecond", async () => {
        const fixture = await newFixture(TENANT_A, { capacity: 4 });
        const blockId = await placedBlock(
          TENANT_A,
          blockOf(fixture, D(10), D(12))
        );

        await tenantTx(TENANT_A, (tx) =>
          releaseBlock(tx, ctxOf(TENANT_A), blockId)
        );

        const rows = (await getAdminSql()`
          SELECT count(*)::int AS n,
                 count(DISTINCT a.released_at)::int AS instants,
                 bool_and(a.released_at = b.released_at) AS same_as_block
          FROM awcms_booking_resource_blocks b
          JOIN awcms_booking_resource_allocations a
            ON a.tenant_id = b.tenant_id AND a.block_id = b.id
          WHERE b.id = ${blockId}
        `) as { n: number; instants: number; same_as_block: boolean }[];

        expect(rows[0]).toEqual({ n: 4, instants: 1, same_as_block: true });
      });
    });
  });

  // MUST be last: it drops and restores a constraint and truncates booking rows.
  describe("T13 -- the test detects the defect, and the granularity guard", () => {
    test("a slot allocation on a stay resource, and the reverse, are rejected by the trigger", async () => {
      const stay = await newFixture(TENANT_A);
      const slot = await newFixture(TENANT_A, { mode: "slot" });
      const admin = getAdminSql();
      const stayStay = await placedStay(TENANT_A, stay, D(10), D(12));
      const slotItem = (await admin`
        INSERT INTO awcms_booking_reservations
          (tenant_id, status, starts_at, ends_at, hold_expires_at)
        VALUES (${TENANT_A}, 'held', '2031-06-10T03:00:00Z', '2031-06-10T04:00:00Z',
                clock_timestamp() + interval '15 minutes')
        RETURNING id
      `) as { id: string }[];
      const slotItemRow = (await admin`
        INSERT INTO awcms_booking_reservation_items
          (tenant_id, reservation_id, line_no, offering_id, offering_code,
           offering_name, granularity, duration_seconds, setup_seconds,
           cleanup_seconds, starts_at, ends_at)
        VALUES (${TENANT_A}, ${slotItem[0]!.id}, 1, ${slot.offeringId}, 'h', 'Hour',
                'time', 3600, 0, 0, '2031-06-10T03:00:00Z', '2031-06-10T04:00:00Z')
        RETURNING id
      `) as { id: string }[];

      // A time allocation on a stay resource's unit.
      expect(
        (
          await assertRejectedByDatabase(
            admin`INSERT INTO awcms_booking_resource_allocations
                  (tenant_id, item_id, resource_id, resource_unit_id, granularity,
                   starts_at, ends_at, occupied_from, occupied_to)
                VALUES (${TENANT_A}, ${slotItemRow[0]!.id}, ${stay.resourceId},
                        ${stay.unitIds[0]!}, 'time', '2031-06-10T03:00:00Z',
                        '2031-06-10T04:00:00Z', '2031-06-10T03:00:00Z',
                        '2031-06-10T04:00:00Z')`,
            "a time allocation on a stay resource"
          )
        ).message
      ).toMatch(/does not match resource booking_mode/);

      // A stay allocation on a slot resource's unit.
      const stayItem = (await admin`
        SELECT id FROM awcms_booking_reservation_items
        WHERE reservation_id = ${stayStay.reservationId}
      `) as { id: string }[];

      expect(
        (
          await assertRejectedByDatabase(
            admin`INSERT INTO awcms_booking_resource_allocations
                  (tenant_id, item_id, resource_id, resource_unit_id, granularity,
                   starts_at, ends_at, stay_from, stay_to)
                VALUES (${TENANT_A}, ${stayItem[0]!.id}, ${slot.resourceId},
                        ${slot.unitIds[0]!}, 'stay', ${`${D(10)}T07:00:00Z`}::timestamptz,
                        ${`${D(12)}T05:00:00Z`}::timestamptz, ${D(10)}, ${D(12)})`,
            "a stay allocation on a slot resource"
          )
        ).message
      ).toMatch(/does not match resource booking_mode/);

      // And a block cannot sit on a slot resource at all.
      expect(
        (
          await assertRejectedByDatabase(
            admin`INSERT INTO awcms_booking_resource_blocks
                  (tenant_id, resource_id, block_from, block_to, reason_code)
                VALUES (${TENANT_A}, ${slot.resourceId}, ${D(10)}, ${D(12)}, 'other')`,
            "a block on a slot resource"
          )
        ).message
      ).toMatch(/active stay resource/);
    });

    test("the two constraints partition the unit space: each is limited to its own granularity", async () => {
      const definitions = (await getAdminSql()`
        SELECT conname, pg_get_constraintdef(oid) AS def
        FROM pg_constraint
        WHERE conrelid = 'awcms_booking_resource_allocations'::regclass
          AND contype = 'x'
        ORDER BY conname
      `) as { conname: string; def: string }[];
      const byName = new Map(definitions.map((row) => [row.conname, row.def]));

      expect(
        byName.get("awcms_booking_resource_allocations_stay_excl")
      ).toMatch(
        /daterange\(stay_from, stay_to, '\[\)'::text\) WITH &&.*granularity = 'stay'/
      );
      expect(
        byName.get("awcms_booking_resource_allocations_time_excl")
      ).toMatch(
        /tstzrange\(occupied_from, occupied_to, '\[\)'::text\) WITH &&.*granularity = 'time'/
      );
    });

    test("WITHOUT the stay constraint two overlapping stays both commit, and so do a block and a stay (T9 and T11 are not vacuous)", async () => {
      const admin = getAdminSql();
      const definition = (await admin`
        SELECT pg_get_constraintdef(oid) AS def
        FROM pg_constraint
        WHERE conname = 'awcms_booking_resource_allocations_stay_excl'
      `) as { def: string }[];

      expect(definition).toHaveLength(1);

      const tenantId = "b9400000-0000-4000-8000-0000000000e1";

      await seedTenant(tenantId, "stay-e1");

      let stayPairs = 0;
      let blockedBookings = 0;
      let stayLive = 0;
      let blockLive = 0;
      // `immediate` offerings: a confirmed reservation takes no tenant cap lock
      // (Issue #941). A held claim would, by design, make B wait for A's commit on
      // that lock, and this test keeps A open on purpose while B runs.
      const raced = await newFixture(tenantId, { confirmation: "immediate" });
      const blocked = await newFixture(tenantId, { confirmation: "immediate" });

      try {
        await admin.unsafe(
          "ALTER TABLE awcms_booking_resource_allocations DROP CONSTRAINT awcms_booking_resource_allocations_stay_excl"
        );

        // Deterministic, not a race: A claims the room and stays UNCOMMITTED; B
        // claims the overlapping nights while A is open; then both commit. With
        // the constraint B would block on A (T9 proves it); without it B
        // completes at once, so the await below returns instead of hanging.
        const first = openTransaction(tenantId, (tx) =>
          placeHold(tx, ctxOf(tenantId), stayClaim(raced, D(10), D(12)))
        );

        expect((await first.opened).outcome).toBe("ok");

        const second = await place(tenantId, stayClaim(raced, D(11), D(13)));

        await first.commit();
        expect(second.outcome).toBe("ok");
        stayLive = await liveAllocations(raced.resourceId);
        stayPairs = await overlappingStayPairs(raced.resourceId);

        // The same for a block against a booking (T11).
        const firstBlock = openTransaction(tenantId, (tx) =>
          createBlock(tx, ctxOf(tenantId), blockOf(blocked, D(10), D(12)))
        );

        expect((await firstBlock.opened).outcome).toBe("ok");

        const booking = await place(tenantId, stayClaim(blocked, D(11), D(13)));

        await firstBlock.commit();
        expect(booking.outcome).toBe("ok");
        blockLive = await liveAllocations(blocked.resourceId);
        blockedBookings = await overlappingStayPairs(blocked.resourceId);
      } finally {
        // Put the schema back EXACTLY: the rows written without the constraint
        // violate it, so the booking tables are emptied first (test database
        // only).
        await admin.unsafe(`
          TRUNCATE awcms_booking_reservation_events, awcms_booking_resource_allocations,
                   awcms_booking_reservation_items, awcms_booking_reminder_intents,
                   awcms_booking_staff_assignments, awcms_booking_reservations
        `);
        await admin.unsafe(
          `ALTER TABLE awcms_booking_resource_allocations
             ADD CONSTRAINT awcms_booking_resource_allocations_stay_excl ${definition[0]!.def}`
        );
      }

      expect(stayLive).toBe(2);
      expect(stayPairs).toBe(1);
      expect(blockLive).toBe(2);
      expect(blockedBookings).toBe(1);

      const restored = (await admin`
        SELECT pg_get_constraintdef(oid) AS def
        FROM pg_constraint
        WHERE conname = 'awcms_booking_resource_allocations_stay_excl'
      `) as { def: string }[];

      expect(restored[0]!.def).toBe(definition[0]!.def);
    });
  });
});
