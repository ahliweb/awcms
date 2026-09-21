🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0122-omes-control-center-domain-module-admission.md)

<!-- i18n-source-hash: sha256:90c040adf8f3deedc861b3ebc79b2c3c01b5d65f60e285ba4a0c79e7d2acd28c -->

# ADR-0122 — Penerimaan modul domain OMES Control Center (`omes_control`)

- **Status:** Accepted
- **Tanggal:** 2026-09-22
- **Pengambil keputusan:** ahliweb
- **Men-extend:** [ADR-0011](0011-capability-ports-for-cross-module-collaboration.id.md), [ADR-0017](0017-document-infrastructure-module-admission.id.md), [ADR-0051](0051-admin-screens-consolidated-in-awcms.id.md), [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.id.md), [ADR-0070](0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.id.md), [ADR-0094](0094-a-data-subject-is-answered-per-tenant.id.md)
- **Terkait:** OMES Issue ahliweb/omes#196 (parent epic ahliweb/omes#195, dimigrasi dari ahliweb/awcms-one#152); `sql/154_awcms_omes_control_schema.sql`; `sql/155_awcms_omes_control_permissions.sql`; `src/modules/omes-control/`

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
