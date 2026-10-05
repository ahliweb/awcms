import { fail, ok } from "../../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../../modules/_shared/tenant-route";
import { removeIdentifier } from "../../../../../../../modules/procurement/application/procurement-supplier-directory";
import {
  asUuid,
  badId
} from "../../../../../../../modules/procurement/application/procurement-route-support";
import { PROCUREMENT_GUARDS } from "../../../../../../../modules/procurement/domain/procurement-permissions";

type Prepared = { id: string; identifierId: string };

/**
 * `DELETE /api/v1/procurement/suppliers/{id}/identifiers/{identifierId}` —
 * remove an identifier or reference (a mutable reference, not a ledger row).
 * Audited at warning severity; the audit row names the identifier, never its value.
 */
export const DELETE = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: ({ params }) => {
    const id = asUuid(params.id);
    const identifierId = asUuid(params.identifierId);

    return id && identifierId
      ? { id, identifierId }
      : badId("id and identifierId");
  },
  authorize: PROCUREMENT_GUARDS.suppliers.update,
  handler: async ({ tx, tenantId, auth, prepared, locals }) => {
    const result = await removeIdentifier(
      tx,
      tenantId,
      prepared.id,
      prepared.identifierId,
      {
        actorTenantUserId: auth.context.tenantUserId,
        correlationId: locals.correlationId
      }
    );

    return result === "removed"
      ? ok({ removed: true })
      : fail(404, "RESOURCE_NOT_FOUND", "Identifier not found.");
  }
});
