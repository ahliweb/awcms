🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0130-migration-prefixes-three-or-four-digits-numeric-order.id.md)

# ADR-0130 — Migration prefixes are three or four digits, ordered numerically

- **Status:** Accepted
- **Date:** 2026-10-05
- **Decision maker:** ahliweb
- **Related:** Issue #911; [ADR-0003](0003-postgresql-rls-multi-tenant.md) (RLS; every migration adds its policy); [ADR-0005](0005-soft-delete-and-immutability.md) (applied migrations are immutable); [ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md) (templates are used directly); `scripts/db-migrate.ts`; `scripts/lib/migrations.ts`; `tests/db-migrate-ordering.test.ts`. No earlier ADR recorded the `NNN_awcms_<area>_<description>.sql` naming rule, so this one records the widened rule and amends none.

## Context

The runner accepted only `^\d{3}_awcms_[a-z0-9_]+\.sql$` and applied files in `localeCompare` order. That was correct only while every prefix had the same width. The derived app `ahliweb/awcms-one` reserves `900`–`999` for its commerce module (its ADR-0015) and has exhausted it. A file added later to fill a gap applies in lexical order, so it cannot depend on a higher-numbered table (its ADR-0037 D3). A fourth digit would fix this, but a plain lexical sort puts `1000_…` before `999_…`.

The loader that gates use to fold migrations (`listMigrationNames`, used for example by `deriveTableRlsStates`) had its own sort. A gate that folds in a different order than the runner applies reports an end-state no database ever reached.

## Decision

1. **The prefix is three or four digits**: `^\d{3,4}_awcms_[a-z0-9_]+\.sql$`. Two-digit and five-digit prefixes are still refused with the existing `Invalid migration file name` error.
2. **One ordering, `compareMigrationNames`** in `scripts/lib/migrations.ts`: the numeric value of the leading prefix, then the full name as a tie-break. `scripts/db-migrate.ts` applies with it, and every order-dependent reader of `sql/` folds with it: `listMigrationNames` (and so `deriveTableRlsStates` and the project-state inventory), `db:fk-index:check`, and the cumulative migration tests. Readers that take only the prefix (`check:docs` migration references, `tests/doc-inventory-counts.test.ts`, the inventory's range) read three or four digits, not the first three characters.
3. **Upstream keeps `001`–`899`.** `1000` and above is for the reserved bands of derived apps. The base adds no four-digit file by this decision.
4. **Nothing is renamed.** The ledger `awcms_schema_migrations` is keyed by full name and checksum and is untouched.
5. **One number, one width.** `assertValidMigrationNames` (shared by the runner and `listMigrationNames`) refuses two files whose prefixes have the same numeric value at different widths (`0100_…` and `100_…`): their order would rest on the name tie-break alone.
6. **A test pins it.** `tests/db-migrate-ordering.test.ts` covers the widened pattern, the refusal of two- and five-digit prefixes and of mixed-width duplicates, numeric order across widths, and runner/loader parity; `tests/docs-checks.test.mjs` covers four-digit references.

## Consequences

- **Positive:** a derived app can extend a reserved band past `999` and add files that depend on newer tables; the runner and the gates share one order.
- **Neutral:** every existing name has three digits, and for equal-width names numeric order equals lexical order, so the applied order is unchanged on every database. No migration, endpoint, event or runtime change.
- **Negative:** mixed widths now sort by value, so `1000_…` follows `999_…`. No legacy-order conflict can exist: an older runner rejected four-digit names, so no database holds one applied under the old order. Reusing a number across widths (`0100_…` and `100_…`) is refused rather than left to the tie-break.

## Alternatives considered

- **Patch `db-migrate` downstream in each derived app** — rejected: a standing divergence on the one file every deployment runs.
- **Zero-pad every name to four digits** — rejected: renames change ledger keys and break every applied database.
- **Natural sort via `localeCompare(…, undefined, { numeric: true })`** — rejected: locale-dependent, compares digit runs anywhere in the name, and is less explicit than comparing the prefix.
- **Renumber downstream** — rejected: the same ledger-key problem, in every derived database.
