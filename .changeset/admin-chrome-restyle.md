---
"awcms": minor
---

design(cms): admin chrome restyle — dark sidebar rail, topbar polish, shared primitives (awcms-one#170)

Extends the ADR-0120 admin redesign with a dedicated, always-dark sidebar surface (`--color-sidebar-*` tokens in `tokens.css`, independent of `data-theme`) carrying a compact brand + tenant header, a `.admin-sidebar-count` badge slot (fed by a new optional `ModuleNavigationEntry.badgeCount`, populated by nothing yet), and a `.admin-sidebar-status` card fed by the same `syncActive` boolean the topbar's `SyncIndicator` already reads — no new data source. Adds eight shared CSS primitives to `admin.css` for future screens to build on: `.admin-stat-card`, `.admin-status-pill[data-tone]`, `.admin-segmented`, `.admin-bulk-bar`, `.admin-two-pane`, `.admin-toggle` (a real `<input type="checkbox">` switch), `.admin-timeline`, and `.admin-media-grid`. `design:token-contrast:check`'s `PAIRS` registry gains the new sidebar foreground/background pairs; no existing admin screen changes.
