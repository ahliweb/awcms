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

* Node.js 20+
* npm 10+

## Quick Start

```bash
cd awcms
npm install
cp .env.example .env.local
npm run dev
```

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

## Architecture

* **Context**: `TenantContext` resolves tenant by domain.
* **Security**: `usePermissions()` hook enforces ABAC policies.
* **Data**: All deletes are soft deletes (`deleted_at`).

## References

* `../DOCS_INDEX.md`
* `../docs/security/abac.md`
* `../docs/modules/MODULES_GUIDE.md`
