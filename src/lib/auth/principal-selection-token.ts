import { createHash, randomBytes } from "node:crypto";

/**
 * The tenant-selection token (ADR-0088, Gelombang 7 PR 7.4 of Issue #423).
 *
 * ```
 * awcmsp_<43 chars base64url secret>
 * ```
 *
 * Minted by `POST /api/v1/auth/login` when no tenant header was sent, and
 * redeemed exactly once by `POST /api/v1/auth/session/tenant` for a tenant the
 * CALLER names. It lives ≤120 seconds and buys exactly one thing: the right to
 * ask for a session in one tenant.
 *
 * ## It carries no tenant, and that is the whole difference
 *
 * A machine credential embeds its tenant (ADR-0049) because it is only ever
 * valid for that one. This token is the opposite object: it exists precisely
 * BECAUSE no tenant has been chosen yet. Nothing about it can be scoped, which
 * is why every other property is narrowed instead — single use, two minutes,
 * one live token per human, and a bearer kind the authorization chokepoint
 * refuses outright.
 *
 * ## The prefix and the hash namespace do two different jobs
 *
 * `awcmsp_` is a discriminator on the PLAINTEXT: a bearer is known to be a
 * selection token before any query, so it can never be looked up in the session
 * table. `pt-sha256:` is the discriminator that SURVIVES HASHING: the guard
 * chokepoint receives only a hash, and this is what lets it tell — from the
 * hash alone, with no database round trip — that it is holding a bearer which
 * must never authorize anything.
 *
 * Neither is a secret. Both exist so that a bearer of one kind cannot be
 * mistaken for another, which is exactly the confusion ADR-0049 was written to
 * make structurally impossible.
 */
export const PRINCIPAL_SELECTION_TOKEN_PREFIX = "awcmsp_";

/** Namespace tag on the stored hash — the kind discriminator that survives hashing. */
export const PRINCIPAL_SELECTION_HASH_PREFIX = "pt-sha256:";

/** 32 random bytes, base64url — identical entropy to a session token. */
const SECRET_BYTES = 32;

/**
 * Whether `token` LOOKS like a selection token. Prefix-only, deliberately: a
 * malformed selection token is still routed to the selection path and refused
 * there, never silently retried as a session token — which would make
 * "malformed selection token" indistinguishable from "unknown session".
 */
export function isPrincipalSelectionToken(token: string): boolean {
  return token.startsWith(PRINCIPAL_SELECTION_TOKEN_PREFIX);
}

/**
 * Mints a token. The plaintext returned here is the only copy that will ever
 * exist — the caller returns it once in the `409` body and stores only the hash.
 */
export function generatePrincipalSelectionToken(): string {
  return `${PRINCIPAL_SELECTION_TOKEN_PREFIX}${randomBytes(SECRET_BYTES).toString("base64url")}`;
}

export function hashPrincipalSelectionToken(token: string): string {
  return `${PRINCIPAL_SELECTION_HASH_PREFIX}${createHash("sha256").update(token).digest("hex")}`;
}

/**
 * Whether a stored/derived hash belongs to the selection-token namespace.
 *
 * **This is the invariant of the whole PR.** `authorizeInTransaction` calls it
 * before anything else and refuses; a selection token therefore cannot
 * authorize a request even if a future refactor were to store one somewhere the
 * session lookup can see.
 */
export function isPrincipalSelectionHash(tokenHash: string): boolean {
  return tokenHash.startsWith(PRINCIPAL_SELECTION_HASH_PREFIX);
}
