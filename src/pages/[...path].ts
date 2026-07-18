import type { APIRoute } from "astro";

import { fail } from "../modules/_shared/api-response";
import { notFoundHtmlResponse } from "../lib/html/error-responses";

/**
 * Catch-all fallback for any request path that no more-specific route matches.
 * Astro ranks rest params (`[...path]`) lowest, so every real route — every
 * `src/pages/api/v1/**` endpoint and every future admin `.astro` page — wins
 * over this file; it only ever runs for genuinely unmatched paths.
 *
 * WHY THIS EXISTS: without it, an unknown path falls through to Astro's own
 * default 404, which is framework chrome, not something this app controls. A
 * public API server should answer a bad path with (a) a clean, generic HTML
 * page for a browser, leaking NOTHING about internals (Issue #540: "error
 * output must not expose stack traces" — enforced by
 * `tests/e2e/not-found.e2e.ts`), and (b) the standard JSON error envelope for
 * an `/api/*` client, so a mistyped endpoint answers in the same shape as
 * every other API error rather than as HTML. This finally wires the
 * public-facing HTML error responses (`src/lib/html/error-responses.ts`) that
 * shipped for exactly this purpose.
 *
 * `ALL` handles every method: a bad path is 404 regardless of verb. (A real
 * route with the path but no handler for the method still returns 405 from
 * that route — Astro matches the path first, so this never masks a 405.)
 */
export const ALL: APIRoute = ({ url }) => {
  if (url.pathname.startsWith("/api/")) {
    return fail(404, "NOT_FOUND", "The requested resource does not exist.");
  }

  return notFoundHtmlResponse();
};
