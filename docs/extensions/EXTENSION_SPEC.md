# AWCMS Extension Specification v1

> Documentation Authority: `SYSTEM_MODEL.md` -> `AGENTS.md` -> `README.md` -> `DOCS_INDEX.md`

## Purpose

Define the production extension contract for AWCMS.

## Canonical Principles

1. Platform owns extension packages through `public.platform_extension_catalog`.
2. Tenants own activation and configuration through `public.tenant_extensions`.
3. `extension.json` is the contract and must validate before runtime registration.
4. Migrations remain mandatory for schema-bearing extensions.
5. RLS and ABAC remain the final authority.
6. Runtime behavior composes through approved registries only.
7. Cloudflare Workers orchestrate privileged lifecycle flows.
8. Lifecycle actions are recorded in `public.extension_lifecycle_audit`.

## Data Model

| Table | Scope | Purpose |
| --- | --- | --- |
| `platform_extension_catalog` | Platform | Package inventory, manifest, compatibility, checksum, source, status |
| `tenant_extensions` | Tenant | Activation state, installed version, config, rollout, health |
| `extension_lifecycle_audit` | Platform + Tenant | Immutable lifecycle and runtime event trail |
| `events` | Tenant | Reference extension business table |

## Manifest Contract

All installable extensions must ship `extension.json` with these fields:

| Field | Required | Notes |
| --- | --- | --- |
| `schemaVersion` | Yes | Must equal `1` |
| `slug` | Yes | Unique within `vendor` |
| `name` | Yes | Human-readable title |
| `vendor` | Yes | Package owner namespace |
| `version` | Yes | Semver string |
| `kind` | Yes | `bundled` or `external` |
| `scope` | Yes | `platform` or `tenant` |
| `compatibility` | Yes | Include `awcms` minimum/exact version |
| `capabilities` | Yes | Worker/runtime capability declarations |
| `resources` | Yes | Entry metadata for admin/public/edge/shared assets |
| `permissions` | Yes | Canonical `scope.resource.action` keys |
| `adminRoutes` | Yes | Registry-owned admin routes |
| `menus` | Yes | Registry-owned admin menu entries |
| `publicModules` | Yes | Registry-owned public module entries |
| `settingsSchema` | Yes | Tenant config schema |
| `edgeRoutes` | No | Declared privileged Worker capabilities |
| `dependencies` | No | Manifest/package dependencies |
| `widgets` | No | Dashboard widget registrations |
| `hooks` | No | Additional hook metadata |

Invalid manifests fail closed in the admin loader and Worker lifecycle endpoint.

## Package Layout

```text
awcms-ext/
  <vendor>/
    <slug>/
      extension.json
      README.md
      CHANGELOG.md
      admin/
      public/
      edge/
      shared/
      supabase/
        migrations/
        seeds/
        policies/
      docs/
      tests/
```

## Lifecycle Contract

| Action | Owner | Notes |
| --- | --- | --- |
| `catalog-register` | Platform | Validates manifest, upserts catalog metadata |
| `install` | Tenant/Platform | Creates or refreshes `tenant_extensions` row |
| `activate` | Tenant/Platform | Idempotent state change to `active` |
| `upgrade` | Tenant/Platform | Forward-only installed version change |
| `deactivate` | Tenant/Platform | Removes runtime activation without deleting business data |
| `uninstall` | Tenant/Platform | Marks uninstall requested; business data stays intact |
| `health-check` | Tenant/Platform | Validates DB access, manifest registry, collisions, permission seeding |
| `config-update` | Tenant/Platform | Updates tenant-scoped config with audit trail |

## Security Contract

- Tenant-scoped tables must include `tenant_id` and `deleted_at`.
- New tenant data must enable RLS and use `current_tenant_id()` + `has_permission()`/`auth_is_admin()` helpers.
- Frontend permission checks remain UX-only.
- Browser clients must never use privileged secrets.
- Signed route infrastructure remains mandatory for identifier-bearing extension routes.

## Runtime Composition

- Admin runtime: `awcms/src/contexts/PluginContext.jsx` validates manifests, loads active tenant extensions, and registers menus/routes/widgets through the approved hook registries.
- Public runtime: `awcms-public/primary/src/lib/extension_registry.ts` reads active tenant extensions and exposes `publicModules` only through the manifest contract.
- Edge runtime: `awcms-edge/src/index.ts` exposes lifecycle orchestration and extension capability health routes.

## Reference Extension

`awcms-ext/ahliweb/events/` is the canonical example package.

- Catalog entry: `platform_extension_catalog` migration seed
- Tenant activation: `tenant_extensions`
- Resource/permissions: `events`, `tenant.events.*`
- Admin route + widget: `awcms/src/extensions/ahliweb-events/`
- Public module contract: `publicModules` manifest entry
- Edge capability: `/functions/v1/extensions/events/health`

## Compliance Notes

- ISO/IEC 27001/27002/27005: lifecycle auditing, least privilege, change control, and risk-based activation checks
- ISO/IEC 27017/27018: tenant isolation and privacy-safe shared cloud service operation
- ISO/IEC 27034: application security control points in manifest validation, Worker orchestration, and route registration
- ISO/IEC 27701: tenant configuration and lifecycle logs can contain personal data context; treat metadata as privacy-scoped records
- ISO/IEC 20000-1 and 22301: upgrade/deactivate/uninstall flows preserve service continuity and data recovery posture
- Indonesian PDP / PSTE: privileged extension flows must stay auditable, tenant-bounded, and proportionate to stated processing purpose
