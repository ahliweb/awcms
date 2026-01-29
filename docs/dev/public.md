# Public Portal Development

## 1. Overview

The Public Portal (`awcms-public/`) handles the visitor-facing websites for each tenant. It uses Astro for optimal performance (SSG/SSR).

## 2. Architecture

- **Framework**: Astro 5
- **Rendering**: Static (SSG) by default, Hybrid for dynamic routes.
- **Styling**: Tailwind CSS 4.
- **Data Source**: Supabase (via direct client).

## 3. Multi-Tenancy Strategy

Each tenant has a dedicated directory under `awcms-public/`. We currently use a "primary" template that can be cloned.

- `awcms-public/primary/`: The reference implementation.
- `awcms-public/{tenant_slug}/`: Dedicated implementations (future).

## 4. Environment Variables

Public portals require:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_DEV_TENANT_HOST` (local development)

## 5. Development Workflow

1. Navigate to `awcms-public/primary`.
2. `npm run dev` to start the local server.
3. Content changes in the Admin Panel are reflected on refresh (if SSR) or rebuild (if SSG).
