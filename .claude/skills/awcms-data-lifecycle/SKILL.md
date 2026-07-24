---
name: awcms-data-lifecycle
description: Modul data_lifecycle SUDAH di-port ke repo ini (ADR-0037, dari awcms-micro Issue #745; migrasi sql/055 schema + sql/056 permission). System Foundation (`type: system`, deps `[tenant_admin, identity_access, logging]`) yang MEMILIKI empat tabel `awcms_data_lifecycle_*` (legal_holds/cursors/archive_manifests/runs, semua FORCE RLS), registry `HighVolumeTableDescriptor` yang dikontribusikan tiap modul pemilik (`ModuleDescriptor.dataLifecycle`), dry-run planner zero-mutation, bounded archive/purge engine, provider-neutral archive port (local/offline). Menyediakan `LegalHoldGuardPort` (`_shared/ports/legal-hold-guard-port.ts`, seam level-sumber BUKAN capability-registry) yang dikonsumsi `logging` (wajib) & `visitor_analytics` (opsional-step) di composition root purge mereka. Gunakan saat mendaftarkan tabel bervolume tinggi baru, membuat/melepas legal hold, atau mengubah engine.
---

# AWCMS — Data Lifecycle (Registry, Legal Hold, Dry-Run, Archive/Purge)

> **STATUS — modul ini SUDAH di-port ke repo ini (ADR-0037).**
> `data_lifecycle` hidup di `src/modules/data-lifecycle/` (16 berkas),
> migrasi `sql/055` (schema, empat tabel `awcms_data_lifecycle_*` FORCE
> RLS) + `sql/056` (permission), dan `HighVolumeTableDescriptor` +
> `ModuleDescriptor.dataLifecycle` ADA di `_shared/module-contract.ts`
> (`MODULE_CONTRACT_VERSION` ≥ 2.1.0). Rujukan tabel/kode di bawah NYATA di
> repo ini. `LegalHoldGuardPort` adalah **seam port level-sumber**, BUKAN
> entri `capability-contract-versions.ts` — di-wire di composition root
> (script/route), tidak pernah di-import dari dalam pohon `application`/
> `domain` modul konsumen. Konsumen aktif: `logging.audit_events`
> (delegated, guard WAJIB) & `visitor_analytics.visit_events` (delegated,
> guard menggerbangi step-1 DELETE saja). Konsumen `form_drafts`/
> `newsletter`/`comments` DITUNDA (modul belum di-port).

Sumber kebenaran: `src/modules/_shared/module-contract.ts`
(`HighVolumeTableDescriptor`), `src/modules/data-lifecycle/` (domain/
application/infrastructure/api), `src/modules/data-lifecycle/README.md`
(detail teknis lengkap + pemetaan kepatuhan + prosedur restore),
`docs/adr/0037-data-lifecycle-module-admission.md`, ADR-0013 §6 (data
ownership matrix — "no shared-table write").

## Kapan pakai skill ini

1. **Mendaftarkan tabel bervolume tinggi baru** ke registry (kasus paling
   umum) — lihat §Playbook di bawah.
2. **Membuat/melepas legal hold** dari kode (service layer, bukan hanya
   via API).
3. **Mengubah engine** (`dry-run-planner.ts`, `archive-purge-job.ts`,
   `local-archive-adapter.ts`) — baca §Jangan ulangi bug presisi cursor
   di bawah SEBELUM menyentuh perbandingan batas cursor mana pun.

## Playbook: mendaftarkan tabel bervolume tinggi baru

1. Di `module.ts` modul PEMILIK tabel (bukan `data-lifecycle/module.ts`
   — descriptor didaftarkan oleh modul yang memiliki tabelnya sendiri),
   tambah entry ke `dataLifecycle: [...]`:

   ```ts
   dataLifecycle: [
     {
       key: "your_module.your_table", // unik, "<ownerModuleKey>.<tableShortName>"
       tableName: "awcms_your_table",
       ownerModuleKey: "your_module", // HARUS sama dengan module.ts's key sendiri
       scope: "tenant", // scope: "global" belum dieksekusi end-to-end, lihat Batasan
       cursorColumn: "created_at", // kolom timestamptz untuk batching/ordering
       retentionClass: "operational_queue", // | audit_security | analytics_telemetry | financial_tax | communication_log | system_event
       retentionMinDays: 7,
       retentionMaxDays: 365,
       defaultRetentionDays: 90,
       partition: { eligible: false, rationale: "..." }, // wajib rationale walau eligible:false
       archive: { archivable: false, rationale: "..." }, // archivable:true wajib format+port
       deletion: { mode: "hard_delete", rationale: "..." },
       legalHold: { applicable: true, precedence: "overrides_retention" }, // TIDAK bisa "not_applicable" bila applicable:true
       requiredIndexes: [
         { columns: ["tenant_id", "created_at"], purpose: "..." }
       ],
       batchLimit: 5000, // <= 50.000 (MAX_LIFECYCLE_BATCH_LIMIT)
       backupRestoreNotes: "...",
       executionMode: "delegated", // ATAU "generic" — lihat pilihan di bawah
       existingAdopter: {
         // WAJIB bila executionMode "delegated", DILARANG bila "generic"
         jobCommand: "bun run your:purge:job",
         purgeFunctionRef:
           "src/modules/your_module/application/your-purge.ts#purgeYourTable",
         description: "..."
       }
     }
   ];
   ```

2. **Pilih `executionMode`**:
   - Sudah punya job purge sendiri (kasus paling umum)? →
     `"delegated"` — TETAP pakai job/fungsi yang sudah ada, jangan
     duplikasi logic-nya. `data_lifecycle`'s engine hanya membaca tabel
     ini untuk dry-run (read-only, aman); purge asli tidak pernah
     disentuh mesin ini.
   - Belum punya mekanisme purge sama sekali dan ingin
     `data_lifecycle`'s engine yang mengeksekusi bounded archive/purge
     untukmu? → `"generic"` — WAJIB kolom `id uuid PRIMARY KEY` (asumsi
     global doc 04) dan index komposit tenant+cursor (dicek registry
     gate). Hanya `deletion.mode: "hard_delete"` yang dieksekusi mesin
     ini hari ini — mode lain ditolak (error jelas), bukan salah
     eksekusi diam-diam.

3. `bun run data-lifecycle:registry:check` — perbaiki error yang
   dilaporkan (menyebut field dan alasan persis).

4. Dokumentasikan rasional retensi tabel barumu di `README.md` modul
   PEMILIK (dan/atau `src/modules/data-lifecycle/README.md` §compliance)
   — **jangan** klaim satu periode retensi legal universal; jelaskan
   alasan spesifik kelas data ini.

5. `bun run changeset`.

## Legal hold — precedence dan default-deny (kritis, jangan dilonggarkan)

- Hold aktif (tenant-wide `descriptorKey: null`, atau menyasar descriptor
  spesifik) SELALU override retensi/purge biasa — dicek di
  `planLifecycleDryRun` SEBELUM cabang apa pun yang bisa melaporkan baris
  purgeable. `retentionDaysOverride` seagresif apa pun tidak bisa
  membuka jalan purge saat hold aktif.
- `legalHold.applicable` pada descriptor adalah **metadata dokumentasi
  murni** — JANGAN PERNAH membuat mesin mengecek field ini untuk
  memutuskan apakah hold berlaku. Hold record NYATA selalu berlaku
  terlepas dari nilai field ini (mencegah modul pemilik mendeklarasikan
  tabelnya sendiri "kebal hold").
- `data_lifecycle.legal_hold.create` dan `.release` WAJIB tetap
  permission KODE TERPISAH — jangan pernah menggabungkannya jadi satu
  permission `manage`. `security:readiness`'s
  `checkDataLifecycleLegalHoldReleaseSeparate` (critical) akan gagal bila
  ini dilanggar.
- Release WAJIB reason (≥10 karakter, `validateReleaseLegalHoldInput`),
  `Idempotency-Key`, dan audit `critical` — sama seperti create.
- `endsAt` pada hold **tidak** otomatis melepas hold — murni metadata
  "perkiraan tanggal review". Hanya aksi release eksplisit yang mengubah
  status.

## Jangan ulangi bug presisi cursor (microsecond vs millisecond)

`timestamptz` PostgreSQL presisi mikrodetik; `Date` JavaScript hanya
milidetik. **Setiap** perbandingan batas cursor yang membaca sebuah nilai
dari Postgres (via `SELECT`, otomatis jadi JS `Date`) lalu memakainya
sebagai bound `<=`/`>`/`>=` di query BERIKUTNYA kehilangan presisi —
baris yang MENDEFINISIKAN batas itu bisa gagal memenuhi perbandingan
terhadap dirinya sendiri.

- **Sudah diperbaiki** di `archive-purge-job.ts` via
  `CURSOR_BOUNDARY_SAFETY_MARGIN_MS` (1ms) — pola: pad batas ke ARAH
  YANG BENAR (upper bound `<=` → tambah 1ms; lower bound resume `>` →
  ubah jadi `>=` dengan bound `+1ms`) sebelum dipakai sebagai parameter
  query berikutnya. Konstanta/helper: `domain/cursor-boundary.ts`.
- **Bila menambah perbandingan cursor BARU** (fitur baru, refactor):
  reuse `CURSOR_BOUNDARY_SAFETY_MARGIN_MS` yang sudah ada, JANGAN
  bandingkan nilai `Date` yang dibaca-lalu-ditulis-ulang secara langsung
  tanpa padding. Uji dengan test regresi
  `tests/data-lifecycle-cursor-boundary.test.ts` + integration
  DB-gated (bug ini SELALU muncul di baris terakhir setiap batch, bukan
  kasus langka — tanpa fix, backlog kecil bisa terjebak loop sampai
  `DEFAULT_MAX_PASSES`).
- Detail investigasi lengkap (bagaimana bug ditemukan, dampak sebelum
  fix): `src/modules/data-lifecycle/README.md` §Timestamp precision.

## Identifier dinamis (tableName/tenantColumn/cursorColumn) di SQL

Selalu lewat `assertSafeIdentifier` (regex allowlist) SEBELUM
diinterpolasi ke teks SQL via `tx.unsafe(sql, params)` — nilai
sebenarnya (`tenantId`, `cutoff`, dst.) tetap SELALU lewat parameter
`$1`/`$2`/... terikat, tidak pernah string-concat. Identifier HANYA
boleh berasal dari `HighVolumeTableDescriptor` yang sudah divalidasi
registry gate — tidak pernah dari request/user input. Pola sama
`visitor-analytics/application/analytics-queries.ts`'s
`topJsonFieldCounts`.

## Jangan bikin mekanisme baru untuk yang sudah ada

- **Locking/batching/retry** — reuse `src/lib/jobs/*` (shared worker
  runner, PR #713/Issue #697) lewat `runBoundedBatches`. JANGAN tambah
  advisory lock/batching sendiri.
- **Audit** — reuse `recordAuditEvent` yang sudah ada
  (`logging/application/audit-log.ts`). JANGAN bikin tabel audit
  terpisah untuk aksi data-lifecycle.
- **Redaksi/masking** — tidak ada mekanisme baru; dry-run/run history
  hanya menyimpan count teragregasi, tidak pernah row content, jadi
  tidak ada nilai sensitif untuk diredaksi di sana sejak awal.
- **ABAC/RLS** — pola `authorizeInTransaction` + `withTenant` standar
  (skill `awcms-abac-guard`), tidak ada mekanisme otorisasi baru.

## Verifikasi

- `bun run data-lifecycle:registry:check` — registry valid.
- `bun run security:readiness` — dua check baru
  (`checkDataLifecycleRegistryValid`, `checkDataLifecycleLegalHoldReleaseSeparate`)
  pass.
- Dry-run terhadap Postgres nyata: descriptor manapun, memanggil dua kali
  berturut-turut dengan input sama menghasilkan hasil identik (tidak ada
  mutasi).
- Legal hold aktif: dry-run melaporkan SEMUA baris eligible sebagai
  `held`, `purgeableCount: 0`, bahkan dengan `retentionDaysOverride`
  paling agresif.
- `executionMode: "generic"` descriptor: test volume besar (>batchLimit)
  membuktikan multi-pass benar tanpa duplikasi/lompatan baris, dan
  manifest arsip yang dihasilkan lolos `ArchivePort.verify()`.
