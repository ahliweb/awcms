import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import {
  IDN_ADMIN_REGIONS_MODULE_KEY,
  IDN_REGION_ACTIVITY_CODE
} from "../../../../../modules/idn-admin-regions/domain/idn-admin-regions-permissions";
import {
  clampLimit,
  queryRegions
} from "../../../../../modules/idn-admin-regions/application/region-lookup";

/**
 * `GET /api/v1/idn-regions/regions` (ADR-0046) — the region lookup itself:
 * filter by tier (`level`), by parent (`parentCode`), and/or by name
 * (`search`), keyset-paginated on `code`.
 *
 * Reads the ACTIVE dataset unless `dataset=<code>` names another version. When
 * nothing has been activated yet the response is an empty page carrying
 * `reason: "no_active_dataset"` — a fresh install that has not imported is a
 * real state, and answering it with an unexplained empty list would send an
 * operator hunting for a bug in their own code.
 *
 * Global reference data still requires a session, a tenant context, and a
 * permission grant: what is global is the ROW, not the authorization.
 */
type Prepared = {
  datasetCode: string | null;
  level: number | null;
  parentCode: string | null;
  search: string | null;
  limit: number;
  afterCode: string | null;
};

export const GET = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const levelParam = url.searchParams.get("level");
    let level: number | null = null;

    if (levelParam !== null) {
      const parsed = Number(levelParam);

      // A bad `level` is rejected rather than ignored: silently dropping the
      // filter would answer a question the caller did not ask (every region in
      // the country instead of every province).
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 4) {
        return fail(
          400,
          "VALIDATION_ERROR",
          "level must be an integer between 1 (province) and 4 (village)."
        );
      }

      level = parsed;
    }

    const limitParam = url.searchParams.get("limit");

    return {
      datasetCode: url.searchParams.get("dataset"),
      level,
      parentCode: url.searchParams.get("parentCode"),
      search: url.searchParams.get("search"),
      limit: clampLimit(limitParam === null ? null : Number(limitParam)),
      afterCode: url.searchParams.get("after")
    };
  },
  authorize: {
    moduleKey: IDN_ADMIN_REGIONS_MODULE_KEY,
    activityCode: IDN_REGION_ACTIVITY_CODE,
    action: "read"
  },
  handler: async ({ tx, prepared }) => {
    const result = await queryRegions(tx, prepared);

    return ok({
      datasetCode: result.datasetCode,
      items: result.items,
      nextCursor: result.nextCursor,
      reason: result.reason ?? null
    });
  }
});
