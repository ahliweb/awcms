import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  TAX_REPORT_MAX_DAYS,
  fetchReconciliationReport
} from "../../../../../modules/tax/application/tax-reconciliation-report";
import {
  TAX_MODULE_KEY,
  TAX_REPORTS_ACTIVITY_CODE
} from "../../../../../modules/tax/domain/tax-permissions";
import { isValidIsoDate } from "../../../../../modules/tax/domain/tax-version-resolution";

/**
 * `GET /api/v1/tax/reports/reconciliation?from=&to=[&profileCode=]` (ADR-0127) —
 * what was finalised and reversed between two TAX DATES, by rule version,
 * component and treatment, netted per currency, plus an integrity block that
 * checks every snapshot against its own lines.
 *
 * Both dates are inclusive calendar dates and the span is capped
 * (`TAX_REPORT_MAX_DAYS`), so the work is bounded. Everything is aggregated in
 * SQL: the response grows with the number of profiles and components, never with
 * the number of documents. The counting projection on the `reporting` engine
 * (`tax.snapshot_activity`) is the freshness-tracked companion to this view.
 */
type Prepared = { from: string; to: string; profileCode: string | null };

const DAY_MS = 86_400_000;

export const GET = defineTenantRoute<Prepared>({
  workClass: "reporting",
  prepare: ({ url }) => {
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";

    if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "from and to are required calendar dates (YYYY-MM-DD)."
      );
    }

    const span =
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      DAY_MS;

    if (span < 0) {
      return fail(400, "VALIDATION_ERROR", "to must not be before from.");
    }

    if (span + 1 > TAX_REPORT_MAX_DAYS) {
      return fail(
        400,
        "VALIDATION_ERROR",
        `The period may span at most ${TAX_REPORT_MAX_DAYS} days.`
      );
    }

    return {
      from,
      to,
      profileCode: url.searchParams.get("profileCode") || null
    };
  },
  authorize: {
    moduleKey: TAX_MODULE_KEY,
    activityCode: TAX_REPORTS_ACTIVITY_CODE,
    action: "read"
  },
  handler: async ({ tx, tenantId, prepared }) =>
    ok(
      await fetchReconciliationReport(
        tx,
        tenantId,
        prepared.from,
        prepared.to,
        prepared.profileCode
      )
    )
});
