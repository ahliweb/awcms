# System Architecture

## Purpose
Describe the runtime architecture and data flow across the AWCMS monorepo.

## Audience
- Developers working across admin/public/mobile/IoT
- Operators configuring deployments

## Prerequisites
- `awcms/docs/00-core/CORE_STANDARDS.md`
- `awcms/docs/00-core/MULTI_TENANCY.md`

## Core Concepts

AWCMS is a headless system with multiple clients sharing a Supabase backend:

- Admin Panel: React 18 SPA (Vite)
- Public Portal: Astro SSR/Islands (Cloudflare Pages)
- Mobile: Flutter app
- IoT: ESP32 firmware

## How It Works

### Architecture Diagram

```mermaid
graph TD
    Visitor[Public Visitor] -->|HTTPS| PublicPortal
    Admin[Tenant Admin] -->|HTTPS| AdminPanel
    Owner[Platform Owner] -->|HTTPS| AdminPanel

    subgraph "Public Portal (Cloudflare Pages)"
        PublicPortal[Astro App]
        Middleware[Tenant Middleware]
        PublicPortal --> Middleware
        Middleware -->|Resolve Tenant| RPC[Supabase RPC]
        registry[Component Registry]
        PublicPortal -.-> registry
    end

    subgraph "Admin Panel (Vite SPA)"
        AdminPanel[React 18 App]
        AdminContext[Tenant Context]
        Puck[Puck Visual Editor]
        AdminPanel --> AdminContext
        AdminPanel --> Puck
    end

    subgraph "Backend Layer (Supabase)"
        RPC
        DB[(PostgreSQL)]
        Auth[GoTrue Auth]
        Storage[S3 Storage]
        RLS{RLS Policies}
        DB --- RLS
    end

    AdminContext -->|Authenticated API| RLS
    Middleware -->|Public API Key| RLS
    Puck -->|JSONB Save| DB
```

### Admin Panel Flow

1. TenantContext resolves tenant via `get_tenant_by_domain`.
2. `setGlobalTenantId()` injects `x-tenant-id` on Supabase requests.
3. UI components enforce ABAC with `usePermissions()`.
4. All writes use soft delete for removal.

### Public Portal Flow

1. Middleware resolves tenant by path slug, then host fallback.
2. `locals.tenant_id` is passed to request-scoped Supabase clients.
3. Pages render with `PuckRenderer` and a registry allow-list.

## Implementation Patterns

- Admin client: `awcms/src/lib/customSupabaseClient.js`
- Public client: `awcms-public/primary/src/lib/supabase.ts`
- Tenant resolution: `awcms/src/contexts/TenantContext.jsx` and `awcms-public/primary/src/middleware.ts`

## Security and Compliance Notes

- Tenant isolation is enforced at UI, API, and database layers.
- ABAC checks are mandatory at entry points and on data operations.
- Supabase is the only backend; no custom servers.

## Operational Concerns

- Admin and public apps are deployed as separate Cloudflare Pages projects.
- Supabase migrations are managed in `supabase/migrations`.

## Troubleshooting

- See `../01-guides/TROUBLESHOOTING.md`.

## References

- `../00-core/MULTI_TENANCY.md`
- `../00-core/SUPABASE_INTEGRATION.md`
- `../03-features/PUBLIC_PORTAL_ARCHITECTURE.md`
