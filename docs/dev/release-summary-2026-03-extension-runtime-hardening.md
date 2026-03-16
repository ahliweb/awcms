# Release Summary — Extension Platform, Tenant Scope, and Runtime Hardening

## Scope

This change sequence delivered three major outcomes:

1. a normalized extension platform with platform catalog ownership and tenant activation
2. centralized platform-admin tenant scope management for `primary` and `smandapbun`
3. Cloudflare-only runtime enforcement for storage and edge logic

## Delivered Changes

### 1. Extension Platform

- added `platform_extension_catalog`, `tenant_extensions`, and `extension_lifecycle_audit`
- enforced `extension.json` as the manifest contract
- added Worker lifecycle orchestration and extension health/public capability routes
- added the `events` reference extension across admin, public, edge, and migration layers

### 2. Multi-Tenant Admin + Public Apps

- centralized `awcms` admin now supports platform-admin tenant scope switching
- `primary` and `smandapbun` are aligned in `tenants_control`, `tenant_domains`, and `tenant_channels`
- public portal configuration was updated for tenant-specific builds and routing
- platform owner/full-access enforcement was applied to `cms@ahliweb.com`

### 3. ABAC and User Management

- tenant role-permission matrices were expanded and seeded for both tenants
- Worker `manage-users` flow now validates role assignment against platform vs tenant scope
- invited/created users are synchronized into `public.users` with correct `tenant_id` and `role_id`
- local bootstrap of a `smandapbun` tenant admin was validated through the hardened Worker path

### 4. Cloudflare-Only Runtime Enforcement

- Cloudflare R2 is the canonical object storage runtime
- Cloudflare Workers are the canonical edge/function runtime
- maintained clients now throw on `supabase.storage` access
- maintained compatibility calls continue to route through Worker endpoints only
- Supabase-hosted Edge Functions and Supabase Storage are not supported runtime paths

### 5. Test Coverage Added

- admin browser test for platform tenant switching
- admin browser test for platform diagnostics route
- shared/package storage guard smoke test
- edge compatibility route smoke test
- Worker `manage-users` smoke test

## Operational Notes

- linked and local migrations were applied and kept in parity
- GitHub push protection blocked one local test commit due to a briefly hardcoded secret; the secret was removed, the local-only commit was rewritten safely, and the cleaned history was pushed

## Key Validation Commands

```bash
cd awcms && npm run lint
cd awcms && npm run build
cd awcms && npm run test:e2e -- platform-tenant-switcher.spec.js
cd awcms && npm run test:e2e -- platform-diagnostics.spec.js
cd awcms && npm test -- --run src/lib/customSupabaseClient.test.js
cd packages/awcms-shared && npm run test:storage-guard
cd awcms-edge && npm run typecheck
cd awcms-edge && npm run test:compat-routes
cd awcms-edge && npm run test:manage-users
```

## Result

AWCMS now operates with a clearer platform/tenant separation, a production-oriented extension model, and explicit Cloudflare-only runtime guarantees for storage and edge execution.
