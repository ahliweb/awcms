import type { APIRoute } from "astro";

import { serveThemePreviewTokensCss } from "../../../lib/theming/theme-preview";

/**
 * `GET /theming/preview-tokens/{token}.css` (Issue #269, ADR-0029 §6) — the DRAFT
 * theme's token stylesheet for an authorized preview session. NON-INDEXABLE
 * (`X-Robots-Tag: noindex`) + `Cache-Control: private, no-store` + a URL namespace
 * distinct from `/theming/tokens.css`, so a preview can never poison the public /
 * CDN cache. The `{token}` is `${tenantId}~${rawToken}`; the raw token is hashed
 * and matched inside the tenant transaction (RLS), so it cannot resolve another
 * tenant's session.
 */
export const GET: APIRoute = ({ params }) =>
  serveThemePreviewTokensCss(params.token ?? "");
