/**
 * The stack table in `docs/awcms/family-compatibility.md` must say what the
 * manifest says (Issue #183, epic #177, ADR-0032; ADR-0039 for the mirror).
 *
 * ## Why this gate exists at all
 *
 * `family:conformance:check` already proves the manifest's `declared` values
 * equal the real ones at their `source`. What nothing proved is that the
 * PROSE table — the thing a human actually reads when they want to know which
 * Astro this repo is pinned to — agrees with either.
 *
 * It had already drifted, and the way it drifted is the point: on 23 August
 * 2026 the table read Astro `^7.0.7` / `@astrojs/node` `^11.0.2` while the
 * manifest and `package.json` both said `^7.2.2` / `^11.1.2`. The Bun,
 * TypeScript and PostgreSQL rows were correct. Only the two rows **dependabot
 * moves** were stale — because a bump updates `package.json` and the manifest
 * (the gate forces that) and then stops, and no gate looks any further.
 *
 * So the failure is not random rot: this table ages in exactly the direction
 * dependency bumps push it, at exactly the rate they land, and it does so
 * silently. A reader consulting it gets a confident wrong answer, which is
 * worse than no table — an absent table sends them to `package.json`.
 *
 * ## Both files, not just the source
 *
 * The `.id.md` mirror is a SEPARATE file that can drift on its own. The
 * translation gates compare its `i18n-source-hash` against the English file,
 * which catches "the source changed and the mirror did not" — it cannot catch
 * "both were written wrong on the same day", which is precisely what happened
 * here. So both files are read, and both are compared against the manifest.
 *
 * No DB, no network — plain file reads and one YAML parse.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";
import { parse as parseYaml } from "yaml";

const ROOT = path.resolve(import.meta.dir, "..");

const DOCS = [
  "docs/awcms/family-compatibility.md",
  "docs/awcms/family-compatibility.id.md"
] as const;

type Manifest = {
  stack: {
    bun: {
      packageManager: { declared: string };
      engines: { declared: string };
      ci: { declared: string };
      ciMinimum: { declared: string };
    };
    astro: { declared: string };
    astroNode: { declared: string };
    typescript: { declared: string };
    postgres: { declared: string };
  };
};

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function manifest(): Manifest {
  return parseYaml(read("awcms-family-compatibility.yaml")) as Manifest;
}

/**
 * The row label as it appears in the first column, and what the Current and
 * Minimum-supported cells must contain.
 *
 * `null` means the cell is an em dash — the row deliberately declares only one
 * of the two, and asserting that keeps a real value from being quietly added
 * where the matrix says there is none.
 */
function expectedRows(
  m: Manifest
): Array<[string, string | null, string | null]> {
  return [
    [
      "Bun (pin)",
      m.stack.bun.packageManager.declared,
      m.stack.bun.engines.declared
    ],
    ["Bun (CI current)", m.stack.bun.ci.declared, null],
    ["Bun (CI minimum)", null, m.stack.bun.ciMinimum.declared],
    ["Astro", m.stack.astro.declared, m.stack.astro.declared],
    ["`@astrojs/node`", m.stack.astroNode.declared, m.stack.astroNode.declared],
    ["TypeScript", m.stack.typescript.declared, m.stack.typescript.declared],
    ["PostgreSQL", m.stack.postgres.declared, m.stack.postgres.declared]
  ];
}

/** Every markdown table row in a document, as trimmed cell arrays. */
function tableRows(doc: string): string[][] {
  return doc
    .split("\n")
    .filter((line) => line.trimStart().startsWith("|"))
    .map((line) =>
      line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim())
    );
}

/**
 * `` `^7.2.2` `` -> `^7.2.2`; an em-dash cell -> `null`.
 *
 * A MISSING cell (the row has fewer columns than the header) also reads as
 * `null` rather than throwing: a truncated row is drift too, and it should
 * fail as a mismatched value naming its row, not as a crash in the harness.
 */
function cellValue(cell: string | undefined): string | null {
  if (cell === undefined || cell === "—" || cell === "-" || cell === "") {
    return null;
  }
  return cell.match(/^`(.+)`$/)?.[1] ?? cell;
}

describe("family-compatibility doc — stack table parity with the manifest", () => {
  for (const rel of DOCS) {
    describe(rel, () => {
      const rows = tableRows(read(rel));

      test("declares every stack row the manifest does", () => {
        // A row DELETED from the table is the other way this drifts, and it
        // reads as "this repo pins nothing there" rather than as an omission.
        const labels = new Set(rows.map((cells) => cells[0]));
        for (const [label] of expectedRows(manifest())) {
          expect(labels.has(label)).toBe(true);
        }
      });

      for (const [label, current, minimum] of expectedRows(manifest())) {
        test(`row "${label}" matches the manifest`, () => {
          const row = rows.find((cells) => cells[0] === label);
          if (row === undefined) {
            throw new Error(`${rel}: the stack table has no row "${label}"`);
          }
          expect(cellValue(row[1])).toBe(current);
          expect(cellValue(row[2])).toBe(minimum);
        });
      }
    });
  }

  test("the two documents agree with EACH OTHER cell for cell", () => {
    // Redundant while both match the manifest, and deliberately kept: it is
    // the assertion that still means something if the manifest shape changes
    // and the loop above is loosened to follow it.
    const en = tableRows(read(DOCS[0]));
    const id = tableRows(read(DOCS[1]));
    for (const [label] of expectedRows(manifest())) {
      const a = en.find((cells) => cells[0] === label);
      const b = id.find((cells) => cells[0] === label);
      expect(a?.slice(1, 3)).toEqual(b?.slice(1, 3));
    }
  });
});
