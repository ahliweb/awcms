import type { APIRoute } from "astro";

import { serveActiveThemeTokensCss } from "../../../lib/theming/theme-public-css";

/**
 * `GET /theming/{tenantCode}/tokens.css` (ADR-0034 Fase 3; ported from
 * awcms-micro Issue #269/ADR-0029 §7) — the active published theme's design-token
 * custom properties for the `tenantCode`-resolved tenant, as an EXTERNAL
 * same-origin `text/css` stylesheet the public layout links (never an inline
 * `<style>`, so the app's CSP `style-src 'self'` is never weakened).
 *
 * The public tenant is resolved by the `{tenantCode}` path segment (ADR-0009 —
 * awcms resolves public tenants by code, not Host; this is the port adaptation of
 * awcms-micro's Host-based resolver). Always a valid 200/304 (default theme
 * tokens when no tenant/active theme resolves), so there is no tenant-enumeration
 * oracle. Unauthenticated by design (a public presentation asset, like
 * `/robots.txt`); the `theming`-enabled gate + cache validators live in
 * `serveActiveThemeTokensCss`.
 */
export const GET: APIRoute = ({ request, params }) =>
  serveActiveThemeTokensCss(request, params.tenantCode ?? "");
