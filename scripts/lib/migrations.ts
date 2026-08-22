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
 * Every `.sql` file in `sql/`, sorted by filename.
 *
 * Throws when the directory is missing or holds no migrations — see the header
 * for why that must not be an empty list.
 */
export function listMigrationNames(): string[] {
  const names = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

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
