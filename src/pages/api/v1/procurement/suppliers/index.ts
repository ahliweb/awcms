import { created, fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  createSupplier,
  listSuppliers,
  parseSupplierCursor
} from "../../../../../modules/procurement/application/procurement-supplier-directory";
import {
  readSupplierFilters,
  readValidatedBody
} from "../../../../../modules/procurement/application/procurement-route-support";
import { authorizeInTransaction } from "../../../../../modules/identity-access/application/access-guard";
import { PROCUREMENT_GUARDS } from "../../../../../modules/procurement/domain/procurement-permissions";
import {
  validateCreateSupplier,
  type CreateSupplierInput
} from "../../../../../modules/procurement/domain/procurement-validation";

type ListPrepared = Exclude<
  ReturnType<typeof readSupplierFilters>,
  Response
> & {
  cursorValue: ReturnType<typeof parseSupplierCursor>;
};

/**
 * `GET /api/v1/procurement/suppliers` — this tenant's suppliers, newest first,
 * keyset paginated (`?cursor=`). Identifiers are NEVER in this response; the
 * identifiers endpoint returns them masked.
 */
export const GET = defineTenantRoute<ListPrepared>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const filters = readSupplierFilters(url);

    if (filters instanceof Response) {
      return filters;
    }

    const cursorValue = filters.cursor
      ? parseSupplierCursor(filters.cursor)
      : null;

    if (filters.cursor && !cursorValue) {
      return fail(400, "VALIDATION_ERROR", "cursor is not valid.");
    }

    return { ...filters, cursorValue };
  },
  authorize: PROCUREMENT_GUARDS.suppliers.read,
  handler: async ({ tx, tenantId, prepared, tokenHash, now }) => {
    // Soft-deleted suppliers are visible only to someone who may act on them.
    // `includeDeleted=true` through the chokepoint with `suppliers.restore` (the
    // power that needs to see a deleted row), so `suppliers.read` alone cannot
    // enumerate them and an attempt writes its own decision-log row.
    if (prepared.includeDeleted) {
      const deletedView = await authorizeInTransaction(
        tx,
        tenantId,
        tokenHash,
        now,
        PROCUREMENT_GUARDS.suppliers.restore
      );

      if (!deletedView.allowed) {
        return deletedView.denied;
      }
    }

    const page = await listSuppliers(
      tx,
      tenantId,
      prepared,
      prepared.cursorValue ?? undefined
    );

    return ok(page);
  }
});

/**
 * `POST /api/v1/procurement/suppliers` — register a supplier.
 *
 * No `Idempotency-Key`, deliberately: the case-insensitive `(tenant, vendor
 * code)` unique key already turns a retried create into a `409
 * VENDOR_CODE_CONFLICT`.
 */
export const POST = defineTenantRoute<CreateSupplierInput>({
  workClass: "interactive",
  prepare: ({ request }) => readValidatedBody(request, validateCreateSupplier),
  authorize: PROCUREMENT_GUARDS.suppliers.create,
  handler: async ({ tx, tenantId, auth, prepared, locals }) => {
    const result = await createSupplier(
      tx,
      tenantId,
      {
        actorTenantUserId: auth.context.tenantUserId,
        correlationId: locals.correlationId
      },
      prepared
    );

    switch (result.outcome) {
      case "ok":
        return created(result.supplier);
      case "duplicate_code":
        return fail(
          409,
          "VENDOR_CODE_CONFLICT",
          `A supplier with vendor code "${prepared.vendorCode}" already exists.`
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
