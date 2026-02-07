> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1 (Tech Stack) and Section 2 (Data Integrity)

# Troubleshooting Guide

## Purpose

Provide common fixes for local development and deployment issues.

## Audience

- Developers running the apps locally
- Operators diagnosing production failures

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for system architecture and troubleshooting context
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references
- `docs/dev/setup.md`

## Steps

### Missing Environment Variables

- Confirm `awcms/.env.local` exists for the admin panel.
- Confirm `awcms-public/primary/.env` exists for the public portal, including `PUBLIC_TENANT_ID`.

### Tenant Not Found (Admin)

- Verify `VITE_DEV_TENANT_SLUG` in `awcms/.env.local` for local dev.
- Confirm the tenant exists in `tenants` and domain matches.

### Tenant Not Found (Public)

- Verify `PUBLIC_TENANT_ID` (or `VITE_PUBLIC_TENANT_ID`) for static builds.
- Rebuild after updating env values.

### RLS Errors (PGRST 42501)

- Check `x-tenant-id` header injection.
- Confirm `tenant_id` matches the current tenant and `deleted_at` is null.

### Analytics Not Showing

- Confirm `analytics_events` and `analytics_daily` migrations are applied.
- Analytics logging requires SSR/runtime middleware; static builds do not log server-side events.
- Ensure `x-tenant-id` is set for scoped public requests.

### Migration History Mismatch

- Use `supabase migration repair --status reverted <missing_version>`.
- Re-run `npx supabase db push` after repairs.

### Supabase DB Lint Warning (index_advisor)

- `extensions.index_advisor` is owned by `supabase_admin` and requires a privileged patch.
- After `supabase db reset`, re-apply `supabase/migrations/20260207123000_fix_index_advisor_text_array_init.sql` while connected as `supabase_admin`.
- Helper script: `awcms/scripts/apply_index_advisor_fix.sh` (requires local Supabase running).

### Turnstile Errors

- Use the Cloudflare test key for localhost.
- Set `VITE_TURNSTILE_SITE_KEY` in the admin environment.

### Cloudflare Runtime Env Missing

- Runtime env access applies only when SSR/middleware is enabled.

## Verification

- Re-run `npm run dev` after env changes.
- Use browser console logs to confirm tenant resolution.

## References

- `docs/tenancy/overview.md`
- `docs/tenancy/supabase.md`
