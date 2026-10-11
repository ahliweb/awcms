import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { transitionAccrual } from "../../../../../../modules/hr-commission/application/hr-commission-accrual-ledger";
import { transitionRefusal } from "../../../../../../modules/hr-commission/application/hr-commission-accrual-route-support";
import {
  asUuid,
  badId,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../../modules/hr-commission/application/hr-commission-route-support";
import { validatePayBody } from "../../../../../../modules/hr-commission/domain/hr-commission-accrual-validation";
import { HR_COMMISSION_GUARDS } from "../../../../../../modules/hr-commission/domain/hr-commission-permissions";

type Prepared = {
  id: string;
  idempotencyKey: string;
  extras: { paymentReference: string | null };
};

const SCOPE = "hr_commission_accrual_pay";

/**
 * `POST /api/v1/hr-commission/accruals/{id}/pay` — record that a PAYABLE accrual has been paid. Terminal. The optional `paymentReference` is an opaque reference (a payout batch), never an account number. High-risk, audited at
 * warning severity (never with an amount), idempotent: replaying the same key
 * returns the stored response. A transition the accrual's status does not allow
 * is 409 `ACCRUAL_INVALID_STATE`.
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request, params }) => {
    const id = asUuid(params.id);

    if (!id) {
      return badId();
    }

    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const body = await readValidatedBody(request, validatePayBody);

    return body instanceof Response
      ? body
      : {
          id,
          idempotencyKey,
          extras: { paymentReference: body.paymentReference }
        };
  },
  authorize: HR_COMMISSION_GUARDS.accruals.pay,
  handler: async ({ tx, tenantId, auth, prepared, locals }) =>
    runIdempotent(
      tx,
      tenantId,
      SCOPE,
      prepared.idempotencyKey,
      auth.context.tenantUserId,
      { id: prepared.id, ...prepared.extras },
      async () => {
        const result = await transitionAccrual(
          tx,
          tenantId,
          prepared.id,
          "pay",
          {
            actorTenantUserId: auth.context.tenantUserId,
            correlationId: locals.correlationId
          },
          prepared.extras
        );
        const refusal = transitionRefusal("pay", result);

        if (refusal) {
          return refusal;
        }

        if (result.outcome !== "ok") {
          throw new Error("unreachable: transition refusal handled above");
        }

        return { status: 200, body: result.accrual };
      }
    )
});
