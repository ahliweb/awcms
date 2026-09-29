---
"awcms": patch
---

design(admin): retire the legacy .stat-card/.status-badge classes (#866)

Final wave (7) of the AWCMS ↔ awcms-one admin UI/UX parity work (epic #858): migrates the last consumers of the legacy `.stat-card`/`.stat-grid`/`.stat-label`/`.stat-value`/`.stat-hint`/`.stat-head`/`.stat-delta` family and the legacy `.status-badge`/`.status-dot` pair — `data-lifecycle.astro`, `site-search.astro`, `idn-regions.astro`, `tenants.astro`, `sync.astro`, `push-notifications.astro`, `domain-events.astro`, `omes/health.astro` (all onto `.admin-stat-card`), and the four remaining sections of `reporting.astro` (onto `.admin-status-pill`) — onto the shared `admin.css` primitives every other admin screen already uses.

With zero consumers left, the legacy rule blocks are deleted from `src/styles/admin.css` and `src/styles/admin-screens.css`, and the `.stat-card` half of the dual selector lists in `src/styles/omes-control-center.css` (kept there since wave 2 to serve both class families at once) is dropped. A new repo-wide regression test, `tests/admin-legacy-classes-retired.test.ts`, walks every `.astro`/`.ts`/`.tsx`/`.css` file under `src/` and fails the build if any of the nine retired class tokens reappears as a real consumer (comments are stripped first, so historical/provenance prose is never mistaken for one).

This is the first wave of the epic to shrink the client asset budget rather than grow it: `APP_BUDGET_BYTES` (`scripts/client-asset-budget.ts`) is lowered from 250,566 to 248,033 and `PER_FILE_CSS_BUDGET_BYTES` from 57,300 to 56,800 (both measured actual values, no added margin).

`docs/awcms/admin-ui-parity-matrix.md` (+ `.id.md`) now describes every wave (2–7) as DONE and reclassifies `media.astro` as partially-adopt with a pointer to the shared media picker's own adoption (#872). `docs/awcms/14_ui_ux_design_system.md` (+ `.id.md`) and the `awcms-ui-screen` skill (+ `.id`) state `.admin-status-pill`/`.admin-stat-card` as the only classes for these two shapes, rather than describing the legacy pair as still defined.
