# News Portal

R2-only news media + editorial layer, **ported from awcms-mini** (epic
`news_portal` #631-#642/#649/#681/#690). Depends only on foundation modules
(`tenant_admin`, `identity_access`, `module_management`, `logging`). This
module PROVIDES the `news_media` capability that `blog_content` consumes, and
CONSUMES `blog_content`'s `public_content` capability — both wired at the
composition root through `_shared/ports/`, never a raw cross-module import.

## What this module ships

- **Tenant-scoped, R2-only media object registry** (`awcms_news_media_objects`,
  `sql/041`) — metadata only; image bytes live in Cloudflare R2. Direct-to-R2
  presigned upload flow:
  - `POST /api/v1/media/news-images/upload-sessions` — create a
    `pending_upload` row + short-lived presigned PUT URL (credentials never
    exposed to the browser).
  - `POST /api/v1/media/news-images/upload-sessions/{id}/finalize` — real R2
    HEAD + full GET, magic-byte MIME sniffing, and a server-side SHA-256
    checksum (never a bare HEAD). Requires `Idempotency-Key`.
  - `POST /api/v1/media/news-images/upload-sessions/{id}/cancel`.
- **Editorial homepage section composer** (`awcms_news_portal_homepage_sections`,
  `sql/044`) — admin CRUD at `/api/v1/news-portal/homepage-sections`
  (`GET`/`POST`) and `.../{id}` (`PATCH`/`DELETE`), with write-time reference
  validation against `blog_content` (via `public_content`) and the media
  registry.
- **R2-only advertisement placement presets**
  (`awcms_news_portal_ad_placements`, `sql/045`) — admin CRUD at
  `/api/v1/news-portal/ad-placements`. Every row references a verified R2
  media object by a real FK, so R2-only-ness holds by construction.
- **Reconciliation job** — `bun run news-media:reconcile`
  (`scripts/news-media-r2-reconcile.ts`) reconciles registry metadata against
  the real R2 bucket, cleaning up expired pending uploads and grace-period
  orphans in bounded, race-safe batches. No-op unless `NEWS_MEDIA_R2_ENABLED`.
  Runs as the least-privilege `awcms_worker` role (grant in `sql/041`).

## Migrations & RLS

`sql/041`..`sql/045`. Four new tenant-scoped tables, each `ENABLE` +
**`FORCE ROW LEVEL SECURITY`** with the standard
`tenant_id = current_setting('app.current_tenant_id')::uuid` policy:
`awcms_news_media_objects`, `awcms_news_portal_tenant_state`,
`awcms_news_portal_homepage_sections`, `awcms_news_portal_ad_placements`.
`sql/042` seeds the `news_portal.media.*` permission catalog; `sql/044`/`sql/045`
seed the `homepage_sections`/`ad_placements` `read`/`configure` pairs.

## Port-time drops (documented, not silent)

- **Host-resolved `/news/**` public routes** (index/detail/category/tag/search/
  feed/sitemap) are NOT ported — they require `tenant_domain`'s custom-domain
  resolver + `PUBLIC_TENANT_RESOLUTION_MODE` plumbing, not yet in this base.
  The `/news`-only render helpers (`homepage-section-composer.ts`,
  `homepage-section-rendering.ts`, `news-share-config.ts`) are dropped with
  them.
- **Per-module `.astro` admin pages** are not ported (this base has no
  per-module admin UI yet). The `navigation` entries in `module.ts` are
  descriptor metadata only — same convention `blog_content`'s `/admin/blog`
  entry uses.
- **Preset activation** (`apply-news-portal-preset.ts` + the
  `news_portal_full_online_r2` module preset) is dropped because
  `module_management`'s preset subsystem (`applyModulePreset`/`MODULE_PRESETS`)
  is not ported. The `awcms_news_portal_tenant_state` marker table (`sql/043`)
  and its read helper are retained (forward-compatible), but with no writer the
  `news_media` port's `isFullOnlineR2ModeActiveForTenant` always resolves
  `false` — identical net behavior to `blog_content`'s prior no-op adapter,
  while the registry/upload/homepage/ads surfaces all work independently.

## `news_media` capability — real adapter

`application/news-media-port-adapter.ts` (`newsMediaPortAdapter`) implements
`_shared/ports/news-media-port.ts`. This port replaces `blog_content`'s
port-time `noopNewsMediaPortAdapter` at every composition root (blog admin
routes, `/blog/{tenantCode}` public routes, and the `blog:publish:scheduled`
worker). `blog_content`'s own `application`/`domain` code is untouched — only
the injected adapter changed.

## Env var naming — `NEWS_MEDIA_R2_*`, not `R2_*`

`sync-storage` already uses `R2_*` for its **private** offline/LAN object
queue. News media R2 is a **public** concern (custom domain, CORS
direct-upload) requiring a fully separate bucket/credentials, so it uses the
`NEWS_MEDIA_R2_*` prefix (`domain/news-media-r2-config.ts`).

## No local filesystem fallback

This mode never stores news image bytes on local disk — there is no such code
path to disable. `tests/news-portal-no-local-fallback.test.ts` enforces this
structurally (grepping the module + route trees), failing loudly the moment
any PR adds a local write for news media bytes.

## References

- `.claude/skills/awcms-news-portal/SKILL.md` — target-spec context for this
  port.
- `src/modules/sync-storage/README.md` — the pre-existing private R2 usage,
  deliberately separate from this module.
