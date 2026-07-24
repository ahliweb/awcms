import type { APIRoute } from "astro";

import {
  notFoundXmlResponse,
  serverErrorXmlResponse
} from "../lib/html/error-responses";
import { serveDiscovery } from "../lib/seo/discovery-route";
import { buildSitemapPagePayload } from "../modules/seo-distribution/application/seo-discovery-service";

/**
 * `GET /sitemap-{page}.xml` (ADR-0038 §4) — one bounded child sitemap
 * (`<urlset>`), page `N` = the `[(N-1)*perPage, N*perPage)` window of the tenant's
 * public, indexable, canonical URLs in a stable order. Includes reciprocal
 * `hreflang` alternates (for genuinely multi-locale resources) + published image
 * refs resolved same-tenant/verified. A non-integer, out-of-range, or
 * disabled-sitemap request 404s (generic XML). Every URL passes the frozen
 * `isPubliclyIndexable` guard, so nothing draft/private/deleted/noindex leaks.
 *
 * The page segment must be a plain run of decimal digits: `Number("1e3")`,
 * `Number("0x10")`, `Number(" 5 ")` all coerce to a value, so a bare `Number()`
 * would let `/sitemap-1e3.xml`, `/sitemap-0x10.xml`, `/sitemap-%205.xml` resolve.
 * A `^\d+$` gate rejects those up front (→ `NaN` → the builder's `< 1` guard →
 * generic 404).
 */
export const GET: APIRoute = ({ request, params }) => {
  const raw = params.page ?? "";
  const page = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  return serveDiscovery(
    request,
    "seo_discovery.sitemap_page.failed",
    (ctx) => buildSitemapPagePayload(ctx, page),
    { notFound: notFoundXmlResponse, serverError: serverErrorXmlResponse }
  );
};
