🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0078-a-grant-carries-its-own-scope.id.md)

# ADR-0078 — A grant carries its own scope

- **Status:** Accepted (2026-08-10). The table already exists and is already read
  by the authorization path; its production writer lands in the next PR (Wave 3
  PR 3.2).
- **Context:** Issue #423 Wave 3 PR 3.1.
- **Supersedes/refines:** none. It widens the grant shape gated by
  [ADR-0063](0063-ownership-grants-run-through-the-authorization-chokepoint.md)
  and sits alongside the business-scope layer of
  [ADR-0060](0060-business-scope-hierarchy-provided-by-tenant-admin.md).

## Decision

A role grant may carry its own **scope**. The new table
`awcms_access_policies` (`sql/102`) stores `subject → role → (scope_type,
scope_id)` along with effective dating, status, and revocation.
`fetchGrantedPermissionKeys` reads **both** grant shapes via `UNION ALL`.

With its new table empty, that function's result is **identical** to before.
That is the property holding up this entire PR.

## Why a NEW table, not a column on `awcms_access_assignments`

Three reasons, and the first one settles it.

**1. It is the old unique index that has to die.**
`awcms_access_assignments_key UNIQUE (tenant_id, tenant_user_id, role_id)`
states "a person holds a role at most once". One role in three scopes is **three
rows**, so that index has to be dropped. Dropping a unique index from a live
authorization table, in the same migration that widens the table's meaning, is a
change with the worst failure mode available here: if it is wrong, it is wrong in
the **permitting** direction, and nothing turns red.

**2. Extending `awcms_business_scope_assignments` in place rewrites two SoD
readers in the same PR.** `business-scope-facts.ts` reads that table twice for
SoD facts. Merging a scope-shape change with an SoD-precision change means
neither of them can be reverted on its own.

**3. A third table enables expand/migrate/contract WITHOUT dual-write.** This
table lands empty, its reader reads both, and PR 3.3 moves rows one at a time.
There is never a window in which a single write must hit two tables and can fail
halfway.

## Why `subject_type` accepts only one value

The programme plan writes `CHECK (subject_type IN ('tenant_user', 'user_group'))`
plus an XOR of two subject columns. User groups **do not exist yet** (Wave 3 PR
3.5), so:

- a CHECK containing `'user_group'` states a capability nothing can produce, and
- a `user_group_id` column without a target table is an unwritable FK.

`sql/100` applies the same discipline to `origin_auth`: its fourth value is one
`DROP CONSTRAINT` / `ADD CONSTRAINT` away from the migration that makes it
producible. The **discriminator** column exists from now precisely so that adding
the value later is not a backfill.

## Why the return type of `fetchGrantedPermissionKeys` has NOT changed yet

The plan makes it `{ keys, scopes }`, because scoped evaluation (PR 3.4) needs
that map. It stays a `Set<string>` here.

Shipping a `scopes` field that nothing reads is exactly the unused-capability
smell [ADR-0077](0077-one-outbox-sync-pull-reads-domain-events.md) removed from
`awcms_sync_outbox` — and it would churn **eleven** call sites in the PR least
able to carry an unrelated diff. The type changes in the PR that consumes it.

**Its name must not change.** `scripts/access-chokepoint-check.ts` anchors the
"this handler decides permission" signal on the literal
`fetchGrantedPermissionKeys(`; a rename leaves that gate **green while reporting
zero deciding handlers**. That is why the same gate also asserts its count is not
zero.

## What each branch filters, and why they differ

Both drop soft-deleted roles. Only the policy branch filters `status` and
effective dating: an assignment row has no lifecycle to filter — it exists or it
does not — whereas a policy can be scheduled, expire, or be revoked.

`effective_to > now()` is evaluated **in the database**, not against a clock sent
by the caller: a grant that has expired according to the application's notion of
time is a grant an application bug can extend. (Note that `now()` in Postgres is
the **transaction start** instant, which is exactly what is wanted here — a
single authorization decision must not see two different times.)

## Cross-tenant isolation

Every subject/role/actor reference is a **composite** FK `(tenant_id, <col>)`,
because PostgreSQL runs referential integrity checks as the **table owner** and
**bypasses** row-level security while doing so — so a bare
`REFERENCES awcms_tenant_users (id)` can still point at another tenant's row even
under FORCE ROW LEVEL SECURITY. The pattern and its reasoning are recorded in
full in the `sql/027` header.

## Consequences

- `awcms_access_policies` enters the `GRANT_TABLES` of the
  `access:grant-readers:check` gate **in the same PR that creates it**, so there
  is never a file assembling a join over it without being recorded.
- Until PR 3.2, the only writer of this table is the integration test. That is
  **not** a state that may be allowed to settle: a table without a writer is the
  defect ADR-0077 removed, and `docs/PROJECT_STATE.md` §4 records 3.1 and 3.2 as
  a single commitment unit precisely because of that.
- `scope_type = 'tenant'` is the only shape written until PR 3.4 qualifies scope
  at evaluation time. Before then, a Policy and an assignment give exactly the
  same answer — which is what lets PR 3.3 move rows without changing a single
  decision.
