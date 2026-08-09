/**
 * `targetPath` validation (Issue #465) — where a notification click lands.
 *
 * ## Why this is a security check and not input tidying
 *
 * A push notification is rendered by the browser OUTSIDE the page, and its
 * click handler navigates the user wherever the payload says. A queue row that
 * could carry an absolute URL would be a stored open-redirect with a system
 * notification as its delivery vehicle — arriving with the origin's own name
 * and icon on it, which is a far better phishing primitive than a link in a
 * page. So the queue physically cannot hold one: only a same-origin absolute
 * path is accepted, and it is checked HERE, before the row is written, not at
 * render time in a service worker where a second implementation could drift.
 *
 * Rejected, each for its own reason rather than by one loose pattern:
 *
 * - `https://evil.test/x` — absolute URL with an authority.
 * - `//evil.test/x` — protocol-relative; `new URL("//evil.test", base)` resolves
 *   to another ORIGIN while looking like a path to a naive `startsWith("/")`.
 * - `/\evil.test` — backslash, which several browsers normalise to `/` during
 *   URL parsing, producing the protocol-relative case above.
 * - `javascript:...`, `data:...` — schemes, which `startsWith("/")` also misses.
 * - `/a/../../b` — traversal that escapes the intended prefix once resolved.
 *
 * The check is a positive allow-list (`^/[A-Za-z0-9…]` then a normalisation
 * round-trip), not a deny-list of the five cases above, because the deny-list
 * would be complete only until the next URL-parsing quirk.
 */

/** Deliberately conservative: the characters a real in-app destination needs, and nothing else. */
const ALLOWED_PATH_PATTERN = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@/%?#[\]]*$/;

export type PushTargetPathValidation =
  { valid: true; path: string } | { valid: false; reason: string };

export function validatePushTargetPath(
  rawPath: string
): PushTargetPathValidation {
  const path = rawPath.trim();

  if (path.length === 0) {
    return { valid: false, reason: "targetPath must not be empty." };
  }

  if (!path.startsWith("/")) {
    return {
      valid: false,
      reason:
        "targetPath must be an absolute same-origin path starting with `/`."
    };
  }

  // `//host` and `/\host` both resolve to a different origin. Caught before the
  // pattern test so the message names the real problem.
  if (path.startsWith("//") || path.startsWith("/\\")) {
    return {
      valid: false,
      reason:
        "targetPath must not begin with `//` or `/\\` — both resolve to another origin."
    };
  }

  if (!ALLOWED_PATH_PATTERN.test(path)) {
    return {
      valid: false,
      reason:
        "targetPath contains characters that are not allowed in a same-origin path."
    };
  }

  // The round-trip is the part that actually proves it. Anything the two lines
  // above let through is resolved against a throwaway origin; if the result is
  // not still on that origin, it was never a same-origin path regardless of how
  // it looked.
  const probeOrigin = "https://push-target-path.invalid";

  let resolved: URL;

  try {
    resolved = new URL(path, probeOrigin);
  } catch {
    return { valid: false, reason: "targetPath is not a parseable URL path." };
  }

  if (resolved.origin !== probeOrigin) {
    return {
      valid: false,
      reason: "targetPath resolves to a different origin."
    };
  }

  return {
    valid: true,
    path: `${resolved.pathname}${resolved.search}${resolved.hash}`
  };
}
