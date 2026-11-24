/**
 * Synthetic data for the backup-restore drill (Issue #968). No real person,
 * tenant or business data: every name is `drill-*`, every address `@example.com`.
 *
 * EVERY row is written through the module that owns its table, never by a
 * second writer in this file (`modules:table-writes:check`): the tenant and its
 * owner by `createTenantWithOwner` (the real provisioning path), employees'
 * profiles by `createParty`, resources, offerings and schedules by the booking
 * admin functions, employments and attendance events by the hr_workforce
 * directories, reservations by the booking reservation service. Inputs go
 * through the same validators the API routes use, so a drill seed cannot drift
 * from the contract. The runtime role `awcms_app` writes them, so triggers,
 * audit rows and domain events are the ones production produces and the
 * post-restore reconciliation has something true to prove.
 */
import { createOffering } from "../../src/modules/booking/application/booking-offering-admin";
import { createResource } from "../../src/modules/booking/application/booking-resource-admin";
import { createSchedule } from "../../src/modules/booking/application/booking-schedule-directory";
import {
  validateCreateOffering,
  validateCreateResource
} from "../../src/modules/booking/domain/booking-admin-validation";
import { validateCreateSchedule } from "../../src/modules/booking/domain/booking-validation";
import { NO_OP_STAFF_AVAILABILITY } from "../../src/modules/booking/domain/booking-staff-availability";
import { recordEvent } from "../../src/modules/hr-workforce/application/hr-attendance-directory";
import { createEmployment } from "../../src/modules/hr-workforce/application/hr-workforce-directory";
import { validateCreateAttendanceEvent } from "../../src/modules/hr-workforce/domain/hr-attendance-validation";
import { validateCreateEmployment } from "../../src/modules/hr-workforce/domain/hr-workforce-validation";
import { createParty } from "../../src/modules/profile-identity/application/party-directory";
import { createTenantWithOwner } from "../../src/modules/tenant-admin/application/platform-bootstrap";
import {
  createReservation,
  rescheduleReservation,
  transitionReservation
} from "../../src/modules/booking/application/booking-reservation-service";
import type { PlaceHoldInput } from "../../src/modules/booking/domain/booking-allocation";

type Sql = Bun.SQL;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type SeedVolume = {
  /** Slot reservations per tenant (the stay and attendance volumes scale from it). */
  reservationsPerTenant: number;
  employeesPerTenant: number;
  attendanceDays: number;
};

export const DEFAULT_VOLUME: SeedVolume = {
  reservationsPerTenant: 40,
  employeesPerTenant: 6,
  attendanceDays: 5
};

export type TenantFixture = {
  tenantId: string;
  actorId: string;
  slot: { resourceId: string; offeringId: string };
  stay: { resourceId: string; offeringId: string };
  employmentIds: string[];
};

export type SeededDrill = {
  tenants: TenantFixture[];
  reservations: number;
  attendanceEvents: number;
};

function dateAfter(days: number): string {
  return new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
}

/** A whole hour three days out: inside any lead time and horizon, on every step grid. */
function slotStart(): number {
  return Math.ceil((Date.now() + 3 * DAY) / HOUR) * HOUR;
}

function tenantTx<T>(
  app: Sql,
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return app.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL app.current_tenant_id = '${tenantId}'`);

    return fn(tx);
  }) as Promise<T>;
}

function must<T>(
  result: { valid: true; value: T } | { valid: false; errors: unknown },
  what: string
): T {
  if (!result.valid) {
    throw new Error(
      `drill seed: ${what} did not validate: ${JSON.stringify(result.errors)}`
    );
  }

  return result.value;
}

function accepted(outcome: { outcome: string }, what: string): void {
  if (outcome.outcome !== "ok") {
    throw new Error(
      `drill seed: ${what} was refused: ${JSON.stringify(outcome)}`
    );
  }
}

async function seedStructure(
  admin: Sql,
  app: Sql,
  tag: string
): Promise<Omit<TenantFixture, "employmentIds">> {
  const created = (await admin.begin((tx) =>
    createTenantWithOwner(
      tx as unknown as Sql,
      {
        tenantCode: `drill-${tag}`,
        tenantName: `Drill ${tag}`,
        officeCode: "HQ",
        officeName: `Drill HQ ${tag}`,
        ownerLoginIdentifier: `drill-${tag}@example.com`,
        // A throwaway: this database is created for the drill and dropped after it.
        ownerPassword: `drill-owner-${crypto.randomUUID()}`,
        ownerDisplayName: `Drill owner ${tag}`
      },
      { grantPlatformScope: false }
    )
  )) as Awaited<ReturnType<typeof createTenantWithOwner>>;
  const tenantId = created.tenantId;
  const actor = { actorTenantUserId: created.ownerTenantUserId };
  const day = [{ from: "00:00", to: "24:00" }];

  return tenantTx(app, tenantId, async (tx) => {
    const sql = tx as unknown as Sql;
    const slotResource = await createResource(
      sql,
      tenantId,
      actor,
      must(
        validateCreateResource({
          code: "drill-slot",
          name: "Drill court",
          kind: "court",
          capacity: 3,
          timezone: "Asia/Pontianak",
          bookingMode: "slot"
        }),
        "the slot resource"
      )
    );
    const stayResource = await createResource(
      sql,
      tenantId,
      actor,
      must(
        validateCreateResource({
          code: "drill-stay",
          name: "Drill room",
          kind: "room",
          capacity: 2,
          timezone: "Asia/Pontianak",
          bookingMode: "stay",
          stayCheckInTime: "14:00",
          stayCheckOutTime: "12:00"
        }),
        "the stay resource"
      )
    );

    accepted(slotResource, "the slot resource");
    accepted(stayResource, "the stay resource");

    const slotId = (slotResource as { resource: { id: string } }).resource.id;
    const stayId = (stayResource as { resource: { id: string } }).resource.id;

    accepted(
      await createSchedule(
        sql,
        tenantId,
        actor,
        must(
          validateCreateSchedule({
            resourceId: slotId,
            timezone: "Asia/Pontianak",
            effectiveFrom: "2020-01-01",
            rules: {
              weekly: {
                mon: day,
                tue: day,
                wed: day,
                thu: day,
                fri: day,
                sat: day,
                sun: day
              }
            }
          }),
          "the schedule"
        )
      ),
      "the schedule"
    );

    const slotOffering = await createOffering(
      sql,
      tenantId,
      actor,
      must(
        validateCreateOffering({
          code: "drill-hour",
          name: "Hour",
          granularity: "time",
          durationSeconds: 3600,
          setupSeconds: 0,
          cleanupSeconds: 0,
          slotStepSeconds: 900,
          maxParty: 4,
          confirmationMode: "hold_then_confirm"
        }),
        "the slot offering"
      )
    );
    const stayOffering = await createOffering(
      sql,
      tenantId,
      actor,
      must(
        validateCreateOffering({
          code: "drill-night",
          name: "Night",
          granularity: "stay",
          minNights: 1,
          maxNights: 30,
          maxParty: 4,
          confirmationMode: "hold_then_confirm"
        }),
        "the stay offering"
      )
    );

    accepted(slotOffering, "the slot offering");
    accepted(stayOffering, "the stay offering");

    return {
      tenantId,
      actorId: created.ownerTenantUserId,
      slot: {
        resourceId: slotId,
        offeringId: (slotOffering as { offering: { id: string } }).offering.id
      },
      stay: {
        resourceId: stayId,
        offeringId: (stayOffering as { offering: { id: string } }).offering.id
      }
    };
  });
}

function ctxOf(fixture: TenantFixture) {
  return {
    tenantId: fixture.tenantId,
    staff: NO_OP_STAFF_AVAILABILITY,
    actorTenantUserId: fixture.actorId,
    correlationId: crypto.randomUUID()
  };
}

async function hold(
  app: Sql,
  fixture: TenantFixture,
  claim: PlaceHoldInput
): Promise<string> {
  const outcome = await tenantTx(app, fixture.tenantId, (tx) =>
    createReservation(
      tx,
      ctxOf(fixture),
      { claim, overridePolicy: false },
      false
    )
  );

  if (outcome.outcome !== "ok") {
    throw new Error(
      `drill seed: a hold was refused: ${JSON.stringify(outcome)}`
    );
  }

  return outcome.reservation.id;
}

async function transition(
  app: Sql,
  fixture: TenantFixture,
  reservationId: string,
  action: "confirm" | "cancel"
): Promise<void> {
  const outcome = await tenantTx(app, fixture.tenantId, (tx) =>
    transitionReservation(tx, ctxOf(fixture), reservationId, action, {
      reasonCode: action === "cancel" ? "customer_request" : undefined
    })
  );

  if (outcome.outcome !== "ok") {
    throw new Error(
      `drill seed: ${action} was refused: ${JSON.stringify(outcome)}`
    );
  }
}

function slotClaim(fixture: TenantFixture, startsAtMs: number): PlaceHoldInput {
  return {
    offeringId: fixture.slot.offeringId,
    resourceId: fixture.slot.resourceId,
    startsAtMs,
    partySize: 1,
    quantity: 1
  };
}

/** Holds, confirmations, cancellations, reschedules and stays: every state the reconciliation reads. */
async function seedReservations(
  app: Sql,
  fixture: TenantFixture,
  count: number
): Promise<number> {
  const start = slotStart();
  let written = 0;

  for (let index = 0; index < count; index += 1) {
    const at = start + index * HOUR;
    const id = await hold(app, fixture, slotClaim(fixture, at));

    written += 1;

    if (index % 4 === 0) {
      await transition(app, fixture, id, "confirm");
    } else if (index % 4 === 2) {
      await transition(app, fixture, id, "confirm");
      await transition(app, fixture, id, "cancel");
    } else if (index % 4 === 3) {
      await transition(app, fixture, id, "confirm");
      const moved = await tenantTx(app, fixture.tenantId, (tx) =>
        rescheduleReservation(
          tx,
          ctxOf(fixture),
          id,
          { startsAtMs: start + (count + index) * HOUR, overridePolicy: false },
          false
        )
      );

      if (moved.outcome !== "ok") {
        throw new Error(
          `drill seed: a reschedule was refused: ${JSON.stringify(moved)}`
        );
      }

      written += 1;
    }
  }

  for (let stay = 0; stay < Math.max(2, Math.floor(count / 10)); stay += 1) {
    const id = await hold(app, fixture, {
      offeringId: fixture.stay.offeringId,
      resourceId: fixture.stay.resourceId,
      stay: {
        checkInDate: dateAfter(10 + stay * 3),
        checkOutDate: dateAfter(12 + stay * 3)
      },
      partySize: 2,
      quantity: 1
    });

    written += 1;

    if (stay % 2 === 0) {
      await transition(app, fixture, id, "confirm");
    }
  }

  return written;
}

async function seedAttendance(
  app: Sql,
  fixture: TenantFixture,
  volume: SeedVolume,
  tag: string
): Promise<{ employmentIds: string[]; events: number }> {
  const employmentIds: string[] = [];
  const actor = {
    actorTenantUserId: fixture.actorId,
    correlationId: undefined
  };
  let events = 0;

  for (let employee = 0; employee < volume.employeesPerTenant; employee += 1) {
    const employmentId = await tenantTx(app, fixture.tenantId, async (tx) => {
      const profile = await createParty(
        tx as unknown as Sql,
        fixture.tenantId,
        fixture.actorId,
        {
          profileType: "person",
          displayName: `Drill employee ${tag}-${employee}`,
          legalName: null,
          riskLevel: "normal"
        }
      );
      const employment = await createEmployment(
        tx as unknown as Sql,
        fixture.tenantId,
        actor,
        must(
          validateCreateEmployment({
            profileId: profile.id,
            employeeNo: `DRILL-${tag}-${employee}`,
            hiredOn: "2026-01-01",
            employmentType: "permanent",
            status: "active"
          }),
          "the employment"
        )
      );

      if (employment.outcome !== "ok") {
        throw new Error(
          `drill seed: an employment was refused: ${JSON.stringify(employment)}`
        );
      }

      return employment.employment.id;
    });

    employmentIds.push(employmentId);

    // A kiosk source accepts back-dated events (flagged late past the skew
    // window, refused only past seven days), so a few days of history can be
    // written.
    for (let day = 1; day <= volume.attendanceDays; day += 1) {
      for (const [kind, hoursAgo] of [
        ["clock_in", 9],
        ["clock_out", 1]
      ] as const) {
        await recordAttendance(app, fixture, actor, {
          employmentId,
          kind,
          occurredAt: new Date(Date.now() - day * DAY - hoursAgo * HOUR),
          key: `drill-${tag}-${employee}-${day}-${kind}`
        });
        events += 1;
      }
    }
  }

  return { employmentIds, events };
}

async function recordAttendance(
  app: Sql,
  fixture: TenantFixture,
  actor: { actorTenantUserId: string; correlationId: undefined },
  event: { employmentId: string; kind: string; occurredAt: Date; key: string }
): Promise<void> {
  const input = must(
    validateCreateAttendanceEvent({
      employmentId: event.employmentId,
      kind: event.kind,
      occurredAt: event.occurredAt.toISOString(),
      source: "kiosk",
      clientEventKey: event.key
    }),
    "an attendance event"
  );
  const outcome = await tenantTx(app, fixture.tenantId, (tx) =>
    recordEvent(tx, fixture.tenantId, actor, input)
  );

  if (outcome.outcome !== "ok") {
    throw new Error(
      `drill seed: an attendance event was refused: ${JSON.stringify(outcome)}`
    );
  }
}

export async function seedDrillData(
  admin: Sql,
  app: Sql,
  volume: SeedVolume = DEFAULT_VOLUME
): Promise<SeededDrill> {
  const tenants: TenantFixture[] = [];
  let reservations = 0;
  let attendanceEvents = 0;

  for (const tag of ["a", "b"]) {
    const structure = await seedStructure(admin, app, tag);
    const fixture: TenantFixture = { ...structure, employmentIds: [] };

    reservations += await seedReservations(
      app,
      fixture,
      volume.reservationsPerTenant
    );

    const attendance = await seedAttendance(app, fixture, volume, tag);

    fixture.employmentIds = attendance.employmentIds;
    attendanceEvents += attendance.events;
    tenants.push(fixture);
  }

  return { tenants, reservations, attendanceEvents };
}

/**
 * Writes made AFTER the dump's snapshot was taken. The drill proves they are
 * absent from the restore: that is what "the same point in time" means.
 */
export async function writeAfterSnapshot(
  app: Sql,
  fixture: TenantFixture,
  count: number
): Promise<{ reservationIds: string[]; attendanceEvents: number }> {
  // Past every seeded slot, so a claim never collides with the seed.
  const base = slotStart() + 400 * HOUR;
  const reservationIds: string[] = [];

  for (let index = 0; index < count; index += 1) {
    reservationIds.push(
      await hold(app, fixture, slotClaim(fixture, base + index * HOUR))
    );
  }

  await recordAttendance(
    app,
    fixture,
    { actorTenantUserId: fixture.actorId, correlationId: undefined },
    {
      employmentId: fixture.employmentIds[0]!,
      kind: "clock_in",
      occurredAt: new Date(Date.now() - 60_000),
      key: `drill-post-snapshot-${crypto.randomUUID()}`
    }
  );

  return { reservationIds, attendanceEvents: 1 };
}

/** Counts per tenant as the runtime role sees them (the isolation witness). */
export async function countWitness(
  app: Sql,
  tenants: TenantFixture[]
): Promise<
  { tenantId: string; reservations: number; attendanceEvents: number }[]
> {
  const witness: {
    tenantId: string;
    reservations: number;
    attendanceEvents: number;
  }[] = [];

  for (const tenant of tenants) {
    witness.push(
      await tenantTx(app, tenant.tenantId, async (tx) => {
        const reservations = (await tx`
          SELECT count(*)::int AS n FROM awcms_booking_reservations
        `) as { n: number }[];
        const attendance = (await tx`
          SELECT count(*)::int AS n FROM awcms_hr_attendance_events
        `) as { n: number }[];

        return {
          tenantId: tenant.tenantId,
          reservations: reservations[0]!.n,
          attendanceEvents: attendance[0]!.n
        };
      })
    );
  }

  return witness;
}
