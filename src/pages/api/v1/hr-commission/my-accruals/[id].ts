import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { getOwnAccrual } from "../../../../../modules/hr-commission/application/hr-commission-accrual-ledger";
import {
  asUuid,
  badId
} from "../../../../../modules/hr-commission/application/hr-commission-route-support";
import { HR_COMMISSION_GUARDS } from "../../../../../modules/hr-commission/domain/hr-commission-permissions";

type IdPrepared = { id: string };

/**
 * `GET /api/v1/hr-commission/my-accruals/{id}` -- one of the caller's OWN
 * accruals with its transition history (Issue #952). An id that does not exist
 * and an id that belongs to somebody else are the same 404, so the route cannot
 * be used to learn that another person earned a commission.
 */
export const GET = defineTenantRoute<IdPrepared>({
  workClass: "interactive",
  prepare: ({ params }) => {
    const id = asUuid(params.id);

    return id ? { id } : badId();
  },
  authorize: HR_COMMISSION_GUARDS.myAccruals.read,
  handler: async ({ tx, tenantId, auth, prepared }) => {
    const found = await getOwnAccrual(
      tx,
      tenantId,
      auth.context.tenantUserId,
      prepared.id
    );

    return found
      ? ok(found, {}, { "cache-control": "private, no-store" })
      : fail(404, "RESOURCE_NOT_FOUND", "Commission accrual not found.");
  }
});
