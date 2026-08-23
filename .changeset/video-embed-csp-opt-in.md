---
"awcms": minor
---

feat(security,blog-content): a video-embed origin an operator can opt into (ADR-0110, #597 item 8)

`video-news-block-renderer.ts` has built a correct, privacy-enhanced
`youtube-nocookie.com` iframe since Issue #639 — and **every one of those
iframes has been blocked by the browser**, because this repo's CSP allow-lists
no third-party origin. The renderer's own header records the degradation ("no
video shown, no console error users would see, no XSS") and names the fix it
was waiting for: "a future opt-in flag mirroring Turnstile's pattern".

What an editor experienced was a blank area where a video should be, with
nothing anywhere explaining it.

`BLOG_VIDEO_EMBED_ENABLED=true` now adds exactly one origin to `frame-src` and
nothing else. Unset — the default — the policy is byte-for-byte what it was, and
the two opt-in switches are independent: either, both, or neither.

The decision's security content is what it refuses:

- **Not derived from tenant data.** "Allow it when a tenant enables the
  `video_news` block" would make a per-response, deployment-wide header a
  function of one tenant's data — one tenant enabling video would open the
  origin for every tenant sharing the deployment. A guarantee that can be
  flipped by a row in somebody else's tenant is not a guarantee.
- **Not gated on the online security profile** the way Turnstile is: Turnstile
  makes an outbound call to Cloudflare and is meaningless without one, while a
  video embed makes no server-side call at all.
- **`frame-src` only, never `script-src`.** The embed is an iframe; widening the
  strictly more dangerous directive would buy nothing.
- `frame-ancestors 'none'` and `X-Frame-Options: DENY` are untouched — opening
  `frame-src` says what this page may embed, not who may embed this page.

The origin has one definition (`lib/security/video-embed.ts`) which the renderer
imports its embed base from: two copies is how a policy and its markup drift.

Also corrected here: `security-headers.ts`'s CORP bullet said the JSON API has
"ONE deliberate exception" to being unreachable cross-origin and asked its
successor to re-read it when a second appeared. ADR-0107 added two. Re-read, and
it still holds — CORP does not apply to CORS — now with the count right.
