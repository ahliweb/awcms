> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1 (Tech Stack)

# Public Portal Architecture

## Purpose

Describe how the public portal renders tenant content and enforces security constraints.

## Audience

- Public portal developers
- Operators deploying Astro to Cloudflare Pages

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for Public Portal architecture (Astro 6.0.8, React 19.2.4, static output)
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references
- `docs/tenancy/overview.md`
- `docs/tenancy/supabase.md`

## Core Concepts

- Astro static output on Cloudflare Pages with React islands where interactivity is needed.
- Tenant resolution at build time via `PUBLIC_TENANT_ID` and `getStaticPaths`.
- `@awcms/shared` is the canonical shared helper layer for public Supabase env resolution, tenant IDs, and sanitization.
- `PuckRenderer` (wraps `@puckeditor/core` `<Render>`) for rendering Puck JSON with a server-side allow-list.
- View transitions are enabled via `astro:transitions` `ClientRouter` in `Layout.astro`.

## How It Works

### Tenant Resolution

- Build-time tenant resolution uses `PUBLIC_TENANT_ID` (or `VITE_PUBLIC_TENANT_ID` / `VITE_TENANT_ID` as fallbacks).
- Tenant-specific routes use `getStaticPaths` to generate output.
- Middleware-based resolution is not part of the canonical static deployment path.

### Rendering Pipeline

- `Layout.astro` wires core metadata, plugin loaders, and the consent notice.
- `PageLayout.astro` fetches header/footer menus from `menus` with a navigation fallback.
- `PuckRenderer`: `awcms-public/primary/src/components/common/PuckRenderer.astro`.
- Widget mapping: `awcms-public/primary/src/components/common/WidgetRenderer.astro`.
- Shared types: `awcms-public/primary/src/types.d.ts`.
- Plugin scripts: `awcms-public/primary/src/components/common/PluginLoader.astro` (via `plugins` table).
- Public client/env resolution flows through `@awcms/shared/supabase` and `@awcms/shared/tenant` before page-level queries run.

### Rich Text

- Public pages render stored content via server-side components or markdown pipelines.
- TipTap editor runtime is never used on the public portal.

### Routes

- `/`: `src/pages/index.astro` redirects to the default locale.
- `/en` and `/id`: locale-prefixed home routes.
- `/p/[slug]`: dynamic pages from `pages` table.
- `/blogs` and `/blogs/[slug]`: default-locale dynamic blog list and post routes from Supabase.
- `/[locale]/blogs` and `/[locale]/blogs/[slug]`: locale-prefixed blog list and post routes.
- `src/pages/[...blog]/*`: static AstroWind blog routes (content collections).
- `src/pages/[tenant]/visitor-stats.astro` handles the public analytics page for path-based tenants.
- `src/pages/visitor-stats.astro` handles host-based tenants.

## Implementation Patterns

- Use `createClientFromEnv` with `import.meta.env` for static builds.
- Use `createScopedClient` with `x-tenant-id` headers for tenant-scoped reads when needed.
- Use `tenantUrl` from `src/lib/url.ts` for internal links.
- Canonical static deployments do not depend on middleware-based analytics logging.
- Primary builds commonly use `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, while `PUBLIC_SUPABASE_*` remains a supported deployment fallback.
- Public forms that render Turnstile require `PUBLIC_TURNSTILE_SITE_KEY` at build time.

## Permissions and Access

- Public portal only renders published content.
- No runtime use of `@puckeditor/core` editor; only `PuckRenderer` is allowed.

## Security and Compliance Notes

- Registry allow-list prevents unknown components from rendering.
- All data access must be RLS-scoped and filtered for `deleted_at`.
- Consent notices are rendered in `awcms-public/primary/src/components/common/ConsentNotice.astro`.
- HTML content rendered via `set:html` must pass through `awcms-public/primary/src/utils/sanitize.ts`.
- `PuckRenderer` sanitizes `Html`/`RawHTML` fallback blocks before rendering.

## Operational Concerns

- Cloudflare Pages uses build-time env variables for static output.
- Ensure `PUBLIC_TENANT_ID` is set and that either `VITE_SUPABASE_*` or `PUBLIC_SUPABASE_*` env pairs are available for the build.
- `src/pages/index.astro` currently redirects immediately to the default locale, so root-path behavior should be documented as a redirect rather than a direct content page.

## Tenant Variants

- `awcms-public/smandapbun` is a dedicated single-tenant static portal.
- It uses a fixed build-time tenant plus JSON fallbacks for selected content areas during migration.
- See `docs/tenancy/smandapbun.md` for its data sources and migration path.

## References

- `docs/modules/TEMPLATE_MIGRATION.md`
- `docs/tenancy/overview.md`
- `../../awcms-public/primary/README.md`
