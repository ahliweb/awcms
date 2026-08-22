/**
 * `bun run repo:inventory:generate|:check` — the derivation, not the file.
 *
 * The RLS parse gets the most attention here because it is the one thing in
 * this generator that can be confidently wrong: the migrations toggle FORCE off
 * and back on within a single file (`sql/020`), create tables in one and drop
 * them in another (`sql/077`), and quote DDL inside comments. A parser that
 * took the first or the last statement about a table, or that read commented
 * DDL, would produce an inventory that looks authoritative and says the
 * opposite of the truth — which is precisely the failure mode this document
 * spent months in.
 *
 * The last test is a CROSS-ARTEFACT check rather than a self-check: the set of
 * tables this generator derives as RLS-free must equal the set a human declared
 * in `security-readiness.ts`. One side is derived from the migrations, the
 * other is hand-maintained with a reason per entry, so a disagreement means
 * either a new global table shipped without its privilege declaration or a
 * tenant table shipped without RLS.
 */
import { describe, expect, test } from "bun:test";

import {
  extractBlock,
  parseInventoryRows,
  replaceBlock,
  type GeneratedBlockMarkers
} from "../scripts/lib/markdown-table";
import {
  deriveTableRlsStates,
  stripSqlComments
} from "../scripts/lib/table-rls-states";
import {
  collectModuleRows,
  collectRouteCounts,
  collectTestCounts,
  renderInventoryBlock,
  type InventoryData
} from "../scripts/repo-inventory";

const MARKERS: GeneratedBlockMarkers = {
  begin: "<!-- BEGIN GENERATED: repo-inventory -->",
  end: "<!-- END GENERATED: repo-inventory -->",
  docPath: "docs/awcms/repo-inventory.md"
};
import { GLOBAL_TABLE_FORBIDDEN_PRIVILEGES } from "../scripts/security-readiness";
import { collectInventory } from "../scripts/repo-inventory";

describe("deriveTableRlsStates", () => {
  test("folds ENABLE then FORCE into the end state", () => {
    const states = deriveTableRlsStates([
      {
        name: "001_a.sql",
        sql: `CREATE TABLE awcms_widgets (id uuid);
              ALTER TABLE awcms_widgets ENABLE ROW LEVEL SECURITY;`
      },
      {
        name: "002_b.sql",
        sql: `ALTER TABLE awcms_widgets FORCE ROW LEVEL SECURITY;`
      }
    ]);

    expect(states).toEqual([
      {
        table: "awcms_widgets",
        createdIn: "001_a.sql",
        rowLevelSecurity: true,
        force: true
      }
    ]);
  });

  test("a FORCE toggled off for a repair and back on ends FORCED (the sql/020 shape)", () => {
    const states = deriveTableRlsStates([
      {
        name: "001_a.sql",
        sql: `CREATE TABLE awcms_offices (id uuid);
              ALTER TABLE awcms_offices ENABLE ROW LEVEL SECURITY;
              ALTER TABLE awcms_offices FORCE ROW LEVEL SECURITY;`
      },
      {
        name: "020_repair.sql",
        sql: `ALTER TABLE awcms_offices NO FORCE ROW LEVEL SECURITY;
              UPDATE awcms_offices SET parent_office_id = NULL;
              ALTER TABLE awcms_offices FORCE ROW LEVEL SECURITY;`
      }
    ]);

    expect(states[0]!.force).toBe(true);
  });

  test("a FORCE dropped and never restored ends UNFORCED — the answer that matters", () => {
    const states = deriveTableRlsStates([
      {
        name: "001_a.sql",
        sql: `CREATE TABLE awcms_offices (id uuid);
              ALTER TABLE awcms_offices ENABLE ROW LEVEL SECURITY;
              ALTER TABLE awcms_offices FORCE ROW LEVEL SECURITY;`
      },
      {
        name: "020_repair.sql",
        sql: `ALTER TABLE awcms_offices NO FORCE ROW LEVEL SECURITY;`
      }
    ]);

    expect(states[0]!.force).toBe(false);
  });

  test("a dropped table leaves the inventory", () => {
    const states = deriveTableRlsStates([
      { name: "001_a.sql", sql: `CREATE TABLE awcms_gone (id uuid);` },
      { name: "077_drop.sql", sql: `DROP TABLE IF EXISTS awcms_gone;` }
    ]);

    expect(states).toEqual([]);
  });

  test("DDL inside comments is not a table", () => {
    const states = deriveTableRlsStates([
      {
        name: "001_a.sql",
        sql: `-- CREATE TABLE awcms_commented (id uuid);
              /* CREATE TABLE awcms_blocked (id uuid); */
              CREATE TABLE awcms_real (id uuid);`
      }
    ]);

    expect(states.map((state) => state.table)).toEqual(["awcms_real"]);
  });

  test("non-awcms tables are out of scope", () => {
    const states = deriveTableRlsStates([
      { name: "001_a.sql", sql: `CREATE TABLE other_thing (id uuid);` }
    ]);

    expect(states).toEqual([]);
  });

  test("the creating migration is the FIRST one, not the last that mentions it", () => {
    const states = deriveTableRlsStates([
      { name: "001_a.sql", sql: `CREATE TABLE awcms_x (id uuid);` },
      {
        name: "050_b.sql",
        sql: `CREATE TABLE IF NOT EXISTS awcms_x (id uuid);`
      }
    ]);

    expect(states[0]!.createdIn).toBe("001_a.sql");
  });
});

describe("stripSqlComments", () => {
  test("removes line and block comments, keeps statements", () => {
    expect(
      stripSqlComments("SELECT 1; -- note\n/* block */ SELECT 2;")
    ).toContain("SELECT 2;");
    expect(
      stripSqlComments("SELECT 1; -- note\n/* block */ SELECT 2;")
    ).not.toContain("note");
  });
});

describe("collectModuleRows", () => {
  test("a descriptor without `type` reports none rather than inventing one", () => {
    const rows = collectModuleRows([
      { key: "a", version: "1.0.0", status: "active", dependencies: ["b"] },
      {
        key: "b",
        version: "2.0.0",
        status: "active",
        type: "domain",
        isCore: true
      }
    ]);

    expect(rows[0]).toEqual({
      key: "a",
      version: "1.0.0",
      status: "active",
      type: null,
      core: false,
      dependencies: ["b"]
    });
    expect(rows[1]!.type).toBe("domain");
    expect(rows[1]!.core).toBe(true);
  });
});

describe("collectTestCounts / collectRouteCounts", () => {
  test("counts only real test files, grouped by top-level directory", () => {
    const counts = collectTestCounts([
      "tests/foo.test.ts",
      "tests/integration/bar.integration.test.ts",
      "tests/e2e/baz.e2e.ts",
      "tests/integration/harness.ts",
      "tests/fixtures/example/module.ts"
    ]);

    expect(counts).toEqual([
      { label: "(root)", count: 1 },
      { label: "e2e", count: 1 },
      { label: "integration", count: 1 }
    ]);
  });

  test("splits routes into api, admin and public surfaces", () => {
    const counts = collectRouteCounts([
      "src/pages/api/v1/health.ts",
      "src/pages/admin/index.astro",
      "src/pages/news/[slug].ts",
      "src/pages/robots.txt.ts"
    ]);

    expect(counts).toEqual([
      { label: "`/api/v1/**`", count: 1 },
      { label: "`/admin/**`", count: 1 },
      { label: "publik / anonim", count: 2 }
    ]);
  });
});

describe("render/parse round trip", () => {
  const data: InventoryData = {
    modules: [
      {
        key: "a",
        version: "1.0.0",
        status: "active",
        type: null,
        core: false,
        dependencies: []
      }
    ],
    migrations: ["001_a.sql"],
    tables: [
      {
        table: "awcms_a",
        createdIn: "001_a.sql",
        rowLevelSecurity: true,
        force: true
      }
    ],
    tests: [{ label: "(root)", count: 1 }],
    routes: [{ label: "`/api/v1/**`", count: 1 }],
    adrCount: 61
  };

  test("the check compares CONTENT, so prettier's column padding is not drift", () => {
    const rendered = renderInventoryBlock(data);
    const padded = rendered
      .split("\n")
      .map((line) =>
        line.startsWith("|") ? line.replace(/\| /g, "|      ") : line
      )
      .join("\n");

    expect(parseInventoryRows(padded)).toEqual(parseInventoryRows(rendered));
  });

  test("replaceBlock round-trips through extractBlock", () => {
    const doc =
      "# Title\n\n<!-- BEGIN GENERATED: repo-inventory -->\n\nold\n\n<!-- END GENERATED: repo-inventory -->\n\ntail\n";
    const updated = replaceBlock(doc, renderInventoryBlock(data), MARKERS);

    expect(extractBlock(updated, MARKERS)).toBe(renderInventoryBlock(data));
    expect(updated).toContain("# Title");
    expect(updated).toContain("tail");
  });

  test("replaceBlock refuses a document with no markers rather than appending", () => {
    expect(() => replaceBlock("# no markers\n", "x", MARKERS)).toThrow(
      /markers/
    );
  });
});

describe("cross-artefact: derived RLS-free set == declared global tables", () => {
  test("every table this inventory derives as RLS-free is a declared global table, and vice versa", () => {
    const derived = collectInventory()
      .tables.filter((table) => !table.rowLevelSecurity)
      .map((table) => table.table)
      .sort();

    const declared = Object.keys(GLOBAL_TABLE_FORBIDDEN_PRIVILEGES).sort();

    // A table on ONE side only is a real defect in one of two directions: a new
    // global table that shipped without declaring which privileges `awcms_app`
    // must not hold on it, or a tenant-scoped table that shipped without RLS.
    expect(derived).toEqual(declared);
  });
});
