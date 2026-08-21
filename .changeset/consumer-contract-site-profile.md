---
"awcms": patch
---

chore(api): the site-identity endpoint joins the frozen consumer contract (#596)

`GET /api/v1/site-profile/composed` shipped in #616 so a build client could ask
who a site is without editing frontend source. Nothing froze its shape, so a
field renamed here would have been green in this repo's CI and broken
`ahliweb/awcms-astro`'s build — a failure surfacing where the person who caused
it is not looking, which is the whole reason
`tests/fixtures/awcms-astro-consumer-contract.openapi.yaml` exists.

**The order is the point.** That repo's Definition of Done says a new call
"reddens [its contract gate] until `awcms` freezes its response shape", so the
entry lands here **first** and the neighbour starts calling it second. Reversing
the two would put a live build on a shape this repo has not agreed to keep.

Which is why it enters as `COMMITTED_PATHS`, not `CONSUMED_PATHS`. Today nothing
calls it, and that file is explicit that blurring the two is what once let three
non-calls sit in this list labelled as calls. It moves to CONSUMED — with the
count in `tests/api-consumer-contract.test.ts` going to four, matching the
literal the neighbour's own gate pins — in the change that makes the call real.
The frozen fixture is identical either way, because it freezes the union.

The freeze walks the transitive `$ref` closure, so `SiteProfile` and
`ComposedSiteIdentity` are frozen with the path — which is where the interesting
breakages live (a field renamed, a nullable dropped), not in the four-line path
object.

Regenerating also folded in `institutionIds` on `BlogPost`/`BlogPostSummary`.
That field landed in #595 and the fixture predates it; the check is
additive-superset, so a stale fixture stayed green while silently protecting
less than it appeared to. It is now frozen too, which is the correct state and
not a second change — the fixture is the shape at its last deliberate
regeneration, and this is one.
