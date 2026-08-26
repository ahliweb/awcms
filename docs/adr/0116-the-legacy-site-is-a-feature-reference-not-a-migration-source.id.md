🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0116-the-legacy-site-is-a-feature-reference-not-a-migration-source.md)

<!-- i18n-source-hash: sha256:0d0ec21e7449e936faa11d42912eaa1725cd9e56a451fb083f7682f18d25380f -->

# ADR-0116 — Situs legacy adalah RUJUKAN FITUR, bukan sumber migrasi

- **Status:** Accepted
- **Tanggal:** 2026-08-26
- **Pengambil keputusan:** ahliweb
- **Mengamandemen:** [ADR-0113](0113-a-legacy-rubrik-pair-flattens-to-its-rubrik.id.md), [ADR-0114](0114-the-edge-owns-the-legacy-301s-and-an-article-is-found-by-its-id.id.md), [ADR-0115](0115-the-migrated-archive-lands-on-one-origin-and-the-importer-must-say-where.id.md) — **mekanikanya TETAP tak berubah**; **KEWAJIBAN** yang dilayani masing-masing DICABUT. Lihat §Apa yang diamandemen, dan apa yang tidak.
- **Terkait:** Issue #599 (paruh artikel cutover SeputarBorneo); Issue #711 (paruh rubrik); [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.id.md) (kapabilitas dibangun di sini); [ADR-0071](0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.id.md) (kosakata URL publik dibelah per repo); PRD §41 dan FR-DSC-007 (kewajiban migrasi yang DICABUT ADR ini); PRD §9.2 (tidak ada rantai lebih dari satu hop)

## Konteks

### Kedua issue terbuka berdiri di atas SATU premis, dan premis itu telah dicabut

Issue #599 membukanya dalam satu kalimat: _"Bila SeputarBorneo masuk sebagai
tenant kedua (PRD §41), yang dipindahkan adalah 23.906 artikel yang sudah
diindeks mesin pencari selama bertahun-tahun."_ Segala yang diminta kedua issue
itu turun dari sana: kolom `legacy_source_id`, impor massal redirect, converter
HTML→Portable Text, crawl pra-cutover, peta rubrik, verifier tepi. Masing-masing
ADA untuk memindahkan ekuitas mesin pencari satu dekade tanpa menjatuhkan
satu pun darinya.

Pada **26 Agustus 2026** pemilik produk mencabut premis itu: **tidak semua
artikel dari situs legacy perlu dimigrasikan atau diimpor, dan situs itu dipakai
sebagai RUJUKAN untuk fitur dan fungsionalitasnya.**

Ini bukan koreksi teknis, dan tak ada satu pun di bawah ini yang membantahnya.
Ini keputusan lingkup, dan akibatnya merambat lebih jauh daripada "lewati
impornya" — cukup jauh sehingga membiarkannya tak tertulis akan mendamparkan dua
issue dan enam job CLI pada sebuah kewajiban yang tak lagi dipegang siapa pun.

### Kewajiban itu dipikul di atas angka yang tak pernah diperiksa siapa pun

Layak dicatat sekali, karena ini kelas yang sama yang terus ditemukan repo ini.
#599, #597 dan beberapa dokumen menyebut **23.906** artikel. Basis data legacy
menyebut **25.029** (`data/seputarborneo-legacy/rubrik-redirects.json`,
`source.totalArticles`, dibaca dari `seputa58_sbb.berita_red_tayang`). Kedua
angka itu dikutip sebagai BESARAN kewajibannya, di repo yang sama, berminggu-
minggu. Sebuah kewajiban yang cukup mahal untuk membenarkan enam job tak pernah
cukup mahal bagi siapa pun untuk menghitung subjeknya.

## Keputusan

### 1. Arsipnya TIDAK dimigrasikan secara massal. Situs legacy adalah rujukan fitur.

`seputarborneo.com` adalah sumber **KEBUTUHAN**, bukan sumber **BARIS**.
Fitur-fiturnya — navigasi rubrik, pencarian, artikel terkait, penempatan iklan,
byline, halaman statis — adalah rujukan yang menggerakkan putaran #588–#599, dan
pemakaian itu tidak terpengaruh serta sebagian besar sudah dipanen.

### 2. Kewajiban cutover 301 DICABUT bersamanya.

Ini akibat yang memikul beban, dan alasan ADR ini ada alih-alih sebuah komentar
di issue. **301 adalah JANJI bahwa kontennya pindah.** Bila kontennya tidak
pindah, tak ada tujuan jujur yang bisa disebutnya.

Repo ini sudah pernah menolak pertukaran itu persis sekali. ADR-0113 menolak
mengarahkan URL pencarian legacy ke artikel mana pun, dengan kata-kata ini:
_"Sebuah query sembarang tidak punya satu tujuan yang benar, dan mengarahkannya
ke artikel mana pun adalah 301 yang berbohong."_ Penalaran yang sama, diterapkan
secara konsisten, memberi aturan untuk seluruh cutover:

> **URL-nya TIDAK BISA dibawa tanpa membawa kontennya.** Untuk URL legacy yang
> artikelnya sengaja tidak diimpor, status yang jujur adalah **410 Gone** (atau 404) — TIDAK PERNAH 301 ke listing kategori, ke beranda, atau ke halaman mana
> pun yang bukan hal yang diminta.

Redirect borongan 25.029 URL ke satu indeks kategori adalah ladang soft-404. Ia
lebih buruk daripada 404 yang hendak dihindarinya, dan ia akan dibangun oleh
perkakas yang justru ditulis repo ini untuk membuat redirect yang berbohong itu
sulit.

### 3. Kapabilitasnya TETAP. Yang hilang hanya kewajibannya.

Sesuai ADR-0055 kapabilitas hidup di sini, dan setiap job dalam keluarga ini
sudah dibangun, diuji, dan digerbangi:

| Job                            | Tetap benar di bawah ADR ini                                   |
| ------------------------------ | -------------------------------------------------------------- |
| `blog:legacy:import`           | mengimpor subset mana pun yang dipilih, dengan `--section-map` |
| `blog:legacy:redirects:import` | menurunkan satu aturan per post yang **diimpor**               |
| `blog:legacy:article-paths`    | memancarkan artefak id→path untuk baris terimpor               |
| `blog:legacy:cutover:verify`   | cek resolusi tingkat DB atas korpus yang diberikan             |
| `blog:legacy:edge:verify`      | cek tingkat HTTP bahwa tepi menerbitkan satu hop               |
| `blog:legacy:rubrik-redirects` | membangun peta rubrik dari basis data legacy                   |

Tak satu pun berubah. **Impor selektif adalah pipeline yang SAMA dengan masukan
yang lebih kecil**, dan alasan ia tak butuh kode baru adalah sebuah properti
yang sudah ada di kuerinya:

```sql
SELECT legacy_source_id, slug, locale
FROM awcms_blog_posts
WHERE tenant_id = $1
  AND legacy_source_system = $2
  AND legacy_source_id IS NOT NULL
  …
```

`listLegacyRedirectMappings`
(`src/modules/blog-content/application/blog-post-directory.ts`) menurunkan
petanya **dari baris yang ADA**. Impor sepuluh artikel dan ia memancarkan
sepuluh aturan; impor nol dan ia memancarkan nol. **Impor parsial TIDAK BISA
menghasilkan aturan menggantung** — bukan karena disiplin, melainkan secara
konstruksi. Itulah yang membuat kewajiban yang dicabut aman dicabut tanpa
menyentuh satu baris pun perkakasnya.

### 4. Apa yang diamandemen, dan apa yang tidak.

ADR-0113, ADR-0114 dan ADR-0115 **TIDAK disuperseded**. Mekanikanya benar saat
ditulis dan masih benar:

- **ADR-0113** — pasangan rubrik diratakan ke `/kategori/{jenis_rubrik}`; bentuk
  ke-4 tak pernah ada. Tak berubah.
- **ADR-0114** — tepi memiliki 301-nya; artikel resolve pada digit terdepannya.
  Tak berubah.
- **ADR-0115** — arsipnya mendarat di SATU origin, `/{section}/{slug}/`, dan
  importer menyatakan section-nya. Tak berubah.

Yang DICABUT dari ketiganya adalah satu klausa yang diwarisi masing-masing dari
PRD §41 / FR-DSC-007 dan dinyatakan sebagai Definition of Done: **bahwa _setiap_
URL legacy WAJIB menyelesaikan ke target hidup dalam satu hop.** Mulai sekarang
bacalah ketiganya sebagai KONDISIONAL — _bila_ sebuah artikel diimpor, ke sinilah
ia pergi dan beginilah 301-nya diterbitkan dan diverifikasi.

## Konsekuensi

- **Issue #599 dan #711 BISA ditutup.** Butir DoD keduanya terbelah bersih
  menjadi terkirim dan tercabut; pembelahannya dirinci di masing-masing issue
  alih-alih diduplikasi di sini.
- **Pemblokir media LARUT.** ~25.031 unggahan / 4,1 GB adalah pemblokir keras
  HANYA karena importer menolak baris yang `featuredImageSrc`-nya tak terpetakan
  dan 25.029 dari 25.029 punya satu. Secara bawaan tak ada yang diimpor, jadi tak
  ada yang ditolak. Impor selektif tetap butuh gambar untuk baris yang
  diambilnya — gerbang yang sama, atas himpunan yang dipilih operator.
- **Sepuluh kategori tujuan bukan lagi prasyarat.** Ia menjadi prasyarat sebuah
  impor selektif, bukan prasyarat platform.
- **`data/seputarborneo-legacy/` DIPERTAHANKAN sebagai bahan rujukan.** Ekspor
  Wayback CDX (`wayback-cdx-2026-08-26.txt`) dan peta rubrik — 68 entri, 63 di
  antaranya membawa target ke 10 kategori tujuan — adalah bukti tentang situs
  yang MASIH dipakai sebagai rujukan fitur, dan bukti yang lapuk bila dibuang.
  Menyimpannya berharga 565 kB.
- **Tak ada gerbang yang berubah, dan tak ada test yang berubah.** Tak satu pun
  dari enam job itu ada di rantai `check` — semuanya perkakas operator yang
  butuh basis data dan korpus. Suite yang menutupinya menguji PERILAKU
  perkakasnya, yang tak berubah. ADR ini adalah perubahan kebutuhan dengan
  **NOL perubahan perilaku**.

### Satu batas yang TIDAK dilewati ADR ini

`blog:legacy:cutover:verify` melaporkan `no_rule` untuk URL legacy tanpa
redirect. Di bawah kewajiban yang dicabut itu sebuah KEGAGALAN; di bawah ADR ini
itu keadaan yang **DIHARAPKAN** bagi artikel yang sengaja tidak diimpor, sehingga
sebuah run atas korpus penuh justru akan melaporkan hasil yang diinginkan sebagai
gagal.

Itu properti **KORPUS yang diberikan kepadanya**, bukan cacat pada job-nya: diberi
URL dari baris yang benar-benar diimpor — yang dipancarkan
`blog:legacy:article-paths` — ia menjawab pertanyaan yang masih penting.
Kosakata verdict-nya tidak punya anggota yang berarti _"sengaja hilang"_, dan tak
ada yang ditambahkan di sini, karena tak ada kewajiban yang kini menuntut run
korpus penuh yang akan membutuhkannya. Bila suatu saat impor selektif dijalankan
pada skala yang membuat pembedaan itu layak, ia adalah tambahan kecil pada
`CutoverVerdict` dan keputusan baru — bukan pelebaran diam-diam atas keputusan
ini.

### Yang TIDAK diputuskan ADR ini

**Nasib domain legacy-nya.** Apakah `seputarborneo.com` dipensiunkan, diparkir,
atau disajikan adalah keputusan infrastruktur di luar kedua repositori, dan
ADR-0114 sudah menempatkan 301-nya di tepi alih-alih di aplikasi ini. Bila
domainnya dipertahankan dan disajikan, §2 di atas memberi aturan yang wajib
diikuti konfigurasi tepinya: 410 untuk yang tidak pindah, 301 satu-hop hanya
untuk yang pindah.
