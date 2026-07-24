import type { APIRoute } from "astro";

import {
  notFoundXmlResponse,
  serverErrorXmlResponse
} from "../lib/html/error-responses";
import {
  parseDiscoveryLocaleParam,
  serveDiscovery
} from "../lib/seo/discovery-route";
import { buildFeedPayload } from "../modules/seo-distribution/application/seo-discovery-service";

/**
 * `GET /feed.xml` (ADR-0038 §4) — the tenant's RSS 2.0 feed of its
 * latest published items (bounded by `feed_item_limit` ≤ 200), newest-first, with
 * stable GUIDs (absolute canonical URLs) and same-tenant/verified enclosure
 * images. Central, host-based counterpart of the blog-owned `/blog/{tenantCode}/feed.xml`.
 * Optional `?locale=` narrows to one locale. 404 when feeds are disabled. Public,
 * cacheable (ETag/Last-Modified/304).
 */
export const GET: APIRoute = ({ request, url }) => {
  const locale = parseDiscoveryLocaleParam(url.searchParams.get("locale"));
  return serveDiscovery(
    request,
    "seo_discovery.rss.failed",
    (ctx) => buildFeedPayload(ctx, "rss", locale),
    { notFound: notFoundXmlResponse, serverError: serverErrorXmlResponse }
  );
};
