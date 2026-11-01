import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  listIntakeExceptions,
  parseExceptionCursor
} from "../../../../../modules/hr-commission/application/hr-commission-intake-store";
import { HR_COMMISSION_GUARDS } from "../../../../../modules/hr-commission/domain/hr-commission-permissions";

type Prepared = { cursor: ReturnType<typeof parseExceptionCursor> };

/**
 * `GET /api/v1/hr-commission/intake/exceptions` (Issue #1189, ADR-0147 section
 * 5) -- the commission intake requests that need a human: those the ledger
 * REFUSED (`source_conflict`, `no_effective_rule`, `period_closed`, ...) and
 * those that FAILED after the poster's retries. Newest settlement first, keyset
 * paginated (`?cursor=`), plus a `summary` with the queue's counts per status and
 * how long the oldest live row has waited (the poster's diagnostics).
 *
 * Read-only. An outcome CODE and MASKED ids only: no amount, no rule, no actor,
 * no unmasked source reference. Gated by `hr_commission.intake.read`, which
 * opens no accrual.
 */
export const GET = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const cursorText = url.searchParams.get("cursor");
    const cursor = cursorText ? parseExceptionCursor(cursorText) : null;

    if (cursorText && !cursor) {
      return fail(400, "VALIDATION_ERROR", "cursor is not valid.");
    }

    return { cursor };
  },
  authorize: HR_COMMISSION_GUARDS.intake.read,
  handler: async ({ tx, tenantId, prepared }) =>
    ok(await listIntakeExceptions(tx, tenantId, prepared.cursor ?? undefined))
});
