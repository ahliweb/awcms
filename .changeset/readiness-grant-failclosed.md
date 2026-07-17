---
"awcms": patch
---

Harden `checkRuntimeRoleGrants` (`bun run security:readiness`) to fail CLOSED
for undeclared global RLS-free tables (Issue #162 / L2, from the PR #161
security audit).

The runtime-role grant check kept two independent structures: an
`RLS_FREE_TABLES` set (read by `checkRlsEnabled`) and a separate
forbidden-privilege map (read by `checkRuntimeRoleGrants`). A future global,
RLS-free table added to the SET to make `checkRlsEnabled` pass but forgotten in
the MAP was `continue`d as "full DML kept by design" and passed silently — the
exact "a new global table inherits blanket DML from `ALTER DEFAULT PRIVILEGES`"
regression this check exists to catch. Non-exploitable today (the 9 tables are
curated correctly) but a latent trap for the next migration.

- The two structures are merged into ONE source of truth
  (`GLOBAL_TABLE_FORBIDDEN_PRIVILEGES`, keyed by table name; `RLS_FREE_TABLES`
  is now derived from its keys). You can no longer register a table in one
  place without the other — every RLS-free table carries an explicit
  privilege declaration. The five module-registry tables that legitimately
  keep full DML get an explicit empty (`[]`) forbidden list — a visible
  "allow", not an implicit default.
- The over-granted direction is now fail-closed: any table treated as RLS-free
  but missing an explicit declaration is asserted to hold ZERO writes. A
  forgotten registration that still holds INSERT/UPDATE/DELETE now FAILS
  `critical` with a "register the privileges awcms_app may hold" message
  instead of passing.

Behaviour on the current, correctly-curated database is unchanged (still PASS).
No schema, API, or event changes. Verified against a fully-migrated PostgreSQL
18 database (sql/001..021): the 9-table default policy still passes, and a
simulated undeclared global table holding blanket DML now fails the check.
