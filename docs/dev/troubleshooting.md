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
- Seed the default tenant if missing: `node awcms/src/scripts/seed-primary-tenant.js`.

### Tenant Not Found (Public)

- Verify `PUBLIC_TENANT_ID` (or `VITE_PUBLIC_TENANT_ID`) for static builds.
- Rebuild after updating env values.

### RLS Errors (PGRST 42501)

- Check `x-tenant-id` header injection.
- Confirm `tenant_id` matches the current tenant and `deleted_at` is null.

### Analytics Not Showing

- Confirm `analytics_events` and `analytics_daily` migrations are applied.
- Canonical static builds do not log server-side analytics events; middleware-based logging applies only in non-canonical runtime experiments.
- Ensure `x-tenant-id` is set for scoped public requests.

### Migration History Mismatch

- Use helper script (safe dry-run by default): `scripts/repair_supabase_migration_history.sh`.
- Local repair execution: `scripts/repair_supabase_migration_history.sh --apply --local`.
- Linked/remote repair execution: `scripts/repair_supabase_migration_history.sh --apply --linked`.
- Re-run `npx supabase db push --local` after local repairs.

### Root/Mirror Supabase Drift (CI passes locally, fails in `db-check`)

- CI lint runs from `awcms/supabase`, while local CLI defaults to root `supabase/`.
- Run `scripts/verify_supabase_migration_consistency.sh` to detect missing or content-drifted migration files.
- Mirror any changed files between `supabase/**` and `awcms/supabase/**`, then re-run verification.

### Invalid Migration Filename Warning

- Ensure files in `supabase/migrations/` follow `<timestamp>_name.sql`.
- Move helper/manual SQL files into `supabase/manual/` to avoid CLI skip warnings.

### Supabase DB Lint Warning (index_advisor)

- `extensions.index_advisor` is owned by `supabase_admin` and requires a privileged patch.
- After `supabase db reset`, re-apply `supabase/migrations/20260207123000_fix_index_advisor_text_array_init.sql` while connected as `supabase_admin`.
- Helper script: `awcms/scripts/apply_index_advisor_fix.sh` (requires local Supabase running).

### Supabase Performance Advisor Check (Local)

- For a local FK index check, run: `psql "$SUPABASE_DB_URL" -f supabase/manual/check_advisors.sql`.
- The result should return `0 rows` for missing FK indexes.

### Turnstile Errors

- Use the Cloudflare test key for localhost.
- Set `VITE_TURNSTILE_SITE_KEY` in the admin environment.
- Optionally set `VITE_TURNSTILE_TEST_SITE_KEY` to force the test key in local dev.
- For multi-domain setups, use `VITE_TURNSTILE_SITE_KEY_MAP` to map hostnames to keys.
- Ensure `TURNSTILE_SECRET_KEY` is set in Supabase secrets for `verify-turnstile`.
- For multi-domain secrets, set `TURNSTILE_SECRET_KEY_MAP` (JSON) and optionally `TURNSTILE_TEST_SECRET_KEY`.

### Cloudflare Runtime Env Missing

- Runtime env access applies only when SSR/middleware is enabled.

### MCP Servers Not Connected

- Verify OpenCode MCP status with `opencode mcp list`.
- Confirm repository MCP config is present in `mcp.json`.
- For local Supabase MCP, start `awcms-mcp` (`cd awcms-mcp && npm run dev`) if needed.
- For GitHub MCP, ensure Docker is running and one token env is set (`GITHUB_PERSONAL_ACCESS_TOKEN`, `GITHUB_MCP_PERSONAL_ACCESS_TOKEN`, `GH_TOKEN`, or `GITHUB_TOKEN`).

## Verification

- Re-run `npm run dev` after env changes.
- Use browser console logs to confirm tenant resolution.

## References

- `docs/tenancy/overview.md`
- `docs/tenancy/supabase.md`
