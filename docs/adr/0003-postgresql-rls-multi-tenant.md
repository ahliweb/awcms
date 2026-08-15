🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0003-postgresql-rls-multi-tenant.id.md)

# ADR-0003 — PostgreSQL + RLS for multi-tenant isolation

- **Status:** Accepted
- **Date:** 2026-07-05
- **Related:** `docs/awcms/04_erd_data_dictionary.md`, `docs/awcms/16_backend_data_access_integration.md`

## Context

The base is multi-tenant. Relying on a `tenant_id` filter in application code alone is fragile — a single query that forgets to filter can leak data across tenants. We need defense in depth at the database level.

## Decision

We decide to use **PostgreSQL** with **Row Level Security (RLS)** on all tenant-scoped tables: `ENABLE` + `FORCE ROW LEVEL SECURITY` + a `tenant_id = current_setting('app.current_tenant_id')` policy. Tenant context is set per transaction via `SET LOCAL` (`set_config(..., true)`) so it is safe with PgBouncer transaction pooling. Queries still filter `tenant_id` explicitly as the first layer; RLS is the second layer. The production application connection uses a **non-superuser** role (superusers bypass RLS).

## Consequences

- **Positive:** cross-tenant leakage is prevented at the DB level even when the code is wrong; tested with a non-superuser role.
- **Trade-off:** every transaction must set tenant context; every migration must add a policy; there is a little overhead.
- **Neutral:** UUID as PK, `timestamptz`, and `numeric` for money/quantities become derived standards.

## Alternatives considered

- **Isolation in the application only** — rejected: one bug = cross-tenant data leakage.
- **A database per tenant** — rejected: operational and migration cost too high at the base's scale.

## Checklist: using `SECURITY DEFINER` (bootstrap reads before tenant context exists)

RLS + `FORCE` (above) closes off ordinary tenant-scoped access, but some
queries must run **before** any tenant context exists at all (e.g. public
resolution of `hostname`/`tenantCode` -> `tenant_id`). **A real example:** the
`tenant_domain` module (ported from `awcms-micro` epic #555) now exists in this
repo; its lookup resolver `awcms_resolve_tenant_domain_lookup` (`sql/048`) is the
**first `SECURITY DEFINER` function** in `sql/`. Every new `SECURITY DEFINER`
function in this repo must satisfy the following checklist before being
considered safe (including empirical verification against a running DB, not
assumed from the PostgreSQL documentation alone):

1. **Make sure the function owner can genuinely read under `FORCE RLS`.** There
   are TWO valid owner postures: (a) the owner is a real superuser (bypasses RLS
   unconditionally); OR (b) **the owner is a dedicated bootstrap role** `NOLOGIN
NOSUPERUSER NOBYPASSRLS` **with no members**, plus a `FOR SELECT TO
<role> USING (true)` policy scoped to that role (the `sql/048` pattern —
   `awcms_domain_bootstrap`). **IMPORTANT — assuming a "superuser owner" is NOT
   enough** in role-separated/hardened deployments (sql/019–022) and in the
   integration harness, both of which demote the migration owner to `NOSUPERUSER
NOBYPASSRLS` after migrating: there, a `SECURITY DEFINER` function owned by a
   non-superuser role is fully subject to `FORCE RLS` and resolves **0 rows**.
   **Choose (b)** so bootstrap keeps working across postures. The mechanism's
   security does NOT come from the RLS/`FORCE` interaction, but from correct
   ownership + the two guardrails below.
2. **The function body must be static/fixed SQL** — no dynamic SQL/string
   concatenation from parameters. Parameters always arrive through
   parameterized function arguments (`p_<name> text`, etc.), never spliced into
   a query string by hand.
3. **Minimise the columns returned** — only the columns the caller genuinely
   needs; never sensitive columns (token/secret hashes, PII, etc.) unless the
   caller truly needs them and it has been deliberately audited.
4. **`REVOKE ALL ... FROM PUBLIC` then an explicit `GRANT EXECUTE`** to a
   specific role (e.g. `awcms_app`) — PostgreSQL grants `EXECUTE` to
   `PUBLIC` by default on `CREATE FUNCTION`; this is **not** automatically
   covered by migration 013's `ALTER DEFAULT PRIVILEGES` (that clause applies
   only to tables/sequences, not functions/routines).
5. **`SET search_path = public, pg_temp`** (or the relevant specific schema) in
   the function definition — this locks name resolution so it cannot be
   redirected through a caller-controlled `search_path` (the standard
   defense-in-depth measure for `SECURITY DEFINER`, done even when the owner is
   already a superuser).
6. **`STABLE`/`IMMUTABLE`, not the default `VOLATILE`**, for read-only
   functions — reflecting ordinary `SELECT` behaviour to the query planner.
7. **Empirical verification, not assumption** — before considering this
   mechanism safe, prove it directly against a running DB: (a) the function
   resolves rows through the least-privilege role WITHOUT the
   `app.current_tenant_id` GUC being set; (b) a direct `SELECT` on the same
   table from the same role/session (without the function) still returns 0 rows;
   (c) the returned columns are exactly the documented ones, no more.
   `tests/integration/tenant-domain.integration.test.ts` is an example test that
   proves all three (under the `awcms_app` role, with a harness that demotes the
   migration owner — see checklist item 1).
8. **Avoid timing side-channels** — if this function is called and then followed
   by a conditional second query (e.g. "if the first row was found, query
   another table"), consider whether the differing number of round-trips between
   outcomes could be exploited as a side-channel — combine them into one query
   via a `JOIN` when the second table is already RLS-free/publicly readable,
   such as `awcms_tenants` (this pattern is used by the `tenant_domain` resolver
   in `sql/048` — one `JOIN awcms_tenants` so every outcome needs exactly one
   round-trip).
