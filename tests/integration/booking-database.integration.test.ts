/**
 * The `booking` schema against a real PostgreSQL (Issue #937, ADR-0131,
 * ADR-0135).
 *
 * This slice has no route and no allocator, so what is worth attacking is the
 * set of invariants the DATABASE itself holds and that must hold even if the
 * application code were bypassed:
 *
 *   * tenant isolation under the runtime role `awcms_app` (FORCE RLS), and
 *     composite (tenant_id, id) foreign keys that make a cross-tenant reference
 *     unrepresentable;
 *   * the reservation state machine as a trigger -- every (from, to) pair of
 *     the eight statuses, compared against the pure function;
 *   * append-only history (UPDATE and DELETE refused, by trigger AND privilege);
 *   * the two exclusion constraints (slot and stay) and their half-open
 *     boundaries, buffers and release;
 *   * no money, product id or customer name in any column.
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
  getOwnerSql,
  getRuntimeSql,
  getWorkerRoleSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
  workerRoleActivated
} from "./harness";
import { resetDatabaseCircuitBreakerForTests } from "../../src/lib/database/circuit-breaker";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import {
  RESERVATION_STATUSES,
  evaluateTransition,
  type ReservationAction,
  type ReservationStatus
} from "../../src/modules/booking/domain/booking-reservation-state";

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

const TENANT_A = "b9370000-0000-4000-8000-00000000000a";
const TENANT_B = "b9370000-0000-4000-8000-00000000000b";

const BOOKING_TABLES = [
  "awcms_booking_settings",
  "awcms_booking_resource_pools",
  "awcms_booking_resources",
  "awcms_booking_resource_units",
  "awcms_booking_service_offerings",
  "awcms_booking_schedules",
  "awcms_booking_schedule_exceptions",
  "awcms_booking_reservations",
  "awcms_booking_reservation_items",
  "awcms_booking_resource_allocations",
  "awcms_booking_resource_blocks",
  "awcms_booking_reservation_events"
] as const;

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

type Fixture = {
  resourceId: string;
  unitId: string;
  offeringId: string;
};

/** A slot-mode resource with one unit and a 60-minute offering. */
async function newSlotFixture(
  tenantId: string,
  code: string,
  extra: { setup?: number; cleanup?: number; capacity?: number } = {}
): Promise<Fixture & { unitIds: string[] }> {
  const admin = getAdminSql();
  const capacity = extra.capacity ?? 1;
  const resource = (await admin`
    INSERT INTO awcms_booking_resources
      (tenant_id, code, name, kind, capacity, timezone)
    VALUES (${tenantId}, ${code}, ${`Room ${code}`}, 'room', ${capacity}, 'Asia/Pontianak')
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
  const offering = (await admin`
    INSERT INTO awcms_booking_service_offerings
      (tenant_id, code, name, granularity, duration_seconds, setup_seconds,
       cleanup_seconds, slot_step_seconds)
    VALUES (${tenantId}, ${`svc-${code}`}, 'Hour', 'time', 3600,
            ${extra.setup ?? 0}, ${extra.cleanup ?? 0}, 900)
    RETURNING id
  `) as { id: string }[];
  return {
    resourceId: resource[0]!.id,
    unitId: unitIds[0]!,
    unitIds,
    offeringId: offering[0]!.id
  };
}

async function newStayFixture(tenantId: string, code: string) {
  const admin = getAdminSql();
  const resource = (await admin`
    INSERT INTO awcms_booking_resources
      (tenant_id, code, name, kind, capacity, timezone, booking_mode,
       stay_check_in_time, stay_check_out_time)
    VALUES (${tenantId}, ${code}, ${`Villa ${code}`}, 'villa', 1, 'Asia/Pontianak',
            'stay', '14:00', '12:00')
    RETURNING id
  `) as { id: string }[];
  const unit = (await admin`
    INSERT INTO awcms_booking_resource_units (tenant_id, resource_id, ordinal)
    VALUES (${tenantId}, ${resource[0]!.id}, 1)
    RETURNING id
  `) as { id: string }[];
  const offering = (await admin`
    INSERT INTO awcms_booking_service_offerings
      (tenant_id, code, name, granularity, min_nights, max_nights)
    VALUES (${tenantId}, ${`stay-${code}`}, 'Night', 'stay', 1, 30)
    RETURNING id
  `) as { id: string }[];
  return {
    resourceId: resource[0]!.id,
    unitId: unit[0]!.id,
    offeringId: offering[0]!.id
  };
}

type ReservationOptions = {
  status?: "held" | "confirmed";
  holdExpiresInSeconds?: number;
  startsAt?: string;
  endsAt?: string;
};

async function newReservation(
  tenantId: string,
  options: ReservationOptions = {}
): Promise<string> {
  const status = options.status ?? "held";
  const startsAt = options.startsAt ?? "2026-11-01T03:00:00Z";
  const endsAt = options.endsAt ?? "2026-11-01T04:00:00Z";
  const rows = (await getAdminSql()`
    INSERT INTO awcms_booking_reservations
      (tenant_id, status, starts_at, ends_at, hold_expires_at, created_by)
    VALUES (
      ${tenantId}, ${status}, ${startsAt}::timestamptz, ${endsAt}::timestamptz,
      ${
        status === "held"
          ? getAdminSql()`clock_timestamp() + make_interval(secs => ${options.holdExpiresInSeconds ?? 900})`
          : null
      },
      ${ACTORS.get(tenantId) ?? null}
    )
    RETURNING id
  `) as { id: string }[];
  return rows[0]!.id;
}

async function newTimeItem(
  tenantId: string,
  reservationId: string,
  offeringId: string,
  startsAt: string,
  endsAt: string,
  buffers: { setup?: number; cleanup?: number } = {},
  lineNo = 1
): Promise<string> {
  const rows = (await getAdminSql()`
    INSERT INTO awcms_booking_reservation_items
      (tenant_id, reservation_id, line_no, offering_id, offering_code,
       offering_name, granularity, duration_seconds, setup_seconds,
       cleanup_seconds, starts_at, ends_at)
    VALUES (${tenantId}, ${reservationId}, ${lineNo}, ${offeringId}, 'svc', 'Hour',
            'time', 3600, ${buffers.setup ?? 0}, ${buffers.cleanup ?? 0},
            ${startsAt}::timestamptz, ${endsAt}::timestamptz)
    RETURNING id
  `) as { id: string }[];
  return rows[0]!.id;
}

/** Inserts the allocation for a time item, deriving the occupied range. */
function allocateTime(
  tenantId: string,
  itemId: string,
  fixture: { resourceId: string; unitId: string },
  startsAt: string,
  endsAt: string,
  buffers: { setup?: number; cleanup?: number } = {},
  sql: Bun.SQL = getAdminSql()
) {
  return sql`
    INSERT INTO awcms_booking_resource_allocations
      (tenant_id, item_id, resource_id, resource_unit_id, granularity, starts_at,
       ends_at, occupied_from, occupied_to)
    VALUES (${tenantId}, ${itemId}, ${fixture.resourceId}, ${fixture.unitId}, 'time',
            ${startsAt}::timestamptz, ${endsAt}::timestamptz,
            ${startsAt}::timestamptz - make_interval(secs => ${buffers.setup ?? 0}),
            ${endsAt}::timestamptz + make_interval(secs => ${buffers.cleanup ?? 0}))
    RETURNING id
  `;
}

async function bookSlot(
  tenantId: string,
  fixture: Fixture,
  startsAt: string,
  endsAt: string,
  buffers: { setup?: number; cleanup?: number } = {}
) {
  const reservationId = await newReservation(tenantId, { startsAt, endsAt });
  const itemId = await newTimeItem(
    tenantId,
    reservationId,
    fixture.offeringId,
    startsAt,
    endsAt,
    buffers
  );
  return {
    reservationId,
    itemId,
    allocate: () =>
      allocateTime(tenantId, itemId, fixture, startsAt, endsAt, buffers)
  };
}

async function newStayItemAndAllocation(
  tenantId: string,
  fixture: Fixture,
  checkIn: string,
  checkOut: string
) {
  const admin = getAdminSql();
  const reservationId = await newReservation(tenantId, {
    startsAt: `${checkIn}T06:00:00Z`,
    endsAt: `${checkOut}T04:00:00Z`
  });
  const item = (await admin`
    INSERT INTO awcms_booking_reservation_items
      (tenant_id, reservation_id, line_no, offering_id, offering_code,
       offering_name, granularity, starts_at, ends_at, check_in_date,
       check_out_date, nights, check_in_local_time, check_out_local_time, timezone)
    VALUES (${tenantId}, ${reservationId}, 1, ${fixture.offeringId}, 'stay', 'Night',
            'stay', ${`${checkIn}T06:00:00Z`}::timestamptz,
            ${`${checkOut}T04:00:00Z`}::timestamptz,
            ${checkIn}::date, ${checkOut}::date,
            ${checkOut}::date - ${checkIn}::date, '14:00', '12:00', 'Asia/Pontianak')
    RETURNING id
  `) as { id: string }[];
  return {
    reservationId,
    itemId: item[0]!.id,
    allocate: () => admin`
      INSERT INTO awcms_booking_resource_allocations
        (tenant_id, item_id, resource_id, resource_unit_id, granularity, starts_at,
         ends_at, stay_from, stay_to)
      VALUES (${tenantId}, ${item[0]!.id}, ${fixture.resourceId}, ${fixture.unitId},
              'stay', ${`${checkIn}T06:00:00Z`}::timestamptz,
              ${`${checkOut}T04:00:00Z`}::timestamptz, ${checkIn}::date, ${checkOut}::date)
      RETURNING id
    `
  };
}

const suite = integrationEnabled ? describe : describe.skip;

suite("booking database invariants (Issue #937, ADR-0131)", () => {
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
      VALUES (${TENANT_A}, 'book-a', 'Booking A'),
             (${TENANT_B}, 'book-b', 'Booking B')
    `;
    await seedActor(TENANT_A, "actor-a");
    await seedActor(TENANT_B, "actor-b");
  });

  describe("tenant isolation", () => {
    test("every table has RLS enabled AND forced, with a tenant policy", async () => {
      const rows = (await getAdminSql()`
        SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
               (SELECT count(*) FROM pg_policies p
                 WHERE p.tablename = c.relname
                   AND p.policyname = c.relname || '_tenant_isolation')::int AS policies
        FROM pg_class c
        WHERE c.relname LIKE 'awcms_booking_%' AND c.relkind = 'r'
        ORDER BY c.relname
      `) as {
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
        policies: number;
      }[];
      expect(rows.map((row) => row.relname).sort()).toEqual(
        [...BOOKING_TABLES].sort()
      );
      for (const row of rows) {
        expect(row.relrowsecurity).toBe(true);
        expect(row.relforcerowsecurity).toBe(true);
        expect(row.policies).toBe(1);
      }
    });

    test("tenant B sees nothing of tenant A, and cannot write into it", async () => {
      const a = await newSlotFixture(TENANT_A, "iso");
      const booking = await bookSlot(
        TENANT_A,
        a,
        "2026-11-01T03:00:00Z",
        "2026-11-01T04:00:00Z"
      );
      await booking.allocate();
      await getAdminSql()`
        INSERT INTO awcms_booking_reservation_events
          (tenant_id, reservation_id, seq, kind, to_status)
        VALUES (${TENANT_A}, ${booking.reservationId}, 1, 'created', 'held')
      `;

      for (const table of BOOKING_TABLES) {
        const asA = await inTenant(
          TENANT_A,
          (tx) =>
            tx.unsafe(`SELECT count(*)::int AS n FROM ${table}`) as Promise<
              { n: number }[]
            >
        );
        const asB = await inTenant(
          TENANT_B,
          (tx) =>
            tx.unsafe(`SELECT count(*)::int AS n FROM ${table}`) as Promise<
              { n: number }[]
            >
        );
        expect(asB[0]!.n).toBe(0);
        if (
          table !== "awcms_booking_settings" &&
          table !== "awcms_booking_resource_pools" &&
          table !== "awcms_booking_schedules" &&
          table !== "awcms_booking_schedule_exceptions" &&
          // Blocks are covered by booking-availability.integration.test.ts.
          table !== "awcms_booking_resource_blocks"
        ) {
          expect(asA[0]!.n).toBeGreaterThan(0);
        }
      }

      // B cannot flip A's reservation (the row is invisible: zero rows affected).
      const updated = await inTenant(
        TENANT_B,
        (tx) =>
          tx`UPDATE awcms_booking_reservations SET party_size = 9
             WHERE id = ${booking.reservationId} RETURNING id`
      );
      expect(updated.length).toBe(0);

      // B cannot insert a row claiming tenant A (WITH CHECK).
      await assertRejected(
        inTenant(
          TENANT_B,
          (tx) =>
            tx`INSERT INTO awcms_booking_resources
                 (tenant_id, code, name, kind, timezone)
               VALUES (${TENANT_A}, 'smuggled', 'x', 'room', 'UTC')`
        ),
        /row-level security|42501/i
      );
    });

    test("a composite foreign key cannot reach another tenant's row", async () => {
      const a = await newSlotFixture(TENANT_A, "fk-a");
      const b = await newSlotFixture(TENANT_B, "fk-b");
      const reservationB = await newReservation(TENANT_B);

      // Tenant B's item naming tenant A's offering.
      await assertRejected(
        newTimeItem(
          TENANT_B,
          reservationB,
          a.offeringId,
          "2026-11-01T03:00:00Z",
          "2026-11-01T04:00:00Z"
        ),
        /foreign key|23503/i
      );
      // Tenant B's allocation naming tenant A's unit.
      const itemB = await newTimeItem(
        TENANT_B,
        reservationB,
        b.offeringId,
        "2026-11-01T03:00:00Z",
        "2026-11-01T04:00:00Z"
      );
      await assertRejected(
        allocateTime(
          TENANT_B,
          itemB,
          { resourceId: b.resourceId, unitId: a.unitId },
          "2026-11-01T03:00:00Z",
          "2026-11-01T04:00:00Z"
        ),
        /foreign key|23503|is not active/i
      );
      // A unit paired with a resource it does not belong to, same tenant.
      const other = await newSlotFixture(TENANT_B, "fk-b2");
      await assertRejected(
        allocateTime(
          TENANT_B,
          itemB,
          { resourceId: b.resourceId, unitId: other.unitId },
          "2026-11-01T03:00:00Z",
          "2026-11-01T04:00:00Z"
        ),
        /foreign key|23503/i
      );
    });
  });

  describe("reservation state machine (trigger vs pure function)", () => {
    const ACTION_FOR_TARGET: Partial<
      Record<ReservationStatus, ReservationAction>
    > = {
      confirmed: "confirm",
      expired: "expire",
      cancelled: "cancel",
      rescheduled: "reschedule",
      checked_in: "check_in",
      completed: "complete",
      no_show: "no_show"
    };

    /** Walks a fresh reservation to `status` by LEGAL transitions only. */
    async function reservationIn(
      status: ReservationStatus,
      holdSeconds: number
    ): Promise<string> {
      const admin = getAdminSql();
      const id = await newReservation(TENANT_A, {
        status: "held",
        holdExpiresInSeconds: status === "expired" ? -60 : holdSeconds
      });
      const set = async (to: string, extra = "") => {
        await admin.unsafe(
          `UPDATE awcms_booking_reservations
             SET status = '${to}', status_changed_at = clock_timestamp() ${extra}
           WHERE id = '${id}'`
        );
      };
      switch (status) {
        case "held":
          break;
        case "expired":
          await set("expired");
          break;
        case "cancelled":
          await set("cancelled");
          break;
        case "confirmed":
          await set("confirmed", ", hold_expires_at = NULL");
          break;
        case "checked_in":
          await set("confirmed", ", hold_expires_at = NULL");
          await set("checked_in");
          break;
        case "completed":
          await set("confirmed", ", hold_expires_at = NULL");
          await set("checked_in");
          await set("completed");
          break;
        case "no_show":
          await set("confirmed", ", hold_expires_at = NULL");
          await set("no_show");
          break;
        case "rescheduled": {
          const successor = await newReservation(TENANT_A, {
            status: "confirmed"
          });
          await set("confirmed", ", hold_expires_at = NULL");
          await set("rescheduled", `, superseded_by_id = '${successor}'`);
          break;
        }
      }
      return id;
    }

    for (const from of RESERVATION_STATUSES) {
      for (const to of RESERVATION_STATUSES) {
        if (from === to) {
          continue;
        }
        test(`${from} -> ${to} agrees with evaluateTransition`, async () => {
          const action = ACTION_FOR_TARGET[to];
          // `held` is never a target: there is no verb that returns to it.
          const holdSeconds = to === "expired" ? -60 : 900;
          const expected = action
            ? evaluateTransition({
                from,
                action,
                now: new Date("2026-10-12T10:00:00Z"),
                holdExpiresAt:
                  from === "held"
                    ? new Date(
                        holdSeconds < 0
                          ? "2026-10-12T09:00:00Z"
                          : "2026-10-12T11:00:00Z"
                      )
                    : null
              }).ok
            : false;

          // `expired` as a SOURCE state needs its past expiry; `to === 'expired'`
          // needs one from a held source. Build the source accordingly.
          const id = await reservationIn(
            from,
            from === "held" ? holdSeconds : 900
          );
          const successor =
            to === "rescheduled"
              ? await newReservation(TENANT_A, { status: "confirmed" })
              : null;
          const extra =
            to === "confirmed"
              ? ", hold_expires_at = NULL"
              : to === "rescheduled"
                ? `, superseded_by_id = '${successor}'`
                : "";
          const attempt = getAdminSql().unsafe(
            `UPDATE awcms_booking_reservations
               SET status = '${to}', status_changed_at = clock_timestamp() ${extra}
             WHERE id = '${id}'`
          );

          if (expected) {
            await attempt;
            const rows = (await getAdminSql()`
              SELECT status FROM awcms_booking_reservations WHERE id = ${id}
            `) as { status: string }[];
            expect(rows[0]!.status).toBe(to);
          } else {
            await assertRejected(
              attempt,
              /illegal reservation transition|55000|check|23514/i
            );
          }
        });
      }
    }

    test("a held reservation may only EXTEND its hold", async () => {
      const id = await newReservation(TENANT_A, { holdExpiresInSeconds: 600 });
      const admin = getAdminSql();
      await admin`
        UPDATE awcms_booking_reservations
        SET hold_expires_at = hold_expires_at + interval '5 minutes'
        WHERE id = ${id}`;
      await assertRejected(
        admin`UPDATE awcms_booking_reservations
              SET hold_expires_at = hold_expires_at - interval '1 hour'
              WHERE id = ${id}`,
        /extended, not shortened/
      );
    });

    test("extending a hold: a live one yes, an expired one never (agrees with evaluateTransition)", async () => {
      const admin = getAdminSql();
      const live = await newReservation(TENANT_A, {
        holdExpiresInSeconds: 600
      });
      const dead = await newReservation(TENANT_A, { holdExpiresInSeconds: -5 });
      for (const [id, holdExpiresAt] of [
        [live, new Date("2026-10-12T11:00:00Z")],
        [dead, new Date("2026-10-12T09:00:00Z")]
      ] as const) {
        const expected = evaluateTransition({
          from: "held",
          action: "extend",
          now: new Date("2026-10-12T10:00:00Z"),
          holdExpiresAt
        }).ok;
        const attempt = admin`UPDATE awcms_booking_reservations
          SET hold_expires_at = clock_timestamp() + interval '1 hour'
          WHERE id = ${id}`;
        if (expected) {
          await attempt;
        } else {
          await assertRejected(attempt, /HOLD_EXPIRED/);
        }
      }
    });

    test("confirming an expired hold is HOLD_EXPIRED, by the database clock", async () => {
      const id = await newReservation(TENANT_A, { holdExpiresInSeconds: -5 });
      await assertRejected(
        getAdminSql()`UPDATE awcms_booking_reservations
                      SET status = 'confirmed', hold_expires_at = NULL
                      WHERE id = ${id}`,
        /HOLD_EXPIRED/
      );
    });

    test("an unexpired hold cannot be marked expired", async () => {
      const id = await newReservation(TENANT_A, { holdExpiresInSeconds: 600 });
      await assertRejected(
        getAdminSql()`UPDATE awcms_booking_reservations SET status = 'expired'
                      WHERE id = ${id}`,
        /has not expired yet/
      );
    });

    test("a reservation is created held or confirmed, never later", async () => {
      await assertRejected(
        getAdminSql()`
          INSERT INTO awcms_booking_reservations
            (tenant_id, status, starts_at, ends_at)
          VALUES (${TENANT_A}, 'completed', now(), now() + interval '1 hour')`,
        /created held or confirmed|check|23514/i
      );
    });

    test("interval, lineage and identity never change after creation", async () => {
      const id = await newReservation(TENANT_A, { status: "confirmed" });
      const admin = getAdminSql();
      for (const change of [
        "starts_at = starts_at + interval '1 hour'",
        "ends_at = ends_at + interval '1 hour'",
        "party_size = 3",
        "lineage_id = gen_random_uuid()",
        "reservation_no = 'BK-HIJACK01'",
        "external_ref_type = 'order', external_ref = 'x'"
      ]) {
        await assertRejected(
          admin.unsafe(
            `UPDATE awcms_booking_reservations SET ${change} WHERE id = '${id}'`
          ),
          /may not change any column outside its allowed set|55000/
        );
      }
    });

    test("personal references can be severed but never written later", async () => {
      const admin = getAdminSql();
      const rows = (await admin`
        INSERT INTO awcms_booking_reservations
          (tenant_id, status, starts_at, ends_at, external_customer_ref, customer_note)
        VALUES (${TENANT_A}, 'confirmed', now(), now() + interval '1 hour',
                'cust-1', 'window seat')
        RETURNING id`) as { id: string }[];
      const id = rows[0]!.id;
      await assertRejected(
        admin`UPDATE awcms_booking_reservations SET external_customer_ref = 'cust-2'
              WHERE id = ${id}`,
        /may only be severed/
      );
      await assertRejected(
        admin`UPDATE awcms_booking_reservations SET customer_note = 'new note'
              WHERE id = ${id}`,
        /may only be cleared/
      );
      await admin`UPDATE awcms_booking_reservations
                  SET external_customer_ref = NULL, customer_note = NULL
                  WHERE id = ${id}`;
    });

    test("a root reservation is its own lineage", async () => {
      const id = await newReservation(TENANT_A);
      const rows = (await getAdminSql()`
        SELECT lineage_id FROM awcms_booking_reservations WHERE id = ${id}
      `) as { lineage_id: string }[];
      expect(rows[0]!.lineage_id).toBe(id);
    });

    test("only a rescheduled reservation names a successor", async () => {
      const id = await newReservation(TENANT_A, { status: "confirmed" });
      const other = await newReservation(TENANT_A, { status: "confirmed" });
      await assertRejected(
        getAdminSql()`UPDATE awcms_booking_reservations SET superseded_by_id = ${other}
                      WHERE id = ${id}`,
        /may not change any column outside its allowed set/
      );
    });

    test("one live reservation per external reference (natural-key backstop)", async () => {
      const admin = getAdminSql();
      await admin`
        INSERT INTO awcms_booking_reservations
          (tenant_id, status, starts_at, ends_at, hold_expires_at, external_ref_type, external_ref)
        VALUES (${TENANT_A}, 'held', now(), now() + interval '1 hour',
                now() + interval '15 minutes', 'order', 'ORD-1')`;
      await assertRejected(
        admin`
          INSERT INTO awcms_booking_reservations
            (tenant_id, status, starts_at, ends_at, hold_expires_at, external_ref_type, external_ref)
          VALUES (${TENANT_A}, 'held', now(), now() + interval '1 hour',
                  now() + interval '15 minutes', 'order', 'ORD-1')`,
        /23505|duplicate key/i
      );
    });
  });

  describe("append-only history", () => {
    async function oneEvent() {
      const reservationId = await newReservation(TENANT_A);
      await getAdminSql()`
        INSERT INTO awcms_booking_reservation_events
          (tenant_id, reservation_id, seq, kind, to_status, actor_user_id)
        VALUES (${TENANT_A}, ${reservationId}, 1, 'created', 'held',
                ${ACTORS.get(TENANT_A)!})`;
      return reservationId;
    }

    test("events reject UPDATE and DELETE even for a superuser (the trigger layer)", async () => {
      const reservationId = await oneEvent();
      await assertRejected(
        getAdminSql()`UPDATE awcms_booking_reservation_events SET reason_code = 'x'
                      WHERE reservation_id = ${reservationId}`,
        /append-only/
      );
      await assertRejected(
        getAdminSql()`DELETE FROM awcms_booking_reservation_events
                      WHERE reservation_id = ${reservationId}`,
        /append-only/
      );
    });

    test("the runtime role cannot even attempt UPDATE or DELETE on events", async () => {
      const reservationId = await oneEvent();
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) =>
            tx`UPDATE awcms_booking_reservation_events SET reason_code = 'x'
               WHERE reservation_id = ${reservationId}`
        ),
        /permission denied|42501/i
      );
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) =>
            tx`DELETE FROM awcms_booking_reservation_events
               WHERE reservation_id = ${reservationId}`
        ),
        /permission denied|42501/i
      );
    });

    test("each kind happens at most once to a reservation; seq is unique", async () => {
      const reservationId = await oneEvent();
      await assertRejected(
        getAdminSql()`
          INSERT INTO awcms_booking_reservation_events
            (tenant_id, reservation_id, seq, kind, to_status)
          VALUES (${TENANT_A}, ${reservationId}, 2, 'created', 'held')`,
        /23505|duplicate key/i
      );
      await assertRejected(
        getAdminSql()`
          INSERT INTO awcms_booking_reservation_events
            (tenant_id, reservation_id, seq, kind, to_status)
          VALUES (${TENANT_A}, ${reservationId}, 1, 'held', 'held')`,
        /23505|duplicate key/i
      );
    });

    test("event detail must be an object and a reason a short code", async () => {
      const reservationId = await oneEvent();
      await assertRejected(
        getAdminSql()`
          INSERT INTO awcms_booking_reservation_events
            (tenant_id, reservation_id, seq, kind, to_status, detail)
          VALUES (${TENANT_A}, ${reservationId}, 2, 'held', 'held', '"free text"'::jsonb)`,
        /23514|check/i
      );
      await assertRejected(
        getAdminSql()`
          INSERT INTO awcms_booking_reservation_events
            (tenant_id, reservation_id, seq, kind, to_status, reason_code)
          VALUES (${TENANT_A}, ${reservationId}, 2, 'held', 'held', 'Customer was rude')`,
        /23514|check/i
      );
    });

    test("items are immutable and reservations and allocations are never deleted", async () => {
      const fixture = await newSlotFixture(TENANT_A, "imm");
      const booking = await bookSlot(
        TENANT_A,
        fixture,
        "2026-11-01T03:00:00Z",
        "2026-11-01T04:00:00Z"
      );
      const allocation = (await booking.allocate()) as { id: string }[];

      await assertRejected(
        getAdminSql()`UPDATE awcms_booking_reservation_items SET quantity = 2
                      WHERE id = ${booking.itemId}`,
        /append-only/
      );
      await assertRejected(
        getAdminSql()`DELETE FROM awcms_booking_reservation_items
                      WHERE id = ${booking.itemId}`,
        /append-only/
      );
      await assertRejected(
        getAdminSql()`DELETE FROM awcms_booking_reservations
                      WHERE id = ${booking.reservationId}`,
        /append-only|not allowed/
      );
      await assertRejected(
        getAdminSql()`DELETE FROM awcms_booking_resource_allocations
                      WHERE id = ${allocation[0]!.id}`,
        /not allowed/
      );
      await assertRejected(
        getAdminSql()`DELETE FROM awcms_booking_resources
                      WHERE id = ${fixture.resourceId}`,
        /not allowed/
      );
      // And the runtime role is denied DELETE outright.
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) =>
            tx`DELETE FROM awcms_booking_reservations
               WHERE id = ${booking.reservationId}`
        ),
        /permission denied|42501/i
      );
    });

    test("an allocation can be released once, and nothing else on it changes", async () => {
      const fixture = await newSlotFixture(TENANT_A, "rel");
      const booking = await bookSlot(
        TENANT_A,
        fixture,
        "2026-11-01T03:00:00Z",
        "2026-11-01T04:00:00Z"
      );
      const allocation = (await booking.allocate()) as { id: string }[];
      const admin = getAdminSql();
      await assertRejected(
        admin`UPDATE awcms_booking_resource_allocations
              SET occupied_to = occupied_to + interval '1 hour'
              WHERE id = ${allocation[0]!.id}`,
        /only released_at/
      );
      await admin`UPDATE awcms_booking_resource_allocations
                  SET released_at = now(), released_reason = 'cancelled'
                  WHERE id = ${allocation[0]!.id}`;
      await assertRejected(
        admin`UPDATE awcms_booking_resource_allocations
              SET released_reason = 'expired'
              WHERE id = ${allocation[0]!.id}`,
        /already released/
      );
    });

    test("an allocation is only added to a held or confirmed reservation", async () => {
      const fixture = await newSlotFixture(TENANT_A, "late2");
      const booking = await bookSlot(
        TENANT_A,
        fixture,
        "2026-11-01T03:00:00Z",
        "2026-11-01T04:00:00Z"
      );
      await getAdminSql()`UPDATE awcms_booking_reservations SET status = 'cancelled'
                          WHERE id = ${booking.reservationId}`;
      await assertRejected(booking.allocate(), /held or confirmed reservation/);
    });

    test("an allocation is refused on an inactive or deleted resource and an inactive unit", async () => {
      const admin = getAdminSql();
      const fixture = await newSlotFixture(TENANT_A, "inact");
      const booking = await bookSlot(
        TENANT_A,
        fixture,
        "2026-11-01T03:00:00Z",
        "2026-11-01T04:00:00Z"
      );
      await admin`UPDATE awcms_booking_resource_units SET status = 'inactive'
                  WHERE id = ${fixture.unitId}`;
      await assertRejected(booking.allocate(), /unit .* is not active/);
      await admin`UPDATE awcms_booking_resource_units SET status = 'active'
                  WHERE id = ${fixture.unitId}`;
      await admin`UPDATE awcms_booking_resources SET status = 'inactive'
                  WHERE id = ${fixture.resourceId}`;
      await assertRejected(booking.allocate(), /inactive or deleted/);
      await admin`UPDATE awcms_booking_resources
                  SET status = 'active', deleted_at = now()
                  WHERE id = ${fixture.resourceId}`;
      await assertRejected(booking.allocate(), /inactive or deleted/);
    });

    test("the customer reference must be an opaque token, not an email or a name", async () => {
      for (const bad of ["a@b.com", "Budi Santoso", " x", ""]) {
        await assertRejected(
          getAdminSql()`INSERT INTO awcms_booking_reservations
            (tenant_id, status, starts_at, ends_at, external_customer_ref)
            VALUES (${TENANT_A}, 'confirmed', now(), now() + interval '1 hour', ${bad})`,
          /23514|check/i
        );
      }
    });

    test("an item is only added to a held or confirmed reservation", async () => {
      const fixture = await newSlotFixture(TENANT_A, "late");
      const id = await newReservation(TENANT_A);
      await getAdminSql()`UPDATE awcms_booking_reservations SET status = 'cancelled'
                          WHERE id = ${id}`;
      await assertRejected(
        newTimeItem(
          TENANT_A,
          id,
          fixture.offeringId,
          "2026-11-01T03:00:00Z",
          "2026-11-01T04:00:00Z"
        ),
        /held or confirmed reservation/
      );
    });

    test("awcms_worker can read the event log and nothing else of booking", async () => {
      if (!workerRoleActivated) {
        return;
      }
      await oneEvent();
      const worker = getWorkerRoleSql();
      const rows = await worker`SELECT count(*)::int AS n
                                FROM awcms_booking_reservation_events`;
      expect((rows as { n: number }[])[0]!.n).toBeGreaterThanOrEqual(0);
      await assertRejected(
        worker`SELECT 1 FROM awcms_booking_reservations LIMIT 1`,
        /permission denied|42501/i
      );
    });
  });

  describe("double-booking exclusion constraints", () => {
    const H = (hour: number, minute = 0) =>
      `2026-11-01T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`;

    test("overlapping live ranges on one unit conflict with 23P01", async () => {
      const fixture = await newSlotFixture(TENANT_A, "x1");
      await (await bookSlot(TENANT_A, fixture, H(10), H(11))).allocate();
      const second = await bookSlot(TENANT_A, fixture, H(10, 30), H(11, 30));
      const error = await assertRejected(second.allocate(), /23P01|exclusion/i);
      expect(String((error as { errno?: unknown }).errno)).toBe("23P01");
    });

    test("adjacent half-open ranges both commit", async () => {
      const fixture = await newSlotFixture(TENANT_A, "x2");
      await (await bookSlot(TENANT_A, fixture, H(10), H(11))).allocate();
      await (await bookSlot(TENANT_A, fixture, H(11), H(12))).allocate();
    });

    test("buffers occupy: a 15-minute clean-up makes the next hour conflict", async () => {
      const fixture = await newSlotFixture(TENANT_A, "x3", { cleanup: 900 });
      await (
        await bookSlot(TENANT_A, fixture, H(10), H(11), { cleanup: 900 })
      ).allocate();
      const next = await bookSlot(TENANT_A, fixture, H(11), H(12));
      await assertRejected(next.allocate(), /23P01|exclusion/i);
    });

    test("releasing an allocation frees the unit", async () => {
      const fixture = await newSlotFixture(TENANT_A, "x4");
      const first = await bookSlot(TENANT_A, fixture, H(10), H(11));
      const allocation = (await first.allocate()) as { id: string }[];
      await getAdminSql()`UPDATE awcms_booking_resource_allocations
                          SET released_at = now(), released_reason = 'cancelled'
                          WHERE id = ${allocation[0]!.id}`;
      await (await bookSlot(TENANT_A, fixture, H(10), H(11))).allocate();
    });

    test("different units of one resource are independent", async () => {
      const fixture = await newSlotFixture(TENANT_A, "x5", { capacity: 2 });
      const first = await bookSlot(TENANT_A, fixture, H(10), H(11));
      await first.allocate();
      const second = await bookSlot(TENANT_A, fixture, H(10), H(11));
      await allocateTime(
        TENANT_A,
        second.itemId,
        { resourceId: fixture.resourceId, unitId: fixture.unitIds[1]! },
        H(10),
        H(11)
      );
    });

    test("a concurrent insert BLOCKS on an uncommitted one, then fails 23P01 on commit", async () => {
      const fixture = await newSlotFixture(TENANT_A, "x6");
      const a = await bookSlot(TENANT_A, fixture, H(10), H(11));
      const b = await bookSlot(TENANT_A, fixture, H(10, 30), H(11, 30));

      const connA = getAdminSql();
      const connB = getOwnerSql();
      let releaseA: () => void = () => {};
      const holdA = new Promise<void>((resolve) => {
        releaseA = resolve;
      });
      let aInserted: () => void = () => {};
      const aReady = new Promise<void>((resolve) => {
        aInserted = resolve;
      });

      const txA = connA.begin(async (tx) => {
        await allocateTime(
          TENANT_A,
          a.itemId,
          fixture,
          H(10),
          H(11),
          {},
          tx as unknown as Bun.SQL
        );
        aInserted();
        await holdA;
      });
      await aReady;

      let outcome: unknown = "pending";
      const txB = connB
        .begin(async (tx) => {
          await tx`SELECT set_config('app.current_tenant_id', ${TENANT_A}, true)`;
          await allocateTime(
            TENANT_A,
            b.itemId,
            fixture,
            H(10, 30),
            H(11, 30),
            {},
            tx as unknown as Bun.SQL
          );
        })
        .then(
          () => {
            outcome = "committed";
          },
          (error) => {
            outcome = error;
          }
        );

      // Genuine concurrency: B's backend must be waiting on a Lock, not finished.
      let blocked = false;
      for (let i = 0; i < 40 && !blocked; i += 1) {
        const waiting = (await getAdminSql()`
          SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND datname = current_database()
        `) as { n: number }[];
        blocked = waiting[0]!.n > 0;
        if (!blocked) {
          await Bun.sleep(50);
        }
      }
      expect(blocked).toBe(true);
      expect(outcome).toBe("pending");

      releaseA();
      await txA;
      await txB;
      expect(String((outcome as { errno?: unknown }).errno)).toBe("23P01");
    });

    test("stay mode: overlapping nights conflict, same-day turnover does not", async () => {
      const fixture = await newStayFixture(TENANT_A, "s1");
      await (
        await newStayItemAndAllocation(
          TENANT_A,
          fixture,
          "2026-12-10",
          "2026-12-12"
        )
      ).allocate();
      // [12th, 14th) is adjacent to [10th, 12th): allowed.
      await (
        await newStayItemAndAllocation(
          TENANT_A,
          fixture,
          "2026-12-12",
          "2026-12-14"
        )
      ).allocate();
      // [11th, 13th) overlaps both.
      const overlap = await newStayItemAndAllocation(
        TENANT_A,
        fixture,
        "2026-12-11",
        "2026-12-13"
      );
      const error = await assertRejected(
        overlap.allocate(),
        /23P01|exclusion/i
      );
      expect(String((error as { errno?: unknown }).errno)).toBe("23P01");
    });

    test("stay length is bounded at 366 nights, and nights = checkout - checkin", async () => {
      const fixture = await newStayFixture(TENANT_A, "s2");
      await assertRejected(
        newStayItemAndAllocation(TENANT_A, fixture, "2026-01-01", "2027-02-01"),
        /23514|check/i
      );
    });

    test("the allocation granularity must equal the resource's booking_mode", async () => {
      const slot = await newSlotFixture(TENANT_A, "g1");
      const stay = await newStayFixture(TENANT_A, "g2");
      // A stay allocation against a slot resource.
      const stayBooking = await newStayItemAndAllocation(
        TENANT_A,
        stay,
        "2026-12-10",
        "2026-12-12"
      );
      await assertRejected(
        getAdminSql()`
          INSERT INTO awcms_booking_resource_allocations
            (tenant_id, item_id, resource_id, resource_unit_id, granularity,
             starts_at, ends_at, stay_from, stay_to)
          VALUES (${TENANT_A}, ${stayBooking.itemId}, ${slot.resourceId}, ${slot.unitId},
                  'stay', '2026-12-10T06:00:00Z', '2026-12-12T04:00:00Z',
                  '2026-12-10', '2026-12-12')`,
        /does not match resource booking_mode/
      );
    });

    test("an allocation must equal its item's instants and buffer snapshot", async () => {
      const fixture = await newSlotFixture(TENANT_A, "g3", { cleanup: 900 });
      const booking = await bookSlot(TENANT_A, fixture, H(10), H(11), {
        cleanup: 900
      });
      // Occupied range without the snapshotted clean-up.
      await assertRejected(
        allocateTime(TENANT_A, booking.itemId, fixture, H(10), H(11), {}),
        /buffer does not equal the item snapshot/
      );
    });

    test("booking_mode and a stay's timezone cannot change under live allocations", async () => {
      const stay = await newStayFixture(TENANT_A, "g4");
      await (
        await newStayItemAndAllocation(
          TENANT_A,
          stay,
          "2026-12-10",
          "2026-12-12"
        )
      ).allocate();
      await assertRejected(
        getAdminSql()`UPDATE awcms_booking_resources SET timezone = 'Asia/Jakarta'
                      WHERE id = ${stay.resourceId}`,
        /TIMEZONE_IN_USE/
      );
    });
  });

  describe("resource configuration", () => {
    test("a timezone must be an IANA name in the runtime tz database", async () => {
      const admin = getAdminSql();
      for (const bad of ["WIB", "+07:00", "Mars/Olympus_Mons"]) {
        await assertRejected(
          admin`INSERT INTO awcms_booking_resources
                  (tenant_id, code, name, kind, timezone)
                VALUES (${TENANT_A}, ${`tz-${bad.length}`}, 'x', 'room', ${bad})`,
          /23514|check|TIMEZONE_INVALID/i
        );
      }
    });

    test("stay times exist exactly for a stay resource, capacity is 1..500", async () => {
      const admin = getAdminSql();
      await assertRejected(
        admin`INSERT INTO awcms_booking_resources
                (tenant_id, code, name, kind, timezone, booking_mode)
              VALUES (${TENANT_A}, 'st1', 'x', 'villa', 'UTC', 'stay')`,
        /23514|check/i
      );
      await assertRejected(
        admin`INSERT INTO awcms_booking_resources
                (tenant_id, code, name, kind, timezone, capacity)
              VALUES (${TENANT_A}, 'st2', 'x', 'room', 'UTC', 501)`,
        /23514|check/i
      );
    });

    test("a stay offering carries no buffers and a time offering no nights", async () => {
      const admin = getAdminSql();
      await assertRejected(
        admin`INSERT INTO awcms_booking_service_offerings
                (tenant_id, code, name, granularity, duration_seconds, setup_seconds,
                 cleanup_seconds, slot_step_seconds, min_nights, max_nights)
              VALUES (${TENANT_A}, 'bad1', 'x', 'time', 3600, 0, 0, 900, 1, 2)`,
        /23514|check/i
      );
      await assertRejected(
        admin`INSERT INTO awcms_booking_service_offerings
                (tenant_id, code, name, granularity, setup_seconds, min_nights, max_nights)
              VALUES (${TENANT_A}, 'bad2', 'x', 'stay', 10, 1, 2)`,
        /23514|check/i
      );
    });

    test("resource codes are unique per tenant, case-insensitively", async () => {
      const admin = getAdminSql();
      await admin`INSERT INTO awcms_booking_resources (tenant_id, code, name, kind, timezone)
                  VALUES (${TENANT_A}, 'Room-1', 'x', 'room', 'UTC')`;
      await assertRejected(
        admin`INSERT INTO awcms_booking_resources (tenant_id, code, name, kind, timezone)
              VALUES (${TENANT_A}, 'ROOM-1', 'y', 'room', 'UTC')`,
        /23505|duplicate key/i
      );
      // The same code in another tenant is fine.
      await admin`INSERT INTO awcms_booking_resources (tenant_id, code, name, kind, timezone)
                  VALUES (${TENANT_B}, 'Room-1', 'x', 'room', 'UTC')`;
    });

    test("schedules and exceptions exist as shells with their shape checks", async () => {
      const admin = getAdminSql();
      const schedule = (await admin`
        INSERT INTO awcms_booking_schedules (tenant_id, timezone, effective_from)
        VALUES (${TENANT_A}, 'Asia/Pontianak', '2026-01-01') RETURNING id`) as {
        id: string;
      }[];
      await admin`
        INSERT INTO awcms_booking_schedule_exceptions
          (tenant_id, schedule_id, local_from, local_to, kind, reason_code)
        VALUES (${TENANT_A}, ${schedule[0]!.id}, '2026-12-24', '2026-12-26',
                'closed', 'holiday')`;
      // Exactly one owner.
      await assertRejected(
        admin`INSERT INTO awcms_booking_schedule_exceptions
                (tenant_id, local_from, local_to, kind)
              VALUES (${TENANT_A}, '2026-12-24', '2026-12-26', 'closed')`,
        /23514|check/i
      );
      // Free-text reason is refused.
      await assertRejected(
        admin`INSERT INTO awcms_booking_schedule_exceptions
                (tenant_id, schedule_id, local_from, local_to, kind, reason_code)
              VALUES (${TENANT_A}, ${schedule[0]!.id}, '2026-12-24', '2026-12-26',
                      'closed', 'Pak Budi is sick')`,
        /23514|check/i
      );
    });
  });

  describe("what the module refuses to store (booking.md section 10.2)", () => {
    test("no column names money, payment, product or a customer name", async () => {
      const rows = (await getAdminSql()`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name LIKE 'awcms_booking_%'
      `) as { table_name: string; column_name: string }[];
      expect(rows.length).toBeGreaterThan(100);
      const forbidden =
        /(^|_)(price|amount|total|deposit|balance|paid|payment|currency|fee|tax|discount|refund|invoice|product|sku|variant|customer_name|guest_name|first_name|last_name|full_name|email|phone)(_|$)/;
      const offenders = rows
        .filter((row) => forbidden.test(row.column_name))
        .map((row) => `${row.table_name}.${row.column_name}`);
      expect(offenders).toEqual([]);
    });

    test("the only customer-shaped columns are the opaque reference and the redacted note", async () => {
      const rows = (await getAdminSql()`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name LIKE 'awcms_booking_%'
          AND column_name LIKE '%customer%'
          -- a policy NUMBER on settings, not a customer attribute
          AND column_name <> 'max_active_holds_per_customer'
        ORDER BY column_name
      `) as { column_name: string }[];
      expect(rows.map((row) => row.column_name)).toEqual([
        "customer_note",
        "external_customer_ref"
      ]);
    });
  });

  describe("permission catalogue", () => {
    test("32 booking permissions are seeded and granted to no role", async () => {
      const rows = (await getAdminSql()`
        SELECT count(*)::int AS n FROM awcms_permissions WHERE module_key = 'booking'
      `) as { n: number }[];
      expect(rows[0]!.n).toBe(32);

      const granted = (await getAdminSql()`
        SELECT count(*)::int AS n
        FROM awcms_role_permissions rp
        JOIN awcms_permissions p ON p.id = rp.permission_id
        WHERE p.module_key = 'booking'
      `) as { n: number }[];
      expect(granted[0]!.n).toBe(0);
    });
  });
});
