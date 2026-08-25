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
import {
  extractBlock,
  parseInventoryRows,
  replaceBlock,
  type GeneratedBlockMarkers
} from "./lib/markdown-table";
import { listMigrationNames } from "./lib/migrations";
import { listFilesRecursive } from "./lib/repo-files";

export const BEGIN = "<!-- project-state-inventory:mulai -->";
export const END = "<!-- project-state-inventory:selesai -->";

/**
 * Both language copies (Issue #727).
 *
 * This generator wrote `docs/PROJECT_STATE.md` only, while
 * `docs/PROJECT_STATE.id.md` carried the SAME block, marked
 * "JANGAN diedit tangan", maintained by hand and covered by nothing. It drifted:
 * at the time this was found it reported the ADR range ending at `0111` against
 * a real `0113`, 48/61/57 against 49/62/58, and — worse than any count —
 * `MODULE_CONTRACT_VERSION` **4.0.0** against the real **4.1.0**.
 *
 * `check:docs:translation` could not see it, and not by oversight: it compares a
 * hash of the ENGLISH source against a marker stored in the mirror, which
 * answers "has the English changed since this was translated?". Prose only goes
 * stale when the English changes, so that question is the right one for prose.
 * Derived content goes stale when the REPO changes, with both files untouched —
 * and then re-stamping after any unrelated English edit re-blesses it silently.
 *
 * So the fix belongs here, in the thing that already knows the values. Only the
 * row LABELS and two prose strings are translated; every value, and the whole
 * source-of-truth column, is language-neutral and shared — which is why this is
 * a label table rather than a second renderer that could disagree with the
 * first.
 */
export type InventoryLocale = "en" | "id";

type LocaleStrings = {
  docPath: string;
  banner: string;
  header: [string, string, string];
  fastRowCell: string;
  labels: Record<string, string>;
  /** Value-cell fragments that read as prose rather than as data. */
  modulesWithout: (missing: number, total: number) => string;
  modulesWithoutList: (missing: number, total: number, keys: string) => string;
  baseModules: (count: number) => string;
  adr: (lowest: string, highest: string, status: string) => string;
  adminScreens: (count: number, navi: string) => string;
  astroFiles: (count: number, lines: string) => string;
  gates: (count: number) => string;
  /** The one source-of-truth cell that is prose rather than a bare command. */
  gatesSource: string;
  contracts: (version: string) => string;
};

const LOCALES: Record<InventoryLocale, LocaleStrings> = {
  en: {
    docPath: "docs/PROJECT_STATE.md",
    banner:
      "<!-- Generated by `bun run project-state:inventory:generate`. DO NOT hand-edit; the gate is `bun run project-state:inventory:check`. -->",
    header: ["Aspect", "Value (generated)", "Source of truth"],
    fastRowCell: "_run the command in the right-hand column_",
    labels: {
      version: "Version",
      changesets: "Pending changesets (by bump type)",
      commits: "Commits since the last release",
      modules: "Base modules",
      migrations: "Migrations",
      adr: "ADR",
      adminScreens: "Admin screens",
      astro: "`.astro` files",
      gates: "Gates",
      contracts: "Contracts"
    },
    modulesWithout: (missing, total) =>
      `**${missing} of ${total}** modules without \`navigation:\``,
    modulesWithoutList: (missing, total, keys) =>
      `**${missing} of ${total}** modules without \`navigation:\` (${keys})`,
    baseModules: (count) => `**${count}** (see the list in ARCHITECTURE.md)`,
    adr: (lowest, highest, status) =>
      `**${lowest}**–**${highest}** (\`${lowest}\` = template; highest ADR status: **${status}**)`,
    adminScreens: (count, navi) =>
      `**${count}** \`.astro\` files in \`src/pages/admin/\`; ${navi}`,
    astroFiles: (count, lines) =>
      `**${count}** (${lines} lines) — on typechecking see §6`,
    gates: (count) => `**${count}** in the \`bun run check\` chain`,
    gatesSource: "`scripts.check` in `package.json`, split on `&&`",
    contracts: (version) =>
      `Modular per-module OpenAPI + AsyncAPI; \`MODULE_CONTRACT_VERSION\` **${version}**`
  },
  id: {
    docPath: "docs/PROJECT_STATE.id.md",
    banner:
      "<!-- Dihasilkan `bun run project-state:inventory:generate`. JANGAN diedit tangan; gerbangnya `bun run project-state:inventory:check`. -->",
    header: ["Aspek", "Nilai (ter-generate)", "Sumber kebenaran"],
    fastRowCell: "_jalankan perintah di kolom kanan_",
    labels: {
      version: "Versi",
      changesets: "Changeset menunggu (per tipe bump)",
      commits: "Commit sejak rilis terakhir",
      modules: "Modul base",
      migrations: "Migrasi",
      adr: "ADR",
      adminScreens: "Layar admin",
      astro: "Berkas `.astro`",
      gates: "Gerbang",
      contracts: "Kontrak"
    },
    modulesWithout: (missing, total) =>
      `**${missing} dari ${total}** modul tanpa \`navigation:\``,
    modulesWithoutList: (missing, total, keys) =>
      `**${missing} dari ${total}** modul tanpa \`navigation:\` (${keys})`,
    baseModules: (count) => `**${count}** (lihat daftar di ARCHITECTURE.md)`,
    adr: (lowest, highest, status) =>
      `**${lowest}**–**${highest}** (\`${lowest}\` = template; status ADR tertinggi: **${status}**)`,
    adminScreens: (count, navi) =>
      `**${count}** berkas \`.astro\` di \`src/pages/admin/\`; ${navi}`,
    astroFiles: (count, lines) =>
      `**${count}** (${lines} baris) — soal typecheck lihat §6`,
    gates: (count) => `**${count}** di rantai \`bun run check\``,
    gatesSource: "`scripts.check` di `package.json`, dipisah pada `&&`",
    contracts: (version) =>
      `OpenAPI modular per-modul + AsyncAPI; \`MODULE_CONTRACT_VERSION\` **${version}**`
  }
};

export const INVENTORY_LOCALES = Object.keys(LOCALES) as InventoryLocale[];

export function inventoryDocPath(locale: InventoryLocale): string {
  return LOCALES[locale].docPath;
}

function markersFor(locale: InventoryLocale): GeneratedBlockMarkers {
  return { begin: BEGIN, end: END, docPath: LOCALES[locale].docPath };
}

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

export function renderInventoryBlock(
  data: ProjectStateInventory,
  locale: InventoryLocale = "en"
): string {
  const t = LOCALES[locale];
  const missing = data.modulesWithoutNavigation.length;

  const navi =
    missing === 0
      ? t.modulesWithout(0, data.moduleCount)
      : t.modulesWithoutList(
          missing,
          data.moduleCount,
          data.modulesWithoutNavigation.map((key) => `\`${key}\``).join(", ")
        );

  const rows = [
    t.header,
    ["---", "---", "---"],
    [t.labels.version!, `**${data.version}**`, "`package.json`"],
    [
      t.labels.changesets!,
      t.fastRowCell,
      "`grep -h '^\"awcms\":' .changeset/*.md \\| sort \\| uniq -c`"
    ],
    [
      t.labels.commits!,
      t.fastRowCell,
      `\`git rev-list --count v${data.version}..HEAD\``
    ],
    [
      t.labels.modules!,
      t.baseModules(data.moduleCount),
      "`src/modules/index.ts`"
    ],
    [
      t.labels.migrations!,
      `**${data.migrationCount}** (\`sql/${data.migrationFirst}\`–\`${data.migrationLast}\`)`,
      "`ls sql/`"
    ],
    [
      t.labels.adr!,
      t.adr(data.adrLowest, data.adrHighest, data.adrHighestStatus),
      "`ls docs/adr/`"
    ],
    [
      t.labels.adminScreens!,
      t.adminScreens(data.adminScreenCount, navi),
      "`find src/pages/admin -name '*.astro'`, `grep -L 'navigation:' src/modules/*/module.ts`"
    ],
    [
      t.labels.astro!,
      t.astroFiles(data.astroFileCount, formatRibuan(data.astroLineCount)),
      "`find src -name '*.astro'`"
    ],
    [t.labels.gates!, t.gates(data.checkGateCount), t.gatesSource],
    [
      t.labels.contracts!,
      t.contracts(data.contractVersion),
      "`openapi/`, `asyncapi/`, `_shared/module-contract.ts`"
    ]
  ];

  return [
    t.banner,
    "",
    ...rows.map((cells) => `| ${cells.join(" | ")} |`)
  ].join("\n");
}

/**
 * The `--check` verdict as data, so the test can prove it in both directions
 * without touching the real file. Empty array = in sync.
 */
export function diffAgainstFresh(
  markdown: string,
  freshBlock: string,
  locale: InventoryLocale = "en"
): string[] {
  const current = extractBlock(markdown, markersFor(locale));
  if (current === null) {
    return [
      `penanda \`${BEGIN}\` / \`${END}\` tidak ditemukan di ${inventoryDocPath(locale)} — blok ter-generate tidak punya rumah`
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

export function collectInventory(): ProjectStateInventory {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    version: string;
    scripts: Record<string, string>;
  };

  // The non-empty assertion this used to carry by hand now lives in the shared
  // loader, where every caller gets it (finding D14).
  const migrations = listMigrationNames();

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
  const inventory = collectInventory();
  // Both copies from ONE collection pass. Collecting per locale would let the
  // two blocks disagree about a repo that did not change between them.
  const problems: string[] = [];

  for (const locale of INVENTORY_LOCALES) {
    const docPath = inventoryDocPath(locale);
    const markdown = readFileSync(docPath, "utf8");
    const fresh = renderInventoryBlock(inventory, locale);

    if (!check) {
      writeFileSync(
        docPath,
        replaceBlock(markdown, fresh, markersFor(locale)),
        "utf8"
      );
      console.log(
        `Updated: ${docPath} §2. Run \`bun run project-state:inventory:check\` to verify.`
      );
      continue;
    }

    for (const problem of diffAgainstFresh(markdown, fresh, locale)) {
      problems.push(`${docPath}: ${problem}`);
    }
  }

  if (!check) {
    return;
  }

  if (problems.length === 0) {
    console.log(
      `project-state:inventory:check OK — the §2 table matches the repo in all ${INVENTORY_LOCALES.length} language copies.`
    );
    return;
  }

  console.error(
    "project-state:inventory:check FAILED — a §2 table is stale against the repo:"
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
