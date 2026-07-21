# ADR-0015 — Derived-application compatibility manifest, test kit, dan semantic-version gates

- **Status:** Superseded oleh [ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md) (manifest kompatibilitas turunan + `extension:check` dihapus)
- **Tanggal:** 2026-07-13
- **Pengambil keputusan:** @ahliweb
- **Terkait:** Issue #741 (epic #738 `platform-evolution`, Wave 1), Issue #739/ADR-0013, Issue #740/ADR-0014, ADR-0008, ADR-0011, ADR-0012, `docs/awcms/derived-application-guide.md`, `src/modules/_shared/module-contract.ts`, `src/modules/_shared/extension-manifest-contract.ts`, `src/modules/module-management/domain/extension-compatibility.ts`, `scripts/extension-check.ts`

## Konteks

ADR-0014 (Issue #740) menyelesaikan BAGAIMANA sebuah repo turunan menyusun modul aplikasinya sendiri ke registry final tanpa mengedit `src/modules/index.ts` base — tapi tidak menjawab pertanyaan yang berbeda: apakah aplikasi turunan itu TETAP kompatibel begitu base ini merilis versi baru. Tanpa kontrak eksplisit, sebuah repo turunan bisa diam-diam drift pada versi module contract, versi capability, migration, skema OpenAPI/AsyncAPI, dan permission key — hanya diketahui saat build/deploy sungguhan gagal, atau lebih buruk, saat berhasil build tapi berperilaku salah di production.

Issue #741 secara eksplisit membangun DI ATAS mekanisme #740 (baca kode `module-composition.ts`/`application-registry.ts` sungguhan sebelum ADR ini didesain), bukan menggantikannya. `composeModuleRegistry()` tetap satu-satunya mesin yang memvalidasi bahwa modul yang dikontribusikan sebuah repo turunan membentuk registry TypeScript yang valid (key/DAG/capability-binding/migration-namespace/deployment-profile) — ADR ini menambah lapisan yang BERBEDA dan saling melengkapi: apakah manifest KOMPATIBILITAS yang dipublikasikan sendiri oleh repo turunan (dokumen JSON/YAML statis, bukan TypeScript) konsisten secara internal DAN masih kompatibel dengan rilis base yang sedang benar-benar dijalankan.

**Pelajaran wajib dari PR #769/#770 (wave yang sama) yang secara eksplisit membentuk desain ADR ini**: PR #769 (Issue #740) sempat mengirim validator yang benar dan lulus unit test (`validateComposedModuleRegistry`) tapi TIDAK PERNAH dipanggil di jalur tulis database nyata — hanya dipanggil script CI berdiri sendiri (sudah diperbaiki dalam PR yang sama, terlihat di `descriptor-sync.ts` dan `production-preflight.ts` hari ini). PR #770 (Issue #743) mengirim `bun run X:check` baru yang benar ditambahkan ke `package.json`'s `check` composite TAPI TIDAK PERNAH ditambahkan ke `.github/workflows/ci.yml`'s `quality` job (daftar langkah manual, bukan sekadar `bun run check`) — sehingga check itu diam-diam tidak pernah berjalan di CI meski terlihat sudah "wired up". Issue #741 eksplisit ditandai sebagai kelas pekerjaan yang PALING mungkin mengulang bug ini (menambah command validasi BARU lagi) — lihat §6 di bawah untuk bukti konkret ADR ini TIDAK mengulanginya.

## Keputusan

### 1. Skema manifest — enam skema versioning independen, bukan satu

Extending precedent ADR-0008 (tiga skema versioning independen: package release, kontrak REST/event, module descriptor) — Issue #741 menambah TIGA skema baru, masing-masing dengan aturan bump sendiri (MAJOR breaking / MINOR aditif-backward-compatible / PATCH dokumentasi):

1. **`MODULE_CONTRACT_VERSION`** (`_shared/module-contract.ts`, `"1.0.0"`) — versi bentuk `ModuleDescriptor`/`ApplicationModuleRegistry` itu sendiri.
2. **`CAPABILITY_CONTRACT_VERSIONS`** (`_shared/capability-contract-versions.ts`) — satu SemVer PER capability key (`news_media`, `public_content`, `social_publishing`, semua `"1.0.0"` hari ini), dibump hanya saat bentuk port interface (`_shared/ports/*.ts`) capability itu berubah.
3. **`EXTENSION_MANIFEST_SCHEMA_VERSION`** (`_shared/extension-manifest-contract.ts`, `"1.0.0"`) — versi bentuk skema manifest compatibility itu sendiri.

Field manifest wajib (`ExtensionCompatibilityManifest`, `_shared/extension-manifest-contract.ts` = sumber kebenaran kanonik, blok ini ringkasan): `manifestVersion`, `application.{key,version,name?}`, `compatibleAwcmsRange` (SemVer range terhadap `package.json` base), `moduleContractVersion`, `contributedModules[].{key,minVersion?,deploymentProfiles?}`, `migrations.{namespace,historicalChecksums[]}`, `capabilities?.{provides?,requires?}`, `deployment.requiredProfiles`, `consumes?.{openApiContractVersion?,asyncApiContractVersion?}`.

### 2. SemVer range tanpa dependency baru

`src/lib/semver/compare.ts` — subset SemVer tulisan tangan (parse/compare/range AND-composed: `>=`,`<=`,`>`,`<`,`^`,`~`,exact), BUKAN implementasi SemVer 2.0.0 penuh (tanpa pre-release tag, tanpa `||` OR, tanpa wildcard `x`/`*`). Tidak ada package `semver` (atau apa pun serupa) di `package.json` manapun — menambah satu untuk sejumlah kecil perbandingan adalah dependency pihak-ketiga baru untuk logika yang genuinely kecil; subset tulisan tangan yang sempit dan didokumentasikan eksplisit lebih murah dan cukup untuk kebutuhan nyata di sini.

### 3. Dua lapisan yang DIGABUNG dalam satu laporan, bukan diduplikasi

`evaluateExtensionCompatibility()` (`module-management/domain/extension-compatibility.ts`) memanggil DUA hal terpisah lalu menggabung hasilnya:

- **`composeModuleRegistry()`** (Issue #740, dipakai ulang APA ADANYA, tidak diduplikasi) — terhadap registry TypeScript NYATA (base + `application-registry.ts` repo turunan). Selalu berjalan, dengan atau tanpa manifest — bermakna sendiri (sama seperti `bun run modules:compose:check` berdiri sendiri).
- **`evaluateExtensionManifest()`** (baru, Issue #741) — terhadap dokumen manifest JSON/YAML. Hanya berjalan bila manifest ditemukan.

Manifest TIDAK mengulang pengecekan yang sudah dilakukan `composeModuleRegistry` (duplicate module key/prohibited base override/capability provider conflict di level TypeScript nyata) — manifest murni memvalidasi lapisan BERBEDA: apakah dokumen deklaratif itu sendiri konsisten dan kompatibel dengan fakta rilis base saat ini (versi/kontrak/checksum), bukan menyusun ulang registry.

### 4. Capability version resolution dua-jalur

`capabilities.requires[].key` di-resolve lewat DUA jalur berurutan, bukan satu registry global tunggal:

1. **Base-provided** — dicek terhadap `CAPABILITY_CONTRACT_VERSIONS` global (capability yang disediakan BASE).
2. **Self-provided** — bila tidak ditemukan di (1), dicek terhadap manifest's OWN `capabilities.provides` list (modul repo turunan yang mengonsumsi capability modul LAIN miliknya sendiri).
3. Tidak ditemukan di keduanya → `capability_unknown`.

Ini sengaja TIDAK menyuntik ulang registry TypeScript repo turunan yang sebenarnya (yang akan butuh dynamic import dari path yang bisa dikonfigurasi CLI flag — pola yang berbahaya/ambigu terhadap larangan runtime loading doc 21 §7) — manifest cukup mandiri-diperiksa (self-contained), TANPA butuh compile TypeScript apa pun. Konsekuensinya: manifest TIDAK memverifikasi bahwa `capabilities.provides`-nya sendiri BENAR mencerminkan `ModuleCapabilityContract.provides` TypeScript repo turunan yang sebenarnya — itu tanggung jawab review manual pengarang manifest (dicatat eksplisit sebagai batas, §7).

**Version-check tetap berjalan untuk entry `optional: true`** — berbeda sengaja dari `composeModuleRegistry`'s sendiri `capability_provider_missing` (yang skip `optional` sepenuhnya, sesuai filosofi ADR-0011 "consumer degradasi aman"). Alasan: `capability_provider_missing` soal ABSENSI STRUKTURAL (provider tidak terdaftar untuk tenant ini — kondisi runtime per-tenant); mismatch VERSI adalah risiko berbeda — kode consumer sudah ter-compile terhadap bentuk port yang diasumsikan, dan breaking change pada bentuk itu tetap bisa throw untuk tenant di mana capability itu SUNGGUHAN resolve, terlepas dari apakah fiturnya opsional. Lihat komentar kode `checkCapabilities` (`extension-compatibility.ts`) untuk penjelasan penuh.

### 5. Migration immutability — reuse hashing primitif, BUKAN naming convention

`scripts/extension-check.ts`'s `discoverMigrationChecksums` memakai ulang persis `computeMigrationChecksum`/`stripOptionalTransactionWrapper` dari `scripts/db-migrate.ts` (checksum byte-identical dengan yang dihitung `bun run db:migrate` untuk isi file yang sama) — TAPI SENGAJA TIDAK memakai ulang `discoverMigrationFiles`-nya, yang `MIGRATION_FILE_PATTERN`-nya hardcode infix `_awcms_` (benar untuk `sql/` base ini, salah untuk migration repo turunan yang bernama lain, mis. `900_awpos_sales_schema.sql`). Pola file yang dipakai di sini hanya `/^\d+_.*\.sql$/` — cukup permisif untuk kedua repo.

Dua aturan "ordering" konkret (`checkMigrations`, `extension-compatibility.ts`): (1) setiap entry `historicalChecksums` harus bernomor di dalam `migrations.namespace` yang dideklarasikan; (2) file BARU (tidak ada di `historicalChecksums`) yang ditemukan di disk tidak boleh bernomor ≤ nomor tertinggi migration historis — mencegah migration baru "disisipkan sebelum" migration yang sudah shipped. Checksum yang berubah untuk file yang SUDAH ada di `historicalChecksums` (`migration_checksum_changed`) adalah pengecekan headline issue ini: repo turunan tidak bisa diam-diam mendefinisikan ulang migration yang sudah shipped.

### 6. Wiring — pelajaran PR #769/#770 diterapkan eksplisit (bukan diulang)

Tiga tempat nyata, bukan satu script berdiri sendiri:

1. **`package.json`'s `check` composite** — `extension:check` ditambahkan.
2. **`.github/workflows/ci.yml`'s `quality` job** — langkah bernama eksplisit `Extension compatibility manifest check` ditambahkan LANGSUNG di file ini (bukan diasumsikan otomatis dari `bun run check`) — file itu sendiri sudah berkomentar bahwa daftar langkahnya adalah cermin manual `package.json`'s `check`, rawan drift persis seperti yang terjadi pada PR #770/Issue #743.
3. **`scripts/production-preflight.ts`'s `REMAINING_CHILD_PROCESS_STAGES`** — ditambahkan tepat setelah `modules:compose:check`, dengan alasan yang SAMA PERSIS PR #769 sudah dokumentasikan untuk `modules:compose:check` sendiri di sana: deployment production repo turunan adalah skenario paling nyata di mana manifest kompatibilitas bisa invalid, dan preflight yang tidak pernah mengeceknya akan go-live tanpa pernah memverifikasinya.

`release.yml`'s `validate` job menjalankan `bun run check` verbatim (bukan daftar langkah manual) — sehingga otomatis tercakup lewat (1), tidak perlu edit terpisah di sana.

Uji adversarial eksplisit (`tests/unit/extension-check-fixtures.test.ts`) men-spawn `bun run scripts/extension-check.ts` sebagai proses child SUNGGUHAN terhadap sembilan fixture (satu compatible + delapan incompatible), memverifikasi exit code + pesan — BUKAN cuma memanggil fungsi validator secara langsung (`tests/unit/extension-compatibility.test.ts` sudah melakukan itu secara menyeluruh per issue type) — proses yang sama persis yang seharusnya dilakukan untuk PR #769/#770 tapi tidak dilakukan.

### 7. Batas yang SENGAJA tidak dijawab mekanisme ini

- **Tidak memverifikasi manifest mencerminkan TypeScript repo turunan yang sebenarnya** (§4) — murni self-consistency + fakta rilis base, bukan cross-check dynamic-import.
- **Tidak melarang "direct base-registry edit" di level byte-diff file** — mekanisme realistis yang ditegakkan adalah `prohibited_base_override` (`composeModuleRegistry`, level KEY collision), bukan hash seluruh source file base terhadap baseline rilis (tidak diminta acceptance criteria, dan akan jadi sistem integritas source terpisah yang jauh lebih besar dari scope issue ini).
- **Tidak membaca `sql/*.sql` repo turunan LINTAS proses/repo** — `scripts/extension-check.ts` hanya membaca direktori yang diberikan `--migrations-dir` pada checkout LOKAL yang sedang dijalankan (fork/vendor model ADR-0013/0014 — tidak ada mekanisme lintas-repo network di sini).
- **Manifest sepenuhnya opsional untuk repo base ini sendiri** — `bun run extension:check` tanpa manifest committed di root selalu lulus trivial (sama seperti `applicationModuleRegistry === undefined`), sehingga build base default tidak pernah terpengaruh.

## Konsekuensi

- **Positif:** repo turunan mendapat satu command (`bun run extension:check`) yang jalan identik di repo base ini dan di repo turunan manapun (fork/vendor yang sama membawa script + semua file yang di-importnya) — tanpa SaaS, tanpa network, tanpa package terpisah untuk diinstal.
- **Positif:** delapan fixture incompatible (melebihi minimum lima acceptance criteria) masing-masing gagal untuk alasan yang genuinely berbeda, dibuktikan mesin (`tests/unit/extension-check-fixtures.test.ts`'s "eight distinct issue-type sets" test) — bukan diklaim manual.
- **Positif:** wiring CI/preflight eksplisit meniru PERSIS pola yang sudah terbukti benar untuk `modules:compose:check` (Issue #740/PR #769's sendiri follow-up), bukan pola baru yang belum teruji.
- **Negatif/trade-off:** enam skema versioning independen (tiga dari ADR-0008 + tiga ADR ini) adalah permukaan kebijakan yang harus dipahami pengarang modul baru — didokumentasikan eksplisit di `module-contract.ts`/`capability-contract-versions.ts`/`extension-manifest-contract.ts`'s doc comment masing-masing untuk mengurangi risiko itu.
- **Negatif/trade-off:** `src/lib/semver/compare.ts` adalah subset SEMPIT SemVer (didokumentasikan eksplisit apa yang TIDAK didukung: pre-release tag, `||`, wildcard) — cukup untuk kebutuhan repo ini hari ini, tapi manifest penulis harus tahu batas ini alih-alih berasumsi kompatibilitas penuh `node-semver`.
- **Netral:** tidak mengubah bentuk `ModuleDescriptor`/`ApplicationModuleRegistry` yang sudah ada (`MODULE_CONTRACT_VERSION` murni penambahan konstanta baru), tidak mengubah `composeModuleRegistry`/`validateComposedModuleRegistry` (Issue #740) sama sekali — murni lapisan baru yang MEMANGGIL keduanya, bukan mengedit.

## Alternatif yang dipertimbangkan

- **Tambahkan `semver` (atau package serupa) sebagai dependency** — ditolak: satu package pihak-ketiga baru untuk kebutuhan perbandingan yang genuinely kecil dan sudah cukup dilayani subset tulisan tangan yang didokumentasikan; AGENTS.md aturan 14/ADR-0002 juga menegaskan preferensi minim-dependency Bun-only.
- **Manifest memvalidasi diri terhadap registry TypeScript nyata via dynamic import path dari CLI flag** — ditolak eksplisit: walau secara teknis bukan tenant-controlled input, pola "resolve path lalu `import()`" terlalu dekat secara bentuk dengan yang dilarang doc 21 §7/ADR-0012 §3, dan menambah permukaan yang tidak proporsional untuk manfaat yang kecil (§4 mendokumentasikan kenapa self-consistency check sudah cukup).
- **Satu registry capability version global datar TANPA jalur self-provided** — ditolak: akan memaksa SETIAP capability contributed modules aplikasi turunan (yang base tidak tahu-menahu) terdaftar di registry base, kontradiktif dengan prinsip "repo turunan tidak edit apa pun milik base" yang sama persis dijaga ADR-0014.
- **Skip version-check untuk `capabilities.requires` yang `optional: true`** (menyalin pola `capability_provider_missing` apa adanya) — ditolak: dijelaskan §4/kode — absensi struktural (per-tenant runtime) dan mismatch versi (risiko compile-time/shape) adalah dua kelas risiko berbeda; menyalin pola itu akan menyembunyikan risiko versi yang nyata.
- **Jalankan `extension:check` hanya sebagai script CI berdiri sendiri, tanpa wiring `production-preflight.ts`** — ditolak eksplisit: ini PERSIS kelas kegagalan PR #769/#770 yang instruksi issue ini minta dihindari; deployment production adalah tempat paling nyata manifest tidak valid harus diblokir.
