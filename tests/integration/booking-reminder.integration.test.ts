/**
 * Booking reminder and confirmation intents against a real PostgreSQL (Issue
 * #943, ADR-0131, ADR-0133 sections 3 and 8; docs/awcms/booking.md section 7.5).
 *
 * The dispatch pass runs as `awcms_worker` (the role the cron job uses), with
 * FORCE RLS in force, through the real `WhatsappDeliveryPort` adapter into the
 * real `awcms_whatsapp_messages` queue. What this proves that a mock cannot:
 *
 *   * a confirmation / reminder is queued ONCE per (reservation, kind,
 *     occurrence): re-running, running two workers at once, and a crash between
 *     the enqueue and the settle all leave exactly one queue row;
 *   * a cancelled reservation emits none, and a cancel AFTER the enqueue cancels
 *     the still-queued message;
 *   * consent is the delivery module's, independent of booking: a transactional
 *     message needs no marketing opt-in and survives a marketing withdrawal, an
 *     opt-out stops it, and neither touches the reservation;
 *   * booking stores no contact: the intent row carries no phone number, and
 *     the worker holds no privilege on the reservation tables;
 *   * one bad intent (the resolver throws) does not stop the others, and a
 *     transient refusal (capability disabled) leaves the intent pending.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
 */
import { NO_OP_STAFF_AVAILABILITY } from "../../src/modules/booking/domain/booking-staff-availability";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  assertRejected,
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
import {
  runBookingReminderPass,
  type BookingReminderDeps
} from "../../src/modules/booking/application/booking-reminder-dispatch";
import { runBookingReminderDispatch } from "../../src/modules/booking/application/booking-reminder-job";
import {
  createReservation,
  transitionReservation
} from "../../src/modules/booking/application/booking-reservation-service";
import type { PlaceHoldInput } from "../../src/modules/booking/domain/booking-allocation";
import { reminderIdempotencyKey } from "../../src/modules/booking/domain/booking-reminder";
import { registerBookingWhatsappTemplates } from "../../src/modules/booking/infrastructure/booking-whatsapp-templates";
import type { BookingReminderRecipientPort } from "../../src/modules/_shared/ports/booking-reminder-recipient-port";
import type { WhatsappDeliveryPort } from "../../src/modules/_shared/ports/whatsapp-delivery-port";
import { createSuppression } from "../../src/modules/whatsapp-delivery/application/whatsapp-consent-directory";
import {
  cancelWhatsappByCorrelation,
  enqueueWhatsappMessage,
  getWhatsappStatusByCorrelation
} from "../../src/modules/whatsapp-delivery/application/whatsapp-enqueue";

const TENANT_A = "b9430000-0000-4000-8000-00000000000a";
const TENANT_B = "b9430000-0000-4000-8000-00000000000b";
const ACTORS = new Map<string, string>();
const HOUR = 3_600_000;
const PHONE = "+6281234567890";
const PHONE_DIGITS = "81234567890";

const KEY = Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 251)
).toString("base64");
const ENABLED = {
  WHATSAPP_ENABLED: "true",
  WHATSAPP_PROVIDER: "log",
  WHATSAPP_RECIPIENT_HASH_KEYS: `k1:${KEY}`
} as NodeJS.ProcessEnv;
const DISABLED = {
  WHATSAPP_RECIPIENT_HASH_KEYS: `k1:${KEY}`
} as NodeJS.ProcessEnv;

// The consent / suppression functions read the key ring from the process env.
process.env.WHATSAPP_RECIPIENT_HASH_KEYS = `k1:${KEY}`;

registerBookingWhatsappTemplates();

let env: NodeJS.ProcessEnv = ENABLED;
let phoneSequence = 0;

/** A number the delivery module has not seen this hour (it rate-limits per recipient). */
const freshPhone = () =>
  `+62813${String((phoneSequence += 1)).padStart(8, "0")}`;
let pool: Bun.SQL;
let sequence = 0;

/** The real delivery port adapter, with the environment under the test's control. */
const whatsapp: WhatsappDeliveryPort = {
  enqueue: (tx, input) => enqueueWhatsappMessage(tx, input, { env }),
  getStatusByCorrelation: getWhatsappStatusByCorrelation,
  cancelByCorrelation: cancelWhatsappByCorrelation
};

/** Resolves every customer ref to the same phone, and records what it was asked. */
function resolverTo(
  phone: string | null,
  asked: string[] = []
): BookingReminderRecipientPort {
  return {
    async resolve(_tx, input) {
      asked.push(input.customerRef);

      return phone === null ? null : { kind: "address", phone };
    }
  };
}

function deps(recipients: BookingReminderRecipientPort): BookingReminderDeps {
  return { whatsapp, recipients };
}

const workerPass = (tenantId: string, d: BookingReminderDeps) =>
  withTenantOrThrow(getWorkerRoleSql(), tenantId, (tx) =>
    runBookingReminderPass(tx, tenantId, d)
  );

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
    actorTenantUserId: ACTORS.get(tenantId)!,
    correlationId: crypto.randomUUID()
  };
}

async function seedTenant(tenantId: string, code: string): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${tenantId}, ${code}, ${`Reminder ${code}`})
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

async function newFixture(tenantId: string): Promise<Fixture> {
  const admin = getAdminSql();
  sequence += 1;
  const code = `rm${sequence}`;
  const resource = (await admin`
    INSERT INTO awcms_booking_resources
      (tenant_id, code, name, kind, capacity, timezone, booking_mode)
    VALUES (${tenantId}, ${code}, ${`Room ${code}`}, 'room', 1, 'Asia/Pontianak', 'slot')
    RETURNING id
  `) as { id: string }[];

  await admin`
    INSERT INTO awcms_booking_resource_units (tenant_id, resource_id, ordinal)
    VALUES (${tenantId}, ${resource[0]!.id}, 1)
  `;

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
       cleanup_seconds, slot_step_seconds, max_party, confirmation_mode)
    VALUES (${tenantId}, ${`hour-${code}`}, 'Hour', 'time', 3600, 0, 0, 900, 4,
            'hold_then_confirm')
    RETURNING id
  `) as { id: string }[];

  return { resourceId: resource[0]!.id, offeringId: offering[0]!.id };
}

/** A whole hour at least `hours` from now. Every reservation has its own resource, so starts never collide. */
function startIn(hours: number): number {
  return Math.ceil((Date.now() + hours * HOUR) / HOUR) * HOUR;
}

/** A confirmed reservation starting in `hours`, for customer `ref` (null = walk-in). */
async function confirmedReservation(
  tenantId: string,
  options: { hours: number; ref: string | null }
): Promise<{ id: string; reservationNo: string }> {
  const fixture = await newFixture(tenantId);
  const claim: PlaceHoldInput = {
    offeringId: fixture.offeringId,
    resourceId: fixture.resourceId,
    startsAtMs: startIn(options.hours),
    partySize: 1,
    quantity: 1,
    ...(options.ref ? { externalCustomerRef: options.ref } : {})
  };
  const created = await tenantTx(tenantId, (tx) =>
    createReservation(
      tx,
      ctxOf(tenantId),
      { claim, overridePolicy: false },
      false
    )
  );

  if (created.outcome !== "ok") {
    throw new Error(`expected a reservation, got ${JSON.stringify(created)}`);
  }

  const confirmed = await tenantTx(tenantId, (tx) =>
    transitionReservation(
      tx,
      ctxOf(tenantId),
      created.reservation.id,
      "confirm",
      {}
    )
  );

  if (confirmed.outcome !== "ok") {
    throw new Error(`expected a confirm, got ${JSON.stringify(confirmed)}`);
  }

  return {
    id: created.reservation.id,
    reservationNo: created.reservation.reservationNo
  };
}

async function cancel(tenantId: string, reservationId: string): Promise<void> {
  const outcome = await tenantTx(tenantId, (tx) =>
    transitionReservation(tx, ctxOf(tenantId), reservationId, "cancel", {
      reasonCode: "customer_request"
    })
  );

  if (outcome.outcome !== "ok") {
    throw new Error(`expected a cancel, got ${JSON.stringify(outcome)}`);
  }
}

/** Test-only: pretend the reservation was confirmed `interval` ago (the update guard forbids it otherwise). */
async function confirmedAgo(
  reservationId: string,
  interval: string
): Promise<void> {
  await getAdminSql().begin(async (tx) => {
    await tx.unsafe(
      "ALTER TABLE awcms_booking_reservations DISABLE TRIGGER awcms_booking_reservations_update_guard"
    );
    await tx.unsafe(
      `UPDATE awcms_booking_reservations SET status_changed_at = now() - interval '${interval}' WHERE id = '${reservationId}'`
    );
    await tx.unsafe(
      "ALTER TABLE awcms_booking_reservations ENABLE TRIGGER awcms_booking_reservations_update_guard"
    );
  });
}

type IntentRow = {
  kind: string;
  occurrence: number;
  status: string;
  outcome_code: string | null;
  message_id: string | null;
  attempts: number;
};

async function intentsOf(reservationId: string): Promise<IntentRow[]> {
  return (await getAdminSql()`
    SELECT kind, occurrence, status, outcome_code, message_id, attempts
    FROM awcms_booking_reminder_intents
    WHERE reservation_id = ${reservationId}
    ORDER BY kind
  `) as IntentRow[];
}

type MessageRow = {
  template_key: string;
  status: string;
  body: string;
  purpose: string;
  correlation_id: string | null;
};

async function messagesOf(reservationId: string): Promise<MessageRow[]> {
  return (await getAdminSql()`
    SELECT template_key, status, body, purpose, correlation_id
    FROM awcms_whatsapp_messages
    WHERE correlation_id LIKE ${`booking:${reservationId}:%`}
    ORDER BY template_key
  `) as MessageRow[];
}

const confirmationKey = (reservationId: string) =>
  reminderIdempotencyKey({
    reservationId,
    kind: "confirmation",
    occurrence: 0
  });

const suite = integrationEnabled ? describe : describe.skip;

suite("booking reminder intents (Issue #943, ADR-0131, ADR-0133)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
    await resetDatabase();
    pool = createRuntimePool(12);
    await seedTenant(TENANT_A, "rem-a");
    await seedTenant(TENANT_B, "rem-b");
  });

  afterAll(async () => {
    await pool?.close({ timeout: 1 });
    await teardownIntegrationDatabase();
  });

  describe("the confirmation", () => {
    test("is queued once for a confirmed reservation, through the port, with no contact in booking", async () => {
      env = ENABLED;
      const asked: string[] = [];
      const reservation = await confirmedReservation(TENANT_A, {
        hours: 30,
        ref: "cust-1"
      });
      const result = await workerPass(TENANT_A, deps(resolverTo(PHONE, asked)));

      expect(result.enqueued).toBe(1);
      expect(asked).toEqual(["cust-1"]);

      const intents = await intentsOf(reservation.id);
      const confirmation = intents.find((row) => row.kind === "confirmation")!;

      expect(confirmation.status).toBe("enqueued");
      expect(confirmation.message_id).not.toBeNull();

      const messages = await messagesOf(reservation.id);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        template_key: "booking.confirmation",
        status: "queued",
        purpose: "transactional",
        correlation_id: confirmationKey(reservation.id)
      });
      // The body carries the reservation number and a local start, nothing else.
      expect(messages[0]!.body).toContain(reservation.reservationNo);
      expect(messages[0]!.body).toContain("Asia/Pontianak");

      // Booking's own table holds no phone number, in any column.
      const dump = JSON.stringify(
        await getAdminSql()`SELECT * FROM awcms_booking_reminder_intents`
      );

      expect(dump).not.toContain(PHONE_DIGITS);
      expect(dump).not.toContain("cust-1");
    });

    test("is idempotent: another pass, and two workers at once, leave one queue row", async () => {
      env = ENABLED;
      const reservation = await confirmedReservation(TENANT_A, {
        hours: 31,
        ref: "cust-2"
      });
      const d = deps(resolverTo(PHONE));

      await Promise.all([workerPass(TENANT_A, d), workerPass(TENANT_A, d)]);
      await workerPass(TENANT_A, d);
      await workerPass(TENANT_A, d);

      expect(await messagesOf(reservation.id)).toHaveLength(1);
      expect(
        (await intentsOf(reservation.id)).filter(
          (row) => row.status === "enqueued"
        )
      ).toHaveLength(1);
    });

    test("a crash between the enqueue and the settle replays as a duplicate, not a second message", async () => {
      env = ENABLED;
      const reservation = await confirmedReservation(TENANT_A, {
        hours: 32,
        ref: "cust-3"
      });

      // The message is already in the queue under the intent's key, but the
      // intent is still pending: the state a crashed pass leaves behind.
      await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        enqueueWhatsappMessage(
          tx,
          {
            tenantId: TENANT_A,
            templateKey: "booking.confirmation",
            variables: {
              reservationNo: reservation.reservationNo,
              startsAt: "x"
            },
            recipient: { kind: "address", phone: PHONE },
            idempotencyKey: confirmationKey(reservation.id),
            correlationId: confirmationKey(reservation.id)
          },
          { env }
        )
      );
      await workerPass(TENANT_A, deps(resolverTo(PHONE)));

      expect(await messagesOf(reservation.id)).toHaveLength(1);

      const confirmation = (await intentsOf(reservation.id)).find(
        (row) => row.kind === "confirmation"
      )!;

      expect(confirmation).toMatchObject({
        status: "enqueued",
        outcome_code: "duplicate"
      });
    });

    test("a reservation confirmed long ago is owed none (switching the feature on does not flood the back catalogue)", async () => {
      env = ENABLED;
      const reservation = await confirmedReservation(TENANT_A, {
        hours: 60,
        ref: "cust-4"
      });

      await confirmedAgo(reservation.id, "3 days");
      await workerPass(TENANT_A, deps(resolverTo(PHONE)));

      expect(await intentsOf(reservation.id)).toEqual([]);
      expect(await messagesOf(reservation.id)).toEqual([]);
    });
  });

  describe("the reminder", () => {
    test("is queued once the lead window has opened, for a reservation booked before it", async () => {
      env = ENABLED;
      const reservation = await confirmedReservation(TENANT_A, {
        hours: 12,
        ref: "cust-5"
      });

      // Confirmed two days ago, starting in 12 hours: the 24h window is open.
      await confirmedAgo(reservation.id, "2 days");
      await workerPass(TENANT_A, deps(resolverTo(PHONE)));
      await workerPass(TENANT_A, deps(resolverTo(PHONE)));

      const intents = await intentsOf(reservation.id);

      // Confirmed two days ago is also outside the confirmation's freshness.
      expect(intents.map((row) => [row.kind, row.status])).toEqual([
        ["reminder", "enqueued"]
      ]);

      const messages = await messagesOf(reservation.id);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        template_key: "booking.reminder",
        purpose: "transactional"
      });
    });

    test("a booking made inside the lead window gets the confirmation and no reminder", async () => {
      env = ENABLED;
      const reservation = await confirmedReservation(TENANT_A, {
        hours: 10,
        ref: "cust-6"
      });

      await workerPass(TENANT_A, deps(resolverTo(PHONE)));

      const byKind = Object.fromEntries(
        (await intentsOf(reservation.id)).map((row) => [row.kind, row])
      );

      expect(byKind.confirmation!.status).toBe("enqueued");
      expect(byKind.reminder).toMatchObject({
        status: "skipped",
        outcome_code: "booked_inside_lead"
      });
      expect(await messagesOf(reservation.id)).toHaveLength(1);
    });
  });

  describe("a cancelled reservation emits none", () => {
    test("cancelled before the pass: no intent, no message", async () => {
      env = ENABLED;
      const reservation = await confirmedReservation(TENANT_A, {
        hours: 33,
        ref: "cust-7"
      });

      await cancel(TENANT_A, reservation.id);
      await workerPass(TENANT_A, deps(resolverTo(PHONE)));

      expect(await intentsOf(reservation.id)).toEqual([]);
      expect(await messagesOf(reservation.id)).toEqual([]);
    });

    test("cancelled after the enqueue: the still-queued message is cancelled with it", async () => {
      env = ENABLED;
      const reservation = await confirmedReservation(TENANT_A, {
        hours: 34,
        ref: "cust-8"
      });

      await workerPass(TENANT_A, deps(resolverTo(PHONE)));
      expect((await messagesOf(reservation.id))[0]!.status).toBe("queued");

      await cancel(TENANT_A, reservation.id);
      const result = await workerPass(TENANT_A, deps(resolverTo(PHONE)));

      expect(result.cancelled).toBe(1);
      expect((await messagesOf(reservation.id))[0]!.status).toBe("cancelled");
      expect((await intentsOf(reservation.id))[0]).toMatchObject({
        status: "cancelled",
        outcome_code: "reservation_cancelled"
      });
    });

    test("a pending intent whose reservation is cancelled is settled cancelled and never sent", async () => {
      env = DISABLED;
      const reservation = await confirmedReservation(TENANT_A, {
        hours: 35,
        ref: "cust-9"
      });

      // The capability is off: the intent waits.
      await workerPass(TENANT_A, deps(resolverTo(PHONE)));
      expect((await intentsOf(reservation.id))[0]!.status).toBe("pending");

      await cancel(TENANT_A, reservation.id);
      env = ENABLED;
      await workerPass(TENANT_A, deps(resolverTo(PHONE)));

      expect((await intentsOf(reservation.id))[0]).toMatchObject({
        status: "cancelled",
        outcome_code: "reservation_cancelled"
      });
      expect(await messagesOf(reservation.id)).toEqual([]);
    });
  });

  describe("consent is the delivery module's, independent of booking", () => {
    test("a transactional confirmation needs no marketing opt-in", async () => {
      env = ENABLED;
      const reservation = await confirmedReservation(TENANT_A, {
        hours: 36,
        ref: "cust-10"
      });
      const rows = (await getAdminSql()`
        SELECT count(*)::int AS n FROM awcms_whatsapp_consents
        WHERE tenant_id = ${TENANT_A}
      `) as { n: number }[];

      expect(rows[0]!.n).toBe(0);

      await workerPass(TENANT_A, deps(resolverTo(PHONE)));

      expect((await intentsOf(reservation.id))[0]!.status).toBe("enqueued");
    });

    test("an opted-out number is suppressed by the delivery module; the reservation is untouched", async () => {
      env = ENABLED;
      const optedOut = "+6281999000111";

      await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        createSuppression(tx, TENANT_A, null, {
          phone: optedOut,
          reason: "stop_reply"
        })
      );

      const reservation = await confirmedReservation(TENANT_A, {
        hours: 37,
        ref: "cust-11"
      });

      await workerPass(TENANT_A, deps(resolverTo(optedOut)));

      expect((await intentsOf(reservation.id))[0]).toMatchObject({
        status: "suppressed",
        outcome_code: "opt_out"
      });
      expect(await messagesOf(reservation.id)).toEqual([]);

      const status = await getAdminSql()`
        SELECT status FROM awcms_booking_reservations WHERE id = ${reservation.id}
      `;

      expect(status[0].status).toBe("confirmed");
    });
  });

  describe("walk-ins, unresolved recipients and failures", () => {
    test("a walk-in (no customer reference) is skipped at creation and never reaches the resolver", async () => {
      env = ENABLED;
      const asked: string[] = [];
      const reservation = await confirmedReservation(TENANT_A, {
        hours: 38,
        ref: null
      });

      await workerPass(TENANT_A, deps(resolverTo(PHONE, asked)));

      expect(asked).toEqual([]);
      expect((await intentsOf(reservation.id))[0]).toMatchObject({
        status: "skipped",
        outcome_code: "no_customer_ref"
      });
    });

    test("a resolver that cannot address the customer settles the intent skipped", async () => {
      env = ENABLED;
      const reservation = await confirmedReservation(TENANT_A, {
        hours: 39,
        ref: "cust-12"
      });

      await workerPass(TENANT_A, deps(resolverTo(null)));

      expect((await intentsOf(reservation.id))[0]).toMatchObject({
        status: "skipped",
        outcome_code: "recipient_unresolved"
      });
    });

    test("a throwing resolver costs that intent one attempt and does not stop the others", async () => {
      env = ENABLED;
      const bad = await confirmedReservation(TENANT_B, {
        hours: 40,
        ref: "boom"
      });
      const good = await confirmedReservation(TENANT_B, {
        hours: 41,
        ref: "fine"
      });
      const resolver: BookingReminderRecipientPort = {
        async resolve(_tx, input) {
          if (input.customerRef === "boom") {
            throw new Error(`cannot look up ${PHONE}`);
          }

          return { kind: "address", phone: PHONE };
        }
      };

      await workerPass(TENANT_B, deps(resolver));

      expect((await intentsOf(bad.id))[0]).toMatchObject({
        status: "pending",
        attempts: 1,
        outcome_code: "dispatch_error"
      });
      expect((await intentsOf(good.id))[0]!.status).toBe("enqueued");

      // Settle the poisoned one so it does not hold up later passes of this tenant.
      await workerPass(TENANT_B, deps(resolverTo(null)));

      expect((await intentsOf(bad.id))[0]!.status).toBe("skipped");
    });

    test("a disabled capability leaves the intent pending, and it is sent once the capability is on", async () => {
      env = DISABLED;
      const reservation = await confirmedReservation(TENANT_B, {
        hours: 42,
        ref: "cust-13"
      });

      await workerPass(TENANT_B, deps(resolverTo(PHONE)));

      expect((await intentsOf(reservation.id))[0]).toMatchObject({
        status: "pending",
        outcome_code: "disabled"
      });
      expect(await messagesOf(reservation.id)).toEqual([]);

      env = ENABLED;
      await workerPass(TENANT_B, deps(resolverTo(PHONE)));

      expect((await intentsOf(reservation.id))[0]!.status).toBe("enqueued");
      expect(await messagesOf(reservation.id)).toHaveLength(1);
    });

    test("with no resolver registered the job is inert: nothing is created", async () => {
      env = ENABLED;
      const reservation = await confirmedReservation(TENANT_B, {
        hours: 43,
        ref: "cust-14"
      });
      const result = await runBookingReminderDispatch(
        getWorkerRoleSql(),
        {
          signal: new AbortController().signal,
          dryRun: false,
          correlationId: crypto.randomUUID()
        } as never,
        { whatsapp }
      );

      expect(result.inert).toBe(true);
      expect(await intentsOf(reservation.id)).toEqual([]);
    });
  });

  describe("least privilege and isolation", () => {
    test("the worker holds no privilege on the reservation tables and cannot delete or insert intents", async () => {
      const worker = getWorkerRoleSql();

      await assertRejected(
        worker.begin(async (tx) => {
          await tx.unsafe(`SET LOCAL app.current_tenant_id = '${TENANT_A}'`);
          return tx`SELECT external_customer_ref FROM awcms_booking_reservations`;
        }),
        "a worker read of the reservations"
      );
      await assertRejected(
        worker.begin(async (tx) => {
          await tx.unsafe(`SET LOCAL app.current_tenant_id = '${TENANT_A}'`);
          return tx`DELETE FROM awcms_booking_reminder_intents`;
        }),
        "a worker delete of intents"
      );
      await assertRejected(
        worker.begin(async (tx) => {
          await tx.unsafe(`SET LOCAL app.current_tenant_id = '${TENANT_A}'`);
          return tx`
            INSERT INTO awcms_booking_reminder_intents
              (tenant_id, reservation_id, kind, occurrence, due_at)
            VALUES (${TENANT_A}, gen_random_uuid(), 'reminder', 1, now())
          `;
        }),
        "a worker direct insert of an intent"
      );
    });

    test("the runtime role may read intents but not write or delete them", async () => {
      await assertRejected(
        tenantTx(
          TENANT_A,
          (tx) => tx`DELETE FROM awcms_booking_reminder_intents`
        ),
        "a runtime delete of intents"
      );
      await assertRejected(
        tenantTx(
          TENANT_A,
          (tx) =>
            tx`UPDATE awcms_booking_reminder_intents SET status = 'cancelled'`
        ),
        "a runtime update of intents"
      );
    });

    test("the functions refuse a tenant argument that is not the session tenant", async () => {
      await assertRejected(
        withTenantOrThrow(
          getWorkerRoleSql(),
          TENANT_A,
          (tx) =>
            tx`SELECT * FROM awcms_booking_reminders_due(${TENANT_B}::uuid, 10)`
        ),
        "a cross-tenant due read"
      );
    });

    test("a settled intent keeps its outcome (the update guard)", async () => {
      const reservation = await confirmedReservation(TENANT_A, {
        hours: 44,
        ref: "cust-15"
      });

      env = ENABLED;
      await workerPass(TENANT_A, deps(resolverTo(PHONE)));
      await assertRejected(
        getAdminSql()`
          UPDATE awcms_booking_reminder_intents SET status = 'pending', settled_at = NULL
          WHERE reservation_id = ${reservation.id} AND kind = 'confirmation'
        `,
        "re-opening a settled intent"
      );
    });
  });

  describe("review follow-ups (M1, M2, L1, L3, I2)", () => {
    async function messageOf(key: string) {
      const rows = (await getAdminSql()`
        SELECT id, status, expires_at FROM awcms_whatsapp_messages
        WHERE correlation_id = ${key}
      `) as { id: string; status: string; expires_at: Date | null }[];

      return rows[0]!;
    }

    async function intentState(reservationId: string, kind: string) {
      const rows = (await getAdminSql()`
        SELECT status, outcome_code, reconciled_at
        FROM awcms_booking_reminder_intents
        WHERE reservation_id = ${reservationId} AND kind = ${kind}
      `) as {
        status: string;
        outcome_code: string | null;
        reconciled_at: Date | null;
      }[];

      return rows[0]!;
    }

    test("M1: a message leased in `sending` is not abandoned: the intent stays open until the message is terminal, so a retry_wait is cancelled too", async () => {
      env = ENABLED;
      const reservation = await confirmedReservation(TENANT_A, {
        hours: 50,
        ref: "m1"
      });
      const key = confirmationKey(reservation.id);

      await workerPass(TENANT_A, deps(resolverTo(freshPhone())));

      // The delivery dispatcher has leased the message when the booking is cancelled.
      await getAdminSql()`
        UPDATE awcms_whatsapp_messages
        SET status = 'sending', next_attempt_at = now() + interval '5 minutes'
        WHERE correlation_id = ${key}
      `;
      await cancel(TENANT_A, reservation.id);
      await workerPass(TENANT_A, deps(resolverTo(freshPhone())));

      // Cancel could not touch it, and the intent was NOT marked reconciled.
      expect((await messageOf(key)).status).toBe("sending");
      expect(await intentState(reservation.id, "confirmation")).toMatchObject({
        status: "enqueued",
        reconciled_at: null
      });

      // The provider timed out: the message goes to retry_wait. The next pass cancels it.
      await getAdminSql()`
        UPDATE awcms_whatsapp_messages
        SET status = 'retry_wait', next_attempt_at = now() + interval '1 minute'
        WHERE correlation_id = ${key}
      `;
      await workerPass(TENANT_A, deps(resolverTo(freshPhone())));

      expect((await messageOf(key)).status).toBe("cancelled");
      expect(await intentState(reservation.id, "confirmation")).toMatchObject({
        status: "cancelled",
        outcome_code: "reservation_cancelled"
      });
    });

    test("M1: a message that is already sent is reconciled and left alone", async () => {
      env = ENABLED;
      const reservation = await confirmedReservation(TENANT_A, {
        hours: 51,
        ref: "m1b"
      });
      const key = confirmationKey(reservation.id);

      await workerPass(TENANT_A, deps(resolverTo(freshPhone())));
      await getAdminSql()`
        UPDATE awcms_whatsapp_messages
        SET status = 'sent', sent_at = now(), next_attempt_at = NULL
        WHERE correlation_id = ${key}
      `;
      await cancel(TENANT_A, reservation.id);
      await workerPass(TENANT_A, deps(resolverTo(freshPhone())));

      const state = await intentState(reservation.id, "confirmation");

      expect(state.status).toBe("enqueued");
      expect(state.reconciled_at).not.toBeNull();
      expect((await messageOf(key)).status).toBe("sent");
    });

    test("M2: every queued message carries an expiry; the reminder's is the start, the confirmation's the earlier of the start and the freshness window", async () => {
      env = ENABLED;
      const confirmation = await confirmedReservation(TENANT_A, {
        hours: 52,
        ref: "m2a"
      });
      const reminder = await confirmedReservation(TENANT_A, {
        hours: 12,
        ref: "m2b"
      });

      await confirmedAgo(reminder.id, "2 days");
      await workerPass(TENANT_A, deps(resolverTo(freshPhone())));

      const rows = (await getAdminSql()`
        SELECT m.correlation_id,
               abs(extract(epoch FROM m.expires_at - r.starts_at)) AS from_start,
               abs(extract(epoch FROM m.expires_at
                     - (r.status_changed_at + interval '6 hours'))) AS from_fresh
        FROM awcms_whatsapp_messages m
        JOIN awcms_booking_reservations r
          ON m.correlation_id LIKE 'booking:' || r.id::text || ':%'
        WHERE r.id IN (${confirmation.id}, ${reminder.id})
      `) as {
        correlation_id: string;
        from_start: string;
        from_fresh: string;
      }[];
      const byKey = Object.fromEntries(
        rows.map((row) => [row.correlation_id, row])
      );

      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.from_start !== null)).toBe(true);
      expect(
        byKey[confirmationKey(confirmation.id)]!.from_fresh
      ).not.toBeNull();
      expect(
        Number(byKey[confirmationKey(confirmation.id)]!.from_fresh)
      ).toBeLessThan(1);
      expect(
        Number(
          byKey[
            reminderIdempotencyKey({
              reservationId: reminder.id,
              kind: "reminder",
              occurrence: 1
            })
          ]!.from_start
        )
      ).toBeLessThan(1);
    });

    test("M2: an enqueued intent whose reservation has started is reconciled, and its still-queued message cancelled", async () => {
      env = ENABLED;
      const reservation = await confirmedReservation(TENANT_A, {
        hours: 53,
        ref: "m2c"
      });
      const key = confirmationKey(reservation.id);

      await workerPass(TENANT_A, deps(resolverTo(freshPhone())));
      await getAdminSql().begin(async (tx) => {
        await tx.unsafe(
          "ALTER TABLE awcms_booking_reservations DISABLE TRIGGER awcms_booking_reservations_update_guard"
        );
        await tx.unsafe(
          `UPDATE awcms_booking_reservations
           SET starts_at = now() - interval '1 hour', ends_at = now() + interval '1 hour'
           WHERE id = '${reservation.id}'`
        );
        await tx.unsafe(
          "ALTER TABLE awcms_booking_reservations ENABLE TRIGGER awcms_booking_reservations_update_guard"
        );
      });
      await workerPass(TENANT_A, deps(resolverTo(freshPhone())));

      expect((await messageOf(key)).status).toBe("cancelled");
      expect(await intentState(reservation.id, "confirmation")).toMatchObject({
        status: "cancelled",
        outcome_code: "started"
      });
    });

    test("M2: a mass cancellation of more than 100 reservations drains in ONE run", async () => {
      env = DISABLED;
      const ids: string[] = [];

      for (let chunk = 0; chunk < 11; chunk += 1) {
        ids.push(
          ...(
            await Promise.all(
              Array.from({ length: 10 }, (_, index) =>
                confirmedReservation(TENANT_B, {
                  hours: 80,
                  ref: `mass-${chunk}-${index}`
                })
              )
            )
          ).map((reservation) => reservation.id)
        );
      }

      // 110 confirmations owed; the capability is off, so they wait pending.
      await workerPass(TENANT_B, deps(resolverTo(freshPhone())));
      await workerPass(TENANT_B, deps(resolverTo(freshPhone())));

      for (let chunk = 0; chunk < ids.length; chunk += 10) {
        await Promise.all(
          ids.slice(chunk, chunk + 10).map((id) => cancel(TENANT_B, id))
        );
      }

      const rows = (await getAdminSql()`
        SELECT count(*)::int AS pending FROM awcms_booking_reminder_intents
        WHERE tenant_id = ${TENANT_B} AND status = 'pending'
      `) as { pending: number }[];

      expect(rows[0]!.pending).toBeGreaterThan(100);

      env = ENABLED;
      await runBookingReminderDispatch(
        getWorkerRoleSql(),
        {
          signal: new AbortController().signal,
          dryRun: false,
          correlationId: crypto.randomUUID()
        } as never,
        deps(resolverTo(freshPhone()))
      );

      const after = (await getAdminSql()`
        SELECT count(*)::int AS pending FROM awcms_booking_reminder_intents
        WHERE tenant_id = ${TENANT_B} AND status = 'pending'
      `) as { pending: number }[];

      expect(after[0]!.pending).toBe(0);
    }, 180_000);

    test("I2: a pending intent whose reservation was checked in settles expired, not cancelled", async () => {
      env = DISABLED;
      const reservation = await confirmedReservation(TENANT_A, {
        hours: 54,
        ref: "i2"
      });

      await workerPass(TENANT_A, deps(resolverTo(freshPhone())));

      const checkedIn = await tenantTx(TENANT_A, (tx) =>
        transitionReservation(
          tx,
          ctxOf(TENANT_A),
          reservation.id,
          "check_in",
          {}
        )
      );

      expect(checkedIn.outcome).toBe("ok");

      env = ENABLED;
      await workerPass(TENANT_A, deps(resolverTo(freshPhone())));

      expect(await intentState(reservation.id, "confirmation")).toMatchObject({
        status: "expired",
        outcome_code: "reservation_checked_in"
      });
      expect(await messagesOf(reservation.id)).toEqual([]);
    });

    test("L1: the worker may not rewrite the identity of an intent, and a settled intent's attempts and message are frozen", async () => {
      env = ENABLED;
      const reservation = await confirmedReservation(TENANT_A, {
        hours: 55,
        ref: "l1"
      });

      await workerPass(TENANT_A, deps(resolverTo(freshPhone())));

      for (const column of [
        "due_at = now()",
        "kind = 'reminder', occurrence = 1"
      ]) {
        await assertRejected(
          getWorkerRoleSql().begin(async (tx) => {
            await tx.unsafe(`SET LOCAL app.current_tenant_id = '${TENANT_A}'`);
            return tx.unsafe(
              `UPDATE awcms_booking_reminder_intents SET ${column}
               WHERE reservation_id = '${reservation.id}'`
            );
          }),
          `a worker write of ${column}`
        ).then((error) => {
          // The PRIVILEGE refuses it (42501), not merely the guard trigger.
          expect((error as { errno?: string }).errno).toBe("42501");
        });
      }

      for (const change of ["attempts = 7", "message_id = gen_random_uuid()"]) {
        await assertRejected(
          getAdminSql().unsafe(
            `UPDATE awcms_booking_reminder_intents SET ${change}
             WHERE reservation_id = '${reservation.id}' AND kind = 'confirmation'`
          ),
          `rewriting ${change} of a settled intent`
        );
      }
    });

    test("L3: a failing dispatch is logged by intent id, error class and code, never by message text or contact", async () => {
      env = ENABLED;
      const reservation = await confirmedReservation(TENANT_B, {
        hours: 56,
        ref: "l3"
      });
      const lines: string[] = [];
      const original = console.log;

      console.log = (...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      };

      try {
        await workerPass(TENANT_B, {
          whatsapp,
          recipients: {
            async resolve() {
              throw new TypeError(`cannot look up ${PHONE}`);
            }
          }
        });
      } finally {
        console.log = original;
      }

      const entry = lines.find((line) =>
        line.includes("booking.reminder.dispatch_failed")
      );

      expect(entry).toBeDefined();

      const parsed = JSON.parse(entry!);

      expect(parsed).toMatchObject({
        level: "warning",
        errorClass: "TypeError",
        tenantId: TENANT_B
      });
      expect(typeof parsed.intentId).toBe("string");
      expect(entry).not.toContain(PHONE_DIGITS);
      expect(entry).not.toContain("cannot look up");

      // Settle it so it does not hold later passes.
      await workerPass(TENANT_B, deps(resolverTo(null)));
      expect(await intentState(reservation.id, "confirmation")).toMatchObject({
        status: "skipped"
      });
    });
  });
});
