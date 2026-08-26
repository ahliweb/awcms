🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0114-the-edge-owns-the-legacy-301s-and-an-article-is-found-by-its-id.md)

<!-- i18n-source-hash: sha256:8804aac81359afb174fe1ac7f1ea14da8d518f14ce889304df0e4418a85e0386 -->

# ADR-0114 — Tepi (edge) yang memikul 301 legacy, dan artikel legacy dicari lewat ID-nya

- **Status:** Accepted
- **Tanggal:** 2026-08-26
- **Pengambil keputusan:** ahliweb
- **Menyempurnakan (supersede parsial):** [ADR-0113](0113-a-legacy-rubrik-pair-flattens-to-its-rubrik.id.md) — §Konsekuensi-nya menyatakan _"**`awcms-astro` tidak butuh perubahan untuk ini.** Ia membaca menu, term dan post; redirect-nya diselesaikan di repo ini sebelum rute-rutenya tercapai"_. **Kalimat itu SALAH**, dan itulah kekeliruan paling berkonsekuensi dalam catatan cutover ini: tujuan yang dipilihnya disajikan oleh repo yang entrypoint produksinya TIDAK memuat kode redirect sama sekali. Yang di-supersede adalah **SIAPA yang mengeksekusi 301-nya** dan **BAGAIMANA URL artikel dikunci** — bukan perataannya, yang tetap berlaku: `/rubrik/X.html` dan `/A/B.html` tetap mendarat di arsip rubrik INDUK-nya, `kt` tetap dibuang. Keputusan bentuk-4 ADR-0113 dicabut di tempat, karena keluarga URL yang diputuskannya TIDAK PERNAH ADA.
- **Terkait:** Issue #711 (paruh rubrik/listing cutover SeputarBorneo); Issue #599 (paruh artikel); [ADR-0045](0045-jualanku-porting-awcms-system-of-record-astro-bff.md) / [ADR-0070](0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md) / [ADR-0071](0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md) (kosakata URL publik dibelah, dan arsip berita dirender oleh `ahliweb/awcms-astro`); [ADR-0039](0039-seo-distribution-redirect-governance.md) (tata kelola redirect); [ADR-0042](0042-varnish-edge-cache-auto-activation.md) / [ADR-0061](0061-host-resolved-public-surfaces-are-edge-cacheable.md) (edge Varnish di depan permukaan publik); [ADR-0111](0111-a-tenants-exact-redirect-beats-a-retired-family-rewrite.id.md) (aturan yang tak bisa menyala lebih buruk daripada tanpa aturan); `sql/060` §2 (aturan path-eksak saja, secara sengaja); PRD §9.2 (tidak ada rantai lebih dari satu hop)

## Konteks

### Tiga lapis bisa memikul 301 ini, dan tidak satu dokumen pun menyebut yang mana

`seputarborneo.com` akan menjadi tenant. URL-URL terindeksnya WAJIB mencapai
halaman baru dalam **satu hop**. Tiga lapis berdiri di jalur permintaan itu —
tepi (Coolify/Varnish), `ahliweb/awcms-astro`, dan repo ini — dan setiap rencana
yang ditulis sejauh ini mengasumsikan yang ketiga tanpa pernah menyebutkannya,
karena repo inilah yang punya tabel redirect.

### Tujuan peta yang sudah dikirim disajikan origin yang TIDAK punya kode redirect

`awcms_seo_redirects` diterapkan di **tepat SATU call site**:
`resolvePublicRedirectForRequest`, dipanggil dari `src/middleware.ts:341`.
Middleware itu berjalan di aplikasi **INI**. Semua yang bisa di-redirect olehnya
adalah permintaan yang diterima aplikasi ini.

ADR-0113 memilih `/kategori/{slug}` sebagai tujuan seluruh 62 aturan rubrik.
`/kategori/**` disajikan oleh `ahliweb/awcms-astro`, yang ber-`output: "static"`,
**tidak punya berkas middleware sama sekali**, tidak mendeklarasikan kunci
`redirects:`, dan entrypoint produksinya `server/penyaji.mjs` memuat **NOL**
kemunculan `301` maupun `Location`. `grep -rn seputarborneo` atas seluruh `src/`
dan `docs/` repo itu mengembalikan **nihil**.

Ini bukan hasil penalaran — ini dijalankan. Seluruh 67 entri rubrik yang
di-commit diputar ulang terhadap server hasil build yang sesungguhnya: **404 pada
setiap satunya, dengan NOL header `Location`**. Aturan yang ditulis ke tabel repo
ini tidak pernah dikonsultasikan untuk permintaan yang tidak pernah tiba di sini.

Jadi kalimat di ADR-0113 §Konsekuensi itu persis terbalik. `awcms-astro` bukan
"tidak butuh perubahan karena redirect-nya diselesaikan di sini" — di bawah
rencana itu, ia justru satu-satunya tempat redirect itu BISA diselesaikan, dan
ia tidak menyelesaikan apa pun.

### Dan bentuk artikel, yang dikira #599 sudah beres, juga tidak mencocoki apa pun

URL artikel legacy adalah `rawurlencode(str_replace(' ', '_', judul))`, jadi
setiap segmennya membawa `_`. Seluruh **25.029** judul legacy memuat sedikitnya
satu spasi, jadi seluruh 25.029 segmen membawa sedikitnya satu `_`.
`SLUG_PATTERN` di
`src/modules/blog-content/domain/legacy-import-record.ts:117` adalah
`/^[a-z0-9]+(?:-[a-z0-9]+)*$/` — ia **MELARANG** `_` dan melarang kapital.
`normalizeRedirectPath` mempertahankan kapitalisasi dan tidak men-decode apa pun,
dan pencocokannya dengan KESAMAAN (`application/redirect-directory.ts:133`).

**Tidak ada slug yang bisa lolos validator yang bisa sama dengan segmen
terindeks itu.** Kedua slug itu terpisah SECARA KONSTRUKSI, bukan kebetulan.
Dikonfirmasi dari luar: dari 2.297 URL `/news/*.html` yang terarsip, 2.297
memakai bentuk underscore dan 0 memakai bentuk hyphen.

Dan meleset di sini lebih buruk daripada sekadar meleset. `/news/**` yang tak
tercocokkan jatuh ke `resolveRetiredNewsRedirect`
(`src/modules/seo-distribution/application/redirect-resolution-service.ts:126`),
yang 301 ke `/blog/{code}/{id}_{Raw_Slug}.html` — path yang tidak dimiliki post
mana pun. Itu persis `CUTOVER_VERDICT_REASON.target_missing` dengan kata-katanya
sendiri: _"301 ke dalam 404, yang lebih buruk daripada 404 yang digantikannya"_.

Kekeliruan penalarannya layak dinamai supaya tidak terulang. `berita/index.php:9`
membaca `(int) $_GET['news']`, jadi pada router **LEGACY** id-nya adalah digit
terdepan dan slug-nya dekoratif. Itu BENAR, dan itu sama sekali tidak berkata
apa pun tentang repo ini, yang kunci aturannya adalah **string EKSAK**. Fakta
tentang satu router terbawa sebagai fakta tentang router yang lain.

## Keputusan

**1. Tepi (Coolify/Varnish) memikul 301 legacy SeputarBorneo.** Saat
`seputarborneo.com` menjadi tenant, redirect-nya dieksekusi di tepi, sebelum
aplikasi mana pun melihat permintaannya.

**2. URL artikel legacy resolve pada DIGIT TERDEPAN-nya.**
`/news/{id}_{Judul}.html` dikunci pada `{id}` terhadap
`awcms_blog_posts.legacy_source_id`, tidak pernah pada slug turunan judul. Ia
dimaterialisasi untuk tepi sebagai tabel id→path ter-generate.

### Mengapa tepi, dan bukan salah satu aplikasinya

Hanya tepi yang bisa meruntuhkan ketiga redirect yang sungguh dibutuhkan pembaca
— `http→https`, `www→apex`, dan `legacy→baru` — menjadi **SATU** 301. Itulah yang
dituntut PRD §9.2, dan tidak satu pun lapis aplikasi bisa menyampaikannya: sebuah
aplikasi baru melihat permintaan SETELAH terminasi TLS dan setelah apa pun yang
sudah dilakukan tepi terhadap host-nya, jadi aturan yang ditulisnya paling baik
adalah hop **KEDUA** dari rantai yang dimulai tepi. Satu hop di sini bukan
optimasi; ia persyaratan.

Sisanya mengikut dari situ. Tepi juga satu-satunya lapis yang berdiri di depan
**KEDUA** origin, jadi ia tidak perlu tahu origin mana yang akan menyajikan
URL-nya — dan justru ketiadaan pengetahuan itulah yang menghasilkan klaim
terfalsifikasi di atas.

### Mengapa berkunci-ID, dan bukan satu aturan per URL

- **Ia kebal terhadap pergeseran judul.** Aturan path-eksak mengekalkan judul
  sebagaimana ia berdiri pada hari peta dibangun. Editor yang membetulkan satu
  salah ketik pada 2027 tidak membatalkan pencocokan digit-terdepan; ia
  membatalkan 1 dari 25.029 aturan eksak, secara SENYAP.
- **Ia kebal terhadap KEDUA encoding historis.** Arsipnya memuat segmen bentuk
  `%20` dan bentuk `_` dari era situs legacy yang berbeda. Keduanya membawa digit
  terdepan yang sama.
- **Ia satu bentuk aturan alih-alih sekitar 33.779 baris** — jumlah source path
  eksak yang harus dipikul peta ber-kesamaan untuk menutupi arsip sebagaimana ia
  benar-benar terindeks. Tabel sebesar itu tidak bisa direview, dan setiap
  barisnya adalah satu peluang salah dengan cara yang tak bisa dilihat siapa pun.
- **ID yang tak dikenal menghasilkan 404 SEJATI**, bukan 301 ke dalam 404. Itulah
  satu-satunya properti yang keberadaannya dilindungi
  `CUTOVER_VERDICT_REASON.target_missing`, dan pencocokan path-eksak atas slug
  yang tak mungkin cocok kehilangan properti itu sejak awal.

### Apa yang ini buat INERT, dinyatakan terang supaya tak ada yang meraihnya

**`awcms_seo_redirects` BUKAN mekanisme untuk cutover ini.** Begitu pula flag
`--path-template` pada `blog:legacy:redirects:import`. Keduanya bekerja, keduanya
ter-test, dan keduanya menulis aturan ke tabel yang dikonsultasikan oleh
middleware yang TIDAK akan pernah dicapai permintaan-permintaan ini. Keduanya
tetap alat yang tepat bagi tenant yang me-redirect path yang disajikan aplikasi
**INI**; keduanya alat yang salah di sini, dan catatannya sampai sekarang berkata
sebaliknya.

Karena itu yang diserahkan repo ini adalah **artefak ter-generate beserta
provenance-nya** — tabel id→path dan peta rubrik, diturunkan di sini, di-commit di
sini, dimuat oleh tepi. Mengawatkannya ke Varnish/Coolify adalah langkah
OPERASIONAL, bukan sebuah commit.

## Konsekuensi

- **Repo ini TIDAK BISA menutup cutover-nya.** Ia bisa memproduksi dan
  memverifikasi artefaknya; langkah terakhir terjadi di konfigurasi infrastruktur
  yang hidup di luar kedua repositori. Issue mana pun yang menyatakan cutover
  "selesai" begitu artefaknya di-commit sedang menyatakan hal yang keliru.
- **Ke-62 aturan rubrik mempertahankan tujuannya dan berganti PEMIKUL.** Tidak
  ada tujuan yang berubah, jadi kesepuluh kategori tujuan tetap prasyarat — hanya
  saja kini prasyarat bagi peta **TEPI**, bukan bagi pemuatan tabel di sini.
- **`blog:legacy:cutover:verify` memverifikasi lapis yang SALAH** untuk URL-URL
  ini selama ia memodelkan resolusi repo ini. Yang diprediksinya adalah apa yang
  akan dilakukan `src/middleware.ts`, dan untuk tujuan `/kategori/**` itu bukan
  yang akan dilihat crawler. Membetulkannya adalah KODE, dan itu milik fase
  setelah ini.
- **Tabel ter-generate tetaplah tabel ter-generate.** Artefak id→path diturunkan
  dari basis data legacy dan post yang sudah diimpor; ia DI-REGENERASI, tidak
  pernah disunting tangan, dan ia membawa provenance yang menyebut snapshot mana
  yang menghasilkannya — aturan yang sama yang sudah diikuti
  `data/seputarborneo-legacy/rubrik-redirects.json`.
- **Satu hitungan yang salah di seluruh catatan, dikoreksi SEKALI, di sini.**
  "23.906 artikel" muncul di badan Issue #599, di empat changeset, di ADR-0111, di
  dua header migration dan di dua puluhan komentar sumber. Snapshot terukurnya
  **25.029**, dan situs legacy yang hidup sudah di id ≥ 25.474. Dokumen yang
  membuat klaim HIDUP dikoreksi; changeset dan ADR ter-merge **TIDAK** ditulis
  ulang, karena keduanya merekam apa yang diyakini saat ditulis dan menulis
  ulangnya akan memusnahkan satu-satunya bukti kapan keyakinan itu berubah.
  Paragraf inilah koreksi yang mereka tunjuk.

## Alternatif yang dipertimbangkan

**`ahliweb/awcms-astro` memikul redirect-nya.** Ia origin yang menyajikan
tujuannya, jadi opsi inilah yang tampak paling jelas begitu cacat di atas
terlihat. Ditolak atas biaya dan atas jumlah hop. Ia butuh tabel redirect
build-time yang dikompilasi ke `server/penyaji.mjs`, yang hari ini sama sekali
tidak memuat kode redirect, ditambah tarian kontrak lintas-repo tiga langkah
penuh (permukaan di-commit di sana, dipanggil di sini, lalu dikonsumsi) untuk
setiap perubahan petanya. Dan ia TETAP tidak bisa menyampaikan satu hop, karena
`http→https` dan `www→apex` terjadi di depannya. Ada satu jebakan yang layak
dicatat bagi siapa pun yang meninjau ulang ini: kunci konfigurasi `redirects:`
Astro di bawah `output: "static"` memancarkan **HTML meta-refresh, BUKAN 301** —
redirect yang diikuti browser dan diperlakukan crawler sebagai HALAMAN, yang akan
lolos pemeriksaan manual sekilas sambil kehilangan ekuitas peringkat yang justru
menjadi alasan keberadaan seluruh cutover ini.

**Repo ini memikul redirect-nya, sebagaimana diasumsikan ADR-0113.** Ia bekerja
persis sebagaimana dibangun — tabelnya, importer-nya dan middleware-nya semuanya
benar — tetapi hanya untuk path yang disajikan aplikasi ini. Membelinya berarti
memindahkan seluruh 62 tujuan rubrik dari `/kategori/{slug}` ke
`/blog/{tenantCode}/category/{slug}`, yang mengirim setiap URL rubrik legacy ke
**paruh yang SALAH dari kosakata yang dibelah**, dan akan menuntut penyataan
ulang batas ADR-0071 (`/blog/**` di sini, `/news/**` di sana) untuk domain ini.
Ditolak: lapis redirect yang dipilih karena ia lapis yang kebetulan sudah kita
miliki adalah cara sebuah keputusan kosakata URL diambil secara TIDAK SENGAJA.

**Tulis saja 25.029 aturan artikel eksak, dengan slug-nya dibetulkan.** Ditolak
oleh aritmetika sebelum ditolak oleh selera: perbaikannya berarti melonggarkan
`SLUG_PATTERN` agar menerima `_` dan kapital, yang mengubah APA ITU slug bagi
setiap tenant di produk ini demi melayani satu migrasi. Dan ia tetap 25.029 baris
yang basi begitu seorang editor mengganti nama satu artikel.
