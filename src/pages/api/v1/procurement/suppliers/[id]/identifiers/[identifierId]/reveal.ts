import {
  fail,
  jsonResponse
} from "../../../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../../../modules/_shared/tenant-route";
import { revealIdentifier } from "../../../../../../../../modules/procurement/application/procurement-supplier-directory";
import {
  asUuid,
  badId
} from "../../../../../../../../modules/procurement/application/procurement-route-support";
import { PROCUREMENT_GUARDS } from "../../../../../../../../modules/procurement/domain/procurement-permissions";

type Prepared = { id: string; identifierId: string };

/**
 * `POST /api/v1/procurement/suppliers/{id}/identifiers/{identifierId}/reveal` —
 * the ONLY endpoint that returns a supplier identifier or payment/contact
 * reference in clear text.
 *
 * Needs `procurement.suppliers.reveal` — NOT implied by `suppliers.read` or
 * `.update` — and writes a warning-severity audit row naming the identifier
 * (never its value) in the same transaction. POST rather than GET so no cache,
 * proxy or access log treats the response as a replayable read, and the response
 * is `no-store`.
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: ({ params }) => {
    const id = asUuid(params.id);
    const identifierId = asUuid(params.identifierId);

    return id && identifierId
      ? { id, identifierId }
      : badId("id and identifierId");
  },
  authorize: PROCUREMENT_GUARDS.suppliers.reveal,
  handler: async ({ tx, tenantId, auth, prepared, locals }) => {
    const revealed = await revealIdentifier(
      tx,
      tenantId,
      prepared.id,
      prepared.identifierId,
      {
        actorTenantUserId: auth.context.tenantUserId,
        correlationId: locals.correlationId
      }
    );

    if (!revealed) {
      return fail(404, "RESOURCE_NOT_FOUND", "Identifier not found.");
    }

    return jsonResponse(
      { success: true, data: revealed, meta: {} },
      { headers: { "cache-control": "no-store" } }
    );
  }
});
