/**
 * payroll-sql-boundary-check.ts - `bun run payroll:sql-boundary:check`.
 *
 * Issue #978 audit M2; `docs/awcms/hr-payroll.md` section 13.3.
 *
 * The payroll data boundary (`src/modules/_shared/payroll-data-boundary.ts`)
 * stops a REGISTRY from naming a payroll table. It cannot see a copy made in
 * SQL: a view, a materialised view or a `CREATE TABLE ... AS` over payroll is a
 * second relation under a harmless name that any projection, search source or
 * export may then read, and a trigger on an ordinary table whose function reads
 * payroll moves pay data into that table's side effects.
 *
 * This gate reads `sql/` and fails when:
 *
 * - `CREATE [MATERIALIZED] VIEW x ...` reads a forbidden table and `x` is not
 *   itself on the forbidden list;
 * - `CREATE TABLE x ... AS SELECT ...` reads a forbidden table and `x` is not
 *   itself forbidden;
 * - a trigger on a table that is not forbidden executes a function whose body
 *   reads a forbidden table.
 *
 * "Itself forbidden" is the way out on purpose: a view named
 * `awcms_hr_payroll_summary` is a payroll relation, so every registry gate
 * already refuses it. Pure: reads `sql/`, no database.
 */
import { isPayrollTable } from "../src/modules/_shared/payroll-data-boundary";
import { loadMigrations } from "./lib/migrations";

export type SqlFile = { name: string; sql: string };

const TABLE_TOKEN = /\bawcms_[a-z0-9_]+\b/g;

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function bareName(name: string): string {
  return name.replace(/"/g, "").split(".").pop()!.toLowerCase();
}

function forbiddenTablesIn(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(TABLE_TOKEN)]
        .map((match) => match[0])
        .filter((table) => isPayrollTable(table))
    )
  ];
}

export function findPayrollSqlLeaks(files: readonly SqlFile[]): string[] {
  const failures: string[] = [];
  // Function name -> the forbidden tables its body reads (across all files).
  const functionReads = new Map<string, string[]>();

  for (const file of files) {
    const sql = stripSqlComments(file.sql);

    for (const view of sql.matchAll(
      /CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)([^;]*);/gi
    )) {
      const relation = bareName(view[1]!);
      const read = forbiddenTablesIn(view[2]!);

      if (read.length > 0 && !isPayrollTable(relation)) {
        failures.push(
          `${file.name}: view ${relation} reads ${read.join(", ")} but is not itself a payroll relation. Name it in the payroll family (so the registry gates refuse it) or do not create it.`
        );
      }
    }

    for (const created of sql.matchAll(
      /CREATE\s+(?:UNLOGGED\s+|TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)([^;]*);/gi
    )) {
      const relation = bareName(created[1]!);

      if (!/\bAS\s+(?:SELECT|WITH|TABLE|VALUES)\b/i.test(created[2]!)) continue;

      const read = forbiddenTablesIn(created[2]!);

      if (read.length > 0 && !isPayrollTable(relation)) {
        failures.push(
          `${file.name}: CREATE TABLE ${relation} AS copies ${read.join(", ")} into a table that is not itself a payroll relation.`
        );
      }
    }

    for (const fn of sql.matchAll(
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w."]+)\s*\([\s\S]*?\$(\w*)\$([\s\S]*?)\$\2\$/gi
    )) {
      const read = forbiddenTablesIn(fn[3]!);

      if (read.length > 0) functionReads.set(bareName(fn[1]!), read);
    }
  }

  for (const file of files) {
    const sql = stripSqlComments(file.sql);

    for (const trigger of sql.matchAll(
      /CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+([\w"]+)[\s\S]*?\bON\s+([\w."]+)[\s\S]*?EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+([\w."]+)\s*\(/gi
    )) {
      const table = bareName(trigger[2]!);
      const read = functionReads.get(bareName(trigger[3]!));

      if (read && !isPayrollTable(table)) {
        failures.push(
          `${file.name}: trigger ${bareName(trigger[1]!)} on ${table} runs ${bareName(trigger[3]!)}, whose body reads ${read.join(", ")}. A table that is not itself payroll must not carry payroll reads in its side effects.`
        );
      }
    }
  }

  return failures;
}

function main(): void {
  const files = loadMigrations().map((migration) => ({
    name: migration.name,
    sql: migration.sql
  }));
  const failures = findPayrollSqlLeaks(files);

  if (failures.length > 0) {
    console.error("payroll:sql-boundary:check FAILED -");

    for (const failure of failures) console.error(`  - ${failure}`);

    process.exitCode = 1;
    return;
  }

  console.log(
    `payroll:sql-boundary:check OK - ${files.length} migration(s): no view, CREATE TABLE AS or foreign trigger reads a payroll-boundary table.`
  );
}

if (import.meta.main) {
  main();
}
