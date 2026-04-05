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

## Local Verification

Use this check after changing extension lifecycle SQL, validation rules, or the Worker lifecycle orchestration.

1. Reset the local database so the latest migrations are applied:

```bash
npx supabase db reset
```

2. Run the rollback-safe RPC smoke test below against the local database. It verifies that:
- a valid catalog state can be written
- an invalid catalog update auto-deactivates active tenant installs
- a later valid catalog update auto-restores previously active installs

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
BEGIN;
DO $$
DECLARE
  v_actor uuid := NULL;
  v_tenant uuid;
  v_catalog uuid;
  v_tenant_extension uuid;
  v_invalid record;
  v_valid record;
  v_activation_state text;
  v_desired_state text;
  v_invalidated_by text;
  v_restored_by text;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants WHERE slug = 'primary' LIMIT 1;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Primary tenant not found for validation test';
  END IF;

  SELECT * INTO v_invalid
  FROM public.sync_extension_catalog_validation_state(
    'phase1-validation-test',
    'awcms',
    'Phase 1 Validation Test',
    'Temporary validation test entry',
    '1.0.0',
    'external',
    'tenant',
    'workspace',
    'awcms-ext/awcms/phase1-validation-test/extension.json',
    NULL,
    'active',
    '{}'::jsonb,
    '["tenant.test.read"]'::jsonb,
    '{"schemaVersion":1,"slug":"phase1-validation-test","name":"Phase 1 Validation Test","vendor":"awcms","version":"1.0.0","kind":"external","scope":"tenant","runtime_mode":"trusted","capabilities":["tenant.test.read"]}'::jsonb,
    'trusted',
    'valid',
    '{"validationStatus":"valid","runtimeMode":"trusted","compatibilityStatus":"compatible","reasonCategories":[],"invalidCapabilities":[],"missingArtifacts":[],"warnings":[],"errors":[]}'::jsonb,
    v_actor
  );

  v_catalog := v_invalid.catalog_id;

  INSERT INTO public.tenant_extensions (
    tenant_id,
    catalog_id,
    installed_version,
    activation_state,
    desired_activation_state,
    validation_status,
    validation_summary,
    created_by,
    updated_by
  ) VALUES (
    v_tenant,
    v_catalog,
    '1.0.0',
    'active',
    'active',
    'valid',
    '{}'::jsonb,
    v_actor,
    v_actor
  ) RETURNING id INTO v_tenant_extension;

  SELECT * INTO v_invalid
  FROM public.sync_extension_catalog_validation_state(
    'phase1-validation-test',
    'awcms',
    'Phase 1 Validation Test',
    'Temporary validation test entry',
    '1.0.1',
    'external',
    'tenant',
    'workspace',
    'awcms-ext/awcms/phase1-validation-test/extension.json',
    NULL,
    'active',
    '{}'::jsonb,
    '["tenant.test.read"]'::jsonb,
    '{"schemaVersion":1,"slug":"phase1-validation-test","name":"Phase 1 Validation Test","vendor":"awcms","version":"1.0.1","kind":"external","scope":"tenant","runtime_mode":"trusted","capabilities":["tenant.test.read"]}'::jsonb,
    'trusted',
    'invalid',
    '{"validationStatus":"invalid","runtimeMode":"trusted","compatibilityStatus":"compatible","reasonCategories":["capability_validation_failed"],"primaryReasonCategory":"capability_validation_failed","invalidCapabilities":["events:health"],"missingArtifacts":[],"warnings":[],"errors":["capability mismatch"]}'::jsonb,
    v_actor
  );

  SELECT activation_state, desired_activation_state, invalidated_by_catalog_version
  INTO v_activation_state, v_desired_state, v_invalidated_by
  FROM public.tenant_extensions
  WHERE id = v_tenant_extension;

  IF v_invalid.auto_deactivated_count <> 1 THEN
    RAISE EXCEPTION 'Expected 1 auto-deactivation, got %', v_invalid.auto_deactivated_count;
  END IF;
  IF v_activation_state <> 'inactive' OR v_desired_state <> 'active' OR v_invalidated_by <> '1.0.1' THEN
    RAISE EXCEPTION 'Unexpected invalidation state: activation %, desired %, invalidated_by %', v_activation_state, v_desired_state, v_invalidated_by;
  END IF;

  SELECT * INTO v_valid
  FROM public.sync_extension_catalog_validation_state(
    'phase1-validation-test',
    'awcms',
    'Phase 1 Validation Test',
    'Temporary validation test entry',
    '1.0.2',
    'external',
    'tenant',
    'workspace',
    'awcms-ext/awcms/phase1-validation-test/extension.json',
    NULL,
    'active',
    '{}'::jsonb,
    '["tenant.test.read"]'::jsonb,
    '{"schemaVersion":1,"slug":"phase1-validation-test","name":"Phase 1 Validation Test","vendor":"awcms","version":"1.0.2","kind":"external","scope":"tenant","runtime_mode":"trusted","capabilities":["tenant.test.read"]}'::jsonb,
    'trusted',
    'valid',
    '{"validationStatus":"valid","runtimeMode":"trusted","compatibilityStatus":"compatible","reasonCategories":[],"invalidCapabilities":[],"missingArtifacts":[],"warnings":[],"errors":[]}'::jsonb,
    v_actor
  );

  SELECT activation_state, desired_activation_state, restored_by_catalog_version
  INTO v_activation_state, v_desired_state, v_restored_by
  FROM public.tenant_extensions
  WHERE id = v_tenant_extension;

  IF v_valid.auto_restored_count <> 1 THEN
    RAISE EXCEPTION 'Expected 1 auto-restoration, got %', v_valid.auto_restored_count;
  END IF;
  IF v_activation_state <> 'active' OR v_desired_state <> 'active' OR v_restored_by <> '1.0.2' THEN
    RAISE EXCEPTION 'Unexpected restoration state: activation %, desired %, restored_by %', v_activation_state, v_desired_state, v_restored_by;
  END IF;

  RAISE NOTICE 'Phase 1 validation RPC smoke test passed';
END $$;
ROLLBACK;
SQL
```

Expected result:
- `npx supabase db reset` completes without migration errors
- the SQL block prints `NOTICE: Phase 1 validation RPC smoke test passed`
- the transaction rolls back, leaving the local database clean

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

## Phase 2 Site Blueprints

Phase 2 adds a tenant-safe site bootstrap foundation that complements the extension/runtime contract without replacing it.

### Blueprint Tables

| Table | Scope | Purpose |
| --- | --- | --- |
| `site_blueprints` | Platform or Tenant | Blueprint definitions. Platform-owned rows act as shared presets; tenant-owned rows act as tenant-authored variants. |
| `tenant_site_blueprint_state` | Tenant | Records the currently applied blueprint payload snapshot per tenant. |

### Blueprint Payload Shape

The initial payload is intentionally minimal and additive:

- `settings`: tenant-scoped settings payload stored through the existing `settings` table
- `publicModules`: public module defaults stored as blueprint metadata for later public/runtime consumption
- `assignments`: `template_assignments` rows to upsert during blueprint apply

This phase does not seed arbitrary tenant business content or create runtime-defined schemas.

### Worker Apply Path

- Route: `POST /functions/v1/site-blueprints`
- Supported action: `apply`
- Authority: Cloudflare Worker only
- Permission model:
  - platform-managed blueprints: `platform.template.manage`
  - tenant-authored variants / tenant apply: `tenant.setting.update`

The apply route:

1. Validates tenant context and blueprint ownership rules.
2. Persists `tenant_site_blueprint_state`.
3. Stores active blueprint metadata and payload snapshots in `settings`.
4. Upserts declared `template_assignments`.
5. Writes access audit metadata.

### Admin Surface

- Host UI: `awcms/src/components/dashboard/TemplatesManager.jsx`
- Phase 2 tab: `Site Blueprints`
- Backing hook: `awcms/src/hooks/useSiteBlueprints.js`

The current UI supports:

- listing platform and tenant-owned blueprints
- creating tenant-scoped variants
- deleting blueprint rows
- applying a blueprint to the active tenant

The current UI does not yet provide a rich schema-aware editor; payload authoring is still JSON-based in this phase.

## Phase 3 Reusable Sections

Phase 3 adds a hybrid reusable section foundation that fits the existing template-parts and visual-builder pipeline instead of introducing a parallel runtime.

### Reusable Sections Table

| Table | Scope | Purpose |
| --- | --- | --- |
| `reusable_sections` | Platform or Tenant | Stores reusable section definitions that can either hold visual content directly or reference an existing `template_part`. |

### Reusable Section Modes

- `visual`: section stores visual content directly as JSON
- `template_part_reference`: section points at an existing `template_part` and can be re-materialized for tenant use

### Worker Materialization Path

- Route: `POST /functions/v1/reusable-sections`
- Supported action: `materialize`
- Authority: Cloudflare Worker only
- Permission model:
  - platform-managed sections: `platform.template.manage`
  - tenant-authored sections / tenant materialization: `tenant.setting.update`

The materialization route:

1. Validates tenant context and section ownership.
2. Resolves content from the section record or referenced `template_part`.
3. Creates a tenant `template_part` using the existing template-part model.
4. Writes access audit metadata.

### Admin Surface

- Host UI: `awcms/src/components/dashboard/TemplatesManager.jsx`
- Phase 3 tab: `Reusable Sections`
- Backing hook: `awcms/src/hooks/useReusableSections.js`

The current UI supports:

- listing reusable sections
- creating tenant-scoped variants
- deleting reusable sections
- materializing a section into a tenant `template_part`

This phase does not yet add direct insertion into `VisualPageBuilder` or public runtime lookup-by-slug.

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
