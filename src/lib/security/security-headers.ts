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
 * the policy here is what actually covers this app's real surface. The
 * hand-rolled-hash-drift hazard that ruled this approach out for mini does
 * not exist here: this repo ships no `.astro` component, no inline script,
 * no inline style, no inline event handler, and no external origin (grep
 * `is:inline|define:vars|<script|<style|on[a-z]+=|https://` over `src/` —
 * all empty), so there is nothing for `'self'` to break and no hash list to
 * keep in sync.
 *
 * IF THIS BASE EVER GAINS REAL `.astro` PAGES (read before doing so):
 * enabling Astro's `security.csp` at that point would NOT compose with this
 * — Astro would set its own `content-security-policy` (including the
 * script-src/style-src hashes its inlined assets need) during page render,
 * and `src/middleware.ts`'s `headers.set(...)` would then silently REPLACE
 * it with the policy below, which allows no inline script at all. The
 * result is a broken page with no obvious cause. Whoever adds the first
 * page must pick ONE owner for this header: either extend this builder to
 * skip HTML page responses that Astro already stamped, or drop this
 * directive set here and move it into `security.csp`'s `directives`.
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
