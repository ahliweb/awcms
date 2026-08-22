/**
 * The `scripts/lib/` extraction — finding D14, and the three things it was
 * actually about.
 *
 * The finding reads like tidying, and it is not. Each of the three duplications
 * had already produced a DIFFERENCE that nobody chose:
 *
 * 1. **The table parser.** One copy learned about `\|` escapes because its own
 *    document contains a shell pipeline in a cell; the other did not, so the
 *    same cell would have torn in two.
 * 2. **The migration loader.** Six copies, and the non-empty assertion existed
 *    in exactly one. Every caller answers "which tables exist and which have
 *    RLS forced" — questions an EMPTY list answers with a confident, wrong
 *    "none", which is a gate reporting full coverage of nothing.
 * 3. **`deriveTableRlsStates`.** Two gates imported it from a documentation
 *    GENERATOR, so a gate could fail because a generator was refactored.
 *
 * These tests pin the behaviours, not the file layout. Moving the code again is
 * fine; losing the escape handling, the assertion or the fold order is not.
 */
import { describe, expect, test } from "bun:test";

import {
  extractBlock,
  parseInventoryRows,
  replaceBlock,
  type GeneratedBlockMarkers
} from "../scripts/lib/markdown-table";
import {
  MIGRATIONS_DIR,
  MIGRATIONS_DIR_NAME,
  listMigrationNames,
  loadMigrations
} from "../scripts/lib/migrations";
import { deriveTableRlsStates } from "../scripts/lib/table-rls-states";

const MARKERS: GeneratedBlockMarkers = {
  begin: "<!-- BEGIN -->",
  end: "<!-- END -->",
  docPath: "docs/example.md"
};

describe("the shared markdown-table helpers", () => {
  test("an escaped pipe inside a cell is NOT a column boundary", () => {
    // The difference that already existed between the two copies. The
    // project-state table has a cell holding a real shell pipeline; the
    // repo-inventory copy split on a bare `|` and would have torn it.
    const rows = parseInventoryRows(
      "| command | note |\n|---|---|\n| `bun run x \\| head` | one |"
    );

    expect(rows).toEqual([
      ["command", "note"],
      ["`bun run x \\| head`", "one"]
    ]);
  });

  test("alignment rows are structure, not data", () => {
    for (const separator of ["|---|---|", "| :--- | ---: |", "|:-:|-|"]) {
      const rows = parseInventoryRows(`| a | b |\n${separator}\n| 1 | 2 |`);

      expect(rows, separator).toEqual([
        ["a", "b"],
        ["1", "2"]
      ]);
    }
  });

  test("replaceBlock round-trips through extractBlock", () => {
    const doc = "# Doc\n\n<!-- BEGIN -->\n\nold\n\n<!-- END -->\n\ntail\n";
    const updated = replaceBlock(doc, "| a |\n|---|\n| 1 |", MARKERS);

    expect(extractBlock(updated, MARKERS)).toBe("| a |\n|---|\n| 1 |");
    expect(updated).toContain("# Doc");
    expect(updated).toContain("tail");
  });

  test("a document with no markers throws rather than appending", () => {
    // A generated block with no home is a document that silently stops being
    // generated, and `--check` would then compare a fresh render against
    // nothing at all.
    expect(() => replaceBlock("# Doc\n", "block", MARKERS)).toThrow(
      "docs/example.md"
    );
    expect(extractBlock("# Doc\n", MARKERS)).toBeNull();
    // Crossed markers are as broken as absent ones.
    expect(extractBlock("<!-- END -->\n<!-- BEGIN -->", MARKERS)).toBeNull();
  });
});

describe("the shared migration loader", () => {
  test("resolves sql/ from the repo, not from the working directory", () => {
    // Five of the six copies used a bare "sql", so they only worked when run
    // from the repository root. A gate should not depend on where somebody was
    // standing when they ran it.
    expect(MIGRATIONS_DIR).toEndWith(`/${MIGRATIONS_DIR_NAME}`);
    expect(MIGRATIONS_DIR.startsWith("/")).toBe(true);
  });

  test("returns every migration, sorted, with contents", () => {
    const names = listMigrationNames();
    const loaded = loadMigrations();

    expect(names.length).toBeGreaterThan(100);
    expect(loaded.map((file) => file.name)).toEqual(names);
    expect(loaded[0]!.sql.length).toBeGreaterThan(0);

    // Sorting is not cosmetic: `deriveTableRlsStates` folds files in filename
    // order and only the LAST statement about a table is true, so an unsorted
    // loader would report an end-state that never existed.
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });
});

describe("deriveTableRlsStates, now owned by a library and not by a generator", () => {
  test("only the last statement about a table counts", () => {
    // `sql/020` toggles FORCE off for a repair and back on; `sql/077` drops a
    // table an earlier migration created. A fold that took the first or the
    // last statement it happened to see would produce an inventory that reads
    // authoritative and says the opposite of the truth.
    const states = deriveTableRlsStates([
      {
        name: "001_a.sql",
        sql: `CREATE TABLE awcms_thing (id uuid);
              ALTER TABLE awcms_thing ENABLE ROW LEVEL SECURITY;
              ALTER TABLE awcms_thing FORCE ROW LEVEL SECURITY;
              CREATE TABLE awcms_gone (id uuid);`
      },
      {
        name: "002_b.sql",
        sql: `ALTER TABLE awcms_thing NO FORCE ROW LEVEL SECURITY;
              DROP TABLE awcms_gone;`
      },
      {
        name: "003_c.sql",
        sql: "ALTER TABLE awcms_thing FORCE ROW LEVEL SECURITY;"
      }
    ]);

    expect(states.map((state) => state.table)).toEqual(["awcms_thing"]);
    expect(states[0]!.force).toBe(true);
    expect(states[0]!.rowLevelSecurity).toBe(true);
    expect(states[0]!.createdIn).toBe("001_a.sql");
  });

  test("commented-out DDL is not a table", () => {
    // These migrations are heavily commented and several quote the very DDL
    // they replace.
    const states = deriveTableRlsStates([
      {
        name: "001_a.sql",
        sql: `-- CREATE TABLE awcms_ghost (id uuid);
              /* CREATE TABLE awcms_phantom (id uuid); */
              CREATE TABLE awcms_real (id uuid);`
      }
    ]);

    expect(states.map((state) => state.table)).toEqual(["awcms_real"]);
  });

  test("the fold is order-independent of the input array", () => {
    // Callers pass whatever `readdir` gave them; the sort belongs to the fold.
    const files = [
      {
        name: "002_b.sql",
        sql: "ALTER TABLE awcms_thing FORCE ROW LEVEL SECURITY;"
      },
      { name: "001_a.sql", sql: "CREATE TABLE awcms_thing (id uuid);" }
    ];

    expect(deriveTableRlsStates(files)).toEqual(
      deriveTableRlsStates([...files].reverse())
    );
  });
});
