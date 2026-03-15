# Extension Authoring Guide

## Workflow

1. Create `awcms-ext/<vendor>/<slug>/extension.json`.
2. Define manifest fields using the v1 contract.
3. Add migrations under repo-level `supabase/migrations/`; package-local `supabase/` holds references only.
4. Implement runtime assets in the appropriate admin/public/edge folders.
5. Register the catalog entry through the Worker lifecycle endpoint or admin installer.
6. Install the extension per tenant.
7. Verify audit rows in `extension_lifecycle_audit`.

## Safe Defaults

- Prefer `scope: "tenant"`.
- Keep permissions explicit and canonical.
- Keep edge capabilities additive; never move authorization truth out of Supabase.
- Use signed params for identifier-bearing admin routes.
- Keep uninstall non-destructive.

## Checklist

- Manifest validates locally.
- Tenant tables include `tenant_id`, `deleted_at`, indexes, and RLS.
- Permissions are seeded before role mappings.
- Admin/public routes are manifest-driven.
- Worker handlers validate the caller and tenant scope.
