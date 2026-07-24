---
"awcms": minor
---

Port modul `seo_distribution` — **scope discovery** — dari awcms-micro (ADR-0038, mengadaptasi awcms-micro ADR-0028; program penyerapan ADR-0035, Wave 1). Aditif net-baru; DAG tetap asiklik.

Yang ditambahkan:

- **Seam capability `seo_facts`** (`_shared/ports/seo-facts-port.ts`, `CAPABILITY_CONTRACT_VERSIONS["seo_facts"]="1.1.0"`): kontrak kontribusi beku (tipe fakta + guard JSON-LD terkontrol + predikat visibility + cache-key). `blog_content` kini `provides: ["public_content","seo_facts"]` lewat adaptor `application/seo-facts-port-adapter.ts` (baris `awcms_blog_posts` → `SeoResourceFacts`; noindex/non-publik/belum-terbit → `sitemap:null`/`feed:null`). `seo_distribution` `consumes` `seo_facts` (opsional) + `media_library` (opsional).
- **Modul `seo_distribution`** (`type: domain`, v0.1.0, deps Core-only): renderer metadata terpusat (canonical/hreflang/robots/OG/Twitter/JSON-LD terkontrol, host diturunkan server dari `tenant_domain`), serializer sitemap/robots/feed, orkestrator discovery + validator cache (ETag/Last-Modified/304).
- **Route discovery publik tak-terautentikasi** di root host: `/robots.txt`, `/sitemap.xml`, `/sitemap-{n}.xml`, `/feed.xml`, `/atom.xml`, `/feed.json` (route Astro XML/text, bukan OpenAPI; `src/middleware.ts` TIDAK diedit).
- **Config admin tenant** `GET`/`PUT /api/v1/seo/config` (`config.read`/`config.update`, tenant-scoped, `PUT` idempoten + di-audit) + fragment OpenAPI + tag "SEO & Distribution".
- **Migrasi 057-059**: `awcms_seo_tenant_settings` (RLS ENABLE+FORCE + `tenant_isolation`), seed permission config, kolom config feed/sitemap.
- Helper aditif `escapeXmlText` + varian error `text/plain` di `src/lib/html/*`; env var publik didokumentasikan (`PUBLIC_TRUST_PROXY`, `PUBLIC_TENANT_RESOLUTION_MODE`, `PUBLIC_DEFAULT_TENANT_*`).

Ditunda ke PR lanjutan (tata-kelola redirect): aturan redirect + hook redirect middleware, tabel telemetri 404, descriptor `dataLifecycle`, dan permission `redirect.*`/`not_found.*`.
