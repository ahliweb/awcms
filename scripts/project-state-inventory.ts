#!/usr/bin/env bun
/**
 * The `docs/PROJECT_STATE.md` §2 inventory table, derived from the repo.
 *
 * ## Why this exists
 *
 * That table went stale FOUR times, three of them on the same rows, each time
 * with `bun run check` green. The document's own §2 blockquotes record the
 * history and reach the conclusion this script implements: "pola ini tidak
 * akan berhenti dengan menuliskan angka yang lebih baru; ia berhenti hanya
 * bila tabel ini di-generate". Episode four (changesets 100→101, commits
 * 108→113, the ADR row stopping at `0067` after `0068` was Accepted) is the
 * one that finally paid for the generator.
 *
 * ## What is generated and what was deleted instead
 *
 * SLOW rows — numbers that move once per PR at most — are generated between
 * the markers: package.json version, module count, migration count/range,
 * highest ADR + its status, admin screens + modules without `navigation:`,
 * `.astro` file/line counts, `check`-chain gate count, and
 * `MODULE_CONTRACT_VERSION`.
 *
 * FAST rows — pending changesets per bump type, commits since the last
 * release tag — move on EVERY commit. Generating them would force every PR to
 * regenerate this document; writing them by hand is how the table rotted four
 * times. So their number cells are gone: the cell now says to run the command
 * in the right-hand column, and the command itself is generated (the
 * `git rev-list` range follows the current version). This is the document's
 * own proposal — "di-generate ATAU dihapus dari tabel" — taking the second
 * branch for the rows where the first branch is a treadmill.
 *
 * ## Why the check parses instead of comparing bytes
 *
 * Prettier owns markdown formatting here and pads table columns. A byte
 * comparison would fail after every `bun run lint`, so the check parses the
 * block back into rows and compares CONTENT — same reasoning as
 * `repo-inventory.ts` and `scripts-inventory.ts`. The split is escape-aware
 * because one source-of-truth cell legitimately contains `\|` inside a shell
 * pipeline.
 *
 * Two commands, one file: `bun run project-state:inventory:generate` rewrites
 * the block, `bun run project-state:inventory:check` fails when it is stale.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { listModules } from "../src/modules";
import { MODULE_CONTRACT_VERSION } from "../src/modules/_shared/module-contract";

const DOC_PATH = "docs/PROJECT_STATE.md";
export const BEGIN = "<!-- project-state-inventory:mulai -->";
export const END = "<!-- project-state-inventory:selesai -->";

const MIGRATIONS_DIR = "sql";
const ADR_DIR = "docs/adr";
const MODULES_DIR = "src/modules";
const SRC_DIR = "src";
const ADMIN_PAGES_DIR = "src/pages/admin";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export type ProjectStateInventory = {
  /** `package.json` version — also names the release tag the fast rows diff against. */
  version: string;
  moduleCount: number;
  migrationCount: number;
  /** Three-digit prefixes of the first and last migration, e.g. "001"/"090". */
  migrationFirst: string;
  migrationLast: string;
  /** Four-digit prefixes of the lowest and highest ADR, e.g. "0000"/"0068". */
  adrLowest: string;
  adrHighest: string;
  /** The `- **Status:** …` value of the highest ADR — "the last word so far". */
  adrHighestStatus: string;
  adminScreenCount: number;
  /** Module keys whose `module.ts` has no `navigation:` — `grep -L` in TypeScript. */
  modulesWithoutNavigation: string[];
  astroFileCount: number;
  /** Newline count across all `.astro` files — matches `wc -l`. */
  astroLineCount: number;
  /** Segments of `scripts.check` split on `&&` — the gate count the table cites. */
  checkGateCount: number;
  contractVersion: string;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** `22328` → `"22.328"` — Indonesian thousands separator, as the prose uses. */
export function formatRibuan(value: number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Gate count = segments of the `check` chain when split on `&&`. */
export function countCheckGates(checkScript: string): number {
  return checkScript
    .split("&&")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0).length;
}

/**
 * Extract the `- **Status:** Accepted` value from an ADR body. Returns `null`
 * rather than guessing when the line is absent — an invented status in a
 * generated table would be worse than a missing one.
 */
export function parseAdrStatus(markdown: string): string | null {
  const match = markdown.match(/\*\*Status:\*\*\s*([^\n]+)/);
  return match ? match[1]!.trim() : null;
}

// ---------------------------------------------------------------------------
// Rendering + parsing
// ---------------------------------------------------------------------------

const FAST_ROW_CELL = "_run the command in the right-hand column_";

export function renderInventoryBlock(data: ProjectStateInventory): string {
  const navi =
    data.modulesWithoutNavigation.length === 0
      ? `**0 of ${data.moduleCount}** modules without \`navigation:\``
      : `**${data.modulesWithoutNavigation.length} of ${data.moduleCount}** modules without \`navigation:\` (${data.modulesWithoutNavigation
          .map((key) => `\`${key}\``)
          .join(", ")})`;

  const rows = [
    ["Aspect", "Value (generated)", "Source of truth"],
    ["---", "---", "---"],
    ["Version", `**${data.version}**`, "`package.json`"],
    [
      "Pending changesets (by bump type)",
      FAST_ROW_CELL,
      "`grep -h '^\"awcms\":' .changeset/*.md \\| sort \\| uniq -c`"
    ],
    [
      "Commits since the last release",
      FAST_ROW_CELL,
      `\`git rev-list --count v${data.version}..HEAD\``
    ],
    [
      "Base modules",
      `**${data.moduleCount}** (see the list in ARCHITECTURE.md)`,
      "`src/modules/index.ts`"
    ],
    [
      "Migrations",
      `**${data.migrationCount}** (\`sql/${data.migrationFirst}\`–\`${data.migrationLast}\`)`,
      "`ls sql/`"
    ],
    [
      "ADR",
      `**${data.adrLowest}**–**${data.adrHighest}** (\`${data.adrLowest}\` = template; highest ADR status: **${data.adrHighestStatus}**)`,
      "`ls docs/adr/`"
    ],
    [
      "Admin screens",
      `**${data.adminScreenCount}** \`.astro\` files in \`src/pages/admin/\`; ${navi}`,
      "`find src/pages/admin -name '*.astro'`, `grep -L 'navigation:' src/modules/*/module.ts`"
    ],
    [
      "`.astro` files",
      `**${data.astroFileCount}** (${formatRibuan(data.astroLineCount)} lines) — on typechecking see §6`,
      "`find src -name '*.astro'`"
    ],
    [
      "Gates",
      `**${data.checkGateCount}** in the \`bun run check\` chain`,
      "`scripts.check` in `package.json`, split on `&&`"
    ],
    [
      "Contracts",
      `Modular per-module OpenAPI + AsyncAPI; \`MODULE_CONTRACT_VERSION\` **${data.contractVersion}**`,
      "`openapi/`, `asyncapi/`, `_shared/module-contract.ts`"
    ]
  ];

  return [
    "<!-- Generated by `bun run project-state:inventory:generate`. DO NOT hand-edit; the gate is `bun run project-state:inventory:check`. -->",
    "",
    ...rows.map((cells) => `| ${cells.join(" | ")} |`)
  ].join("\n");
}

/**
 * Parse a rendered block back into its rows — cell content only, padding and
 * alignment discarded. The split honours `\|` escapes because the changeset
 * command cell contains a real shell pipeline.
 */
export function parseInventoryRows(block: string): string[][] {
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"))
    .filter((line) => !/^\|[\s\-:|]+\|$/.test(line))
    .map((line) =>
      line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split(/(?<!\\)\|/)
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
      `${DOC_PATH} is missing the "${BEGIN}" / "${END}" markers — the generated table has no home.`
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

/**
 * The `--check` verdict as data, so the test can prove it in both directions
 * without touching the real file. Empty array = in sync.
 */
export function diffAgainstFresh(
  markdown: string,
  freshBlock: string
): string[] {
  const current = extractBlock(markdown);
  if (current === null) {
    return [
      `penanda \`${BEGIN}\` / \`${END}\` tidak ditemukan di ${DOC_PATH} — blok ter-generate tidak punya rumah`
    ];
  }

  const currentRows = parseInventoryRows(current);
  const freshRows = parseInventoryRows(freshBlock);

  const byAspek = (rows: string[][]): Map<string, string[]> =>
    new Map(rows.slice(1).map((cells) => [cells[0] ?? "", cells]));

  const currentMap = byAspek(currentRows);
  const freshMap = byAspek(freshRows);
  const problems: string[] = [];

  for (const [aspect, freshCells] of freshMap) {
    const currentCells = currentMap.get(aspect);
    if (!currentCells) {
      problems.push(`row "${aspect}" is missing from the document`);
      continue;
    }
    if (JSON.stringify(currentCells) !== JSON.stringify(freshCells)) {
      problems.push(
        `row "${aspect}" is stale — document: ${JSON.stringify(
          currentCells[1] ?? ""
        )}, repo: ${JSON.stringify(freshCells[1] ?? "")}`
      );
    }
  }

  for (const aspect of currentMap.keys()) {
    if (!freshMap.has(aspect)) {
      problems.push(`row "${aspect}" is in the document but is not generated`);
    }
  }

  if (
    problems.length === 0 &&
    JSON.stringify(currentRows[0]) !== JSON.stringify(freshRows[0])
  ) {
    problems.push("the table header row differs from a fresh render");
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Collection from disk
// ---------------------------------------------------------------------------

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

export function collectInventory(): ProjectStateInventory {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    version: string;
    scripts: Record<string, string>;
  };

  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));
  if (migrations.length === 0) {
    throw new Error(
      `no migrations in ${MIGRATIONS_DIR}/ — that cannot be right`
    );
  }

  const adrs = readdirSync(ADR_DIR)
    .filter((name) => /^\d{4}-/.test(name) && name.endsWith(".md"))
    .sort((a, b) => a.localeCompare(b));
  if (adrs.length === 0) {
    throw new Error(`no ADRs in ${ADR_DIR}/ — that cannot be right`);
  }
  const highestAdr = adrs[adrs.length - 1]!;
  const adrHighestStatus = parseAdrStatus(
    readFileSync(path.join(ADR_DIR, highestAdr), "utf8")
  );
  if (adrHighestStatus === null) {
    throw new Error(
      `the highest ADR (${highestAdr}) has no \`- **Status:** …\` line — fix the ADR rather than guessing its status`
    );
  }

  const modulesWithoutNavigation = readdirSync(MODULES_DIR, {
    withFileTypes: true
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => {
      const moduleFile = path.join(MODULES_DIR, name, "module.ts");
      if (!existsSync(moduleFile)) return false;
      return !readFileSync(moduleFile, "utf8").includes("navigation:");
    })
    .sort((a, b) => a.localeCompare(b));

  const astroFiles = listFilesRecursive(SRC_DIR).filter((file) =>
    file.endsWith(".astro")
  );
  const astroLineCount = astroFiles.reduce(
    (sum, file) => sum + (readFileSync(file, "utf8").match(/\n/g)?.length ?? 0),
    0
  );

  const adminScreenCount = listFilesRecursive(ADMIN_PAGES_DIR).filter((file) =>
    file.endsWith(".astro")
  ).length;

  return {
    version: pkg.version,
    moduleCount: listModules().length,
    migrationCount: migrations.length,
    migrationFirst: migrations[0]!.slice(0, 3),
    migrationLast: migrations[migrations.length - 1]!.slice(0, 3),
    adrLowest: adrs[0]!.slice(0, 4),
    adrHighest: highestAdr.slice(0, 4),
    adrHighestStatus,
    adminScreenCount,
    modulesWithoutNavigation,
    astroFileCount: astroFiles.length,
    astroLineCount,
    checkGateCount: countCheckGates(pkg.scripts.check ?? ""),
    contractVersion: MODULE_CONTRACT_VERSION
  };
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const markdown = readFileSync(DOC_PATH, "utf8");
  const fresh = renderInventoryBlock(collectInventory());

  if (!check) {
    writeFileSync(DOC_PATH, replaceBlock(markdown, fresh), "utf8");
    console.log(
      `Updated: ${DOC_PATH} §2. Run \`bun run project-state:inventory:check\` to verify.`
    );
    return;
  }

  const problems = diffAgainstFresh(markdown, fresh);

  if (problems.length === 0) {
    console.log(
      "project-state:inventory:check OK — the §2 table in PROJECT_STATE.md matches the repo."
    );
    return;
  }

  console.error(
    `project-state:inventory:check FAILED — the §2 table in ${DOC_PATH} is stale against the repo:`
  );
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  console.error(
    "Run `bun run project-state:inventory:generate`, then `bun run format`."
  );
  process.exitCode = 1;
}

if (import.meta.main) {
  await main();
}
