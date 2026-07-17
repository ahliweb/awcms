---
"awcms": minor
---

Tenant-scope the office hierarchy FK (GHSA-r7cx-c4jh-cvvw) and fix three
correctness gaps in the office directory (Issue #149).

**Cross-tenant hierarchy (security).** `awcms_offices.parent_office_id` was
declared `REFERENCES awcms_offices (id)` — a FK on the primary key alone, which
says nothing about tenancy — and `POST /api/v1/offices` passed the caller's
`parentOfficeId` straight to the INSERT with no lookup. An admin of tenant A
could therefore name an office id belonging to tenant B and get `200 OK`,
grafting their tree onto another tenant's. It doubled as an existence oracle:
a real id from another tenant returned 200 while a random uuid returned an FK
violation (500), so the field could be used to probe whether any given office
id existed platform-wide.

RLS did not cover this and could not: PostgreSQL runs referential integrity
checks as the referenced table's owner with row-level security bypassed, so the
FK's parent lookup saw the other tenant's row even from a session pinned to
tenant A — verified still exploitable after `FORCE ROW LEVEL SECURITY` landed
in `sql/017`. `sql/020_awcms_offices_tenant_scoped_fk.sql` makes tenancy part
of the constraint instead: `UNIQUE (tenant_id, id)` gives the FK a target, and
the FK becomes `(tenant_id, parent_office_id) REFERENCES (tenant_id, id)`, so
the referenced office must sit in the same tenant as the referencing one — an
invariant no privilege level can talk its way around. `createOffice` now also
resolves the parent through `fetchOfficeById(tx, tenantId, ...)` before its
first write, turning a bad parent into a `400` instead of an FK violation
(500), and making the unknown / other-tenant / soft-deleted cases fail
identically so the oracle closes.

Existing cross-tenant parent links are detached to NULL by the migration
(making those offices roots) rather than deleted: the office rows are the
tenant's own legitimate data, only the edge into the other tenant is not.

**`GET /api/v1/offices` is now keyset-paginated** — previously it returned
every office of the tenant with no `LIMIT` at all, unbounded for a retail
tenant with thousands of outlets. It now returns at most 100 per page plus an
opaque `nextCursor`, via the shared `_shared/keyset-pagination.ts` helper.
**Breaking read-order change:** results are now newest-first
(`created_at DESC`) rather than oldest-first, matching the direction the shared
cursor encodes and every other paginated list in this base. A malformed
`cursor` is rejected with `400` rather than silently serving page 1.

`listOffices` compares its keyset on `date_trunc('milliseconds', created_at)`
rather than bare `created_at`. This is load-bearing, not cosmetic: cursors
carry a JS `Date` (milliseconds) while `timestamptz` stores microseconds, and
the driver floors them on the way out — so a bare comparison excludes every row
sharing the boundary row's millisecond, including rows never shown, which no
later cursor can reach either. Measured before the guard: 105 offices, page 1
returned 100, page 2 returned 4 — one office permanently unreachable.

**Duplicate `officeCode` now returns `409 OFFICE_CODE_ALREADY_EXISTS`** instead
of 500. The unique index (`awcms_offices_tenant_code_key`) already existed; the
`23505` is now translated to a `DuplicateOfficeCodeError` and caught inside
`withTenant`, so it neither surfaces as an unhandled `PostgresError` nor counts
against the shared database circuit breaker. Reusing the code of a
soft-deleted office still works — the index is partial.

**A soft-deleted parent office is now rejected.** No FK can express this (a
soft-deleted row is still physically present), so it rests on the application
check; previously `parentOfficeId` could point at a soft-deleted office and
leave a dangling hierarchy.

Covered by `tests/office-directory-postgres.test.ts` against real PostgreSQL
(gated on `DATABASE_URL`), including a test that asserts the constraint
directly at the database rather than through the application — the FK has to
hold when no application code runs at all.
