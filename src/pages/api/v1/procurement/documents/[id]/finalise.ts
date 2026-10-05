import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { inventoryLedgerPortAdapter } from "../../../../../../modules/inventory/application/inventory-ledger-port-adapter";
import { finaliseDocument } from "../../../../../../modules/procurement/application/procurement-posting";
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

const IDEMPOTENCY_SCOPE = "procurement_document_finalise";

type Prepared = { id: string; idempotencyKey: string };

/**
 * `POST /api/v1/procurement/documents/{id}/finalise` — post the document's
 * inventory movements through the ledger's port and mark it `finalised`. The
 * HIGH-RISK step: `procurement.documents.finalise`, audited, and idempotent
 * twice over —
 *
 *   * `Idempotency-Key` is bound to the request hash, so the same key replays the
 *     stored response and a different body under it is a 409;
 *   * the document itself is the natural key: finalising an already `finalised`
 *     document answers 200 `replayed: true` and posts NOTHING, even under a new
 *     key.
 *
 * All lines post or none do: a ledger refusal on any line (`INSUFFICIENT_STOCK`,
 * an inactive location, a unit mismatch) rolls back every line and leaves the
 * document `submitted`. This route is the composition root the port contract
 * asks for: it authorizes, audits and passes the request's correlation id; the
 * ledger rows carry it.
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

    const body = await readValidatedBody(request, validateEmptyBody);

    return body instanceof Response ? body : { id, idempotencyKey };
  },
  authorize: PROCUREMENT_GUARDS.documents.finalise,
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
      { id: prepared.id },
      async () => {
        const result = await finaliseDocument(
          tx,
          inventoryLedgerPortAdapter,
          tenantId,
          prepared.id,
          {
            actorTenantUserId: auth.context.tenantUserId,
            correlationId: locals.correlationId
          }
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
