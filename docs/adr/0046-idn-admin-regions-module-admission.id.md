🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0046-idn-admin-regions-module-admission.md)

<!-- i18n-source-hash: sha256:38e2b512a61c8b0b3f0cfa667cc4641e6894b5e84ee94397edf7052c8eca5636 -->

# ADR-0046 — Admission `idn_admin_regions` (Official Optional Module): master data wilayah administratif Indonesia sebagai reference data GLOBAL ber-versi, dengan dataset ter-vendor dan aktivasi satu-slot

- **Status:** Accepted
- **Tanggal:** 2026-07-31
- **Pengambil keputusan:** @ahliweb
- **Mengadaptasi:** `awcms-mini` `src/modules/idn-admin-regions/` (epic #654, issue #655–#657 yang mendarat di sana; #658–#664 di-hold di repo itu). Di sana migrasinya bernomor `048`/`054` — penomoran repo itu, bukan repo ini. Di sini skema mendarat di `sql/080` dan seed permission di `sql/081`.
- **Terkait:** ADR-0034 (template dipakai-langsung — modul ditambahkan langsung ke `src/modules/`), ADR-0035 (positioning superset ERP + SaaS), ADR-0012/doc 21 (governance admission modul), ADR-0037 (`data_lifecycle` — kenapa tabel modul ini TIDAK didaftarkan ke sana), ADR-0026 (fragment OpenAPI per-modul), ADR-0006 (provider eksternal di luar transaksi).

## Konteks

Hampir setiap aplikasi bisnis Indonesia yang dibangun di atas template ini butuh wilayah administratif resmi: alamat pelanggan, cabang/kantor, wilayah kerja, agregasi laporan per provinsi/kabupaten, sampai pemetaan tarif ongkir. Tanpa modul bersama, setiap aplikasi turunan akan menyalin CSV-nya sendiri, dengan versi yang berbeda-beda, tanpa provenance, dan tanpa cara membuktikan versi mana yang sedang dipakai.

Empat fakta yang membentuk keputusan ini:

1. **Data ini identik untuk semua tenant.** Provinsi Aceh sama untuk setiap tenant di platform. Ini reference data global, bukan konten milik tenant.
2. **Data ini BERUBAH secara berkala.** Kemendagri menerbitkan pemutakhiran kode/nama wilayah (pemekaran, perubahan nama, perubahan status desa/kelurahan). Dataset karena itu harus **ber-versi**, bukan tabel tunggal yang di-`UPDATE` di tempat — kalau tidak, laporan historis berubah makna secara diam-diam ketika data diperbarui.
3. **Tidak ada API resmi Kemendagri yang stabil dan bebas untuk dipakai** dalam pipeline build/deploy. Sumber praktis terbaik adalah dataset komunitas `cahyadsn/wilayah` (MIT), yang mengemas Kepmendagri ke dalam dump SQL.
4. **Volumenya besar untuk ukuran reference data** — 91.599 baris (38 provinsi, 514 kabupaten/kota, 7.285 kecamatan, 83.762 desa/kelurahan) — cukup besar untuk membuat "impor lewat HTTP request" menjadi keputusan yang salah, tapi jauh dari besar untuk PostgreSQL.

Yang harus mengikat **sebelum** kode ditulis: siapa yang memiliki data ini, bagaimana versinya dikelola, dari mana byte-nya berasal dan bagaimana dibuktikan, serta klaim resmi apa yang **tidak** boleh dibuat platform ini.

## Keputusan

Kami mengadmisi **`idn_admin_regions`** sebagai **Official Optional Module** berjenis **reference data global ber-versi**, dengan dataset upstream **di-vendor ke dalam repo** dan model siklus hidup **satu dataset aktif**.

### 1. Parameter admission

| Parameter                | Nilai                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Nama                     | Indonesia Administrative Regions                                                                                    |
| `key`                    | `idn_admin_regions`                                                                                                 |
| Kategori                 | **Official Optional Module** — reference data generik lintas vertikal                                               |
| `type` di kode           | `system` (lihat §2 — divergensi sadar dari `awcms-mini` yang memakai `base`)                                        |
| `isCore`                 | tidak                                                                                                               |
| `status`                 | `active` — descriptor, skema, impor, aktivasi, dan lookup API mendarat bersama                                      |
| Lifecycle `dependencies` | `["tenant_admin", "identity_access"]` saja                                                                          |
| Kepemilikan data         | **GLOBAL**, bukan tenant-scoped — tanpa `tenant_id`, tanpa RLS (§3)                                                 |
| Kelas kompatibilitas     | Murni DB + berkas repo = **offline-lan-safe penuh**; tidak ada panggilan jaringan di jalur mana pun, termasuk impor |

### 2. `type: "system"`, bukan `"base"` — divergensi sadar dari `awcms-mini`

`awcms-mini` memilih `type: "base"` dengan alasan "reference data murni, bukan fitur bisnis maupun infrastruktur platform". Di sini keputusannya berbeda karena **konteksnya berbeda**: repo ini tidak punya satu pun modul ber-`type: "base"` (14 modul ber-type terbagi `system`/`domain`), sementara `media_library` sudah menetapkan preseden persis untuk kasus ini — "System Foundation, `isCore: false`": kapabilitas bersama yang dipakai modul lain, dimiliki platform, bukan milik tenant.

Memperkenalkan nilai `type` ketiga hanya untuk satu modul akan menambah kategori yang harus dijawab setiap gerbang, matriks, dan pembaca — tanpa membeli perilaku apa pun (`type` hanya memengaruhi klasifikasi/registry, bukan runtime). Modul ini masuk seksi sidebar **`operations`** (master data operasional), bukan `system`.

### 3. Data GLOBAL: tanpa `tenant_id`, tanpa RLS — dan kenapa itu aman

Kedua tabel (`awcms_idn_region_datasets`, `awcms_idn_admin_regions`) sengaja **tidak** punya `tenant_id`, tidak punya RLS, dan tidak punya policy. Ini pengecualian sadar terhadap default repo ini ("setiap tabel tenant-scoped wajib RLS `FORCE`"), dengan tiga alasan yang saling menopang:

- Isinya **fakta publik** — kode dan nama wilayah yang diterbitkan pemerintah. Tidak ada data pribadi, tidak ada data bisnis tenant, tidak ada yang bisa bocor lintas tenant karena tidak ada yang tenant-spesifik untuk dibocorkan.
- Menduplikasi 91.599 baris per tenant akan mengubah reference data menjadi beban penyimpanan yang tumbuh linier terhadap jumlah tenant, dan membuat "apakah semua tenant memakai versi wilayah yang sama?" menjadi pertanyaan yang tidak bisa dijawab.
- Preseden internal sudah ada dan diperlakukan sama: `awcms_permissions`, `awcms_modules`, `awcms_schema_migrations` semuanya global.

Konsekuensi yang **wajib** menyertainya, bukan opsional: kedua tabel didaftarkan eksplisit di `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` (`scripts/security-readiness.ts`). Registrasi itu memaksa deklarasi privilege eksplisit — bukan sekadar mengecualikan tabel dari cek RLS. `awcms_app` mendapat **`SELECT` saja**; `INSERT`/`UPDATE`/`DELETE` dilarang untuk keduanya, karena jalur tulis satu-satunya adalah job impor yang berjalan sebagai `awcms_worker`.

**Otorisasi tetap per-tenant.** Data global tidak berarti akses global: setiap endpoint tetap melewati sesi + konteks tenant + guard RBAC/ABAC default-deny. Yang global adalah BARISNYA, bukan izinnya.

### 4. Versioning: dataset immutable + satu slot aktif

Satu baris `awcms_idn_region_datasets` = satu impor. Baris wilayahnya menunjuk `dataset_id` dan **tidak pernah di-update di tempat**: memperbarui data berarti mengimpor dataset baru di sebelah yang lama.

Siklus hidupnya: `validated` (terimpor, belum melayani) → `active` (melayani) → `superseded` (pernah aktif, digantikan). `rejected` disediakan untuk mencatat percobaan impor yang gagal validasi.

"Hanya satu dataset aktif" ditegakkan **di database** lewat partial unique index pada `status` untuk baris `status = 'active'` — bukan lewat pemeriksaan aplikasi yang bisa dilewati oleh dua request bersamaan. Rollback = mengaktifkan kembali dataset `superseded` sebelumnya; baris wilayah dataset lama masih utuh, sehingga rollback tidak pernah butuh impor ulang.

### 5. Impor adalah JOB, aktivasi adalah AKSI ADMIN

Pembagian ini disengaja dan mengikat:

- **Impor** (`bun run idn-regions:import`) berjalan sebagai `awcms_worker`, membaca berkas dump yang sudah ter-vendor di repo, mem-parse-nya sebagai teks, dan menulis 91.599 baris dalam satu transaksi. Ini **tidak** diekspos lewat HTTP: menaruh operasi 91 ribu baris di belakang request akan menciptakan permukaan timeout dan penyalahgunaan tanpa membeli apa pun — dataset-nya ada di dalam image, bukan diunggah operator. Mode default `--dry-run` (mem-parse, memvalidasi, melaporkan; tidak menulis).
- ~~**Aktivasi/rollback** adalah aksi admin lewat HTTP (`POST /api/v1/idn-regions/datasets/{id}/activate` dan `.../rollback`): high-risk, ber-`Idempotency-Key`, ter-audit, ABAC-gated. Ini keputusan operasional yang butuh jejak siapa/kapan/kenapa — bukan langkah deployment.~~ **Dikoreksi [ADR-0052](0052-idn-region-dataset-lifecycle-is-an-operator-job.md):** keduanya kini job operator (`bun run idn-regions:activate`/`:rollback`) dan endpoint-nya dihapus. Alasannya justru §5 ADR ini sendiri — aksi ini mengubah data yang dilayani ke SEMUA tenant, jadi tidak ada subjek tenant untuk dievaluasi ABAC; permission-nya (`dataset.configure`/`.restore`) yang ter-seed ke katalog global membuat owner tenant biasa berwenang atas data tenant lain.

Konsekuensi grant: `awcms_worker` memegang `INSERT`/`UPDATE`/`SELECT` untuk impor, `awcms_app` memegang `SELECT` (lookup) plus `UPDATE` **hanya** pada `awcms_idn_region_datasets` (transisi status aktivasi/rollback). Tidak ada peran yang memegang `DELETE` pada tabel mana pun: dataset tidak pernah dihapus, hanya di-`superseded`.

### 6. Dataset di-VENDOR ke repo, bukan diunduh saat impor

Keempat berkas dump upstream disimpan verbatim di `data/idn-admin-regions/upstream/cahyadsn-wilayah/db/` beserta LICENSE, `manifest.json` (repo/branch/commit SHA/checksum per berkas), dan `checksums.sha256`.

Alasannya bukan kenyamanan: **impor harus deterministik dan offline.** Setiap gerbang di repo ini berjalan tanpa jaringan; deployment LAN/offline adalah kelas yang didukung; dan "versi wilayah mana yang dipakai build ini" harus bisa dijawab dari commit, bukan dari keadaan internet pada hari impor dijalankan. Konsekuensi yang diterima: repo bertambah ~4,2 MB, sekali.

Hanya `db/wilayah.sql` yang dibaca kode hari ini. Tiga berkas lain (`wilayah_pulau`, `wilayah_penduduk`, `wilayah_luas`) di-vendor sebagai dataset pendamping dari commit yang SAMA — supaya fitur berikutnya (pulau, penduduk, luas) tidak perlu menebak versi mana yang cocok dengan hierarki yang sudah diimpor.

### 7. Klaim yang TIDAK dibuat platform ini

Ini dataset **komunitas pihak ketiga** yang mengemas Kepmendagri, **bukan** API atau ekspor resmi Kementerian Dalam Negeri. AWCMS tidak pernah mengklaim sebagai penerbit resmi data ini, dan dataset ini **tidak menggantikan** rujukan legal/kepatuhan operator ke Kepmendagri aslinya.

Caveat itu wajib muncul di README modul, respons API metadata dataset, dan layar admin — bukan hanya di dokumen ini. Satu konstanta kode (`domain/source-provenance.ts`) menjadi sumber tunggalnya supaya tidak drift.

Satu koreksi terhadap `awcms-mini` yang dibawa ke sini: mini merekam satu kalimat provenance tunggal yang menyebut **Kepmendagri No. 300.2.2-2430 Tahun 2025** untuk seluruh dataset. Header berkas yang sebenarnya berbeda per berkas — `db/wilayah.sql` (satu-satunya yang diimpor modul ini) menyebut **Kepmendagri No. 300.2.2-2138 Tahun 2025**, sementara `db/wilayah_pulau.sql` menyebut `300.2.2-2430`. Repo ini merekam nomor keputusan **per berkas**, apa adanya dari header masing-masing, karena inilah rujukan yang akan dikutip operator saat auditor menanyakan dasar hukum datanya.

## Konsekuensi

**Positif**

- Setiap aplikasi yang dibangun di template ini punya wilayah administratif yang sama, ber-versi, dan bisa ditelusuri sampai commit upstream + checksum berkas.
- Pemutakhiran Kemendagri berikutnya = vendor berkas baru → impor → aktifkan, tanpa menyentuh baris dataset lama, dan bisa di-rollback dalam satu aksi.
- Nol dependensi jaringan pada setiap jalur, termasuk impor — sesuai kelas offline-LAN.

**Negatif / biaya yang diterima**

- Repo bertambah ~4,2 MB berkas vendor.
- Dua tabel global tanpa RLS menambah beban tinjauan: setiap kali seseorang menambah tabel global, ia harus melewati percakapan `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` — itu memang tujuannya, tapi biayanya nyata.
- Data hanya sebaik dataset komunitasnya. Kalau upstream telat memuat Kepmendagri terbaru, platform ini juga telat; itulah kenapa nomor keputusan direkam per berkas dan ditampilkan ke operator alih-alih disembunyikan.

**Yang TIDAK dikerjakan ADR ini**

- Kode pulau/penduduk/luas (berkas-nya di-vendor, kode-nya tidak ada).
- Pencarian fuzzy/trigram — btree biasa cukup untuk prefix/equality; `pg_trgm` baru dipertimbangkan bila ada kebutuhan nyata.
- Relasi ke entitas bisnis (alamat profil, wilayah kerja kantor). Modul ini menyediakan lookup; yang menghubungkannya ke domainnya adalah modul konsumen.
