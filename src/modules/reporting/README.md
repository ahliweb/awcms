# Management Reporting

Implementasi Issue 9.1 (`docs/awcms/06_github_issues_detail.md` §Issue 9.1 — Add Management Reporting Views).

## Scope

Lima view reporting **generik** (aplikasi turunan menambah view domainnya sendiri di atas base ini):

1. **Tenant activity summary** (`GET /api/v1/reports/tenant-activity`) — nama/status/tanggal dibuat tenant, jumlah user tenant aktif (`awcms_tenant_users` — tidak punya kolom `deleted_at`, jadi hanya difilter `status = 'active'`), jumlah office aktif (`awcms_offices`, `status = 'active' AND deleted_at IS NULL`), dan waktu login terakhir se-tenant (`MAX(awcms_identities.last_login_at)`).
2. **Access/audit summary** (`GET /api/v1/reports/access-audit`) — jumlah keputusan ABAC `allow`/`deny` dalam 30 hari terakhir plus total count all-time dari `awcms_abac_decision_logs`, dan total entri `awcms_profile_audit_logs` sebagai proxy generik "ada aktivitas audit lain" (base ini belum punya tabel `audit_events` umum — lihat `src/modules/sync-storage/README.md` §Belum tersedia).
3. **Sync health** (`GET /api/v1/reports/sync-health`) — jumlah sync node total/aktif dan waktu push/pull terakhir (`awcms_sync_nodes`), jumlah conflict `open` (`awcms_sync_conflicts`), dan jumlah objek `pending`/`failed` (`awcms_object_sync_queue`). Response menambah flag turunan `hasOpenConflicts`, `hasFailedObjects`, `isHealthy` (`activeNodeCount > 0` dan tidak ada conflict terbuka/objek gagal) — lihat `domain/sync-health.ts` (`shapeSyncHealth`, pure function, unit test terpisah dari I/O).
4. **Module usage** (`GET /api/v1/reports/module-usage`) — untuk setiap modul terdaftar di `src/modules/index.ts`, satu sinyal "ada data" generik: `tenant_admin` → jumlah office, `profile_identity` → jumlah profile, `identity_access` → jumlah identity, `sync_storage` → jumlah sync node, `reporting` sendiri → jumlah baris `awcms_permissions` (katalog **global**, tidak tenant-scoped — beda dari metrik lain). Modul yang tidak dikenali fungsi ini mendapat `metricLabel: "No metric defined yet"` alih-alih error, supaya generic terhadap modul baru di masa depan.
5. **Email queue health** (`GET /api/v1/reports/email-health`, Issue #499) — kesehatan antrian `email_messages`/`_delivery_attempts`: jumlah pesan per status (`queued`/`sending`/`sent`/`failed`/`cancelled`), pesan gagal terbaru, dan backlog retry (`application/email-health-report.ts`'s `fetchEmailHealthReport`). Menambah dependency modul `email` ke `dependencies` array (`module.ts`).

**Tidak ada tabel baru.** Kelima view adalah live read-aggregation atas tabel yang sudah dibuat migrasi 002-009 dan `020`-`021` (email). Migration `010_awcms_management_reporting_permission_schema.sql` hanya menambah **satu** permission (`reporting.dashboard.read`) ke katalog global `awcms_permissions` — cukup untuk seluruh lima view (satu fitur dashboard, sengaja tidak dipecah jadi permission per view, termasuk saat `email-health` ditambahkan di #499).

## Guard

Kelima endpoint memakai pola identik dengan `GET /api/v1/sync/conflicts` dan `POST /api/v1/access/evaluate`: bearer session (`Authorization: Bearer <token>` + header `X-AWCMS-Mini-Tenant-ID`), `resolveTenantContext` + `fetchGrantedPermissionKeys` + `evaluateAccess` (default deny) + `recordDecisionLog` (dicatat untuk setiap panggilan, allow maupun deny), digerbang oleh `{ moduleKey: "reporting", activityCode: "dashboard", action: "read" }`. Akses ditolak → `403 ACCESS_DENIED`, bukan data kosong diam-diam.

## Dashboard SSR (`/admin`)

`src/pages/admin/index.astro` (yang sebelumnya placeholder "Dashboard belum tersedia — lihat Issue 9.1" sejak Issue 8.1) sekarang SSR-fetch keempat aggregasi **langsung** lewat `withTenant` + fungsi `application/*-report.ts` di modul ini — bukan HTTP round-trip ke endpoint `/reports/*` milik aplikasi sendiri (itu redundan; endpoint tetap ada untuk kontrak API/klien lain). Jika `Astro.locals.ssrContext.permissions` tidak memuat `reporting.dashboard.read`, halaman merender panel "Akses ditolak" (bukan card kosong, bukan 500).

## SyncIndicator

`src/layouts/AdminLayout.astro` memakai `application/sync-indicator.ts` (`fetchSyncIndicatorActive`) untuk topbar `<SyncIndicator active={...} />` — ini bukan pemanggilan ulang agregasi penuh `GET /reports/sync-health`, melainkan satu query `EXISTS` ringan (layout ini render di setiap request `/admin/*`), dengan formula "sehat" yang sama: minimal satu node aktif, tidak ada conflict terbuka, tidak ada objek gagal.

## Projections (Issue #753, epic `platform-evolution` #738 Wave 3)

Extension to this module (not a new module): module-contributed
read-model projection descriptors, incremental cursor/domain-event
updates, idempotent rebuild, freshness/staleness signals, source
reconciliation, and scheduled exports. Full design rationale lives as
dense header comments in the source files below — this section is a
map, not a duplicate.

### The descriptor contract (`ProjectionDescriptor`)

Defined in `src/modules/_shared/module-contract.ts` (same "module
declares its own array, a central aggregator reads `listModules()`"
shape `dataLifecycle`/`sodRules` already established). A module
contributes ONE entry per projection in its own `module.ts`'s
`reportingProjections` array — `reporting`'s own three entries
(`module.ts`) are the only ones registered in this PR. `reporting`'s
engine never writes another module's transactional table; it only ever
reads a source table (via a bounded cursor re-scan, or a `domain_event`
consumer) and writes its own `awcms_reporting_projection_*` tables.

Registry validation: `domain/projection-registry.ts`'s
`validateProjectionRegistry`, wired into `bun run check` via `bun run
reporting:projections:registry:check`.

### Two update strategies

- **`cursor_table`** — a bounded, cursor-ordered poll of one or more
  source tables (`ProjectionCursorStream`), incrementing/decrementing
  named metric counters via row-matching rules. This is the ONLY safe
  strategy for a table with no domain-event producer yet — but it is
  only CORRECT for a genuinely append-only source (no hard delete, no
  soft-delete-then-restore): the engine can only ever ADD, so a source
  row that later disappears or gets un-deleted would silently desync
  the count. This is why `access_audit_summary` (ABAC decision log,
  truly append-only) and `module_activity_summary` (identities/sync
  nodes, no delete mechanism at all in this base) were chosen to wrap —
  NOT `sync-health`/`email-health`/office-and-profile counts from
  `module-usage`, which are mutable-state or soft-delete-with-restore
  and would need row-level CDC/delta tracking to project safely
  (a legitimate, larger follow-up, not attempted here).
- **`domain_event`** — steady-state updates are PUSHED by a registered
  `domain_event_runtime` consumer (Issue #742), reusing that module's
  shared jobs/locks/batching/idempotency/retry/pause-resume machinery
  instead of building a second one. The ONE real (non-reference) new
  consumer this issue registers lives in `domain-event-runtime/
infrastructure/consumer-registry.ts` (`reporting.event_activity_
projector`) — the one deliberate cross-module edge, one-directional
  (`domain_event_runtime -> reporting/application`), verified cycle-free
  by `tests/unit/module-boundary-cycles.test.ts`.

Every projection — REGARDLESS of its steady-state strategy — is
REBUILT via the exact same bounded `cursor_table` re-scan mechanism
(`rebuildSource`, always present), reading the authoritative source
table directly (for `event_activity_summary`, that's
`awcms_domain_events` itself, never by re-triggering delivery).

### Idempotent rebuild — the correctness-critical part

`application/projection-rebuild.ts`'s own header comment is the primary
reference; summary:

1. `triggerOrResumeRebuild` is the ONLY place cursors/metrics reset to
   zero — done in the CALLER's own transaction (the API route's), atomic
   with the new run row, audit log, and idempotency record. Migration
   069's partial unique index (`... WHERE status = 'running'`) makes a
   concurrent double-reset impossible at the database level;
   `createRebuildRun` uses `INSERT ... ON CONFLICT DO NOTHING` (never a
   raw unique-violation exception) so a lost race doesn't poison the
   transaction.
2. `continueRebuildPasses` NEVER resets anything — only ever advances an
   already-`'running'` run's cursor forward, one bounded pass = one
   transaction (select batch -> apply deltas -> advance cursor -> bump
   `rows_processed`), the same crash-safe shape `data_lifecycle`'s
   archive/purge engine already proved. A crash between passes leaves
   cursor/metrics/`rows_processed` consistent at exactly the last
   COMPLETED pass; resuming (a retried API call, the next scheduled
   `reporting:projections:refresh` tick, or a re-triggered rebuild that
   finds one already `'running'`) picks up exactly there — never
   double-counts, never skips.
3. While a rebuild owns a (tenant, projection), the `cursor_table`
   steady-state worker SKIPS it entirely (no-op, not an error) — the
   rebuild's own full re-scan shares the SAME cursor, so it is guaranteed
   to already cover any row written during its window. The `domain_event`
   live consumer instead THROWS (deferring via the normal retry/backoff
   path) and, on retry, compares the event's own `occurredAt` against the
   rebuild-source stream's cursor WATERMARK to tell "already counted by a
   rebuild that has since completed/cancelled/failed" apart from "never
   counted by anything" — a plain skip-with-blind-retry would either
   permanently lose an event (if the blocking rebuild was cancelled
   before reaching it) or double-count it (if the rebuild went on to
   complete normally); see `application/event-activity-projection.ts`'s
   own header comment for the full analysis (security-auditor finding,
   PR #781).

Adversarial test (bounded pass -> simulated crash -> resumed
continuation -> exact correct total, never double/under-counted) and a
`provisionWorkerRole()`-based least-privilege test both live in
`tests/integration/reporting-projections.integration.test.ts`.

### Freshness — computed live, never cached

`domain/freshness.ts`'s `computeProjectionFreshness` is a PURE function
of raw persisted facts (`last_success_at`, `consecutive_failures`) vs.
`now` — never a stored status enum. If the worker that's supposed to
keep a projection fresh stops running ENTIRELY, no write ever happens
again, but the READ path still correctly ages the reported status from
`current` -> `delayed` -> `stale` purely from elapsed time. Five states:
`current` / `delayed` / `stale` / `rebuilding` (always wins) / `failed`
(consecutive-failure threshold, checked after `rebuilding`).

### Reconciliation

`application/projection-reconciliation.ts`'s `reconcileProjection`
computes a FRESH, full control total straight from the same
`rebuildSource` contract and compares it to the live projection
metrics — on-demand only (`POST /api/v1/reports/projections/{key}/
reconcile`), no `Idempotency-Key` (zero mutation of business state,
only appends a history row, same posture `data_lifecycle`'s dry-run
endpoint already established). A mismatch while a projection is merely
`delayed` is EXPECTED, not a bug — read freshness alongside reconcile,
never instead of it.

### Scheduled exports

Minimal, self-contained (not built on Issue #752 `data_exchange`, which
was still in parallel development when this issue shipped — its
staged-import/large-dataset machinery is the right fit for arbitrary
business-record export, not this projection's small metric-snapshot
export). `application/export-generation.ts` writes a CSV/JSON snapshot
(one row per metric) to `REPORTING_EXPORT_ROOT_PATH` (doc 18,
`infrastructure/local-export-adapter.ts`, SHA-256 checksummed, CSV
formula-injection neutralized) OUTSIDE any DB transaction, then records
one `awcms_reporting_export_runs` manifest row (checksum, row
count, expiry). `bun run reporting:exports:dispatch` reuses the exact
same generation function for every enabled, due
`awcms_reporting_scheduled_exports` config. Download
(`GET /api/v1/reports/exports/runs/{id}/download`) re-checks RBAC/ABAC
and tenant scope at DOWNLOAD time and refuses an expired artifact with
`410 Gone`. The returned `X-Checksum-Sha256` header is the manifest's
stored value, not recomputed from the bytes actually read at download
time (a minor defense-in-depth gap — on-disk tampering detection, not
the primary access control, which stays ABAC+RLS — noted here rather
than silently assumed, security-auditor finding PR #781).

**`filter` is accepted/persisted but not yet applied** — `POST
/api/v1/reports/exports`'s `filter` field is stored on the scheduled
export config and returned by every read, but `generateProjectionExport`
never consults it: every export always contains the full metric
snapshot. Rather than silently ignore a submitted filter (a false sense
of scoping), the create endpoint rejects a non-empty `filter` with `400
NOT_IMPLEMENTED` until a follow-up issue defines its schema and wires it
into generation (reviewer + security-auditor finding, PR #781).

### API

`GET /api/v1/reports/projections[/{key}]`,
`POST .../projections/{key}/rebuild[/cancel]`,
`POST .../projections/{key}/reconcile`,
`GET/POST /api/v1/reports/exports`, `POST .../exports/{id}/disable`,
`POST .../exports/trigger`, `GET .../exports/runs`,
`GET .../exports/runs/{id}/download` — see
`openapi/modules/reporting-projections.openapi.yaml`. Every mutation
(`rebuild`, `rebuild/cancel`, `exports` create/disable/trigger) requires
`Idempotency-Key`; `reconcile` and every `GET` do not (no business-state
mutation).

### Permissions

Additive to the pre-existing `reporting.dashboard.read` (migration 010,
unchanged): `reporting.projections.{read,rebuild,analyze}`,
`reporting.exports.{read,configure,export}` (migration 070,
`domain/projection-permissions.ts`'s `REPORTING_PROJECTION_PERMISSIONS`
single source of truth).

**Two enforcement layers for reading a projection** (list/get-detail/
reconcile): the route's own coarse `authorizeInTransaction` gate
(`reporting.projections.read`/`.analyze`) is necessary but NOT
sufficient — every descriptor also declares its OWN
`ProjectionDescriptor.requiredPermission`, additionally enforced by
`domain/projection-permission-filter.ts` (filters the list, 403s a
single-key lookup) — same pattern
`module-management/domain/navigation-registry.ts`'s
`filterVisibleNavigationEntries` already established for admin nav. All
three descriptors registered in this PR happen to share the same
`requiredPermission`, so this second layer is not yet distinguishable
from the first for any REAL descriptor today — but it is what stops a
caller holding only the coarse permission from seeing a FUTURE
narrower-permissioned projection a derived module registers (reviewer
finding, PR #781).

### Admin UI

`/admin/reporting/projections` (`src/pages/admin/reporting/
projections.astro`) — freshness-status table with rebuild/cancel/
reconcile/export actions, scheduled-export management, export-run
history with download links. Every mutation goes through the real
`/api/v1/reports/*` endpoints via `submitJson`, no privileged shortcut.

## Belum tersedia

- **Tidak ada worker, materialized view, atau caching layer** untuk KELIMA endpoint live di atas — endpoint-endpoint ini sengaja tetap live aggregation setiap request, tidak berubah oleh §Projections di bawah. Untuk tenant dengan volume data besar (banyak sync node/decision log), latensi dashboard akan mengikuti biaya query langsung; optimasi (materialized view terjadwal, cache, dsb.) sengaja **di luar scope** issue 9.1 ini. Issue #753 (§Projections di bawah) menambahkan jalur BARU dan TERPISAH (proyeksi read-model + worker + freshness) yang membungkus SEBAGIAN dari dua endpoint ini (access-audit, module-usage) tanpa mengubah endpoint live itu sendiri — keduanya tetap tersedia berdampingan, bukan salah satu digantikan.
- Tidak ada pagination/filter tanggal kustom pada `access-audit` — window 30 hari saat ini hardcoded (`ACCESS_AUDIT_DECISION_WINDOW_DAYS`).
- Modul domain turunan (mis. AWPOS) menambah view reporting domainnya sendiri (penjualan, stok, pajak) di modul terpisah, bukan di modul generik ini.
- `GET /api/v1/reports/email-health` (#5 di atas) belum ditambahkan ke SSR dashboard (`src/pages/admin/index.astro`) — dashboard admin baru menampilkan empat view pertama (tenant activity, access/audit, sync health, module usage); email queue health baru tersedia lewat endpoint API, belum lewat kartu di `/admin`.
