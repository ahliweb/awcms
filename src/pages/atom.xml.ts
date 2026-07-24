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
 * `GET /atom.xml` (ADR-0038 §4) — the tenant's Atom 1.0 feed, same
 * bounded item set as `/feed.xml` with Atom `<id>`/`<published>`/`<updated>`
 * entry identity. Optional `?locale=`. 404 when feeds are disabled. Public,
 * cacheable (ETag/Last-Modified/304).
 */
export const GET: APIRoute = ({ request, url }) => {
  const locale = parseDiscoveryLocaleParam(url.searchParams.get("locale"));
  return serveDiscovery(
    request,
    "seo_discovery.atom.failed",
    (ctx) => buildFeedPayload(ctx, "atom", locale),
    { notFound: notFoundXmlResponse, serverError: serverErrorXmlResponse }
  );
};
