# Deployment Cells — Migration Runbooks

**Spec reference:** §16 Migration Runbooks A–D, §16.5 Validation Checklist

---

## Overview

A **migration** moves a tenant between deployment cells or changes its service isolation level. All migrations are tracked in the `tenant_migrations` table and executed by a platform operator following the relevant runbook.

The JS state machine helpers in `src/lib/migrations/deploymentCellRunbooks.js` manage the record lifecycle. The actual infrastructure moves (Supabase export, Linode provisioning, DNS cutover) are performed manually by the operator.

---

## Runbook A — Shared → Dedicated Managed

**Trigger:** Workflow F with `migration_kind = 'shared_to_dedicated_managed'`

| Step | Action |
|---|---|
| 1 | Operator calls `startMigration(migrationId)` |
| 2 | Create new Supabase project in Managed tier |
| 3 | Export tenant data from shared DB; import to dedicated project |
| 4 | Run validation checklist (`validateMigrationChecklist`) |
| 5 | Operator calls `completeMigration({migrationId, tenantId, targetCellId})` |
| 6 | DNS/Cloudflare cutover to new cell's worker |
| 7 | Post-cutover: decommission old cell slots |

**Rollback window:** 48 h (set `rollback_deadline` at migration creation)

---

## Runbook B — Dedicated Managed → Hybrid (Linode)

**Trigger:** Workflow F with `migration_kind = 'dedicated_managed_to_hybrid'`

| Step | Action |
|---|---|
| 1 | `startMigration(migrationId)` |
| 2 | Provision Linode runtime host |
| 3 | Deploy app containers on Linode |
| 4 | Point Supabase connection strings to new containers |
| 5 | Run read-traffic canary (Cloudflare Traffic Splitting) |
| 6 | `enterValidation(migrationId)` + run checklist |
| 7 | `completeMigration(...)` + full DNS cutover |

---

## Runbook C — Dedicated Managed → Self-Hosted

**Trigger:** Workflow F with `migration_kind = 'dedicated_managed_to_self_hosted'`

Same as Runbook B plus:
- Deploy self-hosted Supabase instance
- Export + import data from Managed Supabase
- Rotate all secrets to point to new self-hosted instance

---

## Runbook D — Rollback (Any)

```javascript
import { rollbackMigration } from '@/lib/migrations/deploymentCellRunbooks';

const { error } = await rollbackMigration({ migrationId, tenantId });
// Blocked after rollback_deadline expires
```

Steps:
1. Verify `rollback_deadline` has not passed (enforced automatically)
2. Revert DNS/Cloudflare to source cell
3. Call `rollbackMigration()` — sets status to `rolled_back`, restores `current_cell_id`
4. Restore any data changes if the data plane was already migrated

---

## Migration State Machine

```
planned → in_progress → validating → completed
                      ↘ rolled_back
                    (failed — manual intervention needed)
```

---

## Validation Checklist (§16.5)

Use `validateMigrationChecklist(counts)` with operator-supplied values:

```javascript
import { validateMigrationChecklist } from '@/lib/migrations/deploymentCellRunbooks';

const { passed, results } = validateMigrationChecklist({
  sourceTenantRowCount: '14523',
  targetTenantRowCount: '14523',
  domainsMatch: true,
  routesResolve: true,
  authWorking: true,
  backgroundJobsWorking: true,
  rlsChecksPass: true,
});

if (!passed) {
  console.error('Validation failed. Do not proceed.', results);
}
```

> [!CAUTION]
> Never call `completeMigration()` unless `validateMigrationChecklist()` returns `passed: true`. If validation fails, either fix the issue and re-validate, or initiate Runbook D (rollback).
