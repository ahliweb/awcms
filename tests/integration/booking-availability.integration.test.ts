/**
 * The `booking` availability slice against a real PostgreSQL (Issue #938,
 * ADR-0131, ADR-0135; sql/186).
 *
 * What is attacked here, because only a database can answer it:
 *
 *   * the schedule non-overlap EXCLUSION CONSTRAINT agrees, pair for pair, with
 *     the pure `effectiveRangesOverlap`;
 *   * the schedule / block / resource TRIGGERS hold what the application layer
 *     states (supersede-not-edit, zone agreement, stay-only blocks);
 *   * RLS isolation of the new table and of the availability read;
 *   * the availability READ end to end under the runtime role `awcms_app`: slots
 *     against real allocations and buffers, stays against real stay allocations
 *     and blocks, same-day turnover, soft closures, lead time, horizon, and the
 *     refusal of another tenant's resource.
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
  assertRejected as assertRejectedByDatabase,
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { resetDatabaseCircuitBreakerForTests } from "../../src/lib/database/circuit-breaker";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import {
  answerAvailability,
  type AvailabilityOutcome,
  type SlotAnswer,
  type StayAnswer
} from "../../src/modules/booking/application/booking-availability-directory";
import { effectiveRangesOverlap } from "../../src/modules/booking/domain/booking-schedule";
import type { AvailabilityRequest } from "../../src/modules/booking/domain/booking-validation";

async function assertRejected(
  promise: Promise<unknown>,
  expected: RegExp
): Promise<Error> {
  const error = await assertRejectedByDatabase(promise, String(expected));
  resetDatabaseCircuitBreakerForTests();
  const text = `${error.message} ${String((error as { errno?: unknown }).errno ?? "")}`;
  expect(text).toMatch(expected);
  return error;
}

const TENANT_A = "b9380000-0000-4000-8000-00000000000a";
const TENANT_B = "b9380000-0000-4000-8000-00000000000b";

const ACTORS = new Map<string, string>();

function inTenant<T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return withTenantOrThrow(getRuntimeSql(), tenantId, fn);
}

async function seedActor(tenantId: string, tag: string): Promise<void> {
  const admin = getAdminSql();
  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`Actor ${tag}`})
    RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${tag}@example.com`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const user = (await admin`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id})
    RETURNING id
  `) as { id: string }[];
  ACTORS.set(tenantId, user[0]!.id);
}

async function newResource(
  tenantId: string,
  code: string,
  options: {
    mode?: "slot" | "stay";
    capacity?: number;
    timezone?: string;
  } = {}
): Promise<{ resourceId: string; unitIds: string[] }> {
  const admin = getAdminSql();
  const mode = options.mode ?? "slot";
  const capacity = options.capacity ?? 1;
  const timezone = options.timezone ?? "Asia/Pontianak";
  const resource =
    mode === "stay"
      ? ((await admin`
          INSERT INTO awcms_booking_resources
            (tenant_id, code, name, kind, capacity, timezone, booking_mode,
             stay_check_in_time, stay_check_out_time)
          VALUES (${tenantId}, ${code}, ${`Villa ${code}`}, 'villa', ${capacity},
                  ${timezone}, 'stay', '14:00', '12:00')
          RETURNING id
        `) as { id: string }[])
      : ((await admin`
          INSERT INTO awcms_booking_resources
            (tenant_id, code, name, kind, capacity, timezone)
          VALUES (${tenantId}, ${code}, ${`Room ${code}`}, 'room', ${capacity}, ${timezone})
          RETURNING id
        `) as { id: string }[]);
  const unitIds: string[] = [];

  for (let ordinal = 1; ordinal <= capacity; ordinal += 1) {
    const unit = (await admin`
      INSERT INTO awcms_booking_resource_units (tenant_id, resource_id, ordinal)
      VALUES (${tenantId}, ${resource[0]!.id}, ${ordinal})
      RETURNING id
    `) as { id: string }[];

    unitIds.push(unit[0]!.id);
  }

  return { resourceId: resource[0]!.id, unitIds };
}

async function newTimeOffering(
  tenantId: string,
  code: string,
  options: { setup?: number; cleanup?: number } = {}
): Promise<string> {
  const rows = (await getAdminSql()`
    INSERT INTO awcms_booking_service_offerings
      (tenant_id, code, name, granularity, duration_seconds, setup_seconds,
       cleanup_seconds, slot_step_seconds)
    VALUES (${tenantId}, ${code}, 'Hour', 'time', 3600,
            ${options.setup ?? 0}, ${options.cleanup ?? 0}, 3600)
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

async function newStayOffering(
  tenantId: string,
  code: string,
  nights: { min: number; max: number } = { min: 1, max: 30 }
): Promise<string> {
  const rows = (await getAdminSql()`
    INSERT INTO awcms_booking_service_offerings
      (tenant_id, code, name, granularity, min_nights, max_nights)
    VALUES (${tenantId}, ${code}, 'Night', 'stay', ${nights.min}, ${nights.max})
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

/** Mon-Fri 09:00-17:00 local. */
const WEEKDAY_RULES = {
  weekly: Object.fromEntries(
    ["mon", "tue", "wed", "thu", "fri"].map((day) => [
      day,
      [{ from: "09:00", to: "17:00" }]
    ])
  )
};

async function newSchedule(
  tenantId: string,
  resourceId: string | null,
  options: {
    timezone?: string;
    from?: string;
    to?: string | null;
    status?: string;
  } = {}
): Promise<string> {
  const rows = (await getAdminSql()`
    INSERT INTO awcms_booking_schedules
      (tenant_id, resource_id, timezone, effective_from, effective_to, rules, status)
    VALUES (${tenantId}, ${resourceId}, ${options.timezone ?? "Asia/Pontianak"},
            ${options.from ?? "2029-01-01"}::date, ${options.to ?? null}::date,
            ${WEEKDAY_RULES as object}::jsonb, ${options.status ?? "active"})
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

/** A tenant policy wide enough for the 2030 fixtures (the module default horizon is 365 days). */
async function widePolicy(tenantId: string): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_booking_settings (tenant_id, max_horizon_days)
    VALUES (${tenantId}, 3650)
    ON CONFLICT (tenant_id) DO UPDATE SET max_horizon_days = 3650
  `;
}

async function reservation(
  tenantId: string,
  startsAt: string,
  endsAt: string
): Promise<string> {
  const rows = (await getAdminSql()`
    INSERT INTO awcms_booking_reservations
      (tenant_id, status, starts_at, ends_at, created_by)
    VALUES (${tenantId}, 'confirmed', ${startsAt}::timestamptz, ${endsAt}::timestamptz,
            ${ACTORS.get(tenantId) ?? null})
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

async function allocateSlot(
  tenantId: string,
  fixture: { resourceId: string; unitId: string; offeringId: string },
  startsAt: string,
  endsAt: string,
  buffers: { setup?: number; cleanup?: number } = {}
): Promise<void> {
  const admin = getAdminSql();
  const reservationId = await reservation(tenantId, startsAt, endsAt);
  const item = (await admin`
    INSERT INTO awcms_booking_reservation_items
      (tenant_id, reservation_id, line_no, offering_id, offering_code,
       offering_name, granularity, duration_seconds, setup_seconds,
       cleanup_seconds, starts_at, ends_at)
    VALUES (${tenantId}, ${reservationId}, 1, ${fixture.offeringId}, 'svc', 'Hour',
            'time', 3600, ${buffers.setup ?? 0}, ${buffers.cleanup ?? 0},
            ${startsAt}::timestamptz, ${endsAt}::timestamptz)
    RETURNING id
  `) as { id: string }[];

  await admin`
    INSERT INTO awcms_booking_resource_allocations
      (tenant_id, item_id, resource_id, resource_unit_id, granularity, starts_at,
       ends_at, occupied_from, occupied_to)
    VALUES (${tenantId}, ${item[0]!.id}, ${fixture.resourceId}, ${fixture.unitId}, 'time',
            ${startsAt}::timestamptz, ${endsAt}::timestamptz,
            ${startsAt}::timestamptz - make_interval(secs => ${buffers.setup ?? 0}),
            ${endsAt}::timestamptz + make_interval(secs => ${buffers.cleanup ?? 0}))
  `;
}

async function allocateStay(
  tenantId: string,
  fixture: { resourceId: string; unitId: string; offeringId: string },
  checkIn: string,
  checkOut: string
): Promise<void> {
  const admin = getAdminSql();
  const startsAt = `${checkIn}T07:00:00Z`;
  const endsAt = `${checkOut}T05:00:00Z`;
  const reservationId = await reservation(tenantId, startsAt, endsAt);
  const item = (await admin`
    INSERT INTO awcms_booking_reservation_items
      (tenant_id, reservation_id, line_no, offering_id, offering_code,
       offering_name, granularity, starts_at, ends_at, check_in_date,
       check_out_date, nights, check_in_local_time, check_out_local_time, timezone)
    VALUES (${tenantId}, ${reservationId}, 1, ${fixture.offeringId}, 'stay', 'Night',
            'stay', ${startsAt}::timestamptz, ${endsAt}::timestamptz,
            ${checkIn}::date, ${checkOut}::date, ${checkOut}::date - ${checkIn}::date,
            '14:00', '12:00', 'Asia/Pontianak')
    RETURNING id
  `) as { id: string }[];

  await admin`
    INSERT INTO awcms_booking_resource_allocations
      (tenant_id, item_id, resource_id, resource_unit_id, granularity, starts_at,
       ends_at, stay_from, stay_to)
    VALUES (${tenantId}, ${item[0]!.id}, ${fixture.resourceId}, ${fixture.unitId}, 'stay',
            ${startsAt}::timestamptz, ${endsAt}::timestamptz, ${checkIn}::date, ${checkOut}::date)
  `;
}

async function block(
  tenantId: string,
  resourceId: string,
  from: string,
  to: string,
  unitId: string | null = null
): Promise<string> {
  const rows = (await getAdminSql()`
    INSERT INTO awcms_booking_resource_blocks
      (tenant_id, resource_id, resource_unit_id, block_from, block_to, reason_code, created_by)
    VALUES (${tenantId}, ${resourceId}, ${unitId}, ${from}::date, ${to}::date,
            'maintenance', ${ACTORS.get(tenantId) ?? null})
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

function ask(
  tenantId: string,
  request: AvailabilityRequest
): Promise<AvailabilityOutcome> {
  return inTenant(tenantId, (tx) => answerAvailability(tx, tenantId, request));
}

function slotsOf(outcome: AvailabilityOutcome): SlotAnswer {
  expect(outcome.outcome).toBe("ok");

  if (outcome.outcome !== "ok" || outcome.answer.mode !== "slot") {
    throw new Error("expected a slot answer");
  }

  return outcome.answer;
}

function stayOf(outcome: AvailabilityOutcome): StayAnswer {
  expect(outcome.outcome).toBe("ok");

  if (outcome.outcome !== "ok" || outcome.answer.mode !== "stay") {
    throw new Error("expected a stay answer");
  }

  return outcome.answer;
}

// Mon 4 March 2030, 09:00-17:00 at UTC+7 = 02:00Z-10:00Z.
const MONDAY_FROM = "2030-03-04T00:00:00Z";
const MONDAY_TO = "2030-03-05T00:00:00Z";

function slotRequest(
  resourceId: string,
  offeringId: string,
  extra: Partial<Extract<AvailabilityRequest, { mode: "slot" }>> = {}
): AvailabilityRequest {
  return {
    mode: "slot",
    resourceId,
    offeringId,
    quantity: 1,
    fromMs: Date.parse(MONDAY_FROM),
    toMs: Date.parse(MONDAY_TO),
    limit: 100,
    ...extra
  };
}

function stayRequest(
  resourceId: string,
  offeringId: string,
  checkInDate: string,
  checkOutDate: string,
  quantity = 1
): AvailabilityRequest {
  return {
    mode: "stay",
    resourceId,
    offeringId,
    quantity,
    checkInDate,
    checkOutDate
  };
}

const suite = integrationEnabled ? describe : describe.skip;

suite("booking availability (Issue #938, sql/186)", () => {
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
      VALUES (${TENANT_A}, 'avail-a', 'Availability A'),
             (${TENANT_B}, 'avail-b', 'Availability B')
    `;
    await seedActor(TENANT_A, "avail-a");
    await seedActor(TENANT_B, "avail-b");
    await widePolicy(TENANT_A);
    await widePolicy(TENANT_B);
  });

  describe("schedule non-overlap: the exclusion constraint agrees with the pure function", () => {
    const cases: [string, string | null, string, string | null][] = [
      ["2029-01-01", "2029-02-01", "2029-02-01", "2029-03-01"],
      ["2029-01-01", "2029-02-02", "2029-02-01", "2029-03-01"],
      ["2029-01-01", null, "2030-01-01", "2030-02-01"],
      ["2029-02-01", null, "2028-01-01", "2029-02-01"],
      ["2029-01-01", null, "2029-01-01", null],
      ["2029-03-01", "2029-04-01", "2029-01-01", "2029-03-01"]
    ];

    test.each(cases)("[%s,%s) vs [%s,%s)", async (aFrom, aTo, bFrom, bTo) => {
      const { resourceId } = await newResource(TENANT_A, "ex");

      await newSchedule(TENANT_A, resourceId, { from: aFrom, to: aTo });

      const expected = effectiveRangesOverlap(
        { effectiveFrom: aFrom, effectiveTo: aTo },
        { effectiveFrom: bFrom, effectiveTo: bTo }
      );
      const second = newSchedule(TENANT_A, resourceId, {
        from: bFrom,
        to: bTo
      });

      if (expected) {
        await assertRejected(second, /23P01|schedules_no_overlap_excl/);
      } else {
        await second;
      }
    });

    test("scopes are independent: a resource schedule and the tenant default may overlap", async () => {
      const { resourceId } = await newResource(TENANT_A, "scope");

      await newSchedule(TENANT_A, resourceId);
      await newSchedule(TENANT_A, null);
      await assertRejected(
        newSchedule(TENANT_A, null),
        /23P01|no_overlap_excl/
      );
    });

    test("an inactive schedule does not block a new window", async () => {
      const { resourceId } = await newResource(TENANT_A, "inactive");

      await newSchedule(TENANT_A, resourceId, { status: "inactive" });
      await newSchedule(TENANT_A, resourceId);
    });

    test("tenants never conflict with one another", async () => {
      await newSchedule(TENANT_A, null);
      await newSchedule(TENANT_B, null);
    });
  });

  describe("schedule triggers", () => {
    test("rules hold only the weekly key", async () => {
      const { resourceId } = await newResource(TENANT_A, "rules");

      await assertRejected(
        getAdminSql()`
          INSERT INTO awcms_booking_schedules
            (tenant_id, resource_id, timezone, effective_from, rules)
          VALUES (${TENANT_A}, ${resourceId}, 'Asia/Pontianak', '2029-01-01',
                  ${{ weekly: {}, rrule: "FREQ=DAILY" } as object}::jsonb)
        `,
        /rules_keys_check|23514/
      );
    });

    test("a resource-bound schedule is in the resource's zone", async () => {
      const { resourceId } = await newResource(TENANT_A, "tz");

      await assertRejected(
        newSchedule(TENANT_A, resourceId, { timezone: "Asia/Jakarta" }),
        /SCHEDULE_TIMEZONE_MISMATCH/
      );
    });

    test("an unknown zone is refused by the catalogue", async () => {
      await assertRejected(
        newSchedule(TENANT_A, null, { timezone: "Mars/Olympus_Mons" }),
        /TIMEZONE_INVALID/
      );
    });

    test("a schedule is superseded, not edited: only a shorter effective_to and deactivation", async () => {
      const { resourceId } = await newResource(TENANT_A, "edit");
      const id = await newSchedule(TENANT_A, resourceId, { to: "2029-06-01" });
      const admin = getAdminSql();

      await assertRejected(
        admin`UPDATE awcms_booking_schedules SET rules = ${{ weekly: {} } as object}::jsonb WHERE id = ${id}`,
        /superseded, not edited/
      );
      await assertRejected(
        admin`UPDATE awcms_booking_schedules SET effective_from = '2029-02-01' WHERE id = ${id}`,
        /superseded, not edited/
      );
      await assertRejected(
        admin`UPDATE awcms_booking_schedules SET effective_to = '2029-09-01' WHERE id = ${id}`,
        /may only be shortened/
      );
      await assertRejected(
        admin`UPDATE awcms_booking_schedules SET effective_to = NULL WHERE id = ${id}`,
        /may only be shortened/
      );
      await admin`UPDATE awcms_booking_schedules SET effective_to = '2029-03-01' WHERE id = ${id}`;
      await admin`UPDATE awcms_booking_schedules SET status = 'inactive' WHERE id = ${id}`;
      await assertRejected(
        admin`UPDATE awcms_booking_schedules SET status = 'active' WHERE id = ${id}`,
        /cannot be reactivated/
      );
    });

    test("a resource's zone cannot change under an active schedule bound to it", async () => {
      const { resourceId } = await newResource(TENANT_A, "retz");

      await newSchedule(TENANT_A, resourceId);
      await assertRejected(
        getAdminSql()`UPDATE awcms_booking_resources SET timezone = 'Asia/Jakarta' WHERE id = ${resourceId}`,
        /SCHEDULE_TIMEZONE_MISMATCH/
      );
    });

    test("exceptions span at most 366 days and carry a short reason code", async () => {
      const { resourceId } = await newResource(TENANT_A, "excspan");
      const admin = getAdminSql();

      await assertRejected(
        admin`
          INSERT INTO awcms_booking_schedule_exceptions
            (tenant_id, resource_id, local_from, local_to, kind)
          VALUES (${TENANT_A}, ${resourceId}, '2029-01-01', '2030-01-03', 'closed')
        `,
        /span_check|23514/
      );
      await assertRejected(
        admin`
          INSERT INTO awcms_booking_schedule_exceptions
            (tenant_id, resource_id, local_from, local_to, kind, reason_code)
          VALUES (${TENANT_A}, ${resourceId}, '2029-01-01', '2029-01-02', 'closed', 'Family event')
        `,
        /reason_check|23514/
      );
    });
  });

  describe("sql/186 hardening", () => {
    test("a slot step under 300 seconds is refused by the database", async () => {
      await assertRejected(
        getAdminSql()`
          INSERT INTO awcms_booking_service_offerings
            (tenant_id, code, name, granularity, duration_seconds, setup_seconds,
             cleanup_seconds, slot_step_seconds)
          VALUES (${TENANT_A}, 'tiny', 'x', 'time', 3600, 0, 0, 60)
        `,
        /shape_check|23514/
      );
    });

    test("an identical exception is a unique violation, a different range is not", async () => {
      const { resourceId } = await newResource(TENANT_A, "dedupe");
      const insert = (to: string) => getAdminSql()`
        INSERT INTO awcms_booking_schedule_exceptions
          (tenant_id, resource_id, local_from, local_to, kind)
        VALUES (${TENANT_A}, ${resourceId}, '2030-03-04', ${to}::date, 'closed')
      `;

      await insert("2030-03-05");
      await insert("2030-03-06");
      await assertRejected(insert("2030-03-05"), /dedupe_key|23505/);
    });

    test("every new trigger function pins search_path", async () => {
      const rows = (await getAdminSql()`
        SELECT proname FROM pg_proc
        WHERE proname IN ('awcms_booking_guard_block_insert', 'awcms_booking_guard_block_update',
                          'awcms_booking_guard_schedule_write', 'awcms_booking_guard_resource_write')
          AND NOT (coalesce(proconfig, '{}') @> ARRAY['search_path=public, pg_temp'])
      `) as { proname: string }[];

      expect(rows).toEqual([]);
    });
  });

  describe("blocked nights", () => {
    test("a block is placed only on an active STAY resource", async () => {
      const slot = await newResource(TENANT_A, "slotblk");

      await assertRejected(
        block(TENANT_A, slot.resourceId, "2030-03-04", "2030-03-06"),
        /active stay resource/
      );

      const stay = await newResource(TENANT_A, "stayblk", { mode: "stay" });

      await block(TENANT_A, stay.resourceId, "2030-03-04", "2030-03-06");
      await block(
        TENANT_A,
        stay.resourceId,
        "2030-03-08",
        "2030-03-09",
        stay.unitIds[0]!
      );
    });

    test("a named unit must belong to the resource (composite foreign key)", async () => {
      const first = await newResource(TENANT_A, "blk1", { mode: "stay" });
      const second = await newResource(TENANT_A, "blk2", { mode: "stay" });

      await assertRejected(
        block(
          TENANT_A,
          first.resourceId,
          "2030-03-04",
          "2030-03-06",
          second.unitIds[0]!
        ),
        /23503|unit_fkey/
      );
    });

    test("a block spans at most 366 nights, with a closed reason code", async () => {
      const stay = await newResource(TENANT_A, "blkspan", { mode: "stay" });
      const admin = getAdminSql();

      await assertRejected(
        block(TENANT_A, stay.resourceId, "2030-01-01", "2031-01-03"),
        /window_check|23514/
      );
      await assertRejected(
        admin`
          INSERT INTO awcms_booking_resource_blocks
            (tenant_id, resource_id, block_from, block_to, reason_code)
          VALUES (${TENANT_A}, ${stay.resourceId}, '2030-03-04', '2030-03-06', 'a free text reason')
        `,
        /reason_check|23514/
      );
    });

    test("only a release may change, once; nothing is deleted", async () => {
      const stay = await newResource(TENANT_A, "blkrel", { mode: "stay" });
      const id = await block(
        TENANT_A,
        stay.resourceId,
        "2030-03-04",
        "2030-03-06"
      );
      const admin = getAdminSql();

      await assertRejected(
        admin`UPDATE awcms_booking_resource_blocks SET block_to = '2030-03-09' WHERE id = ${id}`,
        /only a release/
      );
      await admin`
        UPDATE awcms_booking_resource_blocks
        SET status = 'released', released_at = now(), released_by = ${ACTORS.get(TENANT_A)!}
        WHERE id = ${id}
      `;
      await assertRejected(
        admin`UPDATE awcms_booking_resource_blocks SET status = 'released', released_at = now() WHERE id = ${id}`,
        /already released/
      );
      await assertRejected(
        admin`DELETE FROM awcms_booking_resource_blocks WHERE id = ${id}`,
        /append-only|not allowed/
      );
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`DELETE FROM awcms_booking_resource_blocks WHERE id = ${id}`
        ),
        /permission denied|not allowed/
      );
    });

    test("a resource with a live block keeps its mode and zone", async () => {
      const stay = await newResource(TENANT_A, "blkmode", { mode: "stay" });

      await block(TENANT_A, stay.resourceId, "2030-03-04", "2030-03-06");
      await assertRejected(
        getAdminSql()`UPDATE awcms_booking_resources SET timezone = 'Asia/Jakarta' WHERE id = ${stay.resourceId}`,
        /TIMEZONE_IN_USE/
      );
    });

    test("RLS: tenant B sees none of tenant A's blocks and cannot write one for it", async () => {
      const stay = await newResource(TENANT_A, "blkrls", { mode: "stay" });

      await block(TENANT_A, stay.resourceId, "2030-03-04", "2030-03-06");

      const seenByB = await inTenant(
        TENANT_B,
        (tx) => tx`SELECT id FROM awcms_booking_resource_blocks`
      );

      expect(seenByB).toHaveLength(0);
      await assertRejected(
        inTenant(
          TENANT_B,
          (tx) => tx`
            INSERT INTO awcms_booking_resource_blocks
              (tenant_id, resource_id, block_from, block_to, reason_code)
            VALUES (${TENANT_A}, ${stay.resourceId}, '2030-03-04', '2030-03-06', 'other')
          `
        ),
        /row-level security|violates|active stay resource/
      );
    });
  });

  describe("slot availability read", () => {
    test("a Monday on a Mon-Fri 09:00-17:00 schedule has eight hourly slots", async () => {
      const room = await newResource(TENANT_A, "slot1");
      const offering = await newTimeOffering(TENANT_A, "svc1");

      await newSchedule(TENANT_A, room.resourceId);

      const answer = slotsOf(
        await ask(TENANT_A, slotRequest(room.resourceId, offering))
      );

      expect(answer.timezone).toBe("Asia/Pontianak");
      expect(answer.slots.map((slot) => slot.startsAt)).toEqual(
        Array.from(
          { length: 8 },
          (_, index) =>
            `2030-03-04T${String(2 + index).padStart(2, "0")}:00:00.000Z`
        )
      );
      expect(answer.slots.every((slot) => slot.freeUnits === 1)).toBe(true);
      expect(answer.truncated).toBe(false);
    });

    test("no schedule, no slots", async () => {
      const room = await newResource(TENANT_A, "noschedule");
      const offering = await newTimeOffering(TENANT_A, "svcn");

      expect(
        slotsOf(await ask(TENANT_A, slotRequest(room.resourceId, offering)))
          .slots
      ).toEqual([]);
    });

    test("the tenant default schedule serves a resource without its own", async () => {
      const room = await newResource(TENANT_A, "default");
      const offering = await newTimeOffering(TENANT_A, "svcd");

      await newSchedule(TENANT_A, null);

      expect(
        slotsOf(await ask(TENANT_A, slotRequest(room.resourceId, offering)))
          .slots
      ).toHaveLength(8);
    });

    test("an allocation removes exactly its slot, and a neighbour sharing a boundary is untouched", async () => {
      const room = await newResource(TENANT_A, "alloc");
      const offering = await newTimeOffering(TENANT_A, "svca");
      const fixture = {
        resourceId: room.resourceId,
        unitId: room.unitIds[0]!,
        offeringId: offering
      };

      await newSchedule(TENANT_A, room.resourceId);
      await allocateSlot(
        TENANT_A,
        fixture,
        "2030-03-04T04:00:00Z",
        "2030-03-04T05:00:00Z"
      );

      const starts = slotsOf(
        await ask(TENANT_A, slotRequest(room.resourceId, offering))
      ).slots.map((slot) => slot.startsAt.slice(11, 16));

      expect(starts).toEqual([
        "02:00",
        "03:00",
        "05:00",
        "06:00",
        "07:00",
        "08:00",
        "09:00"
      ]);
    });

    test("a released allocation frees its slot", async () => {
      const room = await newResource(TENANT_A, "released");
      const offering = await newTimeOffering(TENANT_A, "svcr");
      const fixture = {
        resourceId: room.resourceId,
        unitId: room.unitIds[0]!,
        offeringId: offering
      };

      await newSchedule(TENANT_A, room.resourceId);
      await allocateSlot(
        TENANT_A,
        fixture,
        "2030-03-04T04:00:00Z",
        "2030-03-04T05:00:00Z"
      );
      await getAdminSql()`
        UPDATE awcms_booking_resource_allocations
        SET released_at = now(), released_reason = 'cancelled'
        WHERE resource_id = ${room.resourceId}
      `;

      expect(
        slotsOf(await ask(TENANT_A, slotRequest(room.resourceId, offering)))
          .slots
      ).toHaveLength(8);
    });

    test("buffers: the occupied range, not the service interval, is read from the allocation", async () => {
      const room = await newResource(TENANT_A, "buffers");
      const offering = await newTimeOffering(TENANT_A, "svcb", {
        setup: 900,
        cleanup: 900
      });
      const fixture = {
        resourceId: room.resourceId,
        unitId: room.unitIds[0]!,
        offeringId: offering
      };

      await newSchedule(TENANT_A, room.resourceId);
      // Occupies 03:45-05:15.
      await allocateSlot(
        TENANT_A,
        fixture,
        "2030-03-04T04:00:00Z",
        "2030-03-04T05:00:00Z",
        {
          setup: 900,
          cleanup: 900
        }
      );

      const starts = slotsOf(
        await ask(TENANT_A, slotRequest(room.resourceId, offering))
      ).slots.map((slot) => slot.startsAt.slice(11, 16));

      // 02:00-03:00 occupies 01:45-03:15 (free); 03:00 collides; 04:00 collides;
      // 05:00 occupies 04:45-06:15 and collides with 03:45-05:15; 06:00 occupies 05:45-07:15 (free).
      expect(starts).toEqual(["02:00", "06:00", "07:00", "08:00", "09:00"]);
    });

    test("capacity: a slot stays bookable while any unit is free", async () => {
      const room = await newResource(TENANT_A, "cap", { capacity: 2 });
      const offering = await newTimeOffering(TENANT_A, "svcc");
      const fixture = {
        resourceId: room.resourceId,
        unitId: room.unitIds[0]!,
        offeringId: offering
      };

      await newSchedule(TENANT_A, room.resourceId);
      await allocateSlot(
        TENANT_A,
        fixture,
        "2030-03-04T04:00:00Z",
        "2030-03-04T05:00:00Z"
      );

      const answer = slotsOf(
        await ask(TENANT_A, slotRequest(room.resourceId, offering))
      );
      const four = answer.slots.find((slot) =>
        slot.startsAt.startsWith("2030-03-04T04:00")
      );

      expect(four?.freeUnits).toBe(1);
      expect(
        slotsOf(
          await ask(
            TENANT_A,
            slotRequest(room.resourceId, offering, { quantity: 2 })
          )
        ).slots
      ).toHaveLength(7);
    });

    test("a closed day removes the windows; override hours replace them", async () => {
      const room = await newResource(TENANT_A, "exc");
      const offering = await newTimeOffering(TENANT_A, "svce");
      const admin = getAdminSql();

      await newSchedule(TENANT_A, room.resourceId);
      await admin`
        INSERT INTO awcms_booking_schedule_exceptions
          (tenant_id, resource_id, local_from, local_to, kind, reason_code)
        VALUES (${TENANT_A}, ${room.resourceId}, '2030-03-04', '2030-03-05', 'closed', 'holiday')
      `;
      expect(
        slotsOf(await ask(TENANT_A, slotRequest(room.resourceId, offering)))
          .slots
      ).toEqual([]);

      await admin`DELETE FROM awcms_booking_schedule_exceptions WHERE resource_id = ${room.resourceId}`;
      await admin`
        INSERT INTO awcms_booking_schedule_exceptions
          (tenant_id, resource_id, local_from, local_to, kind, windows)
        VALUES (${TENANT_A}, ${room.resourceId}, '2030-03-04', '2030-03-05', 'override_hours',
                ${[{ from: "10:00", to: "12:00" }] as object}::jsonb)
      `;
      expect(
        slotsOf(
          await ask(TENANT_A, slotRequest(room.resourceId, offering))
        ).slots.map((slot) => slot.startsAt.slice(11, 16))
      ).toEqual(["03:00", "04:00"]);
    });

    test("lead time and the horizon come from the offering, then the tenant policy", async () => {
      const room = await newResource(TENANT_A, "policy");
      const offering = await newTimeOffering(TENANT_A, "svcp");

      await newSchedule(TENANT_A, room.resourceId);
      // A 10-day horizon makes a 2030 date unreachable.
      await getAdminSql()`UPDATE awcms_booking_settings SET max_horizon_days = 10 WHERE tenant_id = ${TENANT_A}`;
      expect(
        slotsOf(await ask(TENANT_A, slotRequest(room.resourceId, offering)))
          .slots
      ).toEqual([]);
      // The offering's own horizon wins over the tenant policy.
      await getAdminSql()`UPDATE awcms_booking_service_offerings SET max_horizon_days = 3650 WHERE id = ${offering}`;
      expect(
        slotsOf(await ask(TENANT_A, slotRequest(room.resourceId, offering)))
          .slots
      ).toHaveLength(8);
    });

    test("the answer is bounded and says when it is truncated", async () => {
      const room = await newResource(TENANT_A, "bounded");
      const offering = await newTimeOffering(TENANT_A, "svcl");

      await newSchedule(TENANT_A, room.resourceId);

      const answer = slotsOf(
        await ask(
          TENANT_A,
          slotRequest(room.resourceId, offering, { limit: 3 })
        )
      );

      expect(answer.slots).toHaveLength(3);
      expect(answer.truncated).toBe(true);
    });

    test("DST: a New York resource on the spring-forward Sunday has two real hours", async () => {
      const room = await newResource(TENANT_A, "ny", {
        timezone: "America/New_York"
      });
      const offering = await newTimeOffering(TENANT_A, "svcny");
      const admin = getAdminSql();

      await admin`
        INSERT INTO awcms_booking_schedules
          (tenant_id, resource_id, timezone, effective_from, rules)
        VALUES (${TENANT_A}, ${room.resourceId}, 'America/New_York', '2029-01-01',
                ${{ weekly: { sun: [{ from: "01:00", to: "04:00" }] } } as object}::jsonb)
      `;

      // Sunday 10 March 2030: spring forward at 02:00 local.
      const answer = slotsOf(
        await ask(
          TENANT_A,
          slotRequest(room.resourceId, offering, {
            fromMs: Date.parse("2030-03-10T00:00:00Z"),
            toMs: Date.parse("2030-03-11T00:00:00Z")
          })
        )
      );

      expect(answer.slots.map((slot) => slot.startsAt)).toEqual([
        "2030-03-10T06:00:00.000Z",
        "2030-03-10T07:00:00.000Z"
      ]);
    });
  });

  describe("stay availability read", () => {
    test("a free stay: nights by date arithmetic and the derived instants", async () => {
      const villa = await newResource(TENANT_A, "stay1", { mode: "stay" });
      const offering = await newStayOffering(TENANT_A, "night1");
      const answer = stayOf(
        await ask(
          TENANT_A,
          stayRequest(villa.resourceId, offering, "2030-03-04", "2030-03-07")
        )
      );

      expect(answer.available).toBe(true);
      expect(answer.nights).toBe(3);
      expect(answer.arrivalAt).toBe("2030-03-04T07:00:00.000Z");
      expect(answer.departureAt).toBe("2030-03-07T05:00:00.000Z");
      expect(answer.reasons).toEqual([]);
    });

    test("same-day turnover: a stay may start the day another checks out", async () => {
      const villa = await newResource(TENANT_A, "turn", { mode: "stay" });
      const offering = await newStayOffering(TENANT_A, "nightt");
      const fixture = {
        resourceId: villa.resourceId,
        unitId: villa.unitIds[0]!,
        offeringId: offering
      };

      await allocateStay(TENANT_A, fixture, "2030-03-04", "2030-03-07");

      expect(
        stayOf(
          await ask(
            TENANT_A,
            stayRequest(villa.resourceId, offering, "2030-03-07", "2030-03-09")
          )
        ).available
      ).toBe(true);
      expect(
        stayOf(
          await ask(
            TENANT_A,
            stayRequest(villa.resourceId, offering, "2030-03-02", "2030-03-04")
          )
        ).available
      ).toBe(true);

      const clash = stayOf(
        await ask(
          TENANT_A,
          stayRequest(villa.resourceId, offering, "2030-03-06", "2030-03-09")
        )
      );

      expect(clash.available).toBe(false);
      expect(clash.reasons.map((reason) => reason.code)).toEqual([
        "NO_UNIT_AVAILABLE"
      ]);
    });

    test("a block is a hard exclusion with no reservation involved", async () => {
      const villa = await newResource(TENANT_A, "blocked", { mode: "stay" });
      const offering = await newStayOffering(TENANT_A, "nightb");

      await block(TENANT_A, villa.resourceId, "2030-03-05", "2030-03-06");

      const answer = stayOf(
        await ask(
          TENANT_A,
          stayRequest(villa.resourceId, offering, "2030-03-04", "2030-03-07")
        )
      );

      expect(answer.available).toBe(false);
      expect(answer.reasons).toEqual([{ code: "BLOCKED", overridable: false }]);
      expect(
        stayOf(
          await ask(
            TENANT_A,
            stayRequest(villa.resourceId, offering, "2030-03-06", "2030-03-08")
          )
        ).available
      ).toBe(true);
    });

    test("a released block returns its nights to sale", async () => {
      const villa = await newResource(TENANT_A, "relblock", { mode: "stay" });
      const offering = await newStayOffering(TENANT_A, "nightr");
      const id = await block(
        TENANT_A,
        villa.resourceId,
        "2030-03-05",
        "2030-03-06"
      );

      await getAdminSql()`
        UPDATE awcms_booking_resource_blocks SET status = 'released', released_at = now() WHERE id = ${id}
      `;

      expect(
        stayOf(
          await ask(
            TENANT_A,
            stayRequest(villa.resourceId, offering, "2030-03-04", "2030-03-07")
          )
        ).available
      ).toBe(true);
    });

    test("a block of one unit leaves another unit selling", async () => {
      const villa = await newResource(TENANT_A, "twounits", {
        mode: "stay",
        capacity: 2
      });
      const offering = await newStayOffering(TENANT_A, "nightu");

      await block(
        TENANT_A,
        villa.resourceId,
        "2030-03-04",
        "2030-03-07",
        villa.unitIds[0]!
      );

      const answer = stayOf(
        await ask(
          TENANT_A,
          stayRequest(villa.resourceId, offering, "2030-03-04", "2030-03-06")
        )
      );

      expect(answer.available).toBe(true);
      expect(answer.freeUnits).toBe(1);
    });

    test("a closed exception is a soft, overridable closure", async () => {
      const villa = await newResource(TENANT_A, "closure", { mode: "stay" });
      const offering = await newStayOffering(TENANT_A, "nightc");

      await getAdminSql()`
        INSERT INTO awcms_booking_schedule_exceptions
          (tenant_id, resource_id, local_from, local_to, kind, reason_code)
        VALUES (${TENANT_A}, ${villa.resourceId}, '2030-03-05', '2030-03-06', 'closed', 'renovation')
      `;

      const answer = stayOf(
        await ask(
          TENANT_A,
          stayRequest(villa.resourceId, offering, "2030-03-04", "2030-03-07")
        )
      );

      expect(
        answer.reasons.map((reason) => [reason.code, reason.overridable])
      ).toEqual([["OUTSIDE_SCHEDULE", true]]);
    });

    test("the weekly windows of a schedule are ignored for a stay resource", async () => {
      const villa = await newResource(TENANT_A, "weekly", { mode: "stay" });
      const offering = await newStayOffering(TENANT_A, "nightw");

      // Saturday 9 to Monday 11 March 2030: the Mon-Fri schedule says nothing about a stay.
      await newSchedule(TENANT_A, villa.resourceId);

      expect(
        stayOf(
          await ask(
            TENANT_A,
            stayRequest(villa.resourceId, offering, "2030-03-09", "2030-03-11")
          )
        ).available
      ).toBe(true);
    });

    test("the offering's night limits apply", async () => {
      const villa = await newResource(TENANT_A, "limits", { mode: "stay" });
      const offering = await newStayOffering(TENANT_A, "nightl", {
        min: 2,
        max: 3
      });
      const nightsFor = async (checkOut: string): Promise<string[]> =>
        stayOf(
          await ask(
            TENANT_A,
            stayRequest(villa.resourceId, offering, "2030-03-04", checkOut)
          )
        ).reasons.map((reason) => reason.code);

      expect(await nightsFor("2030-03-05")).toEqual(["MIN_STAY_VIOLATION"]);
      expect(await nightsFor("2030-03-06")).toEqual([]);
      expect(await nightsFor("2030-03-08")).toEqual(["MAX_STAY_EXCEEDED"]);
    });

    test("a past check-in date is STAY_DATES_INVALID by the database clock", async () => {
      const villa = await newResource(TENANT_A, "past", { mode: "stay" });
      const offering = await newStayOffering(TENANT_A, "nightpast");
      const answer = stayOf(
        await ask(
          TENANT_A,
          stayRequest(villa.resourceId, offering, "2020-03-04", "2020-03-07")
        )
      );

      expect(answer.reasons.map((reason) => reason.code)).toEqual([
        "STAY_DATES_INVALID"
      ]);
    });
  });

  describe("refusals", () => {
    test("a slot question about a stay resource is a mode mismatch, and the reverse", async () => {
      const villa = await newResource(TENANT_A, "mm-stay", { mode: "stay" });
      const room = await newResource(TENANT_A, "mm-slot");
      const stayOffering = await newStayOffering(TENANT_A, "mm-night");
      const timeOffering = await newTimeOffering(TENANT_A, "mm-hour");

      expect(
        (await ask(TENANT_A, slotRequest(villa.resourceId, stayOffering)))
          .outcome
      ).toBe("mode_mismatch");
      expect(
        (await ask(TENANT_A, slotRequest(villa.resourceId, timeOffering)))
          .outcome
      ).toBe("mode_mismatch");
      expect(
        (
          await ask(
            TENANT_A,
            stayRequest(
              room.resourceId,
              stayOffering,
              "2030-03-04",
              "2030-03-06"
            )
          )
        ).outcome
      ).toBe("mode_mismatch");
      expect(
        (
          await ask(
            TENANT_A,
            stayRequest(
              villa.resourceId,
              timeOffering,
              "2030-03-04",
              "2030-03-06"
            )
          )
        ).outcome
      ).toBe("mode_mismatch");
    });

    test("another tenant's resource is not found, never forbidden", async () => {
      const room = await newResource(TENANT_A, "mine");
      const offeringA = await newTimeOffering(TENANT_A, "svc-mine");
      const offeringB = await newTimeOffering(TENANT_B, "svc-b");

      expect(
        await ask(TENANT_B, slotRequest(room.resourceId, offeringB))
      ).toEqual({
        outcome: "not_found",
        what: "resource"
      });
      expect(
        await ask(TENANT_B, slotRequest(room.resourceId, offeringA))
      ).toEqual({
        outcome: "not_found",
        what: "resource"
      });
    });

    test("another tenant's offering is not found", async () => {
      const roomB = await newResource(TENANT_B, "rb");
      const offeringA = await newTimeOffering(TENANT_A, "svc-a-only");

      expect(
        await ask(TENANT_B, slotRequest(roomB.resourceId, offeringA))
      ).toEqual({
        outcome: "not_found",
        what: "offering"
      });
    });

    test("a soft-deleted or inactive resource is not found", async () => {
      const room = await newResource(TENANT_A, "gone");
      const offering = await newTimeOffering(TENANT_A, "svc-gone");

      await getAdminSql()`UPDATE awcms_booking_resources SET deleted_at = now() WHERE id = ${room.resourceId}`;
      expect(
        (await ask(TENANT_A, slotRequest(room.resourceId, offering))).outcome
      ).toBe("not_found");
    });

    test("quantity above the active unit count is refused", async () => {
      const room = await newResource(TENANT_A, "qty");
      const offering = await newTimeOffering(TENANT_A, "svc-qty");

      expect(
        await ask(
          TENANT_A,
          slotRequest(room.resourceId, offering, { quantity: 3 })
        )
      ).toEqual({
        outcome: "too_many_units",
        units: 1
      });
    });

    test("an availability read persists nothing", async () => {
      const room = await newResource(TENANT_A, "ro");
      const offering = await newTimeOffering(TENANT_A, "svc-ro");
      const admin = getAdminSql();
      const count = async (): Promise<number> =>
        Number(
          (
            (await admin`
              SELECT (SELECT count(*) FROM awcms_booking_resource_allocations)
                   + (SELECT count(*) FROM awcms_booking_reservations)
                   + (SELECT count(*) FROM awcms_booking_schedules) AS n
            `) as { n: string }[]
          )[0]!.n
        );
      const before = await count();

      await newSchedule(TENANT_A, room.resourceId);
      await ask(TENANT_A, slotRequest(room.resourceId, offering));
      expect(await count()).toBe(before + 1);
    });
  });
});
