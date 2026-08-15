🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:57d0c9ca740d5c50767d39376629862db24c916fb165908c408db6b91e2d5e7d -->

# seo_distribution

Diterima oleh ADR-0038 (mengadaptasi ADR-0028 awcms-micro), diport secara aditif
sebagai net-new di bawah program absorb-awcms-micro (ADR-0035,
`docs/awcms/absorb-awcms-micro-roadmap.md` Gelombang 1). Cakupan DISCOVERY dirilis
di ADR-0038; **cakupan tata kelola redirect dirilis di ADR-0039** (aturan redirect
exact-path + penangkapan perubahan URL + telemetri 404 + satu suntingan fail-open
pada `src/middleware.ts` — lihat "Tata kelola redirect" di bawah). Modul ini adalah
**KONSUMEN/agregator fakta SEO, bukan penyedia** — modul konten menyediakan
`seo_facts`; `seo_distribution` menyusunnya menjadi metadata publik + permukaan
discovery. Tidak ada apa pun di registry base yang bergantung padanya, dan
`dependencies` siklus hidupnya hanya dua modul Core (`tenant_admin`,
`identity_access`), sehingga DAG modul tidak tersentuh.

## Perender pusat (alasan modul ini ada)

`domain/seo-document.ts` + `domain/seo-head-rendering.ts` mengubah
`SeoResourceFacts` satu resource (kontrak beku `_shared/ports/seo-facts-port.ts`)
ditambah default SEO tenant ditambah host primer yang diturunkan server menjadi satu
`<head>` yang deterministik:

- **URL canonical** — `https://{primary-host}{path}`, host **selalu** dari domain
  primer tenant yang terverifikasi (`tenant_domain`, migrasi 046), tidak pernah dari
  header request; turun menjadi canonical relatif ketika tidak ada domain primer
  (aman untuk offline-lan, tanpa host karangan);
- **alternatif hreflang** (+ `x-default`) — hanya locale yang resiprokal dan
  terpublikasi;
- **title / description / robots** — fakta resource menang atas default tenant;
- **Open Graph + Twitter card** — `og:url` = canonical; `og:image`/`twitter:image`
  diresolusi lewat `media_library` (satu tenant, terverifikasi), tidak pernah URL
  mentah;
- **JSON-LD terkendali** — `WebSite`/`Organization` (dari konfigurasi tenant) + node
  `Article` dari penyedia, dipancarkan **hanya** lewat guard `renderControlledJsonLd`
  milik port (injeksi diblokir oleh skema `@type`/kunci yang tertutup, bukan sanitasi
  ad-hoc), dan **hanya** untuk resource yang dapat diindeks.

`application/seo-metadata-service.ts` adalah titik komposisinya: ia menyuntikkan
adapter `SeoFactsSource` (penyedia) milik modul konten dan `MediaLibraryPort`,
meresolusi host (`application/resolve-canonical-host.ts`) dan default tenant, lalu
mengembalikan head yang sudah dirender plus kunci cache tenant-pertama
(`buildSeoCacheKey`). Ia tidak mengimpor satu pun modul konten — port-nya adalah
parameter biasa yang dirangkai di composition root rute.

### Penanganan status publikasi

Setiap keputusan visibilitas didelegasikan ke guard beku `isPubliclyResolvable` /
`isPubliclyIndexable`. Resource yang dilaporkan penyedia sebagai draft /
terjadwal-di-masa-depan / diarsipkan / dihapus / privat / belum-dipublikasikan
**tidak dapat dirender** (rute mengembalikan 404/deny seperti biasa); resource yang
resolvable tetapi `noindex` (atau `noindex` se-tenant) dirender dengan
`robots: noindex` dan **tidak** membawa data terstruktur. Tidak ada jalur kode yang
memancarkan resource belum-terpublikasi ke keluaran publik.

### Default SEO tenant + API admin

`awcms_seo_tenant_settings` (sql/057, ber-RLS FORCE, satu baris per tenant; kolom
konfigurasi feed ditambahkan oleh sql/059) memuat identitas situs, gambar
sosial/Organization default, handle Twitter/X, saklar `noindex` se-tenant, dan
konfigurasi feed/sitemap. `GET`/`PUT /api/v1/seo/config`
(`src/pages/api/v1/seo/config.ts`) membaca/memperbaruinya:

- digerbangi ABAC (`seo_distribution.config.read` / `.update`, sql/058);
- `PUT` bersifat high-risk — menuntut `Idempotency-Key` dan mencatat event audit pada
  setiap tulis (`application/seo-config-directory.ts`);
- ber-scope tenant (`withTenant` + RLS) — tenant A tidak pernah bisa membaca atau
  mengubah konfigurasi tenant B.

## Discovery / sindikasi publik

Rute Astro XML/teks publik di akar host (BUKAN OpenAPI — seperti rute konten publik
`/blog/{tenantCode}`), tanpa autentikasi secara desain, mengagregasi kontrak
`seo_facts` yang SAMA:

| Rute               | Isi            | Catatan                                                                                                                                  |
| ------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `/robots.txt`      | `text/plain`   | Men-`Disallow` `/admin/` + `/api/`; mengiklankan sitemap absolut; `Disallow: /` ketika `noindex` se-tenant menyala.                      |
| `/sitemap.xml`     | indeks sitemap | Menentukan ukurannya dari roll-up `summarize` yang terbatas; mendaftar anak `/sitemap-{n}.xml` (selalu ≥1, dibatasi plafon amplifikasi). |
| `/sitemap-{n}.xml` | `<urlset>`     | Satu halaman terbatas (`[(n-1)·perPage, n·perPage)` dari urutan stabil) dengan `hreflang` resiprokal + rujukan gambar terpublikasi.      |
| `/feed.xml`        | RSS 2.0        | Item sebanyak `feed_item_limit` terbaru (≤200), terbaru-dulu, GUID permalink stabil, gambar enclosure. `?locale=` mempersempit.          |
| `/atom.xml`        | Atom 1.0       | Set item yang sama; `<id>`/`<published>`/`<updated>` Atom.                                                                               |
| `/feed.json`       | JSON Feed 1.1  | Set item yang sama; hanya `content_text` (tidak pernah HTML tenant).                                                                     |

- **Tautan `<loc>` / feed dapat diresolusi.** `resolveEnabledSeoProviders` menanyai
  `blog_content` apakah keluarga rute publiknya melayani tenant ini:
  `/blog/{tenantCode}/{slug}` bila ya, dan **tidak ada penyedia sama sekali** ketika
  tenant mematikannya — sitemap kosong ketimbang sitemap penuh 404 yang pasti.
  ADR-0059 §C punya tiga baris di sini karena ada dua keluarga untuk dipilih;
  ADR-0071 §4 menghapus yang host-resolved `/news/**`, jadi tinggal dua baris dan
  invariannya adalah seluruhnya itu.
- **`noindex` se-tenant menekan SEMUA permukaan discovery**, bukan hanya
  `robots.txt`: dengan `default_robots_noindex` menyala, `/sitemap.xml`,
  `/sitemap-{n}.xml`, dan ketiga feed sama-sama mengembalikan 404 (tidak ada
  enumerasi URL terbaca-mesin bagi scraper yang tidak menghormati `robots.txt`).
- **Tenant/host** diresolusi oleh `withSeoPublicTenant` milik
  `application/public-seo-tenant-resolution.ts` (host dikendalikan server lewat
  `resolvePublicTenantFromRequest` bersama, migrasi 048; host hanya dipercaya di
  belakang proxy tepercaya, `PUBLIC_TRUST_PROXY`; lookup host digerbangi
  `PUBLIC_TENANT_RESOLUTION_MODE`), digerbangi oleh aktifnya `seo_distribution`;
  setiap hasil tidak-melayani adalah satu 404 generik yang dinormalisasi latensinya
  (`padUnresolvedSeoTenantLatency`).
- **Host diturunkan server** dari domain **primer** tenant yang terverifikasi — host
  request yang datang TIDAK PERNAH dipakai untuk membangkitkan URL (pertahanan
  host-poisoning). Ketika tenant **tidak** punya domain primer aktif, indeks/anak
  sitemap + semua feed **404** (`<loc>`/`<id>`/`<guid>`-nya WAJIB absolut — dokumen
  ber-URL relatif tidak valid), sementara `/robots.txt` tetap melayani 200 dan sekadar
  menghilangkan baris `Sitemap:`-nya.
- **Terbatas**: indeks sitemap menentukan ukurannya dari satu agregat `summarize`;
  tiap halaman anak adalah satu jendela terbatas; feed dibatasi oleh
  `feed_item_limit`. Tidak ada request yang mengenumerasi seluruh konten tenant.
  Plafon keras ada di `domain/discovery-limits.ts`.
- **Caching** (`domain/discovery-cache.ts`): tanda tangan deterministik atas
  `kind + tenantId + host + locale + contractVersion + configFingerprint +
contentRoll-up` (digabung dengan NUL sehingga bagian teks-bebasnya tidak dapat
  melebur melewati batasnya; `tenantId` mengisolasi tenant yang berbagi sentinel
  host-null) menghasilkan `ETag` kuat + `Last-Modified`;
  `If-None-Match`/`If-Modified-Since` → 304;
  `Cache-Control: public, max-age, s-maxage, stale-while-revalidate`. Karena
  validator-nya diturunkan dari state konten/domain/konfigurasi, setiap perubahan
  publish/update/arsip/hapus/domain/locale/konfigurasi meng-invalidasi keluaran yang
  terpengaruh.
- **Composition root**: `src/lib/seo/discovery-providers.ts` merangkai penyedia
  `seo_facts` yang aktif + port media; `src/lib/seo/discovery-route.ts` menjalankan
  pipeline-nya. `application`/`domain` milik modul ini sendiri tidak mengimpor satu
  pun modul konten.

## Postur keamanan (model ancaman ADR-0038)

| Ancaman                             | Kendali                                                                                                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Peracunan header Host               | Host canonical/OG/hreflang diturunkan server dari `tenant_domain` (`resolve-canonical-host.ts`); perender tidak pernah membaca `Host`/`X-Forwarded-Host`.                                   |
| Injeksi JSON-LD                     | Hanya `renderControlledJsonLd` yang memancarkan JSON-LD (memvalidasi skema `@type`/kunci terkendali DAN meng-escape `<>&`/U+2028/U+2029). Tidak ada JSON-LD serialisasi-tangan di mana pun. |
| Kebocoran konten belum-terpublikasi | `isPubliclyResolvable`/`isPubliclyIndexable` menggerbangi setiap pancaran; data terstruktur hanya untuk resource yang dapat diindeks.                                                       |
| Peracunan cache / lintas-tenant     | Kunci/tanda tangan cache bersifat tenant-pertama lewat `buildSeoCacheKey`/`buildDiscoverySignature` (melempar tanpa tenant+host+locale). Tabel konfigurasi ber-RLS FORCE.                   |
| Batas metadata                      | Panjang konfigurasi dibatasi di `domain/seo-config.ts` dan oleh constraint CHECK di sql/057 + sql/059 (batas feed 1–200, daftar-include ≤50).                                               |
| Amplifikasi sitemap                 | Plafon keras (`discovery-limits.ts`): `SITEMAP_URLS_PER_PAGE` + `SITEMAP_MAX_CHILD_PAGES`; item feed dibatasi `feed_item_limit` (≤200). Tidak ada pemindaian tak-terbatas per-request.      |
| Injeksi XML                         | Semua nilai teks/URL sitemap/feed di-escape XML (`escapeXmlText`, escape-jangan-tolak; membuang C0 yang ilegal di XML); feed JSON memakai `content_text` (tidak pernah HTML tenant).        |

## Kontrak kontribusi (`seo_facts`)

`blog_content` adalah satu-satunya penyedia `seo_facts` yang dideklarasikan di base
(`blog-content/application/seo-facts-port-adapter.ts`) — ia memiliki resource blog
post publik yang dirender SEO (`awcms_blog_posts`, sql/035). Tipe konten masa depan
mengalir lewat kontrak yang identik dengan merilis
`<module>/application/seo-facts-port-adapter.ts` miliknya sendiri; `seo_distribution`
tidak pernah tahu tipe itu ada. Hanya satu modul yang boleh mendeklarasikan
`provides: ["seo_facts"]` pada satu waktu (`capability_provider_conflict` milik
`module-composition.ts`). Versi port terdaftar sebagai `1.1.0` di
`_shared/capability-contract-versions.ts` (aturan ADR-0015).

## Tata kelola redirect (ADR-0039)

Cakupan tata kelola redirect melengkapi modul ini (migrasi `sql/060` skema +
`sql/061` izin):

- **Aturan redirect exact-path** (`awcms_seo_redirects`, ber-RLS FORCE) —
  301/302/307/308, scope locale/host opsional, jendela berlaku, `preserve_query`,
  siklus hidup soft-delete/restore/purge. Diresolusi di `src/middleware.ts` pada
  cabang non-`/admin` SEBELUM perutean konten, MENGECUALIKAN path
  admin/API/auth/statis/sistem/discovery (`domain/redirect-eligibility.ts`,
  ditegakkan saat resolve DAN saat tulis). Setiap target dilewatkan guard
  open-redirect beku (`domain/redirect-target-classification.ts` — dipindah rumah
  menjadi helper domain berdiri sendiri, BUKAN ditambahkan kembali ke port
  `seo_facts`) saat tulis DAN setiap resolve; rantai bersifat terbatas + non-rekursif
  dan gagal TERTUTUP saat loop/melewati plafon.
- **Penangkapan perubahan URL**
  (`POST /api/v1/seo/redirects/capture-url-change`) mengubah perubahan path
  lama→baru menjadi usulan redirect teraudit (tidak aktif) atau aturan aktif sesuai
  `url_change_auto_policy` milik tenant.
- **Telemetri 404 yang diminimalkan privasinya**
  (`awcms_seo_not_found_observations`, ber-RLS FORCE) — baris agregat (hanya path
  yang disanitasi + domain referrer telanjang), sebuah deskriptor `dataLifecycle`
  analytics_telemetry (`seo_distribution.not_found_observations`, purge generik,
  default 30 hari) dengan grant `SELECT, DELETE ... TO awcms_worker`.
- **Satu-satunya suntingan invasif** `src/middleware.ts` bersifat FAIL-OPEN: resolver
  menelan semua kegagalan menjadi null (tidak pernah 500), penangkapan 404 tidak
  pernah melempar; guard `/admin` dan plafon body API tidak tersentuh.

**Adaptasi awcms (ADR-0039):** resolusi tenant pada potongan pertama hanya
berbasis-host (tenant-lewat-path ditunda); `locale` selalu null (tidak ada seam
i18n).

**Penulisan ulang `/blog` ↔ `/news` kini berjalan ke arah SEBALIKNYA.** ADR-0039
merilis `/blog/{tenantCode}` → `/news`, inert karena tidak ada keluarga `/news`;
ADR-0059 memberinya tujuan nyata; [ADR-0071](../../../docs/adr/0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md)
§4 menghapus tujuan itu lagi — `/news/**` kini kosakata milik
`ahliweb/awcms-astro`. Jadi strategi 1 **dibalik**:
`domain/retired-news-redirect.ts` mem-301 `/news/**` ke `/blog/{tenantCode}/**`, dan
`domain/legacy-blog-redirect.ts` sudah tidak ada.

Dua perbedaan dari yang digantikannya, keduanya disengaja:

- **Tidak digerbangi kebijakan.** Arah lama adalah penulisan ulang opsional yang
  dinyalakan tenant. Yang ini adalah migrasi URL yang tidak dipilih siapa pun:
  rutenya hilang bagi semua orang, jadi tidak ada yang bisa di-opt-in. Ia juga TIDAK
  digerbangi oleh aktifnya `seo_distribution` — menggerbanginya di sana berarti
  tenant yang menonaktifkan modul ini justru merekalah yang URL terpublikasinya
  rusak.
- **Satu syarat bertahan.** Tenant dengan `legacyTenantRouteEnabled: false` juga
  tidak punya `/blog/**`, jadi ia tidak mendapat redirect — 301 menuju 404 yang
  terjamin adalah kegagalan yang keberadaan ADR-0059 §C cegah, dinyatakan ulang di
  ADR-0071 §3.

Kolom kebijakan `legacy_blog_redirect_enabled` (`sql/060`) **dipensiunkan tetapi
tidak di-drop**: migrasi terapan di-checksum dan immutable
(`scripts/db-migrate.ts`), dan permukaan API-nya sudah dirilis. Tidak ada yang
membacanya. Komentar `sql/060` masih membawa kalimat ADR-0039 karena alasan yang
sama, jadi README ini dan `domain/redirect-settings.ts` adalah tempat koreksinya
tinggal.

## Tindak lanjut terdokumentasi (di luar cakupan discovery)

- ~~**Rute konten publik berbasis host.**~~ **DITUTUP oleh ADR-0059, lalu
  DIBALIK oleh [ADR-0071](../../../docs/adr/0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md).**
  `blog_content` merilis keluarga host-resolved `/news/**` selama lima hari;
  ADR-0071 membelah kosakata URL keluarga ini dan memindahkan bentuk itu ke
  `ahliweb/awcms-astro`. Repo ini melayani `/blog/{tenantCode}` dan composition root
  sudah men-scope adapter-nya ke sana sejak #223 — yang juga menjadi sebab mengapa
  pembacaan asli entri ini, "URL sitemap 404 bagi tenant host-resolved", tidak
  pernah benar.
- **Cakupan tipe resource.** Adapter `blog_content` hanya memetakan tipe resource
  `blog_post`. Fakta `blog_page` generik, identitas homepage/website, dan
  `BreadcrumbList` belum diproduksi penyedia mana pun — kontraknya generik dan
  perender/agregator mendukungnya, tetapi belum ada adapter yang memancarkannya.
- **Penulis feed per-item + konten penuh.** Feed Atom membawa `<author>`
  tingkat-feed yang WAJIB (dinamai sesuai publikasinya — RFC 4287 §4.1.1); penulis
  per-ENTRY dan `content_html` bodi penuh belum ada di `SeoResourceFacts` (feed
  memakai ringkasan sebagai `content_text`).
- **Backfill izin.** `sql/058` menyemai `seo_distribution.config.{read,update}` ke
  katalog global, sehingga hanya tenant yang dibuat SETELAH migrasi itu yang
  mendapatkannya — sebuah langkah rilis fungsional (bukan keamanan).
- **Cache CDN/edge.** Rute discovery hanya merilis validator tingkat HTTP;
  integrasi CDN/edge yang opt-in dan hanya-full-online berada di luar cakupan dan
  tidak boleh menurunkan profil offline-lan.
