---
"awcms": patch
---

fix(admin): contain long unbreakable text in the main column instead of letting it widen the page (#831)

`.cell-muted` (admin.css) is now a bare, universal `overflow-wrap: anywhere` rule, mirroring the `word-break: break-all` its sibling `.cell-code` already had — previously `.cell-muted`'s only wrap protection was scoped to `.data-table td`, which does nothing for a screen that uses it outside a table. The Hermes orchestration tree/activity list (`/admin/omes/orkestrasi-langsung`, ahliweb/omes#246 part 2) renders Hermes-supplied free text (`goal`/`summary`) in `.cell-muted` spans inside a `display: flex; flex-wrap: wrap` list, not a table, so a long, space-free value had nothing stopping it from overflowing `.admin-main` and widening the whole document past the viewport. `/admin/omes/hermes`'s task summary had the identical defect through a different markup path (a plain `<dd>` with no `.cell-muted` class inside a `display: grid` row) and gets the same `overflow-wrap: anywhere` fix directly.

`.admin-sidebar` (`flex-shrink: 0`) and `.admin-main` (`min-width: 0`) already kept their own flex-track widths fixed while this happened, but the resulting page-wide horizontal overflow is what produced the "sidebar rendered ~143px wide, labels clipped" appearance reported on ahliweb/awcms#831 — a full-page screenshot captures the actual (wider-than-viewport) scrollable canvas, so the fixed-width sidebar occupies a shrunken sliver of the image even though its own box never moved.
