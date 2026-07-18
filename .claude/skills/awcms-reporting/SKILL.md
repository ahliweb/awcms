---
name: awcms-reporting
description: Kelola modul reporting AWCMS — lima view management reporting live (tenant activity, access/audit, sync health, module usage, email health) plus mekanisme read-model projection (rebuild/reconcile/export terjadwal). Gunakan saat menambah/mengubah endpoint `/api/v1/reports/*`, menambah projection descriptor modul lain, atau menyentuh rebuild/export scheduling.
---

# AWCMS — Reporting (live views + projections)

Baca `src/modules/reporting/README.md` untuk detail penuh tiap view dan
endpoint — skill ini merangkum keputusan yang sudah dibuat supaya tidak
di-re-derive. Skema di repo ini: `sql/015_awcms_reporting_projections_schema.sql`
(tabel projection/rebuild-run/scheduled-export) dan
`sql/016_awcms_reporting_permissions.sql` (**seluruh tujuh** permission
`reporting.*` dalam satu file — `dashboard.read` untuk lima view live PLUS
keenam permission projection/export; komentar di dalamnya sendiri menyebut
ini gabungan port dari dua migration awcms-mini yang terpisah, tapi di repo
ini keduanya SUDAH digabung jadi satu file `sql/016` — jangan kutip nomor
migration awcms-mini yang lama sebagai nama file di repo ini, verifikasi
selalu dengan `ls sql/ | grep report` dulu).

## Kapan pakai skill ini vs skill generik

Melengkapi (bukan menggantikan) `awcms-new-endpoint`, `awcms-new-migration`,
`awcms-abac-guard`, `awcms-idempotency` — itu tetap dipakai untuk cara
membangun endpoint/migration/guard/idempotency. Skill ini menyediakan
konteks domain `reporting` spesifik: kapan sebuah metrik boleh jadi
projection, invariant rebuild-lock, dan permission catalog projection/export.

## Lima view live (tidak pernah cache/materialized view)

`GET /api/v1/reports/{tenant-activity,access-audit,sync-health,module-usage,
email-health}` — live read-aggregation setiap request atas tabel
`tenant_admin`/`identity_access`/`sync_storage`/`email` yang SUDAH ada, **tidak
ada tabel baru** untuk kelimanya. Guard identik untuk semua: bearer session +
`X-AWCMS-Tenant-ID`, `{ moduleKey: "reporting", activityCode: "dashboard",
action: "read" }` — **satu** permission `reporting.dashboard.read` menggerbangi
seluruh lima view (sengaja tidak dipecah per-view). Akses ditolak → `403
ACCESS_DENIED`, tidak pernah data kosong diam-diam. `access-audit` window 30
hari **hardcoded** (`ACCESS_AUDIT_DECISION_WINDOW_DAYS`) — tidak ada
pagination/filter tanggal kustom hari ini. Dashboard SSR (`/admin`) memanggil
fungsi `application/*-report.ts` LANGSUNG lewat `withTenant` (bukan HTTP
round-trip ke endpoint sendiri) — pola sama `admin/settings.astro`; halaman
merender panel "Akses ditolak" (bukan card kosong/500) kalau
`reporting.dashboard.read` tidak dimiliki. `email-health` **belum**
ditambahkan ke dashboard SSR (baru lewat endpoint API) — jangan asumsikan
kartu ke-5 sudah ada di `/admin`.

**Sengaja tidak ada worker/materialized view/cache** untuk kelima view ini —
latensi mengikuti biaya query langsung untuk tenant volume besar; optimasi
itu di luar scope. §Projections di bawah adalah jalur BARU DAN TERPISAH yang
membungkus SEBAGIAN metrik ini (access-audit, module-usage) tanpa mengganti
endpoint live-nya — keduanya tetap ada berdampingan.

## Projections (Issue #753) — kapan sebuah metrik BOLEH jadi projection

Modul mendaftarkan projection lewat array `reportingProjections` di
`module.ts` sendiri (`ProjectionDescriptor`,
`src/modules/_shared/module-contract.ts`) — pola "modul mendeklarasikan array
sendiri, satu aggregator pusat membaca `listModules()`" yang sama seperti
`dataLifecycle`/`sodRules`. Dua strategi update:

- **`cursor_table`** — poll cursor-ordered bounded atas satu/lebih tabel
  sumber. **Hanya benar untuk sumber yang genuinely append-only** (tidak ada
  hard delete, tidak ada soft-delete-lalu-restore) — engine hanya bisa
  MENAMBAH, jadi baris sumber yang kemudian hilang/di-restore akan diam-diam
  membuat hitungan desync. Inilah kenapa `access_audit_summary` (decision log
  ABAC, benar-benar append-only) dan `module_activity_summary`
  (identity/sync-node, tidak ada mekanisme delete di base ini) yang dipilih
  untuk dibungkus — **BUKAN** `sync-health`/`email-health`/office-count dari
  `module-usage`, yang mutable-state atau soft-delete-dengan-restore dan
  butuh row-level CDC/delta tracking untuk diproyeksikan aman (follow-up
  lebih besar, belum dikerjakan). **Jangan tambah `cursor_table` projection
  di atas sumber yang bisa di-restore/hard-delete tanpa CDC/delta tracking
  yang setara.**
- **`domain_event`** — update steady-state di-PUSH oleh consumer
  `domain_event_runtime` terdaftar (Issue #742), reuse job/lock/batching/
  idempotency/retry/pause-resume yang sudah ada, bukan membangun mekanisme
  kedua.

Setiap projection — apa pun strategi steady-state-nya — di-REBUILD lewat
mekanisme `cursor_table` re-scan bounded yang SAMA (`rebuildSource`, selalu
ada), membaca tabel sumber otoritatif langsung.

## TOCTOU rebuild-lock (Issue #151) — invariant paling gampang diregresi

Race antara worker incremental steady-state dan rebuild trigger: memindahkan
`findRunningRebuild` ke dalam transaksi `runCursorStreamPass` PERLU tapi
**TIDAK CUKUP** — setiap transaksi jalan di READ COMMITTED (`withTenant` tidak
pernah mengubah isolation level), tiap statement dalam SATU transaksi
mengambil snapshot baru, jadi `triggerOrResumeRebuild` yang commit di antara
statement `findRunningRebuild` dan `getStreamCursor` pass yang sama tetap
invisible ke statement pertama, visible ke yang kedua — celah check-then-act
yang sama, cuma dipersempit dari "antar dua transaksi" jadi "antar dua
statement". Memindahkan cek saja juga tidak menutup separuh lain bahaya ini:
dua transaksi pass (satu incremental, satu rebuild) yang sama-sama membaca
`cursor_value = NULL` yang baru di-reset akan SAMA-SAMA re-scan tabel sumber
dari awal dan SAMA-SAMA `applyMetricDeltas` — serialize di row-lock metrik
sehingga MENJUMLAHKAN, bukan bertabrakan — double-count diam-diam.

**Fix**: `pg_advisory_xact_lock` per-(tenant, projection)
(`application/projection-lock.ts`) — dipegang DATABASE untuk seluruh
transaksi, dilepas otomatis saat COMMIT/ROLLBACK, dan efektif LINTAS PROSES
(rebuild trigger jalan di web request `app`/`interactive`; incremental worker
jalan di proses `bun run reporting:projections:refresh` `worker`/
`maintenance` terpisah — tidak ada in-process gate yang bisa men-serialize
keduanya). **Setiap** penulis baris cursor/metric projection mengambil lock
ini sebagai statement PERTAMA transaksinya, sebelum membaca apa pun yang lalu
ditindaklanjuti: `projection-incremental-worker.ts`'s `runCursorStreamPass`,
`projection-rebuild.ts`'s `triggerOrResumeRebuild` (SATU-SATUNYA yang
me-reset) + `runRebuildStreamPass`, `event-activity-projection.ts`'s
`applyEventActivityProjectionIncrement`. Lock-ordering: lock ini SELALU
diambil PERTAMA, sebelum row lock apa pun di tabel cursor/metric/rebuild-run
— jangan balik urutan ini di kode baru (deadlock). Blocking
(`pg_advisory_xact_lock`), bukan try-and-skip — semua bagian yang berkontensi
adalah transaksi pendek yang bounded (satu halaman `batchLimit`, atau satu
reset). Test: `tests/reporting-projection-rebuild-lock.test.ts` (Postgres
nyata, skip bersih kalau `REPORTING_TEST_DATABASE_URL` tidak di-set).

`triggerOrResumeRebuild` satu-satunya tempat cursor/metrik di-reset ke nol —
dalam transaksi PEMANGGIL (route API), atomik dengan baris run baru, audit
log, dan idempotency record. Partial unique index `sql/015`
(`awcms_reporting_rebuild_runs_running_unique ... WHERE status = 'running'`)
membuat double-reset konkuren mustahil di level database; `createRebuildRun`
pakai `INSERT ... ON CONFLICT DO NOTHING` (bukan exception unique-violation
mentah). `continueRebuildPasses` TIDAK
PERNAH me-reset apa pun — hanya memajukan cursor run yang sudah `'running'`,
satu pass bounded = satu transaksi (select batch → apply delta → advance
cursor → bump `rows_processed`), pola crash-safe yang sama seperti engine
archive/purge `data_lifecycle`.

## Freshness — dihitung live, tidak pernah di-cache

`domain/freshness.ts`'s `computeProjectionFreshness` murni fungsi dari fakta
persisted (`last_success_at`, `consecutive_failures`) vs `now` — bukan enum
status tersimpan. Lima state: `current`/`delayed`/`stale`/`rebuilding`
(selalu menang)/`failed` (ambang consecutive-failure, dicek setelah
`rebuilding`). Kalau worker berhenti total, tidak ada write lagi, tapi path
baca tetap benar meng-age status murni dari waktu berlalu.

## Reconciliation & scheduled exports

`POST /api/v1/reports/projections/{key}/reconcile` — hitung ULANG control
total penuh langsung dari `rebuildSource`, bandingkan ke metrik projection
live; on-demand saja, TIDAK butuh `Idempotency-Key` (nol mutasi state bisnis,
hanya append satu baris histori). Mismatch selagi projection cuma `delayed`
adalah WAJAR, bukan bug — baca freshness bersamaan dengan reconcile, jangan
menggantikannya. Scheduled export (`application/export-generation.ts`)
menulis snapshot CSV/JSON ke `REPORTING_EXPORT_ROOT_PATH` (checksum SHA-256,
CSV formula-injection dinetralkan) DI LUAR transaksi DB, lalu mencatat satu
baris manifest `awcms_reporting_export_runs`. `bun run
reporting:exports:dispatch` reuse fungsi generation yang sama untuk tiap
`awcms_reporting_scheduled_exports` yang enabled+due. Download
(`GET .../exports/runs/{id}/download`) re-cek RBAC/ABAC+tenant scope saat
download, menolak artifact kedaluwarsa dengan `410 Gone`. **`filter` diterima/
disimpan tapi BELUM diterapkan** — `POST /api/v1/reports/exports`'s `filter`
field tersimpan dan selalu dikembalikan, tapi generation tidak pernah
mengonsultasinya; endpoint create MENOLAK `filter` non-kosong dengan `400
NOT_IMPLEMENTED` sampai skema dan wiring-nya dibangun — jangan
mengasumsikan filter sudah berfungsi karena field-nya "diterima".

## Permission catalog

`reporting.dashboard.read` (`sql/016`) — satu-satunya untuk lima view
live, tidak berubah. Enam permission projection/export **di file `sql/016`
yang sama** (`domain/projection-permissions.ts`'s
`REPORTING_PROJECTION_PERMISSIONS`, single source of truth — reuse konstanta
ini, jangan re-type string literal):
`reporting.projections.read`, `reporting.projections.rebuild` (high-risk,
action `rebuild`, reason-required, `Idempotency-Key` wajib, audited),
`reporting.projections.analyze` (reconcile — presedential "analisis read-only
bukan verb baru" yang sama seperti `data_lifecycle.plan.analyze`),
`reporting.exports.read`, `reporting.exports.configure` (high-risk,
`Idempotency-Key` wajib, audited), `reporting.exports.export` (trigger manual,
high-risk, `Idempotency-Key` wajib, audited).

**Dua lapis guard untuk membaca projection** (list/get-detail/reconcile):
gate kasar `authorizeInTransaction` di route (`reporting.projections.read`/
`.analyze`) PERLU tapi TIDAK CUKUP — setiap descriptor JUGA mendeklarasikan
`requiredPermission` sendiri, ditegakkan `domain/
projection-permission-filter.ts` (memfilter list, 403 untuk single-key
lookup) — pola sama `module-management/domain/navigation-registry.ts`'s
`filterVisibleNavigationEntries`. Ketiga descriptor bawaan PR ini kebetulan
berbagi `requiredPermission` yang sama, jadi lapis kedua ini belum
terbedakan untuk descriptor manapun HARI INI — tapi inilah yang mencegah
caller berpermission kasar saja melihat projection FUTURE berpermission
lebih sempit yang didaftarkan modul turunan.

## Admin UI mutation client

`/admin/reporting/projections` (`src/pages/admin/reporting/projections.astro`)
— setiap mutation (rebuild/cancel/reconcile/export) lewat endpoint
`/api/v1/reports/*` yang REAL, tanpa shortcut privileged. Pakai
`sendJson`/`postJson` (`src/lib/ui/admin-form-client.ts`, lihat skill
`awcms-ui-screen`) untuk memanggilnya — **catatan**: README modul ini
menyebut `submitJson`, yang TIDAK ADA di `admin-form-client.ts` versi repo
ini (verifikasi: `grep -n "^export" src/lib/ui/admin-form-client.ts`); pakai
`sendJson`/`postJson` yang benar-benar ada.

## Belum tersedia

Materialized view/caching untuk lima view live (lihat di atas — sengaja
tidak dibangun). Pagination/filter tanggal kustom untuk `access-audit`. Test
adversarial "bounded pass → simulated crash → resumed continuation → total
benar" dan test `provisionWorkerRole()`-based least-privilege dari awcms-mini
— **belum di-port**, repo ini belum punya suite `tests/integration/` untuk
keduanya (verifikasi dulu sebelum mengklaim ada). Modul domain turunan (mis.
AWPOS) menambah view reporting domainnya sendiri di modul terpisah, bukan di
modul generik ini.

## Skill terkait

`awcms-new-endpoint`, `awcms-new-migration`, `awcms-abac-guard` (permission
catalog projection/export), `awcms-idempotency` (rebuild/export mutation),
`awcms-audit-log` (rebuild/export high-risk actions), `awcms-ui-screen`
(pola markup `projections.astro`), `awcms-module-management` (kontrak
`ProjectionDescriptor`/`listModules()` yang sama dengan
`dataLifecycle`/`sodRules`).
