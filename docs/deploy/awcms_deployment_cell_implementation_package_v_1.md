# AWCMS Deployment Cell Implementation Package v1

## Document Control

**Document title:** AWCMS Deployment Cell Implementation Package v1  
**Status:** Implementation-ready draft  
**System:** AWCMS  
**Applies to:** Multi-project, multi-tenant AWCMS deployments using Coolify, Cloudflare, and Supabase  
**Depends on:** `AWCMS Deployment Cell Specification v1`  
**Normative order:** `SYSTEM_MODEL.md` → `AGENTS.md` → `DOCS_INDEX.md` → `docs/**` → this package

---

# 1. Executive Summary

This implementation package translates the deployment-cell specification into an actionable AWCMS work package.

It defines:

1. the control-plane schema to add to AWCMS
2. the domain-resolution contract for admin/public/api/cdn traffic
3. the runtime layout for Coolify
4. the Cloudflare Worker and R2 integration contract
5. the Supabase tenancy and RLS integration boundaries
6. the provisioning workflow for new tenants and new cells
7. the migration runbooks for service-profile changes
8. the validation, rollback, security, and documentation requirements

The implementation target is a platform where:

- one AWCMS codebase supports many projects
- one project supports many tenants
- one tenant may use many domains or subdomains
- a tenant can move between shared managed, dedicated managed, dedicated hybrid, and dedicated self-hosted profiles
- Cloudflare remains the edge/security/storage plane where practical
- Supabase remains the identity/data policy authority unless a self-hosted data profile is explicitly selected

---

# 2. Scope & Boundaries

## 2.1 In Scope

This package covers:

- control-plane tables and migrations
- AWCMS runtime contracts for tenant resolution
- service-profile modeling
- edge routing contracts
- storage metadata contracts
- provisioning workflow and runbooks
- operations validation and rollback planning

## 2.2 Out of Scope

This package does not include:

- final production Worker source code
- final CI/CD YAML
- exact Linode sizing matrix per client tier
- UI pixel-level design details
- customer-specific pricing sheets

---

# 3. Assumptions

1. AWCMS will continue to enforce multi-tenancy at the database layer.
2. Supabase remains the default data plane for managed profiles.
3. Cloudflare remains the default edge plane for all profiles unless a regulated exception is documented.
4. R2 remains the preferred object storage plane for media and derived assets.
5. Coolify will be used in either self-hosted mode or Coolify Cloud mode, but the AWCMS runtime contract must not depend on one exclusive mode.
6. Tenant identity is immutable and must not depend on hostnames.
7. Service-profile changes are controlled migrations, not UI toggles.

---

# 4. Plan (Phased)

## Phase 1 — Control-Plane Schema Foundation

Add the canonical platform metadata tables:

- `platform_projects`
- `deployment_cells`
- `tenants_control`
- `tenant_domains`
- `tenant_service_contracts`
- `tenant_migrations`
- optional: `edge_profiles`
- optional: `data_profiles`

## Phase 2 — Runtime Resolution Layer

Implement hostname-driven tenant resolution and cell-aware routing in AWCMS.

## Phase 3 — Service-Profile Engine

Implement profile-aware provisioning and runtime behavior.

## Phase 4 — Edge and Storage Contracts

Implement Cloudflare Worker contract, R2 key conventions, and canonical media metadata mapping.

## Phase 5 — Provisioning Workflow

Implement the workflows for:

- new project
- new cell
- new tenant
- new domain
- new service contract

## Phase 6 — Migration Runbooks

Operationalize tenant portability between supported service profiles.

## Phase 7 — Documentation, Tests, and Ops Readiness

Validate, document, and harden.

---

# 5. Action Matrix

| Module / Area | Change | Rationale | Risk |
|---|---|---|---|
| Database / Control Plane | Add deployment-cell tables | Needed to decouple tenant identity from infrastructure topology | Medium |
| Database / Domain Registry | Add canonical tenant-domain registry | Supports multi-domain and custom-hostname routing | Medium |
| Runtime / Tenant Resolution | Resolve tenant by hostname + active cell | Prevents fragile env/domain hardcoding | High |
| Runtime / Service Profiles | Add explicit profile mapping | Enables managed/self-hosted commercial flexibility | Medium |
| Edge / Cloudflare | Define route classes and Worker boundaries | Keeps edge logic structured and auditable | Medium |
| Storage / R2 | Standardize key format + metadata sync | Makes storage portable across profiles | Medium |
| Security / RLS | Keep final auth in DB | Preserves multi-tenant isolation | High |
| Provisioning | Add workflow states and status transitions | Reduces manual mistakes | Medium |
| Migration | Add runbooks + audit tables | Required for safe tenant moves | High |
| Docs / Ops | Update architecture and runbooks | Prevents drift between code and operations | Medium |

---

# 6. Target Repository Deliverables

## 6.1 Recommended document outputs

Add the following docs under `docs/`:

```text
/docs/architecture/deployment-cells/overview.md
/docs/architecture/deployment-cells/schema.md
/docs/architecture/deployment-cells/domain-resolution.md
/docs/architecture/deployment-cells/service-profiles.md
/docs/architecture/deployment-cells/storage-contract.md
/docs/architecture/deployment-cells/provisioning-workflow.md
/docs/architecture/deployment-cells/migration-runbooks.md
/docs/architecture/deployment-cells/validation-checklist.md
```

## 6.2 Recommended code-level outputs

```text
awcms/
  src/
    lib/
      tenancy/
        resolveTenant.ts
        resolveCell.ts
        routeClass.ts
        serviceProfile.ts
      security/
        tenantContext.ts
        authz.ts
      storage/
        objectKeys.ts
        mediaPolicies.ts
      provisioning/
        createTenant.ts
        attachDomain.ts
        assignServiceProfile.ts
        createDeploymentCell.ts
      migrations/
        deploymentCellRunbooks.ts
```

## 6.3 Database outputs

```text
supabase/
  migrations/
    <timestamp>_create_platform_projects.sql
    <timestamp>_create_deployment_cells.sql
    <timestamp>_create_tenants_control.sql
    <timestamp>_create_tenant_domains.sql
    <timestamp>_create_tenant_service_contracts.sql
    <timestamp>_create_tenant_migrations.sql
    <timestamp>_add_indexes_and_constraints_for_domain_resolution.sql
```

---

# 7. SQL Schema Draft

## 7.1 `platform_projects`

```sql
create table if not exists public.platform_projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  status text not null default 'active',
  default_region text,
  default_edge_profile_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

## 7.2 `deployment_cells`

```sql
create table if not exists public.deployment_cells (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.platform_projects(id) on delete cascade,
  environment text not null,
  service_profile text not null,
  coolify_mode text not null check (coolify_mode in ('self_hosted', 'coolify_cloud')),
  coolify_server_ref text,
  cloudflare_account_ref text,
  cloudflare_zone_ref text,
  edge_profile_id uuid,
  supabase_mode text not null check (supabase_mode in ('managed', 'self_hosted')),
  supabase_project_ref text,
  linode_region text,
  status text not null default 'draft',
  ops_owner_type text,
  ops_owner_id uuid,
  billing_owner_type text,
  billing_owner_id uuid,
  runtime_capacity_class text,
  notes text,
  decommission_after timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_deployment_cells_project_env
  on public.deployment_cells(project_id, environment, status);
```

## 7.3 `tenants_control`

Implementation note: keep the `_control` suffix. It is important because this table is the
deployment-cell control-plane tenant registry and must stay distinct from tenant-scoped application
tables that may already use the `tenants` name.

```sql
create table if not exists public.tenants_control (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.platform_projects(id) on delete cascade,
  tenant_code text not null,
  display_name text not null,
  status text not null default 'draft',
  current_cell_id uuid references public.deployment_cells(id),
  primary_domain_id uuid,
  billing_model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, tenant_code)
);
```

## 7.4 `tenant_domains`

```sql
create table if not exists public.tenant_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants_control(id) on delete cascade,
  cell_id uuid not null references public.deployment_cells(id),
  hostname text not null,
  domain_kind text not null check (
    domain_kind in (
      'platform_subdomain',
      'custom_domain',
      'admin_domain',
      'api_domain',
      'cdn_domain',
      'preview_domain'
    )
  ),
  is_primary boolean not null default false,
  certificate_mode text,
  routing_mode text,
  verification_status text not null default 'pending',
  cloudflare_hostname_ref text,
  origin_hint text,
  redirect_target text,
  notes text,
  active_from timestamptz,
  active_to timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(hostname)
);

create index if not exists idx_tenant_domains_tenant_kind_active
  on public.tenant_domains(tenant_id, domain_kind, verification_status, active_to);

create index if not exists idx_tenant_domains_cell
  on public.tenant_domains(cell_id);
```

## 7.5 `tenant_service_contracts`

```sql
create table if not exists public.tenant_service_contracts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants_control(id) on delete cascade,
  service_profile text not null,
  runtime_isolation_level text not null,
  data_isolation_level text not null,
  edge_isolation_level text not null,
  backup_tier text,
  support_tier text,
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
```

## 7.6 `tenant_migrations`

```sql
create table if not exists public.tenant_migrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants_control(id) on delete cascade,
  source_cell_id uuid references public.deployment_cells(id),
  target_cell_id uuid references public.deployment_cells(id),
  migration_kind text not null,
  status text not null default 'planned',
  planned_cutover_at timestamptz,
  rollback_deadline timestamptz,
  operator_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

## 7.7 Relationship fix-up for `primary_domain_id`

```sql
alter table public.tenants_control
  add constraint tenants_control_primary_domain_fk
  foreign key (primary_domain_id)
  references public.tenant_domains(id)
  deferrable initially deferred;
```

---

# 8. Constraint and Policy Rules

## 8.1 One primary public domain per tenant

Implement an application-level invariant and, where practical, a partial unique index strategy.

### Suggested rule

- one tenant may have only one active primary domain among `platform_subdomain` and `custom_domain`
- `admin_domain` and `api_domain` do not count as primary public domains

## 8.2 Domain activation rule

A domain must not be considered active unless:

- `verification_status = 'verified'`
- `active_from <= now()`
- `active_to is null or active_to > now()`
- linked `deployment_cells.status = 'active'`
- linked `tenants_control.status = 'active'`

## 8.3 Migration lock rule

When `tenants_control.status = 'migrating'`, mutation operations affecting routing, primary-domain assignment, or service-profile assignment should require elevated workflow checks.

---

# 9. RLS / ABAC Integration Contract

## 9.1 Final authority

These new control-plane tables must not weaken existing tenant security.

## 9.2 Recommended policy direction

### For global platform operators
Allow access only to trusted platform roles.

### For tenant-scoped operators
- allow read access only to their own tenant rows
- allow domain updates only to domains owned by their tenant
- block cross-tenant visibility by default

## 9.3 Important rule

Do not use these metadata tables to bypass normal tenant-scoped resource checks. They must complement the existing tenant model, not replace it.

## 9.4 Suggested helper functions

- `current_tenant_id()`
- `current_project_id()`
- `is_platform_admin()`
- `has_permission(scope, resource, action)`
- `can_manage_domain(tenant_id)`
- `can_manage_cell(cell_id)`

---

# 10. Domain Resolution Contract for AWCMS Runtime

## 10.1 Function contract

Create a runtime resolver with this conceptual contract:

```ts
export type RouteClass = 'public' | 'admin' | 'api' | 'cdn' | 'preview'

export interface TenantResolutionResult {
  projectId: string
  tenantId: string
  tenantCode: string
  tenantStatus: string
  cellId: string
  serviceProfile: string
  domainId: string
  hostname: string
  routeClass: RouteClass
  isPrimary: boolean
}

export async function resolveTenantByHostname(hostname: string): Promise<TenantResolutionResult | null>
```

## 10.2 Resolution algorithm

1. normalize hostname
2. find exact active domain in `tenant_domains`
3. join `tenants_control` and `deployment_cells`
4. reject if tenant or cell is not active
5. derive `routeClass` from `domain_kind`
6. return a canonical context object for downstream rendering or API logic

## 10.3 Failure behavior

- unknown hostname → return null / 404 / fallback landing policy
- inactive tenant → return suspension or maintenance policy
- inactive cell → return maintenance policy
- verified mismatch → block routing

## 10.4 Route class mapping

| `domain_kind` | `routeClass` |
|---|---|
| `platform_subdomain` | `public` |
| `custom_domain` | `public` |
| `admin_domain` | `admin` |
| `api_domain` | `api` |
| `cdn_domain` | `cdn` |
| `preview_domain` | `preview` |

---

# 11. Service-Profile Engine Contract

## 11.1 Canonical enum values

```ts
export type ServiceProfile =
  | 'shared_managed'
  | 'dedicated_managed'
  | 'dedicated_hybrid'
  | 'dedicated_self_hosted'
  | 'vanity_domain_saas'
```

## 11.2 Runtime behavior rules

### `shared_managed`
- tenant lives on shared runtime cell
- tenant uses shared managed data profile
- strict quota and abuse checks required

### `dedicated_managed`
- tenant gets dedicated runtime or tightly scoped cell
- tenant gets dedicated managed Supabase project

### `dedicated_hybrid`
- tenant gets dedicated runtime on Linode
- tenant still uses managed Supabase

### `dedicated_self_hosted`
- tenant gets dedicated runtime and dedicated self-hosted data profile

### `vanity_domain_saas`
- can overlay on top of one of the above
- adds custom-hostname and large-domain-scale routing workflows

## 11.3 Selection rule

Service profile is assigned through provisioning or service-contract updates, not inferred from server names or domains.

---

# 12. Cloudflare Routing and Worker Contract

## 12.1 Route classes

Use Cloudflare to distinguish at least:

- public app hostnames
- admin hostnames
- API / integration hostnames
- media/CDN hostnames

## 12.2 Worker responsibilities

Workers may perform:

- hostname dispatch
- signed media delivery
- upload token issuance
- webhook signature verification
- rate and abuse screening
- integration request normalization

## 12.3 Worker prohibition

Workers must not become the final source of tenant authorization truth. Final authorization remains in Supabase-backed DB policy.

## 12.4 Recommended Worker interfaces

### Upload ticket request

```ts
interface UploadTicketRequest {
  tenantId: string
  module: string
  objectKind: string
  mimeType: string
  filename: string
}
```

### Upload ticket response

```ts
interface UploadTicketResponse {
  objectKey: string
  expiresAt: string
  uploadMethod: 'worker_direct' | 'signed_put'
  token: string
}
```

### Private object access request

```ts
interface PrivateObjectAccessRequest {
  tenantId: string
  objectKey: string
  requestedBy: string
}
```

### Private object access response

```ts
interface PrivateObjectAccessResponse {
  allowed: boolean
  accessMode: 'stream' | 'redirect_signed_url'
  expiresAt?: string
  url?: string
}
```

## 12.5 Admin ingress rule

Admin domains should default to protected-origin patterns and should not be openly exposed unless specifically approved.

---

# 13. R2 Storage and Media Metadata Contract

## 13.1 Canonical object key pattern

```text
{project_code}/{environment}/{tenant_id}/{module}/{object_id}/{variant_or_filename}
```

## 13.2 Canonical media metadata table requirements

Either adapt the existing canonical media table or create a compatible media metadata layer with at least:

- `id`
- `tenant_id`
- `project_id`
- `module`
- `object_id`
- `object_key`
- `visibility_class` (`public`, `private`, `restricted`)
- `retention_class`
- `content_type`
- `size_bytes`
- `checksum`
- `status`
- `created_by`
- `created_at`

## 13.3 Access policy rules

### Public assets
- can be cached aggressively
- must be intentionally marked public

### Private assets
- Worker-mediated access only
- short-lived grants
- logged access for sensitive classes if required

### Restricted assets
- explicit permission checks
- optional legal or audit retention rules

## 13.4 Upload completion rule

An upload is not canonical until:

1. the object exists in R2
2. the metadata row exists and is valid
3. the object is linked to a tenant/module record
4. visibility and retention classes are set

---

# 14. Coolify Resource Layout Standard

## 14.1 Standard runtime layout per cell

### Coolify Applications

- `awcms-public`
- `awcms-admin`
- optional `awcms-api` if separated

### Coolify Services

- `awcms-worker`
- `awcms-cron`
- optional `redis`
- optional processing services
- optional observability sidecars

## 14.2 Naming standard

Use a consistent resource naming pattern:

```text
{project_code}-{environment}-{cell_code}-{resource_name}
```

Example:

```text
sikesra-prod-cell01-awcms-public
sikesra-prod-cell01-awcms-admin
sikesra-prod-cell01-awcms-worker
```

## 14.3 Minimum runtime env groups

- shared runtime vars
- public app vars
- admin app vars
- worker vars
- cron vars

## 14.4 Build/deploy rule

Public/admin apps should be Git-driven. Workers, cron, and background jobs may be Git-driven or Compose-managed depending on packaging, but must remain separable from the web request path.

---

# 15. Provisioning Workflow Specification

## 15.1 Workflow A — Create project

1. create `platform_projects` row
2. assign default edge profile
3. assign default environment strategy
4. document project code and naming convention

## 15.2 Workflow B — Create deployment cell

1. create `deployment_cells` row in `draft`
2. assign project, environment, service profile, runtime mode, data mode
3. bind Coolify server reference
4. bind Cloudflare zone/account reference
5. bind Supabase project or self-hosted reference
6. provision runtime resources
7. mark cell `active` only after validation

## 15.3 Workflow C — Create tenant

1. create `tenants_control` row in `draft`
2. assign `current_cell_id`
3. create `tenant_service_contracts` row
4. initialize tenant-scoped app data
5. assign default status transitions

## 15.4 Workflow D — Attach domain

1. create `tenant_domains` row in `pending`
2. verify ownership / DNS / hostname readiness
3. bind edge routing
4. validate TLS and route behavior
5. update `verification_status = 'verified'`
6. activate domain by setting `active_from`

## 15.5 Workflow E — Promote primary domain

1. validate domain belongs to tenant
2. validate domain is active and verified
3. demote previous primary public domain
4. set `is_primary = true`
5. update `tenants_control.primary_domain_id`
6. invalidate related caches as needed

## 15.6 Workflow F — Assign or change service profile

1. create new `tenant_service_contracts` row with `effective_at`
2. if no infra move is required, apply internal policy changes
3. if infra move is required, create `tenant_migrations` row and switch tenant status to `migrating`

---

# 16. Migration Runbooks

## 16.1 Runbook A — Shared Managed → Dedicated Managed

### Preconditions

- target managed Supabase project exists
- target runtime cell exists and is validated
- tenant data copy or logical split plan is approved

### Steps

1. create target cell
2. create migration record
3. export or split tenant data
4. import into dedicated managed target
5. validate row counts and tenant-scoped resources
6. sync media metadata if needed
7. freeze mutable operations briefly if required
8. switch domain routing to target cell
9. mark tenant `active` on target
10. retain rollback window

## 16.2 Runbook B — Dedicated Managed → Dedicated Hybrid

### Steps

1. create dedicated runtime cell on Linode
2. attach Coolify runtime resources
3. keep Supabase project unchanged
4. deploy AWCMS runtime against the same data plane
5. validate application behavior
6. cut traffic to new runtime
7. observe and retain rollback window

## 16.3 Runbook C — Dedicated Managed → Dedicated Self-Hosted

### Steps

1. provision dedicated self-hosted cell
2. provision self-hosted data plane
3. migrate database schema and data
4. reconfigure auth and secrets
5. validate tenant data and permissions
6. confirm session cutover strategy
7. cut domains over to target cell
8. monitor post-cutover
9. retain rollback until data divergence threshold expires

## 16.4 Runbook D — Dedicated Self-Hosted → Dedicated Managed

### Steps

1. provision target managed project and target runtime cell
2. export and restore data
3. map auth, config, and secrets
4. revalidate app behavior
5. update routing
6. retain rollback window

## 16.5 Migration validation checklist

- tenant count matches
- primary and secondary domains match
- public/admin/api routes all resolve correctly
- tenant-scoped row counts match
- file/object metadata counts match
- auth flows work
- background jobs work
- RLS checks pass

---

# 17. Validation Checklist (Commands + Expected Results)

## 17.1 Database validation

### Example commands

```bash
supabase db lint
supabase db push --dry-run
```

### Expected results

- migrations apply cleanly
- no broken references
- no duplicate constraints or invalid indexes

## 17.2 Application validation

### Example commands

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

### Expected results

- no type errors
- no lint errors
- runtime build completes
- tenant resolution unit tests pass

## 17.3 Domain resolution tests

### Minimum cases

- known active public domain resolves correctly
- admin domain maps to admin route class
- inactive tenant is blocked
- inactive cell is blocked
- unknown hostname returns null/fallback behavior

## 17.4 Storage tests

### Minimum cases

- object key is generated correctly
- private object requires Worker-mediated access
- public object is delivered correctly
- metadata row exists after upload completion

## 17.5 Migration dry-run tests

### Minimum cases

- migration record creation works
- source/target cell references are valid
- rollback window is enforced

---

# 18. Security & Tenancy Review

## 18.1 Required controls

- final authorization remains in DB/RLS
- platform-only actions are separated from tenant actions
- admin domains are protected more strongly than public domains
- private assets are not delivered through uncontrolled direct URLs
- service-profile changes are auditable

## 18.2 Common failure modes to avoid

1. resolving tenant from subdomain string without consulting canonical domain table
2. assuming one tenant has one domain forever
3. letting edge code become the real authorization layer
4. storing private files without canonical metadata linkage
5. changing service profile without a migration record
6. hardcoding runtime behavior based on one Supabase topology

## 18.3 AWCMS-specific security note

These changes must not weaken tenant boundaries already required by the AWCMS model. Any helper tables introduced here must be covered by RLS or restricted platform-only access.

---

# 19. Docs Update Plan

Update these documentation areas in the same implementation series:

1. `README.md` — high-level deployment model
2. `AGENTS.md` — agent rules for deployment-cell aware changes
3. `docs/architecture/*` — deployment-cell architecture and service profiles
4. `docs/security/*` — domain resolution, storage access, and migration risks
5. `docs/operations/*` — provisioning and migration runbooks
6. `docs/RESOURCE_MAP.md` — if resources are added or responsibilities change

---

# 20. Rollback Strategy

## 20.1 Schema rollback

- add forward-compatible migrations where possible
- avoid destructive drops in the first rollout
- deprecate before removing

## 20.2 Routing rollback

- retain previous domain routing state until cutover is validated
- keep previous cell warm during rollback window where feasible

## 20.3 Storage rollback

- do not delete canonical metadata during rollout
- preserve object keys and metadata lineage

## 20.4 Migration rollback

Every migration must define:

- rollback owner
- rollback deadline
- source of truth during rollback window
- divergence handling plan

---

# 21. Recommended Test Matrix

## 21.1 Unit tests

- `resolveTenantByHostname()`
- `deriveRouteClass()`
- `generateObjectKey()`
- `isDomainActive()`
- `canPromotePrimaryDomain()`

## 21.2 Integration tests

- create tenant + attach platform subdomain
- attach custom domain + verify activation
- assign service profile + validate cell selection
- upload media + validate metadata linkage

## 21.3 Security tests

- cross-tenant domain read denial
- cross-tenant domain mutation denial
- private object access denial without valid policy
- inactive cell route denial

## 21.4 Migration tests

- create migration record
- tenant state transitions to `migrating`
- cutover simulation updates domain routing correctly
- rollback simulation restores prior routing

---

# 22. Deployment Definition of Done

This package is considered implemented only when all of the following are true:

1. control-plane tables exist and are tested
2. hostname resolution uses canonical tenant-domain data
3. service profile assignment is explicit and persisted
4. admin/public/api/cdn route classes are supported
5. storage key and metadata contracts are implemented
6. provisioning workflows are documented and testable
7. migration runbooks exist for all supported moves
8. docs are updated
9. lint, build, and tests pass
10. tenant isolation remains intact

---

# 23. Final Notes / Follow-ups

This package is intentionally structured to let AWCMS grow commercially without re-architecting tenancy each time a client changes budget or hosting preference.

The highest-priority implementation order is:

1. schema and indexes
2. runtime tenant/domain resolver
3. service-profile engine
4. storage contract
5. provisioning actions
6. migration runbooks

The best immediate next artifact after this package is a **code-oriented execution plan** with:

- exact migration filenames
- exact TypeScript module skeletons
- exact table policies and helper functions
- exact route middleware points in the AWCMS app
