/**
 * Pure rules for the BFF session handoff (ADR-0050). No database, no network —
 * every decision here is one an attacker would like to be lenient, so each is
 * testable on its own.
 *
 * The flow, for orientation:
 *
 * ```
 * browser ──► awcms-astro /internal/login   (no credential form)
 *         ──► awcms /login?handoff=<clientKey>&redirect_uri=…
 *             ── the user authenticates HERE: password, MFA, OIDC, Turnstile
 *         ──► back to awcms-astro with a one-time `code`
 * BFF     ──► POST /api/v1/auth/session-handoff/redeem   (server-to-server)
 *         ◄── { token, expiresAt }
 * ```
 */
import { timingSafeEqual } from "node:crypto";

/**
 * ADR-0050 §2: "short-lived (≤60 seconds)". Also a CHECK constraint on
 * `awcms_session_handoff_codes`, deliberately in both places — a TTL that lives
 * only in a TypeScript constant is one an edit can quietly widen to an hour,
 * and the row would still be accepted.
 */
export const HANDOFF_CODE_TTL_SECONDS = 60;

/** 32 bytes of CSPRNG, base64url — same shape and entropy as a session token. */
export function generateHandoffCode(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

/**
 * `ho-sha256:<hex>` — its own namespace, so a session hash (`sha256:…`) or a
 * machine-credential hash (`mc-sha256:…`) can never be stored as a handoff code
 * and matched by accident. The database CHECK enforces the same shape.
 */
export function hashHandoffCode(code: string): string {
  return `ho-sha256:${new Bun.CryptoHasher("sha256").update(code).digest("hex")}`;
}

/** `bff-sha256:<hex>`, same reasoning as above for the client secret. */
export function hashBffClientSecret(secret: string): string {
  return `bff-sha256:${new Bun.CryptoHasher("sha256").update(secret).digest("hex")}`;
}

/**
 * Constant-time comparison of two already-hashed values.
 *
 * A plain `===` on the hash leaks, through timing, how many leading characters
 * a guess got right. That is a weak oracle against a 256-bit hash and a real
 * one against a short client secret, and the cost of not having it is zero.
 * Length is compared first because `timingSafeEqual` throws on a mismatch —
 * and length alone reveals nothing here, since both operands are fixed-width
 * hashes.
 */
export function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");

  if (left.length !== right.length) return false;

  return timingSafeEqual(left, right);
}

export type RedirectUriRejection =
  "not_absolute_https" | "has_query_or_fragment" | "not_allow_listed";

export type RedirectUriDecision =
  | { allowed: true; redirectUri: string }
  | { allowed: false; reason: RedirectUriRejection };

/**
 * The single decision ADR-0050 names as the way this design fails: "an
 * open-redirect here means handing the code to an attacker".
 *
 * EXACT match against the client's registered list. Not a prefix — `https://
 * app.example.com` prefix-matches `https://app.example.com.evil.test`, and that
 * is the classic form of this bug. Not an origin match either: an attacker who
 * can post content on a permitted origin can then choose the path, and an
 * open-redirect on that origin is enough to forward the code onward.
 *
 * Query strings and fragments are refused rather than stripped. Stripping means
 * the URI the caller asked for and the URI the code is bound to differ, and
 * that difference is precisely what "bound to one redirect_uri" is supposed to
 * remove.
 */
export function decideRedirectUri(
  requested: string,
  allowList: readonly string[]
): RedirectUriDecision {
  let parsed: URL;

  try {
    parsed = new URL(requested);
  } catch {
    return { allowed: false, reason: "not_absolute_https" };
  }

  if (parsed.protocol !== "https:") {
    return { allowed: false, reason: "not_absolute_https" };
  }

  if (parsed.search !== "" || parsed.hash !== "") {
    return { allowed: false, reason: "has_query_or_fragment" };
  }

  // Compared as given, against the stored strings as stored. Normalising here
  // (lowercasing the host, dropping a trailing slash) would mean the allow-list
  // is checked against something other than what was registered, and the two
  // notions of "the same URI" would have to agree forever.
  if (!allowList.includes(requested)) {
    return { allowed: false, reason: "not_allow_listed" };
  }

  return { allowed: true, redirectUri: requested };
}

export type HandoffCodeState = {
  expiresAt: Date;
  redeemedAt: Date | null;
  clientId: string;
  redirectUri: string;
};

export type HandoffRejection =
  | "unknown_code"
  | "already_redeemed"
  | "expired"
  | "client_mismatch"
  | "redirect_uri_mismatch";

/**
 * Everything that must hold for a code to be redeemable, in one place, so the
 * endpoint cannot check three of five and look complete.
 *
 * `presentedClientId` is the client that AUTHENTICATED on the redeem request,
 * never one it named in the body: a code is bound to the client it was issued
 * to, and a second registered client must not be able to spend it.
 */
export function decideHandoffRedemption(
  state: HandoffCodeState | null,
  presented: { clientId: string; redirectUri: string },
  now: Date
): { ok: true } | { ok: false; reason: HandoffRejection } {
  if (!state) return { ok: false, reason: "unknown_code" };
  if (state.redeemedAt) return { ok: false, reason: "already_redeemed" };
  if (state.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }
  if (state.clientId !== presented.clientId) {
    return { ok: false, reason: "client_mismatch" };
  }
  if (state.redirectUri !== presented.redirectUri) {
    return { ok: false, reason: "redirect_uri_mismatch" };
  }

  return { ok: true };
}
