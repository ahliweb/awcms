# Troubleshooting Guide

## Purpose

Provide common fixes for local development and deployment issues.

## Audience

- Developers running the apps locally
- Operators diagnosing production failures

## Prerequisites

- `awcms/docs/01-guides/CONFIGURATION.md`

## Steps

### Missing Environment Variables

- Confirm `awcms/.env.local` exists for the admin panel.
- Confirm `awcms-public/primary/.env` exists for the public portal.

### Tenant Not Found (Admin)

- Verify `VITE_DEV_TENANT_SLUG` in `awcms/.env.local` for local dev.
- Confirm the tenant exists in `tenants` and domain matches.

### Tenant Not Found (Public)

- Verify middleware resolves tenant slug or host.
- Confirm `VITE_DEV_TENANT_HOST` for local development.

### RLS Errors (PGRST 42501)

- Check `x-tenant-id` header injection.
- Confirm `tenant_id` matches the current tenant and `deleted_at` is null.

### Turnstile Errors

- Use the Cloudflare test key for localhost.
- Set `VITE_TURNSTILE_SITE_KEY` in the admin environment.

### Cloudflare Runtime Env Missing

- Ensure `createScopedClient` receives `runtime?.env` in Astro pages.

## Verification

- Re-run `npm run dev` after env changes.
- Use browser console logs to confirm tenant resolution.

## References

- `docs/tenancy/overview.md`
- `docs/tenancy/supabase.md`
