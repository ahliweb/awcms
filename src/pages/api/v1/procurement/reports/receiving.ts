import { ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { receivingSummaryReport } from "../../../../../modules/procurement/application/procurement-reporting";
import { readDateRange } from "../../../../../modules/procurement/application/procurement-route-support";
import { PROCUREMENT_GUARDS } from "../../../../../modules/procurement/domain/procurement-permissions";

type Prepared = { from: string | null; to: string | null };

/**
 * `GET /api/v1/procurement/reports/receiving` — document counts and total cost
 * per (mode, status), optionally within `?from=`/`?to=` document dates. At most
 * 20 rows. This is the live view behind the `procurement.receiving` reporting
 * projection.
 */
export const GET = defineTenantRoute<Prepared>({
  workClass: "reporting",
  prepare: ({ url }) => readDateRange(url),
  authorize: PROCUREMENT_GUARDS.reports.read,
  handler: async ({ tx, tenantId, prepared }) =>
    ok(await receivingSummaryReport(tx, tenantId, prepared))
});
