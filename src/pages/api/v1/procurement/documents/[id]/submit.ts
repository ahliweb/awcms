import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { submitDocument } from "../../../../../../modules/procurement/application/procurement-document-directory";
import {
  asUuid,
  badId,
  documentFailureResponse,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../../modules/procurement/application/procurement-route-support";
import { PROCUREMENT_GUARDS } from "../../../../../../modules/procurement/domain/procurement-permissions";
import { validateEmptyBody } from "../../../../../../modules/procurement/domain/procurement-validation";

const IDEMPOTENCY_SCOPE = "procurement_document_submit";

type Prepared = { id: string; idempotencyKey: string };

/**
 * `POST /api/v1/procurement/documents/{id}/submit` — freeze a draft. The lines
 * become immutable (database trigger), the total cost is computed from them in
 * SQL, and — when the tenant set an approval threshold and the total reaches it —
 * a `workflow_approval` instance is started under the workflow key
 * `procurement.document_approval`. With no published definition for that key the
 * submit is REFUSED (fail closed): a document that needs approval is never
 * silently treated as approved.
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

    const body = await readValidatedBody(request, validateEmptyBody);

    return body instanceof Response ? body : { id, idempotencyKey };
  },
  authorize: PROCUREMENT_GUARDS.documents.submit,
  handler: async ({ tx, tenantId, auth, prepared, locals, now }) =>
    runIdempotent(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      auth.context.tenantUserId,
      { id: prepared.id },
      async () => {
        const result = await submitDocument(
          tx,
          tenantId,
          prepared.id,
          {
            actorTenantUserId: auth.context.tenantUserId,
            correlationId: locals.correlationId
          },
          now
        );

        switch (result.outcome) {
          case "ok":
            return { status: 200, body: result.document };
          case "approval_workflow_not_configured":
            return fail(
              409,
              "APPROVAL_WORKFLOW_NOT_CONFIGURED",
              "This document needs approval but no active workflow named procurement.document_approval is published. Nothing was submitted."
            );
          case "approval_facts_invalid":
            return fail(
              409,
              "APPROVAL_WORKFLOW_MISCONFIGURED",
              "The procurement.document_approval workflow does not declare the facts procurement supplies (mode, totalCost, currencyCode).",
              {},
              result.errors
            );
          default:
            return documentFailureResponse(result);
        }
      }
    )
});
