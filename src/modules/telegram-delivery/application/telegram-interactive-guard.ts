/**
 * Guards for the routes where a staff member manages THEIR OWN chat (Issue #965,
 * ADR-0140 section 3; audit M1).
 *
 * `links.create` is an ordinary permission, so a write-class machine credential
 * (ADR-0092) can hold it. A credential must never mint a link code, read the
 * captured Telegram name, or confirm, reject or revoke a binding: the whole
 * handshake is "the PERSON, in THEIR session, says this chat is theirs", and a
 * service account is not a person. So these handlers refuse any principal that
 * arrived by machine credential, after authorization (an unauthorised caller
 * learns nothing about this rule) and before any work.
 */
import { fail } from "../../_shared/api-response";
import { isWellFormedPin } from "../domain/telegram-pin";

export function refuseNonInteractive(context: {
  viaMachineCredential?: boolean;
}): Response | null {
  if (context.viaMachineCredential === true) {
    return fail(
      403,
      "INTERACTIVE_SESSION_REQUIRED",
      "Linking a Telegram chat needs a signed-in person; a machine credential cannot do it."
    );
  }

  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `{ "bindingId": "<uuid>" }` and nothing else, or `null`. */
export function parseBindingIdBody(payload: unknown): string | null {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload) ||
    Object.keys(payload).some((key) => key !== "bindingId")
  ) {
    return null;
  }

  const value = (payload as { bindingId?: unknown }).bindingId;

  return typeof value === "string" && UUID.test(value)
    ? value.toLowerCase()
    : null;
}

/** `{ "bindingId": "<uuid>", "pin": "<6 digits>" }` and nothing else, or `null` (Issue #1008). */
export function parseConfirmBody(
  payload: unknown
): { bindingId: string; pin: string } | null {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload) ||
    Object.keys(payload).some((key) => key !== "bindingId" && key !== "pin")
  ) {
    return null;
  }

  const { bindingId, pin } = payload as { bindingId?: unknown; pin?: unknown };

  if (
    typeof bindingId !== "string" ||
    !UUID.test(bindingId) ||
    !isWellFormedPin(pin)
  ) {
    return null;
  }

  return { bindingId: bindingId.toLowerCase(), pin };
}
