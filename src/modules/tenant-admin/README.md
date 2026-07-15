# Tenant Admin

Tenant root, office hierarchy, tenant settings, dan setup wizard satu-kali.

## Schema

- `awcms_tenants` — root multi-tenant, unique `tenant_code`, `status` (active/inactive/suspended). **RLS-free** (lihat `application/tenant-settings-directory.ts` — endpoint wajib `WHERE id = <tenantId>` eksplisit).
- `awcms_offices` — hierarki kantor per tenant, unique `(tenant_id, office_code)` selama belum soft-deleted, RLS tenant isolation, soft delete standar.
- `awcms_tenant_settings` — 1:1 per tenant (timezone, feature flag generik), RLS tenant isolation.
- `awcms_setup_state` — singleton (`id boolean PRIMARY KEY DEFAULT true`, tanpa `tenant_id`/RLS), mengunci setup permanen setelah berhasil sekali.

Skema: `sql/002_awcms_tenant_office_schema.sql`, `sql/006_awcms_setup_wizard_schema.sql`.

## Setup wizard

- `GET /api/v1/setup/status` — public. `{ locked: false }` atau `{ locked: true, tenantId, lockedAt }`.
- `POST /api/v1/setup/initialize` — public, hanya sekali. Satu transaksi: klaim lock (`INSERT ... ON CONFLICT DO NOTHING`), buat tenant, `SET LOCAL app.current_tenant_id`, tenant_settings, office (`head_office`), profile+identity+tenant_user owner, role `owner` (`is_system=true`) berisi seluruh permission yang ada saat itu, assignment owner, kunci `setup_state`. Orkestrasi di `application/platform-bootstrap.ts`.

## Tenant settings

`GET/PATCH /api/v1/settings` — guard `tenant_admin.tenant_settings.{read,update}`.

## Offices

`GET/POST /api/v1/offices`, `GET/PATCH /api/v1/offices/{id}` — guard `tenant_admin.office_management.{read,create,update}`. Soft delete belum punya endpoint (belum ada permission `delete` yang di-seed — tambahkan lewat migration terpisah bila dibutuhkan).

## Belum tersedia

Seed ABAC policy row (`awcms_abac_policies` kosong — evaluator memakai aturan generik di `evaluateAccess`), event AsyncAPI `tenant.created`/`access.assignment`, role selain `owner`, module-management (enable/disable modul per tenant).
