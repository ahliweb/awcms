/**
 * HTTP cache validators for the public discovery surfaces (ADR-0038
 * §7). Pure: given a deterministic "signature" of everything that shapes a
 * response — the surface kind, server-derived host, locale, contract version,
 * tenant config fingerprint, and a bounded content roll-up (count + latest
 * timestamps) — it produces a strong `ETag` and a `Last-Modified`, and decides
 * whether an incoming conditional request (`If-None-Match` / `If-Modified-Since`)
 * is satisfied (→ 304).
 *
 * ## Why a signature, and why it is correct (the event-driven invalidation)
 *
 * The ETag is `hash(signature)`, and the signature captures every input the body
 * is a deterministic function of. So publish/update/archive/delete/restore
 * (which move the content roll-up's `count`/`latestLastmod`), a domain change
 * (host), a locale change, and any feed/robots config edit ALL change the
 * signature → change the ETag/Last-Modified → a previously-cached copy
 * revalidates (200 with fresh content) instead of getting a 304. That is the
 * ADR-0038 §7 "event-driven invalidation" implemented as content-derived
 * validators, which is the honest mechanism for HTTP caching without a
 * server-side content store. It relies on the codebase-wide invariant that every
 * content mutation bumps `updated_at` (so `latestLastmod` advances on any edit) —
 * true across `awcms_blog_posts` and every other content table.
 *
 * Same ETag source is used for the 200 response header AND the 304 comparison,
 * so a client's stored `If-None-Match` always compares against the same function.
 */

/** The parts a cache signature is built from — order-fixed, NUL-joined so no value can be shifted into another's position. */
export type DiscoverySignatureParts = {
  /** e.g. `"robots"`, `"sitemap-index"`, `"sitemap-page"`, `"rss"`, `"atom"`, `"jsonfeed"`. */
  kind: string;
  /** The resolved tenant id — the primary isolation key (host alone is not enough: a not-yet-verified tenant serves under a null-host sentinel). */
  tenantId: string;
  /** Server-derived primary host (or a stable no-host sentinel) — NEVER the raw request Host. */
  host: string;
  locale: string;
  /** `CAPABILITY_CONTRACT_VERSIONS["seo_facts"]` — a contract shape change invalidates every entry. */
  contractVersion: string;
  /** Optional page discriminator for child sitemaps. */
  page?: number;
  /** Tenant config fingerprint (feed title/description/logo/limit/included types/enabled flags/noindex). */
  configFingerprint: string;
  /** Content roll-up fingerprint: `count|latestLastmod|latestPublishedAt`. */
  contentFingerprint: string;
};

/**
 * Join parts into the canonical signature string. NUL-separated (not
 * space-separated) so the join is INJECTIVE: `configFingerprint` and
 * `contentFingerprint` embed free-text tenant values that can contain spaces, so
 * a space separator could let one part's tail merge into the next and make two
 * distinct part tuples collide onto one signature/ETag. NUL never appears in any
 * part (paths/hosts/ids/fingerprints are all NUL-free), so the boundaries are
 * unambiguous. `tenantId` leads the identity fields as the primary isolation key.
 */
export function buildDiscoverySignature(
  parts: DiscoverySignatureParts
): string {
  return [
    "seo-discovery",
    parts.kind,
    parts.contractVersion,
    parts.tenantId,
    parts.host.toLowerCase(),
    parts.locale,
    parts.page === undefined ? "" : String(parts.page),
    parts.configFingerprint,
    parts.contentFingerprint
  ].join("\u0000");
}

/** SHA-256 hex of a signature string. Bun-native synchronous hasher (no crypto-strength needed — this is change-detection, not a secret). */
export function contentHash(signature: string): string {
  return new Bun.CryptoHasher("sha256").update(signature).digest("hex");
}

/** Strong ETag (quoted) for a signature — the first 32 hex chars are ample for change-detection. */
export function buildEtag(signature: string): string {
  return `"${contentHash(signature).slice(0, 32)}"`;
}

/** RFC-7231 HTTP-date for a `Last-Modified` value. */
export function toHttpDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toUTCString();
}

/** Strip an optional weak-validator `W/` prefix and surrounding whitespace. */
function normalizeEtag(tag: string): string {
  return tag.trim().replace(/^W\//, "");
}

/** `true` when any tag in a comma-separated `If-None-Match` value matches `etag` (or `*`). */
export function ifNoneMatchSatisfied(
  headerValue: string,
  etag: string
): boolean {
  const target = normalizeEtag(etag);
  return headerValue.split(",").some((raw) => {
    const tag = raw.trim();
    if (tag === "*") return true;
    return normalizeEtag(tag) === target;
  });
}

/**
 * Decide whether a conditional request is satisfied (caller returns 304).
 * `If-None-Match` takes precedence over `If-Modified-Since` (RFC 7232 §6). The
 * date comparison is second-granular (HTTP dates carry no sub-second precision),
 * and "not modified" means our `Last-Modified` is at or before the client's copy.
 */
export function isNotModified(
  requestHeaders: Headers,
  etag: string,
  lastModifiedHttpDate: string
): boolean {
  const inm = requestHeaders.get("if-none-match");
  if (inm !== null) {
    return ifNoneMatchSatisfied(inm, etag);
  }

  const ims = requestHeaders.get("if-modified-since");
  if (ims !== null) {
    const since = Date.parse(ims);
    const lastModified = Date.parse(lastModifiedHttpDate);
    if (!Number.isNaN(since) && !Number.isNaN(lastModified)) {
      return Math.floor(lastModified / 1000) <= Math.floor(since / 1000);
    }
  }

  return false;
}

/** The `Cache-Control` value for every discovery response (200 and 304 alike). */
export function buildDiscoveryCacheControl(
  maxAge: number,
  sMaxAge: number,
  staleWhileRevalidate: number
): string {
  return `public, max-age=${maxAge}, s-maxage=${sMaxAge}, stale-while-revalidate=${staleWhileRevalidate}`;
}
