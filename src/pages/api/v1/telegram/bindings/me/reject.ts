import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../../lib/security/request-body-limit";
import { rejectOwnBinding } from "../../../../../../modules/telegram-delivery/application/telegram-bindings";
import {
  parseBindingIdBody,
  refuseNonInteractive
} from "../../../../../../modules/telegram-delivery/application/telegram-interactive-guard";

/**
 * `POST /api/v1/telegram/bindings/me/reject` (Issue #965, ADR-0140 section 3 step
 * 3) — "that Telegram chat is NOT me". Ends the pending binding at once, erases
 * its ciphertext and the captured display name, and audits it at `warning`: it
 * means a link code reached somebody else's chat. Interactive sessions only.
 *
 * Body `{ "bindingId": "<uuid>" }`: the chat the person was shown; a different
 * pending chat is a 409 and is left untouched.
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

    const result = await rejectOwnBinding(
      tx,
      tenantId,
      auth.context.tenantUserId,
      bindingId,
      { correlationId: locals.correlationId }
    );

    if (result.mismatch) {
      return fail(
        409,
        "TELEGRAM_BINDING_MISMATCH",
        "The chat waiting for confirmation is not the one you were shown. Reload the page and check it again."
      );
    }

    if (!result.rejected) {
      return fail(
        404,
        "RESOURCE_NOT_FOUND",
        "There is no Telegram chat waiting for your confirmation."
      );
    }

    return ok({ rejected: true });
  }
});
