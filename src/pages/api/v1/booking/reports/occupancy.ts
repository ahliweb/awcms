import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { occupancyReport } from "../../../../../modules/booking/application/booking-report-directory";
import { BOOKING_GUARDS } from "../../../../../modules/booking/domain/booking-permissions";
import {
  parseReportQuery,
  type ReportRange
} from "../../../../../modules/booking/domain/booking-report";

/**
 * `GET /api/v1/booking/reports/occupancy` -- occupied unit-nights of stay resources per local night, with the hold pipeline and blocked nights reported beside it.
 *
 * READ-ONLY and tenant-scoped; gated by `booking.reports.read`. Query: `from` and
 * `to` (local dates, half-open, at most 92 days) and an optional `resourceId`.
 * Day windows are Asia/Jakarta. Holds are never part of occupancy (O8). No
 * customer reference, note or amount is read or returned: the answer is counts
 * and ratios, and a ratio over fewer than five reservations is withheld (counts are not).
 * Never cached (it is per-tenant and per-request).
 */
export const GET = defineTenantRoute<ReportRange>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const parsed = parseReportQuery(url.searchParams);

    return parsed.valid
      ? parsed.value
      : fail(400, "VALIDATION_ERROR", "Query is invalid.", {}, parsed.errors);
  },
  authorize: BOOKING_GUARDS.reports.read,
  handler: async ({ tx, tenantId, prepared }) =>
    ok(
      await occupancyReport(tx, tenantId, prepared),
      {},
      {
        "cache-control": "private, no-store"
      }
    )
});
