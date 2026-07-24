# ADR-0037 — Admission `data_lifecycle` (governance retensi + legal-hold) sebagai modul System Foundation

- **Status:** Accepted
- **Tanggal:** 2026-07-24
- **Pengambil keputusan:** @ahliweb
- **Mengadaptasi:** awcms-micro `src/modules/data-lifecycle/` (Issue #745, epic #738 platform-evolution Wave 1; awcms-micro mengadmisinya di bawah ADR-0013 tanpa ADR admisi khusus) ke basis `awcms`, sesuai program penyerapan [ADR-0035](0035-awcms-online-first-erp-saas-superset-repositioning.md) dan peta [`docs/awcms/absorb-awcms-micro-roadmap.md`](../awcms/absorb-awcms-micro-roadmap.md) (Wave 1, port aditif net-baru + re-wire dua konsumen).
- **Terkait:** ADR-0011 (capability ports), ADR-0013 §1/§6 (lapisan ekstensi & "no shared-table write"), ADR-0006 (provider eksternal di luar transaksi), ADR-0031 (SoD), ADR-0034 (template dipakai-langsung; modul hidup langsung di `src/modules/`).

## Konteks

Basis `awcms` sudah punya beberapa job retensi/purge yang di-hand-roll per sumber daya (`logs:audit:purge`, `analytics:purge`), masing-masing menurunkan sendiri semantik retensi, batching, dan jejak audit. Saat makin banyak tabel bervolume tinggi bertumpuk, pola itu tidak skalabel — tiap modul menurunkan ulang pertanyaan governance yang sama (berapa lama menyimpan, apakah arsip sebelum hapus, bagaimana legal-hold berinteraksi dengan purge, cara batch aman) sedikit berbeda-beda.

awcms-micro sudah menyelesaikan ini (Issue #745) dengan modul `data_lifecycle`: **registry yang dikontribusikan modul** (kontrak statis, code-only, tiap modul pemilik mendeklarasikan tabel bervolume tinggi miliknya sendiri) plus **mesin lifecycle yang aman** (dry-run planning, bounded archive/purge, legal holds) yang beroperasi di atas kontrak itu — tidak pernah menyentuh skema modul lain secara langsung.

Selain itu, saat `visitor_analytics` (PR #220) dan `logging` (Issue #146) di-port/dibangun di basis ini, kopling legal-hold mereka **sengaja di-drop** karena `data_lifecycle` belum ada. Header `logging/application/audit-purge.ts` dan deskripsi `visitor_analytics/module.ts` mendokumentasikan kontrak re-add itu secara eksplisit. ADR ini membuat kopling itu nyata kembali.

## Keputusan

### 1. Admisi `data_lifecycle` sebagai modul System Foundation (aditif net-baru)

- Nama: **Data Lifecycle** · `key`: `data_lifecycle`
- Kategori: **System Foundation** (`type: system`) — infrastruktur governance platform yang mekanismenya dipakai bersama tiap tenant, sejajar dengan `logging`/`sync_storage`/`visitor_analytics`, bukan fitur bisnis menghadap-tenant.
- `dependencies`: `["tenant_admin", "identity_access", "logging"]` — DAG tetap asiklik (ketiganya sudah lebih dulu di registry).
- Modul memiliki **HANYA empat tabel policy/execution-state miliknya sendiri** (`awcms_data_lifecycle_legal_holds`/`_cursors`/`_archive_manifests`/`_runs`, migrasi `sql/055`), tidak pernah memiliki tabel bervolume tinggi modul lain (ADR-0013 §6). Deskriptor tabel bervolume tinggi yang dioperasikan mesin ini dideklarasikan oleh `module.ts` masing-masing modul pemilik (field `dataLifecycle`, `_shared/module-contract.ts`), bukan dicermin ke tabel DB.

### 2. Seam kontrak aditif (`MODULE_CONTRACT_VERSION` 2.0.0 → 2.1.0)

Ditambahkan field opsional `ModuleDescriptor.dataLifecycle?: HighVolumeTableDescriptor[]` plus keluarga tipe `HighVolumeTableDescriptor`/`Lifecycle*Policy`/union literals. MINOR murni aditif — tiap `module.ts` yang tidak menyetel `dataLifecycle` tetap valid. Pin manifest keluarga (`awcms-family-compatibility.yaml` `contracts.moduleDescriptorContractVersion`) dinaikkan seiring (gate `family:conformance:check`).

### 3. Gerbang validasi registry + readiness

`domain/lifecycle-registry.ts`'s `validateLifecycleRegistry` (pure, no-DB) memvalidasi tiap deskriptor: `key`/`tableName` unik, `ownerModuleKey` cocok modul pendeklarasi, `scope`/`retentionClass` valid, bound `retentionMin <= default <= retentionMax`, kebijakan partition/archive/deletion/legalHold konsisten (khususnya `legalHold.applicable: true` WAJIB berpasangan `precedence: "overrides_retention"` — tidak bisa dideklarasikan-hilang), minimal satu index (komposit tenant+cursor khusus untuk deskriptor `"generic"`), `batchLimit` waras, dan konsistensi `executionMode`/`existingAdopter`. Digerbangi `bun run data-lifecycle:registry:check` (masuk rantai `check`), dan di-check ulang oleh `security:readiness` (`checkDataLifecycleRegistryValid` + `checkDataLifecycleLegalHoldReleaseSeparate`).

### 4. Legal hold tidak bisa di-bypass diam-diam

`legalHold.applicable` pada deskriptor hanya dokumentasi/panduan — **sengaja TIDAK dikonsultasi** jalur enforcement (`evaluateLegalHoldForDescriptor`). Sebuah RECORD hold (aksi manusia, di-gate izin, di-audit) yang menyasar `key` deskriptor (atau tenant-wide `descriptorKey: null`) selalu berlaku, apa pun yang diklaim metadata deskriptor. Membiarkan `applicable: false` menekan enforcement akan membiarkan modul pemilik diam-diam mematahkan cakupan legal-hold tabelnya sendiri.

Untuk deskriptor `"delegated"` (`logging.audit_events`, `visitor_analytics.visit_events`), mesin `data_lifecycle` **tidak pernah** memutasi tabel — hanya merekam snapshot dry-run. Karena itu **fungsi purge milik modul pemilik itu sendiri** adalah satu-satunya titik enforcement nyata. Enforcement melintasi batas modul lewat **`_shared/ports/legal-hold-guard-port.ts`** (`LegalHoldGuardPort.isDescriptorHeld`) — seam port level-sumber (BUKAN entri capability-registry): tiap fungsi purge menerima port, melewati DELETE-nya bila deskriptor sedang di-hold. Adaptor konkret di-inject di composition root (`scripts/audit-log-purge.ts`, `scripts/visitor-analytics-purge.ts`, `POST /api/v1/analytics/retention/purge`) — tidak pernah di-import langsung dari dalam pohon `application`/`domain` modul konsumen (mencegah import silang siklik, ADR-0011: `data_lifecycle` sudah meng-import `recordAuditEvent` `logging`).

### 5. Default-deny release + SoD maker/checker

`legal_hold.create` dan `legal_hold.release` adalah izin terpisah (peran ber-`create` tidak implisit bisa `release`). `release` adalah `AccessAction` BARU dan diklasifikasikan HIGH-RISK (melepas hold menghapus safeguard perlindungan data). Aturan SoD `data_lifecycle.legal_hold_maker_checker` (severity critical) menegakkan pasangan itu sebagai konflik maker/checker; `exceptionPolicy.requiresApprovalPermission` = `identity_access.business_scope_exceptions.approve` (ada di basis ini, `sql/030`), maxDurationDays 14.

### 6. Archive/purge tidak diekspos lewat HTTP

Eksekusi archive/purge nyata adalah operasi maintenance tak-berpengawas (`bun run data-lifecycle:archive-purge`, worker runner bersama: advisory lock, timeout, batasan pass), bukan aksi pengguna — posture administratif yang sama dengan `bun run logs:audit:purge`. Permukaan HTTP hanya: baca registry, create/release legal hold (Idempotency-Key + audit critical), dry-run read-only (tanpa idempotency, zero-mutation), baca run history.

## Re-wire dua konsumen yang shipped

- **`visitor_analytics`** (PR #220): descriptor `dataLifecycle` (`visitor_analytics.visit_events`, delegated) + const `VISITOR_ANALYTICS_VISIT_EVENTS_LIFECYCLE_KEY` DIKEMBALIKAN; `purgeVisitorAnalyticsData` menerima param ke-5 `legalHoldGuard` dan menggerbangi HANYA DELETE step-1 `awcms_visit_events` (step 2-4 tetap tak-tergerbang, persis awcms-micro).
- **`logging`** (Issue #146): descriptor `dataLifecycle` (`logging.audit_events`, delegated) + const `LOGGING_AUDIT_EVENTS_LIFECYCLE_KEY` DITAMBAHKAN; `purgeExpiredAuditEvents` menerima param `legalHoldGuard` **WAJIB** (bukan opsional — sesuai instruksi header berkas itu sendiri) dan menggerbangi DELETE audit-events.

Konsumen `form_drafts`/`newsletter`/`comments` (belum di-port ke basis ini) DITUNDA.

## Konsekuensi

- Positif: satu mesin governance retensi yang teruji, legal-hold yang tidak bisa di-bypass, jejak audit purge terjaga, registry tervalidasi CI; kopling legal-hold `visitor_analytics`/`logging` kembali utuh end-to-end.
- Biaya: satu env var baru `DATA_LIFECYCLE_ARCHIVE_ROOT_PATH` (doc 18); `MODULE_CONTRACT_VERSION` naik minor; `AccessAction` bertambah `release`.
- Keterbatasan (lihat `src/modules/data-lifecycle/README.md`): hanya jalur `scope: "tenant"` yang diimplementasi end-to-end; adaptor arsip `external_object_storage` belum ada (hanya `local_offline`); tanpa admin UI khusus; partitioning hanya panduan.

## Alternatif yang ditolak

- **Membangun mesin lifecycle kedua di samping job purge yang ada** — menduplikasi semantik retensi/legal-hold, dua sumber kebenaran. Ditolak; registry dikontribusikan modul + mesin generik adalah keputusan awcms-micro yang teruji.
- **Menjadikan `LegalHoldGuardPort` capability-registry entry** (`capability-contract-versions.ts`) — berlebihan untuk seam satu-metode yang di-wire di composition root; awcms-micro pun memakainya sebagai port level-sumber biasa. Ditolak.
- **Mem-port param `legalHoldGuard` sebagai opsional di `logging`** — gerbang yang bisa dilewati diam-diam lebih berbahaya daripada absen jujur; header berkas menuntut WAJIB. Ditolak.
