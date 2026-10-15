/**
 * The scheduled reminder dispatcher for `booking` (Issue #943, ADR-0131,
 * ADR-0133; docs/awcms/booking.md section 7.5): `booking:reminders:dispatch`,
 * every minute.
 *
 * Runs as `awcms_worker` under a per-tenant context, like every scheduled job.
 * The worker holds no privilege on the reservation tables; the reads go through
 * three narrow SECURITY DEFINER functions (`sql/285`, the `sql/200` pattern) and
 * the intents are settled with plain UPDATEs on the one table the worker may
 * write (`sql/284`). The per-tenant pass itself is
 * `booking-reminder-dispatch.ts`; this file only iterates tenants.
 *
 * ## Inert until the deployment wires it
 *
 * It needs two collaborators: the `WhatsappDeliveryPort` and a
 * `BookingReminderRecipientPort`. With either missing it creates no intent,
 * sends nothing and exits 0, which is what makes it safe to schedule on every
 * deployment profile (the offline/LAN profile included). Whether the delivery
 * capability is switched on at all (`WHATSAPP_ENABLED`) is the delivery
 * module's decision: a disabled capability answers `DISABLED`, the intent stays
 * pending and is re-tried until the reservation starts.
 */
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import {
  fetchActiveTenants,
  iterateTenantsInBatches
} from "../../../lib/jobs/batching";
import type { JobContext } from "../../../lib/jobs/job-runner";
import { BOOKING_REMINDER_RUN_BUDGET_MS } from "../domain/booking-reminder";
import {
  countDueReminders,
  runBookingReminderPass,
  type BookingReminderDeps,
  type ReminderPassResult
} from "./booking-reminder-dispatch";

export type BookingReminderJobResult = {
  /** `true` when a collaborator was missing and nothing ran. */
  inert: boolean;
  tenantsChecked: number;
  totals: Omit<ReminderPassResult, "count">;
  tenantsHitPassLimit: string[];
  aborted: boolean;
};

const ZERO_TOTALS: BookingReminderJobResult["totals"] = {
  created: 0,
  enqueued: 0,
  suppressed: 0,
  refused: 0,
  skipped: 0,
  cancelled: 0,
  expired: 0,
  retried: 0
};

const EMPTY_PASS: ReminderPassResult = { ...ZERO_TOTALS, count: 0 };

export async function runBookingReminderDispatch(
  sql: Bun.SQL,
  ctx: JobContext,
  deps: Partial<BookingReminderDeps>
): Promise<BookingReminderJobResult> {
  if (!deps.whatsapp || !deps.recipients) {
    return {
      inert: true,
      tenantsChecked: 0,
      totals: { ...ZERO_TOTALS },
      tenantsHitPassLimit: [],
      aborted: false
    };
  }

  const wired: BookingReminderDeps = {
    whatsapp: deps.whatsapp,
    recipients: deps.recipients
  };

  if (ctx.dryRun) {
    const tenants = await fetchActiveTenants(sql);
    let due = 0;
    let aborted = false;

    for (const tenant of tenants) {
      if (ctx.signal.aborted) {
        aborted = true;
        break;
      }

      due += await withTenantOrThrow(
        sql,
        tenant.id,
        (tx) => countDueReminders(tx, tenant.id),
        { workClass: "maintenance" }
      );
    }

    return {
      inert: false,
      tenantsChecked: tenants.length,
      totals: { ...ZERO_TOTALS, enqueued: due },
      tenantsHitPassLimit: [],
      aborted
    };
  }

  const totals = { ...ZERO_TOTALS };
  // The batch loop repeats a tenant's pass until it drains; a time budget stops
  // a huge backlog (a mass cancellation) from holding the run forever.
  const deadline = Date.now() + BOOKING_REMINDER_RUN_BUDGET_MS;
  const outcome = await iterateTenantsInBatches(
    sql,
    (tenantId) =>
      withTenantOrThrow(
        sql,
        tenantId,
        async (tx) => {
          if (Date.now() > deadline) {
            return { ...EMPTY_PASS };
          }

          const pass = await runBookingReminderPass(tx, tenantId, wired);

          for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
            totals[key] += pass[key];
          }

          return pass;
        },
        { workClass: "maintenance" }
      ),
    { signal: ctx.signal, maxPasses: 500 }
  );

  return {
    inert: false,
    tenantsChecked: outcome.tenants.length,
    totals,
    tenantsHitPassLimit: [...outcome.perTenant.entries()]
      .filter(([, value]) => value.hitPassLimit)
      .map(([tenantId]) => tenantId),
    aborted: outcome.aborted
  };
}
