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
 *
 * VIDEO EMBEDS (ADR-0110) — the second and last opt-in origin, on the same
 * pattern and for the same reason. `_shared/rendering/video-news-block-
 * renderer.ts` has emitted a correct `youtube-nocookie.com` iframe since Issue
 * #639 and the browser has blocked every one of them, because this policy
 * named no such origin; that renderer's own header records the degradation and
 * names "a future opt-in flag mirroring Turnstile's pattern" as the fix. With
 * `videoEmbedEnabled` false (the default, and every deployment that has not
 * asked for video) the policy is byte-for-byte the pre-ADR-0110 one. The two
 * switches are INDEPENDENT: either, both, or neither, and `frame-src` appears
 * when at least one is on, listing exactly the origins that are.
 *
 * MEDIA IMAGES — `img-src`, and why its absence was invisible. `default-src`
 * governs images too, so until this directive existed the policy said
 * `img-src 'self'` by fall-through. Every article/gallery image is served from
 * R2, a DIFFERENT origin (`NEWS_MEDIA_R2_PUBLIC_BASE_URL`), which means this
 * app was blocking its own images — and a CSP-blocked image is an empty box,
 * not an error, so nothing in the response said so. `og:image` is a meta tag
 * the page never fetches, so link previews kept working and made the pages
 * look correct from the outside. The concrete emitters are
 * `src/modules/_shared/rendering/gallery-block-renderer.ts` (`<img src>` built
 * from a `publicUrl` that `media-object-key.ts` guarantees is an absolute
 * https URL on the media host, or throws) and `src/layouts/PublicThemeLayout.astro`
 * (the theme logo).
 *
 * The origin is NOT re-derived here: it comes from
 * `media_library`'s own `deriveMediaPublicOrigin`, the same function
 * `GET /api/v1/media/public-origin` hands to build clients for exactly this
 * purpose. A second derivation would be the two-copies-of-one-value shape that
 * file was written to prevent, and it would fail the same silent way. That
 * helper also decides what "configured" means (unset, unparseable, or a
 * non-http(s) scheme all report `configured: false`), so a malformed
 * deployment value can never reach the header — a rejected policy would take
 * every other directive down with it.
 *
 * MEDIA UPLOADS — `connect-src`, the THIRD directive missed the same way. The
 * direct-to-R2 flow has the browser `PUT` bytes to a presigned URL on R2's S3
 * API endpoint, and `fetch`/`XHR` to a third-party origin is governed by
 * `connect-src`. With no such directive it fell through to `default-src 'self'`
 * and the browser refused every upload before a byte left the machine — which
 * is why no upload UI existed to be broken (Issue #595).
 *
 * Note the origin is NOT the `img-src` one. Reads come from
 * `NEWS_MEDIA_R2_PUBLIC_BASE_URL` (usually a custom domain); writes go to
 * `https://{accountId}.r2.cloudflarestorage.com`. Reusing the public base here
 * would emit a policy that reads correctly and still blocks every upload.
 *
 * When no public media is configured — the LAN/offline default — the directive
 * is `img-src 'self' data:` and NO third-party origin appears anywhere in the
 * policy. That guarantee is unchanged. `data:` is stated in both cases because
 * a data URI is never covered by a host-source list, and it is the bounded
 * allowance that stops a future inline placeholder from being answered with a
 * wildcard: nothing in this repo emits one today, and the schemes where `data:`
 * is genuinely dangerous (`script-src`, `object-src`, `frame-src`) all stay
 * closed.
 */
import { TURNSTILE_ORIGIN } from "./turnstile";
import { VIDEO_EMBED_ORIGIN } from "./video-embed";
import { THEME_INIT_SCRIPT_HASH } from "./theme-init-script";
import { deriveMediaPublicOrigin } from "../../modules/media-library/domain/media-public-origin";
import { deriveMediaUploadOrigin } from "../../modules/media-library/domain/media-upload-origin";
import { resolveNewsMediaR2Config } from "../../modules/media-library/domain/media-r2-config";

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

/**
 * `img-src` is ALWAYS present, and always names `'self'` and `data:`; the
 * media origin joins them only on a deployment that actually serves public
 * media. Naming the directive unconditionally is what stops the fall-through
 * to `default-src 'self'` that was silently blocking every R2 image (see the
 * module header).
 *
 * The host-wide form (`origin`) is used rather than the path-scoped one
 * (`baseUrl`): `deriveMediaPublicOrigin`'s own header notes that a path prefix
 * is tighter but interacts badly with redirects, and R2 custom domains serve
 * nothing but this bucket anyway.
 */
function imgSrcSources(mediaPublicBaseUrl: string): string {
  const sources = ["'self'", "data:"];
  const media = deriveMediaPublicOrigin(mediaPublicBaseUrl);

  if (media.configured && media.origin !== null) {
    sources.push(media.origin);
  }

  return sources.join(" ");
}

/**
 * `media-src` exists for the same reason `img-src` does, and was missed for the
 * same reason. `gallery-block-renderer.ts` emits `<img>` for an image record and
 * `<video src=…>` for a video one, from the SAME cross-origin R2 URL — but
 * `<video>` is governed by `media-src`, so fixing only `img-src` would have left
 * every gallery video blocked by fall-through while the images beside it loaded.
 *
 * No `data:` here: nothing emits a data-URI video, and unlike `img-src` (where
 * the LAN/offline test pins `data:`) there is no existing contract asking for
 * it. The directive is emitted unconditionally for the same reason as `img-src`
 * — naming it is what stops the fall-through to `default-src 'self'`.
 */
function mediaSrcSources(mediaPublicBaseUrl: string): string {
  const sources = ["'self'"];
  const media = deriveMediaPublicOrigin(mediaPublicBaseUrl);

  if (media.configured && media.origin !== null) {
    sources.push(media.origin);
  }

  return sources.join(" ");
}

/**
 * `connect-src` is the THIRD directive missed the same way `img-src` and
 * `media-src` were, and the one that made a whole feature impossible rather
 * than merely ugly.
 *
 * The direct-to-R2 upload flow (`r2-upload-sop.md` §2) has the browser `PUT`
 * bytes straight to a presigned URL on R2's S3 API endpoint — a THIRD-PARTY
 * origin, and `fetch`/`XHR` to it is governed by `connect-src`. With no such
 * directive it fell through to `default-src 'self'` and the browser refused
 * the request before a byte left the machine, so no upload UI could work at
 * all.
 *
 * The origin is NOT re-derived here: `deriveMediaUploadOrigin` owns it, and it
 * is deliberately a DIFFERENT origin from the `img-src` one — reads come from
 * `NEWS_MEDIA_R2_PUBLIC_BASE_URL` (usually a custom domain), writes go to
 * `https://{accountId}.r2.cloudflarestorage.com`. Using the public base here
 * would emit a policy that looks right and still blocks every upload.
 *
 * Unconditional, like its two siblings — naming the directive is the whole
 * point. On a LAN/offline deployment R2 is off, `configured` is false, and the
 * policy is exactly `connect-src 'self'` with no third-party origin anywhere.
 */
function connectSrcSources(
  uploadAccountId: string,
  uploadEndpointOverride: string
): string {
  const sources = ["'self'"];
  const upload = deriveMediaUploadOrigin(
    uploadAccountId,
    uploadEndpointOverride
  );

  if (upload.configured && upload.origin !== null) {
    sources.push(upload.origin);
  }

  return sources.join(" ");
}

/**
 * The `frame-src` origins, or `null` when nothing needs the directive at all.
 *
 * `null` rather than an empty string on purpose: `frame-src` with no source
 * list is not "no frames", it is a syntax error, and the LAN/offline guarantee
 * is that the directive is ABSENT — which is what the CSP test asserts.
 *
 * Order is fixed (Turnstile, then video) so the policy string is deterministic:
 * a header whose text depends on iteration order makes a cached response and a
 * fresh one differ for no reason, and makes the test that compares them flaky.
 */
function frameSrcSources(
  turnstileEnabled: boolean,
  videoEmbedEnabled: boolean
): string | null {
  const sources: string[] = [];

  if (turnstileEnabled) {
    sources.push(TURNSTILE_ORIGIN);
  }

  if (videoEmbedEnabled) {
    sources.push(VIDEO_EMBED_ORIGIN);
  }

  return sources.length > 0 ? sources.join(" ") : null;
}

function buildContentSecurityPolicy(
  turnstileEnabled: boolean,
  videoEmbedEnabled: boolean,
  mediaPublicBaseUrl: string,
  uploadAccountId: string,
  uploadEndpointOverride: string
): string {
  const directives: string[] = [...BASE_CSP_DIRECTIVES];

  directives.push(`script-src ${scriptSrcSources(turnstileEnabled)}`);
  directives.push(`img-src ${imgSrcSources(mediaPublicBaseUrl)}`);
  directives.push(`media-src ${mediaSrcSources(mediaPublicBaseUrl)}`);
  directives.push(
    `connect-src ${connectSrcSources(uploadAccountId, uploadEndpointOverride)}`
  );

  const frameSrc = frameSrcSources(turnstileEnabled, videoEmbedEnabled);

  if (frameSrc !== null) {
    directives.push(`frame-src ${frameSrc}`);
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
  /**
   * Opens the single `youtube-nocookie.com` origin in `frame-src` (ADR-0110).
   * Defaults to `false` — omit it and the policy is exactly the pre-ADR-0110
   * one, with no `frame-src` at all unless Turnstile is on. Callers pass
   * `isVideoEmbedEnabled()`.
   */
  videoEmbedEnabled?: boolean;
  /**
   * The deployment's public media base URL, whose ORIGIN goes into `img-src`.
   *
   * Unlike `isProduction`/`turnstileEnabled` this defaults to reading the
   * deployment's own `NEWS_MEDIA_R2_PUBLIC_BASE_URL` rather than to the
   * closed value, and deliberately so: it is one deployment-wide constant that
   * is identical at both call sites (`src/middleware.ts`,
   * `src/lib/server/standalone-entry.ts`) and identical for every request, and
   * a default of "unconfigured" would make this directive silently wrong on
   * every deployment that DOES serve media — which is the bug being fixed, not
   * a state worth defaulting to.
   *
   * Pass it explicitly to keep a caller (a test) independent of the ambient
   * environment; `""` is the unconfigured state, not "use the default".
   */
  mediaPublicBaseUrl?: string;
  /**
   * The R2 account id whose S3 API endpoint the browser `PUT`s uploads to,
   * and which therefore goes into `connect-src`.
   *
   * Separate from `mediaPublicBaseUrl` on purpose: reads and writes go to
   * different origins (see `deriveMediaUploadOrigin`). Defaults to the
   * deployment's own `NEWS_MEDIA_R2_ACCOUNT_ID` for the same reason
   * `mediaPublicBaseUrl` defaults — a default of "unconfigured" would make the
   * directive silently wrong on every deployment that accepts uploads.
   *
   * `""` is the unconfigured state, not "use the default".
   */
  mediaUploadAccountId?: string;
  /**
   * Test-only endpoint override, mirroring `media-r2-client.ts`'s own: when a
   * local fake S3 server stands in for R2, the policy has to name IT or the
   * fake is blocked exactly as the real endpoint would be — which would make
   * an upload test pass or fail for a reason unrelated to what it tests.
   */
  mediaUploadEndpoint?: string;
};

export function buildSecurityHeaders(
  options: SecurityHeaderOptions
): Array<[string, string]> {
  const headers: Array<[string, string]> = [
    [
      "Content-Security-Policy",
      buildContentSecurityPolicy(
        options.turnstileEnabled === true,
        options.videoEmbedEnabled === true,
        options.mediaPublicBaseUrl ?? resolveNewsMediaR2Config().publicBaseUrl,
        options.mediaUploadAccountId ?? resolveNewsMediaR2Config().accountId,
        options.mediaUploadEndpoint ?? ""
      )
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
    //   - the JSON API is unreachable cross-origin from a browser with THREE
    //     deliberate exceptions. This bullet used to read "nothing here emits
    //     `Access-Control-Allow-Origin` (verified: zero occurrences in
    //     `src/`)", and Issue #637 ended that: the public visit-ingest beacon
    //     (`api/v1/analytics/collect.ts`) answers a preflight and echoes the
    //     grant, for `Origin`s that are active tenant domains and never for
    //     `*`. ADR-0107 added the other two — `site-search/query` and
    //     `/suggest`, which echo the same kind of grant to the same kind of
    //     origin and take no credentials at all.
    //
    //     The bullet asked its own successor to re-read it when a SECOND
    //     endpoint opted in, so: re-read, and it still holds. CORP governs
    //     `no-cors` subresource embedding, and a CORS-mode `fetch` is not a
    //     `no-cors` request — so `same-origin` removes no capability any
    //     browser client has. The reason is "CORP does not apply to CORS",
    //     which does not get weaker with a fourth endpoint;
    //   - `public/` holds `js/news-share.js`, `css/public-content.css`,
    //     `push-sw.js` and `js/blog-preview-overlay.js` (Issue #592 — the
    //     editor preview's overlay, generated by
    //     `bun run build:preview-overlay`), and `_astro/*` is hashed output —
    //     all of it loaded by
    //     this origin's own pages, and all of it now actually CARRYING these
    //     headers: until Issue #464 those responses bypassed middleware
    //     entirely, so this bullet stated an intent, not a fact. (This list
    //     said "exactly two files" for ten days after `push-sw.js` landed;
    //     ADR-0101 now gates the enumeration in `PUBLIC_ASSET_AUDIENCE` so it
    //     cannot go stale again. A same-origin service worker script is
    //     unaffected by CORP, so the reasoning below survives the correction.);
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
