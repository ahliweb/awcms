import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import { decodeKeysetCursor } from "../../../../../modules/_shared/keyset-pagination";
import type { KeysetCursor } from "../../../../../modules/_shared/keyset-pagination";
import { OMES_GUARDS } from "../../../../../modules/omes-control/domain/permissions";
import {
  fetchHealthHistory,
  fetchLatestHealthPerServer
} from "../../../../../modules/omes-control/application/health-directory";

/**
 * `GET /api/v1/omes/health` (Issue ahliweb/omes#198) — two modes:
 *
 * - Default (no `serverId`): latest snapshot per server, tenant-wide.
 * - `?serverId=...`: keyset-paginated history for that one server
 *   (`&cursor=...` to page).
 *
 * Guarded by `omes_control.servers.read` — that permission's own
 * description ("Read enrolled servers, host specs, AND TELEMETRY") already
 * covers health snapshots; there is no separate `health.read` permission in
 * the seeded catalog (`sql/155`), and this issue reuses rather than adds one.
 */
type Prepared =
  | { mode: "latest" }
  | { mode: "history"; serverId: string; cursor: KeysetCursor | undefined };

export const GET = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: ({ url }): Prepared | Response => {
    const serverId = url.searchParams.get("serverId");

    if (!serverId) {
      return { mode: "latest" };
    }

    const rawCursor = url.searchParams.get("cursor");
    if (rawCursor === null) {
      return { mode: "history", serverId, cursor: undefined };
    }

    const cursor = decodeKeysetCursor(rawCursor);
    if (!cursor) {
      return fail(400, "VALIDATION_ERROR", "cursor is not a valid cursor.");
    }

    return { mode: "history", serverId, cursor };
  },
  authorize: OMES_GUARDS.servers.read,
  handler: async ({ tx, tenantId, prepared }) => {
    if (prepared.mode === "latest") {
      return ok({ snapshots: await fetchLatestHealthPerServer(tx, tenantId) });
    }

    return ok(
      await fetchHealthHistory(tx, tenantId, prepared.serverId, prepared.cursor)
    );
  }
});
