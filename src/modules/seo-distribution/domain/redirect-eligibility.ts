/**
 * Redirect-eligibility gate (ADR-0039; adapted from awcms-micro ADR-0028 §8) — the
 * admin-route-hijack defense. Decides whether an incoming public request path may be
 * intercepted by a TENANT-authored redirect rule at all. A tenant redirect must
 * NEVER intercept an admin, API, auth, static-asset, framework-internal, discovery,
 * or system-owned path — this pure predicate is where that guarantee lives, checked
 * in `src/middleware.ts` BEFORE any rule lookup and independently unit-tested.
 *
 * It is a DENY-list, not an allow-list, because legitimate public content paths
 * are open-ended (any tenant slug). It fails SAFE: a path that does not start with
 * `/`, or that matches any excluded family, returns `false` (not eligible → never
 * redirected). The middleware additionally only ever calls this on the non-`/admin`
 * branch, so `/admin/*` is excluded twice; and every emitted target is still run
 * through the frozen `assertSafeRedirectTarget` guard — this predicate governs the
 * SOURCE side, the guard governs the TARGET side.
 *
 * The exact discovery routes shipped by the DISCOVERY half of this module
 * (`/robots.txt`, `/sitemap.xml`, `/sitemap-{n}.xml`, `/feed.xml`, `/atom.xml`,
 * `/feed.json`) are excluded here so a tenant redirect can never shadow them.
 */

/** Static asset extensions — a request for one of these is never a redirectable page. */
const STATIC_ASSET_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "avif",
  "ico",
  "bmp",
  "css",
  "js",
  "mjs",
  "cjs",
  "map",
  "json",
  "xml",
  "txt",
  "woff",
  "woff2",
  "ttf",
  "eot",
  "otf",
  "wasm",
  "pdf",
  "zip",
  "webmanifest"
]);

/**
 * Excluded when the (lowercased) path equals the prefix OR continues with a `/`.
 * Word-boundary matching so `/admin` and `/admin/x` are excluded but a legitimate
 * content path like `/administration` is NOT swallowed.
 */
const EXCLUDED_SEGMENT_PREFIXES = [
  "/admin",
  "/login",
  "/logout",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/setup",
  "/auth",
  "/openapi",
  "/asyncapi"
];

/** Excluded when the (lowercased) path starts with the prefix (already includes its boundary). */
const EXCLUDED_STARTSWITH = ["/api/", "/_", "/.well-known/", "/sitemap-"];

/** Excluded exact system/framework/discovery paths (lowercased). */
const EXCLUDED_EXACT = new Set([
  "/health",
  "/robots.txt",
  "/sitemap.xml",
  "/feed.xml",
  "/atom.xml",
  "/feed.json"
]);

/**
 * `true` when the string contains any C0 control char (U+0000–U+001F) or DEL
 * (U+007F). Implemented with char codes (not a control-char regex literal) so the
 * source file stays free of embedded control bytes. Used on the DECODED path so an
 * encoded control (e.g. `%0A`) can't slip the eligibility gate.
 */
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function fileExtension(pathname: string): string | null {
  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  const dot = lastSegment.lastIndexOf(".");
  if (dot <= 0) return null;
  return lastSegment.slice(dot + 1).toLowerCase();
}

/**
 * `true` only when a tenant redirect rule may be applied to `pathname`. `pathname`
 * is the request path WITHOUT query/fragment (the caller passes `url.pathname`).
 * Case-insensitive on the excluded families (so a `/Admin` variant that slips past
 * Astro's case-sensitive route table can never be redirect-hijacked either).
 */
export function isRedirectEligiblePath(pathname: string): boolean {
  if (typeof pathname !== "string" || !pathname.startsWith("/")) {
    return false;
  }

  // Defensive: a control character / whitespace in the path is never a real page
  // request we should try to redirect (and would be rejected by normalization
  // anyway) — fail safe.
  if (/[\u0000-\u0020\u007f]/.test(pathname)) {
    return false;
  }

  // Percent-DECODE before the family/extension checks so an encoded reserved
  // path can't slip the gate — `/%61pi/...` (→ `/api/...`) or `/api%2fv1/...`
  // (→ `/api/v1/...`) must be recognized as the API family, not treated as opaque.
  // A malformed percent-sequence is not a real page request — fail safe.
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }

  // A control character revealed only after decoding (e.g. `%0A`) is likewise
  // never a real page — fail safe (belt-and-braces with the raw check above).
  if (hasControlCharacter(decoded)) {
    return false;
  }

  const lower = decoded.toLowerCase();

  if (EXCLUDED_EXACT.has(lower)) {
    return false;
  }

  if (lower.includes("favicon")) {
    return false;
  }

  for (const prefix of EXCLUDED_STARTSWITH) {
    if (lower.startsWith(prefix)) {
      return false;
    }
  }

  for (const prefix of EXCLUDED_SEGMENT_PREFIXES) {
    if (lower === prefix || lower.startsWith(`${prefix}/`)) {
      return false;
    }
  }

  const extension = fileExtension(lower);
  if (extension && STATIC_ASSET_EXTENSIONS.has(extension)) {
    return false;
  }

  return true;
}
