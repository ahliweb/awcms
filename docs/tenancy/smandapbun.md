> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1 (Tech Stack)

# Smandapbun Public Portal (Tenant)

## Purpose

Document the tenant-specific Astro implementation for **smandapbun**, including its data sources, localization behavior, and current migration status.

## Audience

- Public portal developers
- Operators deploying the smandapbun site

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for tenant-specific public portal architecture
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references
- `docs/dev/public.md`
- `docs/tenancy/overview.md`

## Architecture Summary

- **Project**: `awcms-public/smandapbun`
- **Tenant model**: Single-tenant with fixed build-time resolution
- **Tenant resolution**: `TENANT_SLUG = 'smandapbun'` in `src/lib/api.ts`
- **Supabase client**: `createClientFromEnv` via `import.meta.env`
- **Output**: Astro static build
- **Sessions**: Not used (static output)
- **Layouts**: EmDash-style public shell built around `src/layouts/BaseLayout.astro` and `src/layouts/Layout.astro`, with custom header/footer plus plugin head/body and widget-area loaders

## Data Sources

## Public Shell And Plugin Surfaces

- `src/layouts/BaseLayout.astro` now provides the EmDash-style public shell for the tenant.
- `src/layouts/Layout.astro` remains the route-facing wrapper that derives metadata and public page context.
- Public plugin fragment injection is now resolved through:
  - `src/components/common/PublicHead.astro`
  - `src/components/common/PublicBodyStart.astro`
  - `src/components/common/PublicBodyEnd.astro`
- Public widget-area rendering is now available through:
  - `src/components/common/WidgetArea.astro`
  - `src/components/common/WidgetRenderer.astro`
- Blog detail pages and the tenant footer now expose widget-area insertion points while preserving the sovereign `smandapbun` route structure and branding.
- Shared public composition primitives now live under `src/components/public/` and are used by the homepage, blog surfaces, profile/settings-backed routes, agenda, gallery, and contact pages.
- The current primitive layer includes shell/content helpers such as `PageHero`, `PageContentShell`, `RichContentCard`, `Section`, `SplitSection`, `StatGrid`, `BlogCard`, `BlogSidebar`, archive/detail helpers like `AgendaArchiveContent`, `GalleryArchiveContent`, `ContactInfoPanel`, and profile-content primitives like `MetricCardGrid`, `TimelineList`, `NumberedPanelList`, and `BadgeCardGrid`.
- Public navigation now consumes tenant-managed `menus` rows for `header`, `footer`, and `mobile_menu` on a per-locale basis before falling back to the bundled tenant navigation JSON.

### Settings Keys (Supabase)

The portal reads tenant settings and merges them with JSON defaults:

- `seo_global`
- `analytics_consent`
- `site_info`
- `contact_info`
- `site_images`
- `page_contact`
- `page_profile`
- `page_organization`
- `page_services`
- `page_finance`
- `page_staff`
- `page_achievements`
- `page_alumni`
- `page_agenda`
- `page_gallery`
- `page_school_info`

- The sovereign public portal now understands both the nested and the current flat admin `site_info` payload shape emitted by `awcms/SettingsManager.jsx`, including contact and social fields.
- `page_agenda`, `page_gallery`, and `page_contact` are consumed directly as tenant-scoped admin-managed structured fallback content instead of relying only on bundled JSON defaults.

### Menus

- Primary source: `menus` table via `getMenuTree()`.
- Fallback: `src/data/navigation.json`.
- Locale fallback: English header/footer first load `locale = en` menu rows, then fall back to default-locale tenant menus before using JSON.

### Pages

- Admin-managed regular pages are read from the `pages` table.
- Public routes are generated at build time from published tenant pages.
- Top-level reserved school routes (`/profil`, `/blogs`, `/layanan`, etc.) stay tenant-template owned; non-reserved page slugs are rendered dynamically.
- Localized page slugs/content can be overlaid from `content_translations` when available.
- Reserved school routes now render Admin-managed `pages` records for the matching tenant slug (`profil`, `visi-misi`, `laboratorium`, `prestasi`, `alumni`, and related sections).

### Content Fallbacks

- Static JSON files under `src/data/pages/` and `src/data/blogs/` are used as defaults.
- `src/data/images.json` provides gallery fallback data.

### Blogs

- Posts are fetched from the `blogs` table via `getPosts()`.
- Static blog detail routes are generated from published tenant blog rows.
- Localized blog slugs/content can be overlaid from `content_translations` when available.
- Local JSON blog fallback is now limited to local development when tenant data is unavailable.

### Automatic Rebuilds

- `pages`, `blogs`, and `menus` changes can trigger a public rebuild through the `public_rebuild_webhook_url` tenant setting.
- The live rebuild target for tenant `smandapbun` is a Cloudflare Pages deploy hook for project `awcms-smandapangkalanbun-web`.
- Admin save/delete flows in AWCMS also call `awcms-edge` at `/api/public/rebuild`, which looks up the tenant deploy hook and triggers a production rebuild.
- Database-trigger rebuilds remain supported by the migration path when applied remotely.
- The GitHub deployment workflow targets the Cloudflare Pages project `awcms-smandapangkalanbun-web`, which serves `sman2pangkalanbun.sch.id` and `www.sman2pangkalanbun.sch.id`.

### File Storage

- Tenant-managed files use Cloudflare R2 through the shared `awcms-edge` media service.
- Storage keys are tenant-prefixed as `tenants/<tenant_id>/...` (or `tenants/<tenant_id>/protected/...` for session-bound/private media).
- The maintained production bucket is `awcms-s3`; `awcms-s3-dev` remains available for local/dev workflows.

## Localization

- Default locale: `id`.
- Locale detection is path-based (e.g., `/en/...`).
- `getLocalizedPath()` prepends `/en` when the locale is not the default.

## Admin Management

- Menus: `menus` table via Admin -> Menu Manager.
- School pages: published `pages` rows for route-backed sections; legacy `page_*` settings remain as seed/fallback sources during transition.
- Site images: `site_images` via Admin -> Site Images.
- Blogs: `blogs` table via Admin -> Blogs.
- SEO/Branding/Contact: `seo_global`, `site_info`, `contact_info` via Admin settings.

## Cloudflare Pages Setup

- Root directory: `awcms-public/smandapbun`.
- Build command: `npm run build`.
- Output directory: `dist`.
- Required env vars: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `PUBLIC_TURNSTILE_SITE_KEY`, `PUBLIC_TENANT_ID`.
- KV bindings: none currently required by the maintained repo baseline; middleware uses cookie-based identifiers/tracking rather than an in-repo KV-backed or in-memory session driver.

## Contact Form

- Page: `src/pages/kontak.astro`.
- Uses the `verify-turnstile` Cloudflare Worker route before inserting `contact_messages`.

## Analytics + Consent

- `ConsentNotice` is rendered in `src/layouts/Layout.astro`.
- Analytics logging is only available when running middleware in SSR/runtime mode.
- `analytics_consent` settings provide localized banner copy.

## Migration Path (Future)

- Replace remaining school-page JSON fallbacks with fully DB-driven content (`settings`, `site_images`, or `pages` where appropriate).
- Add optional middleware only if SSR/runtime deployment is required.

## Migration Checklist (Analytics + Middleware)

- [x] **Fixed tenant slug**: set `TENANT_SLUG = 'smandapbun'` in `src/lib/api.ts`.
- [x] **Scoped Supabase client**: use `createClientFromEnv` with build-time env for static builds.
- [x] **Consent banner**: add `ConsentNotice.astro` to the smandapbun layout and seed `analytics_consent` settings.
- [ ] **Optional middleware**: add SSR middleware only if runtime analytics or host-based tenant resolution is required.
- [ ] **Public stats route**: add `/visitor-stats` page if analytics logging is enabled.
