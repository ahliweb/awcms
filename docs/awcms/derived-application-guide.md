# Panduan Implementasi Aplikasi Turunan

> **Dokumen base (bukan contoh domain).** Dokumen ini menjelaskan cara membangun aplikasi turunan **di atas** AWCMS setelah base generik selesai (v0.23.5, seluruh 18 issue backlog doc06 + peningkatan pasca-backlog M9 tuntas — lihat [`README.md`](README.md) §Langkah berikutnya dan [`AGENTS.md`](../../AGENTS.md) §Mulai dari sini). Lima contoh aplikasi di §Contoh aplikasi turunan adalah **ilustrasi**, bukan modul yang ditambahkan ke base ini.
>
> **Lapisan ekstensi (epic #738).** Semua aplikasi turunan di dokumen ini hidup di lapisan **Derived Application** — satu dari tiga lapisan "di luar base" (Derived Application generik, SaaS Control Plane, ERP Extension) yang didefinisikan `docs/adr/0013-extension-layers-and-boundary-model.md`. ADR itu juga mendefinisikan batas tenant vs legal entity vs organization unit, dan aturan "no shared-table write" untuk kolaborasi lintas-repo — baca sebelum aplikasi turunan Anda perlu berbagi data dengan repo turunan lain (mis. sebuah SaaS billing control-plane yang menagih tenant yang sama).
>
> **Komposisi modul build-time (Issue #178, ADR-0025 — mengimplementasikan ADR-0014).** Sejak Issue #178, aplikasi turunan **tidak lagi perlu mengedit `src/modules/index.ts`** untuk mendaftarkan modul domainnya. Ganti nilai `undefined` di `src/modules/application-registry.ts` milik repo turunan Anda dengan `ApplicationModuleRegistry` sendiri (`{ id, modules, migrationNamespace? }`, tipe di `_shared/module-contract.ts`) — satu-satunya file yang perlu diedit; `src/modules/index.ts` base tidak pernah disentuh. `composeModuleRegistry()` (`module-management/domain/module-composition.ts`) menggabungkan registry base + registry Anda dan memvalidasi key ganda/override key base/dependency DAG/capability binding/migration-namespace/deployment-profile/navigation/job sebelum build dianggap sah. Tiga gate menegakkannya di `bun run check` dan CI: `bun run modules:compose:check` (validasi komposisi), `bun run modules:composition:inventory:check` (inventory `docs/awcms/module-composition-inventory.json` deterministik, regenerate lewat `bun run modules:composition:inventory:generate`), dan `bun run extension:check` (kesehatan extension seam). Lihat `docs/adr/0025-implement-deterministic-build-time-module-composition.md` (mengimplementasikan `docs/adr/0014-deterministic-build-time-module-composition.md`) untuk keputusan lengkap dan `tests/fixtures/derived-application-example/` untuk contoh nyata yang bisa langsung dijalankan (`bun test tests/module-composition-fixture.test.ts`).
>
> **Manifest kompatibilitas (Issue #183, ADR-0015 — RENCANA, belum diimplementasikan).** Komposisi modul (di atas) membuktikan registry Anda VALID hari ini — bukan bahwa dia TETAP kompatibel begitu base ini merilis versi baru. Untuk itu direncanakan sebuah `extension.manifest.json` (range SemVer base yang kompatibel, versi module-contract/capability, namespace+checksum historis migration, profil deployment, dan versi kontrak OpenAPI/AsyncAPI) yang divalidasi oleh gate `extension:check` — didesain di `docs/adr/0015-derived-application-compatibility-manifest.md` dan dijadwalkan pada **Issue #183** (epic #177 Wave 1), belum ada di repo ini. **Status saat ini (Issue #178):** `bun run extension:check` (`scripts/extension-check.ts`) memvalidasi **extension seam** saja — bahwa registry efektif (base + `application-registry.ts`) tersusun valid dan, dalam mode base, identik dengan registry base. Ketika #183 mendarat, gate/perintah yang sama diperluas menambahkan validasi manifest tanpa mengubah seam yang ditetapkan #178.

## Base reusable vs domain-specific extension

Sebelum menulis kode apa pun, pahami batasnya: base menyediakan infrastruktur dan kontrak yang **dipakai ulang tanpa diubah**; aplikasi turunan hanya menambah **modul domain baru** di atasnya.

| Reusable (base — jangan diubah)                                                                                            | Domain-specific (aplikasi turunan — Anda tambahkan)                                |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Modular monolith + module contract (`src/modules/_shared/module-contract.ts`, doc 10/11)                                   | Modul domain baru di `src/modules/<domain>/`                                       |
| RBAC + ABAC default-deny + RLS (ADR-0003/0004, `src/modules/identity-access/`)                                             | Permission/role/policy spesifik domain (doc 17 pola, bukan isinya)                 |
| Migration runner checksum-based, konvensi `NNN_awcms_<area>_<desc>.sql`                                                    | Skema tabel domain (skill `awcms-new-migration`)                                   |
| Kontrak OpenAPI/AsyncAPI wajib + `api:spec:check` (ADR-0007/0008)                                                          | Endpoint/event domain (skill `awcms-new-endpoint`/`awcms-new-event`)               |
| Soft delete + immutability posted (ADR-0005)                                                                               | Kebijakan resource domain mana yang boleh restore/purge                            |
| Audit trail generik (`awcms_audit_events`) + retensi/purge + correlation ID (Issue 10.1/#447, skill `awcms-observability`) | Aksi high-risk spesifik domain yang wajib diaudit (skill `awcms-audit-log`)        |
| Idempotency ledger generik (`awcms_idempotency_keys`)                                                                      | Mutation high-risk domain mana yang wajib `Idempotency-Key`                        |
| Server-side form draft persistence generik (`awcms_form_drafts`, `/api/v1/form-drafts`, Issue #484)                        | Apa isi `payload` draft dan `moduleKey`/`wizardKey`/`resourceType` spesifik domain |
| Structured logger + extension point (`setLogSink`/`setAuditExportHook`)                                                    | Consumer log/audit nyata (SIEM, alerting) — base hanya sediakan titik pasang       |
| Design system, token, state pattern, i18n (doc 14, skill `awcms-i18n`)                                                     | Layar admin/operator/portal domain (skill `awcms-ui-screen`)                       |
| Offline-first sync (outbox/inbox, HMAC, conflict tracking, object queue dispatcher — Issue 6.1-6.3/#436)                   | Payload event domain yang disinkronkan lewat outbox yang sama                      |
| Connection pooling + work-class backpressure + circuit breaker (Issue 10.2, per-provider sejak #436)                       | Provider eksternal domain (WA/email/AI/pajak) di belakang flag + outbox            |
| Production readiness tooling (`db:pool:health`, `security:readiness`, `production:preflight`)                              | Item checklist domain tambahan (mis. tax data masking untuk aplikasi pajak)        |
| Skill proyek `.claude/skills/`                                                                                             | —                                                                                  |

Prinsip: **pertahankan** kolom kiri apa adanya; **tambahkan** kolom kanan mengikuti pola yang sudah mapan. Jangan menulis ulang RLS/ABAC/audit/idempotency Anda sendiri — base sudah menyediakannya, cukup dipakai.

## Alur membangun aplikasi turunan (9 langkah)

Setiap langkah dipetakan ke skill nyata (`.claude/skills/`) — panggil skill itu, jangan menebak polanya sendiri.

1. **Definisikan PRD/SRS domain** — pola doc 02/03 (isi generik-nya sudah base; entitas retail/POS di dalamnya adalah contoh AWPOS, ganti dengan domain Anda). Tentukan entitas, aktor, dan alur bisnis inti.
2. **Scaffold modul domain** — `src/modules/<domain-key>/` dengan struktur `domain/application/infrastructure/api` + `module.ts` + `README.md`. Skill: `awcms-new-module`. Modul baru mulai `version: "0.1.0"`, `status: "experimental"` (ADR-0008) — naik ke `active`/`1.0.0` setelah matang (lihat §Definisi "matang" di bawah). **Daftarkan modul di `src/modules/application-registry.ts` milik repo turunan Anda sendiri** (Issue #740, ADR-0014) — bukan `src/modules/index.ts` base, yang tetap tidak pernah diedit oleh repo turunan.
3. **Migration PostgreSQL + RLS** — tabel tenant-scoped **wajib** `tenant_id`, `ENABLE`+`FORCE ROW LEVEL SECURITY`, policy `app.current_tenant_id`, index berprefiks `(tenant_id, …)`. Skill: `awcms-new-migration`.
4. **Seed RBAC/ABAC domain** — permission/role/policy baru mengikuti pola doc 17 (bukan menyalin isi ilustratifnya); evaluator ABAC yang sudah ada (`evaluateAccess`, default-deny) dipakai ulang, bukan ditulis ulang. Skill: `awcms-abac-guard`.
5. **Endpoint REST + OpenAPI, domain event + AsyncAPI** — route tipis (auth → tenant context → ABAC guard → validasi → idempotency bila high-risk → service+transaction → response helper standar). Skill: `awcms-new-endpoint` (REST), `awcms-new-event` (event domain). Mutation high-risk wajib `Idempotency-Key` — skill `awcms-idempotency`. **Kontrak OpenAPI dipecah per modul** (Issue #182, ADR-0026): modul domain Anda MEMILIKI fragmentnya sendiri `openapi/modules/<domain>.openapi.yaml` dan menunjuknya lewat `ModuleDescriptor.api.openApiPath` — jangan menambah path/schema ke fragment modul base, jangan mengedit `openapi/awcms-public-api.openapi.yaml` (GENERATED). Fragment turunan tergabung lewat seam `buildBundledDocument({ extraFragmentFiles })` dan ditolak bila menimpa path/schema base. Panduan penuh: [`api-contribution-guide.md`](api-contribution-guide.md).
6. **UI/admin screen** — token desain, 4-state pattern (loading/empty/error/ready), a11y WCAG 2.1 AA, string via katalog `.po` (bukan hardcode). Skill: `awcms-ui-screen` (layar baru), `awcms-i18n` (katalog terjemahan), `awcms-ux-review` (audit layar yang sudah jadi). Untuk input panjang/bertahap (identitas → detail → lampiran → review) — skill `awcms-wizard-form` (reusable wizard pattern, Issue #479).
7. **Audit & observability** — aksi high-risk domain (approve, price change, transaksi posted/cancel, dst.) wajib `recordAuditEvent`. Skill: `awcms-audit-log` (apa yang diaudit), `awcms-observability` (correlation ID otomatis, retensi/purge, extension point bila aplikasi turunan butuh forward ke SIEM eksternal).
8. **Test berlapis + security review** — unit (domain logic murni), integration (endpoint terhadap Postgres nyata), kontrak (`api:spec:check`), keamanan (ABAC default-deny, RLS FORCE, redaksi). Skill: `awcms-testing`, `awcms-security-review` (checklist DoD per modul), `awcms-security-hardening` (audit OWASP/ASVS/ISO bila menjelang audit eksternal/go-live besar).
9. **Deployment & go-live** — `bun run production:preflight` (orkestrasi migrate → api:spec:check → modules:compose:check → extension:check → test → build → db:pool:health → security:readiness; `extension:check` memvalidasi extension seam/komposisi Anda, Issue #178/ADR-0025; validasi manifest kompatibilitas penuh direncanakan Issue #183/ADR-0015). Skill: `awcms-production-preflight`. Pilih & jalankan profil deployment (doc `deployment-profiles.md`): LAN-first (`docker-compose.yml`) atau registry-based (`Dockerfile.production`, Issue #454; panduan Coolify di [`deploy-coolify.md`](deploy-coolify.md), Issue #462) — skill `awcms-deploy`.

Orkestrasi satu unit kerja penuh (baca docs → implementasi → migration/OpenAPI/AsyncAPI/test/docs → laporan): skill `awcms-implement-issue`.

### Kapan modul dianggap "matang" (`active`, ADR-0008)

Modul naik dari `experimental` ke `active` ketika: endpoint/domain logic-nya nyata dipakai (bukan scaffold kosong), RLS+ABAC terpasang dan diuji, test berlapis lulus, dan sudah melalui `awcms-security-review`. Jangan tandai `active` sebelum itu — status ini metadata deskriptif yang dibaca kontributor lain untuk menilai kematangan modul, bukan gerbang runtime.

## Contoh aplikasi turunan (ilustratif — bukan bagian base)

Lima contoh berikut menunjukkan bagaimana base yang sama melayani domain yang sangat berbeda. **Tidak satu pun** dari modul/entitas di bawah ada di `src/modules/` base ini — ini murni ilustrasi untuk membantu Anda memetakan domain Anda sendiri ke pola di atas.

| Aplikasi                                  | Domain                                                 | Modul domain ilustratif (bukan bagian base)             | Contoh entitas tenant-scoped                          |
| ----------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------- | ----------------------------------------------------- |
| **AWPOS** (retail/POS)                    | Penjualan ritel, gudang, pajak, CRM                    | `sales`, `inventory`, `tax-coretax`, `crm`              | Produk, transaksi, stok, pelanggan                    |
| **Satu Sehat Kobar** (internal kesehatan) | Integrasi data kesehatan internal per fasilitas        | `health-records`, `satu-sehat-sync`                     | Rekam kunjungan, faskes, petugas                      |
| **Sistem Manajemen Mutu Faskes**          | Audit mutu, insiden, akreditasi                        | `quality-audit`, `incident-report`, `accreditation`     | Temuan audit, insiden keselamatan, dokumen akreditasi |
| **Smart School Portal**                   | Akademik, kehadiran, nilai, komunikasi ortu            | `academic`, `attendance`, `grading`, `parent-portal`    | Siswa, kelas, jadwal, nilai                           |
| **Sistem Pengaduan Publik**               | Pengaduan warga, disposisi, tindak lanjut lintas dinas | `complaint-intake`, `disposition`, `follow-up-tracking` | Pengaduan, unit penerima, status tindak lanjut        |

Setiap aplikasi di atas **tetap** memakai identity/login, RBAC/ABAC, RLS, audit trail, i18n, dan admin shell base yang sama — modul domain di atas hanya menambah entitas + endpoint + layar yang spesifik pada domainnya, mengikuti 9 langkah di atas.

## Ekstensi ERP (lapisan terpisah dari Derived Application biasa — Issue #755, ADR-0020)

Bila aplikasi turunan Anda adalah/menggunakan ERP (akuntansi, inventori,
sales/purchase order, payroll, pajak) — bukan hanya "aplikasi domain
biasa" seperti lima contoh di atas — baca dulu
[`erp-extension-contracts.md`](erp-extension-contracts.md) dan
`docs/adr/0020-erp-extension-readiness-contracts.md` sebelum menulis
kode apa pun. Base ini **tidak pernah** menyediakan chart of accounts/
jurnal/ledger/valuasi inventori/AR-AP/payroll/pajak — base hanya
menyediakan **kontrak netral** (referensi transaksi bisnis, envelope
posting request/result, period-lock, item/currency/UoM, inventory
movement, reconciliation) yang ekstensi ERP Anda implementasikan/
konsumsi di repository ANDA sendiri, mengikuti pola build-time
composition yang sama (§Alur di atas): base tetap tidak diedit
registrynya, ekstensi ERP Anda hanya mengisi
`src/modules/application-registry.ts` miliknya sendiri.

`tests/fixtures/derived-application-example/modules/
example-erp-extension/` adalah contoh nyata yang bisa dijalankan
(`bun test tests/unit/erp-extension-contracts.test.ts`) — module
descriptor yang mengonsumsi capability `party_directory`/
`organization_hierarchy_resolution` secara opsional, mesin posting
idempotent+fail-closed-period-lock, dan satu kontribusi `reporting`
projection — semua tanpa satu baris pun logika akuntansi nyata.

## Checklist keamanan & kepatuhan praktis

Wajib dipenuhi modul domain baru sebelum dianggap siap produksi (turunan dari doc 10/12/13, skill `awcms-security-review`):

- [ ] **Tenant context** — setiap query tenant-scoped lewat `withTenant()`/`SET LOCAL app.current_tenant_id`; tidak ada `WHERE tenant_id` yang dilewati manual dari input.
- [ ] **ABAC default-deny** — endpoint non-public dicek `evaluateAccess()`; permission baru diseed eksplisit, tidak ada grant implisit.
- [ ] **RLS** — tabel tenant-scoped baru `ENABLE`+`FORCE ROW LEVEL SECURITY` + policy isolasi; index berprefiks `(tenant_id, …)`.
- [ ] **Audit** — aksi high-risk domain (soft delete/restore/purge, approval, perubahan harga/status kritis, dst.) menghasilkan `awcms_audit_events` row via `recordAuditEvent`.
- [ ] **Idempotency** — mutation high-risk domain menerima `Idempotency-Key`, aman diulang.
- [ ] **Redaksi/masking** — identifier sensitif domain (NIK, nomor rekam medis, dst. — pola sama seperti NPWP/NIK/email di base) di-hash+mask sebelum disimpan/ditampilkan/di-log.
- [ ] **Kontrak sinkron** — `bun run api:spec:check` hijau untuk setiap endpoint/event domain baru.
- [ ] **Test berlapis** — unit (domain logic), integration (Postgres nyata), keamanan (RLS/ABAC dipaksa gagal untuk membuktikan gate benar-benar memblokir, bukan hanya "pass" diam-diam).
- [ ] **`bun run production:preflight`** hijau sebelum go-live.

## Referensi

- [`examples/minimal-domain-module.md`](examples/minimal-domain-module.md)
  — contoh konkret satu modul domain minimal (struktur folder, descriptor,
  migration+RLS, seed permission, endpoint, OpenAPI/AsyncAPI snippet, dan
  checklist test/keamanan) — Issue #463.
- [`derived-app-pilot-plan.md`](derived-app-pilot-plan.md) — rencana
  pilot aplikasi turunan pertama (matriks kandidat, rekomendasi AWPOS,
  boundary modul, initial issue breakdown) — Issue #465.
- [`AGENTS.md`](../../AGENTS.md) §Mulai dari sini — entry point kontributor.
- [`README.md`](README.md) §Langkah berikutnya — ringkasan alur yang sama, versi singkat.
- [`docs/adr/0013-extension-layers-and-boundary-model.md`](../adr/0013-extension-layers-and-boundary-model.md)
  — lapisan ekstensi (Derived Application/SaaS Control Plane/ERP
  Extension), batas tenant vs legal entity vs organization unit,
  data-ownership matrix, dan kriteria evidence-based ekstraksi layanan
  yang berlaku untuk seluruh aplikasi turunan.
- [`docs/adr/0014-deterministic-build-time-module-composition.md`](../adr/0014-deterministic-build-time-module-composition.md)
  dan [`docs/adr/0025-implement-deterministic-build-time-module-composition.md`](../adr/0025-implement-deterministic-build-time-module-composition.md)
  — cara aplikasi turunan mendaftarkan modulnya lewat
  `src/modules/application-registry.ts` tanpa mengedit `src/modules/
index.ts` base, taksonomi kegagalan komposisi, dan konvensi namespace
  migration. ADR-0014 adalah desain (rujukan awcms-mini #740); ADR-0025
  adalah adendum implementasi nyata di awcms (Issue #178) — placement engine
  di `module-management/domain/` dan status extension seam.
- [`docs/adr/0015-derived-application-compatibility-manifest.md`](../adr/0015-derived-application-compatibility-manifest.md)
  — skema `extension.manifest.json`, kebijakan versioning module-contract/
  capability/manifest-schema, immutabilitas checksum migration historis,
  dan di mana `bun run extension:check` benar-benar memblokir CI/preflight.
  **RENCANA — Issue #183** (belum diimplementasikan; `extension:check` di
  Issue #178 baru memvalidasi extension seam/komposisi).
- [`erp-extension-contracts.md`](erp-extension-contracts.md) dan
  [`docs/adr/0020-erp-extension-readiness-contracts.md`](../adr/0020-erp-extension-readiness-contracts.md)
  — kontrak business transaction/posting/period-lock/item/currency/UoM/
  inventory-movement/reconciliation/report-projection untuk ekstensi ERP
  (Issue #755).
- [`extension-compatibility-policy.md`](extension-compatibility-policy.md)
  — kebijakan compatibility/deprecation/support-window lengkap untuk
  keenam skema versioning independen (package, REST, event, module
  contract, capability, manifest schema), termasuk cara breaking capability
  change dikomunikasikan dan panduan memilih `compatibleAwcmsRange`.
- [`21_module_admission_governance.md`](21_module_admission_governance.md)
  — pohon keputusan admission yang menentukan kategori sebuah kemampuan
  baru (Core/System/Official Optional Module/Derived Application/External
  Integration) sebelum kode ditulis.
- [`docs/adr/`](../adr/README.md) — keputusan arsitektural base (ADR-0001 s.d. 0008).
- `docs/awcms/01` s.d. `20` — paket dokumen master (§Peta dokumen di README ini).
- [`deployment-profiles.md`](deployment-profiles.md) — profil deployment (development/staging/production/offline-LAN, LAN-first compose vs registry image).
- `.claude/skills/README.md` — katalog skill lengkap + peta pemakaian.
