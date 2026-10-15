import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../../lib/security/request-body-limit";
import { confirmOwnBinding } from "../../../../../../modules/telegram-delivery/application/telegram-bindings";
import { enqueueActivationNotice } from "../../../../../../modules/telegram-delivery/application/telegram-enqueue";
import {
  parseConfirmBody,
  refuseNonInteractive
} from "../../../../../../modules/telegram-delivery/application/telegram-interactive-guard";
import { resolveTelegramHashRing } from "../../../../../../modules/telegram-delivery/domain/telegram-config";

/**
 * `POST /api/v1/telegram/bindings/me/confirm` (Issue #965, ADR-0140 section 3 step
 * 3) — "yes, that Telegram chat is me". The ONLY transition to `active`, and it
 * is only reachable from the staff member's own authenticated, INTERACTIVE
 * session (a machine credential is refused): a code that was forwarded, phished
 * or shoulder-surfed binds an attacker's chat at most to `pending_confirmation`,
 * and the prompt appears only here.
 *
 * Body `{ "bindingId": "<uuid>", "pin": "<6 digits>" }` (Issue #1008): the chat
 * the person was SHOWN, and the PIN the bot sent to THAT chat. The PIN is proof
 * of possession: the person has to read it in the chat they are binding. If a
 * newer code replaced the binding in the meantime the answer is 409, never a
 * confirmation of a chat they did not look at. A wrong PIN is `422
 * TELEGRAM_PIN_INVALID` and is counted in the database; the fifth wrong answer
 * ends the pending binding (`423 TELEGRAM_PIN_LOCKED`) and the person requests a
 * new link. The count does not depend on the rate limiter, which fails open when
 * Redis is down.
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

    const body = parseConfirmBody(prepared.payload);

    if (!body) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Request body must be an object with the `bindingId` you were shown, the 6-digit `pin` the bot sent, and nothing else."
      );
    }

    // Fail closed: without the ring no PIN can be verified.
    const hashRing = resolveTelegramHashRing();

    if (!hashRing.ok) {
      return fail(
        503,
        "TELEGRAM_MISCONFIGURED",
        "Telegram is not fully configured on this deployment."
      );
    }

    const result = await confirmOwnBinding(
      tx,
      tenantId,
      auth.context.tenantUserId,
      body.bindingId,
      body.pin,
      hashRing,
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

    if (result.outcome === "pin_invalid") {
      return fail(
        422,
        "TELEGRAM_PIN_INVALID",
        "That PIN is not right. Check the PIN the bot sent to your Telegram chat.",
        {},
        { attemptsLeft: result.attemptsLeft }
      );
    }

    if (result.outcome === "pin_locked") {
      return fail(
        423,
        "TELEGRAM_PIN_LOCKED",
        "Too many wrong PINs. The pending chat was unlinked; request a new link."
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
