🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](11_implementation_blueprint.id.md)

# Part 11 — Implementation Blueprint per Sprint

> **Implementation status (2026-07-14).** Adapted from `docs/awcms-mini/11_implementation_blueprint.md`. This `awcms` repo **has not started any sprint yet** — there is no `src/`, `sql/`, module, or implemented skeleton yet (see [ADR-0001](../adr/0001-rebuild-on-awcms-foundation-erp-scope.md)). The whole sprint plan below is a **target plan**, restructured for the **ERP + business integration** scope (not retail/POS like the source document). Sprint numbers and ordering may be adjusted through a separate ADR once the real business priorities are set.
>
> **Domain examples (illustrative).** The patterns & standards are reusable; the entities, endpoints, and domain terms (finance, inventory, procurement, manufacturing, HR/payroll, tax/Coretax, payment gateway, marketplace, logistics) are the target modules of this repo itself — not of a derived application as in awcms-mini.

## Goal

This document is the practical blueprint for building the AWCMS repository skeleton incrementally by sprint, from the modular monolith foundation up to the core ERP modules and external business integrations.

## Blueprint principles

1. Build-first: every sprint keeps the repository buildable.
2. Skeleton-first: create the module descriptor, README, domain, service, repository, route, OpenAPI, migration, test, docs.
3. No fake completion: skeletons carry clear TODOs and are not claimed production-ready.
4. Security-first: tenant context, ABAC, RLS, audit, masking from the start.
5. Soft-delete-first for master/config/draft: query helper, standard columns, and audit from the initial schema.

## Incremental skeleton build flow

```mermaid
flowchart LR
  S1[S1 Foundation<br/>skeleton · migrate · spec · health] --> S2[S2 Tenant/Identity/Profile]
  S2 --> S3[S3 RBAC/ABAC/RLS]
  S3 --> S4[S4 Finance & Accounting]
  S4 --> S5[S5 Inventory & Warehouse]
  S5 --> S6[S6 Logging & Pooling]
  S6 --> S7[S7 Procurement]
  S7 --> S8[S8 Sync & Object Storage]
  S8 --> S9[S9 Manufacturing]
  S9 --> S10[S10 HR & Payroll]
  S10 --> S11[S11 Tax/Coretax]
  S11 --> S12[S12 External Business Integrations]
  S12 --> S13[S13 UI/Reporting/AI]
  S13 --> S14[S14 Workflow/Security/Deploy]
```

Every sprint keeps the repository **buildable**; skeletons carry clear TODOs and are not claimed production-ready.

## Target root structure

```text
awcms/
├── AGENTS.md
├── README.md
├── CHANGELOG.md        # versioning (Changesets)
├── .changeset/         # config + changeset entries
├── .claude/skills/     # Claude Code project skills (not present yet — see doc 10)
├── package.json
├── astro.config.mjs
├── tsconfig.json
├── .gitignore
├── .env.example
├── docker-compose.yml
├── src/
├── sql/
├── scripts/
├── openapi/
├── asyncapi/
├── docs/
├── deploy/
├── tests/
└── fixtures/
```

> When executing a sprint, use the related project skill as soon as it exists (see doc 10 §Supporting skills). Until the skill is created, follow the manual prompt in doc 12.

## Minimal package scripts

```json
{
  "packageManager": "bun@1.4.2",
  "scripts": {
    "dev": "bun --bun astro dev",
    "build": "bun --bun astro build",
    "preview": "bun --bun astro preview",
    "start": "bun ./dist/standalone-entry.mjs",
    "db:migrate": "bun scripts/db-migrate.ts",
    "api:spec:check": "bun scripts/api-spec-check.ts",
    "api:contract:test": "bun scripts/api-contract-test.ts",
    "security:readiness": "bun scripts/security-readiness.ts",
    "production:preflight": "bun scripts/production-preflight.ts",
    "db:pool:health": "bun scripts/db-pool-health.ts",
    "test": "bun test"
  }
}
```

Every script above must be run with Bun. The Astro/Vite bins are invoked through **`bun --bun`** so that Bun is the executor, not whatever `node` binary happens to be installed (their bin shebang is `#!/usr/bin/env node`). The built SSR server is run with `bun ./dist/standalone-entry.mjs` (see doc 10 §Backend platform standards). Do not add `node`, `npm`, `npx`, `pnpm`, or `yarn` as an execution path.

**Note:** the JSON block above is an **illustrative minimal example** for Sprint 1 — there is no real `package.json` in this repo today. The scripts above (`db:migrate`, `api:spec:check`, etc.) are **not implemented yet**; this is the Sprint 1 target, not the current state.

## Minimal `.env.example`

```env
APP_ENV=development
APP_URL=http://localhost:4321
APP_TIMEZONE=Asia/Jakarta
DATABASE_URL=postgres://awcms:awcms_password@localhost:5432/awcms
DATABASE_POOL_MAX=20
AUTH_JWT_SECRET=change-me-in-production
AWCMS_SYNC_HMAC_SECRET=change-me
AWCMS_NODE_ID=local-dev-node
STORAGE_DRIVER=local
LOCAL_STORAGE_PATH=./storage
R2_ENABLED=false
```

> **The block above is the 2026-07-14 plan, not the env contract in force.**
> Two of its lines never materialised: `APP_TIMEZONE` and `AUTH_JWT_SECRET`
> **are read by no code at all** — awcms sessions use an opaque random token
> hashed with sha256 in `awcms_sessions`, not a JWT. The contract in force is in
> [`.env.example`](../../.env.example) and is enforced by
> `scripts/validate-env.ts`; the only required ones are `APP_ENV`, `APP_URL`, and
> `DATABASE_URL`. This block is deliberately left unedited so the record of the original plan stays intact.

The base does not mandate any particular external provider (payment gateway, marketplace, Coretax, logistics). Each business integration adds its own provider flag (default off) — see doc 19 §External business integrations.

## Sprint 1 — Foundation

### Folders/files

```text
src/lib/{errors,logging,database,auth,files,i18n}
src/modules/_shared
src/pages/api/v1/health.ts
sql/001_awcms_foundation_schema.sql
scripts/db-migrate.ts
scripts/api-spec-check.ts
openapi/awcms-public-api.openapi.yaml
asyncapi/awcms-domain-events.asyncapi.yaml
docs/ARCHITECTURE.md
```

The minimal shared foundation also sets up the soft delete convention:

```text
src/modules/_shared/soft-delete.ts
```

Initial contents: the `SoftDeleteColumns` and `ListOptions` types, an `includeDeleted` validation helper, and a TODO for the repository filter `deleted_at IS NULL`.

### Minimal `src/modules/index.ts`

```ts
import type { ModuleDescriptor } from "./_shared/module-contract";

export const modules: ModuleDescriptor[] = [];

export function getModuleByKey(
  moduleKey: string
): ModuleDescriptor | undefined {
  return modules.find((module) => module.key === moduleKey);
}
```

### Minimal health endpoint

```ts
import type { APIRoute } from "astro";
import { ok } from "../../../../modules/_shared/api-response";

export const GET: APIRoute = async () =>
  ok({
    status: "ok",
    service: "awcms",
    timestamp: new Date().toISOString()
  });
```

### Minimal foundation migration

```sql
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS awcms_schema_migrations (
  id bigserial PRIMARY KEY,
  migration_name text NOT NULL UNIQUE,
  checksum text,
  executed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS awcms_modules (
  module_key text PRIMARY KEY,
  module_name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  version text NOT NULL DEFAULT '0.1.0',
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
```

A tenant/domain migration for something soft-deletable must add `deleted_at`, `deleted_by`, `delete_reason`, optionally `restored_at`/`restored_by`, an active index `WHERE deleted_at IS NULL`, and a partial unique index for business codes that may be reused.

### Validation

```bash
bun install
bun run build
bun run db:migrate
bun run api:spec:check
```

## Sprint 2 — Tenant, Identity, Profile

### Modules

```text
src/modules/tenant-admin
src/modules/profile-identity
src/modules/identity-access
```

### API routes

```text
/api/v1/setup/status
/api/v1/setup/initialize
/api/v1/auth/login
/api/v1/auth/logout
/api/v1/auth/me
/api/v1/profiles
/api/v1/profiles/resolve
/api/v1/profiles/{profileId}/links
/api/v1/offices
```

### Migration

- `002_awcms_tenant_identity_schema.sql`
- `003_awcms_central_profile_management_schema.sql`
- `004_awcms_setup_wizard_extension.sql`

### Validation

- Tenant created.
- Owner logs in.
- Profile resolver.
- Identifier masked.
- Setup locked.
- Soft-deleted offices/profiles do not appear in the default list and restore is audited.

## Sprint 3 — RBAC, ABAC, RLS

### Files

```text
src/modules/identity-access/domain/access.ts
src/modules/identity-access/application/access-evaluator.ts
src/modules/identity-access/application/assign-access.ts
src/pages/api/v1/access/modules.ts
src/pages/api/v1/access/evaluate.ts
src/pages/api/v1/access/assignments.ts
tests/access/default-deny.test.ts
```

### Minimal evaluator behavior

- Default deny.
- Deny overrides allow.
- Decision log.
- Tenant context.

## Sprint 4 — Finance & Accounting (General Ledger)

### Module

```text
src/modules/finance-accounting
```

### Routes

```text
/api/v1/finance/accounts
/api/v1/finance/journals
/api/v1/finance/journals/{id}/post
/api/v1/finance/ledger-entries
/api/v1/finance/fiscal-periods
```

### Tables

- Chart of accounts.
- Journal (header).
- Ledger entry (line, append-only once posted).
- Fiscal period (open/closed).

### Validation

- Account unique per tenant.
- Debit = credit per journal.
- Ledger entry append-only, cannot be edited once posted.
- A closed fiscal period rejects new postings.
- Reversal/adjustment for correcting an already-posted entry.

## Sprint 5 — Inventory & Warehouse

### Module

```text
src/modules/inventory-warehouse
```

### Routes

```text
/api/v1/inventory/items
/api/v1/inventory/items/{itemId}
/api/v1/inventory/stock-balances
/api/v1/inventory/stock-movements
/api/v1/inventory/stock-adjustment-requests
/api/v1/warehouses
/api/v1/warehouses/{id}/bins
/api/v1/warehouse-transfers
/api/v1/cycle-counts
```

### Tables

- Item category, unit of measure.
- Items (SKU master).
- Item cost/price.
- Stock balances (per warehouse/bin).
- Stock movements (append-only).
- Warehouse/zone/bin, lot/serial, transfer, cycle count.

### Validation

- SKU unique.
- Item search.
- Item soft delete/restore.
- Opening balance.
- Stock movement append-only.
- Transfer source ≠ destination; ship ≤ approved; receive ≤ shipped.
- Cycle count variance recorded and audited.

## Sprint 6 — Logging & Pooling

### Modules

```text
src/modules/observability-logging
src/modules/database-connectivity
```

### Routes

```text
/api/v1/logs/recent
/api/v1/logs/audit
/api/v1/logs/security
/api/v1/database/pool/health
```

### Validation

- Redaction.
- Correlation ID.
- Audit helper.
- Pool health.
- Pool saturation incident.

## Sprint 7 — Procurement

### Module

```text
src/modules/procurement
```

### Routes

```text
/api/v1/procurement/suppliers
/api/v1/procurement/purchase-requests
/api/v1/procurement/purchase-orders
/api/v1/procurement/purchase-orders/{id}/approve
/api/v1/procurement/goods-receipts
```

### Validation

- A purchase order needs approval before being sent to the supplier.
- A goods receipt does not exceed the outstanding PO.
- A goods receipt triggers an inventory stock movement.
- Three-way match (PO – goods receipt – invoice) before payment is approved.

## Sprint 8 — Sync & Object Storage

### Module

```text
src/modules/sync-storage
```

### Routes

```text
/api/v1/sync/push
/api/v1/sync/pull
/api/v1/sync/status
/api/v1/sync/conflicts
/api/v1/sync/conflicts/{id}/resolve
/api/v1/sync/objects/presign
```

### Validation

- HMAC valid.
- Timestamp anti replay.
- Duplicate event idempotent.
- Manual conflict.
- Checksum verified.

## Sprint 9 — Manufacturing

### Module

```text
src/modules/manufacturing
```

### Routes

```text
/api/v1/manufacturing/bom
/api/v1/manufacturing/work-orders
/api/v1/manufacturing/work-orders/{id}/start
/api/v1/manufacturing/work-orders/{id}/complete
```

### Tables

- Bill of materials (BOM) header + component lines.
- Work order.
- Material consumption (append-only).
- Finished goods output.

### Validation

- BOM components have stock available before the work order starts.
- Material consumption triggers a stock movement (raw material out, finished goods in).
- A work order cannot be completed twice (idempotent).

## Sprint 10 — HR & Payroll

### Module

```text
src/modules/hr-payroll
```

### Routes

```text
/api/v1/hr/employees
/api/v1/hr/attendance
/api/v1/hr/payroll-runs
/api/v1/hr/payroll-runs/{id}/post
/api/v1/hr/payslips/{id}
```

### Validation

- Employee personal data (NIK, bank account number, salary) masked in logs and in non-authorized responses.
- Payroll run post is idempotent and append-only once posted.
- A payslip can only be accessed by the employee it belongs to or by an authorized HR/finance role.
- A posted payroll run triggers a finance ledger entry (salary expense).

## Sprint 11 — Tax & Coretax

### Module

```text
src/modules/tax-coretax
```

### Routes

```text
/api/v1/tax/profiles
/api/v1/tax/business-units
/api/v1/tax/party-profiles
/api/v1/tax/product-profiles
/api/v1/tax/vat-invoices/generate
/api/v1/tax/vat-invoices/{id}/validate
/api/v1/tax/coretax/batches
```

### Validation

- Tax data (NPWP/NIK/NITKU) masked.
- Missing tax data error.
- VAT invoice validation.
- Coretax batch checksum.
- Export approval.

## Sprint 12 — External Business Integrations

### Module

```text
src/modules/business-integrations
```

### Sub-capabilities (provider adapters, not separate top-level modules — see doc 21 §External Integration)

```text
payment-gateway/   # e.g. Midtrans/Xendit-style adapter
marketplace/       # e.g. Tokopedia/Shopee-style channel adapter
logistics/         # e.g. courier/freight tracking adapter
```

### Validation

- Provider credentials come from env, never hardcoded.
- Webhook signature verified before processing.
- Payment callback idempotent.
- Marketplace order sync does not duplicate sales/finance records.
- External providers are not called inside a DB transaction.

## Sprint 13 — UI/UX, Reporting, AI

### Components

```text
src/components/ui
src/components/admin
src/components/reporting
```

### Pages

```text
/admin
/admin/finance
/admin/inventory
/admin/procurement
/admin/manufacturing
/admin/hr
/admin/tax
/admin/reports
```

### Modules

- `ui-experience`
- `management-reporting`
- `ai-analyst`

### Validation

- Admin shell renders.
- Report API.
- AI read-only/no SQL/no PII.

## Sprint 14 — Workflow, Security, Deployment, Handover

### Modules

- `workflow-approval`
- `production-security-readiness`

### Deploy files

```text
deploy/systemd/awcms.service.example
deploy/nginx/awcms.conf.example
deploy/pgbouncer/pgbouncer.ini.example
deploy/backup/backup-postgres.sh
deploy/backup/restore-postgres.sh
```

### Validation

- Workflow approve/reject.
- Self approval denied.
- Security readiness pass/fail.
- Go-live blocked on critical fail.
- Backup/restore scripts.
- Handover docs.

## Test skeleton

```text
tests/access
tests/auth
tests/profile
tests/finance
tests/inventory
tests/procurement
tests/manufacturing
tests/hr-payroll
tests/tax
tests/sync
tests/security
```

## Definition of Skeleton Done

- Main folders present.
- Module contract present.
- Response/error helper present.
- Tenant context helper present.
- Audit helper present.
- Domain event helper present.
- Migration runner present.
- OpenAPI/AsyncAPI baseline present.
- Health endpoint present.
- Build passes.
- Initial docs present.

## Definition of Implementation Ready

- Skeleton done.
- Tenant/profile/auth ready.
- ABAC guard ready.
- RLS context ready.
- Redaction ready.
- Transaction wrapper ready.
- Idempotency wrapper ready.
- OpenAPI contract ready.
- Test skeleton ready.
