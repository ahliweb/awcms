/**
 * The scheduled hold-expiry sweep for `booking` (Issue #939, ADR-0131;
 * docs/awcms/booking.md section 5.1): `booking:holds:expire`, every minute.
 *
 * ## This is HOUSEKEEPING, and saying so is not a disclaimer
 *
 * A hold's expiry takes effect for every CLAIM at the instant on the row: the
 * allocator reclaims an elapsed hold on exactly the units it is about to take
 * (`reclaimExpiredHolds`), under the reservation row lock, in the same
 * transaction. So a stopped, late or crashed sweep cannot cause a double booking
 * and cannot keep a customer out of a slot. What the sweep adds is the part a
 * claim cannot do: it moves holds nobody tried to claim over from `held` to
 * `expired`, releases their rows, and writes the history, so a tenant's `held`
 * list and its reports do not fill with ghosts.
 *
 * Its health is observable without trusting it:
 *   * every run is wrapped by the shared job runner (advisory lock, timeout,
 *     SIGTERM-aware cancellation, `job_run_total` / `job_run_item_count`
 *     metrics, JSON telemetry), so a job that stops running or starts failing is
 *     visible where every other job's is;
 *   * `runReconciliation` reports `hold_overdue_unswept` and the reaper's
 *     `oldestOverdueSeconds` from the data itself.
 *
 * ## Role: `awcms_worker`, through one narrow function
 *
 * It runs as the background-job role under a per-tenant context, like the other
 * scheduled jobs. The worker holds NO privilege on the booking tables
 * (they carry the customer reference and the note, and `UPDATE` on reservations
 * would also let a cron job confirm or cancel a booking). The sweep therefore
 * goes through `awcms_booking_expire_due_holds` (`sql/200`), a SECURITY DEFINER
 * function that can only expire an elapsed hold and only for the tenant the
 * session is scoped to, following `sql/142` (ADR-0090). The same applies to the
 * `--dry-run` count (`awcms_booking_count_due_holds`). The one table the job
 * writes directly is `awcms_audit_events`, which every worker job already may.
 *
 * ## One audit row per tenant per pass, not one per hold
 *
 * Expiry is `info` in the audit table of booking.md section 3. The per-hold
 * evidence is the append-only `expired` history row each reservation gets in
 * the same statement; the audit entry says how many.
 */
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import {
  fetchActiveTenants,
  iterateTenantsInBatches,
  type BatchPassResult
} from "../../../lib/jobs/batching";
import type { JobContext } from "../../../lib/jobs/job-runner";
import { recordAuditEvent } from "../../logging/application/audit-log";
import { BOOKING_AUDIT_EVENTS } from "../domain/booking-audit";
import { BOOKING_MODULE_KEY } from "../domain/booking-permissions";
import {
  EXPIRY_BATCH_LIMIT,
  countDueHolds,
  emitReaperExpiredEvents,
  expireDueHolds
} from "./booking-hold-expiry";

export type BookingHoldExpiryResult = {
  tenantsChecked: number;
  holdsExpired: number;
  allocationsReleased: number;
  tenantsHitPassLimit: string[];
  aborted: boolean;
};

async function expirePass(
  sql: Bun.SQL,
  tenantId: string,
  correlationId: string,
  tally: { released: number }
): Promise<BatchPassResult> {
  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const outcome = await expireDueHolds(tx, tenantId, EXPIRY_BATCH_LIMIT);

      // The `expired` domain event, in the SAME transaction as the expiry
      // (booking.md section 7.4): the worker may use the outbox, and the facts
      // came back from the sweep's own function.
      await emitReaperExpiredEvents(tx, tenantId, outcome, correlationId);

      if (outcome.expired > 0) {
        await recordAuditEvent(tx, {
          tenantId,
          moduleKey: BOOKING_MODULE_KEY,
          action: BOOKING_AUDIT_EVENTS.reservationExpired.action,
          resourceType: "booking_reservation",
          severity: BOOKING_AUDIT_EVENTS.reservationExpired.severity,
          message: `${outcome.expired} elapsed hold(s) were expired by the sweep and their units released.`,
          attributes: {
            expiredCount: outcome.expired,
            releasedAllocations: outcome.releasedAllocations,
            trigger: "reaper"
          },
          correlationId
        });
      }

      tally.released += outcome.releasedAllocations;

      return { count: outcome.expired };
    },
    { workClass: "maintenance" }
  );
}

/**
 * Read-only backlog count for `--dry-run`: per tenant and inside `withTenant`,
 * because the tables are `FORCE ROW LEVEL SECURITY` and an unscoped count would
 * answer zero forever and read as "nothing to do".
 */
async function countBacklog(sql: Bun.SQL, tenantId: string): Promise<number> {
  return withTenantOrThrow(sql, tenantId, (tx) => countDueHolds(tx, tenantId), {
    workClass: "maintenance"
  });
}

export async function runBookingHoldExpiry(
  sql: Bun.SQL,
  ctx: JobContext
): Promise<BookingHoldExpiryResult> {
  if (ctx.dryRun) {
    const tenants = await fetchActiveTenants(sql);
    let holdsExpired = 0;
    let aborted = false;

    for (const tenant of tenants) {
      if (ctx.signal.aborted) {
        aborted = true;
        break;
      }

      holdsExpired += await countBacklog(sql, tenant.id);
    }

    return {
      tenantsChecked: tenants.length,
      holdsExpired,
      allocationsReleased: 0,
      tenantsHitPassLimit: [],
      aborted
    };
  }

  const tally = { released: 0 };
  const outcome = await iterateTenantsInBatches(
    sql,
    (tenantId) => expirePass(sql, tenantId, ctx.correlationId, tally),
    { signal: ctx.signal }
  );

  return {
    tenantsChecked: outcome.tenants.length,
    holdsExpired: outcome.totalCount,
    allocationsReleased: tally.released,
    tenantsHitPassLimit: [...outcome.perTenant.entries()]
      .filter(([, value]) => value.hitPassLimit)
      .map(([tenantId]) => tenantId),
    aborted: outcome.aborted
  };
}
