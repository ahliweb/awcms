import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import { decodeKeysetCursor } from "../../../../../modules/_shared/keyset-pagination";
import type { KeysetCursor } from "../../../../../modules/_shared/keyset-pagination";
import { OMES_GUARDS } from "../../../../../modules/omes-control/domain/permissions";
import { fetchAuditProjections } from "../../../../../modules/omes-control/application/audit-directory";

/**
 * `GET /api/v1/omes/audit` (Issue ahliweb/omes#198) — the PROJECTION of
 * remote OMES host execution/reconciliation evidence
 * (`awcms_omes_audit_projections`), keyset-paginated. Distinct from AWCMS's
 * own `awcms_audit_events` (this API's own authorization/mutation decision
 * log, written via `recordAuditEvent` on every mutating route in this
 * module) — see `application/audit-directory.ts`'s header.
 */
type Prepared = {
  serverId: string | null;
  eventType: string | null;
  cursor: KeysetCursor | undefined;
};

export const GET = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: ({ url }): Prepared | Response => {
    const serverId = url.searchParams.get("serverId");
    const eventType = url.searchParams.get("eventType");
    const rawCursor = url.searchParams.get("cursor");

    if (rawCursor === null) {
      return { serverId, eventType, cursor: undefined };
    }

    const cursor = decodeKeysetCursor(rawCursor);
    if (!cursor) {
      return fail(400, "VALIDATION_ERROR", "cursor is not a valid cursor.");
    }

    return { serverId, eventType, cursor };
  },
  authorize: OMES_GUARDS.audit.read,
  handler: async ({ tx, tenantId, prepared }) =>
    ok(
      await fetchAuditProjections(tx, tenantId, {
        serverId: prepared.serverId ?? undefined,
        eventType: prepared.eventType ?? undefined,
        cursor: prepared.cursor
      })
    )
});
