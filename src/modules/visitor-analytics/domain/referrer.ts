/**
 * Safe referrer-domain extraction (ported from awcms-micro epic #617-#624).
 * Pure — never throws, never returns anything beyond a bare hostname (no
 * path, query, or fragment, which routinely carry the referring page's own
 * tokens/PII — must never be copied into
 * `awcms_visit_events.referrer_domain`).
 */

/**
 * `null` for a missing/empty/unparseable `Referer` header, or any non-http(s)
 * scheme (e.g. `javascript:`, `data:` — never worth trusting as a referrer
 * domain).
 */
export function extractReferrerDomain(
  rawReferrer: string | null | undefined
): string | null {
  if (!rawReferrer) return null;

  let url: URL;

  try {
    url = new URL(rawReferrer);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  return url.hostname ? url.hostname.toLowerCase() : null;
}
