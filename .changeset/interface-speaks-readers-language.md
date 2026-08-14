---
"awcms": minor
---

feat(i18n): antarmuka admin berbicara Bahasa Indonesia dan Inggris (ADR-0095, `sql/128`)

Repo ini menargetkan pasar Indonesia — ia mem-vendor hierarki wilayah Kemendagri
(ADR-0046) dan seluruh ADR-nya ditulis dalam Bahasa Indonesia — sementara keempat
puluh layar adminnya mengirim literal Inggris, dan `LocaleBadge` adalah lencana MATI
yang komentarnya sendiri menjelaskan sebabnya: "a switcher would be a control with
nothing behind it".

Sekarang ada sesuatu di baliknya.

**Preferensi bahasa milik PRINCIPAL, bukan identitas per-tenant.** Tabel global
`awcms_principal_preferences` meniru bentuk `awcms_principal_mfa_factors` (ADR-0087)
persis. Kenyamanan bukan argumen yang memutuskan; ADR-0088 yang memutuskan — layar
pemilihan tenant dirender SAAT BELUM ADA TENANT, jadi preferensi ber-`tenant_id`
secara struktural tak terbaca di sana, dan layar pertama yang dilihat seorang
pengguna Indonesia setelah login akan selamanya berbahasa Inggris. Peringatan
ADR-0094 soal pembacaan lintas-tenant dibaca dan tidak berlaku: yang dilarang FORCE
RLS adalah tabel BER-`tenant_id` untuk tenant lain, dan tabel ini tak punya kolom itu.

**`msgid` ADALAH teks sumber Inggris.** Label sidebar dirender dari
`ModuleDescriptor.navigation[].label` di 24 modul, jadi skema kunci ciptaan
(`admin.nav.posts`) menuntut tiap deskriptor tumbuh field baru dan tiap gerbang yang
memvalidasi bentuknya ikut berubah. Dengan gettext, `t(entry.label)` menerjemahkan
label yang sudah ada tanpa SATU PUN deskriptor berubah — dan string yang belum
diterjemahkan menurun ke bahasa Inggris yang BENAR, bukan ke kunci yang bocor ke layar.
Itulah yang membuat katalog bisa mendarat bertahap alih-alih sekaligus.

**Katalog DI-KOMPILASI ke modul TS yang ikut ter-bundle**, dan ini pelajaran yang baru
saja dibayar mahal: stage `runtime` `Dockerfile.production` hanya menyalin `dist/`,
dan 29 job yang terdaftar rapi semuanya keluar `Script not found` di produksi selama
berminggu-minggu. Katalog yang dibaca dari `locales/` saat request adalah cacat yang
PERSIS SAMA, satu subsistem ke samping dan lebih senyap — tanpa error, hanya setiap
layar mendadak berbahasa Inggris. `bun run i18n:catalog:check` mengompilasi ulang
`.po` dan membandingkan byte, sehingga berkas `.generated` adalah fakta dan bukan klaim.

Ekspresi `Plural-Forms` dari header `.po` TIDAK dievaluasi — itu ekspresi C di dalam
berkas data. Pemilih bentuk jamak ada di kode (`en` 2 bentuk, `id` 1), dan headernya
dibaca untuk DIVERIFIKASI.

Yang ikut mendarat:

- `LocaleBadge` DIHAPUS, digantikan `LanguageSwitcher` yang benar-benar mengubah
  bahasa — form biasa, jadi ia bekerja tanpa JavaScript dan di halaman tanpa sesi.
- Urutan resolusi: cookie override → preferensi principal → `default_locale` tenant →
  `Accept-Language` → `en`. `awcms_tenants.default_locale` sudah ada sejak `sql/001`;
  ini pembaca keduanya.
- `awcms_tenants.default_theme` — kolom yang ADA namun TAK PERNAH dibaca siapa pun —
  akhirnya mendapat pembaca pertamanya lewat seam `data-tenant-default-theme` yang
  sudah didokumentasikan `theme-init-script.ts`. Preferensi tema karena itu ikut
  tersimpan per-manusia TANPA menyentuh byte skrip init, sehingga hash CSP-nya utuh.
  Komentar di berkas itu yang menyatakan kolomnya "tidak ada" adalah salah dan
  dikoreksi.
- `isSameOriginPath` (`src/lib/security/`) untuk validasi `return_to`: pertanyaan yang
  lebih sempit dari guard beku `seo_distribution` (hanya path relatif, tak pernah URL
  absolut), jadi ia berupa ALLOW-LIST karakter alih-alih daftar bypass yang harus
  diingat — dan `identity_access` tidak jadi bergantung pada `seo_distribution`.

Permukaan publik TIDAK dilokalkan di sini, dan itu disengaja: satu URL publik yang
badannya berubah menurut cookie akan membuat Varnish menyajikan halaman Indonesia
kepada pembaca Inggris. Melokalkannya menuntut kunci cache ikut membawa locale, dan itu
prasyarat yang didaftar, bukan detail implementasi.
