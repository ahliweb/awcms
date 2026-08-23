---
"awcms": patch
---

docs(visitor-analytics): the beacon has a caller now, and it is the third reader-browser path (#597 item 9)

`POST /api/v1/analytics/collect` had its cross-origin path opened in #637/#638
so a statically built site on its own domain could reach it. Nothing called it.
`ahliweb/awcms-astro` now does — its ADR-0044 decided **whether**, and the answer
came with a constraint this repo should know about — so the path joins
`CONSUMER_PATHS` and its shape is frozen with the rest.

### Three reader-browser paths, and they do NOT share one rule

Ten paths are consumed. Seven are called by `astro build` from a machine holding
a read-only credential. Three run in a reader's browser: the two `site-search`
paths and this one. That much was already recorded when search landed.

What is new is that the three disagree, and the disagreement is load-bearing:

- **the search paths must carry NO custom header** — nothing answers a preflight
  for them, deliberately;
- **the beacon MUST carry `content-type: application/json`** — `checkOrigin`
  refuses the alternatives, and the `OPTIONS` handler exists for the preflight
  that follows. `navigator.sendBeacon` is unusable there for the same reason.

Making them consistent, in either direction, kills one of them in a reader's
browser and in no log here.

### The consumer calls it WITHOUT credentials, by decision

Its ADR-0044 chose that deliberately: a cross-origin `fetch` that does not ask
for credentials neither sends nor stores cookies, so the `awcms_visitor_key`
cookie this endpoint sets is **discarded by the browser**. Every page view
arrives as a first visit.

Recorded here because it is an assumption this repo could otherwise make and be
wrong about: for that consumer, page-view counts are real and unique-visitor
counts are not. Nothing on this side should be changed on the premise that a
repeat visitor is recognisable — and the `SameSite=None` work in #637 is not
wasted, it simply serves consumers that make the other choice.
