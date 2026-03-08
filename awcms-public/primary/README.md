# AWCMS Public Portal (Primary)

The primary public portal template for AWCMS, built on Astro with React islands and Tailwind CSS v4.

## Stack

- Astro 5.17.1 (static output)
- React 19.2.4 (islands)
- Tailwind CSS 4 (CSS-first config)
- Supabase JS 2.93.3
- Node.js >= 22.12.0

## Quick Start

```bash
cd awcms-public/primary
npm install
# Create .env with the required keys below
npm run dev
```

## Environment Variables

Required:

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
PUBLIC_TENANT_ID=...
```

Optional fallbacks:

```env
PUBLIC_SUPABASE_URL=...
PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
VITE_PUBLIC_TENANT_ID=...
VITE_TENANT_ID=...
```

## Tenant Resolution

- Static builds resolve tenant data at build time using `PUBLIC_TENANT_ID` (or `VITE_PUBLIC_TENANT_ID`).
- Runtime tenant resolution via middleware is only used when SSR is enabled.

## Analytics Logging

- Server-side logging is available only when middleware runs (SSR/runtime).
- Static builds require client-side instrumentation or dedicated edge services.

## Commands

| Command           | Description                      |
| ----------------- | -------------------------------- |
| `npm run dev`     | Start local dev server           |
| `npm run build`   | Build static output              |
| `npm run preview` | Preview build locally            |
| `npm run check`   | Astro + ESLint + Prettier checks |
| `npm run fix`     | ESLint + Prettier autofix pass   |

## Template Lineage

This portal started from the AstroWind template. For upstream template details, see the AstroWind repository and documentation.

## References

- `../../docs/dev/public.md`
- `../../docs/deploy/overview.md`
- `../../docs/modules/PUBLIC_PORTAL_ARCHITECTURE.md`
- `../../docs/dev/admin-public-db-driven-checklist.md`
- `../../docs/tenancy/supabase.md`
