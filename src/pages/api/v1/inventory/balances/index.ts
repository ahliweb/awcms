import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  decodeBalanceCursor,
  listBalances,
  type BalanceCursor,
  type BalanceListFilters
} from "../../../../../modules/inventory/application/inventory-balance-directory";
import { asUuid } from "../../../../../modules/inventory/application/inventory-route-support";
import { INVENTORY_GUARDS } from "../../../../../modules/inventory/domain/inventory-permissions";

type Prepared = { filters: BalanceListFilters; cursor?: BalanceCursor };

/**
 * `GET /api/v1/inventory/balances` — stock balances, keyset paginated by
 * `(location, item)`. Filters: `locationId`, `itemType`, `itemRef`, and
 * `lowStockOnly=true` for the live low-stock list (the authoritative detail
 * behind the `inventory.low_stock` reporting projection).
 *
 * Read-only by construction: there is no write verb on this resource, because a
 * balance is derived from movements and a client can never assert one.
 */
export const GET = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const filters: BalanceListFilters = {};
    const locationId = url.searchParams.get("locationId");

    if (locationId !== null) {
      const parsed = asUuid(locationId);

      if (!parsed) {
        return fail(400, "VALIDATION_ERROR", "locationId must be a UUID.");
      }

      filters.locationId = parsed;
    }

    for (const key of ["itemType", "itemRef"] as const) {
      const value = url.searchParams.get(key);

      if (value !== null) {
        if (value.length === 0 || value.length > 200) {
          return fail(
            400,
            "VALIDATION_ERROR",
            `${key} must be 1-200 characters.`
          );
        }

        filters[key] = value;
      }
    }

    const lowOnly = url.searchParams.get("lowStockOnly");

    if (lowOnly !== null) {
      if (lowOnly !== "true" && lowOnly !== "false") {
        return fail(
          400,
          "VALIDATION_ERROR",
          "lowStockOnly must be true or false."
        );
      }

      filters.lowStockOnly = lowOnly === "true";
    }

    const cursorParam = url.searchParams.get("cursor");

    if (cursorParam === null) {
      return { filters };
    }

    const cursor = decodeBalanceCursor(cursorParam);

    return cursor
      ? { filters, cursor }
      : fail(400, "VALIDATION_ERROR", "cursor is malformed.");
  },
  authorize: INVENTORY_GUARDS.balances.read,
  handler: async ({ tx, tenantId, prepared }) =>
    ok(await listBalances(tx, tenantId, prepared.filters, prepared.cursor))
});
