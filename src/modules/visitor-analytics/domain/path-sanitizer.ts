/**
 * Path/query sanitization and pageview-eligibility helpers (ported from
 * awcms-micro epic #617-#624). Pure — no request I/O; the collector calls
 * these with the request's own pathname+query before anything is stored in
 * `awcms_visit_events`.
 *
 * BINDING: `sanitizePath`'s output is the ONLY form a path may take before
 * it reaches `path_sanitized` (migration 050) — a raw, un-sanitized
 * path/query string must never be persisted, since query strings routinely
 * carry tokens/secrets (password reset links, OAuth codes, MFA challenge
 * tokens) that must never land in an analytics table.
 */

/**
 * Matched case-insensitively against query parameter names. `mfaChallengeToken`
 * is included verbatim (its lowercase form is what's actually compared).
 */
const SENSITIVE_QUERY_PARAM_NAMES = new Set([
  "token",
  "code",
  "password",
  "secret",
  "email",
  "phone",
  "authorization",
  "access_token",
  "refresh_token",
  "reset_token",
  "mfachallengetoken"
]);

/**
 * Strips every sensitive query parameter and returns `pathname` (+ remaining
 * safe query string, if any). Never throws.
 *
 * Fail SAFE, not fail open: a `rawPath` that `URL` cannot parse degrades to
 * its path portion only (query string dropped entirely), never to the raw,
 * un-sanitized input — the very thing this function exists to prevent from
 * reaching `path_sanitized`. A pageview with a stripped query string is
 * still useful analytics signal; echoing an unparseable-and-therefore-
 * unstrippable query string is a real leak path.
 */
export function sanitizePath(rawPath: string): string {
  let url: URL;

  try {
    url = new URL(rawPath, "http://internal.invalid");
  } catch {
    return rawPath.split("?")[0] ?? rawPath;
  }

  for (const key of [...url.searchParams.keys()]) {
    if (SENSITIVE_QUERY_PARAM_NAMES.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }

  const query = url.searchParams.toString();

  return query ? `${url.pathname}?${query}` : url.pathname;
}

const STATIC_ASSET_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "avif",
  "ico",
  "css",
  "js",
  "mjs",
  "woff",
  "woff2",
  "ttf",
  "eot",
  "otf",
  "map"
]);

/** Path prefixes that are always internal build/runtime assets, never a pageview. */
const SKIPPED_PATH_PREFIXES = ["/_astro/", "/_actions/", "/_image"];

/** Any path segment (case-insensitive) that marks the whole path as non-trackable. */
const SKIPPED_PATH_SEGMENTS = new Set(["health"]);

function fileExtension(pathname: string): string | null {
  const match = pathname.match(/\.([a-z0-9]+)$/i);
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * `false` for static assets, internal framework/build paths, health
 * endpoints, and OpenAPI/AsyncAPI spec files — none of these represent a
 * human/bot visiting a page, so the collector must skip writing a
 * `visit_events` row for them. `pathname` should already be the sanitized
 * form from `sanitizePath` (or any plain path) — this function never
 * inspects the query string.
 */
export function isTrackablePath(pathname: string): boolean {
  const normalized = pathname.split("?")[0] ?? pathname;

  if (SKIPPED_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return false;
  }

  if (normalized.toLowerCase().includes("favicon")) {
    return false;
  }

  const extension = fileExtension(normalized);
  if (extension && STATIC_ASSET_EXTENSIONS.has(extension)) {
    return false;
  }

  if (/^\/(openapi|asyncapi)(\/|$)/i.test(normalized)) {
    return false;
  }

  if (
    (extension === "yaml" || extension === "yml") &&
    /spec/i.test(normalized)
  ) {
    return false;
  }

  const segments = normalized.split("/").filter(Boolean);
  if (
    segments.some((segment) => SKIPPED_PATH_SEGMENTS.has(segment.toLowerCase()))
  ) {
    return false;
  }

  return true;
}
