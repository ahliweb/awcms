# Public Portal Architecture

## Purpose

Describe how the public portal renders tenant content and enforces security constraints.

## Audience

- Public portal developers
- Operators deploying Astro to Cloudflare Pages

## Prerequisites

- `docs/tenancy/overview.md`
- `docs/tenancy/supabase.md`

## Core Concepts

- Astro SSR/Islands architecture on Cloudflare Pages (output: `server`) with optional SSG builds for tenant portals.
- Tenant resolution in middleware with path-first, host-fallback.
- `PuckRenderer` for rendering Puck JSON with a server-side allow-list.
- View transitions are enabled via `astro:transitions` `ClientRouter` in `Layout.astro`.

## How It Works

### Tenant Resolution

- Middleware: `awcms-public/primary/src/middleware.ts`.
- Priority order:
  1. Path slug via `get_tenant_by_slug`.
  2. Host fallback via `get_tenant_id_by_host`.
- Host-resolved tenants are served at root paths without redirects.
- Locale prefixes (`/en`, `/id`) are stripped for internal routing and stored in `locals.locale`.
- Referral codes (`/ref/{code}`) are stripped and stored in `locals.ref_code`.

### Rendering Pipeline

- `Layout.astro` wires core metadata, plugin loaders, and the consent notice.
- `PageLayout.astro` fetches header/footer menus from `menus` with a navigation fallback.
- `PuckRenderer`: `awcms-public/primary/src/components/common/PuckRenderer.astro`.
- Widget mapping: `awcms-public/primary/src/components/common/WidgetRenderer.astro`.
- Shared types: `awcms-public/primary/src/types.d.ts`.
- Plugin scripts: `awcms-public/primary/src/components/common/PluginLoader.astro` (via `plugins` table).

### Rich Text

- Public pages render stored content via server-side components or markdown pipelines.
- TipTap editor runtime is never used on the public portal.

### Routes

- `/`: `src/pages/index.astro` (home page from `pages` table or widget fallback).
- `/en` and `/id`: locale-prefixed home routes.
- `/p/[slug]`: dynamic pages from `pages` table.
- `/blogs` and `/blogs/[slug]`: dynamic blog list and posts from Supabase.
- `src/pages/[...blog]/*`: static AstroWind blog routes (content collections).
- `src/pages/[tenant]/visitor-stats.astro` handles the public analytics page for path-based tenants.
- `src/pages/visitor-stats.astro` handles host-based tenants.

## Implementation Patterns

- Use `createClientFromEnv` to construct Supabase clients with `runtime.env` (Cloudflare) fallback to `import.meta.env`.
- Use `createScopedClient` with `x-tenant-id` headers for tenant-scoped reads.
- Use `tenantUrl` from `src/lib/url.ts` for internal links.
- Use middleware-based logging for visitor analytics (`analytics_events` + `analytics_daily`).

## Permissions and Access

- Public portal only renders published content.
- No runtime use of `@puckeditor/puck` editor; only `PuckRenderer` is allowed.

## Security and Compliance Notes

- Registry allow-list prevents unknown components from rendering.
- All data access must be RLS-scoped and filtered for `deleted_at`.
- Consent notices are rendered in `awcms-public/primary/src/components/common/ConsentNotice.astro`.
- HTML content is rendered via `set:html`; ensure stored content is sanitized at write time.

## Operational Concerns

- Cloudflare Pages uses runtime env variables via `runtime.env`.
- Ensure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set.

## Tenant Variants

- `awcms-public/smandapbun` is a dedicated single-tenant portal with middleware-based analytics and consent.
- It uses a fixed slug fallback and JSON fallbacks for content.
- It can build SSR (`PUBLIC_PORTAL_RENDER_MODE=server`) or SSG (`PUBLIC_PORTAL_RENDER_MODE=static`) depending on deployment.
- See `docs/tenancy/smandapbun.md` for its data sources and migration path.

## References

- `docs/modules/TEMPLATE_MIGRATION.md`
- `docs/tenancy/overview.md`
- `../../awcms-public/primary/README.md`
