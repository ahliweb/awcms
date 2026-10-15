/**
 * Reminder and confirmation intents of `booking` (Issue #943, ADR-0131,
 * ADR-0133 sections 3 and 8; docs/awcms/booking.md section 7.5). Pure: no I/O.
 *
 * ## What booking does and does not own here
 *
 * It owns the DEBT -- "a confirmation (reminder) is owed for this reservation" --
 * in `awcms_booking_reminder_intents` (`sql/284`), created once per
 * `(reservation, kind, occurrence)`. It does NOT own the message: wording
 * consent, the provider and the queue belong to `whatsapp_delivery`, reached
 * through the `WhatsappDeliveryPort` (ADR-0011). It holds no credential and no
 * contact detail; the customer is the opaque `external_customer_ref`, handed to
 * a recipient resolver registered by the deployment (commerce is the customer
 * authority, ADR-0131 O12) and never stored.
 *
 * ## What leaves the booking schema
 *
 * Only the two template variables below: the reservation number (a random
 * code) and a local start time. No name, no contact, no note, no amount.
 */
import type {
  EnqueueWhatsappResult,
  WhatsappPurpose
} from "../../_shared/ports/whatsapp-delivery-port";

export type BookingReminderKind = "confirmation" | "reminder";

/** The only occurrence of a confirmation; reminders are numbered from 1. */
export const CONFIRMATION_OCCURRENCE = 0;
export const REMINDER_OCCURRENCE = 1;

/**
 * Defaults, deliberately constants: a per-tenant lead is a product decision
 * recorded as an open question (docs/awcms/booking.md section 7.5), not a column
 * added on a guess.
 */
export const BOOKING_REMINDER_LEAD_SECONDS = 24 * 60 * 60;
/** A confirmation is owed only to a reservation confirmed this recently. */
export const BOOKING_CONFIRMATION_FRESH_SECONDS = 6 * 60 * 60;
/** How many intents the stale sweep and the materialize step handle per pass. */
export const BOOKING_REMINDER_BATCH_LIMIT = 100;
/**
 * How many due intents ONE pass dispatches. Smaller than the sweep batch on
 * purpose: the dispatch read holds a share lock on each reservation it returns
 * until the pass commits, and that lock blocks a customer's cancel or confirm,
 * so the number of reservations locked at once is kept small.
 */
export const BOOKING_REMINDER_DISPATCH_BATCH_LIMIT = 25;
/** The dispatch section stops taking new intents after this long (the rest stay pending, unlocked at commit). */
export const BOOKING_REMINDER_DISPATCH_BUDGET_MS = 5_000;
/** Postgres limits applied to the dispatch section (`SET LOCAL`): a stuck lock or query aborts the pass instead of holding reservation locks. */
export const BOOKING_REMINDER_LOCK_TIMEOUT_MS = 2_000;
export const BOOKING_REMINDER_STATEMENT_TIMEOUT_MS = 10_000;
/** One job run keeps draining a tenant's backlog (pass after pass) for at most this long. */
export const BOOKING_REMINDER_RUN_BUDGET_MS = 45_000;
/** A transient refusal (rate limit) is retried this many passes, then given up. */
export const BOOKING_REMINDER_MAX_ATTEMPTS = 30;

export const BOOKING_WHATSAPP_TEMPLATE_KEYS: Record<
  BookingReminderKind,
  string
> = {
  confirmation: "booking.confirmation",
  reminder: "booking.reminder"
};

/**
 * The templates booking registers with the delivery module. Both are
 * `transactional`: the recipient is the reservation's own customer, so no
 * marketing consent applies, and a hard failure or an opt-out STILL stops them
 * (ADR-0133 section 4) -- consent is the delivery module's decision, never
 * booking's. Wording is neutral English; the per-tenant wording and an approved
 * provider template are recorded as open questions.
 */
export const BOOKING_WHATSAPP_TEMPLATES: readonly {
  key: string;
  version: number;
  purpose: WhatsappPurpose;
  body: string;
  variables: readonly string[];
}[] = [
  {
    key: BOOKING_WHATSAPP_TEMPLATE_KEYS.confirmation,
    version: 1,
    purpose: "transactional",
    body: "Your booking {{reservationNo}} is confirmed for {{startsAt}}.",
    variables: ["reservationNo", "startsAt"]
  },
  {
    key: BOOKING_WHATSAPP_TEMPLATE_KEYS.reminder,
    version: 1,
    purpose: "transactional",
    body: "Reminder: your booking {{reservationNo}} starts on {{startsAt}}.",
    variables: ["reservationNo", "startsAt"]
  }
];

/**
 * The idempotency key AND the correlation id of one intent. Unique per
 * `(reservation, kind, occurrence)`, so a retried job, a second worker or a
 * re-run after a crash enqueues the same key and receives `duplicate`, never a
 * second message. Per-intent (not per-reservation) so that cancelling a
 * confirmation cannot touch a reminder.
 */
export function reminderIdempotencyKey(input: {
  reservationId: string;
  kind: BookingReminderKind;
  occurrence: number;
}): string {
  return `booking:${input.reservationId}:${input.kind}:${input.occurrence}`;
}

/** `2026-10-20 14:00 (Asia/Pontianak)`: the start in the reservation's own zone. */
export function formatLocalStart(startsAt: Date, timeZone: string): string {
  let zone = timeZone;

  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
  } catch {
    zone = "UTC";
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(startsAt);
  const part = (type: string) =>
    parts.find((entry) => entry.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")} (${zone})`;
}

export type ReminderSettlement =
  | {
      kind: "settle";
      status: "enqueued" | "suppressed" | "refused";
      outcomeCode: string;
      messageId: string | null;
    }
  /** Leave the intent pending and try again next pass. */
  | { kind: "retry"; outcomeCode: string; stopPass: boolean };

/**
 * What an enqueue answer means for the intent. `DISABLED`, `MISCONFIGURED` and
 * `RATE_LIMITED` are properties of the deployment or the moment, not of this
 * message, so the intent stays pending (and the pass stops, so one blocked
 * intent cannot be re-tried a hundred times). Everything else is a verdict.
 * `duplicate` is a success: the message already exists.
 */
export function settlementFor(
  result: EnqueueWhatsappResult,
  attempts: number
): ReminderSettlement {
  switch (result.status) {
    case "queued":
    case "duplicate":
      return {
        kind: "settle",
        status: "enqueued",
        outcomeCode: result.status,
        messageId: result.messageId
      };
    case "suppressed":
      return {
        kind: "settle",
        status: "suppressed",
        outcomeCode: result.reason,
        messageId: null
      };
    case "refused": {
      const code = result.reason.toLowerCase();

      if (
        result.reason === "DISABLED" ||
        result.reason === "MISCONFIGURED" ||
        result.reason === "RATE_LIMITED"
      ) {
        if (
          result.reason === "RATE_LIMITED" &&
          attempts + 1 >= BOOKING_REMINDER_MAX_ATTEMPTS
        ) {
          return {
            kind: "settle",
            status: "refused",
            outcomeCode: code,
            messageId: null
          };
        }

        return { kind: "retry", outcomeCode: code, stopPass: true };
      }

      return {
        kind: "settle",
        status: "refused",
        outcomeCode: code,
        messageId: null
      };
    }
  }
}

/**
 * When a queued message stops being worth sending. A reminder is useless once
 * the reservation starts; a confirmation is useless after that too, and also
 * after the freshness window it was owed in. The delivery dispatcher expires a
 * message past this instant instead of sending it late (e.g. after a long
 * provider outage), so a message can never go out for a booking long over.
 */
export function messageExpiry(input: {
  kind: BookingReminderKind;
  startsAt: Date;
  confirmedAt: Date;
}): Date {
  if (input.kind === "reminder") {
    return input.startsAt;
  }

  const fresh = new Date(
    input.confirmedAt.getTime() + BOOKING_CONFIRMATION_FRESH_SECONDS * 1000
  );

  return fresh < input.startsAt ? fresh : input.startsAt;
}

/** Message states from which nothing more will be sent (`retry_wait` and `sending` are NOT among them). */
export const TERMINAL_MESSAGE_STATUSES: readonly string[] = [
  "sent",
  "failed",
  "cancelled",
  "expired"
];

/** A pending intent whose reservation has started or finished is `expired`; one whose reservation was cancelled is `cancelled`. */
export function staleIntentStatus(
  reservationStatus: string
): "expired" | "cancelled" {
  return ["confirmed", "checked_in", "completed"].includes(reservationStatus)
    ? "expired"
    : "cancelled";
}
