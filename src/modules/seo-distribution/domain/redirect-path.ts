/**
 * Deterministic redirect-path normalization (ADR-0039; adapted from awcms-micro
 * ADR-0028 §8) — the single canonical form a path takes before it is EITHER stored
 * as a rule's `normalized_source_path`/relative target OR matched against an incoming
 * public request. Because the SAME function normalizes both sides, a rule and a
 * request only ever match when they truly denote the same path.
 *
 * ## This is the CRLF / traversal / Unicode-confusion / protocol-relative defense
 *
 * Every rejection here is a security control, not a nicety:
 *  - **CRLF / header injection**: any C0 control (U+0000–U+001F), DEL (U+007F),
 *    or raw whitespace is rejected outright — a `\r`/`\n` in a redirect target
 *    would otherwise let a crafted rule split the response and inject a header.
 *  - **Protocol-relative / backslash confusion**: `//host`, `\host`, and ANY
 *    backslash are rejected, and the parsed origin is confirmed to still be the
 *    synthetic base — the exact `//evil.com` / `/\evil.com` open-redirect vectors
 *    the frozen `classifyRedirectTarget` guard also closes, caught here at
 *    normalization too (defense in depth).
 *  - **Path traversal**: `.`/`..` segments are resolved by the WHATWG URL parser
 *    and CLAMPED at the root (they can never escape the origin), so a stored /
 *    looked-up path is always the post-`..` canonical form.
 *  - **Unicode confusion**: input is NFC-normalized and lone surrogates are
 *    rejected (malformed Unicode), so two canonically-equivalent paths cannot be
 *    stored as two distinct rules.
 *
 * ## No pattern engine — no ReDoS
 *
 * Normalization is pure string operations plus ONE `new URL()` parse. The only
 * regexes are fixed, linear character-class replacements (`/\/{2,}/`,
 * `/%[0-9a-fA-F]{2}/`) — no backtracking, no rule-supplied pattern. This module is
 * exact-path only; there is no rule-authored regex anywhere in it.
 */

/** Max path length accepted — mirrors the sql/060 `char_length(...) <= 2048` floor. */
export const MAX_REDIRECT_PATH_LENGTH = 2048;

/**
 * Synthetic, RFC-6761 `.invalid` base that can never resolve. A genuine
 * path-absolute reference resolves back to THIS origin; anything that escaped to
 * another origin (via `//` / `\`) does not — the origin equality check below is
 * what makes the protocol-relative bypass impossible.
 */
const SYNTHETIC_BASE = "https://redirect-normalize.invalid";
const SYNTHETIC_ORIGIN = "https://redirect-normalize.invalid";

/** C0 controls (U+0000–U+001F) + space (U+0020) + DEL (U+007F). */
const CONTROL_OR_WHITESPACE = /[\u0000-\u0020\u007f]/;

export type RedirectPathNormalizationResult =
  { ok: true; path: string } | { ok: false; reason: string };

export type NormalizeRedirectPathOptions = {
  /** Keep the (normalized) query string on the result — used for relative targets, never for a source/match key. */
  keepQuery?: boolean;
};

/**
 * Normalize a raw path-absolute reference to its canonical, match-safe form, or
 * reject it. `keepQuery` retains the parsed query (relative targets may carry
 * one); the default drops it (source paths and request-match keys are path-only,
 * so `/a?x=1` and `/a?y=2` both match a `/a` rule — query handling on the target
 * is governed separately by `preserve_query`).
 */
export function normalizeRedirectPath(
  raw: unknown,
  options: NormalizeRedirectPathOptions = {}
): RedirectPathNormalizationResult {
  if (typeof raw !== "string") {
    return { ok: false, reason: "Path must be a string." };
  }

  const value = raw.trim();

  if (value.length === 0) {
    return { ok: false, reason: "Path must not be empty." };
  }

  if (value.length > MAX_REDIRECT_PATH_LENGTH) {
    return {
      ok: false,
      reason: `Path must be at most ${MAX_REDIRECT_PATH_LENGTH} characters.`
    };
  }

  // CRLF / control / whitespace rejection (header-injection + ambiguity defense).
  if (CONTROL_OR_WHITESPACE.test(value)) {
    return {
      ok: false,
      reason:
        "Path must not contain control characters or whitespace (CRLF/header-injection defense)."
    };
  }

  // Lone-surrogate / malformed Unicode rejection (Unicode-confusion defense):
  // `encodeURIComponent` throws a `URIError` on an unpaired surrogate.
  try {
    encodeURIComponent(value);
  } catch {
    return { ok: false, reason: "Path contains malformed Unicode." };
  }

  // No backslashes anywhere — a `\` is a known slash-confusion vector (the WHATWG
  // parser rewrites it to `/` under a special scheme), so reject rather than
  // silently rewrite.
  if (value.includes("\\")) {
    return { ok: false, reason: "Path must not contain a backslash." };
  }

  // Must be a path-absolute reference. Protocol-relative `//...` escapes to another
  // origin and is rejected before parsing (belt-and-braces with the origin check).
  if (!value.startsWith("/")) {
    return { ok: false, reason: "Path must start with '/'." };
  }
  if (value.startsWith("//")) {
    return {
      ok: false,
      reason: "Path must not be protocol-relative ('//...')."
    };
  }

  // NFC normalization so canonically-equivalent Unicode paths collapse to one key.
  const normalizedUnicode = value.normalize("NFC");

  let url: URL;
  try {
    url = new URL(normalizedUnicode, SYNTHETIC_BASE);
  } catch {
    return { ok: false, reason: "Path is not a valid URL path." };
  }

  // Origin MUST still be the synthetic base — if it escaped, the input was an
  // absolute/protocol-relative reference in disguise (open-redirect vector).
  if (url.origin !== SYNTHETIC_ORIGIN) {
    return {
      ok: false,
      reason: "Path resolves off-origin (open-redirect vector)."
    };
  }

  // `url.pathname` has dot-segments resolved and is always leading-`/`. Collapse
  // duplicate slashes (the URL parser keeps them), uppercase percent-encoding
  // (RFC 3986 §6.2.2.1), and strip a trailing slash except at root.
  let pathname = url.pathname
    .replace(/\/{2,}/g, "/")
    .replace(/%[0-9a-fA-F]{2}/g, (m) => m.toUpperCase());

  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }

  if (options.keepQuery && url.search) {
    return { ok: true, path: `${pathname}${url.search}` };
  }

  return { ok: true, path: pathname };
}

/**
 * Path-only portion of a normalized target (drops any query) — used for
 * self-redirect / loop detection, where a redirect from `/a` to `/a?x=1` is
 * still a self-redirect (the request `/a?x=1` re-matches the `/a` rule).
 */
export function redirectPathKey(normalizedPathMaybeWithQuery: string): string {
  const q = normalizedPathMaybeWithQuery.indexOf("?");
  return q === -1
    ? normalizedPathMaybeWithQuery
    : normalizedPathMaybeWithQuery.slice(0, q);
}
