import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import { decodeKeysetCursor } from "../../../../../modules/_shared/keyset-pagination";
import type { KeysetCursor } from "../../../../../modules/_shared/keyset-pagination";
import { OMES_GUARDS } from "../../../../../modules/omes-control/domain/permissions";
import { fetchDeployments } from "../../../../../modules/omes-control/application/deployment-directory";

/**
 * `GET /api/v1/omes/deployments` (Issue ahliweb/omes#198) — desired vs
 * observed deployment state, rendered as SEPARATE fields (never merged),
 * plus last reconciliation and a computed `stale` flag. Keyset-paginated.
 */
const VALID_STATUS_FILTERS = new Set([
  "pending",
  "in_progress",
  "converged",
  "drifted",
  "failed"
]);

type Prepared = {
  serverId: string | null;
  reconciliationStatus: string | null;
  cursor: KeysetCursor | undefined;
};

export const GET = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: ({ url }): Prepared | Response => {
    const reconciliationStatus = url.searchParams.get("reconciliationStatus");
    if (
      reconciliationStatus !== null &&
      !VALID_STATUS_FILTERS.has(reconciliationStatus)
    ) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "reconciliationStatus is not a known value."
      );
    }

    const serverId = url.searchParams.get("serverId");
    const rawCursor = url.searchParams.get("cursor");

    if (rawCursor === null) {
      return { serverId, reconciliationStatus, cursor: undefined };
    }

    const cursor = decodeKeysetCursor(rawCursor);
    if (!cursor) {
      return fail(400, "VALIDATION_ERROR", "cursor is not a valid cursor.");
    }

    return { serverId, reconciliationStatus, cursor };
  },
  authorize: OMES_GUARDS.deployments.read,
  handler: async ({ tx, tenantId, now, prepared }) =>
    ok(
      await fetchDeployments(tx, tenantId, now, {
        serverId: prepared.serverId ?? undefined,
        reconciliationStatus: prepared.reconciliationStatus ?? undefined,
        cursor: prepared.cursor
      })
    )
});
