import type { APIRoute } from "astro";

import {
  notFoundTextResponse,
  serverErrorTextResponse
} from "../lib/html/error-responses";
import {
  parseDiscoveryLocaleParam,
  serveDiscovery
} from "../lib/seo/discovery-route";
import { buildFeedPayload } from "../modules/seo-distribution/application/seo-discovery-service";

/**
 * `GET /feed.json` (ADR-0038 §4) — the tenant's JSON Feed 1.1
 * (JSON Feed is RETAINED by ADR-0038 §4). Same bounded item set as `/feed.xml`,
 * with `content_text` only (never tenant HTML) and stable `id`s. Optional
 * `?locale=`. 404 when feeds are disabled. Public, cacheable
 * (ETag/Last-Modified/304).
 */
export const GET: APIRoute = ({ request, url }) => {
  const locale = parseDiscoveryLocaleParam(url.searchParams.get("locale"));
  return serveDiscovery(
    request,
    "seo_discovery.jsonfeed.failed",
    (ctx) => buildFeedPayload(ctx, "jsonfeed", locale),
    { notFound: notFoundTextResponse, serverError: serverErrorTextResponse }
  );
};
