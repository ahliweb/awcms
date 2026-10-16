import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  listOwnAccruals,
  parseAccrualCursor
} from "../../../../../modules/hr-commission/application/hr-commission-accrual-ledger";
import {
  isAccrualStatus,
  type AccrualStatus
} from "../../../../../modules/hr-commission/domain/hr-commission-accrual-state";
import { HR_COMMISSION_GUARDS } from "../../../../../modules/hr-commission/domain/hr-commission-permissions";

type Prepared = {
  status?: AccrualStatus;
  cursor: ReturnType<typeof parseAccrualCursor>;
};

/**
 * `GET /api/v1/hr-commission/my-accruals` -- the caller's OWN commission
 * accruals, newest first, keyset paginated (Issue #952). Read-only.
 *
 * Gated by `hr_commission.my_accruals.read`. There is no `employmentId` and no
 * person parameter: the query joins the live employment linked to the caller's
 * login, so another person's rows cannot be asked for. The view omits the
 * approver, the payer and the payment reference. An employee reading their own
 * earnings is not an audited sensitive read (the owner-reads-own precedent of
 * `payslips.read`, `sensitive-reads.ts`); anyone else's earnings still go
 * through `GET /accruals`, which is. Never cached.
 */
export const GET = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const status = url.searchParams.get("status");
    const cursorText = url.searchParams.get("cursor");

    if (status && !isAccrualStatus(status)) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "status must be pending, approved, payable, paid or voided."
      );
    }

    const cursor = cursorText ? parseAccrualCursor(cursorText) : null;

    if (cursorText && !cursor) {
      return fail(400, "VALIDATION_ERROR", "cursor is not valid.");
    }

    return { status: (status as AccrualStatus | null) || undefined, cursor };
  },
  authorize: HR_COMMISSION_GUARDS.myAccruals.read,
  handler: async ({ tx, tenantId, auth, prepared }) =>
    ok(
      await listOwnAccruals(
        tx,
        tenantId,
        auth.context.tenantUserId,
        { status: prepared.status },
        prepared.cursor ?? undefined
      ),
      {},
      { "cache-control": "private, no-store" }
    )
});
