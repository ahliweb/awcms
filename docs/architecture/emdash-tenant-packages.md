> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)

# EmDash Tenant Packages

## Purpose

Define the first-wave architecture for treating an EmDash repository as one tenant-native package inside AWCMS.

## Core Decisions

- One EmDash repository maps to one AWCMS tenant package.
- Admin authoring and operations stay in `awcms/`.
- Public delivery targets `awcms-public/primary/` first.
- Sovereign tenant delivery reuses the same contracts in `awcms-public/smandapbun/` second.
- Supabase Auth, PostgreSQL, RLS, and ABAC remain authoritative.
- EmDash runtime DDL is not adopted; tenant flexibility flows through dynamic resources and explicit migrations.

## Foundation Contracts

### Import Domain

- `tenant_import_jobs`
- `tenant_import_sources`
- `tenant_import_mappings`
- `tenant_import_artifacts`
- `tenant_import_audit`

These tables track dry-run imports, replayability, source fidelity, and tenant-safe migration state.

### Widget Compatibility

- EmDash widget areas are represented through `template_parts` with `type = 'widget_area'`.
- Imported widgets retain an immutable `raw_emdash_payload` envelope.
- Normalized AWCMS widget fields remain editable while the original EmDash payload stays preserved.

### Extension Runtime

- Tenant extension state remains in `tenant_extensions`.
- Tenant-aware API route registry is materialized in `tenant_extension_routes`.
- Wave-one extension execution is capability-limited and Worker-mediated.

## Tenant-Aware Extension Routes

Extension routes use a signed tenant-aware namespace:

```text
/functions/v1/ext/{tenantRoute}/{vendor}/{extension}/{route}
```

Rules:

- `tenantRoute` is a signed route token issued by the Worker.
- the Worker resolves the token to a tenant UUID
- the Worker verifies tenant access and declared route capability
- public and authenticated routes are declared separately in extension metadata
- all extension route execution is auditable

## Implementation Sequence

1. Foundation tables and route contracts
2. Blog import and exact widget-area preservation
3. Blog public rendering in `awcms-public/primary/`
4. Plugin admin/settings surfaces
5. Extension API route execution
6. Marketing strict parity
7. Portfolio strict parity
8. Sovereign-public replication in `awcms-public/smandapbun/`

## Validation Gates

- migration parity across both Supabase migration trees
- RLS and ABAC review for all new tenant-scoped tables
- exact blog widget-area compatibility checks
- extension namespace auth and tenant mismatch tests
- public build/check for `awcms-public/primary`
- visual snapshot parity for marketing and portfolio phases
