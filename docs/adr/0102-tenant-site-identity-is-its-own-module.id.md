🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0102-tenant-site-identity-is-its-own-module.md)

<!-- i18n-source-hash: sha256:ffdb56e12fc49eec0d9212cc436780b8ec8cfc617c9c8bed05c0b6ae9e391277 -->

# ADR-0102 — Identitas situs tenant menjadi modulnya sendiri, dan pembacaannya menggabungkan

- **Status:** Accepted
- **Tanggal:** 2026-08-21
- **Pengambil keputusan:** ahliweb
- **Terkait:** Issue #596; PRD LenteraKalteng §25, §26.2, FR-TEN-004, §41; ADR-0053 (pemisahan kewenangan itu penting); ADR-0036 (inversi media_library — preseden gerbang reuse); `sql/058` (memisah read dari update berdasarkan blast radius)

## Konteks

Sebuah tenant tidak dapat menyatakan siapa dirinya. Tidak ada logo, favicon, alamat redaksi, email kontak, telepon, nomor WhatsApp, keterangan hak cipta, tagline, atau tautan profil sosial di mana pun dalam `blog_content`, `theming`, maupun `seo_distribution`.

Akibatnya bukan kosmetik. Footer, kepala halaman, halaman kontak, dan node JSON-LD `Organization` semuanya harus meng-hard-code identitas penerbit di source frontend — yang melanggar PRD §25 ("tanpa edit source code") dan FR-TEN-004 (konfigurasi wajib per-tenant), dan membuat tenant kedua mustahil tanpa fork. PRD §41 menjadikan SeputarBorneo persis tenant kedua itu.

### Gerbang reuse, dijalankan sebelum membangun apa pun

ADR-0055 mewajibkan pertanyaan apakah sebuah kapabilitas adalah modul baru atau perluasan modul yang sudah ada. Tiga kandidat diperiksa.

**`theming` — ditolak langsung.** Piagamnya adalah PRESENTASI, dan nilainya justru pada ketatnya piagam itu: nilai token divalidasi terhadap tata bahasa CSS yang ketat dan `url(...)` tidak akan pernah bisa lolos ke CSS yang dipancarkan. Alamat redaksi bukan token desain. Menaruhnya di sana berarti menyalahgunakan satu-satunya modul yang seluruh nilainya terletak pada kesempitannya.

**`blog_content.settings` — ditolak.** Identitas situs bukan konten. Tenant tanpa satu artikel pun tetap punya kepala halaman.

**`awcms_seo_tenant_settings` — kandidat yang sesungguhnya**, dan yang direkomendasikan awal oleh Issue #596 sendiri. Ia sudah memuat `site_name`, `organization_name`, `organization_logo_media_id`, dan `default_social_media_id` — kira-kira separuh daftar PRD §25. Argumen untuk memperluasnya kuat dan dinyatakan di issue: modul kedua yang memiliki separuh lainnya berarti dua sumber kebenaran untuk "siapa situs ini", dan konsumen harus tahu mana yang ditanya.

### Yang ditemukan pemeriksaan

Tumpang tindihnya nyata, tetapi kedua paruh itu bukan hal yang sejenis.

Setiap field berbau-identitas yang sudah ada di `awcms_seo_tenant_settings` adalah **keluaran SEO**: `site_name` menimpa `og:site_name`, `organization_name`/`organization_logo_media_id` mengisi node JSON-LD `Organization`, `default_social_media_id` adalah `og:image` cadangan. Masing-masing dikonsumsi perender yang memancarkan meta tag, dan masing-masing diatur oleh orang yang memahami dampak indeks.

Yang diminta PRD §25 berbeda: alamat yang bisa didatangi pembaca, nomor yang bisa dihubungi, tautan yang bisa diikuti, satu baris di dasar halaman. **Cangkang situs**, diatur oleh pengelola ruang redaksi.

ADR-0053 sudah menetapkan bahwa memisahkan kewenangan itu penting.

## Keputusan

**Kami memutuskan membangun `site_profile` sebagai modulnya sendiri, memiliki cangkang situs, dan membayar biaya pemisahan itu di sisi BACA alih-alih membebankannya kepada konsumen.**

- **Batas kepemilikan.** `awcms_seo_tenant_settings` menyimpan apa yang dilihat CRAWLER. `awcms_site_profile` (`sql/135`) memiliki apa yang dibaca MANUSIA: tagline, keterangan hak cipta, logo, favicon, alamat redaksi, email/telepon/WhatsApp kontak, dan maksimum 20 tautan profil sosial. **Tidak ada yang diduplikasi di antara keduanya**, jadi tidak ada nilai yang bisa menyimpang dari salinannya.

- **Satu pembacaan bagi konsumen.** `GET /api/v1/site-profile/composed` mengembalikan kedua paruh dalam satu jawaban, dengan keempat field milik SEO dinamai persis seperti `seo_distribution` menamainya sehingga terlihat jelas sebagai passthrough. Klien build memanggil satu endpoint dan tidak pernah tahu pemisahan itu ada.

  Inilah bagian yang menjawab keberatannya. Biaya modul kedua tidak pernah soal penyimpanan — melainkan "konsumen harus tahu mana yang ditanya", dan biaya itu dihapus dengan menggabungkan sekali, di sini, alih-alih di setiap template yang jika tidak akan memanggil dua endpoint lalu menyimpang ketika salah satunya terlupa.

- **`read` dan `update` dapat diberikan terpisah**, dengan penalaran `sql/058`: mengubah apa yang dikatakan blok kontak di setiap halaman publik adalah kuasa yang berbeda dari membacanya.

- **Tidak ada yang anonim.** "Baca publik" di Issue #596 berarti PEMBANGUN situs publik dapat membacanya. Situs menerbitkan detail kontaknya sendiri lewat templatenya sendiri; itu keputusan situs, bukan keputusan API ini atas namanya dengan menyajikannya kepada siapa pun yang bertanya. Ini mengikuti `GET /api/v1/media/public-origin`.

- **URL tautan sosial DITOLAK, bukan disanitasi**, kecuali `http(s)` absolut. Ia dirender sebagai `<a href>` di setiap halaman publik, jadi nilai `javascript:`/`data:` di sana adalah stored XSS berjangkauan sangat panjang — postur yang sama yang diambil `content-validation.ts` terhadap markup.

- **Logo dan favicon adalah id objek media, bukan URL.** Field URL akan menjadi jalur kedua menuju byte yang tidak digerbangi enforcement managed-media.

## Konsekuensi

- **Positif:** tenant kedua tidak butuh fork. Identitas menjadi data, dan `awcms-astro` membacanya saat build dari satu endpoint.
- **Positif:** batas modul cocok dengan siapa menyunting apa. Pemilik SEO dan administrator ruang redaksi adalah orang berbeda dengan izin berbeda, dan pemisahan ini membuatnya dapat diberikan, bukan sekadar nosional.
- **Negatif / imbal-balik:** kini dua tabel menyimpan hal-hal yang oleh pembaca disebut "identitas situs". Pembacaan tergabung menyembunyikannya dari konsumen, tetapi seorang PENGEMBANG tetap harus tahu — karena itu batasnya dinyatakan di deskriptor modul, header migrasi, layar admin, dan di sini.
- **Negatif / imbal-balik:** layar admin harus memberi tahu operator bahwa nama situs ada di `/admin/seo`. Ia memang melakukannya, secara eksplisit, karena alternatifnya adalah operator mencari-cari field yang hanya berjarak satu layar.
- **Netral:** `awcms_site_profile` sepenuhnya nullable di luar kuncinya. Tenant yang belum mengisi apa pun tetap tenant yang sah, dan perender menghilangkan yang absen alih-alih mencetak placeholder.
- **Netral:** favicon adalah field terpisah dari logo. Satu field untuk keduanya akan memaksa setiap tenant menerima kompromi crop mana pun yang dipilih perender.

## Alternatif yang dipertimbangkan

- **Memperluas `awcms_seo_tenant_settings` dengan kolom yang kurang** (rekomendasi awal Issue #596). Ditolak atas dasar piagam: tabel itu dibaca perender meta tag, dan alamat redaksi tidak punya pembaca di sana. Kekhawatiran di balik rekomendasi itu — dua sumber kebenaran — nyata, dan dijawab oleh pembacaan tergabung, bukan dengan menggabungkan tabelnya.
- **Memindahkan keempat field identitas milik SEO KE DALAM modul baru** dan membuat `seo_distribution` membacanya lewat port, seperti ADR-0036 untuk media. Ditolak untuk perubahan ini: itu keadaan akhir yang lebih bersih, tetapi merupakan perubahan yang memecahkan `PUT /api/v1/seo/config` dan akan menggagalkan `api:consumer-contract:check` (ADR-0065) sebagai non-aditif. Layak ditinjau ulang dengan sengaja, lewat rilis terkoordinasi, alih-alih diselipkan ke dalam perubahan yang memperkenalkan modulnya.
- **Menaruh identitas di `tenant_admin`.** Dapat dipertahankan — ia memiliki baris tenant — tetapi tetap menuntut memindahkan keempat field yang sama keluar dari `seo_tenant_settings`, membawa biaya pemecahan yang sama, dan `tenant_admin` adalah modul platform yang piagamnya ketenantan, bukan penerbitan.
- **Menyimpan tautan sosial satu kolom per platform.** Ditolak: kolom `tiktok_url` berarti satu migrasi per siklus tren. `jsonb` dengan array berbatas plus allow-list di lapisan domain menjaga himpunannya tetap terbuka tanpa membuat nilainya sembarang.
