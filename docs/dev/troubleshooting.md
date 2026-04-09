> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

# Troubleshooting Guide

## Purpose

Provide current, repo-state-aware troubleshooting guidance for local development and common operational issues across admin, public, Worker, migration, and MCP surfaces.

## Current Troubleshooting Areas

### Missing Environment Variables

- verify `awcms/.env.local` for admin work
- verify the relevant public workspace env inputs for public builds, including tenant envs where required
- verify `awcms-edge/.dev.vars` for local Worker runtime
- verify `VITE_EDGE_URL` / `VITE_LOCAL_EDGE_URL` / `PUBLIC_EDGE_URL` when client flows depend on Worker-backed routes

### Tenant Not Found (Admin)

- verify `VITE_DEV_TENANT_SLUG`
- confirm the tenant exists and the current local tenant/bootstrap path has been seeded
- check current tenant-resolution behavior before inventing a workaround

### Tenant Not Found (Public)

- verify `PUBLIC_TENANT_ID` / `VITE_PUBLIC_TENANT_ID`
- rebuild after env updates
- remember canonical public builds are static-first and should fail closed on missing tenant context

### RLS Errors (`42501`)

- verify tenant header propagation/current tenant scope
- confirm the row matches current tenant scope and soft-delete expectations
- check ABAC/RLS docs before broadening query scope

### Public Worker Route Failures

- verify tenant/domain inputs match the documented route contract
- verify public media keys use canonical `tenants/<tenant_id>/...` paths
- verify malformed or protected media paths are not being requested through `/public/media/*`

### Analytics / Monitoring Issues

- verify analytics migrations/tables are present
- confirm the correct tenant scope is being used
- prefer aggregate tables/surfaces for dashboard expectations

### Migration History Mismatch

- use `scripts/repair_supabase_migration_history.sh` as the current repair helper
- rerun `scripts/verify_supabase_migration_consistency.sh` after repair

### Root / Mirror Migration Drift

- CI and local workflows can diverge if `supabase/` and `awcms/supabase/` are not kept in parity
- use `scripts/verify_supabase_migration_consistency.sh`

### Turnstile Errors

- verify public/admin site keys and Worker secret configuration
- use the test key flow for localhost when appropriate

### MCP Connectivity Problems

- check `opencode mcp list`
- verify `mcp.json`
- ensure Docker/tokens are available for GitHub MCP if used

### Local Worker / R2 Confusion

- remember local `wrangler dev` R2 state is isolated from remote by default
- use the current `sync:r2:*` commands when reconciliation is needed

## Current Verification Guidance

- rerun the smallest relevant workspace command after fixing the issue
- do not assume a docs-only fix solved a runtime issue without rerunning the actual command

Representative current commands:

```bash
cd awcms && npm run build
cd awcms && npm run docs:check
cd awcms-public/primary && npm run check:astro
cd awcms-edge && npm test && npm run typecheck
scripts/verify_supabase_migration_consistency.sh
```

## Related Docs

- [docs/dev/setup.md](./setup.md)
- [docs/tenancy/overview.md](../tenancy/overview.md)
- [docs/tenancy/supabase.md](../tenancy/supabase.md)
- [docs/dev/edge-functions.md](./edge-functions.md)
