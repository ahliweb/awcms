/**
 * The ADR index tables (docs/adr/README.md and its .id.md mirror) list each
 * ADR exactly once, and every row links to a file that exists.
 *
 * Nothing checked this before 24 Nov 2026, and a rebase conflict resolution
 * that kept both the old and the edited row of ADR-0170 reached `main`: the
 * index then carried two different descriptions of the same decision, and the
 * stale one still described the claim as keyed without the account kind. A
 * reader who stops at the first match reads the superseded text.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ADR_DIR = join(import.meta.dir, "..", "docs", "adr");
const ROW = /^\| \[(\d{4})\]\(([^)]+)\)/;

type IndexRow = { number: string; target: string; line: number };

function indexRows(markdown: string): IndexRow[] {
  return markdown.split("\n").flatMap((text, i) => {
    const match = ROW.exec(text);
    return match ? [{ number: match[1]!, target: match[2]!, line: i + 1 }] : [];
  });
}

function duplicatedNumbers(rows: readonly IndexRow[]): string[] {
  const seen = new Map<string, number>();
  for (const row of rows) {
    seen.set(row.number, (seen.get(row.number) ?? 0) + 1);
  }
  return [...seen].filter(([, count]) => count > 1).map(([number]) => number);
}

function rowsOf(file: string): IndexRow[] {
  return indexRows(readFileSync(join(ADR_DIR, file), "utf8"));
}

for (const file of ["README.md", "README.id.md"]) {
  describe(`docs/adr/${file}`, () => {
    const rows = rowsOf(file);

    test("has index rows at all (the parser still matches the table)", () => {
      expect(rows.length).toBeGreaterThan(100);
    });

    test("lists each ADR number at most once", () => {
      expect(duplicatedNumbers(rows)).toEqual([]);
    });

    test("every row links to an existing ADR file whose number matches", () => {
      const broken = rows.filter(
        (row) =>
          !existsSync(join(ADR_DIR, row.target)) ||
          !row.target.startsWith(`${row.number}-`)
      );
      expect(broken).toEqual([]);
    });
  });
}

test("the two indexes list the same ADR numbers", () => {
  const en = new Set(rowsOf("README.md").map((row) => row.number));
  const id = new Set(rowsOf("README.id.md").map((row) => row.number));
  expect(id).toEqual(en);
});

test("every ADR source file on disk is reachable from the index", () => {
  const listed = new Set(rowsOf("README.md").map((row) => row.target));
  const unlisted = readdirSync(ADR_DIR).filter(
    (name) =>
      /^\d{4}-.*\.md$/.test(name) &&
      !name.endsWith(".id.md") &&
      !name.startsWith("0000-") && // the template, not a decision
      !listed.has(name)
  );
  expect(unlisted).toEqual([]);
});

test("duplicatedNumbers reports a number listed twice (the 0170 regression)", () => {
  const twice = indexRows(
    [
      "| [0169](0169-a.md) | x |",
      "| [0170](0170-b.md) | old text |",
      "| [0170](0170-b.md) | edited text |"
    ].join("\n")
  );
  expect(duplicatedNumbers(twice)).toEqual(["0170"]);
});
