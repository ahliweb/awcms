🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0173-payroll-boundary-moves-to-allow-lists-pinned-definer-functions-atomic-bodies-and-table-fingerprints.id.md)

# ADR-0173 — The payroll boundary moves to allow-lists: pinned SECURITY DEFINER functions, read atomic bodies, fingerprinted tables

- **Status:** Accepted
- **Date:** 2026-11-24 (proposed and accepted the same day)
- **Decision maker:** ahliweb (owner). The direction was accepted on 2026-11-22 (decision K3 of #1095); the two open questions were answered on 2026-11-24: **Q1 = A**, **Q2 = A** (see "Owner decisions" below).
- **Related:** Issue [#1436](https://github.com/ahliweb/awcms/issues/1436) (this ADR), [#1095](https://github.com/ahliweb/awcms/issues/1095) (residuals 1 to 7, the scheduled catalog check), [#1077](https://github.com/ahliweb/awcms/issues/1077) and [#1015](https://github.com/ahliweb/awcms/issues/1015) (the catalog layer); [ADR-0132](0132-hr-payroll-module-family-admission.md) (payroll family), [ADR-0147](0147-event-driven-commission-accrual-enters-through-an-intake-queue-posted-by-an-app-role-job.md); `src/modules/_shared/payroll-data-boundary.ts`, `scripts/lib/payroll-catalog-boundary.ts`, [`docs/awcms/hr-payroll.md`](../awcms/hr-payroll.md) section 13.3.

## Context

The payroll data boundary has two layers. The static layer reads migration text; the catalog layer reads `pg_catalog` of a migrated database (CI, release, and daily against the deployed database as `payroll:catalog-boundary:job`). Both are **deny-lists**: they look for a payroll name, a payroll row type, a dynamic `EXECUTE`, a helper that reads a relation by string, and refuse what they find. #1095 left seven residuals "narrowed, not closed". Three of them have the same root: the check tries to prove that something is harmless, and a determined author can always build something the proof does not model.

1. **SECURITY DEFINER outside the family.** A non-family `SECURITY DEFINER` function runs with its owner's rights. If the owner can read payroll, the function can, and the scans decide by reading its body. A body that names nothing (a string assembled elsewhere, a helper not yet on the list) passes.
2. **SQL-standard bodies.** A `BEGIN ATOMIC` (or `RETURN expr`) body is stored parsed in `prosqlbody`; `prosrc` is empty. The catalog layer read `prosrc`, so every body rule saw an empty string. Only the relation dependencies in `pg_depend` were read; a call to a payroll-family function or to another leaking function was not.
3. **Required tables identified by name.** The catalog asserts the required tables exist under their names, carry their marker and triggers, and that no other relation shares 70% of their columns (same name and type). A rebuild that renames more than 30% of the columns, or a required trigger recreated under its own name with a different function or fewer events, passed.

## Decision

The three are replaced by **allow-lists**: the check no longer proves a thing harmless, it requires the thing to be a reviewed, pinned entry.

### 1. Non-family SECURITY DEFINER functions in payroll's reach are allow-listed

A non-family `SECURITY DEFINER` function, **extension members included**, is **in reach** when its owner is, directly or through role membership (transitively, `NOINHERIT` not modelled, so fail-closed), one of: the owner of a payroll relation or family function; the owner of the migration ledger; a role in `PAYROLL_EXPECTED_OWNERS`; a grantee on a payroll relation; an EXECUTE grantee of a family `SECURITY DEFINER` function (`PUBLIC` there puts every owner in reach); `pg_read_all_data`, `pg_write_all_data`, `pg_maintain`, `pg_execute_server_program`, `pg_read_server_files`, `pg_write_server_files`; a superuser, `BYPASSRLS` or `REPLICATION` role.

Such a function is a finding (`security-definer-not-allow-listed`) unless it is an entry of `PAYROLL_SECURITY_DEFINER_ALLOWLIST`:

```ts
"public.awcms_x_fn(p_tenant_id uuid)": {
  reason: "why it needs payroll-reaching rights (40+ characters)",
  approvedIn: "#NNNN",              // or "ADR-NNNN"
  owner: "awcms_x_owner",           // never awcms_app or awcms_worker
  definitionSha256: "<64 hex>",     // functionDefinitionSha256 of what was reviewed
  executeGrantees: ["awcms_x_owner", "awcms_app"]
}
```

- **Shape.** The key is `schema.name(identity arguments)` exactly as `pg_get_function_identity_arguments` prints it, so an overload is a separate entry. The entry **pins** the reviewed object: its owner; `definitionSha256`, the digest of the whole definition except owner and ACL (body as the catalog returns it, language, kind, volatility, strictness, leakproofness, `SECURITY DEFINER`, return type, arguments and every `SET` clause); and the exact set of EXECUTE grantees. Any difference (a new body, `RESET search_path`, `GRANT EXECUTE ... TO PUBLIC`, a new owner) is `security-definer-allowlist-drift`; a key whose function is gone, or no longer `SECURITY DEFINER`, is reported stale and fails the check. The registry is validated at load (key form, reason, review reference, non-runtime owner, digest form, grantees named).
- **Only route.** `PAYROLL_CATALOG_EXEMPTIONS` does not silence this rule or the two below; an exemption says "this object may read payroll", an allow-list entry says "this exact definition, owned by this role, executable by these roles, was reviewed".
- **The way out that needs no entry** is the repository's existing convention: own the function with a dedicated `NOLOGIN` role that holds no payroll privilege. Every one of the 26 non-family `SECURITY DEFINER` functions in `sql/` today does, and no extension member is a definer, so the allow-list ships **empty**.

### 2. SQL-standard bodies are analysed like any other body

The catalog loader reads `pg_get_function_sqlbody(oid)` when `prosqlbody` is set, and records the function's `pg_depend` edges to other functions. A recorded edge counts as a call, for the family-call rule and for the transitive chain. A SQL-standard body that comes back empty fails closed (`function-body-unreadable`). The static layer already scanned such bodies as text, and now also refuses `CREATE OR REPLACE TRIGGER` on a payroll table or a required trigger.

A deparsed atomic body is produced by the server's deparser, not stored verbatim, so its digest in an allow-list entry can change across a PostgreSQL major-version upgrade. That is fail-closed (the entry turns into drift and is re-pinned after review) and can be noisy; no atomic definer is listed today.

### 3. Required payroll tables are pinned by a fingerprint

`PAYROLL_REQUIRED_TABLE_FINGERPRINTS` holds, per required table:

- every column as `name:type`;
- every required trigger with its function, `tgtype` bitmask and `functionSha256` (the `functionDefinitionSha256` of the trigger function, so a guard whose body was replaced by a no-op, or whose `SET search_path` was dropped, is drift). A required trigger must also have **no `WHEN` clause, no `UPDATE OF` list, no arguments, and not be deferrable or a constraint trigger**; unknown is drift;
- every foreign key with target, referencing columns, referenced columns and `ON UPDATE` / `ON DELETE` actions; it must be **enforced, validated and not deferrable** (`ALTER CONSTRAINT ... NOT ENFORCED` is drift);
- a `nameFreeTolerance`.

- **Drift** (`payroll-fingerprint-drift`): the table under its family name differs from its fingerprint. A migration that changes a required table, or replaces one of its trigger functions, updates the fingerprint in the same PR, exactly as `PAYROLL_REQUIRED_TABLES` is updated today. `PAYROLL_REQUIRED_TRIGGERS` and `PAYROLL_REQUIRED_FOREIGN_KEYS` are derived from the fingerprints, so there is one list.
- **Match** (`payroll-fingerprint-match`): a non-family relation that **lacks** at most `nameFreeTolerance` of a fingerprint's column **types** (a multiset, names ignored, a DOMAIN counted as its base type) is that table under another name. The measure is one-sided: extra columns on the candidate do not count, so padding a copy does not hide it. The ledger's tolerance is 2; the nearest ordinary relation in the migrated catalog lacks 5, and an integration test keeps the margin above twice the tolerance, so a new module whose table comes too close fails CI and the tolerance is revisited in review instead of silently.
- The transition log has **no** name-free tolerance (`null`): its nine generic columns are fully contained in several ordinary event tables. It stays held by its foreign key to the ledger (`dependent-on-payroll`), its trigger, and the 70% look-alike rule, which is kept.

## Owner decisions (2026-11-24)

- **Q1. Who may add an entry to `PAYROLL_SECURITY_DEFINER_ALLOWLIST`? Decided: A.** Any PR, approved by one maintainer under the security review GOVERNANCE.md section "Decision making" item 3 already requires for a security change; the entry names the issue in `approvedIn`, and the PR body shows the function's definition and why a dedicated owner role is not possible. Rejected: an ADR per entry with two maintainers (B), and an extra CODEOWNERS reviewer line (C) while CODEOWNERS is still a placeholder.
- **Q2. How wide is "reach"? Decided: A.** Owner-based reach as defined in Decision 1. A non-family `SECURITY DEFINER` function owned by a role with no payroll privilege is not listed: it cannot read payroll whatever its body says, and a later grant to that role is itself a `payroll-grant` finding. Rejected: listing every non-family definer (B), which would start with 26 entries that protect nothing payroll-related.

## Known gaps (recorded here, not as public issues)

- A `SECURITY DEFINER` function **with a payroll-family name** passes rule 1 by its name: it is a family function, held by the family rules (grants, owner, EXECUTE allow-list for the worker), not by this allow-list.
- `GRANT SET ON PARAMETER session_replication_role` to a runtime role is not visible to the catalog layer (the static layer refuses `SET session_replication_role` in a migration).
- `NO FORCE` / `DISABLE ROW LEVEL SECURITY` on a payroll table raises no catalog finding; other RLS gates own it.
- A rebuild that drops more than the tolerance of the ledger's column types, or a renamed copy of the transition log without its foreign key, is still only detected by the remaining heuristics. Logical replication slots, extension objects other than definers, and a superuser stay outside, as before.

## What this does not change

- Review of every `sql/` change that touches payroll remains the primary control; this makes the catalog check stricter, it does not make it a proof.
- No migration, no API, no event, no new role. The checks run where they already run.

## Consequences

- A migration that adds a `SECURITY DEFINER` function owned by the migration role (the default when no `ALTER FUNCTION ... OWNER TO` follows) now fails the catalog check in CI. The fix is the existing convention: a dedicated owner role.
- A migration that changes a column, trigger, trigger function or foreign key of a required payroll table must update `PAYROLL_REQUIRED_TABLE_FINGERPRINTS` in the same PR.
- The daily job reports the new codes like any other finding; no operator action is needed.

## Evidence

Every rule was proven by mutation: each control was broken in the analyser and the unit tests and the integration tests against a migrated catalog went red (numbers in the PR of #1436, including the independent audit's follow-ups H1, M1 to M4 and L1 to L3). Probes in `tests/fixtures/payroll-boundary-probes.ts` (`adr0173-*`, `audit1436-*`) and the "ADR-0173 allow-lists" block of `tests/integration/payroll-catalog-boundary.integration.test.ts`; unit tests in `tests/payroll-allow-lists-1436.test.ts`.
