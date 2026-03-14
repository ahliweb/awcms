# Deployment Cells — Overview

This document describes the deployment cell model that AWCMS uses to support multi-project, multi-tenant deployments across Coolify, Cloudflare, and Supabase.

See the maintained deployment-cell documentation set:

- [`schema.md`](./schema.md)
- [`service-profiles.md`](./service-profiles.md)
- [`provisioning-workflow.md`](./provisioning-workflow.md)
- [`migration-runbooks.md`](./migration-runbooks.md)
- [`validation-checklist.md`](./validation-checklist.md)

---

## What is a Deployment Cell?

A **deployment cell** is a named bundle of infrastructure references — a Coolify runtime, a Cloudflare zone, and a Supabase project — that hosts a specific set of tenants for a given environment.

```
Platform Project
└── Deployment Cell (e.g. production / shared-managed)
    ├── Coolify runtime (Admin + Public apps, Workers, Cron)
    ├── Cloudflare zone (DNS, WAF, CDN, Custom Hostnames)
    └── Supabase project (Auth, DB/RLS, Storage metadata)
        └── Tenant A
        └── Tenant B
```

## Core Tables

| Table | Purpose |
|---|---|
| `platform_projects` | Top-level product umbrella |
| `deployment_cells` | Infrastructure binding per environment |
| `tenants_control` | Commercial tenant identity |
| `tenant_domains` | Canonical hostname registry |
| `tenant_service_contracts` | Append-only profile assignment ledger |
| `tenant_migrations` | Cell migration lifecycle tracker |

## Service Profiles

A tenant's runtime behavior is determined by its **service profile**:

| Profile | Runtime | Data | Edge |
|---|---|---|---|
| `shared_managed` | Shared | Shared | Shared |
| `dedicated_managed` | Dedicated | Dedicated | Shared |
| `dedicated_hybrid` | Dedicated (Linode) | Dedicated (Supabase) | Shared |
| `dedicated_self_hosted` | Dedicated | Self-hosted | BYOD |
| `vanity_domain_saas` | Shared | Shared | Dedicated |

## Key Source Files

| Path | Purpose |
|---|---|
| `src/lib/tenancy/resolveTenant.js` | Primary hostname resolver |
| `src/lib/tenancy/routeClass.js` | RouteClass enum + deriveRouteClass() |
| `src/lib/tenancy/serviceProfile.js` | ServiceProfile enum + behavior metadata |
| `src/lib/tenancy/resolveCell.js` | Cell status helpers |
| `src/lib/storage/objectKeys.js` | R2 canonical object key format |
| `src/lib/storage/mediaPolicies.js` | Visibility class access policies |
| `src/lib/provisioning/` | Workflow B/C/D/E/F helpers |
| `src/lib/migrations/deploymentCellRunbooks.js` | Runbook state machine |
| `src/contexts/TenantContext.jsx` | React context powered by resolution layer |
