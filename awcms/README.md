# AWCMS Admin Panel

The admin panel for AWCMS, built with React 19.2.3 and Vite 7.

## Purpose

Manage tenant content, users, templates, and configuration.

## Prerequisites

- Node.js 20+
- npm 10+

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
VITE_SUPABASE_ANON_KEY=...
```

Optional:

```env
VITE_TURNSTILE_SITE_KEY=...
VITE_SUPER_ADMIN_EMAIL=...
VITE_DEV_TENANT_SLUG=primary
```

## Key Concepts

- Tenant context is resolved by domain in `TenantContext`.
- ABAC enforcement uses `usePermissions()`.
- All deletes are soft deletes (`deleted_at`).

## References

- `../DOCS_INDEX.md`
- `../awcms/docs/INDEX.md`
