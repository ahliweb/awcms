🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0115-the-migrated-archive-lands-on-one-origin-and-the-importer-must-say-where.md)

<!-- i18n-source-hash: sha256:4e6b61935472fb3d2f329d0e7193c2b76496f1b0dfe501c77fa4a76be8701173 -->

# ADR-0115 — Arsip yang dimigrasikan mendarat di SATU origin, dan importer WAJIB menyebut ke mana tiap artikel pergi

- **Status:** Accepted
- **Tanggal:** 2026-08-26
- **Pengambil keputusan:** ahliweb
- **Melengkapi:** [ADR-0114](0114-the-edge-owns-the-legacy-301s-and-an-article-is-found-by-its-id.id.md) — ia memutuskan bahwa artikel legacy resolve pada **digit terdepan**-nya dan bahwa 301-nya diterbitkan di **tepi**, lalu membiarkan **TUJUAN** tabel id→path itu tak dinyatakan. Satu-satunya penurunan artikel di repo ini meng-hardcode `/blog/{tenantCode}/{slug}`, sehingga kedua paruh ter-commit dari SATU cutover menunjuk **DUA origin berbeda**. ADR ini menyatakan tujuannya dan menutup itu.
- **Terkait:** Issue #599 (paruh artikel cutover SeputarBorneo); Issue #711 (paruh rubrik); [ADR-0113](0113-a-legacy-rubrik-pair-flattens-to-its-rubrik.id.md) (listing rubrik diratakan ke `/kategori/{slug}`); [ADR-0071](0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md) (kosakata URL publik dibelah per repo); [ADR-0100](0100-portable-text-is-the-canonical-body-format.id.md) (`content_json.blocks` adalah proyeksi turunan, dan `contentJson.awcmsAstro` adalah sidecar yang WAJIB dipertahankan repo ini); [ADR-0098](0098-the-cache-key-carries-the-locale-in-the-path.id.md) (permukaan publik repo INI ber-prefix locale); [ADR-0111](0111-a-tenants-exact-redirect-beats-a-retired-family-rewrite.id.md) (aturan yang tak bisa menyala lebih buruk daripada tanpa aturan); PRD §9.2 (tidak ada rantai lebih dari satu hop)

## Konteks

### Importer menghasilkan artikel yang halamannya TIDAK dibangun repo penyaji

`importLegacyBlogPost` menulis `content_json` sebagai `{ blocks: [] }` yang
di-hardcode. Docblock-nya sendiri menyebut itu _"proyeksi lossy yang sama dengan
yang dihasilkan setiap jalur tulis lain … sehingga baris hasil impor tak
terbedakan bentuknya dari baris hasil penulisan"_. Ternyata TIDAK:
`blog-post-directory.ts` dan `blog-page-directory.ts` sama-sama memanggil
`withProjectedBlocks`, dan berkas ini tidak memanggil apa pun. **Komentar bukan
panggilan** — kelas berulang repo ini, dan di sini ia menentukan seluruh cutover.

Satu literal itu mengendalikan DUA hal terpisah di `ahliweb/awcms-astro`:

1. `renderContentBlocks(post.contentJson)` membaca `contentJson.blocks` dan
   mengembalikan `""` untuk apa pun yang bukan array tak-kosong. Setiap artikel
   hasil impor akan menjadi **halaman KOSONG**.
2. `getArticles(tab, locale)` hanya menyimpan post ketika
   `readBlock(post).kategori === tab`, membaca `contentJson.awcmsAstro`. Tanpa
   kunci itu perbandingannya `undefined === tab` untuk SETIAP tab terkonfigurasi,
   jadi post-nya **tidak dibangun sama sekali** — dan arsip kategori pun tidak,
   karena `artikelSemuaSeksi` menyusunnya dari himpunan ter-filter-tab yang sama.

Bukan hasil penalaran — dijalankan. Terhadap adapter sungguhan repo itu, post
yang membawa sidecar membangun **1** artikel; post yang ditulis persis seperti
importer ini menulisnya membangun **0**, di setiap tab terkonfigurasi.

Jadi 63 aturan rubrik ADR-0113 dan peta artikel ber-kunci-id ADR-0114
masing-masing akan me-redirect ke halaman yang tak pernah dibangkitkan —
`CUTOVER_VERDICT_REASON.target_missing` dengan kata-katanya sendiri, _"301 ke
dalam 404, yang lebih buruk daripada 404 yang digantikannya"_, dan itulah satu
hasil yang Definition of Done kedua issue LARANG.

**Mengapa tak ada gerbang di sini yang bisa melihatnya.** Repo ini merender
`/blog/{code}/{slug}` dari `body_portable_text` dan hanya jatuh ke proyeksi untuk
baris yang belum di-backfill (`blog-body-rendering.ts`), jadi post hasil impor
tampak SEMPURNA **di sini**. Konsumen yang membaca proyeksi itu ada di repositori
lain. Itu pelajaran ADR-0114 satu tingkat lebih dalam: pemeriksaannya bukan hanya
_"apakah simbol ini dipanggil"_ dan bukan hanya _"apakah pemanggilnya ada di
jalur permintaan"_, melainkan **"apakah repo yang MENYAJIKAN ini membaca field
yang dilewatkan penulis ini"**.

### Dan tujuannya tak pernah dipilih

ADR-0113 mengirim listing rubrik ke `/kategori/{slug}`, disajikan `awcms-astro`.
Setelah itu tidak ada yang menyebut ke mana ARTIKELNYA pergi. Satu-satunya
penurunan artikel di repo ini, `listLegacyRedirectMappings`, membangun
`` `/blog/${tenantCode}/${row.slug}` `` — permukaan repo **INI**. Satu cutover,
dua origin, dan pembaca yang mengeklik artikel dari sebuah arsip kategori akan
menyeberang di antara keduanya.

### Aturan prefix yang benar di sini dan salah di sana

`withPublicLocalePrefix` (ADR-0098) mem-prefix **SETIAP** locale, termasuk yang
bawaan: `/id/hukum/x`. `localePath` milik `awcms-astro` melakukan sebaliknya — ia
mengembalikan path **apa adanya** untuk locale bawaannya dan hanya mem-prefix
selainnya. Seluruh 25.029 artikel SeputarBorneo berada di locale bawaan, jadi
artefak yang dibangun dengan aturan repo ini akan me-301 setiap satunya ke dalam 404. Peta rubrik ter-commit sudah mengatakannya terang-terangan: tujuannya
`/kategori/daerah`, bukan `/id/kategori/daerah`.

## Keputusan

**1. Kedua paruh arsip yang dimigrasikan mendarat di SATU origin: `ahliweb/awcms-astro`.**
Path sebuah artikel adalah `/{section}/{slug}/` pada locale bawaan situs penyaji
dan `/{locale}/{section}/{slug}/` selainnya, dengan `{section}` adalah slug tab
situs itu. `/blog/{tenantCode}/**` BUKAN tujuan cutover ini.

Trailing slash itu bentuk KANONIK situs tersebut — build-nya memancarkan
`{tab}/{slug}/index.html`, sitemap-nya mendaftar bentuk ber-slash, dan
`<link rel="canonical">` tiap halaman menyebutnya. Ia sengaja TIDAK dibenarkan
sebagai soal hop: diprobe terhadap server hasil build yang sungguhan, kedua
ejaan menjawab 200 tanpa `Location` sama sekali. Masalahnya adalah 25.029
redirect permanen ke ejaan non-kanonik, dan untuk migrasi yang seluruh tujuannya
mempertahankan peringkat, itu sudah cukup.

**2. `blog:legacy:import` menulis envelope yang dibaca konsumennya.**
`content_json.blocks` menjadi proyeksi TURUNAN (`withProjectedBlocks`, panggilan
yang sama dengan yang dilakukan kedua directory authoring), dan
`content_json.awcmsAstro.kategori` membawa section-nya, dipasok oleh
`--section-map` yang baru.

**3. Section itu DIDEKLARASIKAN, tidak pernah diturunkan.** Section adalah slug
tab di `siteConfig.tabs` repo penyaji. Tidak ada apa pun di basis data ini yang
bisa diperiksa terhadapnya, jadi peta ini satu-satunya peta tanpa sapuan
verifikasi di belakangnya, dan run-nya MENCETAK kosakata yang diserahkan
kepadanya alih-alih berpura-pura memeriksanya.

**4. `--section-map` yang tak diberikan MEMPERINGATKAN; baris yang tak bisa
ditempatkan peta itu DITOLAK.**

### Mengapa satu origin, dan bukan dua seperti yang tersirat di kode saat ini

ADR-0071 membelah kosakata URL publik **satu keluarga per repo, tidak pernah
keduanya di satu repo**. Situs yang arsip kategorinya disajikan satu origin dan
artikelnya disajikan origin lain adalah aturan itu yang patah tepat di jahitan
yang benar-benar diseberangi pembaca: setiap tautan keluar dari `/kategori/hukum`
akan meninggalkan origin yang merendernya. `/blog/{tenantCode}/**` juga membawa
kode tenant di URL publik sebuah situs yang punya domainnya sendiri — bentuk yang
ADR-0071 pertahankan HANYA karena ia pernah diiklankan, bukan bentuk untuk
memigrasikan 25.029 URL terindeks ke atasnya.

### Mengapa dideklarasikan dan bukan diturunkan

Term adalah baris di basis data ini; section adalah nilai di berkas konfigurasi
repositori lain. Keduanya tampak serupa dan tidak sama, dan kegagalan dari
menyamakannya bersifat SENYAP: artikel yang difilekan di bawah term yang tidak
menamai satu pun tab terkonfigurasi terimpor bersih, tidak melaporkan apa pun,
dan tidak dibangun siapa pun. `--term-map` dan `--media-map` masing-masing
diverifikasi terhadap sebuah tabel di sini. Yang ini tidak bisa, dan
mengatakannya lebih berguna daripada mengarang pemeriksaan yang akan lulus
sambil keliru.

### Mengapa peta yang tak diberikan memperingatkan alih-alih menolak

Tenant yang disajikan repo **INI** di `/blog/{tenantCode}/{slug}` sama sekali tak
butuh sidecar. Menolak 25.029 baris demi sebuah repositori yang mungkin tidak
dipakai operatornya akan menjadi kegagalan yang salah. Memasok petanya ADALAH
deklarasi bahwa situs saudaranya menyajikan arsip ini — dan di bawah deklarasi
itu sebuah baris yang tak bisa ditempatkannya ditolak, karena mengimpor
melewatinya menghasilkan persis 301-ke-dalam-404 yang menjadi alasan keberadaan
seluruh cutover ini.

## Konsekuensi

- **Generator artefaknya ADA.** `bun run blog:legacy:article-paths` menurunkan
  tabel id→path dari tenant dan memancarkannya beserta provenance, preview secara
  bawaan. Ia **MENOLAK memancarkan selama masih ada baris tanpa section**:
  artefak yang 96% benar adalah artefak yang tak diaudit siapa pun.
- **`--default-locale` adalah flag WAJIB padanya**, bukan konstanta. Ia nilai
  milik repo penyaji, dan membekukan konfigurasi satu deployment ke dalam sebuah
  generator yang jawaban salahnya senyap adalah kekeliruan ADR-0114 dengan subjek
  berbeda.
- **Verifier tingkat-HTTP ADA.** `bun run blog:legacy:edge:verify` meminta
  URL-URL legacy dan membaca header `Location` yang akan diterima pembaca. Ia
  satu-satunya alat di repo ini yang bisa berkata apa pun tentang tepi, dan ia
  adalah pemutaran ulang yang memfalsifikasi ADR-0113 yang kini dijadikan
  gerbang. `blog:legacy:cutover:verify` tidak berubah dan tetap membuat NOL
  permintaan HTTP; keduanya menjawab pertanyaan berbeda tentang lapis berbeda dan
  keduanya tetap menyebutkan yang mana.
- **DUA verdict baru.** `unsafe_redirect` — hop yang menunjuk skema non-HTTP,
  URL ber-kredensial, atau literal privat/loopback/link-local DITOLAK alih-alih
  diikuti, karena `Location` ditulis oleh apa pun yang menjawab permintaan
  sebelumnya. Sebelum penjaganya ada, hop `file:` dan `data:` sama-sama diikuti
  dan terklasifikasi **`ok`**. Ia memakai ulang `isBlockedAddress` dari
  `ssrf-guard.ts`; `validateOutboundUrl` tak bisa dipakai utuh karena ia MENOLAK
  `http:`, yang justru bentuk yang dipegang crawler, dan `ssrfSafeFetch`
  mengikuti redirect secara internal, yang memusnahkan visibilitas per-hop yang
  menjadi alasan keberadaan job ini. Hostname sengaja tidak di-resolve — sebuah
  BATAS yang dinyatakan untuk CLI yang dijalankan operator, tidak mengirim
  kredensial dan tidak membaca badan respons, bukan lubang. Dan `unreachable`: Permintaan yang tak pernah menghasilkan
  jawaban dulu terklasifikasi sebagai `no_rule`, yang teks alasannya berbunyi
  percaya diri _"URL ini akan menjawab 404 setelah cutover, dan peringkatnya
  hilang"_. Sebuah 502 saat origin sedang restart akan mengirim operator
  membetulkan aturan yang sudah benar. Ini argumen `target_unverifiable` satu
  baris ke samping.
- **`listLegacyRedirectMappings` kini memakai predikat LENGKAP rutenya.** Ia
  menjanjikan _"hanya post PUBLISHED dan tidak terhapus"_ di atas persis dua
  kondisi itu, sementara rute yang menyajikan tujuannya menuntut EMPAT — jadi
  post `private` dan post bertanggal masa depan masing-masing mendapat aturan
  yang tujuannya menjawab 404. Paragrafnya menamai kegagalan yang dihasilkan
  fungsinya sendiri.
- **Tidak ada VCL, nginx `map`, maupun CSV bulk-redirect yang di-generate.**
  `infra/varnish/default.vcl` adalah berkas yang berjalan di produksi
  (`docs/awcms/environments.md`: "disalin verbatim … checksum cocok") dan ia
  meng-`import std` dan tidak lebih — Varnish OSS tidak punya vmod kamus di sana,
  jadi 25.029 lookup ber-kunci tidak terekspresikan di dalamnya. Dua bentuk
  netral ditulis sebagai gantinya, JSON beserta provenance dan TSV dua kolom, dan
  memilih tiernya tetap milik operator. Menebaknya akan menjadi kelas kekeliruan
  yang sama dengan mengasumsikan repo mana yang akan menyajikan sebuah path.
- **Tujuan peta rubrik itu TANPA slash, dan itu properti dari mekanisme yang
  dibuat inert oleh ADR-0114 — bukan inkonsistensi untuk ditutup-tutupi.**
  Seluruh 63 target non-null di `data/seputarborneo-legacy/rubrik-redirects.json`
  berbunyi `/kategori/daerah` sementara halaman arsip situs penyaji
  mengkanonikkan ke `/kategori/daerah/`. Petanya TIDAK BISA berkata lain:
  jalankan `validateRedirectTarget("/kategori/daerah/", [])` dan ia mengembalikan
  `/kategori/daerah` — `awcms_seo_redirects` secara struktural tidak bisa
  menyimpan target ber-trailing-slash, dan builder itu memvalidasi setiap entri
  lewatnya. Jadi bentuk tersimpannya adalah satu-satunya bentuk yang bisa
  diekspresikan tabel itu, dan tabel itulah mekanisme yang dinyatakan inert oleh
  ADR pendahulunya. **Karena itu slash kanonik milik ARTEFAK TEPI, bukan milik
  peta ter-commit**, dan emitter tepi yang diturunkan dari peta itu WAJIB
  menambahkannya persis seperti `consumerArticlePath`. Dicatat alih-alih
  dibetulkan di tempat: menulis ulang catatan derivasi ter-commit agar cocok
  dengan konsumen yang bukan tujuan derivasinya akan memusnahkan provenance yang
  membuatnya bisa diaudit.
- **Kosakata section WAJIB sudah ada di `siteConfig.tabs` repo PENYAJI sebelum
  apa pun ini merender.** `getArticles` dipanggil sekali per tab terkonfigurasi
  dan hanya menyimpan post ketika `readBlock(post).kategori === tab`, jadi slug
  section yang tidak menamai satu pun tab terkonfigurasi membangun NOL — hasil
  nol-halaman yang sama dengan tanpa sidecar sama sekali. "Impor arsipnya lalu
  rebuild" karena itu TIDAK cukup: tab-nya adalah daftar yang di-hardcode di
  repositori itu, dan menambahkan kesepuluh section SeputarBorneo ke dalamnya
  adalah perubahan KODE di sana, berurutan SEBELUM rebuild-nya. Tak ada apa pun
  di sini yang bisa memeriksanya, dan itulah sebabnya importer MENCETAK kosakata
  yang diserahkan kepadanya dan menyuruh membandingkannya dengan berkas itu.
- **Pemblokir media tidak berubah dan masih KERAS.** ~25.031 unggahan / 4,1 GB:
  importer menolak baris mana pun yang `featuredImageSrc`-nya tidak dicakup
  `--media-map`, dan 25.029 dari 25.029 baris memilikinya.
- **Repo ini TETAP tidak bisa menutup cutover-nya**, dan ADR ini tidak mengubah
  itu. Kini ia bisa memproduksi setiap artefak dan memverifikasi hasilnya lewat
  HTTP; pengawatan tepi dan rebuild `awcms-astro` tetap langkah operasional di
  luar kedua repositori.
