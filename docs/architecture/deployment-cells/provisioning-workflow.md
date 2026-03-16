# Deployment Cells — Provisioning Workflows

**Spec reference:** §15 Provisioning Workflows B–F

---

## Overview

The AWCMS provisioning layer provides JS helpers for all control-plane write operations. These helpers are **not** an API layer — they run inside admin scripts, platform admin UI, or CLI tools that already hold an authenticated admin session.

| Workflow | JS Helper | Purpose |
|---|---|---|
| **B** | `createDeploymentCell` | Create a cell in draft, then activate after external validation |
| **C** | `createTenant` | Create a tenant + initial service contract |
| **D** | `attachDomain` + `activateDomain` | Attach a hostname, then verify and activate |
| **E** | `promotePrimaryDomain` | Promote a domain to the tenant's primary public hostname |
| **F** | `assignServiceProfile` | Change tenant isolation level; creates migration record if infra move needed |

All helpers are in `src/lib/provisioning/`.

---

## Workflow B — Create Deployment Cell

```javascript
import { createDeploymentCell, activateDeploymentCell } from '@/lib/provisioning/createDeploymentCell';

// Step 1: Create in draft
const { cell, error } = await createDeploymentCell({
  projectId: '...',
  environment: 'production',
  serviceProfile: 'shared_managed',
  supabaseMode: 'managed',
  cloudflareAccountRef: 'cf-acct-xxx',
  cloudflareZoneRef: 'cf-zone-yyy',
  supabaseProjectRef: 'sp-proj-zzz',
});

// Step 2: After external resources are confirmed provisioned
const { cell: activeCell, error: activateErr } = await activateDeploymentCell({ cellId: cell.id });
```

## Workflow C — Create Tenant

```javascript
import { createTenant } from '@/lib/provisioning/createTenant';

const { tenant, contract, error } = await createTenant({
  projectId: '...',
  tenantCode: 'acme',
  displayName: 'Acme Corp',
  currentCellId: '...',
  serviceProfile: 'shared_managed',
  runtimeIsolation: 'shared',
  dataIsolation: 'shared',
  edgeIsolation: 'shared',
});
```

> [!NOTE]
> After creating a tenant, the caller must also seed the tenant-level application data (e.g., default roles, settings, admin user). This step is outside the provisioning contract — it's the application's responsibility.

## Workflow D — Attach Domain

```javascript
import { attachDomain, activateDomain } from '@/lib/provisioning/attachDomain';

// Step 1: Attach (starts in 'pending')
const { domain, error } = await attachDomain({
  tenantId: '...',
  cellId: '...',
  hostname: 'portal.acme.com',
  domainKind: 'custom_domain',
  certificateMode: 'cloudflare_managed',
  routingMode: 'cloudflare_proxy',
});

// Step 2: After DNS propagation and TLS confirmed
const { domain: verified } = await activateDomain({ domainId: domain.id });
```

## Workflow E — Promote Primary Domain

```javascript
import { promotePrimaryDomain } from '@/lib/provisioning/attachDomain';

const { error } = await promotePrimaryDomain({
  tenantId: '...',
  domainId: domain.id, // must be verified and active
});
```

## Workflow F — Assign Service Profile

```javascript
import { assignServiceProfile } from '@/lib/provisioning/assignServiceProfile';

const { contract, migration, error } = await assignServiceProfile({
  tenantId: '...',
  currentProfile: 'shared_managed',
  newProfile: 'dedicated_managed',
  runtimeIsolation: 'dedicated',
  dataIsolation: 'dedicated',
  edgeIsolation: 'shared',
  targetCellId: '...', // required when isolation levels change
  migrationKind: 'shared_to_dedicated_managed',
  rollbackDeadline: '2026-04-01T00:00:00Z',
});
```

If `requiresCellMigration()` returns `true`, Workflow F automatically:
1. Inserts a new `tenant_service_contracts` row
2. Creates a `tenant_migrations` record
3. Sets the tenant status to `migrating`

The operator then follows the relevant runbook (see [`migration-runbooks.md`](./migration-runbooks.md)).
