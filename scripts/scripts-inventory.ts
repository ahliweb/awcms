/**
 * The `scripts/README.md` inventory, derived from `package.json`.
 *
 * ## Why generated
 *
 * The table it replaces was hand-written, and it aged in the direction that
 * does the most damage. It listed 12 of 52 scripts as "active", and its
 * companion "not yet ported" table named fifteen tools that had not only
 * landed but were IN the `bun run check` chain — `api:docs:check`,
 * `modules:compose:check`, `db:work-class:check`, and every per-module worker.
 *
 * A negative claim is the dangerous kind: "X does not exist yet" gets more
 * wrong with time and never fails on its own, unlike a positive claim that
 * breaks the moment the code moves. Someone reading it would conclude
 * `db:work-class:check` still needed building and build a second one.
 *
 * So the completeness half is derived and the prose half is not: this file
 * generates target/script/in-check, which is exactly the part that goes stale,
 * and leaves the rest of the README to a human.
 *
 * Two commands, one source: `bun run scripts:inventory:generate` rewrites the
 * marked block, `bun run scripts:inventory:check` fails if it is out of date.
 * A `.generated` artefact WITHOUT that pair is a false claim that reads more
 * authoritative than prose.
 *
 * ## Why the check parses instead of comparing bytes
 *
 * Prettier owns markdown formatting here and pads table columns to align them.
 * A byte-for-byte comparison would therefore fail immediately after every
 * `bun run lint`, and the two would fight forever. So the check parses the
 * block back into rows and compares CONTENT — which is the property worth
 * asserting anyway. Padding is not drift.
 */
const README_PATH = "scripts/README.md";
const BEGIN = "<!-- BEGIN GENERATED: script-inventory -->";
const END = "<!-- END GENERATED: script-inventory -->";

export type InventoryRow = {
  target: string;
  script: string;
  inCheck: boolean;
};

export type PackageScripts = Record<string, string>;

const SCRIPT_REFERENCE = /scripts\/([\w.-]+\.(?:ts|mjs))/;

/**
 * One row per `package.json` target that runs a file in `scripts/`. Targets
 * that only compose other targets (`check` itself, `dev`, `build`) are not
 * inventory entries — they run no script of their own.
 */
export function buildInventory(packageScripts: PackageScripts): InventoryRow[] {
  const chain = packageScripts.check ?? "";

  return Object.entries(packageScripts)
    .flatMap(([target, command]) => {
      const match = command.match(SCRIPT_REFERENCE);
      if (!match) return [];

      return [
        {
          target,
          script: match[1]!,
          inCheck:
            chain.includes(`bun run ${target} `) ||
            chain.endsWith(`bun run ${target}`)
        }
      ];
    })
    .sort((a, b) => a.target.localeCompare(b.target));
}

export function renderInventory(rows: readonly InventoryRow[]): string {
  const gated = rows.filter((row) => row.inCheck).length;

  return [
    BEGIN,
    "",
    `<!-- Dihasilkan \`bun run scripts:inventory:generate\`. JANGAN diedit tangan. -->`,
    "",
    `${rows.length} target menjalankan berkas di \`scripts/\`; ${gated} di antaranya`,
    "ada di rantai `bun run check` (kolom **Gate**), sisanya dijalankan manual,",
    "terjadwal, atau oleh workflow CI tertentu.",
    "",
    "| Target | Skrip | Gate |",
    "| ------ | ----- | ---- |",
    ...rows.map(
      (row) =>
        `| \`${row.target}\` | \`${row.script}\` | ${row.inCheck ? "✅" : "—"} |`
    ),
    "",
    END
  ].join("\n");
}

export function replaceInventoryBlock(
  readme: string,
  rendered: string
): string {
  const begin = readme.indexOf(BEGIN);
  const end = readme.indexOf(END);

  if (begin === -1 || end === -1) {
    throw new Error(
      `${README_PATH} is missing the ${BEGIN} / ${END} markers — the generated block has no home.`
    );
  }

  return readme.slice(0, begin) + rendered + readme.slice(end + END.length);
}

/** Parses the rendered block back into rows, ignoring column padding. */
export function parseInventoryBlock(block: string): InventoryRow[] {
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("| `"))
    .map((line) => {
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim().replace(/^`|`$/g, ""));

      return {
        target: cells[0] ?? "",
        script: cells[1] ?? "",
        inCheck: cells[2] === "✅"
      };
    });
}

export function extractInventoryBlock(readme: string): string {
  const begin = readme.indexOf(BEGIN);
  const end = readme.indexOf(END);

  if (begin === -1 || end === -1) {
    throw new Error(`${README_PATH} is missing the generated-block markers.`);
  }

  return readme.slice(begin, end + END.length);
}

/**
 * A target named as "not yet ported" that actually EXISTS. This is the exact
 * shape of the failure: the claim is negative, so nothing breaks when it stops
 * being true.
 */
export function findFalseAbsenceClaims(
  readme: string,
  packageScripts: PackageScripts
): string[] {
  const deferredHeading = readme.indexOf("## Ditunda");
  if (deferredHeading === -1) return [];

  // TABLE ROWS only. The prose in that section explains the rule and names a
  // real target while doing so; scanning it wholesale made the gate report
  // itself on its first run — the same self-report `table-write-ownership-check`
  // and `tenant-context-usage-check` both hit.
  const rows = readme
    .slice(deferredHeading)
    .split("\n")
    .filter((line) => line.trimStart().startsWith("|"))
    .join("\n");

  return Object.keys(packageScripts)
    .filter((target) => rows.includes(`\`${target}\``))
    .sort();
}

export async function readPackageScripts(): Promise<PackageScripts> {
  return (
    (await Bun.file("package.json").json()) as { scripts: PackageScripts }
  ).scripts;
}

async function main(): Promise<void> {
  const mode = process.argv.includes("--check") ? "check" : "generate";
  const packageScripts = await readPackageScripts();
  const readme = await Bun.file(README_PATH).text();
  const rendered = renderInventory(buildInventory(packageScripts));
  const falseAbsences = findFalseAbsenceClaims(readme, packageScripts);

  if (mode === "generate") {
    await Bun.write(README_PATH, replaceInventoryBlock(readme, rendered));
    console.log(
      `Diperbarui: ${README_PATH} — blok inventaris skrip diregenerasi.`
    );
    return;
  }

  const failures: string[] = [];

  const present = parseInventoryBlock(extractInventoryBlock(readme));
  const expected = buildInventory(packageScripts);

  if (JSON.stringify(present) !== JSON.stringify(expected)) {
    failures.push(
      `${README_PATH} tidak cocok dengan regenerasi segar dari package.json ` +
        `(${present.length} baris tercatat vs ${expected.length} target nyata). ` +
        "Jalankan `bun run scripts:inventory:generate` dan commit hasilnya."
    );
  }

  for (const target of falseAbsences) {
    failures.push(
      `\`${target}\` tercatat di §Ditunda sebagai belum ada, padahal SUDAH ` +
        "terdaftar di package.json. Klaim negatif menua ke arah berbahaya: " +
        "pembacanya akan membangun duplikatnya."
    );
  }

  if (failures.length === 0) {
    console.log(
      `scripts:inventory:check OK — blok inventaris ${README_PATH} sinkron, ` +
        "tak ada klaim 'belum ada' untuk target yang sudah ada."
    );
    return;
  }

  for (const failure of failures) {
    console.error(failure);
  }

  process.exitCode = 1;
}

if (import.meta.main) {
  await main();
}
