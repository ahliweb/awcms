/**
 * Redirect-target classification — the FROZEN open-redirect / cross-tenant guard
 * (ADR-0039, redirect-governance scope; adapted from awcms-micro ADR-0028 §8, where
 * these helpers lived in `_shared/ports/seo-facts-port.ts:363-458`, HIGH-1-hardened
 * in awcms-micro #265).
 *
 * ## Why this lives HERE, not in the `seo_facts` port
 *
 * awcms deliberately EXCLUDED these helpers from its `seo_facts` port when it landed
 * the discovery half (ADR-0038 — see `_shared/ports/seo-facts-port.ts`'s header,
 * lines 14-20): the sitemap/feed/robots/metadata surfaces do not need a redirect
 * concept, and carrying it there would drag a redirect notion into a
 * content-facts contract with no consumer. When redirect governance re-enters
 * (ADR-0039), the classifier re-homes as STANDALONE domain helpers in the module
 * that actually owns redirects — NOT back into the port. The logic below is a
 * byte-for-byte semantic copy of awcms-micro's frozen guard; every rejection is a
 * security control, never a nicety.
 *
 * Only `same_tenant_internal` targets are safe to emit:
 *  - a same-origin RELATIVE path (`/x/y`) → `same_tenant_internal`;
 *  - an ABSOLUTE `http(s)` URL whose host is one of the tenant's registered hosts →
 *    `same_tenant_internal`;
 *  - an absolute `http(s)` URL to any other host → `cross_host_external`;
 *  - anything else — protocol-relative `//evil.com`, backslash tricks
 *    (`/\evil.com`), embedded control characters, non-http(s) schemes
 *    (`javascript:`, `data:`, `mailto:`), or unparseable input → `invalid`.
 *
 * The relative branch NEVER trusts the leading `/` alone: it re-parses the target
 * against a synthetic unresolvable base and confirms the resolved origin did not
 * escape it. Combined with the C0/DEL rejection below, this closes the
 * `"/\t/evil.com"` class of bypass (the WHATWG URL parser and browsers strip
 * TAB/LF/CR, so such a target would otherwise resolve to `//evil.com` →
 * `https://evil.com/` while looking like a same-origin path).
 */

export type RedirectTargetClass =
  "same_tenant_internal" | "cross_host_external" | "invalid";

export function classifyRedirectTarget(
  target: string,
  allowedHosts: readonly string[]
): RedirectTargetClass {
  if (typeof target !== "string" || target.trim() === "") return "invalid";

  // Reject C0 control characters (U+0000–U+001F) and DEL (U+007F). Browsers and
  // the WHATWG URL parser STRIP tab (U+0009), newline (U+000A), and carriage
  // return (U+000D) from a URL before parsing, so "/\t/evil.com" collapses to
  // "//evil.com" and would slip past a naive `startsWith("/")` relative-path
  // check as `same_tenant_internal` (a verified open-redirect bypass). Rejecting
  // the whole C0+DEL range is stricter than strictly necessary — a bare space or
  // NUL would otherwise be percent-encoded and stay same-origin — but never
  // unsafe (ADR-0039 / awcms-micro ADR-0028 §8).
  if (/[\u0000-\u001f\u007f]/.test(target)) return "invalid";

  // Protocol-relative (`//host`) and backslash-normalized variants (`/\host`,
  // `\/host`) are browser-interpreted as absolute cross-origin — reject before
  // the relative branch.
  const firstTwo = target.slice(0, 2);
  if (firstTwo === "//" || firstTwo === "/\\" || firstTwo === "\\/") {
    return "invalid";
  }

  // Synthetic base on an RFC-6761 `.invalid` host that can never resolve: a
  // genuine same-origin relative path resolves back to THIS origin; anything
  // that escaped to another origin does not.
  const syntheticBase = "https://seo-distribution.invalid";

  if (target.startsWith("/")) {
    // Path-absolute relative reference — normalize and confirm it did not
    // escape the synthetic origin. Never trust the `/` prefix on its own.
    let resolved: URL;
    try {
      resolved = new URL(target, syntheticBase);
    } catch {
      return "invalid";
    }
    return resolved.origin === syntheticBase
      ? "same_tenant_internal"
      : "invalid";
  }

  // Absolute reference (or unparseable).
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return "invalid";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "invalid";

  const allowed = new Set(allowedHosts.map((h) => h.toLowerCase()));
  return allowed.has(url.hostname.toLowerCase())
    ? "same_tenant_internal"
    : "cross_host_external";
}

/** Throws unless `target` classifies as `same_tenant_internal` — the enforced form of `classifyRedirectTarget`. */
export function assertSafeRedirectTarget(
  target: string,
  allowedHosts: readonly string[]
): void {
  const cls = classifyRedirectTarget(target, allowedHosts);
  if (cls !== "same_tenant_internal") {
    throw new Error(
      `assertSafeRedirectTarget: redirect target ${JSON.stringify(
        target
      )} is "${cls}", not same-tenant-internal — SEO redirects must never open-redirect or cross tenants (ADR-0039 / ADR-0028 §8).`
    );
  }
}
