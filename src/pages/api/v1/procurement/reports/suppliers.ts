import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  parseReportCursor,
  supplierActivityReport
} from "../../../../../modules/procurement/application/procurement-reporting";
import { readDateRange } from "../../../../../modules/procurement/application/procurement-route-support";
import { PROCUREMENT_GUARDS } from "../../../../../modules/procurement/domain/procurement-permissions";

type Prepared = {
  range: { from: string | null; to: string | null };
  cursor: ReturnType<typeof parseReportCursor>;
};

/**
 * `GET /api/v1/procurement/reports/suppliers` — per-supplier receiving volume
 * and cost (finalised receipts, supplier returns, reversals, open documents),
 * optionally within `?from=`/`?to=` document dates. Keyset paginated. This is
 * the live view behind the `procurement.suppliers` reporting projection.
 */
export const GET = defineTenantRoute<Prepared>({
  workClass: "reporting",
  prepare: ({ url }) => {
    const range = readDateRange(url);

    if (range instanceof Response) {
      return range;
    }

    const raw = url.searchParams.get("cursor");
    const cursor = raw ? parseReportCursor(raw) : null;

    if (raw && !cursor) {
      return fail(400, "VALIDATION_ERROR", "cursor is not valid.");
    }

    return { range, cursor };
  },
  authorize: PROCUREMENT_GUARDS.reports.read,
  handler: async ({ tx, tenantId, prepared }) => {
    const page = await supplierActivityReport(
      tx,
      tenantId,
      prepared.range,
      prepared.cursor ?? undefined
    );

    return ok(page);
  }
});
