# AWCMS Public Portal

## Purpose
Public-facing frontend for AWCMS tenants, built with Astro SSR and React islands.

## Prerequisites
- Node.js 20+

## Quick Start

```bash
cd awcms-public/primary
npm install
# Create .env with Supabase variables
npm run dev
```

## Environment Variables

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_DEV_TENANT_HOST=localhost
```

## Routing

- Path-based tenants: `/{tenant}/...`
- Host-based tenants: `/<slug>` routes served at root

## Rendering

- Puck JSON is rendered via `PuckRenderer` and a registry allow-list.
- The Puck editor runtime is not used in the public portal.

## References

- `../../DOCS_INDEX.md`
- `../../awcms/docs/03-features/PUBLIC_PORTAL_ARCHITECTURE.md`
