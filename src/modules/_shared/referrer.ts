/**
 * Referrer-domain extraction. Lives in `_shared` — neutral ground — because two
 * modules genuinely need it and neither owns it.
 *
 * It used to sit in `visitor-analytics/domain/`, and `seo_distribution`'s
 * redirect middleware imported it across the module boundary. That edge was
 * invisible while the middleware lived in `src/lib/seo/`; moving module
 * presentation code into `src/modules/<m>/presentation/` (Issue #257) made the
 * boundary gate see it for the first time.
 *
 * Declaring the edge would have been the wrong fix: it would make
 * `seo_distribution`'s 404 telemetry depend on the analytics module being
 * ENABLED, for a function that reads a string and returns a hostname. There is
 * no state, no query, and nothing tenant-scoped here — which is exactly what
 * `_shared` is for.
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
