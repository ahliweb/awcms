/**
 * The `booking` reservation transitions against a real PostgreSQL (Issue #941,
 * ADR-0131; docs/awcms/booking.md sections 3, 5, 7.4, 8.3 and 13) -- WORLD-1 of
 * the harness: the application layer driven directly, as the runtime role
 * `awcms_app` (FORCE RLS in effect), on separate connections.
 *
 * What this proves that the unit tests cannot:
 *
 *   * every transition writes ONE history row, ONE audit row and ONE domain
 *     event in the same transaction, and a refused or replayed call writes none;
 *   * the three idempotency layers' second one: asking for the state a
 *     reservation is already in returns it `replayed` and writes nothing;
 *   * reschedule (T5): release-then-insert so a move over one's own slot does not
 *     conflict with itself; the lineage; the external reference moving; a refusal
 *     leaving the original untouched; two reservations moving into each other's
 *     slots at once never hang and never double-book;
 *   * a confirm racing the hold expiry (T6 b): exactly one outcome, never a
 *     `confirmed` reservation without live allocations;
 *   * `expired` is published by BOTH ways a hold expires (lazy reclaim and the
 *     worker's sweep) with the same payload shape;
 *   * policy: hours, lead time and horizon are refused, lifted only on request,
 *     and the lift is audited `critical`; a conflict is never lifted;
 *   * the default hold caps (booking.md section 13, left open by Issue #939);
 *   * no event and no audit row carries a customer reference, a note or a reason;
 *   * tenant isolation: another tenant's reservation is simply not found.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
 */
import { NO_OP_STAFF_AVAILABILITY } from "../../src/modules/booking/domain/booking-staff-availability";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  createRuntimePool,
  getAdminSql,
  getWorkerRoleSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import {
  emitReaperExpiredEvents,
  expireDueHolds
} from "../../src/modules/booking/application/booking-hold-expiry";
import { runReconciliation } from "../../src/modules/booking/application/booking-reconciliation";
import { getReservation } from "../../src/modules/booking/application/booking-reservation-directory";
import {
  createReservation,
  rescheduleReservation,
  transitionReservation,
  type CreateReservationOutcome,
  type RescheduleOutcome,
  type TransitionAction,
  type TransitionOutcome
} from "../../src/modules/booking/application/booking-reservation-service";
import { createBookingPort } from "../../src/modules/booking/application/booking-port-adapter";
import type { PlaceHoldInput } from "../../src/modules/booking/domain/booking-allocation";

const TENANT_A = "b9410000-0000-4000-8000-00000000000a";
const TENANT_B = "b9410000-0000-4000-8000-00000000000b";
const bookingPort = createBookingPort(async () => NO_OP_STAFF_AVAILABILITY);
const ACTORS = new Map<string, string>();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A whole hour three days from now: inside any sane lead time and horizon, on every step grid. */
const START = Math.ceil((Date.now() + 3 * DAY) / HOUR) * HOUR;

function dateAfter(days: number): string {
  return new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
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
    actorTenantUserId: ACTORS.get(tenantId)!,
    correlationId: crypto.randomUUID()
  };
}

function create(
  tenantId: string,
  claim: PlaceHoldInput,
  lift = false
): Promise<CreateReservationOutcome> {
  return tenantTx(tenantId, (tx) =>
    createReservation(
      tx,
      ctxOf(tenantId),
      { claim, overridePolicy: lift },
      lift
    )
  );
}

function transition(
  tenantId: string,
  reservationId: string,
  action: TransitionAction,
  input: { reasonCode?: string | null } = {}
): Promise<TransitionOutcome> {
  return tenantTx(tenantId, (tx) =>
    transitionReservation(tx, ctxOf(tenantId), reservationId, action, input)
  );
}

function reschedule(
  tenantId: string,
  reservationId: string,
  request: Parameters<typeof rescheduleReservation>[3],
  lift = false
): Promise<RescheduleOutcome> {
  return tenantTx(tenantId, (tx) =>
    rescheduleReservation(tx, ctxOf(tenantId), reservationId, request, lift)
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

type Fixture = { resourceId: string; unitIds: string[]; offeringId: string };

type FixtureOptions = {
  capacity?: number;
  mode?: "slot" | "stay";
  confirmation?: "immediate" | "hold_then_confirm";
  cutoffSeconds?: number | null;
  /** `false` leaves the resource with NO schedule (closed everywhere). */
  schedule?: boolean;
};

/** A resource, its units, an offering and (for a slot resource) a schedule that is open all day, every day. Fresh codes. */
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
    VALUES (${tenantId}, ${code}, ${`Room ${code}`}, 'room', ${capacity},
            'Asia/Pontianak', ${mode},
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

  if (mode === "slot" && options.schedule !== false) {
    const day = [{ from: "00:00", to: "24:00" }];

    await admin`
      INSERT INTO awcms_booking_schedules
        (tenant_id, resource_id, timezone, effective_from, rules)
      VALUES (${tenantId}, ${resource[0]!.id}, 'Asia/Pontianak', '2020-01-01',
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
          VALUES (${tenantId}, ${`night-${code}`}, 'Night', 'stay', 1, 30, 4,
                  ${confirmation}, ${options.cutoffSeconds ?? null})
          RETURNING id
        `) as { id: string }[])
      : ((await admin`
          INSERT INTO awcms_booking_service_offerings
            (tenant_id, code, name, granularity, duration_seconds, setup_seconds,
             cleanup_seconds, slot_step_seconds, max_party, confirmation_mode,
             cancellation_cutoff_seconds)
          VALUES (${tenantId}, ${`hour-${code}`}, 'Hour', 'time', 3600, 0, 0, 900,
                  4, ${confirmation}, ${options.cutoffSeconds ?? null})
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
  overrides: Partial<PlaceHoldInput> = {}
): PlaceHoldInput {
  return {
    offeringId: fixture.offeringId,
    resourceId: fixture.resourceId,
    startsAtMs: START,
    partySize: 1,
    quantity: 1,
    ...overrides
  };
}

async function created(
  tenantId: string,
  fixture: Fixture,
  overrides: Partial<PlaceHoldInput> = {},
  lift = false
) {
  const outcome = await create(tenantId, claim(fixture, overrides), lift);

  if (outcome.outcome !== "ok") {
    throw new Error(`expected a reservation, got ${JSON.stringify(outcome)}`);
  }

  return outcome.reservation;
}

/** A confirmed reservation: a hold, confirmed. */
async function confirmed(
  tenantId: string,
  fixture: Fixture,
  overrides: Partial<PlaceHoldInput> = {}
) {
  const hold = await created(tenantId, fixture, overrides);
  const outcome = await transition(tenantId, hold.id, "confirm");

  if (outcome.outcome !== "ok") {
    throw new Error(`expected a confirm, got ${JSON.stringify(outcome)}`);
  }

  return outcome.reservation;
}

/** Test-only: move a hold's expiry (the update guard forbids shortening; the database clock is the only clock). */
async function setHoldExpiry(
  reservationId: string,
  sql: string
): Promise<void> {
  const admin = getAdminSql();

  await admin.begin(async (tx) => {
    await tx.unsafe(
      "ALTER TABLE awcms_booking_reservations DISABLE TRIGGER awcms_booking_reservations_update_guard"
    );
    await tx.unsafe(
      `UPDATE awcms_booking_reservations SET hold_expires_at = ${sql} WHERE id = '${reservationId}'`
    );
    await tx.unsafe(
      "ALTER TABLE awcms_booking_reservations ENABLE TRIGGER awcms_booking_reservations_update_guard"
    );
  });
}

const backdate = (id: string) =>
  setHoldExpiry(id, "clock_timestamp() - interval '2 seconds'");

async function historyKinds(reservationId: string): Promise<string[]> {
  const rows = (await getAdminSql()`
    SELECT kind FROM awcms_booking_reservation_events
    WHERE reservation_id = ${reservationId} ORDER BY seq
  `) as { kind: string }[];

  return rows.map((row) => row.kind);
}

type DomainEventRow = {
  event_type: string;
  payload: Record<string, unknown>;
  correlation_id: string | null;
};

async function domainEvents(reservationId: string): Promise<DomainEventRow[]> {
  return (await getAdminSql()`
    SELECT event_type, payload, correlation_id
    FROM awcms_domain_events
    WHERE aggregate_type = 'reservation' AND aggregate_id = ${reservationId}
    ORDER BY event_sequence
  `) as DomainEventRow[];
}

async function auditActions(reservationId: string): Promise<string[]> {
  const rows = (await getAdminSql()`
    SELECT action FROM awcms_audit_events
    WHERE module_key = 'booking' AND resource_id = ${reservationId}
    ORDER BY created_at, id
  `) as { action: string }[];

  return rows.map((row) => row.action);
}

async function liveAllocations(reservationId: string): Promise<number> {
  const rows = (await getAdminSql()`
    SELECT count(*)::int AS n
    FROM awcms_booking_resource_allocations a
    JOIN awcms_booking_reservation_items i ON i.id = a.item_id
    WHERE i.reservation_id = ${reservationId} AND a.released_at IS NULL
  `) as { n: number }[];

  return rows[0]!.n;
}

/** Everything a call may write, counted: a refused or replayed call must leave all of them where they were. */
async function writeCounts(tenantId: string) {
  const rows = (await getAdminSql()`
    SELECT
      (SELECT count(*) FROM awcms_booking_reservations WHERE tenant_id = ${tenantId})::int AS reservations,
      (SELECT count(*) FROM awcms_booking_reservation_events WHERE tenant_id = ${tenantId})::int AS history,
      (SELECT count(*) FROM awcms_domain_events WHERE tenant_id = ${tenantId} AND event_type LIKE 'awcms.booking.%')::int AS events,
      (SELECT count(*) FROM awcms_audit_events WHERE tenant_id = ${tenantId} AND module_key = 'booking')::int AS audit
  `) as Record<string, number>[];

  return { ...rows[0]! };
}

async function race<T>(contenders: ReadonlyArray<() => Promise<T>>) {
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

const suite = integrationEnabled ? describe : describe.skip;

suite("booking reservation transitions (Issue #941, ADR-0131)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
    await resetDatabase();
    pool = createRuntimePool(24);
    await seedTenant(TENANT_A, "resv-a");
    await seedTenant(TENANT_B, "resv-b");
  });

  afterAll(async () => {
    await pool?.close({ timeout: 1 });
    await teardownIntegrationDatabase();
  });

  describe("create", () => {
    test("a hold is held, expires on the database clock, and is announced as created then held", async () => {
      const fixture = await newFixture(TENANT_A);
      const hold = await created(TENANT_A, fixture, {
        externalCustomerRef: "cus-private-1",
        customerNote: "allergic to nuts",
        externalRef: { type: "order", id: "ORD-1" }
      });

      expect(hold.status).toBe("held");
      expect(hold.holdExpiresAt).not.toBeNull();
      expect(hold.lineageId).toBe(hold.id);
      expect(hold.rescheduledFromId).toBeNull();
      expect(await historyKinds(hold.id)).toEqual(["created", "held"]);
      expect((await domainEvents(hold.id)).map((e) => e.event_type)).toEqual([
        "awcms.booking.reservation.created",
        "awcms.booking.reservation.held"
      ]);
      expect(await auditActions(hold.id)).toEqual([
        "booking.reservation.created"
      ]);
      expect(await liveAllocations(hold.id)).toBe(1);
    });

    test("an immediate offering is confirmed at once: created then confirmed, and no held", async () => {
      const fixture = await newFixture(TENANT_A, { confirmation: "immediate" });
      const reservation = await created(TENANT_A, fixture);

      expect(reservation.status).toBe("confirmed");
      expect(reservation.holdExpiresAt).toBeNull();
      expect(
        (await domainEvents(reservation.id)).map((e) => e.event_type)
      ).toEqual([
        "awcms.booking.reservation.created",
        "awcms.booking.reservation.confirmed"
      ]);
    });

    test("a taken slot is a refusal VALUE that writes nothing", async () => {
      const fixture = await newFixture(TENANT_A);

      await created(TENANT_A, fixture);

      const before = await writeCounts(TENANT_A);
      const refused = await create(TENANT_A, claim(fixture));

      expect(refused).toMatchObject({
        outcome: "refused",
        code: "SLOT_UNAVAILABLE",
        httpStatus: 409
      });
      expect(await writeCounts(TENANT_A)).toEqual(before);
    });

    test("an adapter retrying with a fresh key against a live external reference does not duplicate", async () => {
      const fixture = await newFixture(TENANT_A, { capacity: 2 });
      const first = await created(TENANT_A, fixture, {
        externalRef: { type: "order", id: "ORD-DUP" }
      });
      const second = await create(
        TENANT_A,
        claim(fixture, { externalRef: { type: "order", id: "ORD-DUP" } })
      );

      expect(first.status).toBe("held");
      expect(second).toMatchObject({
        outcome: "refused",
        code: "EXTERNAL_REF_IN_USE"
      });
    });

    test("another tenant's resource is the same not-found as an unknown one", async () => {
      const fixture = await newFixture(TENANT_B);
      const outcome = await create(TENANT_A, claim(fixture));

      expect(outcome).toMatchObject({
        outcome: "refused",
        code: "OFFERING_NOT_FOUND",
        httpStatus: 404
      });
    });
  });

  describe("confirm", () => {
    test("held -> confirmed clears the expiry, writes one history row, one audit row, one event", async () => {
      const fixture = await newFixture(TENANT_A);
      const hold = await created(TENANT_A, fixture);
      const outcome = await transition(TENANT_A, hold.id, "confirm");

      expect(outcome).toMatchObject({ outcome: "ok", replayed: false });
      if (outcome.outcome === "ok") {
        expect(outcome.reservation.status).toBe("confirmed");
        expect(outcome.reservation.holdExpiresAt).toBeNull();
      }
      expect(await historyKinds(hold.id)).toEqual([
        "created",
        "held",
        "confirmed"
      ]);
      expect((await domainEvents(hold.id)).at(-1)).toMatchObject({
        event_type: "awcms.booking.reservation.confirmed",
        payload: { status: "confirmed", previousStatus: "held" }
      });
      expect(await auditActions(hold.id)).toEqual([
        "booking.reservation.created",
        "booking.reservation.confirmed"
      ]);
      expect(await liveAllocations(hold.id)).toBe(1);
    });

    test("confirming a confirmed reservation is a replay and writes NOTHING, with any key", async () => {
      const fixture = await newFixture(TENANT_A);
      const reservation = await confirmed(TENANT_A, fixture);
      const before = await writeCounts(TENANT_A);

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const again = await transition(TENANT_A, reservation.id, "confirm");

        expect(again).toMatchObject({ outcome: "ok", replayed: true });
      }

      expect(await writeCounts(TENANT_A)).toEqual(before);
    });

    test("an elapsed hold is HOLD_EXPIRED even though nothing has swept it, and stays held", async () => {
      const fixture = await newFixture(TENANT_A);
      const hold = await created(TENANT_A, fixture);

      await backdate(hold.id);

      const before = await writeCounts(TENANT_A);
      const outcome = await transition(TENANT_A, hold.id, "confirm");

      expect(outcome).toMatchObject({
        outcome: "refused",
        code: "HOLD_EXPIRED"
      });
      expect(await writeCounts(TENANT_A)).toEqual(before);
    });

    test("a hold the sweep already expired is HOLD_EXPIRED too (a payment that came too late)", async () => {
      const fixture = await newFixture(TENANT_A);
      const hold = await created(TENANT_A, fixture);

      await backdate(hold.id);
      await workerTx(TENANT_A, (tx) => expireDueHolds(tx, TENANT_A));

      expect(await transition(TENANT_A, hold.id, "confirm")).toMatchObject({
        outcome: "refused",
        code: "HOLD_EXPIRED"
      });
    });

    test("an unknown id and another tenant's id are the same not_found", async () => {
      const fixture = await newFixture(TENANT_B);
      const theirs = await created(TENANT_B, fixture);

      expect(await transition(TENANT_A, theirs.id, "confirm")).toEqual({
        outcome: "not_found"
      });
      expect(
        await transition(TENANT_A, crypto.randomUUID(), "confirm")
      ).toEqual({ outcome: "not_found" });
    });
  });

  describe("cancel", () => {
    test("a hold and a confirmed reservation both cancel and release their allocations", async () => {
      const fixture = await newFixture(TENANT_A, { capacity: 2 });
      const hold = await created(TENANT_A, fixture);
      const sure = await confirmed(TENANT_A, fixture);

      for (const reservation of [hold, sure]) {
        const outcome = await transition(TENANT_A, reservation.id, "cancel", {
          reasonCode: "customer_request"
        });

        expect(outcome).toMatchObject({ outcome: "ok", replayed: false });
        expect(await liveAllocations(reservation.id)).toBe(0);
        expect((await domainEvents(reservation.id)).at(-1)).toMatchObject({
          event_type: "awcms.booking.reservation.cancelled",
          payload: { status: "cancelled", lateCancellation: false }
        });
      }

      // The slot is free again.
      expect((await create(TENANT_A, claim(fixture))).outcome).toBe("ok");
    });

    test("a cancellation inside the offering's cutoff is late: recorded as a fact on the row and the event", async () => {
      // The slot starts in ~3 days; a cutoff of 4 days makes any cancellation late.
      const fixture = await newFixture(TENANT_A, { cutoffSeconds: 4 * 86_400 });
      const reservation = await confirmed(TENANT_A, fixture);
      const outcome = await transition(TENANT_A, reservation.id, "cancel", {
        reasonCode: "no_longer_needed"
      });

      expect(outcome).toMatchObject({ outcome: "ok" });
      if (outcome.outcome === "ok") {
        expect(outcome.reservation.lateCancellation).toBe(true);
        expect(outcome.reservation.cancelReasonCode).toBe("no_longer_needed");
      }
      expect(
        (await domainEvents(reservation.id)).at(-1)?.payload
      ).toMatchObject({ lateCancellation: true });
    });

    test("cancelling twice is a replay; cancelling a checked-in reservation is INVALID_STATE", async () => {
      const fixture = await newFixture(TENANT_A);
      const reservation = await confirmed(TENANT_A, fixture);

      await transition(TENANT_A, reservation.id, "cancel");

      const before = await writeCounts(TENANT_A);

      expect(
        await transition(TENANT_A, reservation.id, "cancel")
      ).toMatchObject({
        outcome: "ok",
        replayed: true
      });
      expect(await writeCounts(TENANT_A)).toEqual(before);

      const other = await newFixture(TENANT_A);
      const inHouse = await confirmed(TENANT_A, other);

      await transition(TENANT_A, inHouse.id, "check_in");
      expect(await transition(TENANT_A, inHouse.id, "cancel")).toMatchObject({
        outcome: "refused",
        code: "INVALID_STATE"
      });
    });
  });

  describe("check-in, check-out and no-show", () => {
    test("confirmed -> checked_in -> completed keeps the allocations and publishes each step", async () => {
      const fixture = await newFixture(TENANT_A);
      const reservation = await confirmed(TENANT_A, fixture);

      expect(
        await transition(TENANT_A, reservation.id, "check_in")
      ).toMatchObject({ outcome: "ok", replayed: false });
      expect(
        await transition(TENANT_A, reservation.id, "complete")
      ).toMatchObject({ outcome: "ok", replayed: false });
      expect(await liveAllocations(reservation.id)).toBe(1);
      expect(
        (await domainEvents(reservation.id)).map((e) => e.event_type)
      ).toEqual([
        "awcms.booking.reservation.created",
        "awcms.booking.reservation.held",
        "awcms.booking.reservation.confirmed",
        "awcms.booking.reservation.checked_in",
        "awcms.booking.reservation.completed"
      ]);
      expect(
        await transition(TENANT_A, reservation.id, "complete")
      ).toMatchObject({ outcome: "ok", replayed: true });
    });

    test("a held reservation cannot be checked in; a confirmed one cannot be completed first", async () => {
      const fixture = await newFixture(TENANT_A, { capacity: 2 });
      const hold = await created(TENANT_A, fixture);
      const sure = await confirmed(TENANT_A, fixture);

      expect(await transition(TENANT_A, hold.id, "check_in")).toMatchObject({
        outcome: "refused",
        code: "INVALID_STATE"
      });
      expect(await transition(TENANT_A, sure.id, "complete")).toMatchObject({
        outcome: "refused",
        code: "INVALID_STATE"
      });
    });

    test("no-show is refused before the start plus the grace, allowed after, and keeps the slot consumed", async () => {
      const future = await newFixture(TENANT_A);
      const upcoming = await confirmed(TENANT_A, future);

      expect(await transition(TENANT_A, upcoming.id, "no_show")).toMatchObject({
        outcome: "refused",
        code: "NO_SHOW_TOO_EARLY"
      });

      // A reservation that started two hours ago (an override creates it).
      const past = await newFixture(TENANT_A);
      const started = await created(
        TENANT_A,
        past,
        { startsAtMs: Math.floor(Date.now() / HOUR) * HOUR - 2 * HOUR },
        true
      );

      await transition(TENANT_A, started.id, "confirm");

      expect(await transition(TENANT_A, started.id, "no_show")).toMatchObject({
        outcome: "ok",
        replayed: false
      });
      expect(await liveAllocations(started.id)).toBe(1);
      expect((await domainEvents(started.id)).at(-1)?.event_type).toBe(
        "awcms.booking.reservation.no_show"
      );
      expect(await transition(TENANT_A, started.id, "no_show")).toMatchObject({
        outcome: "ok",
        replayed: true
      });
    });

    test("a stay cannot be checked in before its check-in date; there is no time-of-day check", async () => {
      const fixture = await newFixture(TENANT_A, { mode: "stay" });
      const later = await confirmed(TENANT_A, fixture, {
        startsAtMs: undefined,
        stay: { checkInDate: dateAfter(10), checkOutDate: dateAfter(12) }
      });

      expect(await transition(TENANT_A, later.id, "check_in")).toMatchObject({
        outcome: "refused",
        code: "CHECK_IN_TOO_EARLY"
      });

      // Arriving today is allowed at any hour: the check-in TIME is 14:00, but
      // there is no time-of-day check (an early arrival is a front-desk decision).
      // The override creates the stay whatever the clock says.
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Pontianak"
      }).format(new Date());
      const sameDay = await newFixture(TENANT_A, { mode: "stay" });
      const arriving = await created(
        TENANT_A,
        sameDay,
        {
          startsAtMs: undefined,
          stay: {
            checkInDate: today,
            checkOutDate: new Date(Date.parse(today) + 2 * DAY)
              .toISOString()
              .slice(0, 10)
          }
        },
        true
      );

      await transition(TENANT_A, arriving.id, "confirm");
      expect(await transition(TENANT_A, arriving.id, "check_in")).toMatchObject(
        {
          outcome: "ok",
          replayed: false
        }
      );
    });
  });

  describe("reschedule (T5)", () => {
    test("(a) moving over one's own slot does not conflict with itself; the lineage and the external reference move", async () => {
      const fixture = await newFixture(TENANT_A);
      const original = await confirmed(TENANT_A, fixture, {
        externalRef: { type: "order", id: "ORD-MOVE" },
        externalCustomerRef: "cus-move",
        customerNote: "window seat"
      });
      // Thirty minutes later: overlaps the booking's own hour.
      const outcome = await reschedule(TENANT_A, original.id, {
        startsAtMs: START + 30 * 60_000,
        overridePolicy: false
      });

      expect(outcome).toMatchObject({ outcome: "ok", replayed: false });
      if (outcome.outcome !== "ok") {
        return;
      }

      expect(outcome.previous.status).toBe("rescheduled");
      expect(outcome.previous.supersededById).toBe(outcome.reservation.id);
      expect(outcome.reservation.status).toBe("confirmed");
      expect(outcome.reservation.lineageId).toBe(original.lineageId);
      expect(outcome.reservation.rescheduledFromId).toBe(original.id);
      expect(outcome.reservation.externalRef).toBe("ORD-MOVE");
      expect(outcome.reservation.externalCustomerRef).toBe("cus-move");
      expect(await liveAllocations(original.id)).toBe(0);
      expect(await liveAllocations(outcome.reservation.id)).toBe(1);
      expect(await historyKinds(original.id)).toEqual([
        "created",
        "held",
        "confirmed",
        "rescheduled"
      ]);
      expect(await historyKinds(outcome.reservation.id)).toEqual([
        "created",
        "confirmed"
      ]);
      expect((await domainEvents(original.id)).at(-1)).toMatchObject({
        event_type: "awcms.booking.reservation.rescheduled",
        payload: {
          status: "rescheduled",
          previousStatus: "confirmed",
          supersededById: outcome.reservation.id
        }
      });
      expect(
        (await domainEvents(outcome.reservation.id)).map((e) => e.event_type)
      ).toEqual([
        "awcms.booking.reservation.created",
        "awcms.booking.reservation.confirmed"
      ]);
      expect(
        (await domainEvents(outcome.reservation.id))[0]!.payload
      ).toMatchObject({
        rescheduledFromId: original.id,
        lineageId: original.lineageId
      });
      expect(await auditActions(original.id)).toContain(
        "booking.reservation.rescheduled"
      );
      expect(
        (await tenantTx(TENANT_A, (tx) => runReconciliation(tx, TENANT_A)))
          .drift
      ).toBe(0);
    });

    test("(c) a refused reschedule leaves the original confirmed with its allocation live and writes nothing", async () => {
      const fixture = await newFixture(TENANT_A);
      const mine = await confirmed(TENANT_A, fixture);
      const blocker = await confirmed(TENANT_A, fixture, {
        startsAtMs: START + 3 * HOUR
      });
      const before = await writeCounts(TENANT_A);
      const outcome = await reschedule(TENANT_A, mine.id, {
        startsAtMs: START + 3 * HOUR,
        overridePolicy: false
      });

      expect(outcome).toMatchObject({
        outcome: "refused",
        code: "SLOT_UNAVAILABLE"
      });
      expect(await writeCounts(TENANT_A)).toEqual(before);
      expect(await liveAllocations(mine.id)).toBe(1);
      expect(await liveAllocations(blocker.id)).toBe(1);
      expect((await getReservation_(TENANT_A, mine.id))?.status).toBe(
        "confirmed"
      );
    });

    test("only a confirmed reservation moves; a repeat of the same move is a replay; another move is INVALID_STATE", async () => {
      const fixture = await newFixture(TENANT_A, { capacity: 2 });
      const hold = await created(TENANT_A, fixture);

      expect(
        await reschedule(TENANT_A, hold.id, {
          startsAtMs: START + 2 * HOUR,
          overridePolicy: false
        })
      ).toMatchObject({ outcome: "refused", code: "INVALID_STATE" });

      const sure = await confirmed(TENANT_A, fixture);
      const move = { startsAtMs: START + 5 * HOUR, overridePolicy: false };
      const first = await reschedule(TENANT_A, sure.id, move);
      const before = await writeCounts(TENANT_A);

      expect(first).toMatchObject({ outcome: "ok", replayed: false });
      expect(await reschedule(TENANT_A, sure.id, move)).toMatchObject({
        outcome: "ok",
        replayed: true
      });
      expect(await writeCounts(TENANT_A)).toEqual(before);
      expect(
        await reschedule(TENANT_A, sure.id, {
          startsAtMs: START + 7 * HOUR,
          overridePolicy: false
        })
      ).toMatchObject({ outcome: "refused", code: "INVALID_STATE" });
    });

    test("a stay is extended over its own nights without conflicting with itself", async () => {
      const fixture = await newFixture(TENANT_A, { mode: "stay" });
      const checkIn = dateAfter(20);
      const original = await confirmed(TENANT_A, fixture, {
        startsAtMs: undefined,
        stay: { checkInDate: checkIn, checkOutDate: dateAfter(22) }
      });
      const outcome = await reschedule(TENANT_A, original.id, {
        stay: { checkInDate: checkIn, checkOutDate: dateAfter(24) },
        overridePolicy: false
      });

      expect(outcome).toMatchObject({ outcome: "ok" });
      if (outcome.outcome === "ok") {
        expect(outcome.reservation.items[0]!.stay?.nights).toBe(4);
        expect(
          (await domainEvents(outcome.reservation.id))[0]!.payload
        ).toMatchObject({ stays: [{ checkInDate: checkIn, nights: 4 }] });
      }
    });

    test("(b) two reservations moving into each other's slots at once: no hang, at most one moves, both stay consistent", async () => {
      for (let round = 0; round < 6; round += 1) {
        const fixture = await newFixture(TENANT_A);
        const a = await confirmed(TENANT_A, fixture);
        const b = await confirmed(TENANT_A, fixture, {
          startsAtMs: START + 4 * HOUR
        });
        const outcomes = await Promise.race([
          race([
            () =>
              reschedule(TENANT_A, a.id, {
                startsAtMs: START + 4 * HOUR,
                overridePolicy: false
              }),
            () =>
              reschedule(TENANT_A, b.id, {
                startsAtMs: START,
                overridePolicy: false
              })
          ]),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("reschedule race hung")), 10_000)
          )
        ]);
        const moved = outcomes.filter((outcome) => outcome.outcome === "ok");

        expect(moved.length).toBeLessThanOrEqual(1);
        for (const outcome of outcomes) {
          if (outcome.outcome === "refused") {
            expect(["SLOT_UNAVAILABLE", "CONTENTION_RETRY"]).toContain(
              outcome.code
            );
          }
        }

        // Whatever happened, the resource holds exactly two live allocations
        // and the data reconciles.
        const live = (await getAdminSql()`
          SELECT count(*)::int AS n FROM awcms_booking_resource_allocations
          WHERE resource_id = ${fixture.resourceId} AND released_at IS NULL
        `) as { n: number }[];

        expect(live[0]!.n).toBe(2);
      }

      expect(
        (await tenantTx(TENANT_A, (tx) => runReconciliation(tx, TENANT_A)))
          .drift
      ).toBe(0);
    });
  });

  describe("policy, and the override that lifts it", () => {
    test("a resource with no schedule is closed: OUTSIDE_SCHEDULE, nothing written", async () => {
      const fixture = await newFixture(TENANT_A, { schedule: false });
      const before = await writeCounts(TENANT_A);

      expect(await create(TENANT_A, claim(fixture))).toMatchObject({
        outcome: "refused",
        code: "OUTSIDE_SCHEDULE",
        httpStatus: 409
      });
      expect(await writeCounts(TENANT_A)).toEqual(before);
    });

    test("lead time and horizon are refused", async () => {
      const fixture = await newFixture(TENANT_A);
      const nextHour = Math.ceil(Date.now() / HOUR) * HOUR;

      await getAdminSql()`
        INSERT INTO awcms_booking_settings (tenant_id, min_lead_seconds, max_horizon_days)
        VALUES (${TENANT_B}, 7200, 30)
      `;

      const other = await newFixture(TENANT_B);

      expect(
        await create(TENANT_B, claim(other, { startsAtMs: nextHour }))
      ).toMatchObject({ outcome: "refused", code: "LEAD_TIME_VIOLATION" });
      expect(
        await create(TENANT_B, claim(other, { startsAtMs: START + 60 * DAY }))
      ).toMatchObject({ outcome: "refused", code: "HORIZON_EXCEEDED" });
      // The first tenant has no policy row: the module defaults let START through.
      expect((await create(TENANT_A, claim(fixture))).outcome).toBe("ok");

      await getAdminSql()`DELETE FROM awcms_booking_settings WHERE tenant_id = ${TENANT_B}`;
    });

    test("with the override lifted a start outside hours is created, and the lift is audited critical with the rules named", async () => {
      const fixture = await newFixture(TENANT_A, { schedule: false });
      const reservation = await created(TENANT_A, fixture, {}, true);
      const audit = (await getAdminSql()`
        SELECT severity, attributes
        FROM awcms_audit_events
        WHERE module_key = 'booking' AND resource_id = ${reservation.id}
          AND action = 'booking.reservation.overridden'
      `) as { severity: string; attributes: Record<string, unknown> }[];

      expect(audit).toHaveLength(1);
      expect(audit[0]!.severity).toBe("critical");
      expect(audit[0]!.attributes).toMatchObject({
        liftedRules: ["OUTSIDE_SCHEDULE"]
      });
    });

    test("the override never lifts a conflict", async () => {
      const fixture = await newFixture(TENANT_A);

      await created(TENANT_A, fixture);

      expect(await create(TENANT_A, claim(fixture), true)).toMatchObject({
        outcome: "refused",
        code: "SLOT_UNAVAILABLE"
      });
    });

    test("a reschedule outside hours needs the lift, and writes nothing without it", async () => {
      const fixture = await newFixture(TENANT_A);
      const reservation = await confirmed(TENANT_A, fixture);

      // Close the whole resource afterwards.
      await getAdminSql()`
        UPDATE awcms_booking_schedules SET status = 'inactive'
        WHERE resource_id = ${fixture.resourceId}
      `;

      const before = await writeCounts(TENANT_A);

      expect(
        await reschedule(TENANT_A, reservation.id, {
          startsAtMs: START + 2 * HOUR,
          overridePolicy: false
        })
      ).toMatchObject({ outcome: "refused", code: "OUTSIDE_SCHEDULE" });
      expect(await writeCounts(TENANT_A)).toEqual(before);
      expect(
        await reschedule(
          TENANT_A,
          reservation.id,
          { startsAtMs: START + 2 * HOUR, overridePolicy: true },
          true
        )
      ).toMatchObject({ outcome: "ok", policyLifted: ["OUTSIDE_SCHEDULE"] });
    });
  });

  describe("hold caps default to a safe number (booking.md section 13)", () => {
    test("with NO settings row a customer is capped at five live holds; a sixth is HOLD_LIMIT_EXCEEDED", async () => {
      // TENANT_B has no settings row at this point.
      const fixture = await newFixture(TENANT_B, { capacity: 8 });

      for (let index = 0; index < 5; index += 1) {
        const outcome = await create(
          TENANT_B,
          claim(fixture, { externalCustomerRef: "cus-greedy" })
        );

        expect(outcome.outcome).toBe("ok");
      }

      expect(
        await create(
          TENANT_B,
          claim(fixture, { externalCustomerRef: "cus-greedy" })
        )
      ).toMatchObject({
        outcome: "refused",
        code: "HOLD_LIMIT_EXCEEDED",
        httpStatus: 429
      });
      // Another customer, and a walk-in with no reference, are not counted against it.
      expect(
        (
          await create(
            TENANT_B,
            claim(fixture, { externalCustomerRef: "cus-fine" })
          )
        ).outcome
      ).toBe("ok");
      expect((await create(TENANT_B, claim(fixture))).outcome).toBe("ok");
    });

    test("a tenant that configures a cap gets that cap, and an immediate confirmation is not a hold", async () => {
      const tenantId = "b9410000-0000-4000-8000-0000000000c1";

      await seedTenant(tenantId, "resv-c1");
      await getAdminSql()`
        INSERT INTO awcms_booking_settings (tenant_id, max_active_holds_per_tenant)
        VALUES (${tenantId}, 2)
      `;

      const holds = await newFixture(tenantId, { capacity: 4 });
      const instant = await newFixture(tenantId, {
        capacity: 4,
        confirmation: "immediate"
      });

      expect((await create(tenantId, claim(holds))).outcome).toBe("ok");
      expect((await create(tenantId, claim(holds))).outcome).toBe("ok");
      expect(await create(tenantId, claim(holds))).toMatchObject({
        outcome: "refused",
        code: "HOLD_LIMIT_EXCEEDED"
      });
      expect((await create(tenantId, claim(instant))).outcome).toBe("ok");
    });

    test("holds racing the tenant cap never exceed it", async () => {
      const tenantId = "b9410000-0000-4000-8000-0000000000c2";

      await seedTenant(tenantId, "resv-c2");
      await getAdminSql()`
        INSERT INTO awcms_booking_settings (tenant_id, max_active_holds_per_tenant)
        VALUES (${tenantId}, 3)
      `;

      const fixture = await newFixture(tenantId, { capacity: 12 });
      const outcomes = await race(
        Array.from({ length: 12 }, () => () => create(tenantId, claim(fixture)))
      );
      const placed = outcomes.filter((outcome) => outcome.outcome === "ok");
      const live = (await getAdminSql()`
        SELECT count(*)::int AS n FROM awcms_booking_reservations
        WHERE tenant_id = ${tenantId} AND status = 'held'
      `) as { n: number }[];

      expect(placed).toHaveLength(3);
      expect(live[0]!.n).toBe(3);
    });
  });

  describe("expiry is published, however it happens", () => {
    test("a hold reclaimed by a claim that wants its units, and one found by the sweep, publish the same `expired` shape", async () => {
      const lazy = await newFixture(TENANT_A);
      const swept = await newFixture(TENANT_A);
      const lazyHold = await created(TENANT_A, lazy, {
        externalRef: { type: "order", id: "ORD-LAZY" }
      });
      const sweptHold = await created(TENANT_A, swept, {
        externalRef: { type: "order", id: "ORD-SWEPT" }
      });

      await backdate(lazyHold.id);
      await backdate(sweptHold.id);

      // Lazy reclaim: a new claim on the same unit.
      expect((await create(TENANT_A, claim(lazy))).outcome).toBe("ok");
      // The sweep, as the background role, publishing in its own transaction.
      await workerTx(TENANT_A, async (tx) => {
        const outcome = await expireDueHolds(tx, TENANT_A);

        await emitReaperExpiredEvents(
          tx,
          TENANT_A,
          outcome,
          crypto.randomUUID()
        );
      });

      const lazyEvent = (await domainEvents(lazyHold.id)).at(-1)!;
      const sweptEvent = (await domainEvents(sweptHold.id)).at(-1)!;

      for (const event of [lazyEvent, sweptEvent]) {
        expect(event.event_type).toBe("awcms.booking.reservation.expired");
        expect(event.payload).toMatchObject({
          status: "expired",
          previousStatus: "held"
        });
      }
      expect(Object.keys(lazyEvent.payload).sort()).toEqual(
        Object.keys(sweptEvent.payload).sort()
      );
      expect(sweptEvent.payload).toMatchObject({
        reservationId: sweptHold.id,
        externalRefType: "order",
        externalRef: "ORD-SWEPT",
        resourceIds: [swept.resourceId],
        offeringIds: [swept.offeringId]
      });
      expect(await historyKinds(sweptHold.id)).toEqual([
        "created",
        "held",
        "expired"
      ]);
    });

    test("(T6 b) a confirm racing the sweep: exactly one outcome, never confirmed without live allocations", async () => {
      for (let round = 0; round < 12; round += 1) {
        const fixture = await newFixture(TENANT_A);
        const hold = await created(TENANT_A, fixture);

        // Expires a few milliseconds from now, so the two actually contend.
        await setHoldExpiry(
          hold.id,
          `clock_timestamp() + interval '${5 + (round % 4) * 10} milliseconds'`
        );

        const outcomes = await race<TransitionOutcome | void>([
          () => transition(TENANT_A, hold.id, "confirm"),
          () =>
            workerTx(TENANT_A, async (tx) => {
              const outcome = await expireDueHolds(tx, TENANT_A);

              await emitReaperExpiredEvents(
                tx,
                TENANT_A,
                outcome,
                crypto.randomUUID()
              );
            })
        ]);
        const confirm = outcomes[0] as TransitionOutcome;
        const final = (await getAdminSql()`
          SELECT status FROM awcms_booking_reservations WHERE id = ${hold.id}
        `) as { status: string }[];
        const live = await liveAllocations(hold.id);

        if (confirm.outcome === "ok") {
          expect(final[0]!.status).toBe("confirmed");
          expect(live).toBe(1);
        } else {
          expect(confirm).toMatchObject({
            outcome: "refused",
            code: "HOLD_EXPIRED"
          });
          // The confirm lost: the hold is still held (the sweep may not have run
          // yet, the claim reclaims it) or already expired. Never confirmed.
          expect(["held", "expired"]).toContain(final[0]!.status);
          if (final[0]!.status === "expired") {
            expect(live).toBe(0);
          }
        }
      }
    });
  });

  describe("a confirm whose hold elapses between the clock read and the UPDATE (#1025)", () => {
    /**
     * Forces the window deterministically: the hold has ~2 s left when the
     * service reads the clock under the row lock, and the confirm UPDATE is held
     * back 2.6 s before it reaches the database, so the `held -> confirmed`
     * guard trigger (sql/180) judges the hold elapsed after the application
     * judged it live. Without the fix the trigger's 55000 HOLD_EXPIRED escapes
     * as an exception (a 500); with it the savepoint rolls back and the call
     * returns the refusal.
     */
    function delayedConfirmTx(tx: Bun.TransactionSQL): Bun.TransactionSQL {
      return new Proxy(tx, {
        apply(target, thisArg, args: unknown[]) {
          const strings = args[0] as readonly string[] | undefined;
          const text = Array.isArray(strings) ? strings.join("?") : "";

          if (text.includes("SET status = 'confirmed'")) {
            return new Promise((resolve, reject) => {
              setTimeout(() => {
                Reflect.apply(target, thisArg, args).then(resolve, reject);
              }, 2600);
            });
          }

          return Reflect.apply(target, thisArg, args);
        }
      });
    }

    async function auditCount(reservationId: string): Promise<number> {
      const rows = (await getAdminSql()`
        SELECT count(*)::int AS n FROM awcms_audit_events
        WHERE module_key = 'booking' AND resource_id = ${reservationId}
      `) as { n: number }[];

      return rows[0]!.n;
    }

    test("the service returns the HOLD_EXPIRED refusal and writes nothing", async () => {
      const fixture = await newFixture(TENANT_A);
      const hold = await created(TENANT_A, fixture);
      const eventsBefore = (await domainEvents(hold.id)).length;
      const auditBefore = await auditCount(hold.id);

      await setHoldExpiry(hold.id, "clock_timestamp() + interval '2 seconds'");

      const outcome = await tenantTx(TENANT_A, (tx) =>
        transitionReservation(
          delayedConfirmTx(tx),
          ctxOf(TENANT_A),
          hold.id,
          "confirm"
        )
      );

      expect(outcome).toMatchObject({
        outcome: "refused",
        code: "HOLD_EXPIRED",
        httpStatus: 409
      });

      const final = (await getAdminSql()`
        SELECT status FROM awcms_booking_reservations WHERE id = ${hold.id}
      `) as { status: string }[];

      expect(final[0]!.status).toBe("held");
      expect(await liveAllocations(hold.id)).toBe(1);
      expect(await historyKinds(hold.id)).toEqual(["created", "held"]);
      expect(await auditCount(hold.id)).toBe(auditBefore);
      expect((await domainEvents(hold.id)).length).toBe(eventsBefore);
    });

    test("the BookingPort confirm refuses with HOLD_EXPIRED instead of throwing", async () => {
      const fixture = await newFixture(TENANT_A);
      const hold = await created(TENANT_A, fixture);

      await setHoldExpiry(hold.id, "clock_timestamp() + interval '2 seconds'");

      const outcome = await tenantTx(TENANT_A, (tx) =>
        bookingPort.confirm(delayedConfirmTx(tx), {
          tenantId: TENANT_A,
          correlationId: crypto.randomUUID(),
          actorTenantUserId: ACTORS.get(TENANT_A)!,
          reservationId: hold.id,
          idempotencyKey: `confirm-${crypto.randomUUID()}`
        })
      );

      expect(outcome).toEqual({ ok: false, reason: "HOLD_EXPIRED" });
      expect(await historyKinds(hold.id)).toEqual(["created", "held"]);
    });
  });

  describe("no event and no audit row carries personal data", () => {
    test("the customer reference, the note and the cancellation reason never leave the reservation", async () => {
      const fixture = await newFixture(TENANT_A, { cutoffSeconds: 60 });
      const reservation = await confirmed(TENANT_A, fixture, {
        externalCustomerRef: "cus-super-private-77",
        customerNote: "needs a wheelchair ramp",
        externalRef: { type: "order", id: "ORD-PRIVACY" }
      });

      await transition(TENANT_A, reservation.id, "cancel", {
        reasonCode: "customer_illness"
      });

      const events = JSON.stringify(
        (await domainEvents(reservation.id)).map((event) => event.payload)
      );
      const audit = JSON.stringify(
        await getAdminSql()`
          SELECT message, attributes FROM awcms_audit_events
          WHERE module_key = 'booking' AND resource_id = ${reservation.id}
        `
      );

      for (const secret of [
        "cus-super-private-77",
        "wheelchair",
        "customer_illness"
      ]) {
        expect(events).not.toContain(secret);
        expect(audit).not.toContain(secret);
      }
      // The adapter's own reference IS carried: it needs it to find its order.
      expect(events).toContain("ORD-PRIVACY");
      // The reason code is on the append-only history row, as a code.
      const history = (await getAdminSql()`
        SELECT reason_code FROM awcms_booking_reservation_events
        WHERE reservation_id = ${reservation.id} AND kind = 'cancelled'
      `) as { reason_code: string }[];

      expect(history[0]!.reason_code).toBe("customer_illness");
    });

    test("the detail view never returns the note", async () => {
      const fixture = await newFixture(TENANT_A);
      const reservation = await created(TENANT_A, fixture, {
        customerNote: "a private note"
      });

      expect(JSON.stringify(reservation)).not.toContain("a private note");
    });
  });

  describe("the BookingPort", () => {
    test("hold, confirm, reschedule and cancel through the port; a replay of the same key writes nothing", async () => {
      const fixture = await newFixture(TENANT_A);
      const common = {
        tenantId: TENANT_A,
        correlationId: crypto.randomUUID(),
        staff: NO_OP_STAFF_AVAILABILITY,
        actorTenantUserId: ACTORS.get(TENANT_A)!
      };
      const holdKey = `hold-${crypto.randomUUID()}`;
      const hold = await tenantTx(TENANT_A, (tx) =>
        bookingPort.hold(tx, {
          ...common,
          offeringId: fixture.offeringId,
          resourceId: fixture.resourceId,
          startsAt: new Date(START).toISOString(),
          partySize: 1,
          idempotencyKey: holdKey,
          externalRef: { type: "order", id: "ORD-PORT" }
        })
      );

      expect(hold).toMatchObject({ ok: true, status: "held", replayed: false });
      if (!hold.ok) {
        return;
      }

      const before = await writeCounts(TENANT_A);
      const replay = await tenantTx(TENANT_A, (tx) =>
        bookingPort.hold(tx, {
          ...common,
          offeringId: fixture.offeringId,
          resourceId: fixture.resourceId,
          startsAt: new Date(START).toISOString(),
          partySize: 1,
          idempotencyKey: holdKey,
          externalRef: { type: "order", id: "ORD-PORT" }
        })
      );

      expect(replay).toMatchObject({
        ok: true,
        reservationId: hold.reservationId,
        replayed: true
      });
      expect(await writeCounts(TENANT_A)).toEqual(before);
      // The same key with a different request is a conflict.
      expect(
        await tenantTx(TENANT_A, (tx) =>
          bookingPort.hold(tx, {
            ...common,
            offeringId: fixture.offeringId,
            resourceId: fixture.resourceId,
            startsAt: new Date(START + HOUR).toISOString(),
            partySize: 1,
            idempotencyKey: holdKey
          })
        )
      ).toEqual({ ok: false, reason: "IDEMPOTENCY_CONFLICT" });

      const confirm = await tenantTx(TENANT_A, (tx) =>
        bookingPort.confirm(tx, {
          ...common,
          reservationId: hold.reservationId,
          idempotencyKey: `confirm-${crypto.randomUUID()}`
        })
      );

      expect(confirm).toMatchObject({ ok: true, status: "confirmed" });

      const moved = await tenantTx(TENANT_A, (tx) =>
        bookingPort.reschedule(tx, {
          ...common,
          reservationId: hold.reservationId,
          idempotencyKey: `move-${crypto.randomUUID()}`,
          startsAt: new Date(START + 2 * HOUR).toISOString()
        })
      );

      expect(moved).toMatchObject({ ok: true, status: "confirmed" });
      if (!moved.ok) {
        return;
      }

      expect(moved.reservationId).not.toBe(hold.reservationId);
      expect(
        await tenantTx(TENANT_A, (tx) =>
          bookingPort.cancel(tx, {
            ...common,
            reservationId: moved.reservationId,
            reasonCode: "customer_request",
            idempotencyKey: `cancel-${crypto.randomUUID()}`
          })
        )
      ).toMatchObject({ ok: true, status: "cancelled" });
    });

    test("a refusal is a value, a payment field is refused by name, and quote writes nothing", async () => {
      const fixture = await newFixture(TENANT_A);
      const common = {
        tenantId: TENANT_A,
        correlationId: crypto.randomUUID()
      };
      const before = await writeCounts(TENANT_A);
      const quote = await tenantTx(TENANT_A, (tx) =>
        bookingPort.quote(tx, {
          ...common,
          offeringId: fixture.offeringId,
          resourceId: fixture.resourceId,
          startsAt: new Date(START).toISOString(),
          partySize: 1
        })
      );

      expect(quote).toMatchObject({
        ok: true,
        unitsNeeded: 1,
        endsAt: new Date(START + HOUR).toISOString()
      });
      expect(await writeCounts(TENANT_A)).toEqual(before);

      await created(TENANT_A, fixture);

      expect(
        await tenantTx(TENANT_A, (tx) =>
          bookingPort.quote(tx, {
            ...common,
            offeringId: fixture.offeringId,
            resourceId: fixture.resourceId,
            startsAt: new Date(START).toISOString(),
            partySize: 1
          })
        )
      ).toEqual({ ok: false, reason: "SLOT_UNAVAILABLE" });
      expect(
        await tenantTx(TENANT_A, (tx) =>
          bookingPort.hold(tx, {
            ...common,
            offeringId: fixture.offeringId,
            resourceId: fixture.resourceId,
            startsAt: new Date(START + 5 * HOUR).toISOString(),
            partySize: 1,
            idempotencyKey: "k-pay",
            paymentStatus: "paid"
          } as never)
        )
      ).toEqual({ ok: false, reason: "PAYMENT_FIELD_NOT_ACCEPTED" });
      expect(
        await tenantTx(TENANT_A, (tx) =>
          bookingPort.confirm(tx, {
            ...common,
            reservationId: crypto.randomUUID(),
            actorTenantUserId: ACTORS.get(TENANT_A)!,
            idempotencyKey: "k-missing"
          })
        )
      ).toEqual({ ok: false, reason: "RESERVATION_NOT_FOUND" });
    });
  });

  describe("review follow-ups (F1-F6)", () => {
    test("F3: a confirm queued behind another writer while the hold elapses is HOLD_EXPIRED, never a trigger error", async () => {
      const fixture = await newFixture(TENANT_A);
      const hold = await created(TENANT_A, fixture);

      await setHoldExpiry(
        hold.id,
        "clock_timestamp() + interval '1500 milliseconds'"
      );

      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked!: () => void;
      const holding = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const holder = tenantTx(TENANT_A, async (tx) => {
        await tx`SELECT id FROM awcms_booking_reservations WHERE id = ${hold.id} FOR UPDATE`;
        locked();
        await gate;
      });

      await holding;

      const confirm = transition(TENANT_A, hold.id, "confirm");

      // Let the hold elapse WHILE the confirm waits for the row.
      await new Promise((resolve) => setTimeout(resolve, 2000));
      release();
      await holder;

      expect(await confirm).toMatchObject({
        outcome: "refused",
        code: "HOLD_EXPIRED"
      });
    });

    test("a hold refused by the cap leaves no reservation, allocation, history, audit or outbox row", async () => {
      const tenantId = "b9410000-0000-4000-8000-0000000000c3";

      await seedTenant(tenantId, "resv-c3");
      await getAdminSql()`
        INSERT INTO awcms_booking_settings (tenant_id, max_active_holds_per_tenant)
        VALUES (${tenantId}, 1)
      `;

      const fixture = await newFixture(tenantId, { capacity: 3 });

      expect((await create(tenantId, claim(fixture))).outcome).toBe("ok");

      const before = await writeCounts(tenantId);
      const allocations = async () =>
        (
          (await getAdminSql()`
          SELECT count(*)::int AS n FROM awcms_booking_resource_allocations
          WHERE tenant_id = ${tenantId}
        `) as { n: number }[]
        )[0]!.n;
      const allocBefore = await allocations();

      expect(await create(tenantId, claim(fixture))).toMatchObject({
        outcome: "refused",
        code: "HOLD_LIMIT_EXCEEDED"
      });
      expect(await writeCounts(tenantId)).toEqual(before);
      expect(await allocations()).toBe(allocBefore);
    });

    test("F1: concurrent port holds with one key on a capacity-1 slot all answer ok with the same reservation", async () => {
      const fixture = await newFixture(TENANT_A, { capacity: 1 });
      const key = `hold-${crypto.randomUUID()}`;
      const outcomes = await race(
        Array.from(
          { length: 5 },
          () => () =>
            tenantTx(TENANT_A, (tx) =>
              bookingPort.hold(tx, {
                tenantId: TENANT_A,
                correlationId: crypto.randomUUID(),
                actorTenantUserId: ACTORS.get(TENANT_A)!,
                offeringId: fixture.offeringId,
                resourceId: fixture.resourceId,
                startsAt: new Date(START).toISOString(),
                partySize: 1,
                idempotencyKey: key
              })
            )
        )
      );

      for (const outcome of outcomes) {
        expect(outcome).toMatchObject({ ok: true });
      }
      expect(
        new Set(outcomes.map((o) => (o.ok ? o.reservationId : ""))).size
      ).toBe(1);
    });

    test("F6: a port cancel with free text as the reason is a VALIDATION_ERROR value and writes nothing", async () => {
      const fixture = await newFixture(TENANT_A);
      const reservation = await confirmed(TENANT_A, fixture);
      const before = await writeCounts(TENANT_A);
      const outcome = await tenantTx(TENANT_A, (tx) =>
        bookingPort.cancel(tx, {
          tenantId: TENANT_A,
          correlationId: crypto.randomUUID(),
          reservationId: reservation.id,
          reasonCode: "The guest phoned us at 9pm",
          actorTenantUserId: ACTORS.get(TENANT_A)!,
          idempotencyKey: `cancel-${crypto.randomUUID()}`
        })
      );

      expect(outcome).toEqual({ ok: false, reason: "VALIDATION_ERROR" });
      expect(await writeCounts(TENANT_A)).toEqual(before);
    });

    test("sql/209 catalog: the sweep is SECURITY DEFINER owned by the memberless role, and neither PUBLIC nor awcms_app may execute it", async () => {
      const rows = (await getAdminSql()`
        SELECT p.proname, p.prosecdef, pg_get_userbyid(p.proowner) AS owner,
               has_function_privilege('awcms_app', p.oid, 'EXECUTE') AS app_exec,
               has_function_privilege('awcms_worker', p.oid, 'EXECUTE') AS worker_exec,
               coalesce(p.proacl::text, '') AS acl
        FROM pg_proc p
        WHERE p.proname IN ('awcms_booking_expire_due_holds',
                            'awcms_booking_reservation_event_facts')
        ORDER BY p.proname
      `) as {
        proname: string;
        prosecdef: boolean;
        owner: string;
        app_exec: boolean;
        worker_exec: boolean;
        acl: string;
      }[];
      const sweep = rows.find(
        (r) => r.proname === "awcms_booking_expire_due_holds"
      )!;
      const facts = rows.find(
        (r) => r.proname === "awcms_booking_reservation_event_facts"
      )!;
      // An ACL entry with an empty grantee starts with "=": a grant to PUBLIC.
      const grantsPublic = (acl: string) =>
        acl
          .replace(/^\{|\}$/g, "")
          .split(",")
          .some((entry) => entry.replace(/"/g, "").startsWith("="));

      expect(sweep.prosecdef).toBe(true);
      expect(sweep.owner).toBe("awcms_booking_expiry");
      expect(sweep.app_exec).toBe(false);
      expect(sweep.worker_exec).toBe(true);
      expect(grantsPublic(sweep.acl)).toBe(false);

      // The facts function is SECURITY INVOKER; the application role and the
      // sweep's owner may execute it, the worker and PUBLIC may not.
      expect(facts.prosecdef).toBe(false);
      expect(facts.app_exec).toBe(true);
      expect(facts.worker_exec).toBe(false);
      expect(grantsPublic(facts.acl)).toBe(false);
      expect(facts.acl).toContain("awcms_booking_expiry=X");
    });
  });

  describe("tenant isolation", () => {
    test("another tenant's reservation cannot be read, moved or cancelled, and its data is not touched", async () => {
      const fixture = await newFixture(TENANT_B);
      const theirs = await confirmed(TENANT_B, fixture);

      expect(await getReservation_(TENANT_A, theirs.id)).toBeNull();
      expect(
        await reschedule(TENANT_A, theirs.id, {
          startsAtMs: START + HOUR,
          overridePolicy: false
        })
      ).toEqual({ outcome: "not_found" });
      expect(await transition(TENANT_A, theirs.id, "cancel")).toEqual({
        outcome: "not_found"
      });
      expect((await getReservation_(TENANT_B, theirs.id))?.status).toBe(
        "confirmed"
      );
    });
  });
});

async function getReservation_(tenantId: string, id: string) {
  return tenantTx(tenantId, (tx) => getReservation(tx, tenantId, id));
}
