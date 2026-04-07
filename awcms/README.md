# AWCMS Admin Panel

The admin panel for AWCMS, built with **React 19.2.4**, **Vite `^8.0.5`**, and **Tailwind CSS `^4.2.2`**.

## Purpose

Manage tenant content, users, templates, configuration, and IoT/Mobile devices.

## Key Features

* **Multi-Tenancy**: Domain-driven tenant resolution.
* **Security (ABAC)**: Granular permission system with Row Level Security.
* **Visual Building**: Integrated WYSIWYG editor for pages.
* **Extended Modules**: IoT, Mobile, Commerce, and Regions support.
* **Visitor Statistics**: Admin analytics dashboards powered by `analytics_events` and `analytics_daily`.

## Prerequisites

* Node.js >= 22.12.0
* npm 10+

## Quick Start

```bash
cd awcms
npm install
cp .env.example .env.local
npm run dev
```

## Common Commands

* `npm run dev` - start the Vite development server
* `npm run dev:full` - start the admin app and local Worker together
* `npm run lint` - run ESLint
* `npm run test -- --run` - run Vitest once
* `npm run test:platform-routes` - run the platform tenant-switcher Playwright smoke checks
* `npm run build` - create the production build in `dist/`
* `npm run docs:check` - validate markdown links used by the docs workflow

## Environment Variables

Required:

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_EDGE_URL=...
```

Optional:

```env
VITE_TURNSTILE_SITE_KEY=...
VITE_LOCAL_EDGE_URL=http://127.0.0.1:8787
VITE_REMOTE_EDGE_URL=https://your-worker.workers.dev
VITE_SUPER_ADMIN_EMAIL=...
VITE_DEV_TENANT_SLUG=primary
```

## Local Bootstrap (Admin)

The admin app resolves the tenant on `localhost` using `VITE_DEV_TENANT_SLUG` (default `primary`). Ensure the tenant exists before logging in.

When media or other Worker-backed flows are part of the local session, either start `awcms-edge` separately with
`npm run dev:local` in `awcms-edge/` or use `npm run dev:full` here so `VITE_LOCAL_EDGE_URL` resolves cleanly.

```bash
node src/scripts/seed-primary-tenant.js
node src/scripts/create-admin-user.js
```

Optional setup:

```bash
node src/scripts/assign-owner-role.js
node src/scripts/seed-sidebar.js
```

`seed-sidebar.js` requires `VITE_SUPABASE_URL` and `SUPABASE_SECRET_KEY` in `awcms/.env.local` and should only be used in local or controlled environments.

## Architecture

* **Context**: `TenantContext` resolves tenant by domain.
* **Security**: `usePermissions()` hook enforces ABAC policies.
* **Data**: All deletes are soft deletes (`deleted_at`).

## References

* `../DOCS_INDEX.md`
* `../docs/security/abac.md`
* `../docs/modules/MODULES_GUIDE.md`
* `../docs/dev/admin.md`
