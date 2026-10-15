/**
 * `Idempotency-Key` plumbing for the two administrator mutations of this module
 * (Issue #1008, L12): `PUT /api/v1/telegram/settings` and
 * `POST /api/v1/telegram/bindings/{id}/revoke`.
 *
 * Both used to rely on being idempotent "by nature", and that holds for the
 * STATE but not for the ANSWER: a revoke whose response was lost and is retried
 * finds nothing live and answers `404`, which reads to the client as "it failed".
 * With a key, the retry replays the stored `200`.
 *
 * ## The actor is always a person
 *
 * The key is scoped per actor (ADR-0145). The authorised context does not expose
 * a machine credential's id, so a machine caller could only be filed under its
 * linked account's user namespace, sharing it with that person's own session.
 * Both routes therefore refuse a machine credential (`refuseMachineCredential`),
 * which also matches the rest of this module: the Telegram channel is switched
 * and its bindings revoked by an accountable person. Revoking by automation is
 * still possible without a credential: deactivating the principal ends its
 * binding on the next sweep (`principal_deactivated`).
 *
 * Refusals are not stored: the caller fixes something and retries.
 */
import { fail, jsonResponse } from "../../_shared/api-response";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord,
  userIdempotencyActor
} from "../../_shared/idempotency";

export const TELEGRAM_SETTINGS_IDEMPOTENCY_SCOPE =
  "telegram_delivery_settings_configure";
export const TELEGRAM_BINDING_REVOKE_IDEMPOTENCY_SCOPE =
  "telegram_delivery_binding_revoke";

/** The `Idempotency-Key` header, or the 400 that names it. Checked in `prepare`. */
export function readIdempotencyKey(request: Request): string | Response {
  const key = request.headers.get("idempotency-key");

  if (!key || key.length > 255) {
    return fail(
      400,
      "IDEMPOTENCY_REQUIRED",
      "Idempotency-Key header is required (at most 255 characters)."
    );
  }

  return key;
}

/**
 * Refuses a machine credential for an action whose idempotency record must be
 * filed under a person. After authorization, before any work.
 */
export function refuseMachineCredential(context: {
  viaMachineCredential?: boolean;
}): Response | null {
  if (context.viaMachineCredential === true) {
    return fail(
      403,
      "INTERACTIVE_SESSION_REQUIRED",
      "This action needs a signed-in person; a machine credential cannot do it."
    );
  }

  return null;
}

/**
 * Runs `produce` at most once per `(scope, Idempotency-Key, acting user)`:
 *
 *   * same key + same request hash  -> the STORED response, byte for byte;
 *   * same key + different hash     -> 409 IDEMPOTENCY_CONFLICT;
 *   * unseen key                    -> `produce()`, and a SUCCESS is stored.
 */
export async function runTelegramIdempotent(
  tx: Bun.SQL,
  tenantId: string,
  scope: string,
  idempotencyKey: string,
  actorTenantUserId: string,
  requestPayload: unknown,
  produce: () => Promise<{ body: unknown } | Response>
): Promise<Response> {
  const requestHash = computeRequestHash({
    actor: actorTenantUserId,
    request: requestPayload
  });
  const actor = userIdempotencyActor(actorTenantUserId);
  const existing = await findIdempotencyRecord(
    tx,
    tenantId,
    scope,
    idempotencyKey,
    actor
  );

  if (existing) {
    if (existing.requestHash !== requestHash) {
      return fail(
        409,
        "IDEMPOTENCY_CONFLICT",
        "Idempotency-Key was already used with a different request."
      );
    }

    return jsonResponse(existing.responseBody, {
      status: existing.responseStatus
    });
  }

  const produced = await produce();

  if (produced instanceof Response) {
    return produced;
  }

  const body = { success: true as const, data: produced.body, meta: {} };

  await saveIdempotencyRecord(
    tx,
    tenantId,
    scope,
    idempotencyKey,
    actor,
    requestHash,
    200,
    body
  );

  return jsonResponse(body, { status: 200 });
}
