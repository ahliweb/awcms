/**
 * One tenant pass of the reminder dispatcher (Issue #943, ADR-0131, ADR-0133
 * sections 3 and 8; docs/awcms/booking.md section 7.5).
 *
 * ## No network I/O, in a transaction that is open
 *
 * Everything in here is a database read or write in the caller's tenant
 * transaction. The delivery port's `enqueue` is ONE INSERT (it never calls a
 * provider; the provider is called later by `whatsapp:dispatch`, outside any
 * transaction), and the recipient resolver is contractually database-only. The
 * reservation transaction path is not touched at all: confirming or cancelling
 * a booking writes nothing about reminders, so a slow or broken delivery
 * capability can never slow or fail a booking.
 *
 * ## Idempotent per (reservation, kind, occurrence)
 *
 * Three independent layers, so a retried job never sends twice:
 *
 *   1. the unique key of `awcms_booking_reminder_intents` -- the intent is
 *      created once (`ON CONFLICT DO NOTHING`);
 *   2. the intent leaves `pending` exactly once, and only a `pending` intent is
 *      ever handed to the port (`awcms_booking_reminders_due`, `FOR UPDATE SKIP
 *      LOCKED`);
 *   3. the delivery module's own `(tenant, idempotency_key)` unique key, with the
 *      key derived from the same triple: a crash between the enqueue and the
 *      settle replays as `duplicate`, which settles `enqueued` with the original
 *      message id.
 *
 * ## A cancelled reservation emits nothing
 *
 * `due` returns a reservation only while it is `confirmed`, and holds a share
 * lock on it for the rest of the transaction, so a cancel either happened before
 * (the reservation is not returned) or waits until this pass has finished. What
 * a cancel cannot reach is a message queued by an EARLIER pass and not yet
 * sent: the stale sweep at the top of each pass cancels it through
 * `cancelByCorrelation` (a no-op once it has left the queue, as the port
 * promises).
 *
 * ## One bad intent does not stop the others
 *
 * The resolver and the enqueue run in a savepoint per intent. A throw rolls back
 * that intent alone and counts an attempt; after `BOOKING_REMINDER_MAX_ATTEMPTS`
 * it is settled `refused` so it cannot be retried forever.
 */
import { log } from "../../../lib/logging/logger";
import type { BookingReminderRecipientPort } from "../../_shared/ports/booking-reminder-recipient-port";
import type { WhatsappDeliveryPort } from "../../_shared/ports/whatsapp-delivery-port";
import {
  BOOKING_CONFIRMATION_FRESH_SECONDS,
  BOOKING_REMINDER_BATCH_LIMIT,
  BOOKING_REMINDER_DISPATCH_BATCH_LIMIT,
  BOOKING_REMINDER_DISPATCH_BUDGET_MS,
  BOOKING_REMINDER_LEAD_SECONDS,
  BOOKING_REMINDER_LOCK_TIMEOUT_MS,
  BOOKING_REMINDER_MAX_ATTEMPTS,
  BOOKING_REMINDER_STATEMENT_TIMEOUT_MS,
  BOOKING_WHATSAPP_TEMPLATE_KEYS,
  TERMINAL_MESSAGE_STATUSES,
  formatLocalStart,
  messageExpiry,
  reminderIdempotencyKey,
  settlementFor,
  staleIntentStatus,
  type BookingReminderKind
} from "../domain/booking-reminder";

type Tx = Bun.TransactionSQL;

export type BookingReminderDeps = {
  whatsapp: WhatsappDeliveryPort;
  recipients: BookingReminderRecipientPort;
};

export type ReminderPassResult = {
  /** Intents newly created this pass (including ones created already settled). */
  created: number;
  enqueued: number;
  suppressed: number;
  refused: number;
  skipped: number;
  cancelled: number;
  expired: number;
  /** Left pending for the next pass (a transient refusal or a throw). */
  retried: number;
  /** Intents that LEFT `pending` this pass: what the batch loop stops on. */
  count: number;
};

type DueRow = {
  intent_id: string;
  reservation_id: string;
  kind: BookingReminderKind;
  occurrence: number;
  attempts: number;
  reservation_no: string;
  external_customer_ref: string | null;
  starts_at: Date | string;
  timezone: string;
  confirmed_at: Date | string;
};

type StaleRow = {
  intent_id: string;
  reservation_id: string;
  kind: BookingReminderKind;
  occurrence: number;
  intent_status: "pending" | "enqueued";
  reservation_status: string;
  starts_at: Date | string;
};

function emptyResult(): ReminderPassResult {
  return {
    created: 0,
    enqueued: 0,
    suppressed: 0,
    refused: 0,
    skipped: 0,
    cancelled: 0,
    expired: 0,
    retried: 0,
    count: 0
  };
}

async function settleIntent(
  tx: Tx,
  tenantId: string,
  intentId: string,
  status: "enqueued" | "suppressed" | "refused" | "skipped",
  outcomeCode: string,
  messageId: string | null
): Promise<void> {
  await tx`
    UPDATE awcms_booking_reminder_intents
    SET status = ${status}, outcome_code = ${outcomeCode},
        message_id = ${messageId}, settled_at = now(), updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${intentId} AND status = 'pending'
  `;
}

async function keepPending(
  tx: Tx,
  tenantId: string,
  intentId: string,
  outcomeCode: string
): Promise<void> {
  await tx`
    UPDATE awcms_booking_reminder_intents
    SET attempts = attempts + 1, outcome_code = ${outcomeCode}, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${intentId} AND status = 'pending'
  `;
}

/** The cancellation sweep: settle what a cancelled or started reservation no longer needs. */
async function sweepStale(
  tx: Tx,
  tenantId: string,
  deps: BookingReminderDeps,
  result: ReminderPassResult
): Promise<void> {
  const stale = (await tx`
    SELECT * FROM awcms_booking_reminders_stale(
      ${tenantId}::uuid, ${BOOKING_REMINDER_BATCH_LIMIT})
  `) as StaleRow[];

  for (const row of stale) {
    const reason =
      row.reservation_status === "confirmed"
        ? "started"
        : `reservation_${row.reservation_status}`;

    if (row.intent_status === "pending") {
      // A pending intent was never queued: nothing to cancel in the delivery
      // module. `expired` when the reservation began (confirmed, checked in,
      // completed), `cancelled` when it was cancelled or moved.
      const status = staleIntentStatus(row.reservation_status);

      await tx`
        UPDATE awcms_booking_reminder_intents
        SET status = ${status}, outcome_code = ${reason},
            settled_at = now(), updated_at = now()
        WHERE tenant_id = ${tenantId} AND id = ${row.intent_id}
          AND status = 'pending'
      `;
      result[status] += 1;
      result.count += 1;
      continue;
    }

    // Enqueued: the message may still be waiting in the delivery queue.
    const key = reminderIdempotencyKey({
      reservationId: row.reservation_id,
      kind: row.kind,
      occurrence: row.occurrence
    });
    const cancelled = await deps.whatsapp.cancelByCorrelation(
      tx,
      tenantId,
      key
    );

    if (cancelled > 0) {
      await tx`
        UPDATE awcms_booking_reminder_intents
        SET status = 'cancelled', outcome_code = ${reason},
            reconciled_at = now(), updated_at = now()
        WHERE tenant_id = ${tenantId} AND id = ${row.intent_id}
          AND status = 'enqueued'
      `;
      result.cancelled += 1;
      result.count += 1;
      continue;
    }

    // Nothing was cancelled. That is only the end of the matter when the
    // message can no longer be sent: cancel does not touch a message that is
    // `sending` (leased by the dispatcher), and a provider timeout sends it to
    // `retry_wait`, from where it would be resent for a booking that is gone.
    // So the intent is reconciled only once every message under the key is
    // terminal; otherwise it is left for the next pass.
    const messages = await deps.whatsapp.getStatusByCorrelation(
      tx,
      tenantId,
      key
    );

    if (
      messages.every((message) =>
        TERMINAL_MESSAGE_STATUSES.includes(message.status)
      )
    ) {
      await tx`
        UPDATE awcms_booking_reminder_intents
        SET reconciled_at = now(), updated_at = now()
        WHERE tenant_id = ${tenantId} AND id = ${row.intent_id}
          AND status = 'enqueued'
      `;
      result.count += 1;
    }
  }
}

async function dispatchOne(
  tx: Tx,
  tenantId: string,
  deps: BookingReminderDeps,
  row: DueRow,
  result: ReminderPassResult
): Promise<"continue" | "stop"> {
  if (!row.external_customer_ref) {
    // The customer was erased at the authority after the intent was created.
    await settleIntent(
      tx,
      tenantId,
      row.intent_id,
      "skipped",
      "no_customer_ref",
      null
    );
    result.skipped += 1;
    result.count += 1;

    return "continue";
  }

  const key = reminderIdempotencyKey({
    reservationId: row.reservation_id,
    kind: row.kind,
    occurrence: row.occurrence
  });

  try {
    // A savepoint, so a throw (or a database error) rolls back THIS intent only.
    const outcome = await tx.savepoint(async (savepoint) => {
      // A savepoint runs the same tagged-template queries as its transaction;
      // the ports are typed on the transaction, which a savepoint is a scope of.
      const sp = savepoint as unknown as Tx;
      const recipient = await deps.recipients.resolve(sp, {
        tenantId,
        customerRef: row.external_customer_ref!,
        reservationId: row.reservation_id
      });

      if (!recipient) {
        return { resolved: false as const };
      }

      const enqueued = await deps.whatsapp.enqueue(sp, {
        tenantId,
        templateKey: BOOKING_WHATSAPP_TEMPLATE_KEYS[row.kind],
        variables: {
          reservationNo: row.reservation_no,
          startsAt: formatLocalStart(new Date(row.starts_at), row.timezone)
        },
        recipient,
        idempotencyKey: key,
        correlationId: key,
        expiresAt: messageExpiry({
          kind: row.kind,
          startsAt: new Date(row.starts_at),
          confirmedAt: new Date(row.confirmed_at)
        })
      });

      return { resolved: true as const, enqueued };
    });

    if (!outcome.resolved) {
      await settleIntent(
        tx,
        tenantId,
        row.intent_id,
        "skipped",
        "recipient_unresolved",
        null
      );
      result.skipped += 1;
      result.count += 1;

      return "continue";
    }

    const settlement = settlementFor(outcome.enqueued, row.attempts);

    if (settlement.kind === "settle") {
      await settleIntent(
        tx,
        tenantId,
        row.intent_id,
        settlement.status,
        settlement.outcomeCode,
        settlement.messageId
      );
      result[settlement.status] += 1;
      result.count += 1;

      return "continue";
    }

    await keepPending(tx, tenantId, row.intent_id, settlement.outcomeCode);
    result.retried += 1;

    return settlement.stopPass ? "stop" : "continue";
  } catch (error) {
    // The class and code only, never the message text: a resolver's error may
    // carry a contact. Without this a permanently failing intent is invisible.
    const code = (error as { code?: unknown } | null)?.code;

    log("warning", "booking.reminder.dispatch_failed", {
      tenantId,
      moduleKey: "booking",
      intentId: row.intent_id,
      attempt: row.attempts + 1,
      errorClass:
        error instanceof Error ? error.constructor.name : typeof error,
      ...(typeof code === "string" ? { errorCode: code } : {})
    });

    if (row.attempts + 1 >= BOOKING_REMINDER_MAX_ATTEMPTS) {
      await settleIntent(
        tx,
        tenantId,
        row.intent_id,
        "refused",
        "dispatch_error",
        null
      );
      result.refused += 1;
      result.count += 1;
    } else {
      await keepPending(tx, tenantId, row.intent_id, "dispatch_error");
      result.retried += 1;
    }

    return "continue";
  }
}

/**
 * One bounded pass for one tenant. The caller owns the transaction (and sets
 * the tenant context); the pass writes only `awcms_booking_reminder_intents` and
 * whatever the delivery port writes in the same transaction.
 */
export async function runBookingReminderPass(
  tx: Tx,
  tenantId: string,
  deps: BookingReminderDeps
): Promise<ReminderPassResult> {
  const result = emptyResult();

  await sweepStale(tx, tenantId, deps, result);

  const created = (await tx`
    SELECT awcms_booking_reminders_materialize(
      ${tenantId}::uuid, ${BOOKING_REMINDER_BATCH_LIMIT},
      ${BOOKING_REMINDER_LEAD_SECONDS}, ${BOOKING_CONFIRMATION_FRESH_SECONDS}
    ) AS created
  `) as { created: number }[];

  result.created = Number(created[0]?.created ?? 0);

  // The dispatch read holds a share lock on every reservation it returns until
  // this transaction ends, and that blocks a customer's cancel or confirm. So:
  // a small batch, a time budget, and Postgres timeouts so a stuck lock or
  // query aborts the pass instead of holding those locks.
  await tx.unsafe(
    `SET LOCAL lock_timeout = '${BOOKING_REMINDER_LOCK_TIMEOUT_MS}ms'`
  );
  await tx.unsafe(
    `SET LOCAL statement_timeout = '${BOOKING_REMINDER_STATEMENT_TIMEOUT_MS}ms'`
  );

  const due = (await tx`
    SELECT * FROM awcms_booking_reminders_due(
      ${tenantId}::uuid, ${BOOKING_REMINDER_DISPATCH_BATCH_LIMIT})
  `) as DueRow[];
  const startedAt = Date.now();

  for (const row of due) {
    if (Date.now() - startedAt > BOOKING_REMINDER_DISPATCH_BUDGET_MS) {
      break;
    }

    if ((await dispatchOne(tx, tenantId, deps, row, result)) === "stop") {
      break;
    }
  }

  return result;
}

/** Read-only backlog for `--dry-run`: how many intents are due now (nothing is settled; the caller rolls back). */
export async function countDueReminders(
  tx: Tx,
  tenantId: string
): Promise<number> {
  const due = (await tx`
    SELECT intent_id FROM awcms_booking_reminders_due(
      ${tenantId}::uuid, ${BOOKING_REMINDER_DISPATCH_BATCH_LIMIT})
  `) as unknown[];

  return due.length;
}
