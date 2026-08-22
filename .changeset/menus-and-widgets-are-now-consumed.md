---
"awcms": patch
---

chore(api): the menu and widget endpoints are now CONSUMED, not merely promised (#597)

`ahliweb/awcms-astro#67` renders the tenant's navigation menu and its widgets, so
`/api/v1/blog/menus` and `/api/v1/blog/widgets` move from `COMMITTED_PATHS` to
`CONSUMED_PATHS` and the pinned count goes five to seven — the same number that
repo's own gate asserts.

Their sequence had one step the others did not. `/api/v1/blog/terms` could be
frozen the moment it was decided; these two could not be frozen **at all** until
Issue #652 gave their responses an actual schema. Freezing an array of bare
`object` would have added two paths to this list that no change could ever
break — a contract entry with no contract in it, which is a more expensive kind
of nothing than an empty list, because it reads as coverage.

This closes Issue #597 item 6, and with it the last item on that issue that was
not waiting on a written decision.
