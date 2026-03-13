# Deployment Cells — Schema Reference

**Spec reference:** §7 SQL Schema Draft

---

## Entity Relationship

```
platform_projects
  └── deployment_cells (many per project)
  └── tenants_control (many per project)
        ├── current_cell_id → deployment_cells
        ├── primary_domain_id → tenant_domains (deferred FK)
        ├── tenant_domains (many per tenant)
        ├── tenant_service_contracts (append-only ledger)
        └── tenant_migrations (move tracker)
```

## Tables

### `platform_projects`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `code` | TEXT UNIQUE | Short slug, used in R2 object keys |
| `name` | TEXT | |
| `status` | TEXT | `active`, `suspended`, `archived` |
| `default_region` | TEXT | |
| `default_edge_profile_id` | UUID | Future FK to edge_profiles |

### `deployment_cells`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `project_id` | UUID FK | `platform_projects` |
| `environment` | TEXT | `production`, `staging`, `preview`, `development` |
| `service_profile` | TEXT | See ServiceProfile enum |
| `coolify_mode` | TEXT | `self_hosted`, `coolify_cloud` |
| `supabase_mode` | TEXT | `managed`, `self_hosted` |
| `status` | TEXT | `draft` → `active` → `maintenance` → `decommissioned` |

### `tenants_control`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `project_id` | UUID FK | `platform_projects` |
| `tenant_code` | TEXT | Immutable slug; used in R2 key path |
| `display_name` | TEXT | |
| `status` | TEXT | `draft`, `active`, `suspended`, `migrating`, `archived` |
| `current_cell_id` | UUID FK | `deployment_cells` |
| `primary_domain_id` | UUID FK (deferred) | `tenant_domains` |

### `tenant_domains`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `tenant_id` | UUID FK | `tenants_control` |
| `cell_id` | UUID FK | `deployment_cells` |
| `hostname` | TEXT UNIQUE | Exact hostname only |
| `domain_kind` | TEXT | Controls `routeClass` derivation |
| `is_primary` | BOOLEAN | One per tenant public domain |
| `verification_status` | TEXT | `pending`, `verified`, `failed`, `revoked` |
| `active_from` / `active_to` | TIMESTAMPTZ | Activation window |

### `tenant_service_contracts`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `tenant_id` | UUID FK | |
| `service_profile` | TEXT | |
| `runtime_isolation_level` | TEXT | `shared`, `scoped`, `dedicated` |
| `data_isolation_level` | TEXT | `shared`, `dedicated` |
| `edge_isolation_level` | TEXT | `shared`, `byod`, `dedicated` |
| `effective_at` | TIMESTAMPTZ | Latest row = current contract |

> [!IMPORTANT]
> `tenant_service_contracts` is **append-only**. Never update a past row. Insert a new row to change a profile.

### `tenant_migrations`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `tenant_id` | UUID FK | |
| `source_cell_id` | UUID FK | |
| `target_cell_id` | UUID FK | |
| `migration_kind` | TEXT | Runbook A–D identifiers |
| `status` | TEXT | `planned` → `in_progress` → `validating` → `completed` |
| `rollback_deadline` | TIMESTAMPTZ | **Required** before `in_progress` |

## Migration Files

| File | Creates |
|---|---|
| `20260313000100_create_platform_projects.sql` | `platform_projects` |
| `20260313000200_create_deployment_cells.sql` | `deployment_cells` |
| `20260313000300_create_tenants_control.sql` | `tenants_control` |
| `20260313000400_create_tenant_domains.sql` | `tenant_domains` + deferred FK |
| `20260313000500_create_tenant_service_contracts.sql` | `tenant_service_contracts` |
| `20260313000600_create_tenant_migrations.sql` | `tenant_migrations` |
| `20260313000700_add_deployment_cell_helper_functions.sql` | RPCs + helpers |
