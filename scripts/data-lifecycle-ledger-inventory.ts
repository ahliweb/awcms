#!/usr/bin/env bun
/**
 * `bun scripts/data-lifecycle-ledger-inventory.ts` — Issue #1501.
 *
 * Prints, for EVERY table on the retention ledger
 * (`TABLES_PREDATING_THE_RULE` in `data-lifecycle-table-coverage-check.ts`),
 * the facts the PII inventory document is written from:
 *
 * - the migration and line that created the table;
 * - its columns (name, type, and the migration:line that declared them),
 *   folded out of `sql/` in filename order (CREATE TABLE, then ADD / DROP /
 *   RENAME COLUMN);
 * - the subject-data classification where one exists (a `subjectData`
 *   descriptor on a module, or a `NO_SUBJECT_DATA` refusal).
 *
 * It exists so the document `docs/awcms/legacy-ledger-pii-inventory.md` can be
 * RECOUNTED, not hand-counted: `--count` prints one number, `--tables` one
 * table per line, and `tests/data-lifecycle-ledger-inventory.test.ts` proves
 * the number equals the ledger's own length and that every table in the
 * document appears exactly once.
 *
 * Read-only and pure: reads `sql/` and the module registry. It changes no
 * ledger, no descriptor, no gate and no data.
 *
 * Usage:
 *   bun scripts/data-lifecycle-ledger-inventory.ts            # full report
 *   bun scripts/data-lifecycle-ledger-inventory.ts --count    # the number
 *   bun scripts/data-lifecycle-ledger-inventory.ts --tables   # names only
 *   bun scripts/data-lifecycle-ledger-inventory.ts --json     # machine form
 */

import { listModules } from "../src/modules";
import { TABLES_PREDATING_THE_RULE } from "./data-lifecycle-table-coverage-check";
import { loadMigrations, type MigrationFile } from "./lib/migrations";
import { NO_SUBJECT_DATA } from "./subject-data-coverage-check";

export type LedgerColumn = {
  name: string;
  type: string;
  /** `NNN_awcms_x.sql:LINE` of the statement that declared the column. */
  source: string;
};

export type LedgerTable = {
  table: string;
  /** `NNN_awcms_x.sql:LINE` of the CREATE TABLE. */
  createdAt: string;
  columns: LedgerColumn[];
  subjectData: {
    key: string;
    ownerModuleKey: string;
    erasure: string;
    subjectColumns: string[];
    anonymizedColumns: string[];
  } | null;
  noSubjectDataReason: string | null;
};

/** Blank out comments but keep every newline, so line numbers stay true. */
export function blankComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/--[^\n]*/g, (m) => " ".repeat(m.length));
}

function normalizeName(raw: string): string {
  return raw
    .replace(/"/g, "")
    .replace(/^public\./, "")
    .toLowerCase();
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** Split on commas at parenthesis depth 0 (and outside single quotes). */
function splitTopLevel(body: string): { text: string; offset: number }[] {
  const parts: { text: string; offset: number }[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === "'") quoted = !quoted;
    if (quoted) continue;
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push({ text: body.slice(start, i), offset: start });
      start = i + 1;
    }
  }
  parts.push({ text: body.slice(start), offset: start });
  return parts;
}

const CONSTRAINT_START =
  /^\s*(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK|LIKE|EXCLUDE)\b/i;

function parseColumnDef(text: string): { name: string; type: string } | null {
  if (CONSTRAINT_START.test(text)) return null;
  const m =
    /^\s*"?([a-z_][a-z0-9_]*)"?\s+([a-z_][a-z0-9_]*(?:\s*\([^)]*\))?(?:\[\])?(?:\s+with(?:out)?\s+time\s+zone)?(?:\s+varying)?)/i.exec(
      text
    );
  if (!m) return null;
  return { name: m[1]!.toLowerCase(), type: m[2]!.replace(/\s+/g, " ").trim() };
}

/** Index of the `)` closing the `(` at `open`. */
function matchParen(text: string, open: number): number {
  let depth = 0;
  let quoted = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "'") quoted = !quoted;
    if (quoted) continue;
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const CREATE_TABLE =
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z0-9_."]+)\s*\(/gi;
const ALTER_TABLE =
  /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([a-z0-9_."]+)\s+([^;]*);/gi;

/** Fold `sql/` into the end-state columns of the wanted tables. */
export function deriveColumns(
  files: readonly MigrationFile[],
  wanted: ReadonlySet<string>
): Map<string, { createdAt: string; columns: LedgerColumn[] }> {
  const out = new Map<string, { createdAt: string; columns: LedgerColumn[] }>();

  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const sql = blankComments(file.sql);

    // Statements are applied in textual order within a file.
    const events: { index: number; run: () => void }[] = [];

    for (const m of sql.matchAll(CREATE_TABLE)) {
      const table = normalizeName(m[1]!);
      if (!wanted.has(table) || out.has(table)) continue;
      const open = m.index! + m[0].length - 1;
      const close = matchParen(sql, open);
      if (close < 0) continue;
      events.push({
        index: m.index!,
        run: () => {
          const body = sql.slice(open + 1, close);
          const columns: LedgerColumn[] = [];
          for (const part of splitTopLevel(body)) {
            const def = parseColumnDef(part.text);
            if (!def) continue;
            const at = open + 1 + part.offset + (part.text.search(/\S/) || 0);
            columns.push({
              ...def,
              source: `${file.name}:${lineOf(sql, at)}`
            });
          }
          out.set(table, {
            createdAt: `${file.name}:${lineOf(sql, m.index!)}`,
            columns
          });
        }
      });
    }

    for (const m of sql.matchAll(ALTER_TABLE)) {
      const table = normalizeName(m[1]!);
      if (!wanted.has(table)) continue;
      const bodyStart = m.index! + m[0].indexOf(m[2]!);
      events.push({
        index: m.index!,
        run: () => {
          const entry = out.get(table);
          if (!entry) return;
          for (const part of splitTopLevel(m[2]!)) {
            const add =
              /^\s*ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(.*)$/is.exec(
                part.text
              );
            if (add) {
              const def = parseColumnDef(add[1]!);
              if (def && !entry.columns.some((c) => c.name === def.name)) {
                entry.columns.push({
                  ...def,
                  source: `${file.name}:${lineOf(sql, bodyStart + part.offset)}`
                });
              }
              continue;
            }
            const drop =
              /^\s*DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?([a-z0-9_]+)"?/i.exec(
                part.text
              );
            if (drop) {
              entry.columns = entry.columns.filter(
                (c) => c.name !== drop[1]!.toLowerCase()
              );
              continue;
            }
            const ren =
              /^\s*RENAME\s+COLUMN\s+"?([a-z0-9_]+)"?\s+TO\s+"?([a-z0-9_]+)"?/i.exec(
                part.text
              );
            if (ren) {
              for (const c of entry.columns) {
                if (c.name === ren[1]!.toLowerCase())
                  c.name = ren[2]!.toLowerCase();
              }
            }
          }
        }
      });
    }

    events.sort((a, b) => a.index - b.index);
    for (const e of events) e.run();
  }

  return out;
}

export function collectLedgerInventory(): LedgerTable[] {
  const ledger = [...TABLES_PREDATING_THE_RULE];
  const derived = deriveColumns(loadMigrations(), new Set(ledger));

  const descriptors = new Map<string, LedgerTable["subjectData"]>();
  for (const mod of listModules()) {
    for (const d of mod.subjectData ?? []) {
      descriptors.set(d.tableName, {
        key: d.key,
        ownerModuleKey: d.ownerModuleKey,
        erasure: d.erasure,
        subjectColumns: [
          ...d.subjectColumns.map((c) => c.column),
          ...(d.subjectVia ? [`via ${d.subjectVia.column}`] : [])
        ],
        anonymizedColumns: [...(d.anonymizedColumns ?? [])]
      });
    }
  }
  const refusals = new Map(NO_SUBJECT_DATA.map((e) => [e.table, e.reason]));

  return ledger.map((table) => {
    const d = derived.get(table);
    return {
      table,
      createdAt: d?.createdAt ?? "(not found in sql/)",
      columns: d?.columns ?? [],
      subjectData: descriptors.get(table) ?? null,
      noSubjectDataReason: refusals.get(table) ?? null
    };
  });
}

function main(): void {
  const arg = process.argv[2] ?? "";
  const tables = collectLedgerInventory();

  if (arg === "--count") {
    console.log(String(tables.length));
    return;
  }
  if (arg === "--tables") {
    for (const t of tables) console.log(t.table);
    return;
  }
  if (arg === "--json") {
    console.log(JSON.stringify(tables, null, 2));
    return;
  }

  for (const t of tables) {
    console.log(`## ${t.table}  (created ${t.createdAt})`);
    if (t.subjectData) {
      console.log(
        `   subjectData: ${t.subjectData.key} erasure=${t.subjectData.erasure} subjectColumns=[${t.subjectData.subjectColumns.join(", ")}] anonymized=[${t.subjectData.anonymizedColumns.join(", ")}]`
      );
    } else if (t.noSubjectDataReason) {
      console.log(`   NO_SUBJECT_DATA: ${t.noSubjectDataReason}`);
    } else {
      console.log("   subjectData: (none)");
    }
    for (const c of t.columns) {
      console.log(`   - ${c.name} ${c.type}  [${c.source}]`);
    }
  }
  console.log(`\n${tables.length} ledger tables`);
}

if (import.meta.main) {
  main();
}
