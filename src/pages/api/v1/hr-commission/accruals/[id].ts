import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { getAccrual } from "../../../../../modules/hr-commission/application/hr-commission-accrual-ledger";
import {
  asUuid,
  badId
} from "../../../../../modules/hr-commission/application/hr-commission-route-support";
import { HR_COMMISSION_GUARDS } from "../../../../../modules/hr-commission/domain/hr-commission-permissions";

type IdPrepared = { id: string };

/** `GET /api/v1/hr-commission/accruals/{id}` — one accrual with its transition history. */
export const GET = defineTenantRoute<IdPrepared>({
  workClass: "interactive",
  prepare: ({ params }) => {
    const id = asUuid(params.id);

    return id ? { id } : badId();
  },
  authorize: HR_COMMISSION_GUARDS.accruals.read,
  handler: async ({ tx, tenantId, prepared }) => {
    const found = await getAccrual(tx, tenantId, prepared.id);

    return found
      ? ok(found)
      : fail(404, "RESOURCE_NOT_FOUND", "Commission accrual not found.");
  }
});
