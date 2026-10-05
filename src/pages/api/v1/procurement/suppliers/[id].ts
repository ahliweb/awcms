import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  getSupplier,
  softDeleteSupplier,
  updateSupplier
} from "../../../../../modules/procurement/application/procurement-supplier-directory";
import {
  asUuid,
  badId,
  readValidatedBody
} from "../../../../../modules/procurement/application/procurement-route-support";
import { PROCUREMENT_GUARDS } from "../../../../../modules/procurement/domain/procurement-permissions";
import {
  validateReason,
  validateUpdateSupplier,
  type UpdateSupplierInput
} from "../../../../../modules/procurement/domain/procurement-validation";

/** `GET /api/v1/procurement/suppliers/{id}` — a soft-deleted supplier is a 404 here. */
export const GET = defineTenantRoute<string>({
  workClass: "interactive",
  prepare: ({ params }) => asUuid(params.id) ?? badId(),
  authorize: PROCUREMENT_GUARDS.suppliers.read,
  handler: async ({ tx, tenantId, prepared }) => {
    const supplier = await getSupplier(tx, tenantId, prepared);

    return supplier
      ? ok(supplier)
      : fail(404, "RESOURCE_NOT_FOUND", "Supplier not found.");
  }
});

type PatchPrepared = { id: string; patch: UpdateSupplierInput };

/**
 * `PATCH /api/v1/procurement/suppliers/{id}` — rename, change status, attach or
 * detach the canonical party, replace categories/tags. A document already
 * written keeps the supplier name it snapshotted.
 */
export const PATCH = defineTenantRoute<PatchPrepared>({
  workClass: "interactive",
  prepare: async ({ request, params }) => {
    const id = asUuid(params.id);

    if (!id) {
      return badId();
    }

    const patch = await readValidatedBody(request, validateUpdateSupplier);

    return patch instanceof Response ? patch : { id, patch };
  },
  authorize: PROCUREMENT_GUARDS.suppliers.update,
  handler: async ({ tx, tenantId, auth, prepared, locals }) => {
    const result = await updateSupplier(
      tx,
      tenantId,
      prepared.id,
      {
        actorTenantUserId: auth.context.tenantUserId,
        correlationId: locals.correlationId
      },
      prepared.patch
    );

    switch (result.outcome) {
      case "ok":
        return ok(result.supplier);
      case "not_found":
        return fail(404, "RESOURCE_NOT_FOUND", "Supplier not found.");
      case "deleted":
        return fail(
          409,
          "SUPPLIER_DELETED",
          "The supplier is soft-deleted; restore it before editing."
        );
      case "profile_not_found":
        return fail(
          422,
          "PROFILE_NOT_FOUND",
          "profileId does not name a party in this tenant."
        );
      default:
        return fail(500, "INTERNAL_ERROR", "Unexpected outcome.");
    }
  }
});

type DeletePrepared = { id: string; reason: string | null };

/**
 * `DELETE /api/v1/procurement/suppliers/{id}` — SOFT delete (an optional
 * `{"reason"}` body). Refused while the supplier has a draft or submitted
 * document. Documents keep referencing the row; restore is a separate
 * permission.
 */
export const DELETE = defineTenantRoute<DeletePrepared>({
  workClass: "interactive",
  prepare: async ({ request, params }) => {
    const id = asUuid(params.id);

    if (!id) {
      return badId();
    }

    const body = await readValidatedBody(request, validateReason(false));

    return body instanceof Response ? body : { id, reason: body.reason };
  },
  authorize: PROCUREMENT_GUARDS.suppliers.delete,
  handler: async ({ tx, tenantId, auth, prepared, locals }) => {
    const result = await softDeleteSupplier(
      tx,
      tenantId,
      prepared.id,
      {
        actorTenantUserId: auth.context.tenantUserId,
        correlationId: locals.correlationId
      },
      prepared.reason
    );

    switch (result.outcome) {
      case "ok":
        return ok(result.supplier);
      case "not_found":
        return fail(404, "RESOURCE_NOT_FOUND", "Supplier not found.");
      case "already_deleted":
        return fail(
          409,
          "SUPPLIER_DELETED",
          "The supplier is already deleted."
        );
      case "has_open_documents":
        return fail(
          409,
          "SUPPLIER_HAS_OPEN_DOCUMENTS",
          "The supplier has draft or submitted documents; finalise or cancel them first."
        );
      default:
        return fail(500, "INTERNAL_ERROR", "Unexpected outcome.");
    }
  }
});
