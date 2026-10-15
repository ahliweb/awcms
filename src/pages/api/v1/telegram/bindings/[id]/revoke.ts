import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  auditEndedBindings,
  endBindings
} from "../../../../../../modules/telegram-delivery/application/telegram-bindings";
import {
  readIdempotencyKey,
  refuseMachineCredential,
  runTelegramIdempotent,
  TELEGRAM_BINDING_REVOKE_IDEMPOTENCY_SCOPE
} from "../../../../../../modules/telegram-delivery/application/telegram-idempotency";
import { isTelegramRecordId } from "../../../../../../modules/telegram-delivery/domain/telegram-record-id";

/**
 * `POST /api/v1/telegram/bindings/{id}/revoke` (Issue #965, ADR-0140 section 3) —
 * an administrator revokes ANOTHER staff member's binding. High-risk
 * (`bindings.revoke` is in `HIGH_RISK_ACTIONS` via `revoke`): the stored chat id
 * is erased and the queue cancelled at once, and the audit row is `warning`
 * because it removes a person's alert channel. The chat appears only as its mask.
 *
 * `Idempotency-Key` REQUIRED (Issue #1008, L12). The effect was always safe to
 * repeat, but the ANSWER was not: a retry of a revoke whose response was lost
 * found nothing live and said 404, which a client reads as failure. With a key the
 * retry replays the stored 200. A refusal is not stored. One answer for "no such
 * binding" and "already ended" so the id space is not an oracle.
 *
 * A machine credential is refused (decided in #1008): the key is filed per
 * acting person (ADR-0145), and the authorised context does not carry a
 * credential's id. Revoking by automation remains possible by deactivating the
 * principal, which ends its binding on the next sweep.
 */
export const POST = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: "telegram_delivery",
    activityCode: "bindings",
    action: "revoke"
  },
  handler: async ({ tx, tenantId, auth, params, locals, request }) => {
    const refused = refuseMachineCredential(auth.context);

    if (refused) {
      return refused;
    }

    const bindingId = params.id;

    if (!isTelegramRecordId(bindingId)) {
      return fail(400, "VALIDATION_ERROR", "Binding id must be a uuid.");
    }

    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    return runTelegramIdempotent(
      tx,
      tenantId,
      TELEGRAM_BINDING_REVOKE_IDEMPOTENCY_SCOPE,
      idempotencyKey,
      auth.context.tenantUserId,
      { bindingId },
      async () => {
        const ended = await endBindings(tx, tenantId, { bindingId }, "admin", {
          actorTenantUserId: auth.context.tenantUserId
        });

        if (ended.ended.length === 0) {
          return fail(
            404,
            "RESOURCE_NOT_FOUND",
            "That Telegram binding does not exist or has already ended."
          );
        }

        await auditEndedBindings(tx, tenantId, ended, "admin", {
          actorTenantUserId: auth.context.tenantUserId,
          correlationId: locals.correlationId
        });

        return {
          body: { revoked: true, cancelledMessages: ended.cancelledMessages }
        };
      }
    );
  }
});
