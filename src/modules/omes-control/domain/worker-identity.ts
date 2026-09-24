/**
 * Asymmetric worker identity — canonical serialization, Ed25519 signature
 * verification, and envelope-freshness checks for the session-
 * UNauthenticated worker endpoints (ahliweb/omes#199, ADR-0122). This is the
 * highest-risk surface `omes_control` ships: every other endpoint in this
 * module runs behind `authorizeInTransaction` (a real tenant session); these
 * four (`/worker/enroll`, `/worker/poll`, `/worker/result`,
 * `/worker/heartbeat`) authenticate the caller by proof of possession of an
 * Ed25519 private key instead.
 *
 * ## Why headers, not body fields, carry the signature/nonce/timestamp
 *
 * The vendored OMES wire schemas (`contracts/v1/worker-*.schema.json`,
 * pinned by ahliweb/omes#197) all declare `additionalProperties: false`.
 * Adding a `signature` field to the body would violate the pinned contract
 * this module validates every envelope against
 * (`domain/contracts/validateOmesContract`) — the one thing #197's own
 * README calls out as non-negotiable. The transport-level identity proof
 * therefore travels as HTTP headers, which the pinned body schemas have no
 * opinion on: `X-Omes-Worker-Signature` (base64, over the canonical string
 * below), `X-Omes-Nonce`, `X-Omes-Timestamp`. `worker-poll.request` already
 * carries `nonce`/`timestamp` IN the body (its schema commits to that
 * shape); this module additionally requires the same values duplicated in
 * headers for poll too, so ALL FOUR routes share one verification path
 * instead of two.
 *
 * ## A flagged cross-repository gap (see the PR description)
 *
 * The OMES-side reference pull worker as merged for ahliweb/omes#192
 * (`lib/omes/py/jobs/worker.py`) does not yet generate a real Ed25519
 * keypair (its `enroll_worker()` derives a fake "public key" string from a
 * SHA-256 hash of random bytes) and sends no signature/nonce/timestamp
 * headers at all. This module intentionally does NOT relax verification to
 * match that stub — the issue's own security requirements ("asymmetric
 * worker identity verification... constant-time comparison... nonce/
 * timestamp replay protection") are the contract this side must meet
 * regardless of whether the reference worker currently exercises it.
 * Bringing the OMES-side worker up to this wire shape is a necessary
 * follow-up this PR calls out explicitly rather than silently working
 * around by weakening verification here.
 */
import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify as cryptoVerify,
  type KeyObject
} from "node:crypto";

/** Bounded replay window for `X-Omes-Timestamp` (issue: "bounded window"). */
export const ENVELOPE_TIMESTAMP_WINDOW_MS = 5 * 60 * 1000;

/** How long a consumed nonce is retained for replay detection. */
export const NONCE_RETENTION_MS = 15 * 60 * 1000;

export type WorkerRoute = "poll" | "result" | "heartbeat";

export type CanonicalEnvelopeInput = {
  method: string;
  path: string;
  tenantId: string;
  serverId: string;
  workerId: string;
  timestamp: string;
  nonce: string;
  rawBody: string;
};

/**
 * The exact string an Ed25519 signature is computed over. Binds method,
 * path, tenant, server, worker, timestamp, nonce and a hash of the raw body
 * bytes — so a signature cannot be replayed against a different path/tenant/
 * server/worker/body even if the nonce were somehow reused, and a
 * cross-tenant or cross-server substitution changes the signed string.
 */
export function buildCanonicalEnvelope(input: CanonicalEnvelopeInput): string {
  const bodyHash = createHash("sha256").update(input.rawBody, "utf8").digest("hex");

  return [
    input.method.toUpperCase(),
    input.path,
    input.tenantId,
    input.serverId,
    input.workerId,
    input.timestamp,
    input.nonce,
    bodyHash
  ].join("\n");
}

export type PublicKeyValidation =
  | { valid: true; keyObject: KeyObject }
  | { valid: false; reason: string };

/**
 * The ONLY accepted public-key shape: PEM-encoded SPKI Ed25519
 * (`-----BEGIN PUBLIC KEY-----`, as `crypto.generateKeyPairSync("ed25519")
 * .publicKey.export({ type: "spki", format: "pem" })` produces). Rejects
 * anything else outright — no fallback to a hash-derived "key" string like
 * the pre-#199 stub worker sends.
 */
export function validateEd25519PublicKeyPem(pem: string): PublicKeyValidation {
  if (
    typeof pem !== "string" ||
    !pem.includes("BEGIN PUBLIC KEY") ||
    pem.length > 1024
  ) {
    return { valid: false, reason: "public_key must be a PEM-encoded SPKI key" };
  }

  let keyObject: KeyObject;

  try {
    keyObject = createPublicKey({ key: pem, format: "pem", type: "spki" });
  } catch {
    return { valid: false, reason: "public_key is not a parseable SPKI PEM" };
  }

  if (keyObject.asymmetricKeyType !== "ed25519") {
    return { valid: false, reason: "public_key must be an Ed25519 key" };
  }

  return { valid: true, keyObject };
}

/**
 * Verifies `signatureBase64` over `data` using `publicKeyPem`. Returns
 * `false` for any malformed input (bad base64, wrong key shape, wrong
 * algorithm) rather than throwing — every caller treats `false` as "reject,
 * neutral response", so a parse failure and a genuine bad signature are
 * indistinguishable to the caller, which is the point (no oracle).
 *
 * `node:crypto`'s one-shot `verify(null, data, key, signature)` is the
 * documented Ed25519 form (algorithm must be `null`) and internally performs
 * the comparison at the OpenSSL/libsodium layer — inherently branch-free
 * over the signature bytes, unlike a manual byte-by-byte compare. No
 * additional `timingSafeEqual` wrapping is needed (or possible: `verify`
 * returns a plain boolean, not two buffers to compare) for the signature
 * check itself; `timingSafeEqual` is exported here and used instead for the
 * enrollment-challenge-hash comparison in
 * `application/worker-enrollment-exchange.ts`, where the comparison IS
 * against raw bytes this module already fetched.
 */
export function verifyEd25519Signature(
  publicKeyPem: string,
  data: string,
  signatureBase64: string
): boolean {
  const keyCheck = validateEd25519PublicKeyPem(publicKeyPem);

  if (!keyCheck.valid) {
    return false;
  }

  let signature: Buffer;

  try {
    signature = Buffer.from(signatureBase64, "base64");
  } catch {
    return false;
  }

  if (signature.length === 0) {
    return false;
  }

  try {
    return cryptoVerify(null, Buffer.from(data, "utf8"), keyCheck.keyObject, signature);
  } catch {
    return false;
  }
}

export { timingSafeEqual };

export type EnvelopeFreshnessResult =
  | { fresh: true; timestampMs: number }
  | { fresh: false; reason: "malformed_timestamp" | "outside_window" };

/**
 * Bounded-window timestamp check. Neither "too old" nor "too far in the
 * future" is trusted — a future timestamp would let a captured envelope be
 * replayed right up until it "expires", which defeats the point of a
 * window.
 */
export function checkEnvelopeFreshness(
  timestampIso: string,
  now: Date,
  windowMs: number = ENVELOPE_TIMESTAMP_WINDOW_MS
): EnvelopeFreshnessResult {
  const timestampMs = Date.parse(timestampIso);

  if (!Number.isFinite(timestampMs)) {
    return { fresh: false, reason: "malformed_timestamp" };
  }

  const deltaMs = Math.abs(now.getTime() - timestampMs);

  if (deltaMs > windowMs) {
    return { fresh: false, reason: "outside_window" };
  }

  return { fresh: true, timestampMs };
}

const NONCE_PATTERN = /^[A-Za-z0-9_.:-]{16,128}$/;

export function isWellFormedNonce(nonce: unknown): nonce is string {
  return typeof nonce === "string" && NONCE_PATTERN.test(nonce);
}
