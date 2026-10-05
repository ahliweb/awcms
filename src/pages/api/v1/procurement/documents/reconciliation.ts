import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { reconcileDocuments } from "../../../../../modules/procurement/application/procurement-reporting";
import { asUuid } from "../../../../../modules/procurement/application/procurement-route-support";
import { PROCUREMENT_GUARDS } from "../../../../../modules/procurement/domain/procurement-permissions";

/**
 * `GET /api/v1/procurement/documents/reconciliation` — read-only proof that
 * every finalised (and reversed) document agrees with the inventory ledger: the
 * right movements, of the right type, at the right location, in the right
 * quantity, under the document's identity — and that no ledger row carries a
 * procurement identity without a document line behind it. `?documentId=` scopes
 * it to one document. Writes nothing.
 */
export const GET = defineTenantRoute<string | null>({
  workClass: "reporting",
  prepare: ({ url }) => {
    const raw = url.searchParams.get("documentId");

    if (raw === null) {
      return null;
    }

    return (
      asUuid(raw) ?? fail(400, "VALIDATION_ERROR", "documentId must be a UUID.")
    );
  },
  authorize: PROCUREMENT_GUARDS.documents.reconcile,
  handler: async ({ tx, tenantId, prepared }) =>
    ok(await reconcileDocuments(tx, tenantId, prepared))
});
