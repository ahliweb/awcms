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
- **Tenant model**: Single-tenant with middleware-based resolution and fixed-slug fallback
- **Tenant resolution**: `src/middleware.ts` resolves host/path and falls back to `TENANT_SLUG = 'smandapbun'` in `src/lib/api.ts`
- **Supabase client**: `createClientFromEnv` (runtime env) + `supabase` fallback in `src/lib/supabase.ts`
- **Middleware**: `src/middleware.ts` logs analytics and sets `locals.tenant_id`, `locals.locale`, `locals.analytics_consent`
- **Output**: Astro SSR via Cloudflare adapter
- **Sessions**: Uses the in-memory session driver (no KV binding required).
- **Deployment config**: `awcms-public/smandapbun/wrangler.toml` includes SSR build settings only.
- **Layouts**: `src/layouts/Layout.astro` with global CSS, custom header/footer, no plugin loader

## Data Sources

### Settings Keys (Supabase)

The portal reads tenant settings and merges them with JSON defaults:

- `seo_global`
- `analytics_consent`
- `site_info`
- `contact_info`
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

### Menus

- Primary source: `menus` table via `getMenuTree()`.
- Fallback: `src/data/navigation.json`.

### Content Fallbacks

- Static JSON files under `src/data/pages/` and `src/data/blogs/` are used as defaults.
- `src/data/images.json` provides gallery fallback data.

### Blogs

- Posts are fetched from the `blogs` table via `getPosts()`.
- If Supabase is unavailable, the portal falls back to local JSON data.

## Localization

- Default locale: `id`.
- Locale detection is path-based (e.g., `/en/...`).
- `getLocalizedPath()` prepends `/en` when the locale is not the default.

## Admin Management

- Menus: `menus` table via Admin -> Menu Manager.
- School pages: `page_*` settings keys via Admin -> School Website.
- Site images: `site_images` via Admin -> Site Images.
- Blogs: `blogs` table via Admin -> Blogs.
- SEO/Branding/Contact: `seo_global`, `site_info`, `contact_info` via Admin settings.

## Cloudflare Pages Setup

- Root directory: `awcms-public/smandapbun`.
- Build command: `npm run build`.
- Output directory: `dist`.
- Required env vars: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `PUBLIC_TURNSTILE_SITE_KEY`.
- KV bindings: none (in-memory sessions).

## Contact Form

- Page: `src/pages/kontak.astro`.
- Uses `verify-turnstile` Edge Function before inserting `contact_messages`.

## Analytics + Consent

- `ConsentNotice` is rendered in `src/layouts/Layout.astro`.
- Middleware logs analytics events to `analytics_events` and sets consent state from cookies.
- `analytics_consent` settings provide localized banner copy.
- Analytics consent settings are resolved at request time in SSR.

## Migration Path (Future)

- Replace JSON fallbacks with fully DB-driven content (`pages`, `settings`, `site_images`).
- Remove fixed `TENANT_SLUG` fallback once host/path resolution is complete.

## Migration Checklist (Analytics + Middleware)

- [x] **Add middleware**: port `awcms-public/primary/src/middleware.ts` and ensure tenant resolution (path → host) plus locale/ref handling.
- [ ] **Tenant context**: remove fixed `TENANT_SLUG` usage and rely on middleware `locals.tenant_id` or host fallback.
- [x] **Scoped Supabase client**: use `createClientFromEnv` with `runtime.env` and `createScopedClient` for `x-tenant-id` headers.
- [x] **Consent banner**: add `ConsentNotice.astro` to the smandapbun layout and seed `analytics_consent` settings.
- [x] **Analytics logging**: enable middleware event inserts to `analytics_events` and rollups to `analytics_daily`.
- [ ] **Public stats route**: add `/visitor-stats` (host) and `/[tenant]/visitor-stats` (path) pages.
- [ ] **Regression**: consent banner shows and persists choice.
- [ ] **Regression**: analytics events log IP/path/referrer/device/geo.
- [ ] **Regression**: Admin “Visitor Statistics” updates with new events.
