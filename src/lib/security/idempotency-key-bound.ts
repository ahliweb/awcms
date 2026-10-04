/**
 * Input bound for the `Idempotency-Key` request header.
 *
 * The value is persisted in a btree index (`(tenant_id, request_scope,
 * idempotency_key)`), so an unbounded caller-supplied string is an input
 * validation hole: a long value fails the INSERT inside the database instead of
 * being refused at the edge. The bound is enforced once, in `src/middleware.ts`,
 * before any route handler or database work runs — not per route.
 *
 * Accepted: 1..255 characters of visible ASCII (`0x21`-`0x7E`). Every key the
 * repo's clients generate today (UUIDs, short human-readable test keys) fits.
 */
import { fail } from "../../modules/_shared/api-response";

export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";
export const IDEMPOTENCY_KEY_MAX_LENGTH = 255;
export const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]{1,255}$/;

/** `true` when the header is absent, or present and within the bound. */
export function isIdempotencyKeyHeaderAcceptable(request: Request): boolean {
  const value = request.headers.get(IDEMPOTENCY_KEY_HEADER);

  return value === null || IDEMPOTENCY_KEY_PATTERN.test(value);
}

export function invalidIdempotencyKeyResponse(): Response {
  return fail(
    400,
    "IDEMPOTENCY_KEY_INVALID",
    `Idempotency-Key must be 1 to ${IDEMPOTENCY_KEY_MAX_LENGTH} visible ASCII characters.`
  );
}
