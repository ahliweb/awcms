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
 * These headers reach the wire from TWO call sites, and both are needed
 * (Issue #464): `src/middleware.ts` covers every RENDERED response — the JSON
 * API, the HTML 404 (`src/lib/html/error-responses.ts`), AND the admin
 * `.astro` pages (#166) — while `src/lib/server/standalone-entry.ts` covers
 * STATIC files, which the node adapter answers before middleware ever runs.
 * Two call sites, still ONE policy: this builder stays the SINGLE CSP owner,
 * and neither caller invents a header of its own.
 *
 * REAL `.astro` PAGES EXIST NOW (login + admin, #166) — how they stay
 * compatible with this `default-src 'self'` (no `'unsafe-inline'`) policy,
 * WITHOUT enabling Astro's own `security.csp` (which would set a SECOND,
 * conflicting `content-security-policy` during page render that this
 * middleware's `headers.set(...)` then silently replaces — a broken page
 * with no obvious cause): the pages ship NO inline style, and exactly ONE
 * inline script. `astro.config.mjs`'s `build.inlineStylesheets: "never"` forces
 * every stylesheet (including Astro scoped `<style>`) out to an external
 * `<link>` from this origin, and every page `<script>` but one is an
 * Astro-bundled module, also external from this origin — both satisfied by
 * `'self'`.
 *
 * THE ONE EXCEPTION — the admin theme-init script (admin-shell parity with
 * awcms-micro). It must run synchronously in `<head>` to prevent a theme
 * flash, which a deferred bundled module cannot do, so it is `is:inline` and
 * its SHA-256 (`THEME_INIT_SCRIPT_HASH`) is named in `script-src`. That makes
 * `script-src` unconditional now, where it used to appear only for Turnstile.
 * A hash is not `'unsafe-inline'`: it admits one exact byte sequence and
 * nothing else, so the single-owner decision and the no-`'unsafe-inline'`
 * guarantee both still hold. `tests/theme-init-script.test.ts` fails if the
 * script body and that hash ever drift apart. Any FURTHER inline script/style
 * must revisit the single-owner decision (see astro.config.mjs).
 *
 * `base-uri 'none'` + `form-action 'self'` are the two that carry real
 * weight for an API-only deployment even though session cookies are already
 * `httpOnly` (Issue #148's own reasoning): `httpOnly` stops XSS from
 * READING a token, but not from RIDING the session via a same-origin
 * `fetch()`, and without `base-uri` an injected `<base href>` can redirect
 * a relative form POST to an attacker origin.
 *
 * CLOUDFLARE TURNSTILE (Issue #186) — `frame-src` and the single
 * `challenges.cloudflare.com` origin are added to `script-src`/`frame-src`
 * ONLY when `turnstileEnabled` is true (the caller passes
 * `isTurnstileRequired()`; `src/middleware.ts`). On every LAN/offline
 * deployment (the default, `turnstileEnabled` false/omitted) NO third-party
 * origin appears anywhere in the policy and there is no `frame-src` at all —
 * that is the "fully off on LAN — no CSP origin" guarantee, and it is
 * unchanged. (What DID change: `script-src` is now always emitted, carrying
 * `'self'` plus the theme-init hash, instead of falling through to
 * `default-src`. Both are same-origin/self-authored — no new origin is
 * reachable.) When Turnstile is enabled, the widget loader (`api.js`) needs
 * `script-src` and its challenge iframe needs `frame-src`, both narrowed to
 * that one origin.
 */
import { TURNSTILE_ORIGIN } from "./turnstile";
import { THEME_INIT_SCRIPT_HASH } from "./theme-init-script";

const BASE_CSP_DIRECTIVES = [
  "default-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'"
] as const;

/**
 * `script-src` is now ALWAYS present, because the admin shell's theme-init
 * script is `is:inline` and needs its SHA-256 explicitly allowed (see
 * `theme-init-script.ts` for why that one script cannot be an Astro-bundled
 * external module like every other script here).
 *
 * This does NOT widen the policy the way `'unsafe-inline'` would: a hash
 * authorises one exact byte sequence. `'self'` is re-stated because naming
 * `script-src` at all stops the fall-through to `default-src`, and the
 * Astro-bundled admin/login clients still have to load from this origin.
 */
function scriptSrcSources(turnstileEnabled: boolean): string {
  const sources = ["'self'", `'${THEME_INIT_SCRIPT_HASH}'`];

  if (turnstileEnabled) {
    sources.push(TURNSTILE_ORIGIN);
  }

  return sources.join(" ");
}

function buildContentSecurityPolicy(turnstileEnabled: boolean): string {
  const directives: string[] = [...BASE_CSP_DIRECTIVES];

  directives.push(`script-src ${scriptSrcSources(turnstileEnabled)}`);

  if (turnstileEnabled) {
    directives.push(`frame-src ${TURNSTILE_ORIGIN}`);
  }

  return directives.join("; ");
}

export type SecurityHeaderOptions = {
  /** Gates `Strict-Transport-Security` — only meaningful once TLS is real. */
  isProduction: boolean;
  /**
   * Opens the Cloudflare Turnstile origin in `script-src`/`frame-src` (Issue
   * #186). Defaults to `false` — omit it and the policy is exactly the
   * pre-#186 LAN/offline policy. Callers pass `isTurnstileRequired()`.
   */
  turnstileEnabled?: boolean;
};

export function buildSecurityHeaders(
  options: SecurityHeaderOptions
): Array<[string, string]> {
  const headers: Array<[string, string]> = [
    [
      "Content-Security-Policy",
      buildContentSecurityPolicy(options.turnstileEnabled === true)
    ],
    ["X-Content-Type-Options", "nosniff"],
    // Kept alongside `frame-ancestors 'none'` as a second, independent
    // layer (older-browser compatibility) — same rationale mini documents.
    ["X-Frame-Options", "DENY"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    [
      "Permissions-Policy",
      "geolocation=(), camera=(), microphone=(), payment=()"
    ],
    // Cross-origin isolation (OWASP Secure Headers Project, "recommended").
    //
    // WHY THESE ARE RIGHT HERE AND WERE REJECTED IN `awcms-astro`
    // ----------------------------------------------------------
    // `awcms-astro` ADR-0028 §D declines a blanket
    // `Cross-Origin-Resource-Policy: same-origin` for a good reason that does
    // NOT transfer: it is a TEMPLATE for public sites, and CORP would decide,
    // on behalf of sites that do not exist yet, whether other origins may embed
    // their images.
    //
    // This repo serves a different surface, and it has no such resource:
    //   - HTML pages are NAVIGATIONS, which CORP does not govern at all;
    //   - the JSON API is already unreachable cross-origin from a browser —
    //     nothing here emits `Access-Control-Allow-Origin` (verified: zero
    //     occurrences in `src/`), so `same-origin` removes no capability that
    //     any browser client has today;
    //   - `public/` holds exactly two files (`js/news-share.js`,
    //     `css/public-content.css`) and `_astro/*` is hashed output — all of it
    //     loaded by this origin's own pages, and all of it now actually
    //     CARRYING these headers: until Issue #464 those responses bypassed
    //     middleware entirely, so this bullet stated an intent, not a fact;
    //   - article images are served from R2 by `media_library`, a DIFFERENT
    //     origin, so image embedding is not this app's decision to make.
    //
    // What they buy: `COOP: same-origin` severs the browsing-context-group tie
    // to any window that opened us (or that we open), which is what stops a
    // cross-origin opener from holding a `window` reference into an
    // authenticated admin session; `CORP: same-origin` blocks `no-cors`
    // subresource embedding of our responses, the side-channel path CORS alone
    // does not close.
    //
    // Turnstile is unaffected: its challenge runs in a CHILD frame (governed by
    // `frame-src`, already allow-listed above), and COOP governs openers and
    // popups, not embedded frames. OIDC/SSO is likewise unaffected — those
    // flows are top-level redirects, not `window.open` handshakes. If a future
    // flow ever needs a cross-origin popup to talk back, THAT is the change
    // that must revisit this line, not this one.
    ["Cross-Origin-Opener-Policy", "same-origin"],
    ["Cross-Origin-Resource-Policy", "same-origin"]
  ];

  if (options.isProduction) {
    headers.push([
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    ]);
  }

  return headers;
}
