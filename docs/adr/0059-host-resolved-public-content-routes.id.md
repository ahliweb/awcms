🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0059-host-resolved-public-content-routes.md)

<!-- i18n-source-hash: sha256:a63ff561178450e17a6813bac36e7d75349a4e01bbc85d832a05337a106f6739 -->

# ADR-0059 — Rute konten publik host-resolved: keluarga `/news/**`, bukan `/blog/{slug}`

- **Status:** Superseded by [ADR-0071](0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md)
- **Tanggal:** 2026-08-03
- **Pengambil keputusan:** @ahliweb
- **Terkait:** [ADR-0009](0009-public-tenant-scoped-routes.md) (rute publik path-based `/blog/{tenantCode}`), [ADR-0010](0010-public-host-tenant-routing.md) (resolusi tenant dari host + `PUBLIC_TENANT_RESOLUTION_MODE`), [ADR-0038](0038-seo-distribution-module-admission-discovery-scope.md) (rute discovery + seam `seo_facts`), [ADR-0042](0042-varnish-edge-cache-auto-activation.md) (surface cache tepi), [ADR-0044](0044-merge-news-portal-into-blog-content.md) (preseden: kepemilikan pindah, nama permukaan tidak), [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md) (kemampuan dibangun di sini, bukan di-port)

> **Dibaca sebagai sejarah.** [ADR-0071](0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md)
> (8 Agustus 2026) membelah kosakata URL publik keluarga: `/blog/**` milik repo
> ini, `/news/**` milik `awcms-astro`. Keluarga rute yang ADR ini daratkan karena
> itu **tidak dibangun di sini** — yang dicabut alamatnya, bukan kemampuannya.
> Dua keputusan di bawah **tetap berlaku** dan dinyatakan ulang di ADR-0071 §3
> supaya tidak ikut gugur: invarian §C ("jangan pernah mengiklankan URL yang
> tidak kita layani") dan penolakan §E mendeklarasikan surface cache tepi
> host-resolved sebelum kunci per-host diverifikasi. Kalimat ADR ini sengaja
> tidak ditulis ulang (Aturan 2 indeks ADR).
>
> Rutenya masih ada di `src/pages/news/` saat banner ini ditulis; ADR-0071 §4
> menjadwalkan penghapusannya dan `tests/url-vocabulary-split.test.ts`
> menegakkan jadwal itu dua arah.

## Konteks

### 1. Cacat yang tercatat di backlog ternyata BUKAN cacat itu

`docs/PROJECT_STATE.md` §4 (3 Agustus 2026) mencatat, sebagai temuan yang "lebih
tajam dari follow-up":

> `createBlogContentSeoFactsAdapter` memakai `DEFAULT_PUBLIC_BASE_PATH` `/blog`,
> jadi tiap canonical/`<loc>`/tautan feed yang dipancarkan `seo_distribution`
> menunjuk `/blog/{slug}` … untuk tenant host-resolved, **setiap URL di sitemap
> dan feed menunjuk halaman yang 404**.

Diverifikasi ke kode, klaim itu **salah**. Rute discovery tidak pernah memakai
default itu. Satu-satunya composition root yang membangun adapter untuk mereka —
`src/modules/seo-distribution/presentation/discovery-providers.ts` — memanggil

```ts
providers.push(createBlogContentSeoFactsAdapter(`/blog/${tenantCode}`));
```

dan `git log -S` menunjukkan baris itu ada **sejak modulnya mendarat** (#223).
Docblock fungsinya bahkan menuliskan alasannya: "there is no host-based
`/blog/{slug}` route in this base yet … Advertising `/blog/{slug}` would 404 for
crawlers." Nilai default `/blog` pada `createBlogContentSeoFactsAdapter` hanya
dipakai oleh singleton `blogContentSeoFactsAdapter` yang **nol pemanggil di
`src/`** (hanya test). Enam rute discovery melewati satu choke point,
`serveDiscovery` → `resolveEnabledSeoProviders`, jadi tidak ada jalur kedua yang
bisa melewatkannya.

Ini kelas kesalahan yang repo ini sudah kenal (lihat ADR-0058 §1: dua "temuan"
yang langsung tertulis sebagai keputusan padahal rutenya membantah). Dicatat di
sini supaya koreksinya punya rujukan, dan supaya angka backlog berikutnya dibaca
sebagai klaim yang harus diverifikasi.

### 2. Cacat yang SEBENARNYA ada: mode host-resolved tidak punya rute konten

Yang benar-benar hilang bukan kebenaran URL sitemap, melainkan keluarga rutenya
sendiri. `tenant_domain` (#219) memetakan host → tenant, `seo_distribution`
(#223/#224) melayani `/robots.txt`, `/sitemap*.xml`, `/feed.*` di root host,
`site_search` (#231) melayani `/search` di root host, `comments` (ADR-0041)
melayani API komentar publiknya host-resolved. Tetapi **konten yang ditunjuk
semua permukaan itu hanya bisa dibaca lewat `/blog/{tenantCode}/{slug}`**.

Akibatnya sebuah tenant dengan domain sendiri — persis kasus yang `tenant_domain`
ada untuk melayani — menerbitkan sitemap di `https://acme.com/sitemap.xml` yang
setiap `<loc>`-nya berbentuk `https://acme.com/blog/acme/hello-world`: benar,
resolve, dan membawa pengenal yang justru dihapus oleh keputusan memakai domain
sendiri. Janji ADR-0010 ("URL bersih tanpa tenant code") tidak pernah sampai ke
lapisan konten.

### 3. `/blog/{slug}` tidak bisa menjadi bentuknya — dibuktikan, bukan diduga

Bentuk yang backlog sebutkan (`/blog/{slug}`) **bertabrakan** dengan rute daftar
ADR-0009 (`/blog/{tenantCode}`): dua-duanya satu segmen dinamis di bawah `/blog`,
jadi `/blog/apa-pun` ambigu — slug post atau kode tenant?

Diuji langsung di repo ini (berkas probe `src/pages/blog/[slug].ts`, lalu
`bun run build`, lalu dihapus):

```
[WARN] [router] The route "/blog/[slug]" is defined in both "src/pages/blog/[slug].ts"
and "src/pages/blog/[tenantCode]/index.ts" using SSR mode. A dynamic SSR route
cannot be defined more than once.
[WARN] [router] A collision will result in a hard error in following versions of Astro.
```

Buildnya **tetap sukses**. Jadi biayanya bukan kegagalan yang terlihat melainkan
satu rute yang diam-diam menutupi rute lain hari ini, dan build yang gagal keras
pada versi Astro berikutnya. Menyelesaikannya di runtime (satu berkas yang
menebak "ini slug atau kode tenant?") justru memindahkan ambiguitas ke tempat
yang lebih buruk: siapa pun yang boleh menulis slug post bisa menaungi URL
daftar milik tenant lain, atau sebaliknya sebuah kode tenant baru mematikan URL
post yang sudah terindeks — dua arah kegagalan yang keduanya senyap.

### 4. `publicBasePath` versi arsip adalah pabrik cacat yang sama

`awcms-micro` (arsip, ADR-0055) menyelesaikan ini dengan keluarga rute fisik
`/news/**` plus setting per-tenant `publicBasePath`/`publicLabel`. Dokumentasinya
sendiri menyatakan batasnya: setting itu **hanya mengubah URL self-referential**
(canonical, `<loc>`, tautan internal) dan **tidak** memindahkan rute file-based
yang benar-benar melayani. Artinya menyetelnya ke nilai apa pun selain path
fisiknya menghasilkan persis cacat yang ADR ini tutup — permukaan yang
mengiklankan URL yang 404 — hanya saja per-tenant dan tanpa gerbang. Setting itu
**tidak** diadopsi.

## Keputusan

### A. Keluarga rute host-resolved ada di `/news/**`, empat rute

`/news` (indeks), `/news/{slug}` (detail), `/news/category/{slug}`,
`/news/tag/{slug}`. Tanpa segmen `tenantCode`: tenant diresolusi dari request
(`resolvePublicTenantFromRequest`, ADR-0010) persis seperti `/search` dan rute
discovery.

Kenapa `/news` dan bukan kosakata baru: ia satu-satunya nama yang **sudah**
dipakai repo ini untuk permukaan yang sama (`awcms_news_portal_*`,
`/api/v1/news-portal/*`, `NEWS_MEDIA_R2_*`, tag OpenAPI `News Media`), dan
`blog_content/module.ts` + README-nya sudah memerikan `/news/**` sebagai
keluarga yang **sengaja belum ada** ("PORT-TIME DROPS"). Keputusan ini
mengaktifkan desain yang sudah tertulis, bukan menambah desain ketiga. Preseden
namanya ADR-0044 §3/§6 dan ADR-0036: kepemilikan berpindah, nama permukaan
tidak.

**Yang sengaja TIDAK ikut**: `/news/feed.xml`, `/news/sitemap-news.xml`,
`/news/search`. Ketiganya sudah dilayani host-resolved di root host
(`/feed.xml`, `/atom.xml`, `/feed.json`, `/sitemap.xml`, `/sitemap-{n}.xml`,
`/search`). Menduplikasinya berarti satu host punya dua sitemap dan dua titik
penegakan `rssEnabled` — biaya SEO dan sumber divergensi, tanpa kemampuan baru.

Keluarga legacy `/blog/{tenantCode}` **tidak berubah dan tidak dipensiunkan**
(ADR-0009 tetap berlaku): keduanya hidup berdampingan, masing-masing dengan
saklar per-tenant sendiri.

### B. Satu gerbang bersama, sebentuk dengan `site_search` dan `comments`

`withHostResolvedBlogTenant` (`blog-content/application/public-host-route-tenant-resolution.ts`):
resolusi host → cek modul `blog_content` enabled → cek `publicRouteMode` tenant →
jalankan handler di dalam satu `withTenantOrThrow`. Setiap hasil non-serving
kolaps ke `null` yang sama (404 generik) — tak pernah membocorkan yang mana — dan
cabang "tenant tak ter-resolve" membayar bentuk round-trip yang sama lewat
`padUnresolvedHostRouteLatency` (`withSiteSearchTenant`/`withCommentsTenant`
sudah menetapkan polanya; tanpa padding, latensi menjawab "hostname ini memetakan
ke tenant aktif").

Saklar barunya `publicRouteMode` (`domain_default` | `disabled`, default
`domain_default`) di `settings.defaults` descriptor — store yang sudah ada, bukan
store ketiga, dan simetris dengan `legacyTenantRouteEnabled` milik keluarga
legacy. Normalisasi fail-safe di sisi baca (framework module-settings tidak
memvalidasi tipe per-field).

### C. Base path SEO mengikuti keluarga yang benar-benar melayani

`resolveEnabledSeoProviders` kini membaca setting rute publik tenant dan memilih:

| `publicRouteMode` | `legacyTenantRouteEnabled` | Base path canonical/`<loc>`/feed |
| ----------------- | -------------------------- | -------------------------------- |
| `domain_default`  | apa pun                    | `/news`                          |
| `disabled`        | `true`                     | `/blog/{tenantCode}`             |
| `disabled`        | `false`                    | **nol provider** — tak ada URL   |

Baris ketiga adalah inti aturannya: bila tenant mematikan KEDUA keluarga, tidak
ada URL konten yang bisa diiklankan, jadi sitemap/feed-nya kosong alih-alih
memuat tautan yang pasti 404. Invarian "jangan pernah mengiklankan URL yang tak
kita layani" ditegakkan test, bukan hanya prosa.

Rute discovery diresolusi dengan resolver host yang sama dengan keluarga
`/news`, jadi keduanya selalu sepakat tentang tenant mana yang dimaksud.

### D. Nol migrasi, nol permission baru, nol perubahan OpenAPI

Rute publik anonim tidak punya guard permission dan — mengikuti preseden
`/blog/{tenantCode}` dan rute discovery (ADR-0038 §4) — berada di luar kontrak
OpenAPI. Kepemilikan rute dinyatakan dengan menambah `"/news"` ke
`blog_content.api.routes` (`modules:routes:check`).

### E. Cache tepi: belum ada surface yang dideklarasikan, dan itu keputusan

`/news/**` adalah permukaan **host-resolved**: path-nya identik untuk setiap
tenant, jadi kunci cache-nya harus memuat host. `surface-registry.ts` sudah
menahan permukaan discovery root untuk alasan tetangganya (tenant tak bisa
diturunkan dari path) dan menyatakan "a dead declaration is worse than an honest
omission". Mendeklarasikan `/news/**` sebelum kunci per-host diverifikasi di VCL
adalah cara paling langsung memasang kebocoran lintas-tenant di cache bersama.
Jadi: tidak dideklarasikan → `surface_not_declared` → `Cache-Control: private,
no-store`. Follow-up yang sama dengan discovery root (thread `locals`, kunci
per-host), dicatat di `docs/awcms/edge-cache-architecture.md`.

## Konsekuensi

- Deployment host-resolved akhirnya punya URL konten tanpa kode tenant, dan
  sitemap/feed/canonical-nya menunjuk ke sana.
- Sebuah tenant kini bisa mematikan seluruh permukaan konten publiknya (kedua
  keluarga `disabled`/`false`) — dan sitemap-nya ikut kosong, bukan rusak.
- Dua keluarga rute untuk konten yang sama berarti dua URL untuk satu post pada
  deployment yang mengaktifkan keduanya. Itu **duplikasi terkendali**, bukan
  ambigu: canonical selalu satu (tabel §C), jadi mesin pencari diberi satu
  jawaban. Tenant yang tidak menginginkannya mematikan salah satunya.
- `/news` menjadi kata yang dipesan pada host mana pun. Konsisten dengan
  `RESERVED_SEGMENTS` edge-cache dan dengan `/search`; dicatat di README modul.
- Rute `/news/**` tidak ter-cache di tepi sampai follow-up §E mendarat.

## Alternatif yang ditolak

1. **`/blog/{slug}` (bentuk yang backlog sebutkan)** — tabrakan rute yang
   dibuktikan di §3; senyap hari ini, gagal keras nanti.
2. **Satu berkas yang menebak slug-atau-kode-tenant di runtime** — memindahkan
   ambiguitas ke lapisan otorisasi de-facto: penulis konten bisa menaungi URL
   tenant lain, atau kode tenant baru mematikan URL post terindeks.
3. **Slug di root host (`/{slug}`)** — menelan setiap path satu segmen, menabrak
   `/[...path]` (yang menjalankan resolusi redirect dan pencatatan 404
   `seo_distribution`), dan mendahului `awcms_blog_pages` yang justru pemilik
   alami slug root.
4. **Setting `publicBasePath` per-tenant (versi arsip)** — §4: mengubah tautan
   tanpa memindahkan rute = memproduksi URL 404 per-tenant, tanpa gerbang.
5. **Memensiunkan `/blog/{tenantCode}`** — ADR-0009 adalah satu-satunya bentuk
   yang bekerja tanpa DNS/TLS sama sekali (deployment LAN/offline, doc 18).
