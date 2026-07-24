/**
 * Trusted online geolocation enrichment (ported from awcms-micro epic
 * #617-#624). Pure — reads only already-present, trusted request headers;
 * never makes an external network call (binding constraint — no third-party
 * geolocation API is ever called from the request path).
 *
 * Country code only, from Cloudflare's `CF-IPCountry` header, and only when
 * both `VISITOR_ANALYTICS_GEO_ENABLED` and `VISITOR_ANALYTICS_TRUST_CLOUDFLARE`
 * are `true` — Cloudflare's free tier reliably provides country via that
 * header; region/city/timezone require either Cloudflare's paid IP
 * Geolocation add-on or a local/offline GeoIP database (neither implemented
 * here). Those three fields are always `null`; this is a documented gap, not
 * a bug — `resolveGeoEnrichment` never fabricates a value.
 *
 * BINDING: never used for authorization, rate-limiting, or tenant resolution
 * — analytics-only, same rule `domain/user-agent.ts`'s human/bot
 * classification follows.
 */
export type GeoEnrichment = {
  countryCode: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
};

const EMPTY_GEO: GeoEnrichment = {
  countryCode: null,
  region: null,
  city: null,
  timezone: null
};

/**
 * Cloudflare's `CF-IPCountry` is a 2-letter ISO 3166-1 alpha-2 code, or one
 * of a small set of non-country sentinels (`XX` unknown, `T1` Tor exit node,
 * `EU` region-only edge case) — all still short alphanumeric codes, so this
 * only guards against something obviously not a country-code-shaped value
 * ever being stored (e.g. an empty string, or a header some misbehaving
 * intermediary stuffed with unrelated text).
 */
const COUNTRY_CODE_PATTERN = /^[A-Z0-9]{2,3}$/i;

function normalizeCountryCode(raw: string | null): string | null {
  if (!raw) return null;

  const trimmed = raw.trim().toUpperCase();

  return COUNTRY_CODE_PATTERN.test(trimmed) ? trimmed : null;
}

export function resolveGeoEnrichment(
  request: Request,
  config: { geoEnabled: boolean; trustCloudflare: boolean }
): GeoEnrichment {
  if (!config.geoEnabled || !config.trustCloudflare) {
    return EMPTY_GEO;
  }

  const countryCode = normalizeCountryCode(request.headers.get("cf-ipcountry"));

  return { ...EMPTY_GEO, countryCode };
}
