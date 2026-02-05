# Public Portal Development

## 1. Overview

The Public Portal (`awcms-public/`) handles the visitor-facing websites for each tenant. It uses Astro SSR for optimal performance.

## 2. Architecture

- **Framework**: Astro 5.12.9
- **Rendering**: Astro SSR via Cloudflare adapter across all public portals.
- **Styling**: Tailwind CSS 4.
- **Data Source**: Supabase (via direct client).
- **Analytics**: Server-side logging via middleware into `analytics_events` with daily rollups.
- **View Transitions**: Enabled via `astro:transitions` `ClientRouter` in `Layout.astro`.

## 3. Multi-Tenancy Strategy

Each tenant has a dedicated directory under `awcms-public/`. We currently use a "primary" template that can be cloned.

- `awcms-public/primary/`: The reference implementation.
- `awcms-public/{tenant_slug}/`: Dedicated implementations (future).

Middleware sets `locals.tenant_id`, `locals.tenant_slug`, `locals.locale`, and `locals.ref_code` for request-scoped rendering.

### Smandapbun Portal

- `awcms-public/smandapbun` is a single-tenant Astro site with shared middleware.
- Uses `src/lib/api.ts` + JSON fallbacks (see `docs/tenancy/smandapbun.md`).
- Tenant resolution falls back to a fixed slug when host/path lookups fail.
- All public portals standardize on React islands with Vite-based tooling.

## 4. Environment Variables

Public portals require:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_DEV_TENANT_HOST` (local development)

`createClientFromEnv` prefers `runtime.env` (Cloudflare) and falls back to `import.meta.env` during local dev.

## 5. Development Workflow

1. Navigate to `awcms-public/primary`.
2. `npm run dev` to start the local server.
3. Content changes in the Admin Panel are reflected on refresh (SSR).

## 5.1 Key Routes

- `/` (home): Loads `pages` with `page_type = home` or `slug = home`.
- `/p/[slug]`: Dynamic pages from `pages` table.
- `/blogs` + `/blogs/[slug]`: Dynamic blogs from `blogs` table.
- `/visitor-stats`: Public analytics rollup view.
- `/en` and `/id`: Locale-prefixed home routes.
- `homes/*` and `landing/*`: Static AstroWind marketing routes.

## 6. Visitor Analytics + Consent

- Consent banner: `awcms-public/primary/src/components/common/ConsentNotice.astro`.
- Logging: `awcms-public/primary/src/middleware.ts` logs page views, IPs, referrers, and device data.
- Public stats: `/visitor-stats` and `/[tenant]/visitor-stats`.

## 7. DB-Driven Admin Control

- Use `docs/dev/admin-public-db-driven-checklist.md` to track which content groups are wired to Supabase.
- Menus, pages, and settings should be sourced from tenant-scoped tables (`menus`, `pages`, `settings`).
- Header/footer menus are loaded via `lib/menu.ts`, widgets via `lib/widgets.ts`, and script plugins via `lib/plugins.ts`.
