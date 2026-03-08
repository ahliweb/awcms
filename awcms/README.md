# AWCMS Admin Panel

The admin panel for AWCMS, built with the bleeding-edge stack: **React 19**, **Vite 7**, and **Tailwind CSS v4**.

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
* `npm run lint` - run ESLint
* `npm run build` - create the production build in `dist/`
* `npm run docs:check` - validate markdown links used by the docs workflow

## Environment Variables

Required:

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

Optional:

```env
VITE_TURNSTILE_SITE_KEY=...
VITE_SUPER_ADMIN_EMAIL=...
VITE_DEV_TENANT_SLUG=primary
```

## Local Bootstrap (Admin)

The admin app resolves the tenant on `localhost` using `VITE_DEV_TENANT_SLUG` (default `primary`). Ensure the tenant exists before logging in.

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
