---
"awcms": minor
---

Tambah modul `idn_admin_regions` — master data wilayah administratif Indonesia
yang ber-versi, ter-provenance, dan bisa di-rollback (ADR-0046).

Hampir setiap aplikasi bisnis Indonesia di atas template ini butuh wilayah resmi:
alamat pelanggan, cabang, wilayah kerja, agregasi laporan per provinsi. Tanpa
modul bersama, setiap aplikasi menyalin CSV-nya sendiri — versi berbeda-beda,
tanpa asal-usul, tanpa cara membuktikan versi mana yang sedang dipakai.

Yang mendarat:

- **Skema ber-versi** (`sql/080`): `awcms_idn_region_datasets` (satu baris per
  impor, dengan repo/commit/checksum/nomor Kepmendagri) dan
  `awcms_idn_admin_regions` (91.599 wilayah milik satu versi). Impor berikutnya
  menulis **di samping**, bukan menimpa — itulah yang membuat rollback jadi
  pembalikan status, bukan impor ulang.
- **Impor sebagai JOB** (`bun run idn-regions:import`, dry-run default): mem-parse
  dump upstream sebagai TEKS (tanpa mesin SQL, tanpa MySQL, tanpa jaringan) dan
  menolak impor parsial — baris tak terparse, kode ganda, induk hilang, atau satu
  tingkat kosong semuanya menggagalkan impor. Dataset baru selalu mendarat
  `validated`, tak pernah langsung `active`.
- **Aktivasi/rollback sebagai aksi admin ter-audit** (ABAC + `Idempotency-Key`),
  dengan aturan "hanya satu dataset aktif" ditegakkan **partial unique index di
  database** — bukan pemeriksaan aplikasi yang bisa disusupi dua request
  bersamaan.
- **Lookup API** `/api/v1/idn-regions/*`: filter tingkat/induk/nama, paginasi
  keyset, default ke dataset aktif, dan `?dataset=<code>` untuk membandingkan
  versi lama.
- **Dataset ter-vendor** (`data/idn-admin-regions/`, ~4,2 MB): agar impor
  deterministik dan offline, dan agar "versi wilayah mana yang jalan di build
  ini" terjawab dari commit, bukan dari keadaan internet hari itu.

Dua keputusan yang mengikat pembaca berikutnya:

- **Kedua tabel GLOBAL** — tanpa `tenant_id`, tanpa RLS. Provinsi "Aceh" sama
  untuk semua tenant. Yang menggantikan RLS bukan kepercayaan: keduanya wajib
  terdaftar di `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` sehingga privilege tiap role
  dinyatakan eksplisit (`awcms_app` SELECT + UPDATE dataset saja, `awcms_worker`
  jalur tulis, **nol DELETE untuk keduanya**), dan setiap endpoint tetap melewati
  sesi + konteks tenant + ABAC default-deny. Yang global adalah BARISNYA, bukan
  izinnya.
- **Ini bukan API resmi Kemendagri.** Dataset komunitas (`cahyadsn/wilayah`, MIT)
  yang mengemas Kepmendagri. Caveat itu dibawa di kode, di respons API, dan di
  layar admin — bukan hanya di dokumen. Nomor keputusan direkam **per berkas**
  dari header masing-masing: berkas yang diimpor menyebut **300.2.2-2138/2025**,
  sementara `awcms-mini` merekam satu kalimat menyebut 2430 untuk semua berkas —
  koreksi yang digerbangi test provenance.

Diverifikasi terhadap PostgreSQL 18.4 nyata: 81 migrasi bersih, impor 91.599
baris (38 provinsi / 514 kabupaten-kota / 7.285 kecamatan / 83.762 desa-kelurahan),
impor ulang byte identik = no-op, dan nilai turunan yang mudah salah terbukti
benar pada baris nyata (`Desa Adat` di Papua, `Kota Administrasi` di DKI, jalur
leluhur "Papua, Kabupaten Jayapura, Sentani, Desa Adat Yoboi").
