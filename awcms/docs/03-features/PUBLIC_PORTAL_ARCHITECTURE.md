# Public Portal Architecture

## Purpose
Describe how the public portal renders tenant content and enforces security constraints.

## Audience
- Public portal developers
- Operators deploying Astro to Cloudflare Pages

## Prerequisites
- `awcms/docs/00-core/MULTI_TENANCY.md`
- `awcms/docs/00-core/SUPABASE_INTEGRATION.md`

## Core Concepts

- Astro SSR/Islands architecture on Cloudflare Pages.
- Tenant resolution in middleware with path-first, host-fallback.
- `PuckRenderer` for rendering Puck JSON with an allow-list registry.

## How It Works

### Tenant Resolution

- Middleware: `awcms-public/primary/src/middleware.ts`.
- Priority order:
  1. Path slug via `get_tenant_by_slug`.
  2. Host fallback via `get_tenant_id_by_host`.
- Host-resolved tenants are served at root paths without redirects.

### Rendering Pipeline

- `PuckRenderer`: `awcms-public/primary/src/components/PuckRenderer.tsx`.
- Registry allow-list: `awcms-public/primary/src/components/registry.tsx`.
- Runtime prop validation: Zod schemas per component.

### Rich Text

- `TipTapRenderer`: `awcms-public/primary/src/components/TipTapRenderer.tsx`.
- JSON-to-React mapping (no `dangerouslySetInnerHTML`).

### Routes

- `src/pages/[tenant]/[...slug].astro` handles path-based tenants.
- `src/pages/[...slug].astro` handles host-based tenants.

## Implementation Patterns

- Use `createScopedClient` with `x-tenant-id` headers.
- Use `tenantUrl` from `src/lib/url.ts` for internal links.

## Permissions and Access

- Public portal only renders published content.
- No runtime use of `@measured/puck` editor; only `PuckRenderer` is allowed.

## Security and Compliance Notes

- Registry allow-list prevents unknown components from rendering.
- All data access must be RLS-scoped and filtered for `deleted_at`.

## Operational Concerns

- Cloudflare Pages uses runtime env variables via `runtime.env`.
- Ensure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set.

## References

- `../01-guides/MIGRATION.md`
- `../00-core/MULTI_TENANCY.md`
- `../../awcms-public/primary/README.md`
