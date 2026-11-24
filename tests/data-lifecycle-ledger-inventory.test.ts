/**
 * Issue #1501 — the PII inventory of the legacy ledger tables
 * (`docs/awcms/legacy-ledger-pii-inventory.md`) must not drift from the ledger.
 *
 * Pure: reads `sql/`, the module registry and the two documents.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { TABLES_PREDATING_THE_RULE } from "../scripts/data-lifecycle-table-coverage-check";
import {
  blankComments,
  collectLedgerInventory,
  deriveColumns
} from "../scripts/data-lifecycle-ledger-inventory";

const ROOT = join(import.meta.dir, "..");
const DOCS = [
  "legacy-ledger-pii-inventory.md",
  "legacy-ledger-pii-inventory.id.md"
];

/** Rows of the ranked inventory (prettier pads the cells, so match loosely). */
function inventoryRows(markdown: string): { rank: number; table: string }[] {
  const start = markdown.indexOf("## 5.");
  const end = markdown.indexOf("### ", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return [
    ...markdown
      .slice(start, end)
      .matchAll(/^\|\s*(\d+)\s*\|\s*`(awcms_[a-z0-9_]+)`\s*\|/gm)
  ].map((m) => ({ rank: Number(m[1]), table: m[2]! }));
}

describe("legacy ledger PII inventory", () => {
  const inventory = collectLedgerInventory();

  test("the recount script covers exactly the ledger, once each", () => {
    expect(inventory.length).toBe(TABLES_PREDATING_THE_RULE.length);
    expect(inventory.map((t) => t.table)).toEqual([
      ...TABLES_PREDATING_THE_RULE
    ]);
    expect(new Set(inventory.map((t) => t.table)).size).toBe(inventory.length);
  });

  test("every ledger table was found in sql/ with columns", () => {
    for (const t of inventory) {
      expect(t.createdAt).not.toContain("not found");
      expect(t.columns.length).toBeGreaterThan(2);
      // Keyed by `id`, by `tenant_id` (one row per tenant) or by `module_key`
      // (global catalogue): a parser that lost the key column lost the table.
      expect(
        t.columns.some((c) =>
          ["id", "tenant_id", "module_key"].includes(c.name)
        )
      ).toBe(true);
    }
  });

  test("column folding applies ADD, DROP and RENAME in order", () => {
    const files = [
      {
        name: "001_awcms_a.sql",
        sql: "-- CREATE TABLE awcms_x (ghost text);\nCREATE TABLE awcms_x (\n  id uuid,\n  email text NOT NULL,\n  CONSTRAINT x_pk PRIMARY KEY (id)\n);"
      },
      {
        name: "002_awcms_b.sql",
        sql: "ALTER TABLE awcms_x ADD COLUMN IF NOT EXISTS phone text, ADD COLUMN note text;\nALTER TABLE awcms_x DROP COLUMN note;\nALTER TABLE awcms_x RENAME COLUMN email TO login;"
      }
    ];
    const got = deriveColumns(files, new Set(["awcms_x"])).get("awcms_x")!;
    expect(got.columns.map((c) => c.name)).toEqual(["id", "login", "phone"]);
    expect(got.columns[0]!.source).toBe("001_awcms_a.sql:3");
    expect(blankComments("a -- b\nc").split("\n").length).toBe(2);
  });

  for (const name of DOCS) {
    test(`${name} lists every ledger table exactly once, in rank order`, () => {
      const rows = inventoryRows(
        readFileSync(join(ROOT, "docs/awcms", name), "utf8")
      );
      expect(rows.map((r) => r.table).sort()).toEqual(
        [...TABLES_PREDATING_THE_RULE].sort()
      );
      expect(rows.map((r) => r.rank)).toEqual(rows.map((_, i) => i + 1));
    });

    test(`${name} states the recounted number`, () => {
      const text = readFileSync(join(ROOT, "docs/awcms", name), "utf8");
      expect(text).toContain(`**${TABLES_PREDATING_THE_RULE.length}**`);
    });
  }
});
