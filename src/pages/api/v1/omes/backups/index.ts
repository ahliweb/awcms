import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import { decodeKeysetCursor } from "../../../../../modules/_shared/keyset-pagination";
import type { KeysetCursor } from "../../../../../modules/_shared/keyset-pagination";
import { OMES_GUARDS } from "../../../../../modules/omes-control/domain/permissions";
import { fetchBackups } from "../../../../../modules/omes-control/application/backup-directory";

/**
 * `GET /api/v1/omes/backups` (Issue ahliweb/omes#198) — backup snapshot
 * catalog: verification/sha256 status and a computed `fresh` flag (captured
 * within the last 24h and not `failed`).
 */
const VALID_STATUS_FILTERS = new Set([
  "completed",
  "in_progress",
  "verified",
  "failed"
]);

type Prepared = {
  serverId: string | null;
  status: string | null;
  cursor: KeysetCursor | undefined;
};

export const GET = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: ({ url }): Prepared | Response => {
    const status = url.searchParams.get("status");
    if (status !== null && !VALID_STATUS_FILTERS.has(status)) {
      return fail(400, "VALIDATION_ERROR", "status is not a known value.");
    }

    const serverId = url.searchParams.get("serverId");
    const rawCursor = url.searchParams.get("cursor");

    if (rawCursor === null) {
      return { serverId, status, cursor: undefined };
    }

    const cursor = decodeKeysetCursor(rawCursor);
    if (!cursor) {
      return fail(400, "VALIDATION_ERROR", "cursor is not a valid cursor.");
    }

    return { serverId, status, cursor };
  },
  authorize: OMES_GUARDS.backups.read,
  handler: async ({ tx, tenantId, now, prepared }) =>
    ok(
      await fetchBackups(tx, tenantId, now, {
        serverId: prepared.serverId ?? undefined,
        status: prepared.status ?? undefined,
        cursor: prepared.cursor
      })
    )
});
