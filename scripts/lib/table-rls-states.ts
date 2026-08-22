/**
 * The end-state of every `awcms_%` table, folded out of `sql/` (finding D14).
 *
 * This lived in `repo-inventory.ts` — a GENERATOR — and two gates imported it
 * from there: `data-lifecycle:table-coverage:check` and
 * `subject-data:coverage:check`. That is the wrong direction for a dependency
 * to run. A gate that fails because a documentation generator was refactored
 * teaches a reader that the gate is fragile rather than that the code is wrong,
 * and it makes the generator un-editable for a reason nothing in it explains.
 *
 * The generator now imports it too, on the same terms as the gates.
 */
export type TableRlsState = {
  table: string;
  /** The migration file that created it — the answer to "where did this come from". */
  createdIn: string;
  rowLevelSecurity: boolean;
  force: boolean;
};

const CREATE_TABLE =
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z0-9_."]+)/gi;
const DROP_TABLE = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z0-9_."]+)/gi;
const ALTER_RLS =
  /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z0-9_."]+)\s+(ENABLE|DISABLE|FORCE|NO\s+FORCE)\s+ROW\s+LEVEL\s+SECURITY/gi;

function normalizeTableName(raw: string): string {
  return raw
    .replace(/"/g, "")
    .replace(/^public\./, "")
    .toLowerCase();
}

/**
 * Strip `--` line comments and `/* … *​/` block comments before matching, so a
 * commented-out `CREATE TABLE` in a migration header — this repo's migrations
 * are heavily commented, several of them quoting the very DDL they replace —
 * never lands in the inventory as a real table.
 */
export function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/**
 * Fold every migration, in filename order, into the end-state of each
 * `awcms_%` table. Order is load-bearing: a table may be created, have RLS
 * enabled, have FORCE toggled off for a repair and back on, or be dropped
 * outright — and only the last statement about it is true.
 */
export function deriveTableRlsStates(
  files: readonly { name: string; sql: string }[]
): TableRlsState[] {
  const states = new Map<string, TableRlsState>();

  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const sql = stripSqlComments(file.sql);

    for (const match of sql.matchAll(CREATE_TABLE)) {
      const table = normalizeTableName(match[1]!);
      if (!table.startsWith("awcms_") || states.has(table)) continue;
      states.set(table, {
        table,
        createdIn: file.name,
        rowLevelSecurity: false,
        force: false
      });
    }

    for (const match of sql.matchAll(ALTER_RLS)) {
      const table = normalizeTableName(match[1]!);
      const state = states.get(table);
      if (!state) continue;

      const verb = match[2]!.toUpperCase().replace(/\s+/g, " ");
      if (verb === "ENABLE") state.rowLevelSecurity = true;
      else if (verb === "DISABLE") state.rowLevelSecurity = false;
      else if (verb === "FORCE") state.force = true;
      else if (verb === "NO FORCE") state.force = false;
    }

    for (const match of sql.matchAll(DROP_TABLE)) {
      states.delete(normalizeTableName(match[1]!));
    }
  }

  return [...states.values()].sort((a, b) => a.table.localeCompare(b.table));
}
