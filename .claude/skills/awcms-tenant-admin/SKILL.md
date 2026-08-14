---
name: awcms-tenant-admin
description: Manage the AWCMS tenant_admin module — the tenant root, the office hierarchy (CRUD + soft-delete/restore), tenant settings, and the one-time setup wizard that bootstraps the first tenant/owner. Use when adding/changing an office or tenant settings endpoint, touching the initial setup flow, or changing the office hierarchy.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — Tenant Admin (office, tenant settings, setup wizard)

Read `src/modules/tenant-admin/README.md` for the full detail of every table and
endpoint — this skill summarises the decisions already made so they are not
re-derived. Schema: `sql/002_awcms_tenant_office_schema.sql` (tenant, office,
tenant_settings), `sql/006_awcms_setup_wizard_schema.sql` (the
`awcms_setup_state` singleton), `sql/020` (composite parent office FK, see
below).

## When to use this skill vs the generic skills

It complements (does not replace) `awcms-new-endpoint`, `awcms-new-migration`,
`awcms-abac-guard` — those are still used for how to build an endpoint/migration/
guard. This skill provides the `tenant_admin`-specific domain context that is not
obvious from merely reading one migration file.

## What already exists — reuse it, do not re-derive

- **`awcms_tenants`** — the multi-tenant root, unique `tenant_code`.
  **Deliberately RLS-free** (there is no `tenant_id` to filter on) — every query
  against this table MUST have an explicit `WHERE id = <tenantId>` in application
  code, RLS does not help here. `awcms_offices`/`awcms_tenant_settings` are
  normal tenant-scoped tables, RLS `ENABLE`+`FORCE`.
- **Setup wizard** (`application/platform-bootstrap.ts`'s
  `bootstrapPlatformTenant`, called by `POST /api/v1/setup/initialize`) — the
  **only place** that creates the tenant, office, owner profile, identity,
  tenant_user, role, and access assignment all at once in ONE transaction,
  spanning the `tenant_admin`, `profile_identity`, AND `identity_access` tables —
  deliberately a standalone composition-root function, not a module
  `dependencies` edge (a static `dependencies` there would wrongly imply that
  `tenant_admin` cannot function at all without the other two modules active).
  Invariant: `awcms_setup_state` (`id boolean PRIMARY KEY DEFAULT true`, no
  `tenant_id`/RLS) is locked PERMANENTLY after one success (`INSERT ... ON
CONFLICT (id) DO NOTHING RETURNING id` — 0 rows = already initialized,
  `outcome: "already_initialized"`); `GET /api/v1/setup/status` (public) returns
  `{ locked: false }` or `{ locked: true, tenantId, lockedAt }`. The `owner` role
  created here is `is_system=true` and is granted ALL rows of
  `awcms_permissions` that exist WHEN bootstrap runs (`SELECT id FROM
awcms_permissions`, not a hardcoded list) — its e2e path is migration →
  `POST /setup/initialize` WITHOUT a module permission-sync in between (see the
  `awcms-abac-guard` skill's "only guard on seeded actions" rule). Do not build a
  second setup path or a partial bootstrap (e.g. only the tenant without an
  owner) — that would leave a tenant nobody has access to.
- **Tenant settings** (`GET/PATCH /api/v1/settings`, guard
  `tenant_admin.tenant_settings.{read,update}`) — 1:1 per tenant, normal RLS
  tenant isolation (unlike `awcms_tenants` itself). `application/
tenant-settings-directory.ts` (`fetchTenantSettings`/`updateTenantSettings`),
  domain `settings-validation.ts`'s `validateUpdateTenantSettingsInput`.
- **Office CRUD** (`GET/POST /api/v1/offices`, `GET/PATCH/DELETE
/api/v1/offices/{id}`, `POST /api/v1/offices/{id}/restore`) — guard
  `tenant_admin.office_management.{read,create,update,delete}`. `GET
/api/v1/offices` is **keyset-paginated** (max 100/page, newest first, an opaque
  `nextCursor`, a corrupt cursor → `400` rather than silently page 1 — the same
  pattern as the `awcms-performance` skill's keyset pagination). The admin
  screen `admin/offices.astro`: create form, per-row inline edit, per-row
  soft-delete, a "Deleted offices" section + a Restore button — all of those
  gates are UX only, the script is bundled externally through `sendJson`/`postJson`
  (`src/lib/ui/admin-form-client.ts`, see the `awcms-ui-screen` skill).
- **No office is `is_system`-protected** — unlike roles (the `awcms-abac-guard`
  skill's `is_system` invariant), the `head_office` office produced by bootstrap
  is NOT exempt from ordinary soft-delete/restore (verified:
  `office-directory.ts` has no `is_system` check or any special protection). If a
  rule like "the last office must not be deletable" is added in the future, that
  is a NEW decision, not something already enforced.

## Office soft-delete + restore (Issue #171) — gotchas you must know

- `DELETE /api/v1/offices/{id}` — guard `office_management.delete`. Soft delete
  (`deleted_at/deleted_by/delete_reason`), **not** a hard delete: the row stays
  restorable and its `office_code` is immediately free for another office to
  reuse (partial unique index `WHERE deleted_at IS NULL`). The body is
  optional/bodyless — a `reason` that is present is stored+audited, an empty
  string `reason` is rejected (not silently stored as `""`). The `delete` audit
  has severity `warning`. 404 when the id does not exist/belongs to another
  tenant/is already deleted.
- `POST /api/v1/offices/{id}/restore` — guard **`office_management.update`**
  (NOT `.delete`, and NOT a separate `restore` action — this activity
  deliberately has no `restore` permission of its own; un-delete is treated as an
  edit to the record's lifecycle, the same authority as editing an ordinary
  office). Idempotent-safe: restoring a row that is already live → `404`.
- **The partial-unique-index-on-restore gotcha**: a restore can return **409
  `OFFICE_CODE_ALREADY_EXISTS`** when another LIVE office has already taken the
  same code while this row was deleted — the partial unique index triggers a
  Postgres `23505` on the restore UPDATE, NOT only on a plain create.
  `restoreOffice` (`office-directory.ts`) deliberately reads the deleted row's
  `office_code` **before** the UPDATE — that value is used for a precise
  `DuplicateOfficeCodeError` message, AND at the same time serves as the
  existence check (a live/absent id → no row read → `404` before writing
  anything). The `23505` is caught **inside** `withTenant` (same pattern as
  `awcms-identifier-masking-notes`/the `awcms-idempotency` skill) — if it were
  caught OUTSIDE `withTenant`, the transaction would already be aborted (`25P02`)
  and the next audit event on the same line of code would fail, turning what
  should be a 409 into a 500. After catching `23505`, do NOT write anything else
  to that same `tx`.
- All three causes of a bad parent office in `createOffice` — it does not exist,
  it belongs to another tenant, it is already soft-deleted — deliberately fail
  **identically** (`ParentOfficeNotFoundError`, one generic message).
  Distinguishing them in the response is exactly the existence oracle this
  advisory closed (see below) — never distinguish them again.

## Composite parent office FK (GHSA-r7cx-c4jh-cvvw) — why not a plain FK

`parent_office_id` used to be just `REFERENCES awcms_offices (id)` — an FK to the
primary key says nothing about tenancy, so an admin of tenant A could send a
`parentOfficeId` belonging to tenant B and get `200 OK` (a hierarchy crossing
tenants, and that field doubled as an existence oracle). **RLS does not help and
genuinely cannot** here — PostgreSQL runs referential integrity checks with the
table owner's rights and **bypasses RLS** (proven to get through even with
`FORCE ROW LEVEL SECURITY` active, `sql/017`); RLS bounds what a query can
`SELECT`, not what a constraint may reference. Two layers, NOT redundant:

1. **The composite FK** `(tenant_id, parent_office_id) → (tenant_id, id)`
   (`sql/020`) — a database-level invariant, in force even when no application
   code is running.
2. **Application validation** (`createOffice` → `fetchOfficeById(tx, tenantId,
parentOfficeId)`) — turns a bad parent into a correct `400` (rather than an FK
   violation → 500), AND rejects an already soft-deleted parent, which no FK can
   express (a soft-deleted row still physically exists).

The rule to preserve if you touch `createOffice`/`updateOffice`: the parent check
**must precede the first write** — `withTenant` COMMITs when its callback returns
normally, so a route that catches an error INSIDE the transaction and then
returns 4xx still **persists** whatever was written before the throw.

## Not available yet (do not assume it exists)

Seeded ABAC policy rows (`awcms_abac_policies` is empty for a new tenant — the
RLS evaluator uses the generic `evaluateAccess` rules), the AsyncAPI events
`tenant.created`/`access.assignment`, roles other than `owner` created
automatically, per-tenant module-management enable/disable (that is a separate
module, see the `awcms-module-management` skill).

## Verification (tests)

Office CRUD + soft-delete/restore + composite-FK cross-tenant rejection +
`OFFICE_CODE_ALREADY_EXISTS` on restore — look for this module's integration
tests (`tests/integration/`) before adding a new scenario, the same
`withTenant`/keyset cursor assert patterns already exist. Setup wizard: run-once
(`already_initialized` on the second call), the owner receives ALL permissions
existing at that moment.

## Related skills

`awcms-new-endpoint`, `awcms-new-migration`, `awcms-abac-guard` (seeded-action
guard + the `is_system` role invariant, not office), `awcms-ui-screen`
(`offices.astro` markup pattern), `awcms-performance` (keyset pagination),
`awcms-module-management` (per-tenant module enable/disable, outside this
module's scope).
