import { createHmac, randomBytes } from "node:crypto";

import { log } from "../logging/logger";

/**
 * The server-side key that turns the idempotency request hash into a keyed
 * hash (HMAC-SHA-256). ADR-0129 amendment 1 (audit F4 of #990, issue #1000).
 *
 * ## Why a keyed hash
 *
 * `awcms_idempotency_keys.request_hash` used to be a plain SHA-256 of the
 * canonicalised request body. That body can carry sensitive free text (an
 * attendance-correction `reason`, a commission note, a rejection reason), and a
 * short or guessable value is recoverable offline by anyone who can READ the
 * table — a DB backup, a replica, a mis-scoped reporting role: hash every
 * candidate and compare. A keyed hash makes the same attack need the server
 * secret, which is held in configuration and never in the database.
 *
 * ## Fail closed in production, ephemeral elsewhere
 *
 * - `APP_ENV=production` with the variable unset, a placeholder, or shorter than
 *   {@link IDEMPOTENCY_HMAC_MIN_LENGTH} THROWS. The alternative — silently
 *   falling back to an unkeyed digest — would restore exactly the weakness this
 *   fixes while looking healthy, and `bun run dev`/`start` never run
 *   `config:validate`, so the check has to live here too.
 * - Any other environment falls back to a per-process random key with a single
 *   warning. That is safe for the store's job: a hash that does not match is a
 *   `409`, never a double execution (the row's unique key still conflicts) and
 *   never a leaked response.
 *
 * ## Rotation
 *
 * Replacing the secret makes every stored hash unmatchable. A retry of a request
 * stored BEFORE the rotation therefore answers `409 IDEMPOTENCY_CONFLICT` instead
 * of replaying — fail safe, because the unique `(tenant, scope, actor, key)` row
 * still exists, so the mutation cannot run twice. Rotate when the replay window
 * of the highest-risk mutations (clients retry within minutes) has drained, or
 * accept the 409 for the retries that straddle the change. See
 * `docs/awcms/deploy-coolify.md` for the operator steps.
 */
export const IDEMPOTENCY_HMAC_SECRET_ENV = "IDEMPOTENCY_HMAC_SECRET";

/** 32 characters is 256 bits of key material when generated from `openssl rand -hex 32`. */
export const IDEMPOTENCY_HMAC_MIN_LENGTH = 32;

/**
 * Mirrors `PLACEHOLDER_SECRETS` in `scripts/validate-env.ts` and
 * `client-fingerprint.ts`. A documented placeholder is public knowledge (this
 * repo is public), so keying the hash with it is no better than not keying it.
 */
const PLACEHOLDER_SECRETS: ReadonlySet<string> = new Set([
  "change-me",
  "changeme",
  "secret",
  "replace-me"
]);

export class IdempotencyConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdempotencyConfigurationError";
  }
}

type EnvBag = Readonly<Record<string, string | undefined>>;

/** Why a configured value is unusable, or `null` when it is a real key. */
export function describeIdempotencySecretProblem(
  raw: string | undefined
): string | null {
  const value = raw?.trim() ?? "";

  if (value === "") {
    return "not set";
  }

  if (PLACEHOLDER_SECRETS.has(value.toLowerCase())) {
    return "a documented placeholder";
  }

  if (value.length < IDEMPOTENCY_HMAC_MIN_LENGTH) {
    return `shorter than ${IDEMPOTENCY_HMAC_MIN_LENGTH} characters`;
  }

  return null;
}

let ephemeralKey: string | null = null;

/**
 * Resolves the HMAC key. Throws {@link IdempotencyConfigurationError} in
 * production when no usable key is configured; otherwise never throws.
 */
export function resolveIdempotencyHmacKey(
  env: EnvBag = process.env as EnvBag
): string {
  const configured = env[IDEMPOTENCY_HMAC_SECRET_ENV];
  const problem = describeIdempotencySecretProblem(configured);

  if (problem === null) {
    return configured!.trim();
  }

  if (env.APP_ENV?.trim().toLowerCase() === "production") {
    throw new IdempotencyConfigurationError(
      `${IDEMPOTENCY_HMAC_SECRET_ENV} is ${problem}; it is required in production (generate one with \`openssl rand -base64 48\`). Idempotent mutations are refused rather than stored with an unkeyed request hash.`
    );
  }

  if (ephemeralKey === null) {
    ephemeralKey = randomBytes(32).toString("hex");

    // Once per process, never per request (a per-request warning on a public
    // route is free log amplification for an attacker).
    log("warning", "security.idempotency_hmac.ephemeral_key", {
      moduleKey: "idempotency",
      envVar: IDEMPOTENCY_HMAC_SECRET_ENV,
      reason: problem,
      impact:
        "idempotency request hashes are keyed with a per-process random key: still unguessable, but a replay after a restart or on another instance answers 409 instead of the stored response"
    });
  }

  return ephemeralKey;
}

/**
 * HMAC-SHA-256 (hex) of `canonicalPayload`, domain-separated so the same key can
 * never be confused with another HMAC use of the secret.
 */
export function keyedRequestHash(
  canonicalPayload: string,
  env: EnvBag = process.env as EnvBag
): string {
  return createHmac("sha256", resolveIdempotencyHmacKey(env))
    .update("awcms.idempotency.request-hash.v1\n")
    .update(canonicalPayload)
    .digest("hex");
}

/** Test-only: forget the per-process fallback so the next call re-resolves. */
export function resetIdempotencyHmacKeyForTests(): void {
  ephemeralKey = null;
}
