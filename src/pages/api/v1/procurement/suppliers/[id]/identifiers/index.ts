import {
  created,
  fail,
  ok
} from "../../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../../modules/_shared/tenant-route";
import {
  addIdentifier,
  listIdentifiers
} from "../../../../../../../modules/procurement/application/procurement-supplier-directory";
import {
  asUuid,
  badId,
  readValidatedBody
} from "../../../../../../../modules/procurement/application/procurement-route-support";
import { PROCUREMENT_GUARDS } from "../../../../../../../modules/procurement/domain/procurement-permissions";
import {
  validateAddIdentifier,
  type AddIdentifierInput
} from "../../../../../../../modules/procurement/domain/procurement-validation";

/**
 * `GET /api/v1/procurement/suppliers/{id}/identifiers` — the supplier's tax and
 * business identifiers and payment/contact references, MASKED. The value is
 * returned only by the audited `.../reveal` endpoint.
 */
export const GET = defineTenantRoute<string>({
  workClass: "interactive",
  prepare: ({ params }) => asUuid(params.id) ?? badId(),
  authorize: PROCUREMENT_GUARDS.suppliers.read,
  handler: async ({ tx, tenantId, prepared }) => {
    const identifiers = await listIdentifiers(tx, tenantId, prepared);

    return identifiers
      ? ok(identifiers)
      : fail(404, "RESOURCE_NOT_FOUND", "Supplier not found.");
  }
});

type PostPrepared = { id: string; input: AddIdentifierInput };

/**
 * `POST /api/v1/procurement/suppliers/{id}/identifiers` — add an identifier. The
 * response is a UNIFORM minimal acknowledgement (type, label, maskedValue, classification — no id, no timestamp). The add is IDEMPOTENT: a duplicate (same type and value)
 * returns the same masked success shape and never a second row (audit M1).
 */
export const POST = defineTenantRoute<PostPrepared>({
  workClass: "interactive",
  prepare: async ({ request, params }) => {
    const id = asUuid(params.id);

    if (!id) {
      return badId();
    }

    const input = await readValidatedBody(request, validateAddIdentifier);

    return input instanceof Response ? input : { id, input };
  },
  authorize: PROCUREMENT_GUARDS.suppliers.update,
  handler: async ({ tx, tenantId, auth, prepared, locals }) => {
    const result = await addIdentifier(
      tx,
      tenantId,
      prepared.id,
      {
        actorTenantUserId: auth.context.tenantUserId,
        correlationId: locals.correlationId
      },
      prepared.input
    );

    switch (result.outcome) {
      case "ok":
        return created(result.acknowledgement);
      case "supplier_not_found":
        return fail(404, "RESOURCE_NOT_FOUND", "Supplier not found.");
      case "supplier_deleted":
        return fail(
          409,
          "SUPPLIER_DELETED",
          "The supplier is soft-deleted; restore it before editing."
        );
    }
  }
});
