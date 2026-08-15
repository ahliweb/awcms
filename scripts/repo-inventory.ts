#!/usr/bin/env bun
/**
 * `docs/awcms/repo-inventory.md`'s inventory tables, derived from the repo.
 *
 * ## Why this exists, and why it is not the whole file
 *
 * The document it fills has been a placeholder since the base was created, and
 * it aged the way placeholders do — while claiming, in a `> GENERATED FILE —
 * jangan diedit manual` banner, to be something it was not. Its body said "Belum
 * ada tabel" and "Belum ada test file" against 118 tables and 288 test files; it
 * gave the migration count as 45 in one paragraph and 89 in another; and it
 * listed 20 modules when the registry held 21. Three different numbers for
 * things a single `ls` answers.
 *
 * So the derivable half is now derived and the prose half is not, exactly as
 * `scripts-inventory.ts` does for `scripts/README.md`: everything between the
 * markers is generated from the registry, `sql/`, `tests/` and `src/pages/`,
 * and the surrounding prose stays human-owned.
 *
 * ## Why the check parses instead of comparing bytes
 *
 * Prettier owns markdown formatting here and pads table columns. A byte
 * comparison would fail immediately after every `bun run lint`, so the check
 * parses the block back into rows and compares CONTENT. Padding is not drift —
 * the same reasoning `scripts-inventory.ts` records for itself.
 *
 * ## Why RLS state is parsed from the migrations, not read from a database
 *
 * This runs inside `bun run check`, which has no database. Reading `pg_class`
 * would make the inventory unavailable exactly where it is most useful (CI, a
 * fresh clone, a review). The parse is CUMULATIVE and order-sensitive because
 * the migrations are: `sql/020` deliberately toggles `NO FORCE` on
 * `awcms_offices` to run a data repair and turns it back on 40 lines later, so
 * a parser that took the first or the last statement alone would report the
 * opposite of the truth for that table. `security-readiness.ts` answers the
 * same question against a live database and stays the authority for
 * deployments; this one answers it for the repo.
 *
 * Two commands, one file: `bun run repo:inventory:generate` rewrites the block,
 * `bun run repo:inventory:check` fails when it is stale.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { listModules } from "../src/modules";
import { routeOf } from "./validate-module-routes";

const DOC_PATH = "docs/awcms/repo-inventory.md";
const BEGIN = "<!-- BEGIN GENERATED: repo-inventory -->";
const END = "<!-- END GENERATED: repo-inventory -->";

const MIGRATIONS_DIR = "sql";
const TESTS_DIR = "tests";
const PAGES_DIR = "src/pages";
const ADR_DIR = "docs/adr";

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

export type ModuleRow = {
  key: string;
  version: string;
  status: string;
  /**
   * `null` when the descriptor declares none. NOT defaulted to `"base"` here:
   * `module-composition.ts` carries a missing `type` through as `null` too, and
   * inventing a value would make this document assert a classification the
   * registry never made.
   */
  type: string | null;
  core: boolean;
  dependencies: string[];
};

export function collectModuleRows(
  modules: readonly {
    key: string;
    version: string;
    status: string;
    type?: string;
    isCore?: boolean;
    dependencies?: readonly string[];
  }[]
): ModuleRow[] {
  return modules.map((module) => ({
    key: module.key,
    version: module.version,
    status: module.status,
    type: module.type ?? null,
    core: module.isCore ?? false,
    dependencies: [...(module.dependencies ?? [])]
  }));
}

// ---------------------------------------------------------------------------
// Migrations + tables/RLS
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests + routes
// ---------------------------------------------------------------------------

export type CountRow = { label: string; count: number };

function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];

  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full);
    }
  };

  walk(dir);
  return out;
}

/**
 * Test files per top-level directory under `tests/`. Only files that a test
 * runner would actually pick up (`*.test.ts`, `*.e2e.ts`) count — fixtures and
 * the harness are support code, and counting them would inflate the one number
 * a reader uses to judge coverage breadth.
 */
export function collectTestCounts(files: readonly string[]): CountRow[] {
  const counts = new Map<string, number>();

  for (const file of files) {
    if (!/\.(test|e2e)\.ts$/.test(file)) continue;
    const relative = path.relative(TESTS_DIR, file);
    const segments = relative.split(path.sep);
    const label = segments.length > 1 ? segments[0]! : "(root)";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Route files under `src/pages`, grouped by the surface a reader cares about:
 * the versioned API, the admin shell, and everything else (public/anonymous).
 */
export function collectRouteCounts(files: readonly string[]): CountRow[] {
  let api = 0;
  let admin = 0;
  let publicRoutes = 0;

  for (const file of files) {
    if (!/\.(ts|astro)$/.test(file)) continue;
    const route = routeOf(file.split(path.sep).join("/"));
    if (route.startsWith("/api/")) api += 1;
    else if (route.startsWith("/admin")) admin += 1;
    else publicRoutes += 1;
  }

  return [
    { label: "`/api/v1/**`", count: api },
    { label: "`/admin/**`", count: admin },
    { label: "publik / anonim", count: publicRoutes }
  ];
}

// ---------------------------------------------------------------------------
// Rendering + parsing
// ---------------------------------------------------------------------------

export type InventoryData = {
  modules: ModuleRow[];
  migrations: string[];
  tables: TableRlsState[];
  tests: CountRow[];
  routes: CountRow[];
  adrCount: number;
};

function renderSummary(data: InventoryData): string {
  const forced = data.tables.filter((t) => t.force).length;
  const rlsFree = data.tables.filter((t) => !t.rowLevelSecurity).length;
  const testFiles = data.tests.reduce((sum, row) => sum + row.count, 0);
  const routeFiles = data.routes.reduce((sum, row) => sum + row.count, 0);

  return [
    "| Aspect | Value |",
    "| ----- | ----- |",
    `| Registered modules | ${data.modules.length} |`,
    `| Migrations | ${data.migrations.length} |`,
    `| \`awcms_*\` tables | ${data.tables.length} |`,
    `| Tables with \`FORCE\` RLS | ${forced} |`,
    `| RLS-free tables (global, by design) | ${rlsFree} |`,
    `| Test files | ${testFiles} |`,
    `| Route files | ${routeFiles} |`,
    `| ADR | ${data.adrCount} |`
  ].join("\n");
}

export function renderInventoryBlock(data: InventoryData): string {
  const sections: string[] = [];

  sections.push("### Summary\n\n" + renderSummary(data));

  sections.push(
    "### Modules\n\n" +
      [
        "| Key | Version | Status | Type | Core | Dependencies |",
        "| --- | ------- | ------ | ---- | ---- | ------------ |",
        ...data.modules.map(
          (module) =>
            `| \`${module.key}\` | ${module.version} | ${module.status} | ${module.type ?? "—"} | ${module.core ? "yes" : "no"} | ${
              module.dependencies.length > 0
                ? module.dependencies.map((dep) => `\`${dep}\``).join(", ")
                : "—"
            } |`
        )
      ].join("\n")
  );

  sections.push(
    "### Migrations\n\n" +
      [
        "| # | File |",
        "| - | ---- |",
        ...data.migrations.map(
          (file, index) => `| ${index + 1} | \`sql/${file}\` |`
        )
      ].join("\n")
  );

  sections.push(
    "### Tables & Row-Level Security\n\n" +
      [
        "| Table | Created in | RLS | FORCE |",
        "| ----- | ---------- | --- | ----- |",
        ...data.tables.map(
          (table) =>
            `| \`${table.table}\` | \`sql/${table.createdIn}\` | ${
              table.rowLevelSecurity ? "yes" : "no"
            } | ${table.force ? "yes" : "no"} |`
        )
      ].join("\n")
  );

  sections.push(
    "### Tests\n\n" +
      [
        "| Directory | Test files |",
        "| --------- | ---------- |",
        ...data.tests.map((row) => `| \`${row.label}\` | ${row.count} |`)
      ].join("\n")
  );

  sections.push(
    "### Routes\n\n" +
      [
        "| Surface | Files |",
        "| ------- | ----- |",
        ...data.routes.map((row) => `| ${row.label} | ${row.count} |`)
      ].join("\n")
  );

  return sections.join("\n\n");
}

/**
 * Parse a rendered block back into its rows — cell content only, padding and
 * alignment discarded. Used by `--check`, which compares this against a fresh
 * render of the same shape.
 */
export function parseInventoryRows(block: string): string[][] {
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"))
    .filter((line) => !/^\|[\s\-|]+\|$/.test(line))
    .map((line) =>
      line
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim())
    );
}

export function extractBlock(markdown: string): string | null {
  const start = markdown.indexOf(BEGIN);
  const end = markdown.indexOf(END);
  if (start === -1 || end === -1 || end < start) return null;
  return markdown.slice(start + BEGIN.length, end).trim();
}

export function replaceBlock(markdown: string, block: string): string {
  const start = markdown.indexOf(BEGIN);
  const end = markdown.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `${DOC_PATH} is missing the "${BEGIN}" / "${END}" markers — the generated block has no home.`
    );
  }

  return (
    markdown.slice(0, start + BEGIN.length) +
    "\n\n" +
    block +
    "\n\n" +
    markdown.slice(end)
  );
}

// ---------------------------------------------------------------------------
// Collection from disk
// ---------------------------------------------------------------------------

export function collectInventory(): InventoryData {
  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  const tables = deriveTableRlsStates(
    migrationFiles.map((name) => ({
      name,
      sql: readFileSync(path.join(MIGRATIONS_DIR, name), "utf8")
    }))
  );

  const adrCount = readdirSync(ADR_DIR).filter(
    (name) => /^\d{4}-/.test(name) && name.endsWith(".md")
  ).length;

  return {
    modules: collectModuleRows(listModules()),
    migrations: migrationFiles,
    tables,
    tests: collectTestCounts(listFilesRecursive(TESTS_DIR)),
    routes: collectRouteCounts(listFilesRecursive(PAGES_DIR)),
    adrCount
  };
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const markdown = readFileSync(DOC_PATH, "utf8");
  const fresh = renderInventoryBlock(collectInventory());

  if (!check) {
    writeFileSync(DOC_PATH, replaceBlock(markdown, fresh), "utf8");
    console.log(
      `Updated: ${DOC_PATH}. Run \`bun run repo:inventory:check\` to verify.`
    );
    return;
  }

  const current = extractBlock(markdown);

  if (current === null) {
    console.error(
      `repo:inventory:check FAILED — ${DOC_PATH} has no generated-block marker.`
    );
    process.exitCode = 1;
    return;
  }

  const currentRows = JSON.stringify(parseInventoryRows(current));
  const freshRows = JSON.stringify(parseInventoryRows(fresh));

  if (currentRows === freshRows) {
    console.log(
      "repo:inventory:check OK — the module/migration/RLS-table/test/route inventory matches the repo."
    );
    return;
  }

  console.error(
    `repo:inventory:check FAILED — ${DOC_PATH} is stale against the repo. ` +
      "Run `bun run repo:inventory:generate`, then `bun run format`."
  );
  process.exitCode = 1;
}

if (import.meta.main) {
  await main();
}
