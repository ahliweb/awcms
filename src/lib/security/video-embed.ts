/**
 * The one third-party origin a `video_news` block's iframe loads from, and the
 * operator switch that admits it into the CSP — ADR-0110.
 *
 * ## What was broken, and for how long
 *
 * `_shared/rendering/video-news-block-renderer.ts` has built a correct,
 * privacy-enhanced `youtube-nocookie.com` embed since Issue #639. Its own header
 * records the consequence in full: this repo's CSP never allow-lists a
 * third-party origin, so **the iframe it emits has always been blocked by the
 * browser** — "a silent, safe degradation (no video shown, no console error
 * users would see, no XSS)". An editor placing a video block got a blank area
 * and no explanation, on every deployment, since the feature shipped.
 *
 * That comment also names the fix it was waiting for: "a future opt-in flag
 * mirroring Turnstile's pattern". This is that flag.
 *
 * ## Why a flag and not just allow-listing it
 *
 * `security-headers.ts` guarantees that NO third-party origin appears in the
 * policy on a LAN or offline deployment unless an operator opts in, and
 * `tests/security-headers-csp.test.ts` asserts it directly. Allow-listing
 * YouTube unconditionally would break that guarantee for every deployment,
 * including the ones that will never place a video block — which is precisely
 * why the #639 port declined to do it.
 *
 * ## Why the flag is not derived from tenant data
 *
 * The tempting alternative is "allow it when a tenant has enabled the
 * `video_news` block". A CSP header is per-RESPONSE and deployment-wide: one
 * tenant enabling video would open the origin for every tenant sharing the
 * deployment, and the security test's guarantee would become conditional on
 * DATA rather than on an operator's decision. A guarantee that can be flipped
 * by a row in someone else's tenant is not a guarantee.
 *
 * ## Difference from Turnstile's gate, stated rather than inferred
 *
 * `isTurnstileRequired` is `isFullOnlineSecurityActive(env) && flag`, because
 * Turnstile makes an outbound call to Cloudflare and is meaningless without
 * one. A video embed makes no server-side call at all — the browser fetches
 * it — so this is the flag alone. An operator running a LAN deployment who sets
 * it has made exactly the choice the guarantee asks for, and a second gate
 * would only stop them previewing a page in development.
 */

/**
 * The privacy-enhanced YouTube embed origin. The RENDERER imports its embed URL
 * base from here rather than the other way round, so the origin in the policy
 * and the origin in the markup cannot drift — the failure mode being an iframe
 * that is blocked while the policy claims to permit it.
 */
export const VIDEO_EMBED_ORIGIN = "https://www.youtube-nocookie.com";

/**
 * `BLOG_VIDEO_EMBED_ENABLED` — default OFF, and off means the policy is exactly
 * the pre-ADR-0110 one.
 *
 * Compared against the literal `"true"`, the same way every other boolean
 * switch in this repo is: `Boolean(env.X)` would make the string `"false"`
 * enable it, and this one decides whether a third-party origin enters the
 * Content-Security-Policy.
 */
export function isVideoEmbedEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.BLOG_VIDEO_EMBED_ENABLED === "true";
}
