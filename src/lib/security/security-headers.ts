/**
 * Content-Security-Policy (Issue #148).
 *
 * WHY THIS IS SET HERE AND NOT VIA ASTRO'S `security.csp` (astro.config.mjs)
 * -------------------------------------------------------------------------
 * awcms-mini delegates its CSP to Astro's own built-in `security.csp`
 * feature, because mini renders real `.astro` pages whose per-component
 * inline `<script>`/`<style>` blocks Astro must hash itself (a hand-rolled
 * hash list there was tried and found to drift — see mini's
 * `astro.config.mjs` header). Porting that block verbatim into THIS repo
 * would set exactly zero headers: Astro emits the CSP only from its PAGE
 * render path (`astro/dist/runtime/server/render/page.js`), and this base
 * has no pages at all — `src/pages/` contains only API endpoints
 * (`src/pages/api/v1/**`), which Astro serves without ever going through
 * that path. The two HTML responses this app can produce
 * (`src/lib/html/error-responses.ts`) are likewise plain `Response`s
 * returned from endpoints, not rendered pages.
 *
 * `src/middleware.ts` applies these headers to EVERY response, so setting
 * the policy here is what actually covers this app's real surface — the JSON
 * API, the HTML 404 (`src/lib/html/error-responses.ts`), AND the admin
 * `.astro` pages (#166). This builder stays the SINGLE CSP owner.
 *
 * REAL `.astro` PAGES EXIST NOW (login + admin, #166) — how they stay
 * compatible with this `default-src 'self'` (no `'unsafe-inline'`) policy,
 * WITHOUT enabling Astro's own `security.csp` (which would set a SECOND,
 * conflicting `content-security-policy` during page render that this
 * middleware's `headers.set(...)` then silently replaces — a broken page
 * with no obvious cause): the pages ship NO inline script and NO inline
 * style. `astro.config.mjs`'s `build.inlineStylesheets: "never"` forces every
 * stylesheet (including Astro scoped `<style>`) out to an external `<link>`
 * from this origin, and every page `<script>` is an Astro-bundled module
 * (never `is:inline`), also external from this origin — both satisfied by
 * `'self'`. So there is still nothing inline for this policy to break, and no
 * hash list to keep in sync. A future page that genuinely needs inline
 * script/style must revisit the single-owner decision (see astro.config.mjs).
 *
 * Directives mirror mini's set, minus `frame-src` and the Turnstile/YouTube
 * origins it allowlists — this base has no widget, no embed, and no iframe
 * of any kind, so `frame-src` correctly falls through to `default-src`.
 *
 * `base-uri 'none'` + `form-action 'self'` are the two that carry real
 * weight for an API-only deployment even though session cookies are already
 * `httpOnly` (Issue #148's own reasoning): `httpOnly` stops XSS from
 * READING a token, but not from RIDING the session via a same-origin
 * `fetch()`, and without `base-uri` an injected `<base href>` can redirect
 * a relative form POST to an attacker origin.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

export type SecurityHeaderOptions = {
  /** Gates `Strict-Transport-Security` — only meaningful once TLS is real. */
  isProduction: boolean;
};

export function buildSecurityHeaders(
  options: SecurityHeaderOptions
): Array<[string, string]> {
  const headers: Array<[string, string]> = [
    ["Content-Security-Policy", CONTENT_SECURITY_POLICY],
    ["X-Content-Type-Options", "nosniff"],
    // Kept alongside `frame-ancestors 'none'` as a second, independent
    // layer (older-browser compatibility) — same rationale mini documents.
    ["X-Frame-Options", "DENY"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    [
      "Permissions-Policy",
      "geolocation=(), camera=(), microphone=(), payment=()"
    ]
  ];

  if (options.isProduction) {
    headers.push([
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    ]);
  }

  return headers;
}
