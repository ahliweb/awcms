import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  getDocument,
  replaceDraft
} from "../../../../../modules/procurement/application/procurement-document-directory";
import {
  asUuid,
  badId,
  documentFailureResponse,
  readValidatedBody
} from "../../../../../modules/procurement/application/procurement-route-support";
import { PROCUREMENT_GUARDS } from "../../../../../modules/procurement/domain/procurement-permissions";
import {
  validateCreateDocument,
  type CreateDocumentInput
} from "../../../../../modules/procurement/domain/procurement-validation";

/**
 * `GET /api/v1/procurement/documents/{id}` — the document, its line snapshots
 * and the ledger movements finalising/reversing it produced.
 */
export const GET = defineTenantRoute<string>({
  workClass: "interactive",
  prepare: ({ params }) => asUuid(params.id) ?? badId(),
  authorize: PROCUREMENT_GUARDS.documents.read,
  handler: async ({ tx, tenantId, prepared }) => {
    const document = await getDocument(tx, tenantId, prepared);

    return document
      ? ok(document)
      : fail(404, "RESOURCE_NOT_FOUND", "Document not found.");
  }
});

type PutPrepared = { id: string; input: CreateDocumentInput };

/**
 * `PUT /api/v1/procurement/documents/{id}` — replace a DRAFT's header and lines
 * wholesale (same body as create; `mode` must match and cannot change). Refused
 * with 409 once the document has left draft — the database also refuses it.
 */
export const PUT = defineTenantRoute<PutPrepared>({
  workClass: "interactive",
  prepare: async ({ request, params }) => {
    const id = asUuid(params.id);

    if (!id) {
      return badId();
    }

    const input = await readValidatedBody(request, validateCreateDocument);

    return input instanceof Response ? input : { id, input };
  },
  authorize: PROCUREMENT_GUARDS.documents.update,
  handler: async ({ tx, tenantId, auth, prepared, locals }) => {
    const result = await replaceDraft(
      tx,
      tenantId,
      prepared.id,
      {
        actorTenantUserId: auth.context.tenantUserId,
        correlationId: locals.correlationId
      },
      prepared.input,
      prepared.input.mode
    );

    return result.outcome === "ok"
      ? ok(result.document)
      : documentFailureResponse(result);
  }
});
