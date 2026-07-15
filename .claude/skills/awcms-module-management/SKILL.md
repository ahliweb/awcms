---
name: awcms-module-management
description: Kelola/konsumsi sistem Module Management AWCMS (registry, komposisi modul build-time untuk aplikasi turunan, manifest kompatibilitas aplikasi turunan, tenant lifecycle enable/disable, settings, permission sync/status, navigation, job registry, health/readiness). Gunakan saat menambah field descriptor baru (permissions/navigation/settings/jobs/health) di modul lain, saat menyelidiki kenapa suatu modul terlihat degraded/orphaned, saat aplikasi turunan perlu menyusun modulnya sendiri lewat `src/modules/application-registry.ts` tanpa mengedit registry base, saat aplikasi turunan perlu memverifikasi kompatibilitasnya dengan rilis base terbaru (`bun run extension:check`), atau saat mengubah perilaku enable/disable/settings/health module_management sendiri. Sesuai src/modules/module-management/README.md, epic #510, epic #738 (Issue #740/ADR-0014, Issue #741/ADR-0015).
---

# AWCMS — Module Management System

Ikuti `src/modules/module-management/README.md` (sumber kebenaran penuh
per issue #511-#521) dan `docs/awcms/10_template_kode_coding_standard.md`
§Module contract. Skill ini merangkum pola yang **tidak jelas dari
sekadar membaca satu file** — dependency graph, urutan sync, semantik
merge settings, dan makna tiap sinyal health.

## Kapan pakai skill ini vs `awcms-new-module`

`awcms-new-module` = cara **scaffold** modul baru (struktur folder,
descriptor minimal). Skill ini = cara kerja **sistem** yang mengelola
modul yang sudah terdaftar — enable/disable per tenant, settings,
permission sync, navigation, jobs, health. Pakai skill ini saat modulmu
sudah ada dan kamu perlu mendeklarasikan `permissions`/`navigation`/
`settings`/`jobs` di descriptornya, atau saat menyelidiki masalah di
sistem module management itu sendiri.

## "Sync first" — aturan FK yang wajib dipahami

`awcms_tenant_modules`, `_module_settings`, `_module_health_checks`
semua punya FK ke `awcms_modules.module_key`. Mendaftarkan modul di
`src/modules/index.ts` **tidak otomatis** membuat baris registrynya.
Setiap mutasi tenant-scoped yang butuh baris registry ada
(`enableTenantModule`/`disableTenantModule`/`updateModuleSettings`/
`runModuleHealthCheck`) memanggil `syncModuleDescriptors(tx)` sendiri di
awal — **jangan** asumsikan operator sudah menjalankan
`POST /api/v1/modules/sync` manual lebih dulu. Bila menambah mutasi baru
dengan FK serupa, ikuti pola yang sama.

Konsekuensi: `GET /api/v1/modules/{moduleKey}/health`'s sinyal
`db_registry_synced` bisa `fail` di instance yang baru dimigrasikan
(belum pernah ada mutasi tenant-scoped apa pun) — ini **bukan bug**,
laporan yang jujur. `POST .../health/check` men-sync duluan sebagai efek
samping menulis riwayat, jadi bisa menunjukkan hasil `pass` untuk sinyal
yang sama di momen yang sama — asimetri yang disengaja, didokumentasikan
di README modul.

## Dependency graph (enable/disable)

Graph **selalu** dibaca dari `listModules()` (code), **tidak pernah**
dari `awcms_module_dependencies` (cache hasil sync terakhir — bisa
basi). Kode error dari `domain/tenant-module-lifecycle.ts`:

| Kode                                 | Kapan                                                |
| ------------------------------------ | ---------------------------------------------------- |
| `MODULE_NOT_FOUND`                   | Key tidak terdaftar / dinonaktifkan global (code)    |
| `MODULE_ALREADY_ENABLED`/`_DISABLED` | Tidak ada perubahan state                            |
| `MODULE_DEPENDENCY_MISSING`          | Dependency tidak terdaftar sama sekali               |
| `MODULE_DEPENDENCY_DISABLED`         | Dependency nonaktif (global atau tenant ini)         |
| `MODULE_REVERSE_DEPENDENCY_ACTIVE`   | Modul lain yang aktif masih bergantung padanya       |
| `MODULE_DEPENDENCY_CYCLE`            | Circular dependency di graph                         |
| `MODULE_VERSION_INCOMPATIBLE`        | `minAppVersion` modul > versi app saat ini           |
| `CORE_MODULE_CANNOT_BE_DISABLED`     | `isCore: true` — tidak bisa dinonaktifkan, bukan bug |

Modul `isCore: true` (saat ini hanya `module_management` sendiri) tidak
bisa dinonaktifkan — ini pencegah _admin lockout_ utama: kemampuan
mengelola modul lain tidak pernah hilang.

### Registry-wide DAG validator (Issue #680, epic #679) — beda dari `hasDependencyCycle`

`hasDependencyCycle` di atas hanya pernah dipanggil untuk SATU modul (yang
sedang dicoba di-enable, `evaluateModuleEnable` — lihat `tenant-module-lifecycle.ts:138`)
— tidak pernah dipakai untuk memeriksa "apakah SELURUH registry sudah
DAG yang valid". Celah inilah yang membuat `tenant_admin`/
`profile_identity`/`identity_access` sempat punya cycle 3-node nyata di
`dependencies` masing-masing (`tenant_admin -> profile_identity ->
tenant_admin`, dst) selama registry-nya tidak pernah diiterasi
menyeluruh — padahal `hasDependencyCycle` SUDAH akan menolaknya kalau
ada yang mencoba meng-enable salah satu dari ketiganya lewat jalur
normal.

`domain/module-dependency-graph.ts`'s `validateModuleDependencyGraph(listModules())`
adalah pemeriksaan menyeluruh itu — mendeteksi EMPAT masalah berbeda
sekaligus (tidak berhenti di yang pertama): `self_dependency`,
`duplicate_dependency`, `missing_dependency`, dan `cycle`
(langsung/tidak langsung, algoritma Kahn menyeluruh, bukan DFS
satu-titik). Dipanggil dari:

- `bun run modules:dag:check` (`scripts/validate-module-graph.ts`) —
  disisipkan ke `bun run check` tepat setelah `api:spec:check`.
- `bun run modules:sync` (`scripts/modules-sync.ts`) — menolak sync ke DB
  bila graph rusak, SEBELUM baris apa pun tersentuh. Sejak Issue #697 (epic
  #679), script ini dibangun di atas shared worker runner
  `src/lib/jobs/job-runner.ts` (advisory lock, `--dry-run` via
  `planModuleSync`, JSON telemetry) — lihat
  `docs/awcms/deployment-profiles.md` §Shared worker runner; perilaku
  `syncModuleDescriptors` sendiri TIDAK berubah.

**Fix nyata untuk cycle historis** (Issue #680): `tenant_admin.dependencies`
diubah dari `["profile_identity", "identity_access"]` menjadi `[]` —
`profile_identity`/`identity_access`'s array masing-masing SUDAH benar
sejak awal (`profile_identity: ["tenant_admin"]`,
`identity_access: ["tenant_admin", "profile_identity"]`); satu-satunya
edge yang salah arah adalah `tenant_admin` balik menunjuk keduanya.
Alasan historis edge itu ada: `tenant_admin`'s one-time setup wizard
(`POST /api/v1/setup/initialize`) menulis baris ke tabel
`profile_identity`/`identity_access` DALAM transaksi yang sama — itu
kebutuhan **saat-dipanggil** (call-time), bukan "tenant_admin tidak bisa
berfungsi sama sekali tanpa keduanya" (static dependency yang salah).
Orkestrasi itu sekarang jadi fungsi composition-root eksplisit,
`application/platform-bootstrap.ts`'s `bootstrapPlatformTenant`, dipanggil
langsung oleh route handler — bukan lewat `dependencies` array. Jangan
kembalikan pola lama ini kalau butuh orkestrasi lintas-modul serupa di
masa depan — buat composition-root function baru, jangan tambah edge
`dependencies` untuk menjustifikasi urutan panggilan satu-kali.

`resolveProtectedModuleKeys`'s (module-presets.ts) hasil closure untuk
`module_management` — `{module_management, tenant_admin, identity_access,
profile_identity}` — TIDAK berubah meski edge tenant_admin dihapus,
karena closure dihitung lewat `identity_access -> profile_identity ->
tenant_admin` (masih transitif sama), bukan lewat edge tenant_admin yang
dihapus. Verifikasi ini lewat test yang sudah ada
(`tests/unit/module-presets.test.ts`'s "real registry's protected set is
exactly module_management's own dependency closure").

### `capabilities` — hubungan source-level, BEDA dari `dependencies` (Issue #681, epic #679)

`ModuleDescriptor` punya field opsional baru, `capabilities?:
{provides?: string[]; consumes?: {capability, providedBy, optional?}[]}`
(`_shared/module-contract.ts`). Ini BUKAN bagian dari dependency-graph
lifecycle di atas — `dependencies` tetap satu-satunya field yang dibaca
`hasDependencyCycle`/`validateModuleDependencyGraph`/`evaluateModuleEnable`/
`evaluateModuleDisable`. `capabilities` murni mendokumentasikan hubungan
IMPORT SOURCE-LEVEL lewat pola ports-and-adapters (`_shared/ports/*.ts`)
— lihat ADR-0011 dan skill `awcms-news-portal`'s §681 untuk contoh
nyata (`blog_content`/`news_portal`). Modul yang butuh kapabilitas dari
modul lain TIDAK PERNAH meng-import `application`/`domain` modul itu
langsung — hanya port interface (`_shared/ports/`) di layer
`application`/`domain`, dengan adapter konkret disuntikkan pemanggil
(route handler = composition root). `optional: true` di `consumes`
berarti fitur pemanggil degradasi aman (bukan error) kalau kapabilitas
itu resolve ke "tidak berlaku" untuk suatu tenant — bukan berarti kode
bisa jalan tanpa modul lain ter-compile (ini monolith, semua source
selalu ikut ter-bundle).

**Dua varian composition-root sudah ada di repo ini — pilih sesuai
taruhan keamanan fitur, bukan template tunggal.** Varian #1
(`blog_content` konsumsi `NewsMediaPort` dari `news_portal`, Issue #681):
route handler SELALU inject adapter konkret, TANPA cek enable/disable
tenant di call site — port itu sendiri yang didesain fail-closed/no-op
aman untuk setiap kasus "tidak berlaku". Varian #2 (`identity_access`
konsumsi `BusinessScopeHierarchyPort` dari `organization_structure`,
Issue #746/#749/#786): composition root (`POST /api/v1/identity/
business-scope/assignments`'s `buildHierarchyPort`) SECARA EKSPLISIT
memanggil `resolveModuleEnabled(tx, tenantId, "organization_structure")`
lebih dulu — hanya mencoba adapter nyata modul itu saat aktif untuk
tenant tsb, jatuh ke adapter default modul pengonsumsi kalau tidak. Pilih
varian #2 (gate eksplisit) ketika kapabilitas yang dikonsumsi menentukan
keputusan otorisasi/keamanan (di sini: apakah sebuah scope reference
valid sebelum SoD dievaluasi) — men-degradasi "aman" secara implisit
lewat port semata (varian #1) berisiko diam-diam mengonsultasikan data
milik modul yang justru sudah dinonaktifkan tenant. Kedua varian tetap
sama-sama TIDAK PERNAH meng-import `application`/`domain` modul lain
langsung dari modul pengonsumsi — hanya lewat port + composition root,
lihat `identity-access/README.md` dan `organization-structure/README.md`
§`BusinessScopeHierarchyPort` untuk detail varian #2, dan
`tests/integration/business-scope-organization-structure-wiring.
integration.test.ts` untuk buktinya end-to-end.

## Baca status tenant-enabled: plural vs singular

`fetchTenantModuleEntries(tx, tenantId)` (semua modul terdaftar) vs
`fetchTenantModuleEntry(tx, tenantId, moduleKey)` (satu modul,
`SELECT`-nya di-filter `module_key` langsung, bukan filter di memori).
Pakai yang **singular** kalau consumer-mu cuma butuh status satu modul
spesifik (terutama di gate publik/anonim — narrower read surface untuk
kode yang tidak authenticated), seperti `blog-content`'s
`public-news-tenant-resolution.ts`. Pakai yang **plural** kalau memang
butuh daftar lengkap (endpoint `GET /api/v1/tenant/modules`, tenant module
presets, tenant-module matrix UI). Keduanya punya semantik
opt-out-by-default yang sama (tidak ada row `awcms_tenant_modules`
→ `tenantEnabled: true`). Detail lengkap:
`module-management/README.md` §Tenant module lifecycle, skill
`awcms-tenant-domain-routing` §Belum ada (Sudah diperbaiki).

## Tenant module presets (Issue #565, epic #555)

`domain/module-presets.ts` + `application/module-presets.ts`
(`applyModulePreset`) — set state modul tenant sekaligus ke sebuah
"profil" (`online_website`, `news_portal`, `saas_online`, `pos_lan`,
`minimal`), 100% reuse `evaluateModuleEnable`/`evaluateModuleDisable`/
`enableTenantModule`/`disableTenantModule` di atas — **tidak pernah**
menulis `awcms_tenant_modules` langsung. Preset menerapkan enable
DAN disable (bukan cuma enable) — modul yang tidak ada di daftar preset
dan bukan "protected" (`isCore` + closure transitif dependency-nya,
dihitung dinamis lewat `resolveProtectedModuleKeys`) akan di-disable,
leaves-first, skip (bukan force) untuk modul yang masih dibutuhkan modul
lain yang tetap enabled. Idempotent (re-apply = plan kosong). **Baru
service layer** — belum ada endpoint API/UI (scope Issue #566). Detail
lengkap: `module-management/README.md` §Tenant module presets, skill
`awcms-tenant-domain-routing` §Tenant module presets (Issue #565).

## Settings — merge dangkal, bukan replace

`PATCH .../settings` men-**merge dangkal** body ke `tenantOverride` yang
ada (`{ ...before, ...patch }`) — key yang tidak disebut tetap tidak
berubah. Berbeda dari `PATCH /api/v1/settings`'s `featureFlags` (replace
utuh field itu) karena di sini seluruh body request **adalah** resource
settings-nya, bukan satu field bernama di resource lain. Key yang
menyerupai secret (daftar sama `_shared/redaction.ts`'s `REDACTION_KEYS`,
termasuk `credential`) **ditolak saat request** (`400
SETTINGS_SENSITIVE_KEY_REJECTED`), tidak pernah disimpan lalu di-redact
saat dibaca. **Value** berbentuk credential juga ditolak walau key-nya
tidak mencurigakan (`_shared/redaction.ts`'s `findSecretShapedValues` —
JWT, blok PEM private key, AWS access key id, header `Bearer`/`Basic`
mentah, connection string ber-`user:pass@`; sengaja konservatif supaya
label/URL/flag biasa tidak pernah salah tertolak) — `400
SETTINGS_SECRET_SHAPED_VALUE_REJECTED`, pesan error hanya menyebut path
key, tidak pernah value-nya. Berlaku otomatis untuk semua modul yang
pakai `validateModuleSettingsPatch`, tanpa perlu ubah route/modul
masing-masing.

## Permission sync status — jangan auto-fix `orphaned`

`GET /api/v1/modules/{moduleKey}/permissions` (Issue #517) melaporkan
`synced`/`missing`/`orphaned`/`mismatched_description` — **read-only**,
tidak pernah menulis ke `awcms_permissions`. **17 modul** (dari 23)
sudah mendeklarasikan `permissions` di descriptornya — `module_management`,
`blog_content` (sejak Issue #543, 39-entry array), `idn_admin_regions`,
`news_portal`, `social_publishing`, `tenant_domain`, `visitor_analytics`,
`profile_identity`, `reporting`, `workflow_approval`, plus 7 modul
platform-evolution epic #738: `data_exchange`, `data_lifecycle`,
`document_infrastructure`, `domain_event_runtime`, `integration_hub`,
`organization_structure`, `reference_data`. **6 modul** lain (email,
form-drafts, identity-access, logging, sync-storage, tenant-admin) punya
permission seed nyata (dari migration masing-masing) tapi belum
ditambahkan ke descriptor — jadi permission mereka **legitimately** muncul
`orphaned` hari ini, bukan insiden. Jangan hapus baris `awcms_permissions`
berdasarkan laporan ini tanpa keputusan admin eksplisit.

## Health check — GET pasif, POST eksplisit

`GET .../health` = sinyal generik murah saja (registry synced, migrasi
diterapkan, permission/jobs/OpenAPI/AsyncAPI terdokumentasi, settings
valid) — **tidak pernah** memanggil provider eksternal, aman dipanggil
berulang. `POST .../health/check` = sinyal sama **plus** live check ke
provider bila modul punya satu (`email` saat ini, lewat
`resolveEmailProvider().healthCheck()` yang sudah timeout-bounded sejak
Issue #495) — dan menulis riwayat ke `awcms_module_health_checks`.
Menambah provider check baru untuk modul lain: ikuti pola yang sama
(hanya di `POST`, bounded/non-throwing, `detail` selalu string generik
tetap — tidak pernah pesan error mentah).

## Job registry — dokumentasi murni

`ModuleDescriptor.jobs` **tidak pernah** jadi permukaan eksekusi command
dari web — hanya metadata (`command`, `purpose`, `recommendedSchedule`,
`environmentNotes`, `safeInOfflineLan`). Jangan tambah endpoint yang
menjalankan command dari sini; bila eksekusi job dari UI benar-benar
dibutuhkan suatu saat, itu harus fitur terpisah yang dibatasi ketat
(security note eksplisit epic #510).

## Verifikasi

`tests/module-management-*.test.ts` (domain, unit, per Issue) dan
`tests/integration/module-*.integration.test.ts` (API+RLS+audit
end-to-end, real Postgres) — jalankan `bun test` dengan `DATABASE_URL`
sebelum PR yang menyentuh sistem ini dianggap selesai (`bun run check`
tanpa `DATABASE_URL` **melewatkan** semua test integration secara diam-diam).

## Skill terkait

`awcms-new-module` (scaffold modul baru, termasuk field descriptor
ini), `awcms-abac-guard` (guard bersama yang juga menegakkan
`403 MODULE_DISABLED`), `awcms-sensitive-data`/redaction
(`REDACTION_KEYS` yang dipakai validasi settings), `awcms-audit-log`
(pola audit `tenant_module_enabled`/`_disabled`/`settings_updated`/`health_checked`).

## Kebijakan admission modul (Issue #696)

`docs/awcms/21_module_admission_governance.md` mendefinisikan
kategori modul (Core/System/Official Optional Module/Derived Application/
External Integration), kriteria admission, aturan dependency required vs
optional (§5, melengkapi `capabilities` di atas), ekspektasi kompatibilitas
offline/LAN vs full-online-only, dan pemetaan 23 modul terdaftar saat ini
(`src/modules/index.ts`'s `baseModules`, termasuk 7 modul platform-evolution
epic #738: data_lifecycle, domain_event_runtime, organization_structure,
document_infrastructure, data_exchange, integration_hub, reference_data)
ke kategori tersebut (termasuk catatan remediasi field `type`/`isCore`/
`maintainers` yang belum konsisten diisi — lihat doc 21 §8). Baca dokumen
itu sebelum mengusulkan modul baru atau mengubah kategori/status lifecycle
modul yang sudah ada.

## Komposisi modul build-time untuk aplikasi turunan (Issue #740, ADR-0014)

Pertanyaan BERBEDA dari admission (§ di atas, yang mengatur "modul apa
boleh masuk registry BASE ini"): bagaimana REPO TURUNAN (di luar repo ini)
menyusun modul aplikasinya sendiri ke registry final tanpa mengedit
`src/modules/index.ts`. Jawabannya `src/modules/module-management/domain/
module-composition.ts` — `mergeModuleRegistries()` (concatenation murni,
selalu sukses, dipanggil `src/modules/index.ts`) + `composeModuleRegistry()`/
`validateComposedModuleRegistry()` (mesin validasi, dipanggil eksplisit
oleh `bun run modules:compose:check`, tidak pernah oleh `index.ts` sendiri
— pola yang identik dengan `validateModuleDependencyGraph`/`modules:dag:check`
di atas, sengaja dipakai ulang bukan diduplikasi).

- **Titik ekstensi tunggal**: `src/modules/application-registry.ts`. Repo
  base ini mengirim `applicationModuleRegistry: undefined`; repo turunan
  mengganti nilai itu dengan `ApplicationModuleRegistry` miliknya sendiri
  (`{ id, modules, migrationNamespace? }`). Tidak ada file lain yang perlu
  diedit — `src/modules/index.ts` dan setiap `module.ts` base tetap
  utuh.
- **`listModules()` sekarang compose-aware** — mengembalikan hasil merge
  base + `applicationModuleRegistry`. Di repo base ini nilainya SELALU
  sama seperti sebelum Issue #740 (registry base 23 modul, byte-identical)
  karena `applicationModuleRegistry` selalu `undefined` di sini. Konsumen
  yang sudah ada (`modules:sync`, `modules:dag:check`,
  `repo:inventory:generate`, semua service module-management) TIDAK perlu
  diubah — semuanya sudah memanggil `listModules()`.
- **13 jenis issue komposisi** (empat dipakai ulang dari
  `validateModuleDependencyGraph` + sembilan baru: `duplicate_module_key`,
  `prohibited_base_override`, `invalid_module_type`,
  `capability_provider_conflict`, `capability_provider_missing`,
  `migration_namespace_overlap`, `deployment_profile_incompatible`,
  `navigation_path_conflict`, `invalid_job_descriptor`) — detail lengkap
  di `module-composition.ts`'s file header dan ADR-0014 §3. Setiap
  application module yang key-nya bentrok dengan modul BASE mana pun
  (bukan cuma Core/System — `type` tidak konsisten diisi, doc 21 §8 R1)
  ditolak (`prohibited_base_override`), tidak pernah "menang" menimpa
  base.
- **Namespace migration**: base mereservasi `1-899`
  (`BASE_MODULE_MIGRATION_NAMESPACE`); `ApplicationModuleRegistry.
migrationNamespace` (opsional) mendeklarasikan range milik repo turunan
  sendiri (rekomendasi: mulai `900`) — komposisi menolak bila beririsan.
  Perbandingan data yang dideklarasikan saja, tidak membaca `sql/*.sql`
  nyata (fungsi domain tetap tanpa I/O).
- **`bun run modules:composition:inventory:generate`/`:check`** —
  snapshot JSON deterministik registry gabungan
  (`docs/awcms/module-composition-inventory.json`) untuk bukti
  CI/rilis, wired ke `bun run check`.
- **Fixture referensi**: `tests/fixtures/derived-application-example/`
  (dua modul minimal, `bun test tests/unit/module-composition-fixture.test.ts`)
  — contoh nyata yang bisa dijalankan, bukan sekadar dokumentasi naratif.

Detail keputusan lengkap: `docs/adr/0014-deterministic-build-time-module-
composition.md`. Panduan penggunaan dari sisi aplikasi turunan:
`docs/awcms/derived-application-guide.md` §langkah 2.

## Manifest kompatibilitas aplikasi turunan (Issue #741, ADR-0015)

Pertanyaan BERBEDA lagi dari komposisi (§ di atas, yang membuktikan
registry TypeScript Anda valid HARI INI): apakah aplikasi turunan Anda
TETAP kompatibel begitu base ini merilis versi baru. Jawabannya
`src/modules/module-management/domain/extension-compatibility.ts` +
`bun run extension:check` (`scripts/extension-check.ts`) — dua lapisan
digabung satu laporan:

1. **`composeModuleRegistry()`** (§ di atas, dipakai ulang APA ADANYA) —
   terhadap registry TypeScript nyata. Selalu jalan, dengan atau tanpa
   manifest.
2. **`evaluateExtensionManifest()`** (baru) — terhadap
   `extension.manifest.json`/`.yaml` yang Anda publikasikan di root repo
   turunan Anda (skema: `src/modules/_shared/extension-manifest-
contract.ts`). Hanya jalan bila file itu ditemukan — **tidak ada** file
   itu di repo base ini sendiri (dengan sengaja), jadi `bun run
extension:check` di sini selalu lulus trivial, sama seperti
   `applicationModuleRegistry === undefined`.

Manifest memvalidasi: range SemVer base yang kompatibel
(`compatibleAwcmsRange`, terhadap `package.json` base nyata), versi
module-contract (`moduleContractVersion`, terhadap
`MODULE_CONTRACT_VERSION` konstanta baru di `_shared/module-contract.ts`),
versi capability yang dikonsumsi/disediakan (`capabilities.requires`/
`.provides`, terhadap `CAPABILITY_CONTRACT_VERSIONS` registry global baru
di `_shared/capability-contract-versions.ts` — capability yang tidak
ditemukan di registry global dicek ulang terhadap `capabilities.provides`
manifest itu SENDIRI, untuk kasus satu modul aplikasi turunan mengonsumsi
capability modul aplikasi turunan lain), immutabilitas+ordering checksum
migration historis (`migrations.historicalChecksums`, checksum dihitung
ulang persis dengan `computeMigrationChecksum`/
`stripOptionalTransactionWrapper` yang sama dipakai `bun run db:migrate`
— **bukan** `discoverMigrationFiles`'s sendiri, yang naming pattern-nya
hardcode `_awcms_`), profil deployment wajib
(`deployment.requiredProfiles` vs `contributedModules[].deploymentProfiles`
self-declared), dan staleness versi kontrak OpenAPI/AsyncAPI yang
dikonsumsi (`consumes.openApiContractVersion`/`.asyncApiContractVersion`,
terhadap `info.version` nyata, aturan MAJOR/MINOR ADR-0008).

**Wiring nyata, bukan cuma script berdiri sendiri** (pelajaran eksplisit
dari PR #769/#770's kegagalan wiring pada wave yang sama) — tiga tempat:
`package.json`'s `check` composite, `.github/workflows/ci.yml`'s
`quality` job (langkah bernama eksplisit, bukan diasumsikan otomatis dari
`bun run check`), dan `scripts/production-preflight.ts`'s stage list
(tepat setelah `modules:compose:check`, alasan yang sama persis). `bun
run release:verify`/`release.yml` tercakup otomatis lewat `bun run check`.

Fixture: satu manifest COMPATIBLE
(`tests/fixtures/derived-application-example/extension.manifest.json`) +
delapan manifest INCOMPATIBLE, masing-masing gagal untuk alasan berbeda
(`tests/fixtures/extension-contract-incompatible/`, lihat README di
direktori itu untuk tabel lengkap). Diuji dua lapis:
`tests/unit/extension-compatibility.test.ts` (fungsi murni, setiap issue
type) dan `tests/unit/extension-check-fixtures.test.ts` (men-spawn CLI
SUNGGUHAN sebagai proses child terhadap tiap fixture — bukti pipeline
end-to-end, bukan cuma fungsi validator).

Detail keputusan lengkap: `docs/adr/0015-derived-application-
compatibility-manifest.md`. Panduan penggunaan dari sisi aplikasi
turunan: `docs/awcms/derived-application-guide.md` §langkah 9.
