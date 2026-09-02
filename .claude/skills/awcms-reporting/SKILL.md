---
name: awcms-reporting
description: Manage the AWCMS reporting module — five live management reporting views (tenant activity, access/audit, sync health, module usage, email health) plus the read-model projection mechanism (rebuild/reconcile/scheduled export). Use when adding/changing `/api/v1/reports/*` endpoints, adding a projection descriptor in another module, or touching rebuild/export scheduling.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — Reporting (live views + projections)

Read `src/modules/reporting/README.md` for the full detail of every view and
endpoint — this skill summarises the decisions already made so they do not have
to be re-derived. The schema in this repo: `sql/015_awcms_reporting_projections_schema.sql`
(the projection/rebuild-run/scheduled-export tables) and
`sql/016_awcms_reporting_permissions.sql` (**all seven** `reporting.*`
permissions in one file — `dashboard.read` for the five live views PLUS
the six projection/export permissions; its own comments call
this a merged port of two separate awcms-mini migrations, but in this
repo the two are ALREADY merged into the single file `sql/016` — do not quote the old
awcms-mini migration numbers as file names in this repo, always verify
with `ls sql/ | grep report` first).

## When to use this skill vs the generic skills

It complements (does not replace) `awcms-new-endpoint`, `awcms-new-migration`,
`awcms-abac-guard`, `awcms-idempotency` — those are still used for how to
build an endpoint/migration/guard/idempotency. This skill supplies the
`reporting`-specific domain context: when a metric may become a
projection, the rebuild-lock invariant, and the projection/export permission catalog.

## Five live views (never cached/materialized views)

`GET /api/v1/reports/{tenant-activity,access-audit,sync-health,module-usage,
email-health}` — a live read-aggregation on every request over the EXISTING
`tenant_admin`/`identity_access`/`sync_storage`/`email` tables, **no
new tables** for any of the five. The guard is identical for all: bearer session +
`X-AWCMS-Tenant-ID`, `{ moduleKey: "reporting", activityCode: "dashboard",
action: "read" }` — **one** permission `reporting.dashboard.read` gates
all five views (deliberately not split per view). Access denied → `403
ACCESS_DENIED`, never silently empty data. The `access-audit` 30-day window is
**hardcoded** (`ACCESS_AUDIT_DECISION_WINDOW_DAYS`) — there is no
custom date pagination/filter today. The SSR dashboard (`/admin`) calls the
`application/*-report.ts` functions DIRECTLY through `withTenant` (not an HTTP
round-trip to its own endpoint) — the same pattern as `admin/settings.astro`; the page
renders an "Access denied" panel (not an empty card/500) when
`reporting.dashboard.read` is not held. `email-health` has **not** yet been
added to the SSR dashboard (only via the API endpoint) — do not assume the
5th card already exists on `/admin`.

**There is deliberately no worker/materialized view/cache** for these five views —
latency follows the cost of the direct query for high-volume tenants; that optimisation
is out of scope. §Projections below is a NEW AND SEPARATE path that
wraps SOME of these metrics (access-audit, module-usage) without replacing
their live endpoints — both continue to exist side by side.

## Projections (Issue #753) — when a metric MAY become a projection

A module registers a projection through the `reportingProjections` array in
its own `module.ts` (`ProjectionDescriptor`,
`src/modules/_shared/module-contract.ts`) — the same "the module declares its own
array, one central aggregator reads `listModules()`" pattern as
`dataLifecycle`/`sodRules`. Two update strategies:

- **`cursor_table`** — a bounded cursor-ordered poll over one or more source
  tables. **Only correct for sources that are genuinely append-only** (no
  hard delete, no soft-delete-then-restore) — the engine can only
  ADD, so a source row that later disappears/is restored will silently
  desync the counts. That is why `access_audit_summary` (the ABAC decision
  log, genuinely append-only) and `module_activity_summary`
  (identity/sync-node, no delete mechanism in this base) were chosen
  to be wrapped — **NOT** `sync-health`/`email-health`/the office count from
  `module-usage`, which are mutable-state or soft-delete-with-restore and
  need row-level CDC/delta tracking to be projected safely (a larger
  follow-up, not done yet). **Do not add a `cursor_table` projection
  on top of a source that can be restored/hard-deleted without equivalent
  CDC/delta tracking.**
- **`domain_event`** — steady-state updates are PUSHED by a registered
  `domain_event_runtime` consumer (Issue #742), reusing the existing job/lock/batching/
  idempotency/retry/pause-resume rather than building a second
  mechanism.

Every projection — whatever its steady-state strategy — is REBUILT through the
SAME bounded `cursor_table` re-scan mechanism (`rebuildSource`, always
present), reading the authoritative source tables directly.

## The rebuild-lock TOCTOU (Issue #151) — the invariant easiest to regress

The race between the incremental steady-state worker and a rebuild trigger: moving
`findRunningRebuild` inside the `runCursorStreamPass` transaction is NECESSARY but
**NOT SUFFICIENT** — every transaction runs at READ COMMITTED (`withTenant` never
changes the isolation level), each statement within ONE transaction
takes a fresh snapshot, so a `triggerOrResumeRebuild` that commits between the
`findRunningRebuild` and `getStreamCursor` statements of the same pass is still
invisible to the first statement and visible to the second — the same
check-then-act gap, merely narrowed from "between two transactions" to "between two
statements". Moving the check alone also does not close the other half of this hazard:
two pass transactions (one incremental, one rebuild) that both read
the freshly reset `cursor_value = NULL` will BOTH re-scan the source table
from the start and BOTH `applyMetricDeltas` — serialised on the metric row lock
so they ADD UP rather than collide — a silent double-count.

**Fix**: `pg_advisory_xact_lock` per (tenant, projection)
(`application/projection-lock.ts`) — held by the DATABASE for the whole
transaction, released automatically on COMMIT/ROLLBACK, and effective ACROSS PROCESSES
(the rebuild trigger runs in a web request, `app`/`interactive`; the incremental worker
runs in a separate `bun run reporting:projections:refresh` `worker`/
`maintenance` process — there is no in-process gate that could serialise
the two). **Every** writer of a projection cursor/metric row takes this lock
as the FIRST statement of its transaction, before reading anything it then
acts upon: `projection-incremental-worker.ts`'s `runCursorStreamPass`,
`projection-rebuild.ts`'s `triggerOrResumeRebuild` (the ONLY one that
resets) + `runRebuildStreamPass`, `event-activity-projection.ts`'s
`applyEventActivityProjectionIncrement`. Lock ordering: this lock is ALWAYS
taken FIRST, before any row lock on the cursor/metric/rebuild-run tables
— do not invert this order in new code (deadlock). It is blocking
(`pg_advisory_xact_lock`), not try-and-skip — all contending parts
are short, bounded transactions (one `batchLimit` page, or one
reset). Test: `tests/reporting-projection-rebuild-lock.test.ts` (a real
Postgres, cleanly skipped when `REPORTING_TEST_DATABASE_URL` is not set).

`triggerOrResumeRebuild` is the only place a cursor/metric is reset to zero —
inside the CALLER's transaction (the API route), atomic with the new run row, the audit
log, and the idempotency record. The partial unique index in `sql/015`
(`awcms_reporting_rebuild_runs_running_unique ... WHERE status = 'running'`)
makes a concurrent double-reset impossible at the database level; `createRebuildRun`
uses `INSERT ... ON CONFLICT DO NOTHING` (not a raw unique-violation
exception). `continueRebuildPasses` NEVER
resets anything — it only advances the cursor of a run that is already `'running'`,
one bounded pass = one transaction (select batch → apply delta → advance
cursor → bump `rows_processed`), the same crash-safe pattern as `data_lifecycle`'s
archive/purge engine.

## Freshness — computed live, never cached

`domain/freshness.ts`'s `computeProjectionFreshness` is a pure function of the
persisted facts (`last_success_at`, `consecutive_failures`) vs `now` — not a stored
status enum. Five states: `current`/`delayed`/`stale`/`rebuilding`
(always wins)/`failed` (the consecutive-failure threshold, checked after
`rebuilding`). If the worker stops entirely there are no more writes, but the read
path still correctly ages the status purely from elapsed time.

## Reconciliation & scheduled exports

`POST /api/v1/reports/projections/{key}/reconcile` — RECOMPUTES the full control
total directly from `rebuildSource` and compares it to the live projection metric;
on-demand only, does NOT require `Idempotency-Key` (zero business state mutation,
it only appends one history row). A mismatch while the projection is merely `delayed`
is NORMAL, not a bug — read freshness alongside reconcile, do not
substitute one for the other. Scheduled export (`application/export-generation.ts`)
writes a CSV/JSON snapshot to `REPORTING_EXPORT_ROOT_PATH` (SHA-256 checksum,
CSV formula injection neutralised) OUTSIDE the DB transaction, then records one
`awcms_reporting_export_runs` manifest row. `bun run
reporting:exports:dispatch` reuses the same generation function for each
enabled+due `awcms_reporting_scheduled_exports`. Download
(`GET .../exports/runs/{id}/download`) re-checks RBAC/ABAC+tenant scope at
download time and rejects an expired artifact with `410 Gone`. **`filter` is accepted/
stored but NOT YET applied** — `POST /api/v1/reports/exports`'s `filter`
field is stored and always returned, but generation never consults it; the create
endpoint REJECTS a non-empty `filter` with `400
NOT_IMPLEMENTED` until the schema and its wiring are built — do not
assume filtering works just because the field is "accepted".

## Permission catalog

`reporting.dashboard.read` (`sql/016`) — the only one for the five live
views, unchanged. Six projection/export permissions **in the same `sql/016`
file** (`domain/projection-permissions.ts`'s
`REPORTING_PROJECTION_PERMISSIONS`, the single source of truth — reuse this
constant, do not re-type the string literals):
`reporting.projections.read`, `reporting.projections.rebuild` (high-risk,
action `rebuild`, reason-required, `Idempotency-Key` mandatory, audited),
`reporting.projections.analyze` (reconcile — the same "a read-only analysis
is not a new verb" precedent as `data_lifecycle.plan.analyze`),
`reporting.exports.read`, `reporting.exports.configure` (high-risk,
`Idempotency-Key` mandatory, audited), `reporting.exports.export` (manual trigger,
high-risk, `Idempotency-Key` mandatory, audited).

**Two guard layers for reading a projection** (list/get-detail/reconcile):
the coarse `authorizeInTransaction` gate on the route (`reporting.projections.read`/
`.analyze`) is NECESSARY but NOT SUFFICIENT — every descriptor ALSO declares
its own `requiredPermission`, enforced by `domain/
projection-permission-filter.ts` (filtering the list, 403 for a single-key
lookup) — the same pattern as `module-management/domain/navigation-registry.ts`'s
`filterVisibleNavigationEntries`. The three descriptors shipped with this PR happen to
share the same `requiredPermission`, so this second layer does not yet
differentiate any descriptor TODAY — but it is what prevents a
caller holding only the coarse permission from seeing a FUTURE projection with a
narrower permission registered by a derived module.

## Admin UI mutation client

`/admin/reporting` (`src/pages/admin/reporting.astro`, PR #335 — the module README once described <!-- historis:mulai -->`/admin/reporting/projections`<!-- historis:selesai --> + a `submitJson` helper that NEVER EXISTED in this repo)
— every mutation (rebuild/cancel/reconcile/export) goes through the REAL
`/api/v1/reports/*` endpoints, with no privileged shortcut. Use
`sendJson`/`onAction` (`src/lib/ui/admin-form-client.ts`, see the
`awcms-ui-screen` skill) to call them — **note**: this module's README
mentions `submitJson`, which does not exist here, and older skills named
`postJson`, which was deleted in August 2026. Always
`grep -n "^export" src/lib/ui/admin-form-client.ts` before writing against it.

## Not yet available

Materialized views/caching for the five live views (see above — deliberately
not built). Custom date pagination/filter for `access-audit`. The adversarial
test "bounded pass → simulated crash → resumed continuation → correct
total" from awcms-mini — **not here yet** (a BUILD candidate, not a port; ADR-0055 §1). The `tests/integration/` suite **NOW
EXISTS** (two-world harness, Issue #154), including
`reporting-projections.integration.test.ts` and
`db-role-separation.integration.test.ts` which cover the least-privilege role
split — so the place to put that crash-resume test is available; what is missing
is the test itself. Verify with `ls tests/integration/` before claiming
either direction. Derived domain modules (e.g.
AWPOS) add their own domain reporting views in a separate module, not in
this generic module.

## Related skills

`awcms-new-endpoint`, `awcms-new-migration`, `awcms-abac-guard` (the
projection/export permission catalog), `awcms-idempotency` (rebuild/export mutations),
`awcms-audit-log` (rebuild/export high-risk actions), `awcms-ui-screen`
(the `projections.astro` markup patterns), `awcms-module-management` (the same
`ProjectionDescriptor`/`listModules()` contract as
`dataLifecycle`/`sodRules`).
