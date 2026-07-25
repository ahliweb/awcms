/**
 * Anti-abuse domain checks (ADR-0041, ported from awcms-micro Issue #271). Pure
 * domain — no I/O. The application layer combines these with DB-backed rate
 * limiting and `awcms_comments_abuse_events` telemetry; this file holds the
 * deterministic, unit-testable decisions.
 *
 * Every signal is server-side; a client can never disable one:
 *
 * - **honeypot** — a hidden form field a human never fills. Any value = bot.
 * - **min-submit time** — a form submitted faster than `minSubmitSeconds` after
 *   render is almost certainly automated. The elapsed measurement comes from
 *   the HMAC-signed token in `timing-token.ts`, never from a client-supplied
 *   number.
 * - **blocked terms** — case-insensitive substring match against the tenant's
 *   list.
 * - **duplicate fingerprint** — a stable hash of the normalized body plus a
 *   coarse author key. Computed here; the caller checks recency in the DB.
 *
 * These are heuristics, not authorization. Everything they let through still
 * faces the policy decision in `comment-policy.ts` and, under any `moderated-*`
 * mode, a human moderator.
 */
import { createHash } from "node:crypto";

export type AntiAbuseSettings = {
  minSubmitSeconds: number;
  blockedTerms: readonly string[];
};

export type AntiAbuseInput = {
  /** The hidden honeypot field value (should be empty). */
  honeypotValue: string | null | undefined;
  /** Milliseconds between form render and submit, from the signed timing token; `null` when the token was missing or unverifiable. */
  elapsedMs: number | null;
  /** The normalized comment body (output of `normalizeCommentBody`). */
  body: string;
};

export type AntiAbuseDecision =
  { blocked: false } | { blocked: true; reason: AntiAbuseReason };

export type AntiAbuseReason = "honeypot" | "too_fast" | "blocked_term";

export function evaluateAntiAbuse(
  input: AntiAbuseInput,
  settings: AntiAbuseSettings
): AntiAbuseDecision {
  // Honeypot: any non-empty value means an automated agent filled a field that
  // is hidden from human visitors.
  if (
    typeof input.honeypotValue === "string" &&
    input.honeypotValue.trim() !== ""
  ) {
    return { blocked: true, reason: "honeypot" };
  }

  // Timing floor, enforced only when the tenant configured one. When a floor IS
  // configured, a missing or unverifiable measurement counts as too fast — fail
  // closed, so stripping the token is not a way to skip the check.
  if (settings.minSubmitSeconds > 0) {
    if (
      input.elapsedMs === null ||
      input.elapsedMs < settings.minSubmitSeconds * 1000
    ) {
      return { blocked: true, reason: "too_fast" };
    }
  }

  if (containsBlockedTerm(input.body, settings.blockedTerms)) {
    return { blocked: true, reason: "blocked_term" };
  }

  return { blocked: false };
}

/** Case-insensitive substring match against the tenant's blocked-terms list. */
export function containsBlockedTerm(
  body: string,
  blockedTerms: readonly string[]
): boolean {
  if (blockedTerms.length === 0) return false;
  const haystack = body.toLowerCase();
  return blockedTerms.some((term) => {
    const needle = term.trim().toLowerCase();
    return needle.length > 0 && haystack.includes(needle);
  });
}

/**
 * A stable duplicate-detection fingerprint over the normalized body plus a
 * coarse author key (email hash, user id, or ip hash — always an already-hashed
 * or opaque value, never raw PII). The caller looks this up in
 * `awcms_comments_comments.content_fingerprint` within a recency window, using
 * the `(tenant_id, content_fingerprint, created_at)` index from `sql/066`.
 *
 * The NUL separator cannot appear in either input, so no pair of distinct
 * (authorKey, body) values can collide by concatenation.
 */
export function computeContentFingerprint(input: {
  body: string;
  authorKey: string;
}): string {
  const normalized = input.body.replace(/\s+/g, " ").trim().toLowerCase();
  return createHash("sha256")
    .update(`${input.authorKey}\u0000${normalized}`)
    .digest("hex");
}
