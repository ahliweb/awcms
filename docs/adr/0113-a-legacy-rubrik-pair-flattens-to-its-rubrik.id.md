🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0113-a-legacy-rubrik-pair-flattens-to-its-rubrik.md)

<!-- i18n-source-hash: sha256:0d22623ff04e554ab0e2562303067137677825330162116a48d69f26c522e2b0 -->

# ADR-0113 — Satu pasangan rubrik legacy diratakan ke rubriknya, dan URL pencarian legacy mempertahankan kueri-nya

- **Status:** Diterima
- **Tanggal:** 2026-08-25
- **Pengambil keputusan:** ahliweb
- **Diamandemen:** 26 Agustus 2026 — bagian normalisasinya salah secara faktual (`seo_title()` tak pernah dipanggil); keputusannya TIDAK berubah. Lihat di bawah.
- **Diamandemen lagi:** 26 Agustus 2026 — **keputusan bentuk-4 DICABUT** (keluarga URL itu tak pernah ada, lihat di bawah), dan klaim bahwa `awcms-astro` tidak butuh perubahan itu **SALAH** dan digantikan [ADR-0114](0114-the-edge-owns-the-legacy-301s-and-an-article-is-found-by-its-id.id.md). Keputusan perataan untuk bentuk 2 dan 3 TIDAK berubah.
- **Diamandemen oleh:** [ADR-0114](0114-the-edge-owns-the-legacy-301s-and-an-article-is-found-by-its-id.id.md) — 301-nya dieksekusi di **TEPI**, bukan di aplikasi mana pun, dan URL artikel legacy dikunci pada digit terdepannya alih-alih pada path eksak. Tujuan yang dipilih ADR ini TIDAK berubah; pemikulnya berubah.
- **Terkait:** Issue #711 (paruh cutover SeputarBorneo yang dibuka oleh ADR ini); Issue #599 (paruh yang sudah siap cutover); ADR-0045 / ADR-0070 (kosakata URL publik dibelah, dan arsip berita dirender oleh `ahliweb/awcms-astro`); ADR-0039 (tata kelola redirect); ADR-0111 (aturan yang tak bisa menyala lebih buruk daripada tanpa aturan); `sql/060` §2 (aturan path-eksak saja, secara sengaja); PRD §9.2 (tidak ada rantai lebih dari satu hop)

## Konteks

Berkas `.htaccess` legacy di `/home/data/dev_php/seputarborneo.com/.htaccess` memuat **lima** bentuk rewrite, bukan dua seperti yang disebut setiap versi rencana:

```
^news/([^/]*)\.html$          -> /berita/?news=$1          # artikel   — #599
^rubrik/([^/]*)\.html$        -> /rubriks/?news=$1         # rubrik    — DI SINI
^([^/]*)/([^/]*)\.html$       -> /rubriks/?news=$1&kt=$2   # catch-all — DI SINI
^cari_berita/([^/]*)\.html$   -> /pencarian/…              # MATI — tak pernah tercapai
^([^/]*)\.html$               -> /data/?halaman=$1         # halaman   — #599
```

**Baca URUTAN tabel itu, bukan cuma barisnya.** Catch-all-nya adalah baris **6**
`.htaccess` dan `cari_berita` baris **7**, jadi bentuk 4 duduk **DI BAWAH**
aturan yang sudah mengklaim setiap path yang mungkin dicocokinya. ADR ini semula
mencetak tabelnya dalam urutan ini dan tetap memutuskan bentuk 4; lihat
pencabutannya di bawah.

Bentuk 2 dan 3 terblokir, dan issue-nya menyebut dua pemblokir. **Yang pertama tidak ada.** Daftar rubrik dikira hilang karena dump `seputa58_sbb.sql` di salinan kerja berukuran 0 byte. Memang benar 0 byte — dan memang bukan di situ datanya: `docker-compose.yml` me-mount berkas itu hanya sebagai seed initdb sementara datadir-nya adalah volume bernama `seputarborneocom_db_data`, yang berisi 411 MB. Skrip initdb hanya jalan terhadap datadir KOSONG, jadi berkas kosong itu inert sejak volume-nya pertama kali terisi.

Tidak ada pula _tabel_ rubrik, karena memang tidak pernah dimaksudkan ada. `include/rubrik.php` menjawab dengan `SELECT … FROM berita_red_tayang WHERE jenis_rubrik = ? AND kategori = ?` — `jenis_rubrik` dan `kategori` adalah **kolom pada `berita_red`**. Terukur terhadap salinan buangan dari volume itu: **25.029 artikel, 47 `jenis_rubrik` berbeda, 46 `kategori` berbeda, 102 pasangan berbeda.**

**Pemblokir kedua adalah yang sesungguhnya, dan itulah ADR ini.** Ke mana URL-URL itu harus mendarat adalah pertanyaan tentang kosakata yang BUKAN milik repo ini: ADR-0045/ADR-0070 menempatkan arsip berita di `ahliweb/awcms-astro`. Rute repo itu adalah `/kategori/[slug]` (dengan `/halaman/[nomor]`), `/tag/[slug]`, `/[tab]` dan `/[tab]/[...slug]`, serta `/cari` — **satu** tingkat kategori, sedangkan arsip legacy punya dua.

## Keputusan

**1. Bentuk 2 dan 3 keduanya 301 ke `/kategori/{jenis_rubrik}`. Segmen `kt` dibuang.** (Semula tertulis `seo_title(jenis_rubrik)`; lihat amandemen pertama — segmennya adalah NILAI KOLOM mentah, dan petanya dikunci sesuai itu.)

**~~2. Bentuk 4 301 ke `/cari?q={kueri ter-percent-encode}`.~~ DICABUT — lihat §Bentuk 4 tak pernah ada.** Aturan yang diputuskannya tak pernah menyala di situs legacy, jadi tidak ada keluarga URL semacam itu untuk di-redirect.

### Mengapa meratakan, dan bukan ketiga alternatifnya

- Ia menyasar rute yang **sudah dimiliki** `awcms-astro`, jadi cutover tidak butuh rute baru di sana, tidak butuh permukaan list-API baru di sini, dan tidak butuh langkah kontrak lintas-repo keempat.
- Ia satu hop, sebagaimana dituntut PRD §9.2.
- Pembaca mendarat di daftar yang **lebih luas** daripada yang ia minta, tidak pernah di daftar yang salah. Justru properti itulah yang hilang pada alternatifnya.

**Kategori + tag** (`jenis_rubrik` → kategori, `kategori` → tag) juga tidak butuh rute baru, dan keduanya ada di `awcms-astro`. Ditolak karena ia membuang AND-nya: `/hukum/pidana.html` akan mendarat di setiap artikel ber-tag `pidana` dari SEMUA rubrik, yang merupakan halaman yang benar-benar salah, bukan sekadar terlalu luas.

**Slug komposit per pasangan** (`/kategori/hukum-pidana`) mempertahankan granularitasnya persis dan tetap satu hop. Ditolak karena ia menciptakan kosakata beranggota 102 yang tidak pernah dipilih editor mana pun, dan daftar kategori sebesar itu berhenti menjadi navigasi.

**Rute bersarang `/kategori/[slug]/[sub]`** di `awcms-astro` adalah satu-satunya opsi yang mempertahankan pasangannya secara persis. Ditolak sebagai yang termahal di daftar ini — rute baru, taksonomi dua tingkat atau filter komposit pada list-API repo ini, dan kontrak ADR-0045/0070 yang baru — dibeli demi penghalusan yang belum terbukti dibutuhkan arsipnya.

### DIAMANDEMEN 26 Agustus 2026 — bagian normalisasi di bawah ini SALAH

Keputusan di atas TIDAK berubah. Mekanismenya yang tertulis berubah, dan
koreksinya penting karena ia mengubah apa yang dibangun.

**ADR ini menyatakan petanya berkunci pada `seo_title(jenis_rubrik)`.
`seo_title()` adalah KODE MATI.** Ia _didefinisikan_ sembilan kali di pohon PHP
legacy dan **dipanggil NOL kali** — dan kesembilan salinannya bahkan tidak
seragam: `index.php` mengganti spasi dengan `_` sementara delapan lainnya
memakai `-`. `rubriks/index.php` mengikat segmen URL secara **MENTAH**, setelah
`trim()`, langsung ke `WHERE jenis_rubrik = ? AND kategori = ?`. Segmen URL
rubrik legacy adalah NILAI KOLOM-nya, bukan slug dari nilai itu.

**Maka peringatan `MITRA BORNEO` / `MITRA-BORNEO` juga salah.** Tanpa
slugifikasi keduanya adalah `/rubrik/MITRA%20BORNEO.html` dan
`/rubrik/MITRA-BORNEO.html` — path BERBEDA yang tak pernah runtuh menjadi satu.
Keduanya pun tidak ditautkan dari mana pun di situs itu, jadi keduanya tidak
membutuhkan aturan sama sekali.

**Bagaimana kekeliruan ini terjadi, karena itulah bagian yang bisa dipakai
ulang.** Klaimnya masuk sebagai PROSA di komentar issue, terbawa ke ADR ini, dan
tak pernah diadu ke sebuah CALL SITE — bentuk yang sama dengan fungsi
`replaceMenuItems` yang tidak pernah ada (PUTARAN NAMA) dan kolom
`awcms_blog_pages.legacy_source_*` yang tak punya pembaca. Fungsi yang DIKUTIP
tapi tak pernah DIPANGGIL terbaca persis seperti fungsi yang berjalan.
**Grep CALL-nya, bukan definisinya.**

### Sebenarnya URL-nya apa

Tidak ada apa pun di pohon legacy yang MENGHASILKAN tautan rubrik dari nilai
kolom. Semuanya literal ketik-tangan, dan justru itulah yang membuatnya
**terenumerasi dan LENGKAP**, bukan sampel — crawler hanya bisa menjangkau apa
yang ditautkan. Jumlahnya **67**, dan seluruhnya di-commit bersama provenance-nya
di `data/seputarborneo-legacy/rubrik-redirects.json`.

Dua sifat himpunan itu menentukan pekerjaannya:

- **Kapitalisasi menanggung beban DI SINI dan tidak di situs legacy.**
  `utf8mb4_unicode_ci` MariaDB membuat `rubrik/Hukum.html` dan
  `rubrik/hukum.html` halaman yang sama (5.183 artikel masing-masing).
  `awcms_seo_redirects` mencocokkan `normalized_source_path` dengan
  **KESAMAAN**, dan `normalizeRedirectPath` MEMPERTAHANKAN kapitalisasi —
  sehingga **kedua ejaan butuh aturannya sendiri**. Lima rubrik ditautkan dalam
  dua kapitalisasi.
- **32 dari 67 resolve ke NOL artikel** — tautan nav dan footer yang mati,
  bertahun-tahun, menyajikan HTTP 200 dengan listing KOSONG alih-alih 404,
  sehingga mesin pencari kemungkinan besar mengindeksnya sebagai halaman tipis.
  Delapan di antaranya sisa dari template asal situs ini dan menyebut tempat di
  **Sumatera Selatan** (`daerah/Kikim%20Area.html`, `daerah/Lahat%20Kota.html`,
  …). `rubrik/Olah Raga.html` mati karena alasan yang instruktif: nilai kolomnya
  `OLAHRAGA`, tanpa spasi, dan kolasi case-insensitive tidak menutup perbedaan
  SPASI.

**URL mati 301 ke arsip segmen PERTAMA-nya bila segmen itu resolve** — 27 dari
32, sebuah perbaikan atas 200-kosong bagi pembaca dan konsolidasi bagi crawler.
Sisa **5 yatim** (`rubrik/kuliner`, `rubrik/Olah Raga`, `rubrik/pariwisata`,
`rubrik/travel`, `rubrik/Viral`) tidak punya tujuan dan **tidak diberi aturan**;
410 tidak bisa diekspresikan karena `RedirectStatusCode` hanya 301/302/307/308,
jadi alternatif dari sebuah aturan adalah 404.

Hasilnya **62 aturan atas 10 kategori tujuan** — dan karena keputusannya
membuang `kt`, setiap URL dari kedua bentuk mendarat di arsip rubrik INDUK-nya,
sehingga seluruh petanya adalah fungsi dari segmen pertama saja.

### DICABUT 26 Agustus 2026 — bentuk 4 TAK PERNAH ADA

Bagian yang digantikan ini memutuskan `/cari_berita/{q}.html` harus 301 ke mana,
dan berdebat tentang subset mana dari keluarga tak terbatas yang layak diberi
aturan. **Tidak pernah ada URL semacam itu yang disajikan oleh aturan tersebut.**
Seluruh pertanyaannya kosong.

**Mekanismenya adalah URUTAN aturan.** Di `.htaccess`, catch-all dua-segmen
`^([^/]*)/([^/]*)\.html$` adalah baris **6** dan `^cari_berita/([^/]*)\.html$`
baris **7** — dan bahasa bentuk 4 adalah **SUBSET** ketat dari bahasa catch-all.
Kedua vhost docker membawa pasangan yang sama dalam urutan yang sama (baris
33/34), dan aturan 3 selalu mendahului aturan 4 di SETIAP commit yang pernah
menyentuh berkas itu. `mod_rewrite` mengevaluasi aturan dari atas ke bawah, jadi
baris 7 MATI: saat ia dipertimbangkan, URL-nya sudah ditulis ulang menjadi
`/rubriks/?news=cari_berita&kt=q` dan tidak lagi diawali `cari_berita/`.

**Ini soal URUTAN, bukan flag `[L]`.** Membuang `[L]` tidak menghidupkannya
kembali. `[L]` menghentikan pass yang sedang berjalan; yang mematikan baris 7
adalah string yang diadu dengannya sudah bukan URL legacy itu lagi.

Diverifikasi tiga cara alih-alih diperdebatkan:

- **Brute force.** Atas 3.375 path kandidat, **0** yang mencocoki bentuk 4 tanpa
  sekaligus mencocoki catch-all-nya. Harness yang sama, dijalankan terhadap
  bentuk 4 yang sengaja DILEBARKAN, dengan benar menghasilkan counterexample —
  jadi hasil nol itu adalah pemindai yang BEKERJA, bukan pemindai yang buta.
- **Hidup.** `/cari_berita/sampit.html` dan
  `/rubriks/?news=cari_berita&kt=sampit` berbeda pada tepat SATU baris keluaran
  (`og:url`). Yang pertama disajikan sebagai URL **bentuk-3**.
- **Korpus.** **NOL** dari 5.174 URL terarsip berbentuk `/cari_berita/*.html`, dan
  tidak ada template di pohon legacy yang memancarkan tautan semacam itu.

**Dua hal yang ini larutkan.** Butir terbuka #711 _"aturan `cari_berita` — butuh
sitemap hidup"_ larut DUA KALI: aturannya tak pernah menyala, dan tidak ada
sitemap legacy dan tak pernah ada, baik di pohon maupun di riwayat git. Dan
argumen di atas tentang mengizinkan mesin pola untuk keluarga tak terbatas sedang
menjawab pertanyaan yang tak bersubjek.

**Sisanya nyata dan WAJIB dinyatakan.** `/cari_berita/X.html` hari ini masih
mengembalikan 200 — tetapi sebagai URL **bentuk-3**, yang sudah diputuskan aturan
1 ADR ini. Ia **TIDAK BOLEH** diubah menjadi redirect `/cari?q=`, yang akan
mengirim pembaca ke tempat yang tak pernah dituju situs legacy.

`awcms_seo_redirects` tetap path-eksak saja **secara sengaja** — `sql/060`
menyatakannya di headernya sendiri: _"tidak ADA kolom pattern/regex/rewrite di
mana pun pada tabel ini. Aturan prefix/pattern ditunda ke ADR mendatang justru
karena ia akan memperkenalkan mesin pola (ReDoS)."_ Itu tidak berubah dan ADR ini
tetap tidak mengizinkannya; hanya saja sudah tidak ada lagi keluarga kandidat yang
akan menginginkannya.

### Satu kendala mekanis, diverifikasi terhadap kode alih-alih diasumsikan

- **Garis miring akhir TIDAK disimpan.** `/kategori/hukum/` dinormalisasi menjadi `/kategori/hukum`. Dicatat supaya nilai tersimpannya tidak kelak terbaca sebagai aturan yang berbeda dari yang ditulis.

Kendala kedua yang tercatat di sini — bahwa kueri WAJIB ter-percent-encode sebelum
`validateRedirectTarget` menerimanya — memang benar tentang kodenya dan kini TANPA
PEMANGGIL, karena ia ada semata untuk melayani aturan bentuk-4 yang dicabut.
`normalizeRedirectPath` tetap menolak spasi sebagai pertahanan
CRLF/header-injection; tidak ada lagi apa pun di cutover ini yang menulis target
ber-query.

## Konsekuensi

**Provenance term TIDAK dibutuhkan, dan itu menjawab butir Definition of Done ketiga #711 dengan MELARUTKANNYA alih-alih membangunnya.** Butir itu menawarkan pilihan antara menambah `legacy_source_id` pada `awcms_blog_terms` dan menulis tangan `--term-map`. Di bawah keputusan ini, bentuk 2 dan 3 menjadi aturan path-eksak → path-eksak yang resolve tanpa pernah mencari baris term, jadi keduanya tidak diperlukan. Ini penting melampaui kepraktisan: `sql/147` baru saja menghapus pasangan `awcms_blog_pages.legacy_source_*` yang ditambahkan atas penalaran yang sama dan tak pernah dikawatkan ke pembaca. Menambah kolom provenance mati KEDUA untuk menjawab kebutuhan yang sudah tidak ada akan mengulangi itu persis.

**KESEPULUH kategori tujuan WAJIB sudah ada di tenant sebelum cutover.** Bila tidak, setiap aturan 301 ke 404 — kegagalan ADR-0111 satu langkah bergeser, dan persis akibat yang dilarang Definition of Done #711 sendiri. Petanya bisa diturunkan, tetapi tidak aman dimuat sebelum tujuannya nyata.

Paragraf ini semula berbunyi "47-atau-kurang", dan angka itu TIDAK PERNAH menjadi daftar periksa go-live. **47 adalah batas ATAS `jenis_rubrik`, bukan jumlah tujuan**, dan angka itu sendiri hasil `utf8mb4_unicode_ci` MariaDB: `DISTINCT` case-insensitive melaporkan 47/46, sementara map JS yang berkunci nama EKSAK atas baris yang sama melihat **48/45**. Peta yang dibangun punya **10** tujuan berbeda, dinamai di `data/seputarborneo-legacy/README.md`: `bisnis`, `budaya`, `daerah`, `hukum`, `mitra-borneo`, `nasional`, `olahraga`, `politik`, `provinsi`, `wisata`.

**~~`awcms-astro` tidak butuh perubahan untuk ini.~~ SALAH — lihat [ADR-0114](0114-the-edge-owns-the-legacy-301s-and-an-article-is-found-by-its-id.id.md).** Paragraf ini menegaskan "redirect-nya diselesaikan di repo ini sebelum rute-rutenya tercapai". Tidak, dan memang tidak bisa: `/kategori/**` disajikan `ahliweb/awcms-astro`, jadi permintaan untuknya TIDAK PERNAH mencapai middleware repo ini — satu-satunya tempat `awcms_seo_redirects` pernah diterapkan. Seluruh 67 entri yang di-commit diputar ulang terhadap server hasil build repo itu dan mengembalikan 404 dengan NOL header `Location`. ADR-0114 memindahkan 301-nya ke TEPI dan mempertahankan setiap tujuan yang dipilih ADR ini.

**Yang tersisa di #711 BUKAN pemuatan tabel.** Petanya sudah dibangun dan di-commit (`data/seputarborneo-legacy/`), dan setiap source path serta target di dalamnya diperiksa terhadap `normalizeRedirectPath` / `validateRedirectTarget` / `isValidSlug` pada setiap kali test — yang tetap pemeriksaan BENTUK yang berguna meskipun, di bawah ADR-0114, fungsi-fungsi itu bukan lagi yang akan mengeksekusi redirect-nya. Yang tersisa: membuat kesepuluh kategori tujuan, meng-generate artefak tepi, dan mengawatkannya. Tidak ada aturan `cari_berita` yang perlu ditulis, dan tidak ada sitemap legacy untuk menuliskannya.
