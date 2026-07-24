import type { APIRoute } from "astro";

import {
  notFoundXmlResponse,
  serverErrorXmlResponse
} from "../lib/html/error-responses";
import { serveDiscovery } from "../lib/seo/discovery-route";
import { buildSitemapIndexPayload } from "../modules/seo-distribution/application/seo-discovery-service";

/**
 * `GET /sitemap.xml` (ADR-0038 §4) — the sitemap INDEX. Sizes itself
 * from a cheap bounded `summarize` roll-up (never enumerates all content) and
 * lists deterministic child sitemaps (`/sitemap-{n}.xml`), always at least page 1,
 * capped at the amplification ceiling. `<loc>`s use the server-derived primary
 * host. 404 (as a generic XML error) when the tenant disables sitemaps. Public,
 * cacheable (ETag/Last-Modified/304 via `serveDiscovery`).
 */
export const GET: APIRoute = ({ request }) =>
  serveDiscovery(
    request,
    "seo_discovery.sitemap_index.failed",
    (ctx) => buildSitemapIndexPayload(ctx),
    { notFound: notFoundXmlResponse, serverError: serverErrorXmlResponse }
  );
