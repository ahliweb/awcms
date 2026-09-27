---
"awcms": minor
---

feat(control-center): OMES Control Panel design system for /admin/omes (ahliweb/omes#246, part 1/3)

Applies the OMES Control Panel redesign's visual language to the 9 existing `/admin/omes/*` screens (Overview, Servers, Deployments, Operations, Jobs, Health, Backups, Audit, Enrollments): the dark palette, KPI tiles with monospace numbers and status dots, and the Bootstrap → Check → Diff → Apply → Verify → Rollback lifecycle strip on the Overview screen.

Purely presentational and scoped to these 9 screens via a `.omes-cc` wrapper class — no behavioural change, no new endpoint, no schema/contract change, and the rest of the AWCMS admin is untouched. Reuses existing admin components (`.stat-card`, `.status-badge`, `.data-table`, `.admin-panel`, `.quick-link`) by overriding the same design tokens they already consume; no new CSS/JS framework. Public Sans and JetBrains Mono are already self-hosted admin-wide (ADR-0120) — this ships no new font.

`APP_BUDGET_BYTES` in `scripts/client-asset-budget.ts` rises 226,000 → 229,500 B (measured +3,171 B for the one new stylesheet). Every text/background and accent/background pair introduced is measured against WCAG 2.1 AA; the table is in `src/modules/omes-control/README.md`/`.id.md`.

The 4 missing views (Hermes, Orkestrasi langsung, Arsitektur, Progres Hermes) are later PRs (part 2/3 and 3/3 of ahliweb/omes#246).
