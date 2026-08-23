/**
 * Parsing and classification of the `Origin` request header — the one piece
 * every cross-origin surface in this repo needs before it can decide anything.
 *
 * Extracted from `visitor-analytics/domain/beacon-cors.ts` (Issue #637) when
 * the public search endpoints needed exactly the same two answers (ADR-0107).
 * It lives in `lib/security` rather than in either module because neither
 * module owns it: what an `Origin` header IS, and when a request is
 * cross-origin, is a property of HTTP, not of analytics or of search. The
 * alternative — a second copy — is the defect class this repo keeps paying for
 * (four `stripComments` implementations, three JSON fetch cores), and a
 * SECURITY parser is the worst possible place to have two of them: the copy
 * that is not hardened is the one an attacker finds.
 *
 * Nothing here grants anything. These functions answer "what origin is this,
 * and is it ours?"; the allow-list lookup and the response headers belong to
 * the surface, because they differ per surface (the beacon needs credentials
 * and a preflight, search needs neither).
 */

export type RequestOrigin = {
  /** The origin exactly as it will be echoed back, e.g. `https://news.example`. */
  origin: string;
  /** Its hostname, lowercased and port-free — the `awcms_tenant_domains` key. */
  hostname: string;
};

/**
 * Parses an `Origin` request header into something safe to look up and echo.
 *
 * Returns `null` — never a partially-trusted value — for everything that is not
 * a plain `http(s)://host[:port]` origin. In particular:
 *
 * - **the literal string `null`**, which is what a sandboxed iframe, a
 *   `file://` document and some redirect chains send. It is an opaque origin,
 *   and echoing it back would hand a document with no origin the same access a
 *   verified tenant domain has;
 * - any non-`http(s)` scheme, so a `chrome-extension://` or `moz-extension://`
 *   page cannot be granted access to a tenant's endpoint;
 * - anything carrying a path, query, fragment or userinfo. A real `Origin`
 *   header has none of those, so rather than strip them, this requires the
 *   header to be EQUAL to the parsed origin — one comparison that rejects every
 *   such shape at once, including the ones nobody has thought of yet.
 */
export function parseRequestOrigin(
  originHeader: string | null | undefined
): RequestOrigin | null {
  if (typeof originHeader !== "string") {
    return null;
  }

  const trimmed = originHeader.trim();

  if (trimmed.length === 0 || trimmed === "null") {
    return null;
  }

  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }

  // A well-formed `Origin` serializes back to itself. Anything that does not —
  // a trailing slash, a path, credentials, a query — is not an origin.
  //
  // The comparison is against the LOWERCASED header because scheme and host are
  // case-insensitive and `new URL()` has already normalized them; a browser
  // sends them lowercase anyway, and refusing `https://News.Example` would be
  // strictness that protects nothing. What is echoed back is `url.origin`, the
  // normalized form — which is also the form the browser compares against.
  if (url.origin !== trimmed.toLowerCase()) {
    return null;
  }

  if (url.hostname.length === 0) {
    return null;
  }

  return { origin: url.origin, hostname: url.hostname.toLowerCase() };
}

/**
 * True when this request came from a different origin than the one serving it.
 *
 * Same-origin callers — this repo's own pages — take the unchanged path: no
 * allow-list lookup, no CORS headers, not one extra query. The cost of the
 * cross-origin surface lands only on the cross-origin surface.
 */
export function isCrossOriginRequest(
  parsedOrigin: RequestOrigin | null,
  requestUrl: string
): boolean {
  if (!parsedOrigin) {
    return false;
  }

  try {
    return parsedOrigin.origin !== new URL(requestUrl).origin;
  } catch {
    // An unparseable request URL cannot be shown to be same-origin, and the
    // safe reading of "cannot be shown same-origin" is cross-origin: it leads
    // to the allow-list check rather than around it.
    return true;
  }
}
