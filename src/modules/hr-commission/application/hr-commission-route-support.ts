/**
 * Shared plumbing for the `/api/v1/hr-commission/*` route files (Issue #950,
 * ADR-0132): body parsing, `Idempotency-Key` handling, query parsing and the
 * path helpers. Kept here so the route files stay thin and cannot drift into
 * different spellings of the same 409.
 */
import { fail, jsonResponse } from "../../_shared/api-response";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord,
  userIdempotencyActor
} from "../../_shared/idempotency";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../lib/security/request-body-limit";
import type { Validated } from "../domain/hr-commission-validation";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** Parses + validates a JSON body (absent body = `null`), answering the right 4xx without touching the database. */
export async function readValidatedBody<T>(
  request: Request,
  validate: (raw: unknown) => Validated<T>
): Promise<T | Response> {
  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  if (bodyRead.malformed) {
    return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }

  const validation = validate(bodyRead.value);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Request is invalid.",
      {},
      validation.errors
    );
  }

  return validation.value;
}

/** A uuid path/query parameter, or `null` when it is not one. */
export function asUuid(value: string | undefined | null): string | null {
  return value && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

export function badId(field = "id"): Response {
  return fail(400, "VALIDATION_ERROR", `${field} must be a UUID.`);
}

/**
 * Runs `produce` at most once per `(scope, Idempotency-Key, acting user)`:
 *
 *   * same key + same request hash  -> the STORED response, byte for byte;
 *   * same key + different hash     -> 409 IDEMPOTENCY_CONFLICT;
 *   * unseen key                    -> `produce()`, and a SUCCESS is stored.
 *
 * Refusals are NOT stored: the caller fixes something and retries.
 */
export async function runIdempotent(
  tx: Bun.SQL,
  tenantId: string,
  scope: string,
  idempotencyKey: string,
  actorTenantUserId: string,
  requestPayload: unknown,
  produce: () => Promise<{ status: number; body: unknown } | Response>,
  /**
   * Called with the STORED body when the key is a replay, before it is
   * returned. A replay hands back the same data as the original (amounts
   * included) without running `produce`, so a read audit placed inside
   * `produce` never sees it (#978 re-audit L-A).
   */
  onStoredReplay?: (storedBody: unknown) => Promise<void>
): Promise<Response> {
  // Binding the actor into the hash means a second user presenting the same key
  // does not get the first user's response replayed (it can carry a tenant's commercial terms).
  const requestHash = computeRequestHash({
    actor: actorTenantUserId,
    request: requestPayload
  });
  const existing = await findIdempotencyRecord(
    tx,
    tenantId,
    scope,
    idempotencyKey,
    userIdempotencyActor(actorTenantUserId)
  );

  if (existing) {
    if (existing.requestHash !== requestHash) {
      return fail(
        409,
        "IDEMPOTENCY_CONFLICT",
        "Idempotency-Key was already used with a different request."
      );
    }

    await onStoredReplay?.(existing.responseBody);

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
    userIdempotencyActor(actorTenantUserId),
    requestHash,
    produced.status,
    body
  );

  return jsonResponse(body, { status: produced.status });
}
