import type { APIRoute } from "astro";

import {
  buildWebAppManifest,
  resolvePwaIdentity
} from "../lib/pwa/web-app-manifest";

/**
 * `GET /manifest.webmanifest` (Issue #1105) -- the installable-admin manifest.
 *
 * Unauthenticated by design: the browser fetches it while deciding whether the
 * page is installable, and it holds deployment branding only (no tenant, no
 * user, no secret). It is NOT derived from the request `Host`; see
 * `src/lib/pwa/web-app-manifest.ts`.
 *
 * Cache: revalidated hourly so a rename or recolour reaches installed apps
 * without a redeploy dance, and never `immutable`.
 */
export const GET: APIRoute = () =>
  new Response(
    JSON.stringify(buildWebAppManifest(resolvePwaIdentity(process.env))),
    {
      status: 200,
      headers: {
        "content-type": "application/manifest+json; charset=utf-8",
        "cache-control": "public, max-age=3600, must-revalidate",
        "x-content-type-options": "nosniff"
      }
    }
  );
