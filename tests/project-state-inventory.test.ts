/**
 * `bun run project-state:inventory:generate|:check` — the derivation AND the
 * verdict, mutation-proven.
 *
 * The §2 table of `docs/PROJECT_STATE.md` went stale four times with CI green,
 * three of them on the same rows. The gate exists to end that, so the one
 * property this suite must prove is the gate's OWN ability to go red: a check
 * that stays green over a mutated number is the fourth episode wearing a
 * `.generated` badge — a false claim that reads MORE authoritative than the
 * hand-written table it replaced (the `awcms-gate-design-lessons` failure
 * mode). So every verdict here is tested in both directions: in-sync passes,
 * a single mutated digit between the markers fails, missing markers fail
 * hard.
 *
 * Pure — filesystem reads only, no database, no network.
 */
import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import {
  BEGIN,
  END,
  collectInventory,
  countCheckGates,
  diffAgainstFresh,
  extractBlock,
  formatRibuan,
  parseAdrStatus,
  parseInventoryRows,
  renderInventoryBlock,
  replaceBlock,
  type ProjectStateInventory
} from "../scripts/project-state-inventory";

const SAMPLE: ProjectStateInventory = {
  version: "6.4.0",
  moduleCount: 21,
  migrationCount: 90,
  migrationFirst: "001",
  migrationLast: "090",
  adrLowest: "0000",
  adrHighest: "0068",
  adrHighestStatus: "Accepted",
  adminScreenCount: 31,
  modulesWithoutNavigation: [],
  astroFileCount: 42,
  astroLineCount: 22328,
  checkGateCount: 34,
  contractVersion: "2.5.0"
};

function docWith(block: string): string {
  return `# Doc\n\n${BEGIN}\n\n${block}\n\n${END}\n\ntail\n`;
}

describe("pure helpers", () => {
  test("formatRibuan uses the Indonesian thousands separator", () => {
    expect(formatRibuan(22328)).toBe("22.328");
    expect(formatRibuan(999)).toBe("999");
    expect(formatRibuan(1234567)).toBe("1.234.567");
  });

  test("countCheckGates counts && segments, ignoring empties", () => {
    expect(countCheckGates("a && b && c")).toBe(3);
    expect(countCheckGates("a")).toBe(1);
    expect(countCheckGates("")).toBe(0);
  });

  test("parseAdrStatus reads the status line and refuses to invent one", () => {
    expect(parseAdrStatus("# ADR\n\n- **Status:** Accepted\n")).toBe(
      "Accepted"
    );
    expect(parseAdrStatus("# ADR\n\nno status here\n")).toBeNull();
  });
});

describe("render/parse round trip", () => {
  test("the check compares CONTENT, so prettier's column padding is not drift", () => {
    const rendered = renderInventoryBlock(SAMPLE);
    // Pad only REAL cell boundaries — prettier never touches the `\|` escapes
    // inside a cell, so neither does this simulation.
    const padded = rendered
      .split("\n")
      .map((line) =>
        line.startsWith("|") ? line.replace(/(?<!\\)\| /g, "|      ") : line
      )
      .join("\n");

    expect(parseInventoryRows(padded)).toEqual(parseInventoryRows(rendered));
  });

  test("an escaped \\| inside a cell stays ONE cell — the changeset command survives parsing", () => {
    const rows = parseInventoryRows(renderInventoryBlock(SAMPLE));
    const changesetRow = rows.find((cells) =>
      cells[0]!.startsWith("Pending changesets")
    );

    expect(changesetRow).toHaveLength(3);
    expect(changesetRow![2]).toContain("sort \\| uniq -c");
  });

  test("replaceBlock round-trips through extractBlock", () => {
    const block = renderInventoryBlock(SAMPLE);
    const updated = replaceBlock(docWith("old"), block);

    expect(extractBlock(updated)).toBe(block);
    expect(updated).toContain("# Doc");
    expect(updated).toContain("tail");
  });

  test("replaceBlock refuses a document with no markers rather than appending", () => {
    expect(() => replaceBlock("# no markers\n", "x")).toThrow(/markers/);
  });
});

describe("the verdict, mutation-proven", () => {
  const fresh = renderInventoryBlock(SAMPLE);

  test("a document in sync passes", () => {
    expect(diffAgainstFresh(docWith(fresh), fresh)).toEqual([]);
  });

  test("mutating ONE digit between the markers fails the check and names the row", () => {
    // The exact shape of episode four: the migration count fell behind by one.
    const mutated = fresh.replace("**90**", "**89**");
    expect(mutated).not.toBe(fresh);

    const problems = diffAgainstFresh(docWith(mutated), fresh);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("Migrations");
    expect(problems[0]).toContain("is stale");
  });

  test("a fast row edited back INTO a number fails too — deletion is enforced, not suggested", () => {
    const mutated = fresh.replace(
      "Pending changesets (by bump type) | _run the command in the right-hand column_",
      "Changeset menunggu (per tipe bump) | **101 menunggu**"
    );
    expect(mutated).not.toBe(fresh);

    expect(diffAgainstFresh(docWith(mutated), fresh)).not.toEqual([]);
  });

  test("a row added by hand between the markers fails the check", () => {
    const mutated = `${fresh}\n| Baris liar | **1** | tebakan |`;

    const problems = diffAgainstFresh(docWith(mutated), fresh);

    expect(problems.some((p) => p.includes("Baris liar"))).toBe(true);
  });

  test("missing markers fail hard, not silently", () => {
    const problems = diffAgainstFresh("# doc without markers\n", fresh);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("penanda");
  });
});

describe("cross-artefact: the real document is in sync", () => {
  // The same assertion the `check`-chain gate makes, run inside the test suite
  // so `bun test tests/project-state-inventory.test.ts` alone proves the doc.
  test("docs/PROJECT_STATE.md §2 matches a fresh derivation from the repo", () => {
    const markdown = readFileSync("docs/PROJECT_STATE.md", "utf8");
    const fresh = renderInventoryBlock(collectInventory());

    expect(diffAgainstFresh(markdown, fresh)).toEqual([]);
  });

  test("the real inventory is sane where zeros would mean a broken walk, not an empty repo", () => {
    const data = collectInventory();

    expect(data.moduleCount).toBeGreaterThan(0);
    expect(data.migrationCount).toBeGreaterThan(0);
    expect(data.adminScreenCount).toBeGreaterThan(0);
    expect(data.astroFileCount).toBeGreaterThan(0);
    expect(data.astroLineCount).toBeGreaterThan(data.astroFileCount);
    // The gate this suite belongs to is itself in the chain it counts.
    expect(data.checkGateCount).toBeGreaterThanOrEqual(34);
    expect(data.adrHighestStatus.length).toBeGreaterThan(0);
  });
});
