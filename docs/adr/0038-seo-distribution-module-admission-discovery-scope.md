# ADR-0038 — Admission `seo_distribution` (SEO discovery: renderer + sitemap/robots/feed + config) sebagai modul domain

- **Status:** Accepted
- **Tanggal:** 2026-07-24
- **Pengambil keputusan:** @ahliweb
- **Mengadaptasi:** awcms-micro `src/modules/seo-distribution/` (ADR-0028, epic #261 Wave 1) ke basis `awcms`, sesuai program penyerapan [ADR-0035](0035-awcms-online-first-erp-saas-superset-repositioning.md) dan peta [`docs/awcms/absorb-awcms-micro-roadmap.md`](../awcms/absorb-awcms-micro-roadmap.md) (Wave 1, port aditif net-baru + seam kontribusi `seo_facts`).
- **Terkait:** ADR-0011 (capability ports), ADR-0015 (versioning kontrak per-capability), ADR-0026 (OpenAPI modular per-modul), ADR-0034 (template dipakai-langsung; modul hidup langsung di `src/modules/`), ADR-0036 (`media_library`, dikonsumsi opsional), ADR-0009 (resolusi tenant publik host/tenant-code).

## Konteks

Basis `awcms` sudah punya konten publik (`blog_content`, migrasi `sql/035`) dan resolusi tenant publik berbasis host (`tenant_domain`, migrasi 046-048). Yang belum ada: satu tempat terpusat untuk menurunkan metadata SEO halaman publik (canonical/hreflang/robots/OG/JSON-LD) dan permukaan penemuan mesin pencari (robots.txt, sitemap, feed RSS/Atom/JSON). Tanpa itu, tiap route konten menurunkan metadata secara ad-hoc — persis drift-risk yang ADR-0028 awcms-micro namai.

awcms-micro sudah menyelesaikan ini dengan modul `seo_distribution` yang mencakup TIGA hal: (a) renderer metadata terpusat + config tenant (#266), (b) permukaan discovery/syndication publik (#267), dan (c) tata-kelola redirect + telemetri 404 (#268). ADR ini mengadmisikan **HANYA (a) + (b) — "scope discovery"** ke basis ini; (c) ditunda ke PR lanjutan (lihat §Ditunda).

## Keputusan

### 1. Admisi `seo_distribution` sebagai modul domain (aditif net-baru, scope discovery)

- Nama: **SEO & Distribution** · `key`: `seo_distribution` · `type: domain` · `version: 0.1.0` (scope discovery; redirect menyusul).
- `dependencies`: `["tenant_admin", "identity_access"]` — DAG tetap asiklik (keduanya sudah lebih dulu di registry). Modul ini **CONSUMER/aggregator**, bukan provider: tidak ada modul lain yang dibuat bergantung padanya.
- Milik modul: **satu tabel config per-tenant** `awcms_seo_tenant_settings` (migrasi `sql/057`, kolom feed ditambah `sql/059`) — identitas situs, gambar sosial/Organization default, handle Twitter, saklar noindex tenant-wide, plus config feed/sitemap. RLS ENABLE+FORCE + `tenant_isolation` (`awcms_app` non-owner, jadi ENABLE saja inert). Ditambah renderer/serializer pure di `domain/` dan orkestrator di `application/`.

### 2. Seam kontribusi `seo_facts` (capability port, BUKAN field descriptor)

`seo_facts` adalah **capability port** (`_shared/ports/seo-facts-port.ts`), dikonsumsi via `capabilities.consumes` — BUKAN field array baru di `ModuleDescriptor`. Arah panah menunjuk ke dalam (ADR-0028 §2): modul konten (`blog_content`) MENYEDIAKAN `seo_facts`; `seo_distribution` menemukan adaptornya di composition root route dan meng-inject-nya sebagai parameter biasa — `seo_distribution` tak pernah meng-import internal modul konten, dan sebaliknya. `capabilities.consumes` adalah relasi level-sumber (opsional, degrade aman), BUKAN edge lifecycle, jadi tidak membatasi DAG.

- `blog_content` jadi satu-satunya provider `seo_facts` di basis (`module-composition.ts` `capability_provider_conflict` menegakkan satu-provider-per-capability). `blog_content.capabilities.provides` menjadi `["public_content", "seo_facts"]`; adaptornya `application/seo-facts-port-adapter.ts` memetakan baris `awcms_blog_posts` → `SeoResourceFacts` netral (baris noindex/non-publik/belum-terbit → `sitemap:null`/`feed:null`).
- `CAPABILITY_CONTRACT_VERSIONS["seo_facts"] = "1.1.0"` (ADR-0015): angka pertama yang di-assign untuk basis ini adalah `1.1.0`, bukan `1.0.0` — port ini shipped LANGSUNG dengan roll-up `summarizePublicResourceFacts` + opsi list `offset`/`order` (minor 1.1.0 awcms-micro), jadi mendeklarasikan 1.0.0 akan meremehkan bentuk yang benar-benar di-bind konsumen. Manifest keluarga (`awcms-family-compatibility.yaml`) disinkronkan (gate `family:conformance:check` cocok key-for-key).
- `seo_distribution` juga `consumes` `media_library` (ADR-0036) untuk resolusi gambar OG/Organization/feed — opsional, degrade ke kartu/feed teks-saja.

### 3. Renderer & serializer aman-by-construction (batasan kontrak sebagai gigi, bukan konvensi)

Seluruh keputusan sensitif-keamanan didelegasikan ke guard beku port, tak pernah diturunkan ulang:

- **Host-header poisoning** — canonical/OG/hreflang host DITURUNKAN server dari domain primer terverifikasi (`resolve-canonical-host.ts` → `awcms_tenant_domains.is_primary` + `status='active'`), tak pernah dari header `Host`. Tanpa host primer, canonical degrade ke path relatif (tak mengarang host); sitemap/feed **404** (loc/id/guid WAJIB absolut).
- **JSON-LD injection** — hanya `renderControlledJsonLd` yang mengemit JSON-LD (validasi union `@type`/key tertutup + escape `<>&`/U+2028/U+2029). Tidak ada JSON-LD yang di-hand-serialize.
- **Kebocoran konten belum-terbit** — `isPubliclyResolvable`/`isPubliclyIndexable` menggerbangi tiap emisi; structured data hanya untuk resource indexable; predikat eligibility yang sama dipakai listing DAN summarize (tak boleh drift).
- **Cache poisoning / cross-tenant** — cache key/signature tenant-first (`buildSeoCacheKey`/`buildDiscoverySignature` throw tanpa tenant+host+locale). Tabel config RLS FORCE'd.
- **Sitemap amplification / XML injection** — ceiling keras non-configurable (`discovery-limits.ts`); tiap teks/URL di-XML-escape (`escapeXmlText`, escape-never-reject, strip C0 ilegal-XML); JSON feed pakai `content_text` (tak pernah HTML tenant).
- **Whole-site `default_robots_noindex`** menekan SEMUA permukaan discovery (sitemap index/page + feed RSS/Atom/JSON → 404), bukan hanya `robots.txt` (`Disallow: /`) dan `<head>` per-halaman — jadi deployment staging ber-noindex tak membocorkan enumerasi URL ke scraper/aggregator non-patuh (audit MEDIUM-1). Gerbang ini mencermin `buildSeoDocument`.
- **Host di-render self-defending** — `resolve-canonical-host.ts` mem-validasi ulang bentuk DNS host primer (`normalizePublicHost` round-trip) di batas render sebelum menaruhnya di `https://{host}...`, sehingga relaksasi validasi domain-write di masa depan tak bisa menyuntik CR/LF ke robots/sitemap/feed (host out-of-shape → `null` → 404).

### 4. Permukaan discovery publik = route Astro, BUKAN kontrak REST

`/robots.txt`, `/sitemap.xml`, `/sitemap-{n}.xml`, `/feed.xml`, `/atom.xml`, `/feed.json` adalah route Astro XML/text tak-terautentikasi di root host — **sengaja di luar `src/pages/api/v1`**, jadi bukan bagian kontrak OpenAPI (posture sama dengan route konten publik `/blog/{tenantCode}`). Resolusi tenant/host lewat `withSeoPublicTenant` → resolver bersama `resolvePublicTenantFromRequest` (migrasi 048; host dipercaya hanya di belakang `PUBLIC_TRUST_PROXY`, lookup host digerbangi `PUBLIC_TENANT_RESOLUTION_MODE`), tiap hasil non-serving kolaps ke satu 404 generik yang di-normalisasi-latency. Route ini TIDAK di bawah `/admin`, jadi guard login middleware tak menyentuhnya — `src/middleware.ts` TIDAK diedit.

Hanya permukaan **config admin** (`GET`/`PUT /api/v1/seo/config`) yang jadi kontrak OpenAPI (fragment `openapi/modules/seo-distribution.openapi.yaml`, tag "SEO & Distribution"): `config.read`/`config.update` (di-seed `sql/058`), tenant-scoped (`withTenant` + RLS), `PUT` high-risk (menulis ulang permukaan metadata/indexability publik) → butuh `Idempotency-Key` + di-audit tiap tulis.

## Ditunda (PR tata-kelola redirect lanjutan)

- **Aturan redirect + hook redirect `src/middleware.ts`.** Resolusi redirect exact-path awcms-micro (tabel redirect, di-resolve di middleware sebelum routing konten publik) di luar scope — tidak ada tabel/permission/route redirect dibuat, dan `src/middleware.ts` TIDAK diedit. Guard redirect port (`classifyRedirectTarget`/`assertSafeRedirectTarget`) juga ditunda (lihat header `_shared/ports/seo-facts-port.ts`) dan masuk kembali sebagai helper standalone backward-compatible (bukan method `SeoFactsSource`).
- **Telemetri 404 + descriptor `dataLifecycle`.** Tabel governance 404 privacy-minimized awcms-micro dan descriptor `dataLifecycle` modul yang merujuknya DITUNDA — modul ini karenanya belum mendeklarasikan `dataLifecycle`, tak menyeed permission `redirect.*`/`not_found.*`, dan tak memberi grant tabel `awcms_worker`.
- **Route konten publik berbasis-host (refinement, bukan blocker).** Composition root discovery meng-scope adaptor `seo_facts` `blog_content` ke base path `/blog/{tenantCode}` (via `createBlogContentSeoFactsAdapter`), sehingga tiap `<loc>`/link feed = `/blog/{tenantCode}/{slug}` yang **RESOLVE ke route konten yang sudah di-ship** `/blog/[tenantCode]/[slug]` (ADR-0009) hari ini — bukan `/blog/{slug}` yang akan 404. Ketika route konten publik berbasis-host `/blog/{slug}` (host-resolved, tanpa segmen tenant-code) mendarat di follow-up, base path cukup diubah ke `/blog`. Jadi permukaan discovery kini benar **dan** URL-nya resolvable; sebelumnya (pra-review) canonical `/blog/{slug}` menunjuk 404 — itu diperbaiki di PR ini.

## Konsekuensi

- Positif: satu renderer SEO terpusat + permukaan discovery teruji, seam `seo_facts` beku yang mengizinkan tipe konten mana pun berkontribusi tanpa `seo_distribution` mengenalnya, pertahanan host-poisoning/JSON-LD/kebocoran-konten terkode di guard port, dan config tenant RLS FORCE'd + di-audit.
- Biaya: dua env var publik didokumentasikan (`PUBLIC_TRUST_PROXY`, `PUBLIC_TENANT_RESOLUTION_MODE`) di `.env.example` (dipakai bersama resolver host); `CAPABILITY_CONTRACT_VERSIONS` bertambah `seo_facts`; helper `escapeXmlText` + varian error `text/plain` ditambah ke `src/lib/html/*` (aditif).
- Keterbatasan (lihat `src/modules/seo-distribution/README.md`): tata-kelola redirect + telemetri 404 ditunda; adaptor `seo_facts` hanya memetakan tipe `blog_post`; canonical kini `/blog/{tenantCode}/{slug}` (resolvable) sampai route konten berbasis-host `/blog/{slug}` mendarat; paginasi child-sitemap masih berbasis `OFFSET` (bounded 1000 halaman + di-cache `s-maxage`; migrasi ke keyset adalah hardening lanjutan untuk tenant ber-konten jutaan — audit LOW-1); feed author per-item + `content_html` belum di kontrak facts; backfill permission hanya untuk tenant baru.

## Alternatif yang ditolak

- **Menjadikan `seo_facts` field array baru di `ModuleDescriptor`** (mis. `seoFacts`/`searchSources`) — mencampur seam capability level-sumber dengan seam descriptor; `seo_facts` sudah pas sebagai capability port (`capabilities.consumes`, satu-provider divalidasi komposisi). Ditolak.
- **Mem-port tata-kelola redirect + 404 sekaligus** — memperbesar PR dengan edit middleware + tabel redirect/404 + `dataLifecycle` + permission, menaikkan risiko regresi jalur login/routing. Ditolak; discovery lebih dulu (aditif murni, tanpa edit middleware), redirect menyusul PR tersendiri.
- **Mengekspos route discovery sebagai endpoint `/api/v1`** — sitemap/robots/feed adalah dokumen mesin-consumable di root host untuk crawler, bukan API tenant-terautentikasi; menjadikannya OpenAPI akan salah-model dan memaksa auth yang tak masuk akal. Ditolak (posture sama `/blog/{tenantCode}`).
