🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0110-a-video-embed-origin-is-an-operators-decision.id.md)

# ADR-0110 — A video-embed origin is an operator's decision, not a tenant's

- **Status:** Accepted
- **Date:** 2026-08-23
- **Decision maker:** ahliweb
- **Related:** Issue #597 item 8; Issue #639 (the `video_news` block and its renderer); Issue #148 / #186 (the CSP and its one existing opt-in origin); ADR-0025 (deployment profiles)

## Context

`_shared/rendering/video-news-block-renderer.ts` has built a correct, privacy-enhanced `youtube-nocookie.com` iframe since Issue #639: fixed markup, provider and video id validated at write time, no path that can render caller-submitted HTML.

**Every one of those iframes has been blocked by the browser.** This repo's CSP allow-lists no third-party origin, so `frame-src` names only `challenges.cloudflare.com`, and only when Turnstile is on. The renderer's own header states the consequence precisely — _"a silent, safe degradation (no video shown, no console error users would see, no XSS)"_ — and names the fix it was waiting for: _"a future opt-in flag mirroring Turnstile's pattern"_.

What an editor experiences is a blank area where a video should be, with nothing anywhere explaining it. Issue #597 item 8 says this is a CSP decision with security consequences and asks for an ADR, which is right: the constraint the #639 port respected is a guarantee, not an oversight.

## Decision

**`BLOG_VIDEO_EMBED_ENABLED=true` adds exactly one origin — `https://www.youtube-nocookie.com` — to `frame-src`, and nothing else. Unset (the default), the policy is byte-for-byte what it was.**

The pattern is Turnstile's, which is the one existing precedent for admitting a third-party origin, and the two switches are independent: either, both or neither, with `frame-src` listing exactly the origins that are on.

### Not derived from tenant data, and that is the security content of this ADR

The tempting alternative is "allow the origin when a tenant has enabled the `video_news` block". A CSP header is per-RESPONSE and deployment-wide: one tenant enabling video would open the origin for **every** tenant sharing the deployment, and the guarantee `tests/security-headers-csp.test.ts` asserts would become conditional on DATA rather than on an operator's decision.

A guarantee that can be flipped by a row in somebody else's tenant is not a guarantee. So the switch is where the deployment is configured, and it is the operator who decides that this deployment talks to YouTube.

### Not gated on the online security profile

`isTurnstileRequired` is `isFullOnlineSecurityActive(env) && flag`, because Turnstile makes an outbound call to Cloudflare and is meaningless without one. A video embed makes **no server-side call at all** — the reader's browser fetches it — so this is the flag alone. An operator running a LAN deployment who sets it has made exactly the choice the guarantee asks for, and a second gate would only stop them previewing a page in development.

### `frame-src` only; not `script-src`

The embed is an iframe. Turnstile additionally needs `script-src` because its widget loads a script into our page; a video block never does, and widening `script-src` for it would grant the strictly more dangerous capability to buy nothing.

### The origin has one definition

`lib/security/video-embed.ts` exports it, and the RENDERER imports its embed base from there. Two copies of the string is the arrangement where the policy and the markup drift, and the failure mode is an iframe blocked by a policy that claims to permit it.

### What stays closed

`frame-ancestors 'none'` and `X-Frame-Options: DENY` are untouched. Opening `frame-src` says what this page may embed; it says nothing about who may embed this page, and the two are easy to conflate.

## Consequences

- **Positive:** Issue #597 item 8 is closed, and a `video_news` block that an editor places actually plays for a reader on a deployment that asked for it.
- **Positive:** the LAN/offline guarantee is intact and now covers two switches instead of one, with the test asserting that neither leaks the other's origin.
- **Negative / trade-off:** a deployment that turns this on tells YouTube which of its pages a reader opened. `youtube-nocookie.com` limits what is stored before a play, not what is requested — the honest statement is "fewer cookies", not "no third party".
- **Negative / trade-off:** the switch is deployment-wide, so a multi-tenant deployment cannot let one newsroom use video and forbid another. That is the direct cost of not letting tenant data change a security header, and it is the right side to err on.
- **Neutral:** a deployment that leaves it unset keeps today's behaviour exactly, including the blank area. The renderer's comment now says so in the present tense rather than describing a limitation waiting for a fix.

## Alternatives considered

- **Allow-list the origin unconditionally** (what awcms-mini does). Rejected — it breaks the "no third-party origin unless an operator opts in" guarantee for every deployment, including the ones that will never place a video block. This is the option the #639 port already declined, for this reason.
- **Derive it from the tenant's enabled block types.** Rejected — see above. It makes a deployment-wide security header a function of one tenant's data.
- **Close the feature: delete the renderer and the block type.** Rejected. The renderer is correct, the block validates at write time, and a newsroom without video is a real loss; the missing piece was one line of policy, not the feature.
- **A per-tenant CSP.** Not rejected on merit; out of scope. It would mean the response's policy depending on the resolved tenant, which is a change to how every header in this repo is built, for one directive.
