🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0122-omes-control-center-domain-module-admission.md)

<!-- i18n-source-hash: sha256:aff991d9b508980cb4ce1b8c6121a8135dc6819baa05a0bced2b320cde3d18bc -->

# ADR-0122 — Penerimaan modul domain OMES Control Center (`omes_control`)

- **Status:** Accepted
- **Tanggal:** 2026-09-22
- **Pengambil keputusan:** ahliweb
- **Men-extend:** [ADR-0011](0011-capability-ports-for-cross-module-collaboration.id.md), [ADR-0017](0017-document-infrastructure-module-admission.id.md), [ADR-0051](0051-admin-screens-consolidated-in-awcms.id.md), [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.id.md), [ADR-0070](0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.id.md), [ADR-0094](0094-a-data-subject-is-answered-per-tenant.id.md)
- **Terkait:** OMES Issue ahliweb/omes#196 (parent epic ahliweb/omes#195, dimigrasi dari ahliweb/awcms-one#152); OMES Issue ahliweb/omes#197 (konsumsi kontrak v1 yang dipin); `sql/154_awcms_omes_control_schema.sql`; `sql/155_awcms_omes_control_permissions.sql`; `src/modules/omes-control/`

## Konteks

Proyek OMES (otomasi infrastruktur AhliWeb, kompatibilitas host, dan platform lifecycle layanan) memerlukan control plane web bagi operator ("Control Center") untuk mengelola armada server host, pendaftaran worker, deployment yang diinginkan vs diobservasi, permintaan operasi, antrean job, cuplikan telemetri kesehatan, titik pemulihan cadangan, dan proyeksi audit eksekusi.

Sesuai batas otoritas arsitektur lintas repositori yang ditetapkan dalam OMES ADR-0017 dan AWCMS ADR-0051/0055/0070:

1. Model domain multi-tenant yang dapat digunakan kembali, skema administratif, kebijakan Row Level Security (RLS), izin RBAC/ABAC, dan layar admin sistem secara kanonikal berada di `ahliweb/awcms`.
2. Deployment referensi hilir seperti `ahliweb/awcms-one` mengintegrasikan kapabilitas ini melalui merge `git subtree pull --prefix=apps/cms awcms main` yang bersih tanpa menduplikasi logika kanonikal.
3. Eksekusi host OMES tetap terisolasi pada worker pull OMES; Hermes Agent memiliki runtime agent LLM dan semantik delegasi; AWCMS memiliki control plane multi-tenant, otorisasi, dan antarmuka administratif.

ADR ini mencatat penerimaan, arsitektur skema, dan postur keamanan modul domain `omes_control` ke dalam `ahliweb/awcms`.

## Evaluasi Arsitektur (11 Kriteria)

1. **Keuntungan dan Kerugian:**
   - _Keuntungan:_ Isolasi penuh di `src/modules/omes-control/`. Sepenuhnya patuh pada konvensi modular monolith AWCMS (`defineModule`). Menghindari pencemaran tabel fondasi inti dengan field spesifik infrastruktur.
   - _Kerugian:_ Mengharuskan pemeliharaan migrasi skema dan deskriptor siklus hidup data untuk delapan tabel baru.
2. **Keamanan:**
   - Setiap tabel tenant-scoped menegakkan `ENABLE ROW LEVEL SECURITY` dan `FORCE ROW LEVEL SECURITY`.
   - Akses default-deny, digerbang oleh izin eksplisit (`omes_control.*`).
   - Runtime menggunakan peran hak akses paling rendah (`awcms_app` dan `awcms_worker`), tidak pernah superuser basis data.
   - Tanpa rahasia mentah dalam tabel basis data: kunci privat worker, kunci SSH, dan rahasia penyedia dilarang. Hanya metadata kunci publik, hash kunci, dan bukti teredaksi yang disimpan.
3. **Performa:**
   - Setiap foreign key dan kolom pencarian tenant diindeks dengan indeks B-tree komposit (`(tenant_id, ...)`).
   - Tabel bervolume tinggi (`awcms_omes_jobs`, `awcms_omes_health_snapshots`, `awcms_omes_audit_projections`) membawa deskriptor retensi siklus hidup data untuk mencegah pertumbuhan tabel tanpa batas.
4. **Kemudahan Pemeliharaan:**
   - Menggunakan registri kanonikal AWCMS: `ModuleDescriptor`, katalog izin, `subjectData` / `NO_SUBJECT_DATA`, dan `dataLifecycle`.
5. **Skalabilitas:**
   - Partisi multi-tenant via `tenant_id` dan RLS memungkinkan penskalaan mulus di berbagai server dan tenant tanpa kebocoran lintas tenant.
6. **Aksesibilitas:**
   - Titik masuk navigasi dan layar admin mematuhi WCAG 2.1 AA dan persyaratan kontras token desain AWCMS (`design:token-contrast:check`).
7. **Dampak SEO:**
   - Tidak ada. Modul ini murni infrastruktur administratif internal di dalam `/admin/*`, terautentikasi dan tidak diindeks.
8. **Implikasi UI/UX:**
   - Terintegrasi secara alami ke dalam navigasi sidebar `/admin` AWCMS yang ada dengan label terlokalisasi dan gerbang perizinan.
9. **Kompatibilitas:**
   - Menggunakan DDL yang kompatibel dengan PostgreSQL 18, UUID standar (`gen_random_uuid()`), dan `timestamptz`.
10. **Kompleksitas Operasional:**
    - Minimal: menggunakan migrasi SQL maju saja yang standar (`sql/154` dan `sql/155`) tanpa perubahan memecah pada data tenant yang ada.
11. **Implikasi Teknis Jangka Panjang:**
    - Menetapkan kontrak tahan lama antara OMES dan AWCMS tanpa mengaburkan batas operasional.

## Keputusan

1. **Penerimaan Modul:** Daftarkan `omesControlModule` di bawah `src/modules/omes-control/module.ts` sebagai modul `"domain"` dengan kunci `"omes_control"`.
2. **Skema & Tabel:**
   - `awcms_omes_servers`: Inventaris armada dan stempel waktu detak jantung.
   - `awcms_omes_enrollments`: Metadata pendaftaran worker, kredensial kunci publik, dan status siklus hidup.
   - `awcms_omes_deployments`: Status deployment yang diinginkan vs diobservasi, status rekonsiliasi drift, dan bukti kesalahan.
   - `awcms_omes_operation_requests`: Permintaan operasi yang disahkan tenant dengan kunci idempotensi.
   - `awcms_omes_jobs`: Antrean job worker dan pelacakan sewa (lease).
   - `awcms_omes_health_snapshots`: Pemeriksaan kesehatan dan telemetri server pada suatu titik waktu.
   - `awcms_omes_backup_snapshots`: Manifest cadangan, ukuran, checksum, dan status verifikasi.
   - `awcms_omes_audit_projections`: Proyeksi bukti eksekusi host OMES jarak jauh.
3. **RLS & Hak Akses:**
   - Semua 8 tabel membawa `tenant_id uuid NOT NULL REFERENCES awcms_tenants(id) ON DELETE CASCADE`.
   - Semua 8 tabel mengaktifkan dan memaksa RLS (`ALTER TABLE ... FORCE ROW LEVEL SECURITY`).
   - Kebijakan isolasi tenant: `USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)`.
   - `SELECT`, `INSERT`, `UPDATE`, `DELETE` diberikan kepada `awcms_app` dan `awcms_worker`.
4. **Katalog Perizinan:**
   - Dibenihkan dalam `sql/155_awcms_omes_control_permissions.sql` mencakup server, deployment, job, cadangan, audit, dan pendaftaran.
5. **Data Subjek & Siklus Hidup Data:**
   - Semua 8 tabel adalah catatan infrastruktur operasional yang tidak memuat data pribadi tentang orang perorangan, didaftarkan dalam `NO_SUBJECT_DATA`.
   - Tabel bervolume tinggi menyatakan deskriptor retensi siklus hidup data dalam deskriptor modul.

## Adendum (Issue ahliweb/omes#197): konsumsi kontrak v1 OMES yang dipin

Modul `omes_control` perlu memvalidasi payload yang dipertukarkan dengan OMES terhadap kontrak wire yang dipublikasikan OMES sendiri di `contracts/control-center/v1/**` (OMES issue #89, kebijakan kata kunci fail-closed dari OMES issue #172). Dua batasan dari batas OMES/AWCMS (§1 di atas) berlaku langsung:

- AWCMS tidak boleh mengambil kontrak ini lewat jaringan saat runtime atau saat test (tidak ada ketergantungan langsung pada keterjangkauan repositori OMES).
- AWCMS tidak boleh mengimplementasikan validator JSON Schema kedua yang independen dan bisa melenceng dengan semantik yang lebih longgar dibanding milik OMES sendiri — itu bisa membuat payload yang ditolak OMES malah lolos di sisi AWCMS, atau sebaliknya.

**Keputusan:** men-vendor cuplikan yang dipin dan identik byte-per-byte, alih-alih mengambil atau menurunkan ulang kontraknya.

- **Cuplikan vendored:** `src/modules/omes-control/contracts/v1/` adalah salinan persis dari `contracts/control-center/v1/**` pada commit OMES yang dipin — setiap skema, setiap mesin status `*.states.json`, setiap skema event, dan setiap fixture (termasuk asersi kelas alasan `.reason.txt`). Manifest `PIN.json` di direktori tersebut mencatat repositori sumber, area, versi, SHA commit sumber 40 karakter yang eksak, timestamp sinkronisasi, dan hash SHA-256 setiap berkas yang di-vendor.
- **Alat sinkronisasi/drift:** `scripts/sync-omes-contracts.ts` men-vendor ulang dari path checkout OMES lokal (`bun run contracts:omes:sync -- --source <path> --commit <sha>`) dan, dalam mode `--check` (`bun run contracts:omes:sync:check`), menghitung ulang hash dan gagal secara jelas pada drift, pin yang hilang, atau ketidakcocokan versi. `contracts:omes:sync:check` disambungkan ke `bun run check` tepat setelah `api:consumer-contract:check`, sehingga drift kontrak menjadi gerbang rilis, bukan kejutan yang ditemukan di produksi.
- **Validator fail-closed, tanpa dependency baru:** `src/modules/omes-control/domain/contracts/schema.ts` adalah port TypeScript dari daftar kata kunci yang didukung persis milik `lib/omes/py/jobs/schema.py` (`type`, `required`, `properties`, `additionalProperties`, `enum`, `const`, `pattern`, `minimum`, `maximum`, `minLength`, `maxLength`, `minItems`, `maxItems`, `items`, `oneOf`, `anyOf`, plus anotasi `$schema`/`$id`/`title`/`description`) — kata kunci JSON Schema lain mana pun akan melempar error, bukan diam-diam diabaikan. Pemindai raw-secret independen (`scanForRawSecrets`) mencerminkan larangan nama-secret/bentuk-secret dari berkas yang sama dan selalu berjalan, terlepas dari apa yang dinyatakan skema tertentu. Kesetaraan `const`/`enum` memakai kesetaraan struktural mendalam yang tidak bergantung urutan (`deepEqualJson` di `json-parse.ts`), bukan perbandingan string yang sensitif terhadap urutan kunci. Semua pencarian `properties`/`required`/`additionalProperties` terhadap kunci milik instance memakai `Object.hasOwn`, tidak pernah operator `in` atau pengindeksan kurung siku — keduanya me-resolve kunci bernama literal `__proto__` terhadap objek yang diwariskan dari `Object.prototype`, bukan kunci yang benar-benar dideklarasikan skema. Tidak ada `ajv`, `zod`, atau paket JSON Schema lain yang ditambahkan; AWCMS memang sudah tidak memakai satu pun, sejalan dengan sikap stdlib-only OMES sendiri (ADR-0012).
- **Parsing teks mentah aman dari prototype pollution:** parser `validateOmesContractText` (`json-parse.ts`) membangun setiap hasil objek dengan `Object.defineProperty`, tidak pernah `obj[key] = value` — yang terakhir adalah vektor prototype-pollution klasik untuk parser buatan tangan: kunci bernama literal `__proto__` akan mengenai accessor `Object.prototype` alih-alih membuat properti data, membuat nilai yang diselundupkan tak terlihat baik oleh validasi skema maupun pemindai secret (keduanya menelusuri objek dengan `Object.keys`/`Object.entries`). Tata bahasa angka/string/whitespace parser juga sengaja dibuat tidak lebih longgar dari `JSON.parse` native/`json.loads` Python (menolak nol di depan, desimal tanpa digit, BOM di awal, karakter kontrol tak di-escape dalam string) dan membatasi kedalaman nesting sehingga input adversarial gagal dengan `JsonParseError` yang bersih, bukan stack overflow yang tak tertangkap.
- **Mesin status sebagai data:** `src/modules/omes-control/domain/contracts/state-machine.ts` adalah pemeriksa transisi generik yang dimuat dari berkas `*.states.json` yang di-vendor (mencerminkan `lib/omes/py/jobs/states.py`) — aturan siklus hidup subscription/invoice hidup dalam JSON yang dipin, tidak pernah diduplikasi sebagai alur kontrol TypeScript tulisan tangan.
- **Penanganan versi tak didukung:** setiap entry point (`validateOmesContract`, `assertOmesContract`, `getOmesStateMachine`) menolak versi kontrak apa pun selain yang di-vendor (`v1`) sebelum menyentuh disk.
- **API publik:** `src/modules/omes-control/domain/contracts/index.ts` meng-export `validateOmesContract`, `validateOmesContractText`, `assertOmesContract`, `scanForRawSecrets`, `getOmesStateMachine`, dan `OMES_CONTRACT_PIN` untuk dikonsumsi lapisan API/aplikasi (OMES issue #198/#199).

**Prosedur pembaruan:** ketika OMES mempublikasikan commit baru yang dipin untuk `contracts/control-center/v1/**` (atau `v2` di masa depan), jalankan `bun run contracts:omes:sync -- --source <path-ke-checkout-omes> --commit <sha-40-karakter-baru>` dari checkout AWCMS dengan clone OMES lokal tersedia, tinjau diff yang dihasilkan di `src/modules/omes-control/contracts/v1/` dan `PIN.json` yang baru, jalankan `bun run check` (yang memvalidasi ulang setiap fixture dan gerbang drift), dan landing hasilnya sebagai PR tersendiri yang merujuk commit/issue OMES yang memicu sinkronisasi ulang. Cuplikan vendored dikecualikan dari Prettier (`.prettierignore`) sehingga pemformatan ulang tidak pernah berselisih dengan byte upstream yang dipin.
