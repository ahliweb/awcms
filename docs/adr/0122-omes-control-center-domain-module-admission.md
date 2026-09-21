🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0122-omes-control-center-domain-module-admission.id.md)

# ADR-0122 — Admission of the OMES Control Center domain module (`omes_control`)

- **Status:** Accepted
- **Date:** 2026-09-22
- **Decision maker:** ahliweb
- **Extends:** [ADR-0011](0011-capability-ports-for-cross-module-collaboration.md), [ADR-0017](0017-document-infrastructure-module-admission.md), [ADR-0051](0051-admin-screens-consolidated-in-awcms.md), [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md), [ADR-0070](0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md), [ADR-0094](0094-a-data-subject-is-answered-per-tenant.md)
- **Related:** OMES Issue ahliweb/omes#196 (parent epic ahliweb/omes#195, migrated from ahliweb/awcms-one#152); `sql/154_awcms_omes_control_schema.sql`; `sql/155_awcms_omes_control_permissions.sql`; `src/modules/omes-control/`

## Context

The OMES project (AhliWeb's infrastructure automation, host compatibility, and service lifecycle platform) requires an operator-facing web control plane ("Control Center") to manage fleets of host servers, worker enrollments, desired vs observed deployments, operation requests, job queues, health telemetry snapshots, backup recovery points, and execution audit projections.

Per the cross-repository architectural authority boundary established in OMES ADR-0017 and AWCMS ADR-0051/0055/0070:

1. Reusable multi-tenant domain models, administrative schemas, Row Level Security (RLS) policies, RBAC/ABAC permissions, and system-admin screens belong canonically in `ahliweb/awcms`.
2. Downstream reference deployments such as `ahliweb/awcms-one` integrate this functionality through a clean `git subtree pull --prefix=apps/cms awcms main` merge without duplicating canonical logic.
3. OMES host execution remains isolated to OMES pull workers; Hermes Agent owns LLM agent runtime and delegation semantics; AWCMS owns the multi-tenant control plane, authorization, and administrative UI.

This ADR records the admission, schema architecture, and security posture of the `omes_control` domain module into `ahliweb/awcms`.

## Architectural Evaluation (11 Criteria)

1. **Advantages and Disadvantages:**
   - _Advantages:_ Pure isolation in `src/modules/omes-control/`. Adheres strictly to AWCMS modular monolith conventions (`defineModule`). Avoids polluting core foundation tables with infrastructure-specific fields.
   - _Disadvantages:_ Requires maintaining schema migrations and data lifecycle descriptors for eight new tables.
2. **Security:**
   - Every tenant-scoped table enforces `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.
   - Access is default-deny, gated by explicit permissions (`omes_control.*`).
   - Runtime uses least-privilege roles (`awcms_app` and `awcms_worker`), never DB superusers.
   - Zero raw secrets in database tables: worker private keys, SSH keys, and provider secrets are prohibited. Only public key metadata, key hashes, and redacted evidence are stored.
3. **Performance:**
   - Every foreign key and tenant lookup column is indexed with composite B-tree indexes (`(tenant_id, ...)`).
   - High-volume tables (`awcms_omes_jobs`, `awcms_omes_health_snapshots`, `awcms_omes_audit_projections`) carry data lifecycle retention descriptors preventing unbounded table growth.
4. **Maintainability:**
   - Uses canonical AWCMS registries: `ModuleDescriptor`, permissions catalogue, `subjectData` / `NO_SUBJECT_DATA`, and `dataLifecycle`.
5. **Scalability:**
   - Multi-tenant partitioning via `tenant_id` and RLS allows seamless scaling across multiple servers and tenants without cross-tenant leakage.
6. **Accessibility:**
   - Navigation and admin screen entry points follow WCAG 2.1 AA and AWCMS design token contrast requirements (`design:token-contrast:check`).
7. **SEO Impact:**
   - None. The module is strictly internal administrative infrastructure within `/admin/*`, authenticated and not indexed.
8. **UI/UX Implications:**
   - Integrates naturally into the existing AWCMS `/admin` sidebar navigation with localized labels and permission gating.
9. **Compatibility:**
   - Uses PostgreSQL 18-compatible DDL, standard UUIDs (`gen_random_uuid()`), and `timestamptz`.
10. **Operational Complexity:**
    - Minimal: uses standard forward-only SQL migrations (`sql/154` and `sql/155`) with no breaking changes to existing tenant data.
11. **Long-Term Technical Implications:**
    - Establishes a durable contract between OMES and AWCMS without blurring operational boundaries.

## Decision

1. **Module Admission:** Register `omesControlModule` under `src/modules/omes-control/module.ts` as a `"domain"` module with key `"omes_control"`.
2. **Schema & Tables:**
   - `awcms_omes_servers`: Fleet inventory and heartbeat timestamps.
   - `awcms_omes_enrollments`: Worker enrollment metadata, public key credentials, and lifecycle status.
   - `awcms_omes_deployments`: Desired vs observed deployment states, drift reconciliation status, and error evidence.
   - `awcms_omes_operation_requests`: Tenant-authorized operation requests with idempotency keys.
   - `awcms_omes_jobs`: Worker job queue and lease tracking.
   - `awcms_omes_health_snapshots`: Point-in-time server health checks and telemetry.
   - `awcms_omes_backup_snapshots`: Backup manifests, sizes, checksums, and verification status.
   - `awcms_omes_audit_projections`: Projection of remote OMES host execution evidence.
3. **RLS & Grants:**
   - All 8 tables carry `tenant_id uuid NOT NULL REFERENCES awcms_tenants(id) ON DELETE CASCADE`.
   - All 8 tables have RLS enabled and forced (`ALTER TABLE ... FORCE ROW LEVEL SECURITY`).
   - Tenant isolation policy: `USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)`.
   - `SELECT`, `INSERT`, `UPDATE`, `DELETE` granted to `awcms_app` and `awcms_worker`.
4. **Permissions Catalogue:**
   - Seeded in `sql/155_awcms_omes_control_permissions.sql` covering servers, deployments, jobs, backups, audit, and enrollments.
5. **Subject Data & Data Lifecycle:**
   - All 8 tables are operational infrastructure records containing no personal data about natural persons, registered in `NO_SUBJECT_DATA`.
   - High-volume tables declare data lifecycle retention descriptors in the module descriptor.
