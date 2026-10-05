import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { cancelDocument } from "../../../../../../modules/procurement/application/procurement-document-directory";
import {
  asUuid,
  badId,
  documentFailureResponse,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../../modules/procurement/application/procurement-route-support";
import { PROCUREMENT_GUARDS } from "../../../../../../modules/procurement/domain/procurement-permissions";
import { validateReason } from "../../../../../../modules/procurement/domain/procurement-validation";

const IDEMPOTENCY_SCOPE = "procurement_document_cancel";

type Prepared = { id: string; idempotencyKey: string; reason: string };

/**
 * `POST /api/v1/procurement/documents/{id}/cancel` — abandon a `draft` or
 * `submitted` document. No stock was ever moved, so there is nothing to
 * compensate; a `finalised` document is reversed instead (409 here). A pending
 * approval is cancelled with it. HIGH-RISK (`cancel`), audited.
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

    const body = await readValidatedBody(request, validateReason(true));

    return body instanceof Response
      ? body
      : { id, idempotencyKey, reason: body.reason! };
  },
  authorize: PROCUREMENT_GUARDS.documents.cancel,
  handler: async ({ tx, tenantId, auth, prepared, locals }) =>
    runIdempotent(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      auth.context.tenantUserId,
      { id: prepared.id, reason: prepared.reason },
      async () => {
        const result = await cancelDocument(
          tx,
          tenantId,
          prepared.id,
          {
            actorTenantUserId: auth.context.tenantUserId,
            correlationId: locals.correlationId
          },
          prepared.reason
        );

        return result.outcome === "ok"
          ? { status: 200, body: result.document }
          : documentFailureResponse(result);
      }
    )
});
