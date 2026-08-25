---
"awcms": patch
---

perf(blog): listing menus cost one query per menu, the item batch had no count bound at all, and the sweep that should have caught the first was looking for backticks

Three findings on the same pair of endpoints, and they compound: the write had
no cap, and the read that embedded what the write stored had neither a batch nor
a bound.

## The batch was the only uncapped one in the API

`validateMenuItemsInput` never checked `items.length`. Every other batch surface
in this repo declares a count bound — `MAX_IMPORT_ITEMS = 200` on the redirect
import, `MAX_IDS` on bulk comment moderation, `MAX_NODE_ACTIVATIONS = 128` on
sync activation, and `/sync/push` gained one last round — so this was checked
against all 18 routes that accept a body array, and it is the only one without.

The only limit was the 128 KB `default` body tier. A minimal item
(`{"id":…uuid…,"label":"a","linkType":"url","url":"http://a.co","sortOrder":0}`)
is about 105 bytes, so one request could carry roughly **1,250 items**.

`MAX_MENU_ITEMS = 200` now lives in `domain/menu-policy.ts`, enforced in the one
validator both `POST /api/v1/blog/menus` and `PATCH /api/v1/blog/menus/{id}`
already reach the database through — not in the two routes, which would be two
places to drift apart.

It is counted **before** the per-item pass. After it, an oversized array of
invalid entries would still be walked in full and could emit several field
errors per entry, so a request about to be refused would still choose how much
work the server does and how large the refusal is. Asserting the error *count*,
not just `valid: false`, is what separates the two orderings in the test.

## The list endpoint was an N+1, and it is up to 100 SERIAL round trips

`GET /api/v1/blog/menus` called `fetchMenuItems` once per menu, inside the
request transaction, for up to the 100 menus `listMenus` returns. The loop was
deliberately sequential — one Postgres connection serves one query at a time, so
`Promise.all` over a shared `tx` hangs rather than parallelises — which made the
cost 100 serial round trips holding the pooled connection and its work-class
slot for the whole duration. Concurrency was never the fix; asking once is.

`fetchMenuItemsForMenus` reads every menu's items in one `menu_id = ANY(…)` and
groups them in memory. Two queries for the page, whatever the menu count.

**Why the last N+1 sweep did not find it.** That sweep scanned for a tagged
template `await` inside a loop body. This call site is
`await fetchMenuItems(tx, …)` — a plain function call. Matching the SQL *syntax*
rather than the query made every N+1 routed through a helper invisible to it;
re-run against the helper set instead, the same 34-loop scan surfaces 45 sites.
Nothing about this loop was subtle. The scanner was looking for backticks.

## A bare `LIMIT` here would have been silent data loss

`syncMenuItems` has full-replace semantics. A client that reads a menu, edits it
and saves it back sends exactly what it was shown — so a read that quietly
stopped at the cap would make that round trip **delete** every item past it.

So the read returns `{ items, truncated }` and both endpoints surface
`itemsTruncated`. It reads `MAX_MENU_ITEMS + 1` rows and keeps 200: with exactly
the cap there is no way to tell "full" from "overflowing". Only a menu stored
before the cap existed can report `true`; a write response is always `false`,
because the request that produced it was itself capped.

The bound is applied with `row_number() OVER (PARTITION BY menu_id …)` rather
than a `LIMIT`, because a single `LIMIT` across the batch would spend the whole
allowance on whichever menu sorted first and return nothing for the rest, with
the truncation attributable to no menu in particular.

## `sort_order` is not unique, so the old order was not defined

Nothing stops two siblings sharing a `sort_order`, and the read ordered by it
alone — leaving equal-ordered items in whatever order the scan produced. That
was survivable while the read was unbounded and is not once a bound can cut the
list, because an arbitrary order makes an arbitrary 200 of 250. Ties now break
on `id`.

## Contract

`itemsTruncated` is added to `BlogMenu` (required) and `maxItems: 200` to the
item arrays. `GET /api/v1/blog/menus` is consumed by `ahliweb/awcms-astro`, and
the frozen consumer contract still passes **without regeneration** — the change
is additive for a reader, and that repo reads menus at build time and never
writes them. Its `Menu` type does not carry `itemsTruncated`, so a tenant whose
menu exceeds 200 items would render 200 there without a warning; that is a
cross-repo question, not a regression introduced here.

Mutation-proven, each against the assertion that claims it: an unpartitioned
window, a bare `LIMIT` at the cap, a dropped `id` tiebreaker, the per-menu loop
restored, and the count check moved after the per-item pass each redden the
corresponding case and only it.
