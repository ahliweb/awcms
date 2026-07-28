---
"awcms": minor
---

Lebur `news_portal` ke `blog_content` — satu modul konten, tanpa fitur hilang.

`news_portal` sudah berhenti membawa bebannya sendiri. 11 berkas melawan 59,
3 tabel melawan 18, nol capability disediakan, nol rute publik, dan konsumen
WAJIB `public_content` milik `blog_content` — setiap tipe section homepage-nya
dibangun di atas data modul itu. Seam capability ada untuk menggambarkan
hubungan dua modul yang masuk akal berubah sendiri-sendiri; dua ini tidak bisa.

Yang lebih menentukan: keduanya mengapalkan sistem iklan, dan yang satu
melemahkan kontrol keamanan yang lain. `awcms_blog_ads.image_url` menerima URL
apa pun, sementara `awcms_news_portal_ad_placements.media_object_id` adalah FK
ke objek media terverifikasi. Selama keduanya hidup, sebuah tenant bisa
menyalakan enforcement managed-media (ADR-0036) dan tetap menerbitkan gambar
remote sembarangan lewat pintu yang lain.

Tapi keduanya bukan fitur sama dengan dua ejaan. Yang lama punya penargetan
`post`/`page` yang tidak dimiliki yang baru; yang baru punya 12 slot penempatan,
4 mode rotasi, dan prioritas yang tidak dimiliki yang lama. Mengganti salah satu
dengan yang lain akan menghapus kemampuan tanpa suara — jebakan yang justru
menjadi alasan perubahan ini ditulis sebagai UNION, dan alasan penyatuan tabel
iklan dikerjakan terpisah setelah tabel tujuannya diperlebar lebih dulu.

Perubahan ini:

- memindahkan 8 berkas `domain/`+`application/` ke `src/modules/blog-content/`;
- **mempertahankan nama tabel dan path API** (`awcms_news_portal_*`,
  `/api/v1/news-portal/*`), mengikuti preseden ADR-0036 yang memindahkan
  registry media tanpa me-rename `awcms_news_media_objects`. Rename memakan
  setiap FK, policy, index, dan konsumen sambil tidak membeli apa pun yang
  descriptor dan inventori belum catat;
- me-repoint 4 permission lewat `sql/076` dengan urutan insert → pindahkan
  grant → hapus. Urutannya adalah keseluruhan poinnya: menghapus lebih dulu
  akan mencabut kapabilitas dari setiap tenant yang memilikinya, dengan semua
  gerbang tetap hijau;
- menaikkan `media_library` dari `optional` menjadi capability wajib bagi
  `blog_content`, karena ad placement yang diserap memegang FK nyata — itulah
  alasan `news_portal` dulu mendeklarasikannya non-optional;
- men-DROP `awcms_news_portal_tenant_state` (`sql/077`). Penulisnya tidak pernah
  diport, jadi tabel itu inert; tabel FORCE-RLS tanpa pemilik dan tanpa penulis
  adalah klaim palsu yang berdiri di depan setiap gerbang inventori;
- mempertahankan preset `news_portal` dengan namanya. Preset menamai niat, bukan
  modul, dan niatnya tidak berubah.

`tests/news-portal-merge.test.ts` menjaga janji "union, bukan pengurangan":
setiap fitur yang selamat dipaku ke sesuatu yang bisa diamati — entri registry,
permission terdeklarasi, prefix rute yang diklaim, berkas di disk, atau urutan
statement di migrasinya.
