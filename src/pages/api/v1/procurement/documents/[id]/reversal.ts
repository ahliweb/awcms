import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { inventoryLedgerPortAdapter } from "../../../../../../modules/inventory/application/inventory-ledger-port-adapter";
import { reverseDocument } from "../../../../../../modules/procurement/application/procurement-posting";
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

const IDEMPOTENCY_SCOPE = "procurement_document_reverse";

type Prepared = { id: string; idempotencyKey: string; reason: string };

/**
 * `POST /api/v1/procurement/documents/{id}/reversal` — compensate a FINALISED
 * document with opposite inventory movements (a receipt becomes a supplier
 * return, a supplier return a receipt, a transfer a transfer back) and mark it
 * `reversed`. The original movements are never touched — the ledger is
 * append-only. HIGH-RISK and separately grantable from `finalise`.
 *
 * Reversal can be refused by the ledger (`INSUFFICIENT_STOCK` when the received
 * stock has since been sold and the negative-stock policy forbids going below
 * zero); then nothing is posted and the document stays `finalised`. Reversing an
 * already `reversed` document replays (200) and posts nothing.
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "critical_transaction",
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
  authorize: PROCUREMENT_GUARDS.documents.reverse,
  handler: async ({ tx, tenantId, auth, prepared, locals }) => {
    // The finalise/reverse stamp names WHO did it (a NOT NULL fact in the
    // schema). A principal with no tenant user id cannot be stamped, so refuse
    // cleanly here instead of letting the CHECK (23514) surface as a 500.
    if (!auth.context.tenantUserId) {
      return fail(
        403,
        "ACTOR_REQUIRED",
        "This action must be performed by a tenant user."
      );
    }

    return runIdempotent(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      auth.context.tenantUserId,
      { id: prepared.id, reason: prepared.reason },
      async () => {
        const result = await reverseDocument(
          tx,
          inventoryLedgerPortAdapter,
          tenantId,
          prepared.id,
          {
            actorTenantUserId: auth.context.tenantUserId,
            correlationId: locals.correlationId
          },
          prepared.reason
        );

        return result.outcome === "ok"
          ? {
              status: result.replayed ? 200 : 201,
              body: { replayed: result.replayed, document: result.document }
            }
          : documentFailureResponse(result);
      }
    );
  }
});
