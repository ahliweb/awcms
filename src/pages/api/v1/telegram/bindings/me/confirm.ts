import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../../lib/security/request-body-limit";
import { confirmOwnBinding } from "../../../../../../modules/telegram-delivery/application/telegram-bindings";
import { enqueueActivationNotice } from "../../../../../../modules/telegram-delivery/application/telegram-enqueue";
import {
  parseBindingIdBody,
  refuseNonInteractive
} from "../../../../../../modules/telegram-delivery/application/telegram-interactive-guard";

/**
 * `POST /api/v1/telegram/bindings/me/confirm` (Issue #965, ADR-0140 section 3 step
 * 3) — "yes, that Telegram chat is me". The ONLY transition to `active`, and it
 * is only reachable from the staff member's own authenticated, INTERACTIVE
 * session (a machine credential is refused): a code that was forwarded, phished
 * or shoulder-surfed binds an attacker's chat at most to `pending_confirmation`,
 * and the prompt appears only here.
 *
 * Body `{ "bindingId": "<uuid>" }`: the chat the person was SHOWN. If a newer
 * code replaced it in the meantime the answer is 409, never a confirmation of a
 * chat they did not look at.
 *
 * Confirming replaces any binding the person already had (audited as a re-bind)
 * and queues one notice to the new chat saying which tenant it is now tied to.
 * Naturally idempotent: with nothing pending the answer is 404, so a double
 * click cannot confirm twice.
 */
export const POST = defineTenantRoute<{ payload: unknown }>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const read = await readJsonBody(request);

    if (read.tooLarge) {
      return bodyTooLargeResponse(read.limitBytes);
    }

    if (read.malformed) {
      return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
    }

    return { payload: read.value };
  },
  authorize: {
    moduleKey: "telegram_delivery",
    activityCode: "links",
    action: "create"
  },
  handler: async ({ tx, tenantId, auth, prepared, locals }) => {
    const refused = refuseNonInteractive(auth.context);

    if (refused) {
      return refused;
    }

    const bindingId = parseBindingIdBody(prepared.payload);

    if (!bindingId) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Request body must be an object with the `bindingId` you were shown and nothing else."
      );
    }

    const result = await confirmOwnBinding(
      tx,
      tenantId,
      auth.context.tenantUserId,
      bindingId,
      { correlationId: locals.correlationId }
    );

    if (result.outcome === "none") {
      return fail(
        404,
        "RESOURCE_NOT_FOUND",
        "There is no Telegram chat waiting for your confirmation. It may have expired; request a new link."
      );
    }

    if (result.outcome === "mismatch") {
      return fail(
        409,
        "TELEGRAM_BINDING_MISMATCH",
        "The chat waiting for confirmation is not the one you were shown. Reload the page and check it again."
      );
    }

    await enqueueActivationNotice(tx, {
      tenantId,
      principalId: auth.context.tenantUserId,
      bindingId: result.bindingId,
      correlationId: locals.correlationId
    });

    return ok({
      confirmed: true,
      replacedPrevious: result.replacedBindingId !== null
    });
  }
});
