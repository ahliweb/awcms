---
"awcms": minor
---

Add the `/admin/reporting` console and put `reporting` in the admin sidebar.

`reporting` had seven permissions and, between them, one page: `/admin` renders four of its five dashboard views. Everything Issue #753 built — the projection registry, live freshness, rebuild, reconciliation, scheduled exports and artifact download — had no screen at all, and neither did `email-health`, the fifth dashboard view. All of it was reachable only by `curl`. Under ADR-0051 the screen belongs here.

The console renders each registered projection with its live freshness status, metric values and most recent reconciliation, plus rebuild history, scheduled-export management, on-demand export, and the export-run history with checksum-verified download links. It deliberately does not repeat the four aggregations `/admin` already shows; a projection links to its own `drillDownPath` instead.

Reads reuse this module's own application functions inside one `withTenantOrThrow` transaction, awaited sequentially. `listProjectionSummariesForTenant` is handed the caller's real granted-permission set, so the per-descriptor `requiredPermission` filter stays honest on this path too. Writes go to the guarded `/api/v1/reports/*` endpoints — five with a fresh `Idempotency-Key` per click, `reconcile` with none, because that endpoint mutates no business state and requires none.

`tests/admin-reporting-page-contract.test.ts` pins all seven permission keys against what the routes enforce and the descriptor declares. Three plausible-but-wrong guesses would each have rendered a control that denies every caller including the owner: `projections.cancel` for cancelling a rebuild (it is `projections.rebuild`), `projections.read` for reconciling (it is `projections.analyze`), and `exports.configure` for triggering an export (it is `exports.export`).

`MIN_EXPORT_INTERVAL_MINUTES` / `MAX_EXPORT_INTERVAL_MINUTES` / `MIN_REASON_LENGTH` / `MAX_REASON_LENGTH` move to `reporting/domain/operator-input-bounds.ts` and are now imported by both the three routes that validate them and the form that renders them as `min` / `max` / `maxlength`, so the browser cannot accept what the server rejects.

Also corrects `reporting/README.md`, which described an `/admin/reporting/projections` page and a `submitJson` helper that never existed in this repo.
