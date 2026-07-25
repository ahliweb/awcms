/**
 * Submit-timing token (ADR-0041, ported from awcms-micro Issue #271). A short
 * HMAC-signed token embedded in the public comment form at render time and
 * echoed back on submit, so the server can measure elapsed time WITHOUT
 * trusting a client-supplied number — the input to the anti-abuse timing floor
 * in `anti-abuse.ts`. The payload is an issued-at epoch (ms) plus a nonce; no
 * PII, nothing tenant-identifying.
 *
 * This token gates a soft anti-abuse heuristic. It is NEVER an authorization
 * artifact: forging one lets a bot skip the "submitted implausibly fast" check,
 * and nothing else. Every real control (policy mode, moderation, ABAC on the
 * admin surface) sits elsewhere and is unaffected.
 *
 * ## Port-time change: no published fallback secret
 *
 * awcms-micro fell back to a fixed constant compiled into the source. In a
 * public repository that constant is public knowledge, so the timing floor it
 * protects is bypassable by anyone who reads the file — the signature stops
 * being a signature. This port instead follows the `AUTH_IP_HASH_SECRET`
 * precedent in `lib/security/client-fingerprint.ts`: prefer
 * `COMMENTS_TIMING_SECRET`, reject the documented placeholders, and otherwise
 * generate a random per-process key and warn once.
 *
 * What the ephemeral key costs: tokens do not survive a restart and are not
 * valid across instances, so a form rendered before a restart fails
 * verification. `evaluateAntiAbuse` treats an unverifiable token as `too_fast`
 * when a floor is configured, so that visitor is asked to resubmit rather than
 * silently let through. Annoying, bounded, and fail-closed — and the warning
 * tells the operator exactly which variable removes it. Throwing instead would
 * take the public comment form down on every deployment that predates this
 * variable, which is a worse trade for a heuristic.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { log } from "../../../lib/logging/logger";

export const TIMING_SECRET_ENV = "COMMENTS_TIMING_SECRET";

/** Reject a token older than this (also the practical form-lifetime cap). */
export const TIMING_TOKEN_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Mirrors `PLACEHOLDER_SECRETS` in `scripts/validate-env.ts` and `client-fingerprint.ts`. */
const PLACEHOLDER_SECRETS: ReadonlySet<string> = new Set([
  "change-me",
  "changeme",
  "secret",
  "replace-me"
]);

let ephemeralTimingSecret: string | null = null;

function resolveSecret(): string {
  const configured = process.env[TIMING_SECRET_ENV]?.trim();

  if (
    configured !== undefined &&
    configured !== "" &&
    !PLACEHOLDER_SECRETS.has(configured.toLowerCase())
  ) {
    return configured;
  }

  if (ephemeralTimingSecret === null) {
    ephemeralTimingSecret = randomBytes(32).toString("hex");

    // Logged once per process, not per request: this runs on a public,
    // unauthenticated endpoint, so a per-request warning would let an attacker
    // amplify log volume for free.
    log("warning", "comments.timing_token.ephemeral_secret", {
      moduleKey: "comments",
      envVar: TIMING_SECRET_ENV,
      reason:
        configured === undefined || configured === ""
          ? "not_set"
          : "placeholder_value",
      impact:
        "comment-form timing tokens are signed with a per-process random key: they do not survive a restart and are not valid across instances, so a form rendered earlier fails the anti-abuse timing check and the visitor must resubmit"
    });
  }

  return ephemeralTimingSecret;
}

/** Test-only: forces the next mint/verify to re-resolve the secret. */
export function resetTimingSecretForTests(): void {
  ephemeralTimingSecret = null;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Mint a timing token for the current moment. */
export function mintTimingToken(now: number = Date.now()): string {
  const secret = resolveSecret();
  // Random nonce so two forms rendered in the same millisecond differ. Only
  // uniqueness matters here, not unpredictability — the HMAC provides that.
  const nonce = randomBytes(12).toString("base64url");
  const payload = `${now}.${nonce}`;
  return `${payload}.${sign(payload, secret)}`;
}

export type TimingTokenVerification =
  { valid: true; issuedAt: number; elapsedMs: number } | { valid: false };

/** Verify a timing token and compute elapsed ms, or report invalid. */
export function verifyTimingToken(
  token: unknown,
  now: number = Date.now()
): TimingTokenVerification {
  if (typeof token !== "string") return { valid: false };

  const parts = token.split(".");
  if (parts.length !== 3) return { valid: false };

  const [issuedRaw, nonce, sig] = parts as [string, string, string];
  const expected = sign(`${issuedRaw}.${nonce}`, resolveSecret());

  const sigBuf = Buffer.from(sig, "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false };
  }

  const issuedAt = Number(issuedRaw);
  if (!Number.isFinite(issuedAt)) return { valid: false };

  const elapsedMs = now - issuedAt;
  if (elapsedMs < 0 || elapsedMs > TIMING_TOKEN_MAX_AGE_MS) {
    return { valid: false };
  }

  return { valid: true, issuedAt, elapsedMs };
}
