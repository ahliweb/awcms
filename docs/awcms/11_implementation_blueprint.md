# Bagian 11 — Implementation Blueprint per Sprint

> **Status implementasi (2026-07-14).** Diadaptasi dari `docs/awcms-mini/11_implementation_blueprint.md`. Repo `awcms` ini **belum memulai sprint manapun** — belum ada folder `src/`, `sql/`, module, atau skeleton yang diimplementasikan (lihat [ADR-0001](../adr/0001-rebuild-on-awcms-foundation-erp-scope.md)). Seluruh sprint plan di bawah adalah **rencana target**, disusun ulang untuk skop **ERP + integrasi bisnis** (bukan retail/POS seperti dokumen asal). Nomor sprint dan urutan boleh disesuaikan lewat ADR terpisah begitu prioritas bisnis nyata ditetapkan.
>
> **Contoh domain (ilustratif).** Pola & standar-nya reusable; entitas, endpoint, dan istilah domain (finance, inventory, procurement, manufacturing, HR/payroll, tax/Coretax, payment gateway, marketplace, logistik) adalah target modul repo ini sendiri — bukan aplikasi turunan seperti di awcms-mini.

## Tujuan

Dokumen ini menjadi blueprint praktis untuk membuat skeleton repository AWCMS secara bertahap berdasarkan sprint, dari fondasi modular monolith hingga modul-modul ERP inti dan integrasi bisnis eksternal.

## Prinsip blueprint

1. Build-first: setiap sprint menjaga repository tetap buildable.
2. Skeleton-first: buat module descriptor, README, domain, service, repository, route, OpenAPI, migration, test, docs.
3. No fake completion: skeleton diberi TODO jelas dan tidak diklaim production-ready.
4. Security-first: tenant context, ABAC, RLS, audit, masking sejak awal.
5. Soft-delete-first untuk master/config/draft: helper query, kolom standar, dan audit sejak schema awal.

## Alur build skeleton bertahap

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
  S11 --> S12[S12 Integrasi Bisnis Eksternal]
  S12 --> S13[S13 UI/Reporting/AI]
  S13 --> S14[S14 Workflow/Security/Deploy]
```

Setiap sprint menjaga repository tetap **buildable**; skeleton diberi TODO jelas dan tidak diklaim production-ready.

## Target root structure

```text
awcms/
├── AGENTS.md
├── README.md
├── CHANGELOG.md        # versioning (Changesets)
├── .changeset/         # config + changeset entries
├── .claude/skills/     # skill proyek Claude Code (belum ada — lihat doc 10)
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

> Saat mengeksekusi sprint, gunakan skill proyek terkait begitu tersedia (lihat doc 10 §Skill pendukung). Sampai skill dibuat, ikuti prompt manual di doc 12.

## Minimal package scripts

```json
{
  "packageManager": "bun@1.3.14",
  "scripts": {
    "dev": "bun --bun astro dev",
    "build": "bun --bun astro build",
    "preview": "bun --bun astro preview",
    "start": "bun ./dist/server/entry.mjs",
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

Semua script di atas wajib dijalankan dengan Bun. Bin Astro/Vite dipanggil lewat **`bun --bun`** agar Bun yang mengeksekusi, bukan binary `node` yang kebetulan terpasang (shebang bin-nya `#!/usr/bin/env node`). Server SSR hasil build dijalankan `bun ./dist/server/entry.mjs` (lihat doc 10 §Standar platform backend). Jangan menambahkan `node`, `npm`, `npx`, `pnpm`, atau `yarn` sebagai jalur eksekusi.

**Catatan:** blok JSON di atas adalah **contoh minimal ilustratif** untuk Sprint 1 — belum ada `package.json` nyata di repo ini hari ini. Skrip di atas (`db:migrate`, `api:spec:check`, dst.) **belum diimplementasikan**; ini target Sprint 1, bukan kondisi saat ini.

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

Base tidak menetapkan provider eksternal tertentu (payment gateway, marketplace, Coretax, logistik). Setiap integrasi bisnis menambah flag provider-nya sendiri (default off) — lihat doc 19 §Integrasi bisnis eksternal.

## Sprint 1 — Foundation

### Folder/file

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

Shared foundation minimal juga menyiapkan konvensi soft delete:

```text
src/modules/_shared/soft-delete.ts
```

Isi awal: tipe `SoftDeleteColumns`, `ListOptions`, helper validasi `includeDeleted`, dan TODO repository filter `deleted_at IS NULL`.

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

Migration tenant/domain yang soft-deletable harus menambahkan `deleted_at`, `deleted_by`, `delete_reason`, optional `restored_at`/`restored_by`, index aktif `WHERE deleted_at IS NULL`, dan partial unique index untuk kode bisnis yang boleh dipakai ulang.

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

- Tenant dibuat.
- Owner login.
- Profile resolver.
- Identifier masked.
- Setup locked.
- Office/profile soft delete tidak muncul di list default dan restore diaudit.

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
- Ledger entry (line, append-only setelah posted).
- Fiscal period (open/closed).

### Validation

- Akun unique per tenant.
- Debit = kredit per journal.
- Ledger entry append-only, tidak bisa diedit setelah posted.
- Fiscal period closed menolak posting baru.
- Reversal/adjustment untuk koreksi entry yang sudah posted.

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
- Cycle count variance tercatat dan diaudit.

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

- Purchase order butuh approval sebelum dikirim ke supplier.
- Goods receipt tidak melebihi PO outstanding.
- Goods receipt memicu stock movement inventory.
- Three-way match (PO – goods receipt – invoice) sebelum pembayaran disetujui.

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
- Conflict manual.
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

- BOM component tersedia stoknya sebelum work order start.
- Material consumption memicu stock movement (keluar bahan baku, masuk barang jadi).
- Work order tidak bisa complete dua kali (idempotent).

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

- Data pribadi karyawan (NIK, nomor rekening, gaji) masked di log dan response non-authorized.
- Payroll run post bersifat idempotent dan append-only setelah posted.
- Payslip hanya bisa diakses karyawan bersangkutan atau role HR/finance yang berwenang.
- Payroll run posted memicu ledger entry finance (beban gaji).

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

## Sprint 12 — Integrasi Bisnis Eksternal

### Module

```text
src/modules/business-integrations
```

### Sub-kapabilitas (adapter provider, bukan modul top-level terpisah — lihat doc 21 §External Integration)

```text
payment-gateway/   # mis. Midtrans/Xendit-style adapter
marketplace/       # mis. Tokopedia/Shopee-style channel adapter
logistics/         # mis. kurir/ekspedisi tracking adapter
```

### Validation

- Kredensial provider dari env, tidak hardcode.
- Webhook signature diverifikasi sebelum diproses.
- Payment callback idempotent.
- Marketplace order sync tidak menduplikasi sales/finance record.
- Provider eksternal tidak dipanggil di dalam DB transaction.

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

- Admin shell render.
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

- Folder utama tersedia.
- Module contract tersedia.
- Response/error helper tersedia.
- Tenant context helper tersedia.
- Audit helper tersedia.
- Domain event helper tersedia.
- Migration runner tersedia.
- OpenAPI/AsyncAPI baseline tersedia.
- Health endpoint tersedia.
- Build pass.
- Docs awal tersedia.

## Definition of Implementation Ready

- Skeleton done.
- Tenant/profile/auth siap.
- ABAC guard siap.
- RLS context siap.
- Redaction siap.
- Transaction wrapper siap.
- Idempotency wrapper siap.
- OpenAPI contract siap.
- Test skeleton siap.
