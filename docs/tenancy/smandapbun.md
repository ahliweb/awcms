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
- Analytics logging is only available when running middleware in SSR/runtime mode.
- `analytics_consent` settings provide localized banner copy.

## Migration Path (Future)

- Replace JSON fallbacks with fully DB-driven content (`pages`, `settings`, `site_images`).
- Add optional middleware only if SSR/runtime deployment is required.

## Migration Checklist (Analytics + Middleware)

- [x] **Fixed tenant slug**: set `TENANT_SLUG = 'smandapbun'` in `src/lib/api.ts`.
- [x] **Scoped Supabase client**: use `createClientFromEnv` with build-time env for static builds.
- [x] **Consent banner**: add `ConsentNotice.astro` to the smandapbun layout and seed `analytics_consent` settings.
- [ ] **Optional middleware**: add SSR middleware only if runtime analytics or host-based tenant resolution is required.
- [ ] **Public stats route**: add `/visitor-stats` page if analytics logging is enabled.
