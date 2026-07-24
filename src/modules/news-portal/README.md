# News Portal

Editorial layer for a full-online, R2-only news portal, **ported from
awcms-mini** (epic `news_portal` #631-#642/#649/#681/#690). Depends only on
foundation modules (`tenant_admin`, `identity_access`, `module_management`,
`logging`).

**ADR-0036 ownership inversion:** the tenant media object registry, its
direct-to-R2 upload flow, MIME sniffing, R2 config/client, verification, and the
`news-media:reconcile` job were **extracted out of this module into
`media_library`**. This module no longer PROVIDES `news_media` (retired). It now:

- **CONSUMES `media_library`** (required) — its ad placements hold a real FK to a
  media object. Its ad-placement/homepage-section reference validators read
  `media_library`'s registry (`fetchNewsMediaObjectById` /
  `isNewsMediaObjectSafeForPublicReference`) and readiness
  (`evaluateManagedMediaReadiness`) by **direct source import**, not the injected
  `MediaLibraryPort` — a deliberate divergence from the port, because those
  FK-holding resources need the media object's own fields (status/MIME), not the
  port's safe/unsafe boolean. The direction stays legal (domain → System
  Foundation; `media_library` never imports back, proven by the port-ownership
  test). Contrast `blog_content`, which uses the injected port.
- **CONSUMES `blog_content`'s `public_content`** capability, wired at the
  composition root through `_shared/ports/public-content-port.ts`.

## What this module ships

- **Editorial homepage section composer** (`awcms_news_portal_homepage_sections`,
  `sql/044`) — admin CRUD at `/api/v1/news-portal/homepage-sections`
  (`GET`/`POST`) and `.../{id}` (`PATCH`/`DELETE`), with write-time reference
  validation against `blog_content` (via `public_content`) and the
  `media_library` registry (via direct import — see above).
- **R2-only advertisement placement presets**
  (`awcms_news_portal_ad_placements`, `sql/045`) — admin CRUD at
  `/api/v1/news-portal/ad-placements`. Every row references a verified media
  object by a real FK (`media_object_id` → `awcms_news_media_objects.id`), so
  R2-only-ness holds by construction. This FK into `media_library`'s table is
  exactly why that table is **not** renamed by the inversion (ADR-0036 §3).

The media object **registry**, presigned upload endpoints
(`/api/v1/media/news-images/upload-sessions/*`), MIME sniffing, R2
config/client, verification, and the `bun run news-media:reconcile` job now live
in **`media_library`** — see `src/modules/media-library/README.md`.

## Migrations & RLS

`sql/043`..`sql/045`. Tenant-scoped tables, each `ENABLE` +
**`FORCE ROW LEVEL SECURITY`** with the standard
`tenant_id = current_setting('app.current_tenant_id')::uuid` policy:
`awcms_news_portal_tenant_state` (`sql/043`),
`awcms_news_portal_homepage_sections` (`sql/044`),
`awcms_news_portal_ad_placements` (`sql/045`). `sql/044`/`sql/045` seed the
`homepage_sections`/`ad_placements` `read`/`configure` permission pairs.

The media registry table `awcms_news_media_objects` (`sql/041`) and its
`media_library.media.*` permission catalog (`sql/042`, repointed from
`news_portal.media.*` by the inversion migration `sql/052`) belong to
**`media_library`** now; this module only holds an FK into the table.

## Managed-media enforcement (no writer here)

`awcms_news_portal_tenant_state` (`sql/043`) + its read helper
`isFullOnlineR2ModeAppliedForTenant` are retained (forward-compatible) but, with
the `news_portal_full_online_r2` preset-activation path dropped (below), have no
writer and are inert. In this base, managed-media enforcement is turned on
per-tenant by `media_library`'s own one-way `POST /api/v1/media/enforcement`
switch instead. `domain/news-portal-preset-readiness.ts` still composes
`media_library`'s `evaluateManagedMediaReadiness` for the same reason codes.

## Port-time drops (documented, not silent)

- **Host-resolved `/news/**` public routes** (index/detail/category/tag/search/
  feed/sitemap) are NOT ported — they require `tenant_domain`'s custom-domain
  resolver + `PUBLIC_TENANT_RESOLUTION_MODE` plumbing. The `/news`-only render
  helpers (`homepage-section-composer.ts`, `homepage-section-rendering.ts`,
  `news-share-config.ts`) are dropped with them.
- **Per-module `.astro` admin pages** are not ported (this base has no
  per-module admin UI yet). The `navigation` entries in `module.ts` are
  descriptor metadata only — same convention `blog_content`'s `/admin/blog`
  entry uses.
- **Preset activation** (`apply-news-portal-preset.ts` + the
  `news_portal_full_online_r2` module preset) is dropped because
  `module_management`'s preset subsystem (`applyModulePreset`/`MODULE_PRESETS`)
  is not ported.

## Env var naming — `NEWS_MEDIA_R2_*`, not `R2_*`

The `NEWS_MEDIA_R2_*` prefix (a **public** R2 concern — custom domain, CORS
direct-upload — kept deliberately separate from `sync-storage`'s **private**
`R2_*` offline queue) is owned by `media_library`
(`media-library/domain/media-r2-config.ts`, name preserved per ADR-0036 §4).
This module reads it only indirectly, through `media_library`'s
`evaluateManagedMediaReadiness`.

## No local filesystem fallback

This module never stores news image bytes on local disk — there is no such code
path. `tests/news-portal-no-local-fallback.test.ts` enforces this structurally
(grepping the module + route trees), failing loudly the moment any PR adds a
local write for news media bytes.

## References

- `src/modules/media-library/README.md` — the media registry/upload/reconcile
  surface this module now consumes.
- `docs/adr/0036-media-library-module-admission-ownership-inversion.md` — the
  ownership inversion.
- `.claude/skills/awcms-news-portal/SKILL.md` — target-spec context for this
  port.
- `src/modules/sync-storage/README.md` — the pre-existing private R2 usage,
  deliberately separate from media R2.
