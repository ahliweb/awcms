/**
 * Where the migrations are, and how to read them (finding D14).
 *
 * Five scripts declared `const MIGRATIONS_DIR = "sql"` and four of them then
 * wrote the same three lines to load it — `readdirSync`, filter `.sql`, sort by
 * name. Sorting is not incidental: `deriveTableRlsStates` folds the files in
 * filename order and only the LAST statement about a table is true, so a loader
 * that forgot to sort would report an end-state that never existed.
 *
 * The non-empty assertion existed in exactly one of the five
 * (`project-state-inventory.ts`), and it is the reason to have one loader
 * rather than five. Every caller here answers a question of the form "which
 * tables exist, and which of them have RLS forced" — and an EMPTY file list
 * answers all of them with a confident, wrong "none". A gate that walked the
 * wrong directory would go green reporting full coverage of nothing. This repo
 * has shipped that shape of defect before (`check:docs` was blind to newly
 * added documents), which is why the assertion is here, applied to all of them,
 * instead of being a thing four scripts each forgot.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT } from "./repo-files";

/** How the directory is NAMED in messages and documentation. */
export const MIGRATIONS_DIR_NAME = "sql";

/**
 * Resolved from this file's own location, not from the working directory.
 *
 * Five of the six copies this replaces used a bare `"sql"`, so they only worked
 * when invoked from the repository root — and a script run from a subdirectory
 * would have thrown `ENOENT` rather than done the wrong thing, which is the
 * good outcome, but only by luck. The sixth (`sql-grants.ts`) already resolved
 * from `import.meta.dirname`; that is the behaviour kept, because a gate should
 * not depend on where somebody was standing when they ran it.
 */
export const MIGRATIONS_DIR = path.join(REPO_ROOT, MIGRATIONS_DIR_NAME);

export type MigrationFile = {
  /** Filename only, e.g. `046_awcms_tenant_domains_schema.sql`. */
  name: string;
  sql: string;
};

/**
 * Three or four digits (Issue #911, ADR-0130). Upstream keeps `001`–`899`;
 * four-digit space (`1000`+) is for derived applications whose reserved band
 * ran out.
 */
export const MIGRATION_FILE_PATTERN = /^\d{3,4}_awcms_[a-z0-9_]+\.sql$/;

/** The numeric prefix as written, e.g. `"046"` or `"1000"`. */
export function migrationPrefix(name: string): string {
  return /^\d+/.exec(name)?.[0] ?? "";
}

/**
 * Throws on the first name the runner would refuse: one that does not match
 * {@link MIGRATION_FILE_PATTERN}, or one whose prefix has the same numeric
 * value as another file's at a different width (`0100_` and `100_`). The
 * second is refused because the order between them would rest on the name
 * tie-break alone, which says nothing about which was meant to run first.
 */
export function assertValidMigrationNames(names: readonly string[]): void {
  const invalid = names.find((name) => !MIGRATION_FILE_PATTERN.test(name));

  if (invalid) {
    throw new Error(
      `Invalid migration file name: ${invalid}. Use NNN_awcms_<area>_<description>.sql or NNNN_awcms_<area>_<description>.sql.`
    );
  }

  const widthByValue = new Map<number, string>();

  for (const name of names) {
    const prefix = migrationPrefix(name);
    const value = Number.parseInt(prefix, 10);
    const seen = widthByValue.get(value);

    if (seen !== undefined && seen !== prefix) {
      throw new Error(
        `Migration prefixes ${seen} and ${prefix} have the same numeric value (${name}). Use one width per number.`
      );
    }

    widthByValue.set(value, prefix);
  }
}

/**
 * The ONE order migrations are applied and folded in (Issue #911, ADR-0130).
 *
 * By the numeric value of the leading prefix, then by the full name as a
 * tie-break. Plain `localeCompare` was correct only while every prefix had the
 * same width: it puts `1000_…` before `999_…`, so a derived application that
 * outgrew a three-digit band could never add a file that depends on its newest
 * tables. For names of equal width, numeric order IS lexical order, so every
 * existing `NNN_` sequence keeps its byte-identical order.
 *
 * `scripts/db-migrate.ts` applies with this, and {@link listMigrationNames}
 * folds with it — a gate that folded in a different order than the runner
 * applies would report an end-state no database ever reached.
 */
export function compareMigrationNames(left: string, right: string): number {
  return (
    Number.parseInt(left, 10) - Number.parseInt(right, 10) ||
    left.localeCompare(right)
  );
}

/**
 * Every `.sql` file in `sql/`, in {@link compareMigrationNames} order.
 *
 * Throws when the directory is missing or holds no migrations — see the header
 * for why that must not be an empty list — and on any name the runner would
 * refuse ({@link assertValidMigrationNames}), so a gate never folds a file the
 * runner would not apply.
 */
export function listMigrationNames(): string[] {
  const names = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort(compareMigrationNames);

  assertValidMigrationNames(names);

  if (names.length === 0) {
    throw new Error(
      `no migrations in ${MIGRATIONS_DIR_NAME}/ — that cannot be right, and an empty list would make every caller report confident coverage of nothing.`
    );
  }

  return names;
}

/** {@link listMigrationNames}, with each file's contents read. */
export function loadMigrations(): MigrationFile[] {
  return listMigrationNames().map((name) => ({
    name,
    sql: readFileSync(path.join(MIGRATIONS_DIR, name), "utf8")
  }));
}
