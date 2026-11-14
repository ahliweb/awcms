/**
 * `BookingPort.confirm` / `.cancel` as the background-job role (Issue #1278,
 * ADR-0131; sql/387) against a real PostgreSQL -- WORLD-1 of the harness.
 *
 * The worker connection here is a REAL login as `awcms_worker` (not a `SET ROLE`
 * from a superuser): the function's whole point is what that role can and cannot
 * do, and a guard that reads `current_user` must be exercised by the role itself.
 *
 *   * confirm and cancel through the port, as the worker, do what the
 *     application path does: the reservation, the released allocations, ONE
 *     history row, ONE audit row, ONE domain event, a replay writes nothing;
 *   * PARITY: for every status, the worker path and the application path
 *     (`transitionReservation`, as `awcms_app`) leave the same rows and answer
 *     the same refusal, so the two implementations of the rule cannot drift;
 *   * abuse as the worker: another tenant's reservation, an illegal
 *     transition, a tenant argument that is not the session's, no tenant
 *     context, a verb the function does not offer, free text as a reason, an
 *     actor of another tenant, and a direct table write all fail.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  createRuntimePool,
  getAdminSql,
  getWorkerRoleSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
  workerRoleActivated
} from "./harness";
import { createBookingPort } from "../../src/modules/booking/application/booking-port-adapter";
import {
  createReservation,
  transitionReservation,
  type TransitionAction
} from "../../src/modules/booking/application/booking-reservation-service";
import type { PlaceHoldInput } from "../../src/modules/booking/domain/booking-allocation";
import { NO_OP_STAFF_AVAILABILITY } from "../../src/modules/booking/domain/booking-staff-availability";

const TENANT_A = "b1278000-0000-4000-8000-00000000000a";
const TENANT_B = "b1278000-0000-4000-8000-00000000000b";
const bookingPort = createBookingPort(async () => NO_OP_STAFF_AVAILABILITY);
const ACTORS = new Map<string, string>();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A whole hour three days from now: inside any sane lead time and horizon. */
const START = Math.ceil((Date.now() + 3 * DAY) / HOUR) * HOUR;

let pool: Bun.SQL;
let sequence = 0;
let slotOffset = 0;

function appTx<T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return pool.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
    return fn(tx);
  });
}

function workerTx<T>(
  tenantId: string | null,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return getWorkerRoleSql().begin(async (tx) => {
    if (tenantId !== null) {
      await tx.unsafe(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
    }

    return fn(tx);
  });
}

function ctxOf(tenantId: string) {
  return {
    tenantId,
    staff: NO_OP_STAFF_AVAILABILITY,
    actorTenantUserId: ACTORS.get(tenantId)!,
    correlationId: crypto.randomUUID()
  };
}

function targeted(tenantId: string, reservationId: string) {
  return {
    tenantId,
    reservationId,
    idempotencyKey: crypto.randomUUID(),
    correlationId: crypto.randomUUID(),
    actorTenantUserId: ACTORS.get(tenantId)!
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

type Fixture = { resourceId: string; offeringId: string };

/** A resource with `capacity` units, an all-day schedule and a hold-then-confirm offering. */
async function newFixture(
  tenantId: string,
  options: { capacity?: number; cutoffSeconds?: number | null } = {}
): Promise<Fixture> {
  const admin = getAdminSql();
  sequence += 1;
  const code = `w${sequence}`;
  const capacity = options.capacity ?? 1;
  const resource = (await admin`
    INSERT INTO awcms_booking_resources
      (tenant_id, code, name, kind, capacity, timezone, booking_mode)
    VALUES (${tenantId}, ${code}, ${`Room ${code}`}, 'room', ${capacity},
            'Asia/Pontianak', 'slot')
    RETURNING id
  `) as { id: string }[];

  for (let ordinal = 1; ordinal <= capacity; ordinal += 1) {
    await admin`
      INSERT INTO awcms_booking_resource_units (tenant_id, resource_id, ordinal)
      VALUES (${tenantId}, ${resource[0]!.id}, ${ordinal})
    `;
  }

  const day = [{ from: "00:00", to: "24:00" }];

  await admin`
    INSERT INTO awcms_booking_schedules
      (tenant_id, resource_id, timezone, effective_from, rules)
    VALUES (${tenantId}, ${resource[0]!.id}, 'Asia/Pontianak', '2020-01-01',
            ${{ weekly: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day } }}::jsonb)
  `;

  const offering = (await admin`
    INSERT INTO awcms_booking_service_offerings
      (tenant_id, code, name, granularity, duration_seconds, setup_seconds,
       cleanup_seconds, slot_step_seconds, max_party, confirmation_mode,
       cancellation_cutoff_seconds)
    VALUES (${tenantId}, ${`hour-${code}`}, 'Hour', 'time', 3600, 0, 0, 900,
            4, 'hold_then_confirm', ${options.cutoffSeconds ?? null})
    RETURNING id
  `) as { id: string }[];

  return { resourceId: resource[0]!.id, offeringId: offering[0]!.id };
}

/** A hold (always as the application role: creation is not what is under test). */
async function newHold(
  tenantId: string,
  fixture: Fixture,
  overrides: Partial<PlaceHoldInput> = {}
): Promise<string> {
  slotOffset += 1;

  const outcome = await appTx(tenantId, (tx) =>
    createReservation(
      tx,
      ctxOf(tenantId),
      {
        claim: {
          offeringId: fixture.offeringId,
          resourceId: fixture.resourceId,
          startsAtMs: START + slotOffset * 2 * HOUR,
          partySize: 1,
          quantity: 1,
          ...overrides
        },
        overridePolicy: false
      },
      false
    )
  );

  if (outcome.outcome !== "ok") {
    throw new Error(`expected a hold, got ${JSON.stringify(outcome)}`);
  }

  return outcome.reservation.id;
}

/** Test-only: put a reservation in `status` with the update guard off (the guard is not under test here). */
async function forceStatus(
  reservationId: string,
  status: string,
  holdExpires: string | null
): Promise<void> {
  await getAdminSql().begin(async (tx) => {
    await tx.unsafe(
      "ALTER TABLE awcms_booking_reservations DISABLE TRIGGER awcms_booking_reservations_update_guard"
    );
    await tx.unsafe(
      `UPDATE awcms_booking_reservations
       SET status = '${status}',
           hold_expires_at = ${holdExpires === null ? "NULL" : holdExpires}
       WHERE id = '${reservationId}'`
    );
    await tx.unsafe(
      "ALTER TABLE awcms_booking_reservations ENABLE TRIGGER awcms_booking_reservations_update_guard"
    );
  });
}

const backdate = (id: string) =>
  forceStatus(id, "held", "clock_timestamp() - interval '2 seconds'");

async function statusOf(reservationId: string): Promise<string> {
  const rows = (await getAdminSql()`
    SELECT status FROM awcms_booking_reservations WHERE id = ${reservationId}
  `) as { status: string }[];

  return rows[0]!.status;
}

/** What a transition left behind, with every per-reservation id and instant stripped so two reservations compare. */
async function footprint(reservationId: string) {
  const admin = getAdminSql();
  const [reservation] = (await admin`
    SELECT status, hold_expires_at IS NULL AS hold_cleared, late_cancellation,
           cancel_reason_code, status_changed_by IS NOT NULL AS has_actor
    FROM awcms_booking_reservations WHERE id = ${reservationId}
  `) as Record<string, unknown>[];
  const allocations = (await admin`
    SELECT a.released_reason, a.released_at IS NOT NULL AS released
    FROM awcms_booking_resource_allocations a
    JOIN awcms_booking_reservation_items i ON i.id = a.item_id
    WHERE i.reservation_id = ${reservationId}
    ORDER BY a.released_reason NULLS FIRST
  `) as Record<string, unknown>[];
  const history = (await admin`
    SELECT seq, kind, from_status, to_status, actor_user_id IS NOT NULL AS has_actor,
           correlation_id IS NOT NULL AS has_correlation, reason_code, detail
    FROM awcms_booking_reservation_events
    WHERE reservation_id = ${reservationId} ORDER BY seq
  `) as Record<string, unknown>[];
  const audit = (await admin`
    SELECT action, severity, attributes,
           regexp_replace(message, 'Reservation [A-Z0-9-]+', 'Reservation N') AS message,
           actor_tenant_user_id IS NOT NULL AS has_actor,
           correlation_id IS NOT NULL AS has_correlation
    FROM awcms_audit_events
    WHERE module_key = 'booking' AND resource_id = ${reservationId}
    ORDER BY created_at, id
  `) as Record<string, unknown>[];
  const events = (await admin`
    SELECT event_type,
           (payload - 'reservationId' - 'reservationNo' - 'lineageId'
                    - 'startsAt' - 'endsAt' - 'resourceIds' - 'occurredAt'
                    - 'correlationId') AS payload,
           payload ? 'correlationId' AS has_correlation,
           actor_tenant_user_id IS NOT NULL AS has_actor
    FROM awcms_domain_events
    WHERE aggregate_type = 'reservation' AND aggregate_id = ${reservationId}
    ORDER BY event_sequence
  `) as Record<string, unknown>[];

  // The hold's expiry is an instant of the call, not a fact of the transition.
  const withoutInstants = (rows: Record<string, unknown>[], key: string) =>
    rows.map((row) => {
      const copy = { ...(row[key] as Record<string, unknown>) };

      delete copy.holdExpiredAt;
      delete copy.holdExpiresAt;

      return { ...row, [key]: copy };
    });

  return {
    reservation,
    allocations,
    history: withoutInstants(history, "detail"),
    audit: withoutInstants(audit, "attributes"),
    events
  };
}

/** Everything a call may write, counted: a refused or replayed call must leave all of them where they were. */
async function writeCounts(tenantId: string) {
  const rows = (await getAdminSql()`
    SELECT
      (SELECT count(*) FROM awcms_booking_reservation_events WHERE tenant_id = ${tenantId})::int AS history,
      (SELECT count(*) FROM awcms_domain_events WHERE tenant_id = ${tenantId} AND event_type LIKE 'awcms.booking.%')::int AS events,
      (SELECT count(*) FROM awcms_audit_events WHERE tenant_id = ${tenantId} AND module_key = 'booking')::int AS audit
  `) as Record<string, number>[];

  return { ...rows[0]! };
}

function viaPort(
  tenantId: string,
  verb: "confirm" | "cancel",
  reservationId: string,
  reasonCode?: string
) {
  return workerTx(tenantId, (tx) =>
    verb === "confirm"
      ? bookingPort.confirm(tx, targeted(tenantId, reservationId))
      : bookingPort.cancel(tx, {
          ...targeted(tenantId, reservationId),
          reasonCode: reasonCode ?? "customer_request"
        })
  );
}

const suite = integrationEnabled ? describe : describe.skip;

suite("booking worker confirm and cancel (Issue #1278, sql/387)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
    await resetDatabase();
    pool = createRuntimePool(8);
    await seedTenant(TENANT_A, "wt-a");
    await seedTenant(TENANT_B, "wt-b");
  });

  afterAll(async () => {
    await pool?.close({ timeout: 1 });
    await teardownIntegrationDatabase();
  });

  test("the worker role is a real login for this suite", () => {
    expect(workerRoleActivated).toBe(true);
  });

  describe("through the port, as awcms_worker", () => {
    test("confirm moves a hold to confirmed and writes the history, audit and event rows of the application path", async () => {
      const fixture = await newFixture(TENANT_A);
      const id = await newHold(TENANT_A, fixture);
      const outcome = await viaPort(TENANT_A, "confirm", id);

      expect(outcome).toMatchObject({
        ok: true,
        reservationId: id,
        status: "confirmed",
        holdExpiresAt: null,
        replayed: false
      });

      const trace = await footprint(id);

      expect(trace.reservation).toMatchObject({
        status: "confirmed",
        hold_cleared: true,
        has_actor: true
      });
      expect(trace.history.map((row) => row.kind)).toEqual([
        "created",
        "held",
        "confirmed"
      ]);
      expect(trace.audit.map((row) => row.action)).toContain(
        "booking.reservation.confirmed"
      );
      expect(trace.events.map((row) => row.event_type)).toContain(
        "awcms.booking.reservation.confirmed"
      );
    });

    test("cancel releases the allocations, records the reason code and the late flag", async () => {
      // A cutoff far longer than the 3 days ahead: every cancellation is late.
      const fixture = await newFixture(TENANT_A, {
        cutoffSeconds: 30 * 24 * 3600
      });
      const id = await newHold(TENANT_A, fixture);

      expect(await viaPort(TENANT_A, "confirm", id)).toMatchObject({
        ok: true
      });

      const outcome = await viaPort(TENANT_A, "cancel", id, "no_longer_needed");

      expect(outcome).toMatchObject({
        ok: true,
        status: "cancelled",
        replayed: false
      });

      const trace = await footprint(id);

      expect(trace.reservation).toMatchObject({
        status: "cancelled",
        late_cancellation: true,
        cancel_reason_code: "no_longer_needed"
      });
      expect(trace.allocations).toEqual([
        { released_reason: "cancelled", released: true }
      ]);
      expect(trace.history.at(-1)).toMatchObject({
        kind: "cancelled",
        from_status: "confirmed",
        reason_code: "no_longer_needed",
        detail: { lateCancellation: true, releasedAllocations: 1 }
      });
    });

    test("a repeat, under any key, answers replayed and writes nothing", async () => {
      const fixture = await newFixture(TENANT_A);
      const id = await newHold(TENANT_A, fixture);

      await viaPort(TENANT_A, "confirm", id);

      const before = await writeCounts(TENANT_A);
      const again = await viaPort(TENANT_A, "confirm", id);

      expect(again).toMatchObject({
        ok: true,
        status: "confirmed",
        replayed: true
      });
      expect(await writeCounts(TENANT_A)).toEqual(before);
    });

    test("the port refuses a free-text reason without reaching the database", async () => {
      const fixture = await newFixture(TENANT_A);
      const id = await newHold(TENANT_A, fixture);
      const outcome = await viaPort(
        TENANT_A,
        "cancel",
        id,
        "Customer said: call me at 0812"
      );

      expect(outcome).toEqual({ ok: false, reason: "VALIDATION_ERROR" });
      expect(await statusOf(id)).toBe("held");
    });

    test("an elapsed hold is HOLD_EXPIRED and is left untouched", async () => {
      const fixture = await newFixture(TENANT_A);
      const id = await newHold(TENANT_A, fixture);

      await backdate(id);

      const before = await writeCounts(TENANT_A);

      expect(await viaPort(TENANT_A, "confirm", id)).toEqual({
        ok: false,
        reason: "HOLD_EXPIRED"
      });
      expect(await statusOf(id)).toBe("held");
      expect(await writeCounts(TENANT_A)).toEqual(before);
    });

    test("an illegal transition is INVALID_STATE and writes nothing", async () => {
      const fixture = await newFixture(TENANT_A);
      const id = await newHold(TENANT_A, fixture);

      await viaPort(TENANT_A, "cancel", id);

      const before = await writeCounts(TENANT_A);

      expect(await viaPort(TENANT_A, "confirm", id)).toEqual({
        ok: false,
        reason: "INVALID_STATE"
      });
      expect(await writeCounts(TENANT_A)).toEqual(before);
    });

    test("a verb the function does not offer still needs table privileges the worker lacks", async () => {
      const fixture = await newFixture(TENANT_A);
      const id = await newHold(TENANT_A, fixture);

      await viaPort(TENANT_A, "confirm", id);
      await expect(
        workerTx(TENANT_A, (tx) =>
          bookingPort.checkIn(tx, targeted(TENANT_A, id))
        )
      ).rejects.toThrow(/permission denied/i);
      expect(await statusOf(id)).toBe("confirmed");
    });
  });

  describe("parity with the application path (transitionReservation as awcms_app)", () => {
    type Setup = {
      name: string;
      prepare: (id: string) => Promise<void>;
    };
    const setups: Setup[] = [
      { name: "held", prepare: async () => {} },
      { name: "held, elapsed", prepare: backdate },
      {
        name: "confirmed",
        prepare: async (id) => {
          await appTx(TENANT_A, (tx) =>
            transitionReservation(tx, ctxOf(TENANT_A), id, "confirm")
          );
        }
      },
      {
        name: "checked_in",
        prepare: (id) => forceStatus(id, "checked_in", null)
      },
      {
        name: "completed",
        prepare: (id) => forceStatus(id, "completed", null)
      },
      { name: "no_show", prepare: (id) => forceStatus(id, "no_show", null) },
      {
        name: "cancelled",
        prepare: async (id) => {
          await appTx(TENANT_A, (tx) =>
            transitionReservation(tx, ctxOf(TENANT_A), id, "cancel", {
              reasonCode: "earlier"
            })
          );
        }
      },
      {
        name: "expired",
        prepare: async (id) => {
          await backdate(id);
          await forceStatus(
            id,
            "expired",
            "clock_timestamp() - interval '2 seconds'"
          );
        }
      }
    ];

    // The cancellation cutoff, as seconds before the start: a confirm has none;
    // a cancel runs against a cutoff far past (always late), one not yet reached
    // (never late) and one a couple of minutes either side of the boundary, so
    // BOTH values of `late_cancellation` are compared, not only the late one.
    type CutoffCase = {
      name: string;
      seconds: (startsAtMs: number) => number | null;
      late: boolean | null;
    };
    const untilStart = (startsAtMs: number) =>
      Math.round((startsAtMs - Date.now()) / 1000);
    const cutoffCases: Record<"confirm" | "cancel", CutoffCase[]> = {
      confirm: [{ name: "no cutoff", seconds: () => null, late: null }],
      cancel: [
        {
          name: "a cutoff long past",
          seconds: () => 30 * 24 * 3600,
          late: true
        },
        { name: "a cutoff not reached", seconds: () => 3600, late: false },
        {
          name: "a cutoff 2 minutes short of the boundary",
          seconds: (startsAtMs) => untilStart(startsAtMs) - 120,
          late: false
        },
        {
          name: "a cutoff 2 minutes past the boundary",
          seconds: (startsAtMs) => untilStart(startsAtMs) + 120,
          late: true
        }
      ]
    };

    for (const verb of ["confirm", "cancel"] as const) {
      for (const cutoff of cutoffCases[verb]) {
        for (const setup of setups) {
          test(`${verb} (${cutoff.name}) on a ${setup.name} reservation leaves the same rows either way`, async () => {
            // Two units, one slot: the same claim twice, to compare like with like.
            slotOffset += 1;
            const startsAtMs = START + slotOffset * 2 * HOUR;
            const fixture = await newFixture(TENANT_A, {
              capacity: 2,
              cutoffSeconds: cutoff.seconds(startsAtMs)
            });
            const viaApp = await newHold(TENANT_A, fixture, { startsAtMs });
            const viaWorker = await newHold(TENANT_A, fixture, { startsAtMs });

            await setup.prepare(viaApp);
            await setup.prepare(viaWorker);

            const action: TransitionAction = verb;
            const app = await appTx(TENANT_A, (tx) =>
              transitionReservation(tx, ctxOf(TENANT_A), viaApp, action, {
                reasonCode: verb === "cancel" ? "same_reason" : null
              })
            );
            const worker = await viaPort(
              TENANT_A,
              verb,
              viaWorker,
              "same_reason"
            );

            // Same answer: success (and replay or not), or the same refusal.
            if (app.outcome === "ok") {
              expect(worker).toMatchObject({
                ok: true,
                status: app.reservation.status,
                replayed: app.replayed,
                holdExpiresAt:
                  app.reservation.holdExpiresAt === null
                    ? null
                    : expect.any(String)
              });
            } else {
              expect(app.outcome).toBe("refused");
              expect(worker).toEqual({
                ok: false,
                reason: (app as { code: string }).code as never
              });
            }

            const workerFootprint = await footprint(viaWorker);

            expect(workerFootprint).toEqual(await footprint(viaApp));

            // The flag itself, not only its agreement: a cancel that actually
            // happened carries the value the cutoff dictates.
            if (verb === "cancel" && cutoff.late !== null && worker.ok) {
              if (!worker.replayed) {
                expect(workerFootprint.reservation!.late_cancellation).toBe(
                  cutoff.late
                );
              }
            }
          });
        }
      }
    }
  });

  describe("serialisation on the reservation row", () => {
    // Without `FOR UPDATE` the loser of a race read a stale status and met the
    // "changed under its own lock" guard (55000): a failed job instead of the
    // clean answer. These runs fire the contenders at once.
    test("ten worker cancels of one reservation: one effect, nine replays, no error", async () => {
      const fixture = await newFixture(TENANT_A);
      const id = await newHold(TENANT_A, fixture);
      const before = await footprint(id);
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () => viaPort(TENANT_A, "cancel", id))
      );

      expect(results.filter((result) => result.status === "rejected")).toEqual(
        []
      );

      const answers = results.map(
        (result) =>
          (
            result as PromiseFulfilledResult<{
              ok: boolean;
              replayed?: boolean;
            }>
          ).value
      );

      expect(answers.every((answer) => answer.ok)).toBe(true);
      expect(
        answers.filter((answer) => answer.replayed === false)
      ).toHaveLength(1);
      expect(answers.filter((answer) => answer.replayed === true)).toHaveLength(
        9
      );

      const trace = await footprint(id);

      expect(
        trace.history.filter((row) => row.kind === "cancelled")
      ).toHaveLength(1);
      expect(trace.audit).toHaveLength(before.audit.length + 1);
      expect(trace.events).toHaveLength(before.events.length + 1);
    });

    test("a worker confirm racing an application cancel: each gets a clean answer", async () => {
      const fixture = await newFixture(TENANT_A);

      for (let round = 0; round < 6; round += 1) {
        const id = await newHold(TENANT_A, fixture);
        const [worker, app] = await Promise.allSettled([
          viaPort(TENANT_A, "confirm", id),
          appTx(TENANT_A, (tx) =>
            transitionReservation(tx, ctxOf(TENANT_A), id, "cancel")
          )
        ]);

        // Never an exception, whichever won.
        expect(worker.status).toBe("fulfilled");
        expect(app.status).toBe("fulfilled");

        const status = await statusOf(id);

        expect(["confirmed", "cancelled"]).toContain(status);

        const trace = await footprint(id);

        // Exactly one terminal transition beyond the hold, never both.
        expect(
          trace.history.filter((row) =>
            ["confirmed", "cancelled"].includes(row.kind as string)
          ).length
        ).toBeGreaterThanOrEqual(1);
        expect(trace.history.map((row) => row.seq)).toEqual(
          trace.history.map((_, index) => index + 1)
        );
      }
    });
  });

  describe("abuse as awcms_worker", () => {
    test("another tenant's reservation is not found, and is not touched", async () => {
      const fixture = await newFixture(TENANT_B);
      const id = await newHold(TENANT_B, fixture);
      const before = await writeCounts(TENANT_B);

      // The worker's session is scoped to tenant A and asks about B's id.
      expect(await viaPort(TENANT_A, "confirm", id)).toEqual({
        ok: false,
        reason: "RESERVATION_NOT_FOUND"
      });
      expect(await viaPort(TENANT_A, "cancel", id)).toEqual({
        ok: false,
        reason: "RESERVATION_NOT_FOUND"
      });
      expect(await statusOf(id)).toBe("held");
      expect(await writeCounts(TENANT_B)).toEqual(before);
    });

    test("an unknown id, another tenant's id and a malformed id are one answer", async () => {
      const fixture = await newFixture(TENANT_B);
      const foreign = await newHold(TENANT_B, fixture);
      const answers = await Promise.all(
        [crypto.randomUUID(), foreign, "not-a-uuid"].map((id) =>
          viaPort(TENANT_A, "confirm", id)
        )
      );

      expect(
        new Set(answers.map((answer) => JSON.stringify(answer))).size
      ).toBe(1);
    });

    test("calling the function with a tenant that is not the session's is refused", async () => {
      const fixture = await newFixture(TENANT_B);
      const id = await newHold(TENANT_B, fixture);

      await expect(
        workerTx(
          TENANT_A,
          (tx) => tx`
            SELECT * FROM awcms_booking_worker_transition(
              ${TENANT_B}::uuid, ${id}::uuid, 'cancel', ${ACTORS.get(TENANT_B)!}::uuid,
              NULL::uuid, NULL::text)`
        )
      ).rejects.toThrow(/tenant argument must match/);
      expect(await statusOf(id)).toBe("held");
    });

    test("with no tenant context at all the function refuses", async () => {
      const fixture = await newFixture(TENANT_A);
      const id = await newHold(TENANT_A, fixture);

      await expect(
        workerTx(
          null,
          (tx) => tx`
            SELECT * FROM awcms_booking_worker_transition(
              ${TENANT_A}::uuid, ${id}::uuid, 'cancel', ${ACTORS.get(TENANT_A)!}::uuid,
              NULL::uuid, NULL::text)`
        )
      ).rejects.toThrow(/tenant argument must match/);
      expect(await statusOf(id)).toBe("held");
    });

    test("the function offers only confirm and cancel", async () => {
      const fixture = await newFixture(TENANT_A);
      const id = await newHold(TENANT_A, fixture);

      for (const verb of [
        "check_in",
        "complete",
        "no_show",
        "expire",
        "extend",
        ""
      ]) {
        await expect(
          workerTx(
            TENANT_A,
            (tx) => tx`
              SELECT * FROM awcms_booking_worker_transition(
                ${TENANT_A}::uuid, ${id}::uuid, ${verb}::text,
                ${ACTORS.get(TENANT_A)!}::uuid, NULL::uuid, NULL::text)`
          )
        ).rejects.toThrow(/only confirm and cancel/);
      }

      expect(await statusOf(id)).toBe("held");
    });

    test("a free-text reason is refused by the function itself", async () => {
      const fixture = await newFixture(TENANT_A);
      const id = await newHold(TENANT_A, fixture);

      await expect(
        workerTx(
          TENANT_A,
          (tx) => tx`
            SELECT * FROM awcms_booking_worker_transition(
              ${TENANT_A}::uuid, ${id}::uuid, 'cancel',
              ${ACTORS.get(TENANT_A)!}::uuid, NULL::uuid,
              'a free text reason with spaces'::text)`
        )
      ).rejects.toThrow(/short code/);
      expect(await statusOf(id)).toBe("held");
    });

    test("an actor of another tenant is refused by the foreign key, and nothing commits", async () => {
      const fixture = await newFixture(TENANT_A);
      const id = await newHold(TENANT_A, fixture);

      await expect(
        workerTx(
          TENANT_A,
          (tx) => tx`
            SELECT * FROM awcms_booking_worker_transition(
              ${TENANT_A}::uuid, ${id}::uuid, 'confirm',
              ${ACTORS.get(TENANT_B)!}::uuid, NULL::uuid, NULL::text)`
        )
      ).rejects.toThrow();
      expect(await statusOf(id)).toBe("held");
    });

    test("the worker still has no privilege on the tables themselves", async () => {
      const fixture = await newFixture(TENANT_A);
      const id = await newHold(TENANT_A, fixture);

      await expect(
        workerTx(
          TENANT_A,
          (tx) =>
            tx`UPDATE awcms_booking_reservations SET status = 'confirmed' WHERE id = ${id}`
        )
      ).rejects.toThrow(/permission denied/i);
      await expect(
        workerTx(
          TENANT_A,
          (tx) => tx`SELECT id FROM awcms_booking_reservations LIMIT 1`
        )
      ).rejects.toThrow(/permission denied/i);
      expect(await statusOf(id)).toBe("held");
    });

    test("the runtime role cannot call the function", async () => {
      const fixture = await newFixture(TENANT_A);
      const id = await newHold(TENANT_A, fixture);

      await expect(
        appTx(
          TENANT_A,
          (tx) => tx`
            SELECT * FROM awcms_booking_worker_transition(
              ${TENANT_A}::uuid, ${id}::uuid, 'cancel',
              ${ACTORS.get(TENANT_A)!}::uuid, NULL::uuid, NULL::text)`
        )
      ).rejects.toThrow(/permission denied/i);
    });

    test("the owner role is NOLOGIN, memberless, and holds no privilege beyond the statements", async () => {
      const admin = getAdminSql();
      const role = (await admin`
        SELECT rolcanlogin, rolsuper, rolbypassrls,
               (SELECT count(*) FROM pg_auth_members m WHERE m.roleid = r.oid)::int AS members
        FROM pg_roles r WHERE rolname = 'awcms_booking_transition'
      `) as Record<string, unknown>[];

      expect(role[0]).toEqual({
        rolcanlogin: false,
        rolsuper: false,
        rolbypassrls: false,
        members: 0
      });

      // The COMPLETE privilege set of the owner, table-wide and per column, in
      // every schema: a later migration that widens a grant (UPDATE of the whole
      // table, SELECT of a credential table) must change this pin on purpose.
      const tableWide = (await admin`
        SELECT n.nspname || '.' || c.relname || ' ' || x.privilege_type AS grant
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL aclexplode(c.relacl) x
        WHERE x.grantee = 'awcms_booking_transition'::regrole
        ORDER BY 1
      `) as { grant: string }[];

      expect(tableWide.map((row) => row.grant)).toEqual([
        "public.awcms_booking_reservation_events INSERT",
        "public.awcms_booking_reservation_events SELECT",
        "public.awcms_booking_reservation_items SELECT",
        "public.awcms_booking_reservations SELECT",
        "public.awcms_booking_resource_allocations SELECT",
        "public.awcms_booking_staff_assignments SELECT"
      ]);

      const perColumn = (await admin`
        SELECT c.relname || '.' || a.attname || ' ' || x.privilege_type AS grant
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        CROSS JOIN LATERAL aclexplode(a.attacl) x
        WHERE a.attacl IS NOT NULL
          AND x.grantee = 'awcms_booking_transition'::regrole
        ORDER BY 1
      `) as { grant: string }[];

      expect(perColumn.map((row) => row.grant)).toEqual([
        "awcms_booking_reservations.cancel_reason_code UPDATE",
        "awcms_booking_reservations.hold_expires_at UPDATE",
        "awcms_booking_reservations.late_cancellation UPDATE",
        "awcms_booking_reservations.status UPDATE",
        "awcms_booking_reservations.status_changed_at UPDATE",
        "awcms_booking_reservations.status_changed_by UPDATE",
        "awcms_booking_reservations.updated_at UPDATE",
        "awcms_booking_resource_allocations.released_at UPDATE",
        "awcms_booking_resource_allocations.released_reason UPDATE",
        "awcms_booking_service_offerings.cancellation_cutoff_seconds SELECT",
        "awcms_booking_service_offerings.id SELECT",
        "awcms_booking_service_offerings.tenant_id SELECT",
        "awcms_booking_staff_assignments.released_at UPDATE",
        "awcms_booking_staff_assignments.released_reason UPDATE"
      ]);

      const execute = (await admin`
        SELECT grantee::regrole::text AS grantee
        FROM aclexplode((SELECT proacl FROM pg_proc
                         WHERE proname = 'awcms_booking_worker_transition'))
        WHERE privilege_type = 'EXECUTE'
        ORDER BY 1
      `) as { grantee: string }[];

      expect(execute.map((row) => row.grantee)).toEqual([
        "awcms_booking_transition",
        "awcms_worker"
      ]);
    });
  });
});
