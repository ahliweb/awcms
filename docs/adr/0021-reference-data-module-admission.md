# ADR-0021 — Admission of `reference_data` as an Official Optional Business Foundation module

- **Status:** Accepted
- **Tanggal:** 2026-07-14
- **Pengambil keputusan:** @ahliweb
- **Terkait:** Issue #750 (epic #738 `platform-evolution`, Wave 3), Issue #739 / ADR-0013 (extension layers, data-ownership matrix), ADR-0016 (`organization_structure` admission — sama pola template), Issue #742 / `domain_event_runtime` (outbox event runtime dipakai modul ini sebagai REAL producer), `docs/awcms/21_module_admission_governance.md`, `docs/awcms/templates/module-proposal-template.md`

## Konteks

ADR-0013 §1 sudah mem-pre-klasifikasikan `reference_data` sebagai kandidat **Official Optional Business Foundation** (lapisan 3) untuk Wave 3 epic #738, dan §1 catatan penutup secara eksplisit mewanti-wanti implementer issue ini bahwa `idn_admin_regions` (modul terdaftar `type: "base"`, `status: "experimental"`, tanpa schema/API/UI) sudah "setengah membangun primitif yang sama" secara konseptual — ADR ini mengonfirmasi bagaimana kedua modul tetap terpisah tanpa duplikasi data (§4 di bawah). Issue #750 secara eksplisit mensyaratkan sebagai acceptance criterion pertama: "Admission decision/ADR confirms module category, ownership, dependencies, and offline behavior" — ADR ini memenuhi syarat itu dengan mengisi `docs/awcms/templates/module-proposal-template.md` inline, mengikuti format ADR-0016 (preseden Wave 2 terdekat yang juga menulis ADR admission tersendiri, bukan hanya mengandalkan pre-klasifikasi ADR-0013).

## Keputusan

Kami memutuskan untuk mengadmisi `reference_data` sebagai modul baru di registry base ini dengan parameter berikut (mengisi format `module-proposal-template.md` inline):

### 1. Nama & key modul

- Nama: **Reference Data**
- `key`: `reference_data`
- Kategori: **Official Optional Module** (= lapisan ADR-0013 "Official Optional Business Foundation")

### 2. Masalah/kebutuhan

Setiap aplikasi turunan butuh kode referensi terkontrol — mata uang, satuan ukur (UoM), kalender fiskal, klasifikasi dokumen, atau value set milik modulnya sendiri — tanpa (a) mengarang enum hardcoded per modul, (b) meng-import tabel modul lain secara langsung (melanggar ADR-0013 §6 no-shared-table-write), atau (c) menghapus/mengganti kode yang sudah dipakai data nyata secara destruktif. `reference_data` menjawab ini sebagai fondasi provider-neutral: value set + code efektif-tanggal, terlokalisasi, dengan provenance, deprecation/supersession, precedence baseline-global vs tenant-override yang deterministik, dan jalur import tervalidasi. Generik untuk **semua** aplikasi turunan (retail butuh mata uang/UoM, layanan publik butuh klasifikasi dokumen, sekolah butuh tahun ajaran/kalender fiskal) — bukan spesifik satu domain bisnis.

### 3. Mengapa ini bukan modul Derived Application

Lolos pohon keputusan §3 doc 21, node Q3 ("generik untuk SEMUA aplikasi turunan"): value set/code/localization/effective-date/deprecation adalah primitif data generik yang sama bentuknya di retail, layanan publik, pendidikan, kesehatan, dst. — bukan aturan bisnis satu vertikal (tidak ada chart of accounts, aturan pajak, atau product/item catalog di sini, lihat §Out of scope issue #750). Preseden sama seperti `organization_structure` (ADR-0016) — modul ini adalah "fondasi data referensi generik lintas vertikal", bukan implementasi ERP/master-data spesifik.

### 4. Hubungan dengan `idn_admin_regions` — tidak menduplikasi, tidak memindahkan data

`idn_admin_regions` (registry `type: "base"`, `status: "experimental"`, migration 054/dataset khusus wilayah administratif Indonesia dari `cahyadsn/wilayah`) **tetap modul-owned dan tidak direklasifikasi oleh ADR ini** (reklasifikasi kategori butuh admission decision terpisah, doc 21 §9 — di luar scope issue #750, yang eksplisit menyebut "Existing `idn_admin_regions` ownership remains clear and no duplicate region dataset is introduced" sebagai acceptance criterion, bukan "gabungkan ke `reference_data`"). Keputusan konkret:

- `reference_data` **tidak** mengimpor/menyalin baris `awcms_idn_admin_regions`/`awcms_idn_region_datasets` ke tabel generiknya sendiri.
- `idn_admin_regions` **boleh**, di issue masa depannya sendiri (di luar scope #750), memilih untuk mendaftarkan dirinya sebagai _module-contributed value set_ lewat mekanisme kontribusi generik modul ini (`ModuleDescriptor.referenceData.contributesValueSets`, §5 di bawah) — sebuah pilihan opsional, bukan keharusan, dan bukan migrasi data wajib. Sampai keputusan itu diambil secara eksplisit, kedua modul berjalan independen: `idn_admin_regions` tetap punya skema/API/pemilik data spesifiknya sendiri untuk hierarki wilayah administratif (provinsi/kabupaten/kecamatan/desa berjenjang empat level, kebutuhan struktural yang tidak dipetakan bersih ke model value-set/code datar generik modul ini), sementara `reference_data` melayani value set **datar** (mata uang, UoM, kalender fiskal, dan value set lain yang tidak butuh hierarki multi-level).
- Tidak ada dependency (lifecycle maupun capability) antara `reference_data` dan `idn_admin_regions` di kedua arah dalam PR ini.

### 5. Dependency

- **Lifecycle dependency** (`ModuleDescriptor.dependencies`, wajib aktif duluan): `["tenant_admin", "identity_access", "domain_event_runtime"]`. `tenant_admin` untuk `awcms_tenants` (batas tenant, direferensikan oleh tabel tenant-override), `identity_access` untuk actor/permission context (setiap endpoint tetap diautentikasi lewat tenant user + permission, termasuk endpoint yang menulis ke tabel GLOBAL — lihat §8), `domain_event_runtime` karena modul ini adalah REAL producer (`appendDomainEvent`, event type terdaftar di `domain-event-runtime/domain/event-type-registry.ts`) — pola yang sama `organization_structure` (ADR-0016) dan `workflow_approval` (#747) tetapkan.
- **Capability dependency** (`ModuleDescriptor.capabilities`, ADR-0011): `reference_data` **PROVIDES** `reference_data_resolution` — implementasi nyata `ReferenceDataPort` (`_shared/ports/reference-data-port.ts`) untuk resolusi kode (baseline + tenant-override, as-of, deprecation-aware) dan snapshot value set. **Tidak ada modul lain di PR ini yang mendaftarkan `capabilities.consumes` terhadap port ini** — sama seperti `organization_structure`'s `BusinessScopeHierarchyPort` saat pertama diperkenalkan (ADR-0016 §4), port ini adalah _extension seam_ untuk konsumen masa depan (termasuk `idn_admin_regions`, §4 di atas), bukan integrasi langsung yang sudah ada di PR ini (menjaga blast radius atomic, AGENTS.md aturan #1). Selain itu, modul ini mendefinisikan **module contribution descriptor** baru (`ModuleDescriptor.referenceData?.contributesValueSets`, field opsional additive di `_shared/module-contract.ts`) — mekanisme deklaratif (bukan capability port) yang memungkinkan modul LAIN mendaftarkan value set/code miliknya sendiri secara statis tanpa import tabel langsung; divalidasi oleh `domain/contribution-registry.ts` (pola yang identik dengan `data_lifecycle`'s `HighVolumeTableDescriptor`/SoD's `SoDRuleDescriptor`, Issue #745/#746) dan disinkron ke tabel global modul ini lewat `application/contribution-sync.ts`, dipanggil eksplisit (`bun run reference-data:contributions:sync`), bukan otomatis dari modul lain manapun.

### 6. Kompatibilitas offline/LAN vs full-online-only

- Kelas kompatibilitas: **offline-lan-safe**. Tidak ada provider eksternal apa pun yang dilibatkan — seluruh CRUD/resolusi/import adalah operasi database murni; import memvalidasi payload yang dikirim operator (bukan memanggil sumber data eksternal real-time — eksplisit di luar scope issue #750: "Real-time external provider calls during reference resolution").
- Modul ini berfungsi 100% di profil `offline-lan` tanpa konektivitas internet sama sekali.

### 7. Provider eksternal

Tidak ada. Tidak ada kategori External Integration di dalam modul ini.

### 8. Security & data governance

- Data yang disentuh: value set/code metadata (kunci stabil, label terlokalisasi, metadata jsonb dibatasi ukurannya, tanggal efektif) — tidak ada PII, tidak ada secret, tidak ada ekspresi/SQL/template executable di dalam `metadata` (ditegakkan validasi domain, sesuai acceptance criterion issue #750 "Reference data contains no executable expressions, SQL, templates, secrets, or unbounded arbitrary metadata").
- **Global baseline (value set/code/translation/import batch) sengaja TIDAK RLS** — sama seperti `awcms_permissions`/`awcms_modules`/`awcms_idn_admin_regions` (doc 04 §RLS standard, doc 21 §8): data identik untuk semua tenant secara desain, bukan data tenant. Tabel ini didaftarkan eksplisit ke `RLS_FREE_TABLES` DAN `ALLOWED_GLOBAL_TABLE_GRANTS` di `scripts/security-readiness.ts` (reviewed RLS-exempt, bukan celah yang tidak disadari) — memenuhi acceptance criterion "reviewed global baseline tables are explicitly documented if RLS-exempt". Mutasi terhadap tabel global ini tetap wajib melalui endpoint tenant-terautentikasi + permission `reference_data.*` (tidak ada konsep "platform superadmin" terpisah di codebase ini, sama seperti desain `idn_admin_regions`'s rencana `dataset.import`/`.activate`/`.rollback` — lihat modul README untuk catatan operasional eksplisit: permission ini harus diberikan secara sempit ke operator tepercaya karena aksinya memengaruhi baseline bersama SEMUA tenant, bukan hanya tenant pemanggil).
- **Tenant override/extension (`awcms_reference_tenant_codes` + translations) RLS `ENABLE`+`FORCE`**, predicate selalu dan hanya `tenant_id` (ADR-0013 §2/§9) — tenant override tidak pernah menulis ke tabel global baseline dan tidak pernah membaca override tenant lain; precedence resolusi (baseline vs override) adalah operasi BACA murni yang menggabungkan hasil dua query terpisah (tenant-scoped RLS untuk override, plain SELECT global untuk baseline), bukan sebuah JOIN lintas-isolasi yang bisa membocorkan baris tenant lain.
- ABAC: default-deny, permission key baru per resource (`reference_data.value_sets.*`, `.codes.*`, `.imports.*`, `.tenant_codes.*`) — lihat migration permission seed. `AccessAction` union ditambah dua nilai baru (`commit`, `rollback`, keduanya diklasifikasikan `HIGH_RISK_ACTIONS`) — additive-only, tidak mengubah nilai literal yang sudah ada.
- High-risk action yang wajib `Idempotency-Key` + audit log: create/update/deprecate/restore pada value set, code, dan tenant code, serta import dry-run/commit/rollback — SELURUH permukaan mutasi modul ini (bukan subset), termasuk setiap tombol submit UI admin yang memanggil endpoint tersebut. Deprecate value set/code yang sudah direferensikan tenant override, dan import commit/rollback, adalah kandidat risiko tertinggi (acceptance criterion issue #750: "A code already referenced by business data is never silently deleted or repurposed in place") — commit import re-validasi checksum + destructive-replace check DI DALAM transaksi yang sama dengan penulisan, bukan hanya pre-check terpisah.

### 9. Ownership

`@ahliweb` (mengikuti `.github/CODEOWNERS`, sama seperti seluruh modul lain — `ModuleDescriptor.maintainers` belum diisi modul manapun per doc 21 §8 R3, tidak diubah di sini).

### 10. Rencana deprecation

Tidak relevan — modul baru, tidak menggantikan modul/fitur lain yang ada. Currency/UoM/fiscal-calendar yang disertakan sebagai fixture adalah **contoh netral**, bukan sumber otoritatif regulasi — didokumentasikan eksplisit di README modul (acceptance criterion issue #750: "without claiming comprehensive regulatory authority").

### 11. Alternatif yang dipertimbangkan

- **Menggabungkan `idn_admin_regions` ke `reference_data` dalam PR ini** — ditolak: di luar scope issue #750 eksplisit ("no duplicate region dataset is introduced" bukan "gabungkan sekarang"), dan hierarki wilayah administratif 4 level `idn_admin_regions` tidak dipetakan bersih ke model value-set/code datar modul ini tanpa desain migrasi tersendiri (§4 di atas mendokumentasikan jalur kompatibel opsional untuk masa depan, bukan keputusan sekarang).
- **Membuat tabel baseline value set/code tenant-scoped (dengan `tenant_id` nullable untuk baris global)** — ditolak: melanggar konvensi RLS repo ini (`tenant_id` yang bisa NULL pada tabel RLS-FORCE menciptakan kelas baris ambigu yang sulit diaudit); mengikuti preseden `awcms_idn_admin_regions`/`awcms_permissions` yang memisahkan tabel GLOBAL (tanpa `tenant_id`, RLS-exempt terdokumentasi) dari tabel tenant-scoped (`tenant_id` wajib, RLS FORCE) secara tegas jauh lebih konsisten dengan doc 04 §RLS standard.
- **Mengizinkan tenant override menimpa baris baseline in-place (UPDATE langsung ke `awcms_reference_codes` dengan filter tenant)** — ditolak eksplisit: melanggar acceptance criterion issue #750 "Tenant override cannot mutate global/module baseline rows or affect another tenant" secara langsung; sebagai gantinya tenant override HANYA pernah menulis ke tabel tenant-scoped terpisah (`awcms_reference_tenant_codes`), baseline tidak pernah tersentuh oleh mutasi tenant apa pun.
- **Commit import langsung tanpa tahap dry-run terpisah** — ditolak: acceptance criterion issue #750 eksplisit mensyaratkan "Import dry-run/diff is non-mutating; commit is idempotent, audited, and recoverable" — dua tahap (dry-run menghasilkan batch tervalidasi + checksum, commit mereferensikan batch itu dan re-validasi ulang di dalam transaksi yang sama) adalah satu-satunya cara membuktikan "non-mutating dry-run" sekaligus "commit idempotent" secara struktural, bukan sekadar naratif.

## Konsekuensi

- **Positif:** Aplikasi turunan mendapat fondasi kode referensi reusable (mata uang, UoM, kalender fiskal, value set milik modulnya sendiri) tanpa mengarang enum hardcoded atau meng-import tabel modul lain langsung, dan `idn_admin_regions` mendapat jalur kompatibel opsional (module-contributed value set) untuk masa depan tanpa migrasi data wajib sekarang.
- **Positif:** Precedence baseline-global vs tenant-override yang deterministik dan diuji (unit test cross-tenant isolation + as-of resolution) memberi model referensi konkret pertama untuk pola "global baseline data, tenant boleh extend/override tanpa memengaruhi tenant lain" — pola yang bisa dipakai modul Optional lain di masa depan.
- **Negatif/trade-off:** Modul baru di registry menambah permukaan yang harus lolos `modules:dag:check`/`modules:compose:check` setiap kali registry berubah, dan menambah dua nilai baru (`commit`, `rollback`) ke `AccessAction` union bersama — mitigasi: dependency dideklarasikan minimal (`tenant_admin`, `identity_access`, `domain_event_runtime`), tidak ada capability `consumes` yang bisa menciptakan cycle, dan kedua nilai action baru mengikuti pola penamaan self-documenting yang sudah ada (`verify`/`set_primary`/`release`/`revoke`, dst.).
- **Negatif/trade-off:** Mutasi terhadap baseline global tetap digerbang oleh permission tenant-scoped biasa (tidak ada mekanisme "platform superadmin" terpisah di codebase ini) — didokumentasikan eksplisit sebagai batasan operasional (§8), bukan diklaim sebagai isolasi sempurna; operator wajib memberikan permission `reference_data.value_sets.*`/`.codes.*`/`.imports.*` secara sempit.
- **Netral:** `docs/awcms/21_module_admission_governance.md` §8 diperbarui menambah baris ke-18 (lihat PR ini).
