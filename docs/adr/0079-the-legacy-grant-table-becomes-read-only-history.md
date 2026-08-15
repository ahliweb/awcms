🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0079-the-legacy-grant-table-becomes-read-only-history.id.md)

# ADR-0079 — The legacy grant table becomes read-only history, and all of its readers are made one

- **Status:** Accepted (2026-08-10).
- **Context:** Issue #423 Wave 3 PR 3.3. Migration `sql/103`.
- **Refines:** [ADR-0078](0078-a-grant-carries-its-own-scope.md) — it created
  `awcms_access_policies` and let both tables live side by side; this closes
  that window.

## Decision

Three things, and the third is the most important even though the plan did not
ask for it:

1. **Every `awcms_access_assignments` row is copied into
   `awcms_access_policies` with its `id` PRESERVED**, then `awcms_app` loses
   `INSERT`/`UPDATE`/`DELETE` on the old table. It becomes read-only history:
   its rows stay, `SELECT` stays, nothing writes it any more.
2. **Nothing READS IT for authorization any more.** The `UNION ALL` in
   `fetchGrantedPermissionKeys` collapses into a single source.
3. **The question "what roles does this person hold" has exactly one
   implementation**, `activeRoleGrants` in
   `identity-access/application/grant-source.ts`, and every reader inlines it
   as a subquery.

## Why (2) cannot be deferred to the next PR

The old rows are PRESERVED — that is what makes it "history" and not "a table
that used to contain". But a row that is preserved and STILL COUNTED is a grant
nobody can revoke: revocation now moves a Policy to `revoked`, while the
`DELETE` that used to remove its twin is no longer allowed. Reading and
revoking can never be separated here.

The same consequence hits `subjectHoldsRole`: if it still sees the old rows, a
revoked role can never be granted again — a permanent `409` that no admin can
clear.

## What was actually found: FIVE readers were already stale

PR 3.2 moved every grant WRITER to `awcms_access_policies`. Five readers kept
assembling their own `awcms_access_assignments` join, so for **every tenant
created after that PR** they were answering about a table nobody writes. All of
it silent, and each one wrong in a different way:

| Reader                     | Effect                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `auth-context.ts`          | `TenantContext.roles` empty → `subject.roles` empty in ABAC                                                      |
| `session-introspection.ts` | `GET /api/v1/auth/session` reports the owner WITHOUT roles                                                       |
| `access-directory.ts`      | `/admin/users` shows every user without roles                                                                    |
| `business-scope-facts.ts`  | SoD stops seeing ordinary RBAC grants, and reports "no conflict"                                                 |
| `user-admin.ts`            | The `last_admin_blocked` guard concludes the tenant has no administrator → **the last owner can be deactivated** |

Two of those are not merely a wrong display:

- **An empty `subject.roles` makes DENY policies INERT.** An `allow` policy
  that stops matching is a narrowing (safe); a `deny` policy that stops
  matching is a **widening**, and nobody observes it.
- **A blind last-administrator guard will ALLOW** deactivating the single owner
  — a locked-out tenant with no in-application recovery path.

All thirty-eight gates were green throughout. `bun run check` passed. Unit
tests passed — because each of them asserts a reader against itself. What
nobody did was **write a grant through the real writer and then ASK its
readers**.

That is why the fix is not "fix five queries" but "remove the possibility of
five different queries". A reader now uses `activeRoleGrants` or it is not a
reader; `tests/grant-source-parity.test.ts` locks that statically, and
`tests/integration/grant-readers.integration.test.ts` behaviourally — the
latter is the shape that would have caught it from the start, because a reader
can be pointed at any table whatsoever and still compile.

## An SQL fragment, not a VIEW

A database view would also be one definition, but this repo does not have a
single one yet, and the first one has to answer questions that must not be
answered at the same time as this change: `security_invoker` (without it the
view runs as its OWNER and **bypasses FORCE RLS** on the tables underneath —
isolation is gone and every existing RLS test stays green), its privilege
grants, and what the `security-readiness` table sweep does with a relation that
is not a table.

A fragment needs none of that: the SQL that reaches Postgres is exactly the SQL
its reader would have written, so RLS applies just as before. Bun.SQL inlines a
nested tagged template as SQL (parameters keep their positions), so the query
count does not grow.

## Why `awcms_business_scope_assignments` is NOT included

The program plan said PR 3.3 retires "the two legacy tables". It retires one.

An `awcms_business_scope_assignments` row carries a `role_id` that **grants no
permission key today** — `fetchGrantedPermissionKeys` never reads that table;
only SoD reads it, and only as a fact. Copying those rows into
`awcms_access_policies` would give every scoped subject that role's permissions
**ACROSS THE WHOLE tenant**, because nothing qualifies scope at evaluation time
until PR 3.4. Its `role_id` is also nullable while `awcms_access_policies.role_id`
is not, so a scope-membership row without a role has no shape to become
anything at all.

Retiring it is a decision that belongs AFTER scope qualification, not before
it.

## A side effect found along the way: the setup wizard was already broken

`awcms_setup` (`sql/022`) holds `INSERT` on `awcms_access_assignments`. Since
PR 3.2 moved the bootstrap grant to `awcms_access_policies`, the setup wizard
fails with `permission denied for table awcms_access_policies` in every
deployment that uses `SETUP_DATABASE_URL`.

**No gate could see it**, and the reason is worth recording:
`checkWorkerSetupRoleGrants` asserts that the grants MATCH the declared matrix
— and both sides did still agree with each other. What nobody checked was
whether the matrix matches what the code NEEDS. `sql/103` gives that role
`SELECT, INSERT` on `awcms_access_policies` and `INSERT` on
`awcms_access_policy_events`, and revokes the old `INSERT`.

## A tenant-scoped table that is read-only on purpose must be DECLARED

The `checkRuntimeRoleGrants` default for a tenant-scoped table is all four
verbs, and that default carries weight: a FORCE RLS table that runtime cannot
write is a `permission denied` waiting for the first request, and nothing else
in this repo would say so.

Retirement inverts that expectation, so it is recorded in
`RETIRED_TENANT_TABLE_PRIVILEGES` — the same discipline
`GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` already uses for RLS-free tables, and for
the same reason: the checker must be able to tell "deliberately narrowed" from
"broken", and only a human can supply that difference. Both directions are
enforced, so this is not an escape hatch: a listed table that regains `INSERT`
fails just as hard as an unlisted table that loses `SELECT`.

## The rows that cannot be moved

The `awcms_access_assignments.role_id` FK is single-column, so it cannot
prevent a cross-tenant reference; the composite FK on `awcms_access_policies`
can, and would **abort the entire migration** on one such row. Such a row
grants nothing today either (every reader filters roles by tenant, and RLS
hides them), so leaving it behind changes nobody's access — but the migration
has to survive it, and that is tested against a real database.

What is left behind is counted and named via `RAISE WARNING`. Skipping it
silently would read as "there was nothing to move".

## Consequences

- A live grant has ONE home. The question "where is this grant" stops having
  two answers.
- `access:grant-readers:check` shrinks from eleven files to nine, and
  `awcms_access_assignments` stays in `GRANT_TABLES` precisely so that no file
  is allowed to name it again — its gate message now names `activeRoleGrants`,
  not "add an allow-list entry".
- The deploy order is the usual one (migrations run before the new release
  serves traffic). The release BEFORE this one keeps behaving correctly after
  the migration is installed — its readers see the old rows, which still exist
  and are still accurate; the only statement that will fail is the old `DELETE`
  inside unassign, for the duration of the deploy.
- Retention does not change: history rows do not grow (zero writers), so no new
  lifecycle descriptor needs writing.
