---
"awcms": minor
---

feat(blog-content): advertisement slots finally appear on the public pages

`selectAndRenderActiveAdsForPlacement` has existed since ADR-0044 §4 with test
callers only — its own docblock says "not wired to any public page route in this
issue ... a later issue's homepage/article template work calls it directly".
This is that issue.

Nine of the twelve slots are now drawn: four on the index, four on an article
(with THIS article as the target, so a scoped placement and every global one for
the same slot both appear), one above each archive, one above search results.
`article_middle` lands between two blocks rather than after the last one,
because a slot named middle that renders at the end is a lie an advertiser paid
for.

**The three that are not drawn are named.** `AD_PLACEMENT_RENDER_SURFACES` maps
every slot to the routes that render it, `/admin/blog-ads` reads the same
constant to mark the three sidebar slots as unrendered here, and a test checks
the map against the real route files in both directions. A slot that is bookable
but unrendered is "declared, validated, never read" — the booking succeeds, the
audit row is written, the invoice goes out, and nothing appears.

**The availability notice (FR-ADS-007) is shown only to a tenant that sells
advertising** — one `EXISTS` decides it. Applied unconditionally it would paint
"ad space available" across four slots of every newsroom in the family,
including the ones that have never sold a banner, which would deface the site to
advertise a service the tenant does not offer. For such a tenant that `EXISTS`
is also the only query this path runs, and every slot renders the empty string,
so the page is byte-identical to what it was before.

Part of #594.
