-- Offices: tenant-scope the parent hierarchy FK (GHSA-r7cx-c4jh-cvvw).
--
-- FINDING: `awcms_offices.parent_office_id` was declared
-- `uuid REFERENCES awcms_offices (id)` (sql/002:26) — a FK on the PRIMARY KEY
-- alone, which says nothing about tenancy. `POST /api/v1/offices` passes
-- `parentOfficeId` straight through to the INSERT with no lookup, so an admin
-- of tenant A could name an office id belonging to tenant B and get 200 OK:
-- the hierarchy then spans two tenants, and A's office tree resolves into B's.
-- The same hole doubles as an existence oracle — a real id from another tenant
-- returns 200 while a random uuid returns an FK violation (500), letting an
-- attacker confirm whether any given office id exists platform-wide.
--
-- WHY RLS DOES NOT COVER THIS: PostgreSQL performs referential integrity
-- checks with the privileges of the referenced table's owner and deliberately
-- bypasses row-level security while doing so (the RI triggers run as the
-- owner and RLS is not applied to their queries). So the parent-row lookup
-- behind `REFERENCES awcms_offices (id)` sees B's row even from a session
-- pinned to tenant A, and enabling `FORCE ROW LEVEL SECURITY` on this table
-- (sql/017) did not close it — verified against a populated database, the
-- cross-tenant INSERT still succeeded post-017. RLS restricts what a query
-- can SELECT; it does not restrict what a constraint may reference.
--
-- FIX: make tenancy part of the constraint itself. `UNIQUE (tenant_id, id)`
-- gives the composite FK a target to reference (a FK must point at a unique
-- constraint), and the FK then carries `tenant_id` on both sides, so the
-- referenced row is required to sit in the SAME tenant as the referencing row
-- — a database-level invariant that holds no matter what the application
-- sends, and one no privilege level can talk its way around. The uniqueness
-- itself is free: `id` is already the primary key, so `(tenant_id, id)` cannot
-- collide; the index exists to be referenced, not to add a new rule.
--
-- MATCH SIMPLE (the default) is what we want for the nullable side: when
-- `parent_office_id` IS NULL the constraint is not checked at all, so
-- root offices (the common case) are unaffected. `tenant_id` is NOT NULL, so
-- there is no partial-null case to reason about.
--
-- The application-side guard lands in the same change
-- (`createOffice` now resolves `parentOfficeId` through
-- `fetchOfficeById(tx, tenantId, ...)` before its first write). That guard is
-- what turns a bad parent into a clean 400 instead of an FK violation, and it
-- additionally rejects a SOFT-DELETED parent — something no FK can express,
-- since a soft-deleted row is still physically present. The constraint below
-- is the backstop that holds when the application is bypassed or racing;
-- neither layer is redundant.
--
-- RLS INTERACTION (why FORCE is toggled): `awcms_offices` is `ENABLE`d
-- (sql/002:57) + `FORCE`d (sql/017:33), with a tenant-isolation policy whose
-- USING clause reads `current_setting('app.current_tenant_id')`. `FORCE`
-- applies that policy to the table OWNER too, and `scripts/db-migrate.ts`
-- connects as the owner WITHOUT that GUC set — `current_setting/1` raises
-- rather than returning NULL for an unset parameter, so the cross-tenant
-- cleanup UPDATE below would abort with `unrecognized configuration parameter
-- "app.current_tenant_id"`. Crucially that failure only surfaces where rows
-- exist: on an empty CI database the qual is never evaluated and this passes,
-- then breaks on a populated production one. This cleanup is inherently
-- tenant-wide (there is no single tenant id to SET), so dropping FORCE for its
-- duration is the honest way to say so. Safe because the runner wraps each
-- migration in one transaction and `ALTER TABLE` takes ACCESS EXCLUSIVE — no
-- concurrent session observes the table while FORCE is off. Same pattern as
-- sql/018.

BEGIN;

ALTER TABLE awcms_offices NO FORCE ROW LEVEL SECURITY;

-- Sever parent links that already cross a tenant boundary, so the constraint
-- below can be added to a database that has been running with the hole open.
-- Detaching to NULL (making the office a root) is the only reversible repair:
-- the row belongs to its own tenant and its data is legitimate — only the
-- edge into the other tenant is not — so deleting it would destroy tenant
-- data over an attacker-supplied field, while re-pointing it somewhere else
-- would invent a hierarchy nobody asked for. A detached office is visible and
-- fixable by its tenant admin; a deleted one is not.
UPDATE awcms_offices child
SET parent_office_id = NULL,
    updated_at = now()
WHERE child.parent_office_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM awcms_offices parent
    WHERE parent.id = child.parent_office_id
      AND parent.tenant_id = child.tenant_id
  );

-- FK targets must be UNIQUE. `id` is already the PK, so this adds an index,
-- not a restriction.
ALTER TABLE awcms_offices
  ADD CONSTRAINT awcms_offices_tenant_id_key UNIQUE (tenant_id, id);

ALTER TABLE awcms_offices
  DROP CONSTRAINT IF EXISTS awcms_offices_parent_office_id_fkey;

ALTER TABLE awcms_offices
  ADD CONSTRAINT awcms_offices_parent_office_tenant_fkey
  FOREIGN KEY (tenant_id, parent_office_id)
  REFERENCES awcms_offices (tenant_id, id);

-- Index the FK's own columns (doc 04: every FK is indexed). This supersedes
-- the single-column `awcms_offices_parent_office_idx` from sql/002:54: the
-- referencing side is now `(tenant_id, parent_office_id)`, which is what
-- PostgreSQL scans when checking for dependent children on a parent DELETE,
-- and it is also the shape every application query uses (all office reads are
-- tenant-scoped). The old index is not a prefix of the new one, so it is
-- dropped explicitly rather than left as dead weight.
CREATE INDEX IF NOT EXISTS awcms_offices_tenant_parent_office_idx
  ON awcms_offices (tenant_id, parent_office_id);

DROP INDEX IF EXISTS awcms_offices_parent_office_idx;

ALTER TABLE awcms_offices FORCE ROW LEVEL SECURITY;

COMMIT;
