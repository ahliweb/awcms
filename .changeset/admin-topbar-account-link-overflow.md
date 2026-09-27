---
"awcms": patch
---

fix(admin): contain topbar and legal-hold-form overflow on every admin screen (#843)

Two independent horizontal-overflow defects, both pre-existing and unrelated to `.cell-muted`/`.admin-sidebar` (ahliweb/awcms#831/#842):

1. **`.admin-account-link` overflowed the topbar by ~55–66px at exactly 1024px, on every admin screen.** `.admin-user-menu` had `min-width: 0`, which let the outer topbar's flex-shrink algorithm squeeze it far below `.admin-account-link`'s real content width (avatar + truncated name); the link then rendered at its natural size regardless and spilled out of its own shrunken parent. Fixed with `.admin-user-menu { flex: none; }` (it never drops, per ADR-0120's own stated intent) plus widening the `@media (max-width: 1023.98px)` breakpoint that hides `.admin-palette-open`/`.admin-tenant-switch` to `1024px`, so they also step aside at the exact width where the topbar previously ran out of room simultaneously with `.admin-brand-cluster` widening to line up with the sidebar.
2. **`/admin/data-lifecycle` overflowed at 360px** — not from `<th>` content (the `.data-table--stack` responsive pattern already visually hides and correctly self-clips headers below 768px) but from the "Place a legal hold" form's `<select id="hold-descriptor-key">`: its wrapping `<label>` is a nested column-direction flex container with no `min-width` of its own, so it inherited the select's full intrinsic content width as its own automatic minimum instead of respecting the flex layout's available space. Fixed with `.admin-create-form label { min-width: 0; }` — the same class of bug the existing `/admin/seo` select fix (`.admin-create-form select { min-width: 0; max-width: 100%; }`) addressed one level down.

`responsive-360.e2e.ts` now sweeps every static admin screen at 1024px too (previously only 360px), and its doc comments/`APP_BUDGET_BYTES` record the root causes and measurements.
