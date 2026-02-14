> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1 (Tech Stack)

# Public Portal Architecture

## Purpose

Describe how the public portal renders tenant content and enforces security constraints.

## Audience

- Public portal developers
- Operators deploying Astro to Cloudflare Pages

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for Public Portal architecture (Astro 5.17.1, React 19.2.4, static output)
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references
- `docs/tenancy/overview.md`
- `docs/tenancy/supabase.md`

## Core Concepts

- Astro static output with React islands on Cloudflare Pages.
- Tenant resolution at build time via `PUBLIC_TENANT_ID` and `getStaticPaths`.
- `PuckRenderer` for rendering Puck JSON with a server-side allow-list.
- View transitions are enabled via `astro:transitions` `ClientRouter` in `Layout.astro`.

## How It Works

### Tenant Resolution

- Build-time tenant resolution uses `PUBLIC_TENANT_ID` (or `VITE_PUBLIC_TENANT_ID`).
- Tenant-specific routes use `getStaticPaths` to generate output.
- Middleware-based resolution is only used in SSR/runtime deployments.

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

- Use `createClientFromEnv` with `import.meta.env` for static builds.
- Use `createScopedClient` with `x-tenant-id` headers for tenant-scoped reads when needed.
- Use `tenantUrl` from `src/lib/url.ts` for internal links.
- Analytics logging is available only when middleware is enabled in SSR/runtime.

## Permissions and Access

- Public portal only renders published content.
- No runtime use of `@puckeditor/puck` editor; only `PuckRenderer` is allowed.

## Security and Compliance Notes

- Registry allow-list prevents unknown components from rendering.
- All data access must be RLS-scoped and filtered for `deleted_at`.
- Consent notices are rendered in `awcms-public/primary/src/components/common/ConsentNotice.astro`.
- HTML content is rendered via `set:html`; ensure stored content is sanitized at write time.

## Operational Concerns

- Cloudflare Pages uses build-time env variables for static output.
- Ensure `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `PUBLIC_TENANT_ID` are set.

## Tenant Variants

- `awcms-public/smandapbun` is a dedicated single-tenant static portal.
- It uses a fixed slug fallback and JSON fallbacks for content.
- See `docs/tenancy/smandapbun.md` for its data sources and migration path.

## References

- `docs/modules/TEMPLATE_MIGRATION.md`
- `docs/tenancy/overview.md`
- `../../awcms-public/primary/README.md`
