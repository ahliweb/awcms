---
"awcms": patch
---

chore(api): the three newsletter paths are CONSUMED now, not merely promised

`/api/v1/newsletter/subscribe`, `/confirm` and `/unsubscribe` were frozen as
COMMITTED on 27 August in the change that made them reachable at all (ADR-0118)
— a shape this repo agreed to keep for a consumer that could not yet call it.
`ahliweb/awcms-astro`#90 shipped the form on 28 August and released it as its
v0.4.0, so all three move to `CONSUMED_PATHS`.

That is the direction the cross-repo Definition of Done requires — freeze here
first, call there second — and the split is only worth having if entries
actually move. A promise and a dependency both deserve stability and fail
differently: breaking a committed path breaks a design that has been agreed,
breaking a consumed one breaks something that exists.

The neighbour is the authority and already answered. Its
`tests/kontrak-awcms.test.mjs` asserts an exact set of **thirteen** called
surfaces with the three newsletter paths among them, and its failure message
says so out loud: tell `awcms`, because that repo composes its consumer contract
from this list. This repo still said ten.

## What is recorded, beyond the move

**One of these WRITES, and none of the ten before it did.** Every reader-browser
path so far was a read, or a beacon whose entire answer is `202`. A subscription
makes this deployment send mail to an address a stranger typed, so a wrong shape
does not blank a page — it sends something, or silently stops sending it, to the
person who asked. That is the one breakage on this list a reader would report as
a fault of the newsroom rather than of the site, and it is written into the
docblock and the gate's own comment rather than left to be inferred from three
paths that look like every other `POST`.

**The neutral 200 is part of the frozen shape, not a courtesy.** The endpoint
answers identically for a new address, an already-active one, a suppressed one
and a host resolving to no tenant. A consumer that distinguishes them rebuilds
the subscriber oracle the endpoint refuses to be — from the one place nobody
would think to look for it.

**The reader-browser class now splits six ways on header rules, not three.** The
two search paths must carry NO custom header, because nothing answers a
preflight for them; the beacon and these three MUST send
`content-type: application/json`, because `checkOrigin` refuses the
alternatives. Making them consistent in either direction kills one of them in a
reader's browser.

No behaviour changes: `CONSUMER_PATHS` is the union of both lists, so the frozen
fixture is byte-identical and the same fifteen paths stay guarded.
