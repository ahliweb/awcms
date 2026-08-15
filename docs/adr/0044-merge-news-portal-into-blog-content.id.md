🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0044-merge-news-portal-into-blog-content.md)

<!-- i18n-source-hash: sha256:ac21881771a34fac6daef86c39bec7f8faefb1d37bf9f13a87464d5b07b4feb2 -->

# ADR-0044 — Lebur `news_portal` ke dalam `blog_content`: satu modul konten, tanpa kehilangan fitur

- Status: Accepted
- Tanggal: 2026-07-28
- Terkait: ADR-0036 (inversi kepemilikan media — preseden yang diikuti untuk
  TIDAK me-rename tabel saat kepemilikan berpindah), ADR-0009 (rute publik
  `/blog/{tenantCode}`), ADR-0026 (kepemilikan OpenAPI modular), ADR-0034
  (template keluarga dipakai-langsung), ADR-0035 (awcms menyerap klaster website
  awcms-micro)

## Konteks

`news_portal` tidak lagi menanggung bobotnya sendiri, dan kedua modul kini
menduplikasi satu fitur dengan cara yang secara aktif melemahkan sebuah kontrol
keamanan.

**`news_portal` adalah shim tipis di atas `blog_content`.** Diukur pada saat
keputusan ini diambil:

|                            | `blog_content`                 | `news_portal`  |
| -------------------------- | ------------------------------ | -------------- |
| Berkas sumber              | 59                             | 11             |
| Versi modul                | 0.9.0                          | 0.4.0          |
| Tabel tenant               | 18                             | 3 (satu inert) |
| Capability yang disediakan | `public_content`, `seo_facts`  | tidak ada      |
| Rute publik                | seluruh `/blog/{tenantCode}/*` | tidak ada      |

Deskriptor `news_portal` sendiri mencatat alasannya: keluarga rute `/news/**`
yang host-resolved, dua layar adminnya, dan jalur aktivasi module-preset-nya
semuanya dibuang saat porting. Yang bertahan adalah dua fitur — komposer seksi
beranda editorial dan penempatan iklan berbasis R2 — plus
`awcms_news_portal_tenant_state`, sebuah tabel penanda yang oleh deskriptor yang
sama didokumentasikan tidak punya writer. Ia inert.

Modul itu juga konsumen _wajib_ dari capability `public_content` milik
`blog_content`: setiap tipe seksi beranda dibangun di atas data `blog_content`.
Jahitan capability ada untuk menggambarkan relasi antara dua modul yang secara
masuk akal bisa berubah independen. Kedua modul ini tidak bisa.

**Duplikasinya bukan kosmetik.** Kedua modul mengirimkan sistem iklan, dan
keduanya menyimpan gambarnya secara berbeda:

```
awcms_blog_ads.image_url                       text          -- URL apa pun, tak terverifikasi
awcms_news_portal_ad_placements.media_object_id uuid NOT NULL -- FK ke objek R2 terverifikasi
```

`awcms_blog_ads` persis adalah lubang media-tak-terkelola yang untuk
menutupnyalah `media_library` dan sakelar penegakan per-tenant-nya (ADR-0036)
ada. Membiarkan keduanya tetap ada berarti sebuah tenant bisa menyalakan
penegakan managed-media dan tetap mempublikasikan gambar remote sembarang lewat
tabel yang satunya.

Namun keduanya bukan fitur yang sama dengan dua ejaan. Masing-masing punya
capability yang tidak dimiliki yang lain:

|               | `awcms_blog_ad_placements`                                     | `awcms_news_portal_ad_placements`  |
| ------------- | -------------------------------------------------------------- | ---------------------------------- |
| Sumber gambar | `image_url` mentah                                             | FK `media_object_id` terverifikasi |
| Penargetan    | `placement_type` global/widget/**post**/**page** + `target_id` | —                                  |
| Slot          | —                                                              | 12 nilai `placement_key` tetap     |
| Rotasi        | —                                                              | `rotation_mode` + `priority`       |

Mengganti salah satunya dengan yang lain diam-diam menghapus sebuah capability.
Itulah jebakan yang ADR ini ditulis untuk menghindarinya.

**Tidak satu pun dari kedua modul punya layar admin.** Kedua deskriptor sengaja
tidak mendeklarasikan `navigation`, karena porting membawa API dan rute publik
tetapi bukan layar authoring-nya, dan
`tests/admin-navigation-registry.test.ts` gagal pada entri menu yang menunjuk ke 404. `src/pages/admin/` menampung 14 layar; tak satu pun untuk konten, media,
atau periklanan.

**Frontend publik sedang pindah keluar, ke sebuah repo bernama.** Pengalaman
membaca publik tidak dibangun di sini. Ia tinggal di **`ahliweb/awcms-astro`** —
repo baru yang merupakan implementasi rujukan template keluarga `awcms-astro`
(template keempat di samping `awcms`, `awcms-mini`, dan `awcms-micro`),
terintegrasi dengan repo ini lewat `/api/v1`. Standar desainnya sudah ada dan
sudah berjalan: `web-lalulintasmelayani.com` membuktikannya di produksi — enam
lokal tanpa halaman pincang, set komponen bebas JavaScript, audit konten sebagai
gerbang rilis — dan membawa dokumen-dokumen standar itu sendiri
(`docs/awcms-astro/`, ADR-0012-nya). `awcms-astro` mewarisi standar itu dan
menambahkan integrasi awcms.

Tugas `awcms` pada sumbu itu adalah menjadi **backend admin dan API konten**,
bukan menumbuhkan situs publik kedua. Rute `/blog/{tenantCode}/*` yang dirender
tangan dan sudah ada tetap persis seperti apa adanya — ia tetap permukaan
fallback bawaan, bukan produknya.

## Keputusan

1. **`blog_content` adalah satu-satunya modul konten.** `news_portal`
   dipensiunkan sebagai modul: dihapus dari registry, deskriptornya dihapus,
   berkas `domain/`+`application/`-nya dipindahkan ke bawah
   `src/modules/blog-content/`.

2. **Peleburan ini adalah gabungan fitur, tidak pernah pengurangan.** Setiap
   capability yang bisa dijangkau lewat salah satu modul sebelum ADR ini bisa
   dijangkau sesudahnya. Ini adalah batasan atas pekerjaannya, ditegakkan oleh
   test, bukan sebuah aspirasi. Yang dipertahankan secara konkret: komposer seksi
   beranda (6 tipe seksi), penempatan iklan, penargetan iklan per-post/per-page,
   12 slot penempatan, 4 mode rotasi, template, menu hierarkis, widget posisi,
   override tema per-tenant, redirect, penautan tag internal, revisi, checklist
   kualitas, penjadwalan, grup terjemahan, dan pengaturan blog.

3. **Nama tabel tidak berubah.** `awcms_news_portal_homepage_sections` dan
   `awcms_news_portal_ad_placements` mempertahankan namanya di bawah kepemilikan
   baru. Ini mengikuti ADR-0036, yang memindahkan registry media ke
   `media_library` dan sengaja membiarkan `awcms_news_media_objects` bernama
   seperti semula: rename tidak membeli apa pun dan berbiaya setiap foreign key,
   policy, indeks, dan grant yang mereferensikannya. Kepemilikan dicatat di
   deskriptor modul dan di inventaris, yang memang tempat pembaca melihat.

4. **Kedua sistem iklan disatukan menjadi yang berbasis media, setelah
   diperlebar lebih dulu.** `awcms_news_portal_ad_placements` mendapat kolom
   penargetan (`target_type`, `target_id`) yang belum dimilikinya, sehingga ia
   bisa mengekspresikan segala yang bisa diekspresikan
   `awcms_blog_ad_placements`. Baru setelah itu `awcms_blog_ads` dan
   `awcms_blog_ad_placements` dimigrasikan dan di-drop. Baris yang
   `image_url`-nya tidak bisa di-ingest ke `media_library` **dilaporkan sebagai
   residu oleh job migrasi yang bisa dijalankan dry-run**, tidak pernah di-drop
   diam-diam — iklan yang lenyap dari situs hidup tanpa catatan lebih buruk
   daripada iklan yang gagal bermigrasi dengan berisik.

5. **`awcms_news_portal_tenant_state` di-drop.** Ia tidak punya writer, dan
   penegakan managed-media dinyalakan per tenant oleh sakelar
   `POST /api/v1/media/enforcement` milik `media_library` sendiri. Men-drop tabel
   inert bukan kehilangan fitur; mempertahankan tabel FORCE-RLS tanpa pemilik
   adalah kebohongan permanen kepada gerbang inventaris.

6. **Path API tidak di-rename dalam perubahan yang sama dengan peleburannya.**
   `/api/v1/news-portal/homepage-sections` dan `/ad-placements` tetap bekerja di
   bawah kepemilikan `blog_content`. Mengonsolidasikannya di bawah
   `/api/v1/blog/*` adalah keputusan terpisah yang membawa redirect; melipatnya
   ke dalam perpindahan kepemilikan akan menghasilkan satu perubahan yang
   mustahil di-review sebagai salah satu dari keduanya.

7. **Permission di-repoint, bukan di-seed ulang.** Empat permission yang diserap
   (`homepage_sections`/`ad_placements` × `read`/`configure`) sudah di-seed di
   bawah `news_portal` oleh `sql/044`/`sql/045`. `sql/076` menyisipkan baris
   ber-key `blog_content`, memindahkan setiap grant yang ada ke baris itu, dan
   baru setelah itu menghapus baris lama — urutan persis yang dipakai `sql/052`
   untuk permission media di bawah ADR-0036. Urutan itulah seluruh intinya:
   migrasi yang men-seed baris baru tanpa memindahkan grant-nya akan
   meninggalkan setiap tenant yang ada memegang grant pada baris yang akan
   dihapus, mencabut akses sementara setiap gerbang tetap hijau. Karena
   `awcms_role_permissions.permission_id` adalah foreign key ke
   `awcms_permissions(id)`, memindahkan grant ITULAH backfill-nya — tidak ada
   langkah backfill terpisah yang ada maupun dibutuhkan.

## Konsekuensi

**Apa yang menjadi lebih baik.** Satu modul memiliki konten. Jahitan capability
antara `blog_content` dan `news_portal` lenyap bersama modulnya, sehingga
`public_content` menjadi panggilan internal alih-alih kontrak yang harus
disepakati dua modul. Ada tepat satu sistem iklan, dan setiap gambar iklan
adalah objek media terverifikasi — sakelar penegakannya berhenti punya jalan
pintas. Jumlah modul berkurang satu tanpa satu pun endpoint hilang.

**Apa biayanya.** `awcms_blog_ads`/`awcms_blog_ad_placements` di-drop, yang tak
bisa dibalik secara in-band; migrasinya wajib menjalankan dry-run-nya lebih dulu
dan laporan residunya wajib dibaca, bukan dilewati. `blog_content` membesar: ia
sudah menjadi modul terbesar, dan ia menyerap sembilan berkas lagi. Itu harga
jujur dari peleburannya, dan itulah alasan admin UI (di bawah) dicakup satu
layar pada satu waktu alih-alih satu perubahan.

**Apa yang tidak diputuskannya.** Layar admin-nya sendiri. Mereka adalah
potongan pekerjaan tersisa yang terbesar dan mendarat satu issue per layar,
masing-masing mengembalikan entri deskriptor `navigation`-nya sendiri dalam
perubahan yang sama yang menambahkan halamannya — urutan yang sudah ditegakkan
`tests/admin-navigation-registry.test.ts`. Ia juga tidak memutuskan perluasan
model konten yang akan dibutuhkan `ahliweb/awcms-astro` (tipe blok terstruktur
di luar enam yang ada sekarang, JSON-LD `FAQPage`, resolver locale-fallback, dan
aturan validasi domain yang wajib pindah ke dalam checklist kualitas **sebelum**
ada konten yang bermigrasi — model konten yang pindah lebih dulu menghabiskan
satu periode di mana artikel bisa dibuat tanpa apa pun yang menjaganya, dan
periode itu tidak pernah sesingkat yang direncanakan). Semua itu ada di hilir
peleburan ini, bukan bagian darinya.

**Apa yang diutangkan repo pasangannya kepada repo ini.** `awcms-astro`
mengonsumsi kontrak yang wajib dijaga stabil oleh repo ini: himpunan slug
ditentukan oleh locale default dan dipasangkan lewat `translation_group_id`
(tidak pernah di-query per locale, yang akan menghasilkan jumlah halaman berbeda
per bahasa dan menghidupkan kembali 404 lintas-bahasa), `isFallback` dihitung di
sisi server, dan hanya `status = 'published'` yang pernah disajikan ke sebuah
build. Kontrak itu tertulis di repo yang mengonsumsinya dan itulah alasan
peleburan di atas tidak boleh mengganggu `translation_group_id`,
`public_content`, atau `seo_facts`.
