import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import {
  IDN_ADMIN_REGIONS_MODULE_KEY,
  IDN_REGION_ACTIVITY_CODE
} from "../../../../../modules/idn-admin-regions/domain/idn-admin-regions-permissions";
import { getRegionByCode } from "../../../../../modules/idn-admin-regions/application/region-lookup";

/**
 * `GET /api/v1/idn-regions/regions/{code}` (ADR-0046) — one region by its dotted
 * Kemendagri code (`11`, `11.01`, `11.01.01`, `11.01.01.2001`), from the active
 * dataset or the one named by `?dataset=<code>`.
 *
 * The response carries the resolved ancestor path, so a caller rendering "Keude
 * Bakongan, Aceh Selatan, Aceh" needs one request rather than four.
 */
type Prepared = { code: string; datasetCode: string | null };

export const GET = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: ({ params, url }) => {
    const code = params.code ?? "";

    // Shape-checked before it reaches the database: only digits and dots are a
    // region code, so anything else is a client bug worth naming, not a query
    // worth running.
    if (!/^[0-9]+(\.[0-9]+){0,3}$/.test(code)) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "code must be a dotted Kemendagri region code, e.g. 11.01.01.2001."
      );
    }

    return { code, datasetCode: url.searchParams.get("dataset") };
  },
  authorize: {
    moduleKey: IDN_ADMIN_REGIONS_MODULE_KEY,
    activityCode: IDN_REGION_ACTIVITY_CODE,
    action: "read"
  },
  handler: async ({ tx, prepared }) => {
    const result = await getRegionByCode(tx, prepared.code, {
      datasetCode: prepared.datasetCode
    });

    if (!result.region) {
      return fail(
        404,
        "NOT_FOUND",
        result.reason === "no_active_dataset"
          ? "No region dataset has been activated yet."
          : "Region not found in this dataset."
      );
    }

    return ok({ datasetCode: result.dataset, region: result.region });
  }
});
