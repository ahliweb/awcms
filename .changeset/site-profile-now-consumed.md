---
"awcms": patch
---

chore(api): the site-identity endpoint is now CONSUMED, not merely promised (#596)

`ahliweb/awcms-astro#61` landed, so `GET /api/v1/site-profile/composed` is no
longer a shape this repo promised to keep for a caller that did not exist — it
is the shape a live build renders its masthead, favicon, footer, contact block,
social links and `Organization` node from.

The entry moves from `COMMITTED_PATHS` to `CONSUMED_PATHS` and the pinned count
goes to four, matching the literal the neighbour's own gate asserts against its
source. The frozen fixture does not change, because it freezes the union.

That the move happens at all is the point. `api-consumer-contract.ts` keeps the
two lists apart because a promise and a dependency deserve the same stability
and fail differently — breaking a consumed path breaks a build that exists
today. A distinction nothing ever acts on decays into a label, which is how
three non-calls once sat in `CONSUMED_PATHS` describing calls that never
happened.
