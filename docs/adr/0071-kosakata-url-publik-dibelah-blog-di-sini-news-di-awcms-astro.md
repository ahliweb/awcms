# ADR-0071 — Kosakata URL publik dibelah: `/blog/**` di sini, `/news/**` di `awcms-astro`

- **Status:** Accepted
- **Tanggal:** 2026-08-08
- **Pengambil keputusan:** @ahliweb
- **Men-supersede:** [ADR-0059](0059-host-resolved-public-content-routes.md) — keluarga rute host-resolved `/news/**` tidak dibangun di repo ini. Yang dicabut adalah **alamatnya**, bukan kemampuannya; lihat §3 untuk apa yang tetap berlaku dari ADR itu.
- **Menyempurnakan:** [ADR-0070](0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md) — ADR itu menyatakan `awcms-astro` memikul halaman publik sebagai fungsi utama, tetapi §Konsekuensi-nya masih menyebut keluarga `/news/**` sebagai permukaan publik repo ini. ADR ini menyelesaikan sisa itu.
- **Terkait:** [ADR-0009](0009-public-tenant-scoped-routes.md) (keluarga `/blog/{tenantCode}`), [ADR-0044](0044-merge-news-portal-into-blog-content.md) (`news_portal` dilebur ke `blog_content`), [ADR-0061](0061-host-resolved-public-surfaces-are-edge-cacheable.md) (surface cache tepi), [ADR-0065](0065-awcms-astro-consumer-contract-is-frozen.md) (kontrak konsumen beku), `awcms-astro` ADR-0033 (sebuah tab boleh menyatakan dirinya seksi berita) dan ADR-0036 ([`docs/adr/0036-...`](https://github.com/ahliweb/awcms-astro/blob/main/docs/adr/))

## Konteks

[ADR-0070](0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md)
memindahkan sumbu pembagian dari AUDIENS ke APA YANG DIKELOLA, dan menyatakan
`awcms-astro` memikul **halaman publik sebagai fungsi utama**. Tetapi ia
membiarkan satu hal tidak dijawab, dan §Konsekuensi-nya bahkan menuliskannya
sebagai bagian yang tidak tersentuh:

> Permukaan publik `awcms` sendiri (`/blog/{tenantCode}/**`, keluarga
> host-resolved `/news/**`, `robots`/`sitemap`/`feed`, `/search`) tidak
> tersentuh — ADR-0059/ADR-0061 tetap berlaku apa adanya.

Jadi kedua repo boleh melayani halaman berita publik, pada dua alamat berbeda,
dari satu sumber konten yang sama. Itu bukan pembagian peran; itu dua jawaban
untuk satu pertanyaan. Dan pertanyaannya akan ditanyakan setiap kali sebuah
deployment dibangun: **berita situs ini disajikan dari mana?**

### Apa yang membuat pertanyaan itu tidak punya jawaban hari ini

ADR-0059 mendaratkan `/news/**` di sini dengan alasan yang benar pada waktunya:
`blog_content` sudah memerikan keluarga itu sebagai desain yang sengaja belum
ada, `tenant_domain` akhirnya menyediakan resolver host-nya, dan repo ini adalah
satu-satunya tempat yang punya konten untuk dilayani. Pada 4 Agustus 2026 tidak
ada repo lain yang bisa memikulnya.

Sejak itu tiga hal berubah, dan ketiganya berubah di sisi sebelah:

1. `awcms-astro` ADR-0033 memberi sebuah tab kemampuan **menyatakan dirinya
   seksi berita** — urutan dari tanggal, dua tanggal yang terpisah, dan
   semantik terbit/diubah yang benar untuk berita.
2. `awcms-astro` ADR-0035 memberi setiap seksi berita **feed Atom-nya sendiri**.
3. `awcms-astro` ADR-0034 dan repo ini ADR-0070 menyatakan repo itu memikul
   halaman publik sebagai **fungsi utama**, bukan sebagai pelengkap.

Repo sebelah kini punya mesin berita yang lebih lengkap daripada empat rute yang
ADR-0059 daratkan di sini — dan ia mengambil isinya dari repo ini lewat
`GET /api/v1/blog/posts`, kontrak yang sudah dibekukan ADR-0065.

### Selisih yang tidak terlihat sampai keduanya berdiri berdampingan

[ADR-0061](0061-host-resolved-public-surfaces-are-edge-cacheable.md) §A menyimpulkan
posisi cache tepi hari ini "persis terbalik dari arah yang ADR-0059 tetapkan:
cache tepi mempercepat **bentuk warisan** dan tidak menyentuh **bentuk maju**
sama sekali". Kesimpulan itu benar — tetapi ia bersandar pada premis bahwa
`/blog/{tenantCode}` adalah bentuk warisan yang sedang ditinggalkan.

Keputusan di bawah mencabut premis itu. `/blog/{tenantCode}` bukan warisan; ia
kosakata permanen repo ini.

## Keputusan

**Kami memutuskan membelah kosakata URL publik antara dua repo keluarga, satu
keluarga rute per repo, dan tidak pernah keduanya di satu repo.**

| Kosakata   | Repo yang melayani                                              | Bentuknya                                                                      |
| ---------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `/blog/**` | [`ahliweb/awcms`](https://github.com/ahliweb/awcms)             | `/blog/{tenantCode}/**` — path-scoped, ADR-0009, dengan `tenantCode` eksplisit |
| `/news/**` | [`ahliweb/awcms-astro`](https://github.com/ahliweb/awcms-astro) | sebuah tab bernama `news` yang menyatakan `urutanSeksi: "terbaru"` (ADR-0033)  |

### 1. Satu modul, dua kosakata — bukan dua model konten

Keduanya dilayani **modul `blog_content` yang sama** di repo ini. `awcms-astro`
tidak punya basis data dan tidak menyimpan satu pun post; ia membaca
`GET /api/v1/blog/posts` lewat kontrak yang dibekukan
[ADR-0065](0065-awcms-astro-consumer-contract-is-frozen.md) dan membangun
halamannya secara statis.

Ini yang membuat pembelahan ini murah, dan ini juga syaratnya: **kosakata yang
dibelah adalah URL, bukan kepemilikan konten.** Sebuah post punya satu sumber
kebenaran, satu rangkaian layar pengelola (`/admin/blog*` di sini), dan satu
kontrak. Yang berbeda hanya alamat tempat pembaca anonim menemukannya.

Aturan cermin [ADR-0070](0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md)
§4 karena itu terpenuhi tanpa pekerjaan tambahan: tidak ada kemampuan yang hanya
ada di sana, karena tidak ada kemampuan yang **pindah** ke sana — yang pindah
adalah rendering halamannya.

### 2. `/news` berhenti menjadi kata yang dipesan di repo ini

ADR-0059 §Konsekuensi mencatat "`/news` menjadi kata yang dipesan pada host mana
pun". Itu dicabut. Setelah rute-rutenya dihapus (§4), `/news` di repo ini adalah
path biasa seperti path lain yang tidak dilayani.

Sebaliknya di `awcms-astro`, `news` **tetap bukan** kata yang dipesan: ia slug
tab yang dipilih situs. Sebuah situs yang tidak punya berita tidak punya `/news`,
dan tidak perlu menjelaskan kenapa. Itu perbedaan yang disengaja antara aturan
ini dan bentuk yang ADR-0059 pakai.

### 3. Yang TETAP berlaku dari ADR-0059, dinyatakan supaya tidak ikut tercabut

Men-supersede sebuah ADR mencabut seluruh keputusannya. Dua di antaranya justru
harus bertahan, jadi keduanya dinyatakan ulang di sini alih-alih dibiarkan gugur
diam-diam:

- **Invarian "jangan pernah mengiklankan URL yang tidak kita layani"** (§C).
  Tabel base path SEO menyusut menjadi dua baris — `legacyTenantRouteEnabled`
  `true` → `/blog/{tenantCode}`, `false` → **nol provider** — tetapi barisan
  terakhirnya, yang menjadi inti aturannya, tidak berubah: tenant yang mematikan
  permukaan publiknya mendapat sitemap kosong, bukan sitemap berisi tautan yang
  pasti 404. Invarian itu ditegakkan test, dan test-nya tetap.
- **Penolakan mendeklarasikan surface cache tepi tanpa kunci per-host** (§E).
  Alasannya tidak pernah tentang `/news`: mendeklarasikan surface host-resolved
  sebelum kunci per-host diverifikasi di VCL adalah cara paling langsung memasang
  kebocoran lintas-tenant di cache bersama. Itu tetap benar untuk rute discovery
  root, yang tidak tersentuh ADR ini.

Yang **tidak** bertahan: keluarga rutenya sendiri (§A), gerbang
`withHostResolvedBlogTenant` yang hanya melayaninya (§B), saklar
`publicRouteMode`, dan deklarasi `"/news"` pada `blog_content.api.routes` (§D).

### 4. Rute `/news/**` di repo ini dihapus

- **Status pelaksanaan §4:** SUDAH DILAKSANAKAN

Saat ADR ini mendarat, empat rute masih ada di `src/pages/news/` dan
`publicRouteMode` masih `domain_default` sebagai nilai bawaan modul — artinya
`/news/**` **menyala** untuk setiap tenant yang tidak mematikannya. Aturan di
atas berlaku sejak hari itu; kodenya menyusul di PR tersendiri, dan urutan itu
dipilih: menghapus keluarga rute yang menyala secara bawaan adalah migrasi URL,
dan migrasi URL yang digabungkan dengan keputusan yang melahirkannya menghasilkan
satu PR yang tidak bisa di-review sebagai keduanya.

Jendela itu kini tertutup. Yang mendarat:

1. Empat berkas rute dihapus. `src/pages/news/` tidak ada lagi.
2. **301 dari `/news/**` ke `/blog/{tenantCode}/**`**, bukan 404 — URL yang sudah
   diiklankan sitemap dan feed repo ini tidak mati tanpa penerus. Ia hidup di
   `seo_distribution` sebagai **strategi 1 yang dibalik**: berkas yang dulu
   memetakan `/blog/{tenantCode}` → `/news` (`domain/legacy-blog-redirect.ts`)
   diganti `domain/retired-news-redirect.ts` yang memetakan arah sebaliknya.
   Redirect ini **tidak** ber-policy: keluarga rutenya hilang untuk semua orang,
   jadi tidak ada yang bisa memilih untuk tetap dilayani. Ia juga sengaja tidak
   digerbangi `seo_distribution` yang aktif — menggerbanginya berarti tenant yang
   mematikan modul itu justru yang URL terbitnya mati.
3. **Satu syarat tetap berlaku, dan ia menjaga invarian §3**: tenant dengan
   `legacyTenantRouteEnabled: false` tidak mendapat redirect. Ia sudah mematikan
   seluruh permukaan konten publiknya, jadi 301 ke `/blog/{tenantCode}` akan
   menyerahkan 404 yang pasti. "Jangan pernah mengiklankan URL yang tidak kita
   layani" berlaku untuk tujuan redirect, bukan hanya untuk entri sitemap.
4. **Auto-redirect legacy `/blog/{tenantCode}` → `/news` dimatikan** bersama
   berkasnya. Kolom `legacy_blog_redirect_enabled` (`sql/060`) **tidak** dihapus —
   migrasi terapan immutable, dan permukaan API-nya sudah terbit — tetapi tidak
   ada lagi yang membacanya. Ia kini benar-benar inert, dan untuk alasan yang
   diputuskan alih-alih kebetulan.
5. Tabel §C menciut menjadi dua baris; `publicRouteMode`,
   `withHostResolvedBlogTenant`, dan `padUnresolvedHostRouteLatency` dicabut;
   `"/news"` keluar dari `blog_content.api.routes`.

Penanda di atas bukan formalitas: `tests/url-vocabulary-split.test.ts` mengikatnya
pada keberadaan `src/pages/news/` **dua arah**, dan ia memang memerah di antara
penghapusan rute dan pembalikan penanda ini. Aturan tanpa pemeriksa adalah aturan
yang dilupakan, dan aturan yang menjadwalkan pekerjaan untuk "nanti" adalah yang
paling sering dilupakan.

## Konsekuensi

- **Positif:**
  - Pertanyaan "berita situs ini disajikan dari mana" punya satu jawaban yang
    bisa dibaca dari alamatnya. `/blog/` berarti `awcms`; `/news/` berarti
    `awcms-astro`. Tidak ada deployment yang perlu memutuskannya lagi.
  - Premis ADR-0061 §A gugur ke arah yang menguntungkan: `/blog/{tenantCode}`
    bukan lagi "bentuk warisan yang di-cache sementara bentuk maju tidak", ia
    kosakata permanen repo ini — dan ia **path-scoped**, yang berarti ia sudah
    bisa di-cache tepi hari ini. Penangguhan kunci per-host berhenti memblokir
    permukaan konten repo ini; ia tinggal soal rute discovery.
  - Satu kelas duplikasi hilang seluruhnya: dua URL untuk satu post, yang
    ADR-0059 §Konsekuensi terima sebagai "duplikasi terkendali" dengan canonical
    sebagai penengah. Tidak ada yang perlu ditengahi bila hanya ada satu.
  - Repo sebelah mendapat kosakata yang cocok dengan mesinnya. `urutanSeksi`
    (ADR-0033) dan feed per-seksi (ADR-0035) memang ditulis untuk berita; empat
    rute di sini tidak punya keduanya.
- **Negatif / trade-off yang diterima:**
  - **Sebuah deployment yang hanya memakai `awcms` kehilangan URL berita tanpa
    kode tenant.** `/blog/{tenantCode}/**` selalu membawa `tenantCode` di
    path-nya, dan itu tidak berubah. Deployment yang menginginkan URL bersih
    memasang `awcms-astro` di depannya — yang memang bentuk yang keluarga ini
    tuju sejak ADR-0045.
  - **Ada jendela antara aturan ini dan implementasinya** ketika repo ini masih
    melayani `/news/**` yang aturannya sendiri larang. Jendela itu dinyatakan
    (§4) dan digerbangi, bukan dibiarkan diketahui pembaca yang teliti saja.
  - **Migrasi URL adalah biaya SEO nyata**, dan 301 pada butir §4.2 adalah cara
    membayarnya, bukan cara menghindarinya.
- **Netral:**
  - **Nol perubahan kode pada PR ini.** Modul `blog_content`, kontrak ADR-0065,
    seluruh layar admin, dan setiap izin tetap persis seperti sebelumnya.
  - `awcms-astro` tidak wajib memasang tab `news`. Aturan ini menyatakan **di
    mana** `/news/**` boleh ada, bukan bahwa setiap situs harus punya berita.

## Alternatif yang dipertimbangkan

- **Membiarkan keduanya melayani `/news/**`, dibedakan per-deployment** —
  ditolak. Itu memindahkan keputusan dari ADR ke berkas konfigurasi setiap
  deployment, dan bentuk kegagalannya adalah dua tim yang sama-sama benar
  menunjuk dokumen yang berbeda. Kosakata URL adalah antarmuka publik keluarga
  ini; ia pantas diputuskan sekali.
- **Memindahkan `/blog/{tenantCode}` ke `awcms-astro` juga**, meninggalkan repo
  ini tanpa permukaan konten publik — ditolak. Repo ini butuh permukaan publik
  yang bisa berdiri sendiri: sebuah deployment `awcms` tunggal harus tetap bisa
  menerbitkan, dan `/blog/{tenantCode}` sudah melakukannya sejak ADR-0009 dengan
  cache tepi yang sudah bekerja.
- **Menghapus `/news/**` dalam PR yang sama dengan ADR ini** — ditolak, dan
  alasannya ditulis di §4: keputusan dan migrasi URL yang dilahirkannya
  di-review dengan pertanyaan yang berbeda. Menggabungkannya membuat salah
  satunya lolos tanpa dibaca.
- **Menandai ADR ini `Accepted (belum diimplementasikan)`** — tidak mungkin
  secara mekanis, dan itu informatif. Gerbang `tests/adr-implementation-status.test.ts`
  mengikat kualifikasi itu pada **keberadaan** artefak yang dijanjikan: artefak
  ada → status wajib `Accepted` polos. ADR ini menjanjikan sebuah **penghapusan**,
  jadi arahnya terbalik, dan aturan (d) gerbang itu melarang kualifikasi dipakai
  di luar petanya. Karena itu §4 mendapat gerbangnya sendiri, yang menegakkan
  hal yang sama untuk bentuk janji yang berlawanan.
- **Men-supersede ADR-0061 juga**, karena premis §A-nya gugur — ditolak.
  Analisisnya tetap benar untuk rute discovery root, yang adalah mayoritas
  isinya; yang gugur hanya framing "warisan versus maju" untuk keluarga konten.
  Itu dicatat sebagai banner di sana, bukan sebagai pencabutan.
