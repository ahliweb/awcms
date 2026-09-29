---
"awcms": patch
---

design(admin): shared media picker adopts admin-media-grid (#872)

Follow-up to wave 5 of the AWCMS ↔ awcms-one admin UI/UX parity work (epic #858): the shared media picker (`src/lib/ui/media-picker-client.ts`), consumed by `/admin/blog`, `/admin/blog-ads` and `/admin/site-profile`, moves its thumbnail grid from bespoke `.media-picker-panel`/`.media-option` CSS onto the shared `.admin-media-grid`/`.admin-media-grid-tile` primitive — the one real consumer that primitive has, since `/admin/media` itself deliberately does not render thumbnails. `/admin/blog-homepage` was named as a fourth consumer in the issue but has no picker markup to migrate (verified by grep): it references the picker only in a doc comment explaining why its ordered `gallery_block` field does not use it.

The picker's public contract, keyboard operability and accessible names are unchanged. Because the tile's `<img>` now fills it edge-to-edge (the primitive's own contract), the picker's per-thumbnail label moves from a below-image line to a `.media-option-caption` overlay, which doubles as the tile button's accessible name. Each tile's selected state is now exposed to assistive technology via `aria-pressed`/`data-selected` — never by tile colour/outline alone — marking the option matching the field's current value when the panel reopens; this is additive, not a change to any previously existing selection behaviour. `src/styles/admin-screens.css`'s duplicate grid/box CSS the picker used to carry (`display: grid`/`grid-template-columns` on `.media-picker-panel`, the border/background/radius `.media-option` repeated) is removed now that the primitive supplies it, leaving only the panel's own bordered/scrollable chrome and the new caption overlay there.

`APP_BUDGET_BYTES` raised from 250,423 to 250,480 (measured actual total, no added margin — see `scripts/client-asset-budget.ts`'s own ledger comment) since the new caption overlay and selection tracking outweigh the CSS removed.
