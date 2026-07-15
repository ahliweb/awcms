# ADR-0018 — Admission of `data_exchange` as an Official Optional Business Foundation module

- **Status:** Accepted
- **Tanggal:** 2026-07-14
- **Pengambil keputusan:** @ahliweb
- **Terkait:** Issue #752 (epic #738 `platform-evolution`, Wave 3), Issue #739 / ADR-0013 §3 (data_exchange sudah dipre-klasifikasikan sebagai kandidat Official Optional Business Foundation), Issue #742 / domain_event_runtime (outbox/dispatcher generik yang dikonsumsi modul ini sebagai producer event), `docs/awcms/21_module_admission_governance.md`, `docs/awcms/templates/module-proposal-template.md`

## Konteks

ADR-0013 §3 (tabel lapisan ekstensi) sudah mem-pre-klasifikasikan `data_exchange` sebagai kandidat **Official Optional Business Foundation** (lapisan 3, baris "Official Optional Business Foundation") untuk Wave 2/3 epic #738 — bersama `organization_structure` (sudah diadmisi lewat ADR-0016), `reference_data`, dokumen/managed-files generik, dan `case_management`. Issue #752 sendiri secara eksplisit mensyaratkan sebagai acceptance criterion pertama: "Admission decision and ADR confirms module category, ownership, dependencies, and offline support before implementation" — ADR ini memenuhi syarat itu mengikuti preseden ADR-0016 (mengisi `module-proposal-template.md` inline) sebelum baris kode pertama modul ditulis, mengikuti pohon keputusan admission `docs/awcms/21_module_admission_governance.md` §3.

Berbeda dari `organization_structure` (ADR-0016), modul ini tidak memiliki data bisnis domain sendiri yang berdiri sendiri — ia adalah **mekanisme generik** (staging/validasi/preview/commit asinkron idempoten/export/rekonsiliasi) yang modul PEMILIK lain kontribusikan schema/validasi/mapping/commit adapter-nya sendiri. Ini membuatnya secara bentuk mirip `workflow`/`email`/`form_drafts` (modul System yang menyediakan mekanisme generik dikonsumsi modul lain) — namun ADR-0013 §3 sudah secara eksplisit menempatkan `data_exchange` di baris **Official Optional Business Foundation**, bukan System Foundation, karena admin UI-nya (upload/preview/commit/download/history) adalah kapabilitas produk yang langsung dipakai pengguna bisnis (bukan murni infrastruktur latar belakang seperti `logging`/`sync_storage`), dan modul ini **opt-in per tenant** (`awcms_tenant_modules`) — tenant yang tidak butuh import/export massal tidak perlu mengaktifkannya, berbeda dari `workflow`/`email` yang cenderung selalu relevan begitu ada fitur derivatif memakainya. Keputusan ini mengikuti klasifikasi ADR-0013 §3 apa adanya, bukan meninjau ulang.

## Keputusan

Kami memutuskan untuk mengadmisi `data_exchange` sebagai modul baru di registry base ini dengan parameter berikut (mengisi format `module-proposal-template.md` inline):

### 1. Nama & key modul

- Nama: **Data Exchange**
- `key`: `data_exchange`
- Kategori: **Official Optional Module** (= lapisan ADR-0013 "Official Optional Business Foundation")

### 2. Masalah/kebutuhan

Setiap aplikasi turunan berulang kali butuh import/export CSV/JSON yang aman (staging, validasi skema, preview/diff sebelum commit, commit asinkron idempoten, penanganan kegagalan-parsial yang dapat dilanjutkan, manifest/checksum export, dan rekonsiliasi) — mengimplementasikan ini terpisah di tiap modul berisiko request HTTP berjalan lama, partial write, campur-tenant, formula injection (CSV injection), unbounded file parsing, validasi tidak konsisten, dan export yang tidak dapat direkonsiliasi. Base menyediakan mesin staging/validasi/commit generik; setiap modul PEMILIK menyediakan schema/validasi/mapping/commit adapter-nya sendiri lewat sebuah capability port (ADR-0011), bukan lewat akses tabel langsung.

### 3. Mengapa ini bukan modul Derived Application

Lolos pohon keputusan §3 doc 21, node Q3 ("generik untuk SEMUA aplikasi turunan"): staging/validasi/preview/commit/export/rekonsiliasi CSV/JSON adalah kebutuhan struktural yang identik untuk retail (import katalog produk), layanan publik (import data warga), pendidikan (import data siswa), kesehatan, dst. — bukan logika spesifik satu vertikal. Modul ini TIDAK mengimplementasikan skema domain apa pun sendiri (tidak ada "import produk", "import siswa" di sini) — hanya mesin generik + kontrak port; skema nyata selalu didefinisikan modul pemilik. Preseden sama seperti `organization_structure` (ADR-0016) dan `blog_content`/`news_portal` — primitif generik lintas vertikal, bukan ERP.

### 4. Dependency

- **Lifecycle dependency** (`ModuleDescriptor.dependencies`, wajib aktif duluan): `["tenant_admin", "identity_access", "logging", "domain_event_runtime"]`. `tenant_admin`/`identity_access` untuk batas tenant dan `awcms_tenant_users` (aktor `createdBy`/audit), `logging` untuk `recordAuditEvent`, `domain_event_runtime` karena modul ini adalah REAL producer (`appendDomainEvent`, mengimpor konstanta event type dari `domain-event-runtime/domain/event-type-registry.ts`) — pola yang sama persis dengan `workflow_approval` (#747) dan `organization_structure` (#749). Optional (`data_exchange`) depend ke System (`domain_event_runtime`) adalah arah DAG yang diizinkan (ADR-0013 §1: Opt → Sys).
- **Capability dependency** (`ModuleDescriptor.capabilities`, ADR-0011): `data_exchange` **PROVIDES** `data_exchange_staging` — sebuah capability port baru, `DataExchangeAdapterPort` (`_shared/ports/data-exchange-adapter-port.ts`), yang modul PEMILIK masa depan (mis. calon `reference_data`, `case_management`, atau modul domain aplikasi turunan) mengimplementasikan sendiri (`<module>/application/*-data-exchange-adapter.ts`) untuk menyediakan validasi/mapping/commit skema mereka. `data_exchange` **TIDAK** mendaftarkan `capabilities.consumes` apa pun dari modul pemilik mana pun — wiring adapter->descriptor terjadi lewat registry statis, reviewed-source-code milik `data_exchange` sendiri (`infrastructure/exchange-adapter-registry.ts`, pola identik `domain-event-runtime/infrastructure/consumer-registry.ts`), bukan lewat import langsung modul pemilik ke domain/application `data_exchange`.
- Deskriptor exchange itu sendiri (`ExchangeDescriptor`, field baru `ModuleDescriptor.dataExchange` di `_shared/module-contract.ts`, murni metadata statis — tanpa referensi fungsi/import) adalah mekanisme deklaratif modul pemilik mengontribusikan schema/limit/permission-nya, mengikuti pola `HighVolumeTableDescriptor`/`dataLifecycle` (#745) dan `SoDRuleDescriptor`/`sodRules` (#746) persis.

### 5. Kompatibilitas offline/LAN vs full-online-only

- Kelas kompatibilitas: **offline-lan-safe**. Tidak ada provider eksternal yang dilibatkan sama sekali — staging/parse/validate/preview/commit/export seluruhnya operasi database + CPU murni (parser CSV/JSON buatan sendiri, tanpa library eksternal, tanpa panggilan jaringan). Konten file yang di-stage disimpan inline di kolom database (bukan object storage eksternal), sehingga modul ini berfungsi 100% pada profil `offline-lan` tanpa konektivitas internet sama sekali.
- Commit asinkron berjalan lewat worker terjadwal (`bun run data-exchange:worker`, dibangun di atas `src/lib/jobs/job-runner.ts`) — pola operasi yang sama dengan `data-lifecycle:archive-purge`/`domain-events:dispatch`, bukan panggilan HTTP sinkron berjalan lama.

### 6. Provider eksternal

Tidak ada di scope Issue #752. `ArchivePortKind`/`ExportStoragePort`-nya sendiri (lokal/offline saja untuk v1) dideklarasikan forward-compatible untuk adapter object-storage eksternal di masa depan (mengikuti preseden `data_lifecycle`'s `ArchivePort` — "lokal sekarang, eksternal nanti kalau ada kebutuhan nyata"), tapi tidak diimplementasikan di sini.

### 7. Security & data governance

- Data yang disentuh: konten file mentah yang di-stage (bisa berisi field bisnis modul pemilik apa pun — modul ini sendiri tidak tahu semantik field, hanya menyimpan/melewatkannya), nilai baris yang gagal validasi (preview error artifact, wajib permission terpisah untuk nilai mentah tak termask), manifest/checksum export.
- ABAC: default-deny, permission key baru per resource (`data_exchange.descriptors.read`, `.imports.*`, `.preview_errors.read`, `.exports.*`, `.export_downloads.read`, `.reconciliation.read`) — lihat migration permission seed.
- High-risk action yang wajib audit + `Idempotency-Key`: stage-upload (`imports.create`), commit (`imports.post`, aksi paling berisiko — memicu penulisan data nyata ke tabel modul pemilik), trigger export (`exports.create`).
- **Formula injection (CSV injection)**: setiap nilai field yang diawali `=`, `+`, `-`, `@`, TAB, atau CR dinetralkan (diberi prefiks `'`) saat parse-intake SEBELUM disimpan ke `awcms_data_exchange_staged_rows`, dan dinetralkan LAGI (defense-in-depth, idempoten) saat serialisasi export — memastikan setiap output CSV modul ini tidak pernah menjadi vektor eksekusi formula di aplikasi spreadsheet penerima.
- **Unbounded file parsing**: ukuran body dibatasi di layer HTTP (tier `large`, 5 MiB, sebelum parsing apa pun — `readFormBody`/`readTextBody`), DAN parser CSV/JSON buatan sendiri membatasi jumlah baris/field per deskriptor (`maxRowCount`/`maxFieldsPerRow`) dengan abort dini SELAMA parsing (bukan parse-lalu-cek).
- **Cross-tenant**: setiap tabel baru modul ini (`import_batches`, `staged_rows`, `export_jobs`, `reconciliation_reports`, `reference_items`) RLS predicate SELALU dan HANYA `tenant_id`, `ENABLE`+`FORCE ROW LEVEL SECURITY`. Adapter modul pemilik menerima HANYA baris tenant yang sedang diproses (tidak pernah lintas-tenant) — dijamin karena seluruh pipeline commit berjalan di dalam `withTenant`.
- Commit adalah SATU-SATUNYA titik mutasi nyata; preview/validasi TIDAK PERNAH memutasi tabel modul pemilik.

### 8. Ownership

`@ahliweb` (mengikuti `.github/CODEOWNERS`, sama seperti seluruh modul lain — `ModuleDescriptor.maintainers` belum diisi modul manapun per doc 21 §8 R3, tidak diubah di sini).

### 9. Rencana deprecation

Tidak relevan — modul baru, tidak menggantikan modul/fitur lain yang ada.

### 10. Alternatif yang dipertimbangkan

- **Menjadikan `data_exchange` modul System, bukan Official Optional Module** — dipertimbangkan (bentuknya mirip `workflow`/`email`: mekanisme generik dikonsumsi modul lain), tapi ditolak: ADR-0013 §3 sudah secara eksplisit mempre-klasifikasikan modul ini sebagai "Official Optional Business Foundation" di tabelnya, dan admin UI-nya (upload/preview/commit/download/history) adalah kapabilitas produk yang langsung dipakai pengguna bisnis serta opt-in per tenant — kriteria yang sama yang menempatkan `organization_structure` di kategori ini (ADR-0016 §10).
- **Modul pemilik nyata (mis. `organization_structure`) mengimplementasikan adapter port di PR ini** — ditolak untuk scope issue ini: menyentuh modul lain yang sedang dikerjakan paralel oleh agent Wave 3 lain akan melanggar prinsip atomic (AGENTS.md aturan #1) dan berisiko collision langsung. Sebagai gantinya, PR ini mengirim TIGA skenario referensi (create/update/conflict; partial-failure/resume; export/rekonsiliasi) di atas tabel referensi milik `data_exchange` SENDIRI (`awcms_data_exchange_reference_items`) — mengikuti preseden "foundation issue ships zero real business integrations" yang sudah diterima (#642's domain_event_runtime, Issue #742). Wiring adapter modul pemilik nyata adalah follow-up issue terpisah.
- **Menyimpan konten file yang di-stage di object storage eksternal (R2)** — ditolak untuk v1: melanggar syarat offline-lan-safe (ADR-0006) sebagai default, dan `data_exchange` tidak boleh memaksa provider eksternal sebagai hard dependency. Konten disimpan inline di kolom `text` database (dibatasi ukuran sama seperti body HTTP-nya), adapter object-storage eksternal dideklarasikan forward-compatible tapi tidak diimplementasikan.

## Konsekuensi

- **Positif:** Aplikasi turunan mendapat mesin staging/validasi/preview/commit-asinkron-idempoten/export/rekonsiliasi CSV/JSON reusable tanpa membangun ulang penanganan formula-injection/unbounded-parsing/partial-failure-resume masing-masing.
- **Positif:** Kontrak port (`DataExchangeAdapterPort`) dan deskriptor statis (`ExchangeDescriptor`) memberi modul pemilik masa depan jalur admisi yang jelas tanpa `data_exchange` pernah menulis langsung ke tabel modul lain (ADR-0013 §6).
- **Negatif/trade-off:** Modul baru di registry menambah permukaan yang harus lolos `modules:dag:check`/`modules:compose:check`; mitigasi: dependency dideklarasikan minimal, tidak ada capability `consumes` yang bisa menciptakan cycle.
- **Netral:** `docs/awcms/21_module_admission_governance.md` §8 diperbarui menambah baris ke-18 modul terdaftar.
