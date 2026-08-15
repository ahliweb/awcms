🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# Tenant Admin

Tenant root, office hierarchy, tenant settings, and the one-time setup wizard.

## Schema

- `awcms_tenants` — multi-tenant root, unique `tenant_code`, `status` (active/inactive/suspended). **RLS-free** (see `application/tenant-settings-directory.ts` — endpoints must carry an explicit `WHERE id = <tenantId>`).
- `awcms_offices` — per-tenant office hierarchy, unique `(tenant_id, office_code)` while not soft-deleted, RLS tenant isolation, standard soft delete. The hierarchy parent is guarded by a **composite** FK `(tenant_id, parent_office_id) → (tenant_id, id)` (`sql/020`), not an FK to `id` alone — see "Why the FK is composite" below.
- `awcms_tenant_settings` — 1:1 per tenant (timezone, generic feature flags), RLS tenant isolation.
- `awcms_setup_state` — singleton (`id boolean PRIMARY KEY DEFAULT true`, no `tenant_id`/RLS), permanently locking setup after one success.

Schema: `sql/002_awcms_tenant_office_schema.sql`, `sql/006_awcms_setup_wizard_schema.sql`.

## Setup wizard

- `GET /api/v1/setup/status` — public. `{ locked: false }` or `{ locked: true, tenantId, lockedAt }`.
- `POST /api/v1/setup/initialize` — public, once only. One transaction: claim the lock (`INSERT ... ON CONFLICT DO NOTHING`), create the tenant, `SET LOCAL app.current_tenant_id`, tenant_settings, office (`head_office`), owner profile+identity+tenant_user, the `owner` role (`is_system=true`) holding every permission existing at that moment, the owner assignment, then lock `setup_state`. Orchestration in `application/platform-bootstrap.ts`.

## Tenant settings

`GET/PATCH /api/v1/settings` — guard `tenant_admin.tenant_settings.{read,update}`.

## Offices

`GET/POST /api/v1/offices`, `GET/PATCH/DELETE /api/v1/offices/{id}`, `POST /api/v1/offices/{id}/restore` — guard `tenant_admin.office_management.{read,create,update,delete}`.

`GET /api/v1/offices` is **keyset-paginated**: at most 100 rows per page, ordered **newest first**, plus an opaque `nextCursor` (`null` on the last page). A corrupt cursor → `400`, not silently serving page 1.

### Soft-delete + restore (Issue #171)

- `DELETE /api/v1/offices/{id}` — guard `office_management.delete`. Soft delete (`deleted_at/deleted_by/delete_reason`), **not** a hard delete: the row stays restorable and the office code immediately becomes free for reuse (partial unique index `WHERE deleted_at IS NULL`). Body optional/bodyless — a `reason` that is present is stored+audited, an empty `reason` is rejected. Audit `delete` severity `warning`. 404 when the id does not exist/belongs to another tenant/is already deleted.
- `POST /api/v1/offices/{id}/restore` — guard **`office_management.update`** (not `delete`, and not a separate `restore` action: this activity has no `restore` permission, and un-deleting is an edit to the record's lifecycle — the same authority as changing an office). It clears the delete stamps, fills in `restored_at/restored_by`, audits `restore` severity `warning`. Idempotent-safe: restoring again → 404. **409 `OFFICE_CODE_ALREADY_EXISTS`** when another live office has taken that code while it was deleted — the partial unique index triggers 23505 on the UPDATE; it is caught **inside** `withTenant` (with no write afterwards) and mapped to 409, the same rule as `createOffice`.

`restoreOffice` reads the deleted row's `office_code` **before** the UPDATE — to name `DuplicateOfficeCodeError` precisely and to double as the existence check (a live/absent id → no row → 404 before anything is written).

The admin screen `admin/offices.astro`: a **create office** form (gate `.create`), plus **per-row inline edit** (name + status → PATCH, gate `.update`), a per-row **soft-delete** button (gate `.delete`), and a **"Deleted offices"** section with a **Restore** button (gate `.update`). All UI gates are UX only — the authority remains the endpoint guard. The script is bundled externally (CSP-safe), using `sendJson(method,url,body?)` from `admin-form-client.ts` including bodyless DELETE/restore.

### Why the FK is composite (GHSA-r7cx-c4jh-cvvw)

`parent_office_id` used to be `REFERENCES awcms_offices (id)` — an FK to the primary key alone, which says nothing about tenancy. An admin of tenant A could send a `parentOfficeId` belonging to tenant B and get `200 OK`; the hierarchy crossed tenants, and that field simultaneously became an existence oracle (a real id belonging to another tenant → 200, a random uuid → FK violation → 500).

**RLS does not help and genuinely cannot**: PostgreSQL runs referential integrity checks with the table owner's rights and **bypasses RLS** — so the parent lookup behind the FK still sees tenant B's row even though the session is pinned to tenant A. Proven still reachable after `FORCE ROW LEVEL SECURITY` was enabled (`sql/017`). RLS limits what a query can SELECT; it does not limit what a constraint may reference.

Two layers, not redundant:

1. **Composite FK** (`sql/020`) — a database-level invariant, in force even when no application code is running.
2. **Application validation** (`createOffice` → `fetchOfficeById(tx, tenantId, parentOfficeId)`) — turns a bad parent into a correct `400` (rather than an FK violation → 500), **and** rejects a parent that is already soft-deleted, which no FK can express (a soft-deleted row still physically exists).

All three causes of a bad parent — non-existent, belonging to another tenant, already soft-deleted — deliberately fail **identically** (`ParentOfficeNotFoundError` → one and the same message). Distinguishing them in the response is exactly the oracle this advisory closed.

**The rule that must be preserved**: the parent check must precede the first write in `createOffice`. `withTenant` COMMITs when its callback returns normally, so a route that catches an error inside the transaction and then returns 4xx will **persist** whatever was written before the throw. The same goes for `DuplicateOfficeCodeError` (23505 → `409 OFFICE_CODE_ALREADY_EXISTS`): it is caught **inside** `withTenant` so it is not counted by the circuit breaker (`tenant-context.ts` excludes class 23 through an `instanceof PostgresError` check that no longer matches once the error is wrapped), and after it is caught **nothing may be written any more** to `tx` — the transaction has already aborted, an audit event there would fail with 25P02 and turn the 409 into a 500.

## Not yet available

Seeded ABAC policy rows (`awcms_abac_policies` is empty — the evaluator uses the generic rules in `evaluateAccess`), the AsyncAPI events `tenant.created`/`access.assignment`, roles other than `owner`, module-management (per-tenant module enable/disable).
