---
"awcms": patch
---

design(admin): adopt `.admin-timeline`/`.admin-status-pill` on the detail/history admin screens (#863)

Consumes `.admin-timeline` (`src/styles/admin.css`, PR #813) for the first time: approvals'
instance history, business-scope's conflict history, data-lifecycle's legal-hold history and
run history, OMES health's per-server snapshot history (`?serverId=…` mode — the tenant-wide
"latest per server" table stays a `.data-table`, it is one row per server, not a history), and
reporting's projection rebuild history now render as a real `<ol class="admin-timeline">` of
`<li class="admin-timeline-item">`, each with a genuine `<time datetime>` (never colour/position
alone). `admin.css` gains a small `.admin-timeline { list-style: none; margin: 0; padding: 0; }`
reset for the `<ol>` wrapper itself — the existing primitive only styled `-item`/`-label`/`-meta`.

Every status this issue touched on these five screens (task/delegation status, business-scope
assignment/exception status, SoD conflict flag, legal-hold/run status, OMES overall/stale/
check-source status, rebuild status) moves from the legacy `.status-badge` onto
`.admin-status-pill`, keeping each cell's raw-value `data-*` hook. `reporting.astro`'s other
sections (email queue health, projection freshness, scheduled-export runs) are untouched — out
of this issue's file-ownership scope. `approvals.astro` keeps its query-param drill-in for
instance history (`?instance=<id>`) — no `.admin-two-pane` routing change, per the issue's own
decision (`docs/awcms/admin-ui-parity-matrix.md` §6.4/§7 wave 4).

`build:asset-budget:check`'s `APP_BUDGET_BYTES` raised from 248,045 to 248,096 (measured actual
total, ledger comment in `scripts/client-asset-budget.ts`). Real data only — no screen fabricates
a history entry it does not already compute. No API/schema/event change.
