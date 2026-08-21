---
"awcms": minor
---

feat(visitor-analytics): a static build on its own domain can finally reach the beacon (#637)

`POST /api/v1/analytics/collect` is anonymous, rate-limited and always answers
`202`. It was built to be called from a public page. When that public page is a
static `awcms-astro` build on a **different** origin — the PRD §27.1 scenario —
all three ways of calling it were blocked, and not one of the failures appeared
in this repo's logs. The dashboards were right; nothing ever arrived.

### The three paths, and what blocked each

Astro's `security.checkOrigin` defaults to `true` and `astro.config.mjs` does
not turn it off:

1. `navigator.sendBeacon(url, blob)` sends `text/plain`, which IS in Astro's
   `FORM_CONTENT_TYPES` — cross-origin, that is `403 Cross-site POST form
   submissions are forbidden`.
2. `fetch` with no `content-type` falls into the final `return !isSameOrigin`.
   Also 403.
3. `fetch` with `application/json` passes `checkOrigin` — and then the browser
   sends a preflight `OPTIONS` that nothing answered.

This opens **path 3 only**. Paths 1 and 2 stay closed on purpose:
`checkOrigin` protects every other write in the repo, Astro installs it ahead of
`src/middleware.ts` so it cannot be exempted per-route from inside the app, and
disabling it globally would trade a repo-wide guarantee for one endpoint's
convenience. The cost is a real constraint on the caller, written into the
endpoint's docblock: the beacon must be sent as JSON, which means `fetch`, not
`sendBeacon`.

### CORS is not authorization

A preflight carries **no body**, so the `OPTIONS` handler cannot know which
`tenantCode` the POST will name. It answers the narrower question it can — is
this `Origin` an active domain in `awcms_tenant_domains` — and the POST goes on
validating `tenantCode` exactly as before. Neither replaces the other: one
decides whether a browser may read our answer, the other decides whose analytics
a row belongs to. An integration test pins them apart by posting tenant B's code
from tenant A's domain and asserting the row lands under B.

The allowed origin is always echoed verbatim from a value that resolved against
the verified set. Never `*` — which would let any page on the internet write
with a public tenant code, and is not even legal alongside the
`Access-Control-Allow-Credentials` this endpoint needs. A domain that is merely
`pending_verification` is refused: the allow-list is the proven set, not the
claimed one.

`Vary: Origin` goes out on **every** response, including refusals. A cached
denial served to an allowed origin is the same defect as the reverse.

### Two things that are easy to assume and are not true

The anonymous visitor-key cookie is `SameSite=Lax`, and a Lax cookie is neither
sent nor stored cross-site — so without a change every cross-origin page view
would have looked like a first-ever visitor. It is now `SameSite=None` when the
request is cross-origin **and** the cookie is `Secure`, falling back to `Lax`
otherwise rather than emitting a cookie the browser will drop. A browser that
blocks third-party cookies drops it regardless: cross-origin visitor keys are
best-effort, page-view counts are not. Letting the client send its own
identifier in the body would fix it and is refused — every identifier this
endpoint stores is derived server-side.

And CORS is enforced by the **browser, on the response**. A caller that is not a
browser was never blocked by any of this and still is not; what bounds it is the
per-IP rate limit, which now also fronts the new allow-list lookup — same key, so
a preflight and the POST it precedes share one budget instead of doubling it.

`security-headers.ts` rested its `Cross-Origin-Resource-Policy: same-origin` on
the claim that `src/` contains **zero** occurrences of
`Access-Control-Allow-Origin`. That claim stops being true with this change, so
the comment is corrected in the same commit: CORP is unaffected either way,
because it governs `no-cors` subresource embedding and a CORS-mode `fetch` is
not one — but the reason is now "CORP does not apply to CORS" rather than "there
is no CORS here".
