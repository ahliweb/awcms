/**
 * Shared plumbing for the `/api/v1/booking/*` route files (Issues #938, #941):
 * body parsing, the uuid path parameter, `Idempotency-Key` handling and the
 * response shapes every reservation route answers with, so the route files stay
 * thin and cannot drift into different spellings of the same 409.
 */
import { fail, jsonResponse } from "../../_shared/api-response";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord,
  userIdempotencyActor,
  type IdempotencyActor
} from "../../_shared/idempotency";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../lib/security/request-body-limit";
import { asUuid } from "../domain/booking-validation";
import type { Validated } from "../domain/booking-schedule";
import type { ReservationValidated } from "../domain/booking-reservation-validation";
import type { ServiceRefusal } from "./booking-reservation-service";

export { asUuid };

export function badId(field = "id"): Response {
  return fail(400, "VALIDATION_ERROR", `${field} must be a UUID.`);
}

/** Parses + validates a JSON body, answering the right 4xx without touching the database. */
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

/**
 * The reservation routes' body reader: like {@link readValidatedBody}, except a
 * validator may answer `PAYMENT_FIELD_NOT_ACCEPTED` instead of the generic
 * `VALIDATION_ERROR` (booking.md section 3).
 */
export async function readReservationBody<T>(
  request: Request,
  validate: (raw: unknown) => ReservationValidated<T>
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
      validation.code,
      validation.code === "PAYMENT_FIELD_NOT_ACCEPTED"
        ? "The request names a payment field; this module stores no payment state."
        : "Request is invalid.",
      {},
      validation.errors
    );
  }

  return validation.value;
}

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

/** A service refusal as the response every reservation route answers it with. */
export function refusalResponse(refusal: ServiceRefusal): Response {
  return fail(refusal.httpStatus, refusal.code, refusal.message);
}

/** The neutral 404: an unknown id, another tenant's id and a hidden one are one answer. */
export function reservationNotFound(): Response {
  return fail(404, "RESERVATION_NOT_FOUND", "Reservation not found.");
}

/**
 * Serialises concurrent requests that carry the SAME idempotency key. The store
 * is keyed on `(tenant, scope, key)` only; without this lock two such requests
 * both find nothing, both run `produce`, and the loser's claim can be refused
 * (`SLOT_UNAVAILABLE`, `HOLD_LIMIT_EXCEEDED`) by the winner's UNCOMMITTED
 * booking: a retry would be told its own booking conflicts. Under the lock the
 * second request waits for the first to commit, then finds the stored response
 * and replays it. A transaction-scoped advisory lock: released at commit or
 * rollback, so a crashed first request never strands the key.
 */
export async function lockIdempotencyKey(
  tx: Bun.SQL,
  tenantId: string,
  scope: string,
  idempotencyKey: string,
  actor: IdempotencyActor
): Promise<void> {
  // The actor is part of the lock identity because it is part of the store's
  // unique key (migration 256): two actors presenting one key hold DIFFERENT
  // records, so they have no reason to queue behind each other.
  await tx`
    SELECT pg_advisory_xact_lock(hashtextextended(${`idem:${tenantId}:${scope}:${actor}:${idempotencyKey}`}, 0))
  `;
}

/**
 * Runs `produce` at most once per `(tenant, scope, Idempotency-Key)`
 * (booking.md section 5.2, layer 1; ADR-0129 for the header):
 *
 *   * same key + same request hash  -> the STORED response, byte for byte;
 *   * same key + different hash     -> 409 IDEMPOTENCY_CONFLICT;
 *   * unseen key                    -> `produce()`, and a SUCCESS is stored.
 *
 * The store row is keyed on tenant, scope, ACTING USER and key (migration 256),
 * and the actor is also bound into the request hash. So another user presenting
 * a key already used holds a different record: they never see the first user's
 * response and can never block their key. A refusal is NOT stored: the caller fixes something and retries, and
 * a refusal produced inside `produce` is a returned value that rolled back what
 * it wrote (it never reaches the store). Concurrent same-key requests are
 * serialised by {@link lockIdempotencyKey}.
 */
export async function runIdempotent(
  tx: Bun.SQL,
  tenantId: string,
  scope: string,
  idempotencyKey: string,
  actorTenantUserId: string,
  requestPayload: unknown,
  produce: () => Promise<{ status: number; body: unknown } | Response>
): Promise<Response> {
  const requestHash = computeRequestHash({
    actor: actorTenantUserId,
    request: requestPayload
  });
  await lockIdempotencyKey(
    tx,
    tenantId,
    scope,
    idempotencyKey,
    userIdempotencyActor(actorTenantUserId)
  );

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
