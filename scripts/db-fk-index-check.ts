/**
 * db-fk-index-check.ts — `bun run db:fk-index:check`.
 *
 * Every foreign-key column declared in `sql/` must be reachable by an index.
 * Pure: parses the migration text, never touches a database.
 *
 * ## Why this is the cheapest performance gate worth having
 *
 * Postgres indexes the *referenced* side of a foreign key automatically (it is
 * a unique constraint) and the *referencing* side **not at all**. An unindexed
 * FK column costs twice, and both symptoms arrive late:
 *
 * - every `DELETE`/`UPDATE` of a parent row sequentially scans the child table
 *   to enforce the constraint, on a table that only grows;
 * - the join that every read path takes from parent to child has no index to
 *   use either.
 *
 * Neither shows up in a test. Both show up in production, as "the admin screen
 * got slow" months after the migration landed. The repo assessment of
 * 2026-08-04 found **zero of 28 gates measured performance at all**, and this is
 * the one with the best ratio of cost to caught defects.
 *
 * ## The rule: index-reachable, and why not "must lead"
 *
 * Postgres can only use a B-tree PREFIX, so the strict rule is "the FK column
 * must be the leading column". Measured against this repo that flags **40** of
 * 182 FK columns; the tenant-aware rule below flags **14**.
 *
 * The 26 it drops are all covered by a `(tenant_id, <fk>)` composite, and in
 * this codebase that genuinely serves the read path: every tenant-scoped query
 * carries `tenant_id` (RLS `FORCE` guarantees it), so the composite IS the
 * index those joins use. Demanding 26 further single-column indexes would add
 * real write cost for lookups nobody performs.
 *
 * **The residual, stated rather than hidden:** a `(tenant_id, X)` composite does
 * NOT help Postgres enforce the constraint when a PARENT row is deleted — that
 * needs a bare `X` lookup and will scan. Accepted because parent deletes on
 * these tables are administrative and rare, while the write cost of 26 indexes
 * is paid on every insert forever. If a parent delete ever becomes hot, the
 * answer is an index for that specific table, not a stricter global rule.
 *
 * A gate that demands 40 migrations on the day it lands is a gate that gets
 * exemption-listed into meaninglessness — the failure mode this repo has
 * recorded three times. 14 is a number someone actually fixes.
 *
 * Composite FKs (`FOREIGN KEY (tenant_id, parent_office_id)`) are satisfied by
 * an index reaching the FK's own first column, matching how Postgres enforces
 * them.
 *
 * ## Migrations are cumulative
 *
 * An index added in `sql/072` covers a column declared in `sql/035`, so every
 * file is parsed and the results unioned. Reading one migration in isolation
 * would report a defect that was fixed three files later — the same cumulative
 * trap `repo-inventory.ts` documents for RLS parsing.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const SQL_ROOT = "sql";

/**
 * FK columns deliberately left unindexed, with the reason.
 *
 * The bar is a real one: a column here must be one where the write path is
 * rare AND the table small enough that a scan is genuinely cheaper than the
 * index's maintenance cost. "We did not get to it" is not a reason.
 */
const UNINDEXED_FK_EXEMPTIONS: Readonly<Record<string, string>> = {
  "awcms_setup_state.tenant_id":
    "hard singleton: `id boolean PRIMARY KEY` with `CHECK (id)` means the table holds exactly one row, so an index is pure write overhead against a one-page scan."
};

export type FkColumn = { table: string; column: string };
export type IndexColumns = { table: string; columns: string[] };

/**
 * Parse `CREATE TABLE`/`ALTER TABLE` foreign keys.
 *
 * Two shapes appear in this repo: an inline column definition
 * (`author_id uuid REFERENCES awcms_tenant_users (id)`) and an explicit
 * constraint (`FOREIGN KEY (tenant_id, parent_office_id) REFERENCES ...`).
 */
export function parseForeignKeys(sql: string): FkColumn[] {
  const found: FkColumn[] = [];
  const statements = sql.split(/;\s*$/m);

  for (const statement of statements) {
    const createMatch =
      /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([a-z_][a-z0-9_]*)\s*\(([\s\S]*)/i.exec(
        statement
      );
    const alterMatch = /ALTER TABLE\s+([a-z_][a-z0-9_]*)\b([\s\S]*)/i.exec(
      statement
    );
    const target = createMatch ?? alterMatch;

    if (!target) {
      continue;
    }

    const table = target[1]!.toLowerCase();
    const body = target[2]!;

    // Explicit constraint: the FK's FIRST column is the one Postgres leads on.
    for (const match of body.matchAll(
      /FOREIGN KEY\s*\(\s*([a-z_][a-z0-9_]*)/gi
    )) {
      found.push({ table, column: match[1]!.toLowerCase() });
    }

    // Inline column definition. Anchored to a line start so a column named in
    // prose or in a comment cannot be mistaken for a declaration.
    for (const match of body.matchAll(
      /^\s*(?:ADD COLUMN\s+(?:IF NOT EXISTS\s+)?)?([a-z_][a-z0-9_]*)\s+[a-z][a-z0-9 ()]*?\s+(?:NOT NULL\s+)?REFERENCES\s+[a-z_]/gim
    )) {
      found.push({ table, column: match[1]!.toLowerCase() });
    }
  }

  return found;
}

/** Parse every declared index with its full ordered column list. */
export function parseIndexes(sql: string): IndexColumns[] {
  return [
    ...sql.matchAll(
      /CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+CONCURRENTLY)?(?:\s+IF NOT EXISTS)?\s+[a-z_][a-z0-9_]*\s+ON\s+([a-z_][a-z0-9_]*)\s*(?:USING\s+\w+\s*)?\(([^)]*)\)/gi
    )
  ].map((match) => ({
    table: match[1]!.toLowerCase(),
    // `(tenant_id, lower(slug))` and `(a DESC, b)` both appear — take the bare
    // identifier of each element and stop at the first non-identifier, since an
    // expression index does not serve an equality lookup on a plain column.
    columns: match[2]!
      .split(",")
      .map((part) =>
        part.trim().split(/[\s(]/)[0]!.replace(/"/g, "").toLowerCase()
      )
  }));
}

/** Also treat PRIMARY KEY / UNIQUE constraints as indexes, with their column order. */
export function parseConstraintIndexes(sql: string): IndexColumns[] {
  const indexes: IndexColumns[] = [];

  for (const statement of sql.split(/;\s*$/m)) {
    const target =
      /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([a-z_][a-z0-9_]*)\s*\(([\s\S]*)/i.exec(
        statement
      ) ?? /ALTER TABLE\s+([a-z_][a-z0-9_]*)\b([\s\S]*)/i.exec(statement);

    if (!target) {
      continue;
    }

    const table = target[1]!.toLowerCase();

    for (const match of target[2]!.matchAll(
      /(?:PRIMARY KEY|UNIQUE)\s*\(([^)]*)\)/gi
    )) {
      indexes.push({
        table,
        columns: match[1]!
          .split(",")
          .map((part) => part.trim().replace(/"/g, "").toLowerCase())
      });
    }

    // `col uuid PRIMARY KEY` — inline, single column.
    for (const match of target[2]!.matchAll(
      /^\s*([a-z_][a-z0-9_]*)\s+[a-z][a-z0-9 ()]*?\s+PRIMARY KEY/gim
    )) {
      indexes.push({ table, columns: [match[1]!.toLowerCase()] });
    }
  }

  return indexes;
}

const key = (entry: { table: string; column: string }): string =>
  `${entry.table}.${entry.column}`;

/** Columns an index makes reachable: its leading column, plus the second when the first is `tenant_id`. */
export function reachableColumns(
  indexes: readonly { table: string; columns: readonly string[] }[]
): Set<string> {
  const reachable = new Set<string>();

  for (const index of indexes) {
    const [first, second] = index.columns;

    if (!first) {
      continue;
    }

    reachable.add(`${index.table}.${first}`);

    // Every tenant-scoped query carries `tenant_id`, so `(tenant_id, X)` is the
    // index a lookup on X within a tenant actually uses.
    if (first === "tenant_id" && second) {
      reachable.add(`${index.table}.${second}`);
    }
  }

  return reachable;
}

/** The rule, over already-parsed cumulative sets. */
export function findUnindexedForeignKeys(
  foreignKeys: readonly FkColumn[],
  indexes: readonly IndexColumns[],
  exemptions: Readonly<Record<string, string>> = UNINDEXED_FK_EXEMPTIONS
): string[] {
  const reachable = reachableColumns(indexes);

  return [...new Set(foreignKeys.map(key))]
    .filter((fk) => !reachable.has(fk) && !(fk in exemptions))
    .sort();
}

/** A listed exemption that is now indexed, or no longer an FK, is a stale claim. */
export function findStaleExemptions(
  foreignKeys: readonly FkColumn[],
  indexes: readonly IndexColumns[],
  exemptions: Readonly<Record<string, string>> = UNINDEXED_FK_EXEMPTIONS
): string[] {
  const reachable = reachableColumns(indexes);
  const fks = new Set(foreignKeys.map(key));

  return Object.keys(exemptions).filter(
    (entry) => !fks.has(entry) || reachable.has(entry)
  );
}

async function main(): Promise<void> {
  const files = (await readdir(SQL_ROOT))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const foreignKeys: FkColumn[] = [];
  const indexes: IndexColumns[] = [];

  // Cumulative across every migration, in order — an index added later covers a
  // column declared earlier.
  for (const file of files) {
    const sql = await readFile(path.join(SQL_ROOT, file), "utf8");

    foreignKeys.push(...parseForeignKeys(sql));
    indexes.push(...parseIndexes(sql), ...parseConstraintIndexes(sql));
  }

  const missing = findUnindexedForeignKeys(foreignKeys, indexes);
  const stale = findStaleExemptions(foreignKeys, indexes);

  if (missing.length > 0 || stale.length > 0) {
    console.error("db:fk-index:check FAILED");

    for (const entry of missing) {
      console.error(
        `  - ${entry} is a foreign key no index can reach: it leads no index, and is ` +
          "not the second column of a `(tenant_id, …)` composite either. Every parent " +
          "DELETE/UPDATE scans this table to enforce the constraint, and the join " +
          "through it has no index to use. Add `CREATE INDEX … (column, …)` in a new " +
          "migration, or add a reasoned entry to UNINDEXED_FK_EXEMPTIONS."
      );
    }

    for (const entry of stale) {
      console.error(
        `  - ${entry} is exempted but is now indexed (or no longer a foreign key) — remove the entry.`
      );
    }

    process.exitCode = 1;
    return;
  }

  console.log(
    `db:fk-index:check OK — ${new Set(foreignKeys.map(key)).size} foreign-key columns, ` +
      `every one index-reachable, ${Object.keys(UNINDEXED_FK_EXEMPTIONS).length} exemption(s).`
  );
}

if (import.meta.main) {
  await main();
}
