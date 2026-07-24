/**
 * Client IP resolution for visitor analytics (ported from awcms-micro epic
 * #617-#624). Pure — only ever trusts a forwarded header when the deployment
 * has explicitly opted in via
 * `VISITOR_ANALYTICS_TRUST_PROXY`/`VISITOR_ANALYTICS_TRUST_CLOUDFLARE` (the
 * module's config gate) — never trust a spoofable client-supplied header
 * without a trusted proxy in front that actually overwrites it.
 *
 * Returns `null` (never a fake "unknown" placeholder) when no IP is
 * resolvable — `null` correctly hashes to nothing and stores as SQL `NULL`
 * in `ip_hash`/`ip_address`, rather than a meaningless-but-real-looking hash
 * of the literal string `"unknown"`.
 *
 * Ambiguous-header fail-safe: a forwarded header carrying more than one
 * comma-separated value is treated as an anomaly, not "just proxy chaining"
 * — this base has no "N trusted hops" configuration to anchor a "take the
 * Nth value from the right" rule on (same reasoning
 * `lib/tenant/public-host-tenant-resolver.ts`'s `extractHostHeader` uses for
 * `X-Forwarded-Host`), so an ambiguous header is logged as a warning and
 * never trusted, falling through to the next source in the chain exactly as
 * if that trust flag were `false` for this one request.
 */
import { log } from "../../../lib/logging/logger";

/** `null` if the header is absent/blank, the single value if unambiguous, `null` (with a warning logged) if it carries more than one comma-separated value. */
function extractSingleTrustedHeaderValue(
  request: Request,
  headerName: string,
  warningEvent: string
): string | null {
  const raw = request.headers.get(headerName);

  if (!raw || raw.trim().length === 0) {
    return null;
  }

  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 1) {
    return parts[0] as string;
  }

  if (parts.length > 1) {
    // Log ONLY anomaly metadata — never the header value itself. A forwarded
    // header's first entry is a raw client IP; emitting even a fragment of it
    // would write an unhashed IP to logs, bypassing the `rawIpEnabled` opt-in
    // that the storage path honors. `valueCount` is enough to spot the anomaly.
    log("warning", warningEvent, {
      moduleKey: "visitor_analytics",
      valueCount: parts.length
    });
  }

  return null;
}

export function resolveAnalyticsClientIp(
  request: Request,
  clientAddress: string | undefined,
  trustConfig: { trustProxy: boolean; trustCloudflare: boolean }
): string | null {
  if (trustConfig.trustCloudflare) {
    const cfIp = extractSingleTrustedHeaderValue(
      request,
      "cf-connecting-ip",
      "visitor_analytics.client_ip.cf_connecting_ip_multi_value"
    );
    if (cfIp) return cfIp;
  }

  if (trustConfig.trustProxy) {
    const forwardedFor = extractSingleTrustedHeaderValue(
      request,
      "x-forwarded-for",
      "visitor_analytics.client_ip.x_forwarded_for_multi_value"
    );
    if (forwardedFor) return forwardedFor;
  }

  return clientAddress?.trim() || null;
}
