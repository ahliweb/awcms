🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0130-migration-prefixes-three-or-four-digits-numeric-order.md)

<!-- i18n-source-hash: sha256:6bb5c5378c2c09cfc98d5d6d017a8af5f92c12b1454f31de0f9a70b34d43e2d5 -->

<!-- i18n-source-hash: sha256:pending -->

# ADR-0130 — Prefiks migrasi tiga atau empat digit, diurutkan secara numerik

- **Status:** Diterima
- **Tanggal:** 2026-10-05
- **Pengambil keputusan:** ahliweb
- **Terkait:** Issue #911; [ADR-0003](0003-postgresql-rls-multi-tenant.id.md) (RLS; setiap migrasi menambah policy-nya); [ADR-0005](0005-soft-delete-and-immutability.id.md) (migrasi yang sudah diterapkan immutable); [ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.id.md) (template dipakai langsung); `scripts/db-migrate.ts`; `scripts/lib/migrations.ts`; `tests/db-migrate-ordering.test.ts`. Tidak ada ADR sebelumnya yang mencatat aturan penamaan `NNN_awcms_<area>_<description>.sql`, sehingga ADR ini mencatat aturan yang diperlebar dan tidak mengubah ADR mana pun.

## Konteks

Runner hanya menerima `^\d{3}_awcms_[a-z0-9_]+\.sql$` dan menerapkan berkas menurut urutan `localeCompare`. Itu benar hanya selama setiap prefiks sama lebarnya. Aplikasi turunan `ahliweb/awcms-one` mencadangkan `900`–`999` untuk modul commerce-nya (ADR-0015 di sana) dan sudah menghabiskannya. Berkas yang ditambahkan kemudian untuk mengisi celah diterapkan menurut urutan leksikal, sehingga tidak bisa bergantung pada tabel bernomor lebih tinggi (ADR-0037 D3 di sana). Digit keempat akan menyelesaikannya, tetapi sortir leksikal biasa menaruh `1000_…` sebelum `999_…`.

Loader yang dipakai gate untuk melipat migrasi (`listMigrationNames`, dipakai misalnya oleh `deriveTableRlsStates`) memiliki sortirnya sendiri. Gate yang melipat dalam urutan berbeda dari urutan penerapan runner melaporkan kondisi akhir yang tidak pernah dicapai database mana pun.

## Keputusan

1. **Prefiks tiga atau empat digit**: `^\d{3,4}_awcms_[a-z0-9_]+\.sql$`. Prefiks dua digit dan lima digit tetap ditolak dengan galat `Invalid migration file name` yang sudah ada.
2. **Satu urutan, `compareMigrationNames`** di `scripts/lib/migrations.ts`: nilai numerik prefiks di depan, lalu nama lengkap sebagai pemutus seri. `scripts/db-migrate.ts` menerapkan dengannya dan `listMigrationNames` melipat dengannya, sehingga urutan lipat gate sama dengan urutan terap runner.
3. **Upstream tetap memakai `001`–`899`.** `1000` ke atas untuk pita cadangan aplikasi turunan. Base tidak menambah berkas empat digit berdasarkan keputusan ini.
4. **Tidak ada yang diganti nama.** Ledger `awcms_schema_migrations` dikunci oleh nama lengkap dan checksum, dan tidak disentuh.
5. **Sebuah tes mengikatnya.** `tests/db-migrate-ordering.test.ts` mencakup pola yang diperlebar, penolakan prefiks dua dan lima digit, serta urutan numerik lintas lebar.

## Konsekuensi

- **Positif:** aplikasi turunan dapat memperluas pita cadangan melewati `999` dan menambah berkas yang bergantung pada tabel lebih baru; runner dan gate berbagi satu urutan.
- **Netral:** semua nama yang ada bertiga digit, dan untuk nama berlebar sama urutan numerik sama dengan urutan leksikal, sehingga urutan terap tidak berubah di database mana pun. Tanpa perubahan migrasi, endpoint, event, atau runtime.
- **Negatif:** lebar campuran kini diurutkan menurut nilai, sehingga `1000_…` mengikuti `999_…`. Tidak mungkin ada konflik urutan lama: runner lama menolak nama empat digit, jadi tidak ada database yang menyimpan satu pun yang diterapkan dengan urutan lama. Penulis tetap harus menghindari memakai ulang satu nomor lintas lebar (`0100_…` dan `100_…` seri pada nilai dan jatuh ke nama lengkap).

## Alternatif yang dipertimbangkan

- **Menambal `db-migrate` di hilir pada tiap aplikasi turunan** — ditolak: divergensi permanen pada satu berkas yang dijalankan setiap deployment.
- **Mengisi nol semua nama menjadi empat digit** — ditolak: penggantian nama mengubah kunci ledger dan merusak setiap database yang sudah diterapkan.
- **Natural sort lewat `localeCompare(…, undefined, { numeric: true })`** — ditolak: bergantung pada locale, membandingkan rangkaian digit di mana pun dalam nama, dan kurang eksplisit dibanding membandingkan prefiks.
- **Menomori ulang di hilir** — ditolak: masalah kunci ledger yang sama, di setiap database turunan.
