import type { APIRoute } from "astro";

import {
  notFoundTextResponse,
  serverErrorTextResponse
} from "../lib/html/error-responses";
import { serveDiscovery } from "../lib/seo/discovery-route";
import { buildRobotsPayload } from "../modules/seo-distribution/application/seo-discovery-service";

/**
 * `GET /robots.txt` (ADR-0038 §4) — the tenant's crawl policy at its
 * verified primary domain root. Server-derived host only (never the raw `Host`);
 * disallows `/admin/` + `/api/`; advertises the absolute sitemap when enabled and
 * a primary host exists; and disallows everything when the tenant-wide `noindex`
 * switch is on. Unauthenticated by design (a public Astro text route, like
 * `/blog/{tenantCode}`); the tenant/host resolution + `seo_distribution`-enabled gate live in
 * `withSeoPublicTenant`, and cache validators (ETag/Last-Modified/304) in
 * `serveDiscovery`.
 */
export const GET: APIRoute = ({ request }) =>
  serveDiscovery(
    request,
    "seo_discovery.robots.failed",
    (ctx) => buildRobotsPayload(ctx),
    { notFound: notFoundTextResponse, serverError: serverErrorTextResponse }
  );
