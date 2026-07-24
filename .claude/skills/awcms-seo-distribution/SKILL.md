---
name: awcms-seo-distribution
description: Modul seo_distribution SUDAH di-port PENUH ke repo ini — DISCOVERY (ADR-0038; migrasi sql/057 schema + sql/058 permission + sql/059 kolom feed) + REDIRECT GOVERNANCE (ADR-0039; migrasi sql/060 schema 3 tabel + sql/061 6 permission). Modul `type: domain` (v0.2.0, deps Core-only) CONSUMER/aggregator: renderer metadata SEO terpusat (canonical/hreflang/robots/OG/JSON-LD terkontrol, host diturunkan server dari `tenant_domain`) + route discovery publik tak-terautentikasi di root host (`/robots.txt`, `/sitemap.xml`, `/sitemap-{n}.xml`, `/feed.xml`, `/atom.xml`, `/feed.json`, route Astro XML/text BUKAN OpenAPI) + config admin `GET`/`PUT /api/v1/seo/config`. REDIRECT: aturan redirect exact-path (`awcms_seo_redirects`), telemetri 404 (`awcms_seo_not_found_observations` + descriptor `dataLifecycle`), kebijakan (`awcms_seo_redirect_settings`), semua FORCE RLS; di-resolve di `src/middleware.ts` cabang non-`/admin` (FAIL-OPEN) via `src/lib/seo/redirect-middleware.ts`; guard open-redirect beku di `domain/redirect-target-classification.ts` (BUKAN di port `seo_facts`); admin API `/api/v1/seo/redirects/*` + `/api/v1/seo/not-found/*`. Adaptasi awcms: host-based-only (path-tenant ditunda), legacy-blog `/news` INERT, `locale=null`. Mengonsumsi capability `seo_facts` (`blog_content` menyediakan, seam `_shared/ports/seo-facts-port.ts`, `CAPABILITY_CONTRACT_VERSIONS["seo_facts"]="1.1.0"`) + `media_library` (opsional). Gunakan saat mengubah renderer/serializer SEO, config tenant, seam `seo_facts`, route discovery, atau tata-kelola redirect/404.
---

# AWCMS — SEO & Distribution (Discovery: renderer + sitemap/robots/feed + config)

> **STATUS — modul ini SUDAH di-port PENUH ke repo ini (DISCOVERY ADR-0038 +
> REDIRECT GOVERNANCE ADR-0039).** `seo_distribution` hidup di
> `src/modules/seo-distribution/`. Discovery: migrasi `sql/057` (schema
> `awcms_seo_tenant_settings`, FORCE RLS) + `sql/058` (permission config) + `sql/059`
> (kolom feed/sitemap). Redirect governance: migrasi `sql/060` (3 tabel
> `awcms_seo_redirects`/`awcms_seo_not_found_observations`/`awcms_seo_redirect_settings`,
> semua FORCE RLS) + `sql/061` (6 permission `redirect.*`/`not_found.*`). File
> redirect NYATA ada sekarang: `domain/redirect-*.ts` (incl.
> `redirect-target-classification.ts` = guard beku, di-rumahkan di domain BUKAN di
> port `seo_facts`), `application/redirect-*.ts`/`not-found-directory.ts`,
> `src/lib/seo/redirect-middleware.ts`, route `src/pages/api/v1/seo/redirects/**` +
> `not-found/**`, dan **satu edit `src/middleware.ts`** (cabang non-`/admin`,
> FAIL-OPEN). Adaptasi awcms: resolusi tenant host-based-only (path-tenant ditunda),
> legacy-blog `/news` INERT (tanpa keluarga route `/news`), `locale=null` (tanpa seam
> i18n).

## Bentuk modul

- `key: seo_distribution`, `type: domain`, `version: 0.2.0`, `dependencies:
[tenant_admin, identity_access]` (Core-only → DAG asiklik). **CONSUMER/aggregator**,
  bukan provider — tidak ada modul lain yang dibuat bergantung padanya.
- `capabilities.consumes`: `seo_facts` (providedBy `blog_content`, `optional`) +
  `media_library` (providedBy `media_library`, `optional`). Kedua `optional: true`
  → degrade aman (tak ada fakta/gambar → tak ada halaman/feed).
- `permissions`: `config.{read,update}` (discovery) + `redirect.{read,create,update,delete}`
  - `not_found.{read,update}` (redirect governance, ADR-0039). `dataLifecycle`:
    descriptor `seo_distribution.not_found_observations` (analytics_telemetry, generic
    purge). **TIDAK ada `jobs`/`events`/`navigation`.**

## Seam capability `seo_facts` (INI titik ekstensi utama)

`seo_facts` adalah **capability port** (`_shared/ports/seo-facts-port.ts`),
dikonsumsi via `capabilities.consumes` — **BUKAN** field array di `ModuleDescriptor`.
Arah panah ke dalam: modul konten MENYEDIAKAN fakta, `seo_distribution`
menemukannya di composition root route (`src/lib/seo/discovery-providers.ts`) dan
meng-inject sebagai parameter biasa. `seo_distribution` tak pernah import modul
konten; sebaliknya juga.

- **`blog_content` = satu-satunya provider** (`module-composition.ts`
  `capability_provider_conflict` menegakkan satu-provider-per-capability).
  `blog_content.capabilities.provides = ["public_content", "seo_facts"]`;
  adaptor `blog-content/application/seo-facts-port-adapter.ts` memetakan baris
  `awcms_blog_posts` → `SeoResourceFacts`.
- **Menambah provider konten baru**: modul konten ship
  `<module>/application/seo-facts-port-adapter.ts` sendiri + tambah `"seo_facts"`
  ke `provides`-nya, lalu daftarkan adaptornya di `discovery-providers.ts`.
  `seo_distribution` tak perlu tahu tipe konten itu (resourceType opaque).
- **Versi**: `CAPABILITY_CONTRACT_VERSIONS["seo_facts"] = "1.1.0"` (port ship
  langsung dengan `summarizePublicResourceFacts` + `offset`/`order`). Manifest
  keluarga `awcms-family-compatibility.yaml` HARUS cocok key-for-key (gate
  `family:conformance:check`). Menaikkan port → naikkan KEDUA + tes semantik.
- **Mapping visibility (fail-safe, ADR-0038 §3)**: baris noindex (unlisted) /
  non-publik (draft/private/archived/deleted) / belum-terbit (`published_at` null
  atau di masa depan → dilaporkan `scheduled`) → `sitemap:null`/`feed:null`. Ini
  pertahanan kebocoran-konten-belum-terbit di sisi provider; renderer/aggregator
  meng-gate lagi via `isPubliclyIndexable` (defense in depth).

## Invarian keamanan (guard beku port — JANGAN turunkan ulang)

- **Host-header poisoning**: canonical/OG/hreflang host DITURUNKAN server dari
  domain primer terverifikasi (`application/resolve-canonical-host.ts` →
  `awcms_tenant_domains.is_primary AND status='active'`), TAK PERNAH dari header
  `Host`. Tanpa host primer: canonical → path relatif; **sitemap/feed → 404 (null)**
  (loc/id/guid WAJIB absolut); robots.txt tetap 200 tanpa baris `Sitemap:`.
- **JSON-LD injection**: HANYA `renderControlledJsonLd` (`_shared/ports/seo-facts-port.ts`)
  yang mengemit JSON-LD — validasi union `@type`/key tertutup + escape
  `<>&`/U+2028/U+2029. JANGAN hand-serialize JSON-LD.
- **XML injection**: tiap teks/URL sitemap/feed lewat `escapeXmlText`
  (`src/lib/html/escape.ts`, strip C0 ilegal-XML + escape 5 entitas). JSON feed
  pakai `content_text` (tak pernah HTML tenant).
- **Cache poisoning/cross-tenant**: `buildSeoCacheKey`/`buildDiscoverySignature`
  tenant-first (throw tanpa tenant+host+locale). `awcms_seo_tenant_settings` FORCE
  RLS. Signature NUL-joined (bagian free-text tak bisa merge lintas batas).
- **Sitemap amplification**: ceiling keras non-configurable di
  `domain/discovery-limits.ts` (`SITEMAP_URLS_PER_PAGE`/`SITEMAP_MAX_CHILD_PAGES`);
  feed dibatasi `feed_item_limit` (≤200). Tak ada scan seluruh konten per-request.

## Route discovery publik = Astro, BUKAN OpenAPI

`/robots.txt`, `/sitemap.xml`, `/sitemap-[page].xml`, `/feed.xml`, `/atom.xml`,
`/feed.json` di `src/pages/` (root host) — tak-terautentikasi, **di luar
`src/pages/api/v1`** jadi tak kena parity OpenAPI dan tak kena guard login
middleware. Pipeline di `src/lib/seo/discovery-route.ts` (`serveDiscovery`):
`withSeoPublicTenant` (resolusi tenant via host, `PUBLIC_TRUST_PROXY`/
`PUBLIC_TENANT_RESOLUTION_MODE`; non-serving → 404 generik di-normalisasi-latency)
→ `resolveEnabledSeoProviders` → builder → validator cache (304). **Hanya config
admin `GET`/`PUT /api/v1/seo/config` yang OpenAPI** (fragment
`openapi/modules/seo-distribution.openapi.yaml`, tag "SEO & Distribution");
`PUT` high-risk → `Idempotency-Key` + audit.

## Jebakan port

- `escapeXmlText`/`XML_ILLEGAL_C0` di `src/lib/html/escape.ts` dan
  `escapeJsonLdText` di port memakai **escape sequence** (mis. rentang C0 `\u0000-\u001F` dan separator `\u2028`/`\u2029`), bukan karakter separator/kontrol literal — jangan tulis byte kontrol/separator mentah ke file (Edit/Write bisa menormalkannya diam-diam).
- Adaptor `blog_content` membangun canonical `/blog/{slug}` (host-relative). Basis
  kini hanya ship route konten legacy `/blog/{tenantCode}/{slug}` (ADR-0009); route
  konten berbasis-host yang ditunjuk URL sitemap/feed adalah **follow-up** — surface
  discovery tetap benar & aman.
- Menambah migrasi ke tabel ini → migrasi baru berurutan (≥060); regen
  composition inventory + jalankan gate `family:conformance:check`,
  `modules:compose:check`, `api:spec:check` + regen bundle OpenAPI.

## Verifikasi

`bun run db:migrate` (baru 057-059), `bun run api:spec:check`,
`bun run family:conformance:check`, `bun run modules:compose:check`, `bun test`
(unit + integrasi DB-gated `tests/integration/seo-distribution.integration.test.ts`:
FORCE RLS di bawah `awcms_app` LOGIN + build discovery mengembalikan fakta blog
terbit, bukan draft/private).
