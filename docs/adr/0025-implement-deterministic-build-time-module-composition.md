# ADR-0025 — Implementasi nyata komposisi modul deterministik saat build-time di awcms (adendum ADR-0014)

- **Status:** Accepted
- **Tanggal:** 2026-07-19
- **Pengambil keputusan:** @ahliweb
- **Terkait:** Issue #178 (epic #177 "Kesiapan fondasi ERP turunan", Wave 1), ADR-0014 (desain, rujukan awcms-mini #740), ADR-0013 (extension boundary), ADR-0011 (capability ports), ADR-0023 (bilingual docs), `docs/awcms/derived-application-guide.md`, `src/modules/_shared/module-dependency-graph.ts`, `src/modules/module-management/domain/job-registry.ts`, `src/modules/module-management/domain/module-composition.ts`, `src/modules/application-registry.ts`, `src/modules/index.ts`

## Konteks

ADR-0014 (accepted, 2026-07-13) sudah mendokumentasikan **desain** komposisi modul deterministik saat build-time, tetapi ditulis mengacu ke tata letak awcms-mini (Issue #740). Sampai Issue #178, awcms belum benar-benar mengimplementasikannya: `src/modules/index.ts` masih berupa array modul base langsung (`modules: ModuleDescriptor[]`) tanpa seam `applicationModuleRegistry` + `mergeModuleRegistries`, `ModuleDescriptor` belum memodelkan `capabilities`/`compatibility.deploymentProfiles`, dan tipe `ApplicationModuleRegistry`/`ModuleMigrationNamespace` belum ada. Beberapa artefak sudah "ahead-of-code": `docs/awcms/derived-application-guide.md`, `scripts/README.md`, dan `src/modules/_shared/capability-contract-versions.ts` merujuk mekanisme ini seolah sudah jadi.

Adendum ini mencatat keputusan **implementasi nyata** di awcms dan merekonsiliasi perbedaan tata letak dengan ADR-0014 (yang tetap valid sebagai dokumen desain). Guardrail ADR-0013 §5/§9 dan doc admission tetap mengikat: registry base adalah satu-satunya sumber modul yang di-review; repo turunan menyumbang modul TANPA mengedit `src/modules/index.ts`; komposisi 100% compile-time TypeScript (tanpa runtime discovery/`eval`/file scanning).

## Keputusan

### 1. Perbedaan tata letak awcms vs awcms-mini: engine di `module-management/domain/`

ADR-0014 §"Alternatif" menolak menaruh mesin validasi di `_shared/` karena akan membalik arah dependency. awcms mempertahankan keputusan yang sama, TAPI dengan alasan tata letak yang spesifik untuk awcms:

- Validator DAG awcms (`validateModuleDependencyGraph`) ada di **`src/modules/_shared/module-dependency-graph.ts`** (berbeda dari mini yang menaruhnya di `module-management/domain/`).
- Validator job (`validateJobDescriptor`) ada di **`src/modules/module-management/domain/job-registry.ts`**.

Mesin komposisi (`module-composition.ts`) memakai ulang KEDUANYA. Menaruhnya di `module-management/domain/module-composition.ts` membuat setiap import mengarah ke bawah panah dependency: import `../../_shared/module-dependency-graph` (modul boleh bergantung pada `_shared`) dan import saudara `./job-registry` (di folder yang sama). Menaruhnya di `_shared/` malah memaksa `_shared/` meng-import dari `module-management/domain/` (`job-registry.ts`) — membalik arah kernel-vs-modul, karena `_shared/module-contract.ts` sengaja tanpa dependency dan setiap modul bergantung PADA `_shared`, bukan sebaliknya. Placement `module-management/domain/` juga cocok dengan path yang sudah dinamai ADR-0014 §1 dan rujukan hantu di `scripts/README.md`.

Catatan: brief tugas Issue #178 sempat menyarankan `_shared/` karena DAG ada di sana — tetapi validator job yang juga dipakai ulang ada di `module-management/domain/`, sehingga folder inilah yang menjaga KEDUA reuse tetap bersih.

### 2. Perluasan aditif `ModuleDescriptor` (`MODULE_CONTRACT_VERSION` 1.1.0 → 1.2.0)

Ditambahkan secara aditif murni (MINOR, tak ada field lama dihapus/diretype):

- `ModuleCapabilityContract` (`provides`/`consumes`) + field opsional `ModuleDescriptor.capabilities` (ADR-0011). Membuat rujukan `capability-contract-versions.ts` yang sebelumnya menggantung jadi koheren.
- `ModuleDeploymentProfile` + `ModuleCompatibilityContract.deploymentProfiles`.
- `ModuleMigrationNamespace` dan `ApplicationModuleRegistry` (`{ id, modules, migrationNamespace? }`).

`ModuleType` **tidak** ditambah nilai `"derived"` (berbeda dari mini): CHECK constraint DB `awcms_modules_module_type_check` (`sql/008`) hanya mengizinkan `base/system/domain/integration`, dan Issue #178 tidak boleh menambah migration. Modul turunan memakai `"domain"`/`"integration"`. `invalid_module_type` tetap menolak `"base"`/`"system"` dari registry aplikasi.

### 3. Dua fase: merge (selalu sukses) vs validate (bisa gagal)

`mergeModuleRegistries(base, application)` adalah concatenation murni (`[...base, ...application.modules]`, urutan dipertahankan) dan satu-satunya hal yang dipanggil `src/modules/index.ts` — `index.ts` tetap data murni, tak pernah melempar saat load. Karena repo base ini mengirim `applicationModuleRegistry = undefined`, `modules` adalah pass-through byte-identik dari `baseModules` (urutan + identitas objek sama) — dibuktikan `tests/module-composition.test.ts` ("listModules() equals listBaseModules()"). `listModules()` tetap mengembalikan satu referensi array module-level yang stabil (dipakai `descriptor-sync.ts`'s `descriptors === listModules()`). Validasi (`validateComposedModuleRegistry`/`composeModuleRegistry`) selalu langkah eksplisit terpisah yang dipanggil script/test.

### 4. Taksonomi kegagalan komposisi

Empat dipakai ulang dari validator DAG (`self_dependency`, `duplicate_dependency`, `missing_dependency`, `cycle`) plus baru: `duplicate_module_key`, `prohibited_base_override` (ANY base collision, lebih ketat dari "Core/System only" karena `type` tak konsisten diisi), `invalid_module_type`, `capability_provider_conflict`, `capability_provider_missing` (hanya untuk consume REQUIRED; `optional: true` tak pernah dicek), `migration_namespace_overlap` (perbandingan RANGE terdeklarasi, tanpa membaca `sql/*.sql`), `deployment_profile_incompatible`, `navigation_path_conflict`, `invalid_job_descriptor` (memakai ulang `validateJobDescriptor`). Semua dilaporkan sekali jalan (tidak berhenti di temuan pertama), pesan actionable.

`BASE_MODULE_MIGRATION_NAMESPACE` mereservasi `1-899` untuk base; repo turunan mulai dari `900`.

### 5. Empat gate baru, di-wire ke `bun run check` dan CI

- `bun run modules:compose:check` (`scripts/validate-module-composition.ts`) — validasi komposisi.
- `bun run modules:composition:inventory:generate` (`scripts/module-composition-inventory-generate.ts`) — men-generate `docs/awcms/module-composition-inventory.json` (deterministik, diurutkan per `key`, tanpa timestamp wall-clock).
- `bun run modules:composition:inventory:check` (`scripts/module-composition-inventory-check.ts`) — gate regenerate-and-diff (mutasi tidak boleh masuk `check`).
- `bun run extension:check` (`scripts/extension-check.ts`) — kesehatan extension seam: registry efektif tersusun valid, dan dalam mode base identik dengan base.

Ditambahkan ke script `check` di `package.json` DAN sebagai step eksplisit di `.github/workflows/ci.yml` (parity — invariant repo). `.github/workflows/release.yml` menjalankan `bun run check` verbatim sehingga otomatis tercakup.

### 6. Lingkup extension:check vs manifest kompatibilitas (#183)

`extension:check` di Issue #178 memvalidasi **extension seam/komposisi** saja. Mekanisme manifest kompatibilitas penuh (range SemVer base, checksum migration historis, versi capability — ADR-0015) adalah concern terpisah pada **Issue #183** (epic #177 Wave 1) dan BELUM diimplementasikan. Ketika #183 mendarat, ia dapat memperluas script/perintah yang sama tanpa mengubah seam yang ditetapkan #178.

## Konsekuensi

- **Positif:** Repo turunan tidak lagi perlu mengedit `src/modules/index.ts`/`module.ts` base — satu titik integrasi (`application-registry.ts`). Build base default tidak berubah (dibuktikan test). Konvensi namespace migration mencegah satu kelas tabrakan penomoran di compose-time.
- **Netral:** Tidak menambah migration SQL (komposisi murni level deskriptor TypeScript in-memory), tidak menambah endpoint/event, tidak mereklasifikasi/memindahkan modul base mana pun (10 modul base, urutan tetap).
- **Negatif/trade-off:** Menambah permukaan kontrak `_shared/module-contract.ts` (capabilities/deploymentProfiles/ApplicationModuleRegistry) yang harus dipahami penulis modul turunan. Penegakan "no shared-table write" lintas-repo (ADR-0013 §6) TETAP tidak diotomasi — komposisi memvalidasi di level deskriptor, bukan akses tabel nyata.
- **Rekonsiliasi:** ADR-0014 tetap valid sebagai dokumen desain; rujukan path di dalamnya yang mengacu tata letak mini (`module-management/domain/module-dependency-graph.ts`) dikoreksi oleh adendum ini untuk awcms (`_shared/module-dependency-graph.ts`), TANPA mengedit ADR-0014 in-place.

## Alternatif yang dipertimbangkan

- **Menaruh engine di `_shared/`** (saran awal brief) — ditolak: membalik arah dependency karena `job-registry` (yang dipakai ulang) ada di `module-management/domain/`; lihat §1.
- **Menambah `"derived"` ke `ModuleType`** — ditolak: bertabrakan dengan CHECK constraint DB `sql/008` dan Issue #178 tak boleh menambah migration; §2.
- **Mengimplementasikan manifest kompatibilitas penuh sekaligus** — ditolak: itu scope Issue #183/ADR-0015; §6.
- **Mengedit ADR-0014 in-place untuk mengoreksi path** — ditolak: ADR adalah catatan historis yang di-accept; koreksi lewat adendum (ADR-0025) lebih jujur dan auditable.
