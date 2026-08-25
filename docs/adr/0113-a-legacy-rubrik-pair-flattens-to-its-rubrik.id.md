🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0113-a-legacy-rubrik-pair-flattens-to-its-rubrik.md)

<!-- i18n-source-hash: sha256:efccbbf595acc9b95e0c15715e58fd02b8612fee7819a74f6fd17fe521fd3b1e -->

# ADR-0113 — Satu pasangan rubrik legacy diratakan ke rubriknya, dan URL pencarian legacy mempertahankan kueri-nya

- **Status:** Diterima
- **Tanggal:** 2026-08-25
- **Pengambil keputusan:** ahliweb
- **Terkait:** Issue #711 (paruh cutover SeputarBorneo yang dibuka oleh ADR ini); Issue #599 (paruh yang sudah siap cutover); ADR-0045 / ADR-0070 (kosakata URL publik dibelah, dan arsip berita dirender oleh `ahliweb/awcms-astro`); ADR-0039 (tata kelola redirect); ADR-0111 (aturan yang tak bisa menyala lebih buruk daripada tanpa aturan); `sql/060` §2 (aturan path-eksak saja, secara sengaja); PRD §9.2 (tidak ada rantai lebih dari satu hop)

## Konteks

Berkas `.htaccess` legacy di `/home/data/dev_php/seputarborneo.com/.htaccess` memuat **lima** bentuk rewrite, bukan dua seperti yang disebut setiap versi rencana:

```
^news/([^/]*)\.html$          -> /berita/?news=$1          # artikel   — #599
^rubrik/([^/]*)\.html$        -> /rubriks/?news=$1         # rubrik    — DI SINI
^([^/]*)/([^/]*)\.html$       -> /rubriks/?news=$1&kt=$2   # catch-all — DI SINI
^cari_berita/([^/]*)\.html$   -> /pencarian/…              # pencarian — DI SINI
^([^/]*)\.html$               -> /data/?halaman=$1         # halaman   — #599
```

Bentuk 2, 3 dan 4 terblokir, dan issue-nya menyebut dua pemblokir. **Yang pertama tidak ada.** Daftar rubrik dikira hilang karena dump `seputa58_sbb.sql` di salinan kerja berukuran 0 byte. Memang benar 0 byte — dan memang bukan di situ datanya: `docker-compose.yml` me-mount berkas itu hanya sebagai seed initdb sementara datadir-nya adalah volume bernama `seputarborneocom_db_data`, yang berisi 411 MB. Skrip initdb hanya jalan terhadap datadir KOSONG, jadi berkas kosong itu inert sejak volume-nya pertama kali terisi.

Tidak ada pula _tabel_ rubrik, karena memang tidak pernah dimaksudkan ada. `include/rubrik.php` menjawab dengan `SELECT … FROM berita_red_tayang WHERE jenis_rubrik = ? AND kategori = ?` — `jenis_rubrik` dan `kategori` adalah **kolom pada `berita_red`**. Terukur terhadap salinan buangan dari volume itu: **25.029 artikel, 47 `jenis_rubrik` berbeda, 46 `kategori` berbeda, 102 pasangan berbeda.**

**Pemblokir kedua adalah yang sesungguhnya, dan itulah ADR ini.** Ke mana URL-URL itu harus mendarat adalah pertanyaan tentang kosakata yang BUKAN milik repo ini: ADR-0045/ADR-0070 menempatkan arsip berita di `ahliweb/awcms-astro`. Rute repo itu adalah `/kategori/[slug]` (dengan `/halaman/[nomor]`), `/tag/[slug]`, `/[tab]` dan `/[tab]/[...slug]`, serta `/cari` — **satu** tingkat kategori, sedangkan arsip legacy punya dua.

## Keputusan

**1. Bentuk 2 dan 3 keduanya 301 ke `/kategori/{seo_title(jenis_rubrik)}`. Segmen `kt` dibuang.**

**2. Bentuk 4 301 ke `/cari?q={kueri ter-percent-encode}`.**

### Mengapa meratakan, dan bukan ketiga alternatifnya

- Ia menyasar rute yang **sudah dimiliki** `awcms-astro`, jadi cutover tidak butuh rute baru di sana, tidak butuh permukaan list-API baru di sini, dan tidak butuh langkah kontrak lintas-repo keempat.
- Ia satu hop, sebagaimana dituntut PRD §9.2.
- Pembaca mendarat di daftar yang **lebih luas** daripada yang ia minta, tidak pernah di daftar yang salah. Justru properti itulah yang hilang pada alternatifnya.

**Kategori + tag** (`jenis_rubrik` → kategori, `kategori` → tag) juga tidak butuh rute baru, dan keduanya ada di `awcms-astro`. Ditolak karena ia membuang AND-nya: `/hukum/pidana.html` akan mendarat di setiap artikel ber-tag `pidana` dari SEMUA rubrik, yang merupakan halaman yang benar-benar salah, bukan sekadar terlalu luas.

**Slug komposit per pasangan** (`/kategori/hukum-pidana`) mempertahankan granularitasnya persis dan tetap satu hop. Ditolak karena ia menciptakan kosakata beranggota 102 yang tidak pernah dipilih editor mana pun, dan daftar kategori sebesar itu berhenti menjadi navigasi.

**Rute bersarang `/kategori/[slug]/[sub]`** di `awcms-astro` adalah satu-satunya opsi yang mempertahankan pasangannya secara persis. Ditolak sebagai yang termahal di daftar ini — rute baru, taksonomi dua tingkat atau filter komposit pada list-API repo ini, dan kontrak ADR-0045/0070 yang baru — dibeli demi penghalusan yang belum terbukti dibutuhkan arsipnya.

### Normalisasinya menanggung beban, dan hanya datanya yang bisa mengatakannya

Baik **`MITRA BORNEO` (11.767 artikel)** maupun **`MITRA-BORNEO` (133)** ADA di `berita_red`.

Segmen URL bentuk 3 adalah keluaran `seo_title()` — tanda baca dibuang, spasi diganti `-` — sehingga kedua ejaan itu runtuh ke segmen URL yang **SAMA**, sementara `SELECT DISTINCT` polos melaporkan dua rubrik. Peta yang dibangun dari daftar distinct tanpa dinormalisasi lewat `seo_title()` yang sama dengan yang dipakai situs legacy karena itu **salah kunci pada rubrik TERBESAR di arsip**.

Maka petanya berkunci pada `seo_title(jenis_rubrik)`, bukan pada nilai kolom mentahnya, dan 47 nilai berbeda itu bisa menghasilkan KURANG dari 47 slug. Inilah peringatan bentuk-3 satu tingkat lebih dalam: mengenumerasi bentuknya tidak cukup bila nilai di dalamnya tidak dinormalisasi sebagaimana kode legacy menormalisasinya.

### Bentuk 4 tetap path-eksak, dan ADR ini TIDAK mengizinkan mesin pola

`awcms_seo_redirects` adalah path-eksak saja **secara sengaja**. `sql/060` menyatakannya di headernya sendiri: _"tidak ADA kolom pattern/regex/rewrite di mana pun pada tabel ini. Aturan prefix/pattern ditunda ke ADR mendatang justru karena ia akan memperkenalkan mesin pola (ReDoS)."_

`/cari_berita/{apa pun}.html` adalah keluarga tak terbatas, jadi ia tak bisa dienumerasi secara prinsip — yang sekilas terbaca sebagai alasan untuk mengizinkan aturan prefix. Bukan. **Hanya URL `cari_berita` yang HADIR di sitemap legacy yang mendapat aturan.** Itulah yang membawa ekuitas terakumulasi; URL yang tak pernah diindeks siapa pun tidak butuh redirect, dan mesin pola yang dibeli untuk melayani URL yang tidak ada adalah permukaan ReDoS yang dibeli tanpa alasan. Sitemap-nya toh sudah dibutuhkan untuk crawl pra-cutover (`blog:legacy:cutover:verify`), jadi ini tidak menambah artefak yang belum ada di daftar.

Mengarahkan URL hasil-pencarian ke **halaman pencarian** bukan hal yang dilarang #711. Issue itu melarang 301 ke _konten_, karena tidak ada satu artikel pun yang merupakan tujuan benar bagi kueri sembarang. `/cari` adalah fungsi yang sama dengan yang dijalankan URL legacy itu, dengan kueri pembacanya dipertahankan.

### Dua kendala mekanis, keduanya diverifikasi terhadap kode alih-alih diasumsikan

- **Kueri-nya WAJIB ter-percent-encode.** `validateRedirectTarget` menerima `/cari?q=banjir%20sampit` dan **menolak** `/cari?q=banjir sampit` — `normalizeRedirectPath` menolak spasi sebagai pertahanan CRLF/header-injection. Keluaran `seo_title()` legacy memakai `-` di tempat kueri-nya berspasi, jadi langkah un-slugify WAJIB diikuti encoding, atau setiap aturan kueri multi-kata gagal diimpor.
- **Garis miring akhir TIDAK disimpan.** `/kategori/hukum/` dinormalisasi menjadi `/kategori/hukum`. Dicatat supaya nilai tersimpannya tidak kelak terbaca sebagai aturan yang berbeda dari yang ditulis.

## Konsekuensi

**Provenance term TIDAK dibutuhkan, dan itu menjawab butir Definition of Done ketiga #711 dengan MELARUTKANNYA alih-alih membangunnya.** Butir itu menawarkan pilihan antara menambah `legacy_source_id` pada `awcms_blog_terms` dan menulis tangan `--term-map`. Di bawah keputusan ini, bentuk 2 dan 3 menjadi aturan path-eksak → path-eksak yang resolve tanpa pernah mencari baris term, jadi keduanya tidak diperlukan. Ini penting melampaui kepraktisan: `sql/147` baru saja menghapus pasangan `awcms_blog_pages.legacy_source_*` yang ditambahkan atas penalaran yang sama dan tak pernah dikawatkan ke pembaca. Menambah kolom provenance mati KEDUA untuk menjawab kebutuhan yang sudah tidak ada akan mengulangi itu persis.

**Ke-47-atau-kurang kategori tujuan WAJIB sudah ada di tenant sebelum cutover.** Bila tidak, setiap aturan 301 ke 404 — kegagalan ADR-0111 satu langkah bergeser, dan persis akibat yang dilarang Definition of Done #711 sendiri. Petanya bisa diturunkan, tetapi tidak aman dimuat sebelum tujuannya nyata.

**`awcms-astro` tidak butuh perubahan untuk ini.** Ia membaca menu, term dan post; redirect-nya diselesaikan di repo ini sebelum rute-rutenya tercapai. Satu hal yang tak bisa dilakukannya adalah merender kategori yang tidak ada, yang merupakan konsekuensi di atas.

**Yang tersisa di #711 adalah pekerjaan DATA, bukan keputusan.** Ekstrak 102 pasangannya, normalisasi lewat `seo_title()`, bangun 47-atau-kurang aturan bentuk-2 plus satu aturan per pasangan teramati untuk bentuk 3, tambahkan aturan `cari_berita` yang hadir di sitemap, lalu verifikasi dengan `blog:legacy:cutover:verify` bahwa tidak ada yang resolve ke 404 atau ke rantai lebih dari satu hop. Importer massalnya menerima 200 aturan per panggilan dan dry-run secara bawaan.
