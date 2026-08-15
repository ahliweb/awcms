/**
 * `scripts:inventory:check` — the three ways `scripts/README.md` went wrong.
 *
 * The table it replaces listed 12 of 52 scripts, and its companion "not yet
 * ported" table named fifteen tools that had already landed — several of them
 * IN the `bun run check` chain. Those are different failures and need different
 * rules:
 *
 * 1. **Omission** — a target exists and the inventory does not mention it. The
 *    block is generated, so any drift is a mismatch against a fresh render.
 * 2. **A false ABSENCE claim** — the deferred table says a target does not
 *    exist yet, and it does. This is the dangerous direction: a negative claim
 *    gets more wrong with time and never fails on its own, so a reader
 *    concludes `db:work-class:check` still needs building and builds a second.
 * 3. **Half-stale generation** (#442) — the table is right and the counts
 *    sentence above it is not. Nobody typed that; two rebased branches wrote
 *    the identical sentence from different bases and git merged only the rows.
 *    The old check compared rows, so it had nothing to say.
 *
 * Every case plants a violation.
 */
import { describe, expect, test } from "bun:test";

import {
  buildInventory,
  extractInventoryBlock,
  findFalseAbsenceClaims,
  normalizeInventoryBlock,
  parseInventoryBlock,
  readPackageScripts,
  renderInventory,
  replaceInventoryBlock
} from "../scripts/scripts-inventory";

const SCRIPTS = {
  check: "bun run lint && bun run modules:dag:check && bun run typecheck",
  lint: "prettier --check .",
  "modules:dag:check": "bun scripts/validate-module-graph.ts",
  "db:migrate": "bun scripts/db-migrate.ts",
  dev: "astro dev"
};

describe("buildInventory", () => {
  test("lists only targets that run a file in scripts/", () => {
    const rows = buildInventory(SCRIPTS);

    expect(rows.map((row) => row.target)).toEqual([
      "db:migrate",
      "modules:dag:check"
    ]);
    // `lint` and `dev` run no script of their own; `check` only composes.
    expect(rows.map((row) => row.script)).toEqual([
      "db-migrate.ts",
      "validate-module-graph.ts"
    ]);
  });

  test("marks membership of the check chain", () => {
    const rows = buildInventory(SCRIPTS);

    expect(rows.find((r) => r.target === "modules:dag:check")!.inCheck).toBe(
      true
    );
    expect(rows.find((r) => r.target === "db:migrate")!.inCheck).toBe(false);
  });

  test("the LAST entry in the chain still counts as gated", () => {
    // `chain.includes("bun run x ")` alone misses the final entry, which has no
    // trailing space — that would silently under-report the most recently
    // appended gate.
    const rows = buildInventory({
      check: "bun run lint && bun run modules:dag:check",
      "modules:dag:check": "bun scripts/validate-module-graph.ts"
    });

    expect(rows[0]!.inCheck).toBe(true);
  });
});

describe("the generated block", () => {
  test("parsing tolerates the column padding prettier adds", () => {
    // Prettier owns markdown formatting and aligns table columns. A byte
    // comparison would fail right after every `bun run lint`, so the check
    // asserts CONTENT — padding is not drift.
    const padded = [
      "| Target             | Script                     | Gate |",
      "| ------------------ | -------------------------- | ---- |",
      "| `modules:dag:check`| `validate-module-graph.ts` | ✅   |"
    ].join("\n");

    expect(parseInventoryBlock(padded)).toEqual([
      {
        target: "modules:dag:check",
        script: "validate-module-graph.ts",
        inCheck: true
      }
    ]);
  });

  test("round-trips: replace then extract returns what was rendered", () => {
    const rendered = renderInventory(buildInventory(SCRIPTS));
    const readme = [
      "# Scripts",
      "<!-- BEGIN GENERATED: script-inventory -->",
      "<!-- END GENERATED: script-inventory -->",
      "## Deferred"
    ].join("\n");

    expect(extractInventoryBlock(replaceInventoryBlock(readme, rendered))).toBe(
      rendered
    );
  });

  test("a README without markers fails loudly rather than silently doing nothing", () => {
    expect(() => extractInventoryBlock("# Scripts\n")).toThrow(
      /missing the generated-block markers/
    );
  });
});

describe("the counts sentence is compared too (#442)", () => {
  // The rows-only comparison covered exactly what git cannot silently merge
  // wrong and skipped what it can. Every case here plants the drift that
  // actually shipped: a table that is right above a sentence that is not.
  const rendered = renderInventory(buildInventory(SCRIPTS));

  test("a mutation of ONLY the counts sentence is drift", () => {
    const mutated = rendered.replace("2 targets run", "1 targets run");

    expect(mutated).not.toBe(rendered);
    // The rows are untouched, so the old comparison had nothing to say.
    expect(parseInventoryBlock(mutated)).toEqual(parseInventoryBlock(rendered));
    expect(normalizeInventoryBlock(mutated)).not.toBe(
      normalizeInventoryBlock(rendered)
    );
  });

  test("a mutation of ONLY the gated count is drift", () => {
    const mutated = rendered.replace("; 1 of them are", "; 0 of them are");

    expect(mutated).not.toBe(rendered);
    expect(parseInventoryBlock(mutated)).toEqual(parseInventoryBlock(rendered));
    expect(normalizeInventoryBlock(mutated)).not.toBe(
      normalizeInventoryBlock(rendered)
    );
  });

  test("what prettier rewrites is still not drift", () => {
    // Padding and the stretched separator dashes must survive normalization,
    // or the gate fights `bun run lint` forever — the reason it parsed in the
    // first place.
    const padded = rendered
      .replace("| Target | Script | Gate |", "| Target      | Script | Gate |")
      .replace("| ------ | ----- | ---- |", "| ----------- | ----- | ---- |")
      .replace("| `db:migrate` |", "| `db:migrate`  |");

    expect(padded).not.toBe(rendered);
    expect(normalizeInventoryBlock(padded)).toBe(
      normalizeInventoryBlock(rendered)
    );
  });

  test("a blank line added by an editor is not drift either", () => {
    expect(normalizeInventoryBlock(`${rendered}\n\n`)).toBe(
      normalizeInventoryBlock(rendered)
    );
  });
});

describe("findFalseAbsenceClaims", () => {
  test("flags the defect this gate exists for: a shipped tool listed as not-yet-ported", () => {
    const readme = [
      "## Deferred",
      "",
      "| Target acuan | Prasyarat |",
      "| --- | --- |",
      "| `db:work-class:check` | Tabel/registry work-class |"
    ].join("\n");

    expect(findFalseAbsenceClaims(readme, SCRIPTS)).toEqual([]);
    expect(
      findFalseAbsenceClaims(readme, {
        ...SCRIPTS,
        "db:work-class:check": "bun scripts/work-class-registry-check.ts"
      })
    ).toEqual(["db:work-class:check"]);
  });

  test("prose in that section is not a claim — only table rows are", () => {
    // Not hypothetical: the section explains the rule and names a real target
    // while doing so, and scanning it wholesale made the gate report itself on
    // its very first run.
    const readme = [
      "## Deferred",
      "",
      "`scripts:inventory:check` menolak kalau nama di bawah sudah terdaftar.",
      "",
      "| Target acuan | Prasyarat |",
      "| --- | --- |",
      "| `i18n:extract` | Setup i18n |"
    ].join("\n");

    expect(
      findFalseAbsenceClaims(readme, {
        ...SCRIPTS,
        "scripts:inventory:check": "bun scripts/scripts-inventory.ts --check"
      })
    ).toEqual([]);
  });

  test("a README with no deferred section makes no claims", () => {
    expect(findFalseAbsenceClaims("# Scripts\n", SCRIPTS)).toEqual([]);
  });
});

describe("the real repository", () => {
  test("the inventory block matches a fresh regeneration", async () => {
    const readme = await Bun.file("scripts/README.md").text();

    expect(parseInventoryBlock(extractInventoryBlock(readme))).toEqual(
      buildInventory(await readPackageScripts())
    );
  });

  test("the deferred table names nothing that already exists", async () => {
    expect(
      findFalseAbsenceClaims(
        await Bun.file("scripts/README.md").text(),
        await readPackageScripts()
      )
    ).toEqual([]);
  });

  test("every target that runs a script is in the inventory", async () => {
    // The omission half, stated directly rather than only implied by the
    // round-trip: 12 of 52 was the state this replaced.
    const readme = await Bun.file("scripts/README.md").text();
    const rows = buildInventory(await readPackageScripts());
    const listed = new Set(
      parseInventoryBlock(extractInventoryBlock(readme)).map((r) => r.target)
    );

    expect(rows.length).toBeGreaterThan(50);
    for (const row of rows) {
      expect(listed.has(row.target)).toBe(true);
    }
  });

  test("the counts sentence states the truth, not a remembered number", async () => {
    // Derived here from package.json rather than from renderInventory, so the
    // assertion survives the generator and the checker being wrong together.
    const readme = await Bun.file("scripts/README.md").text();
    const scripts = await readPackageScripts();
    const targets = Object.entries(scripts).filter(([, command]) =>
      /scripts\//.test(command)
    );
    const chain = (scripts.check ?? "")
      .split("&&")
      .map((segment) => segment.trim().replace(/^bun run /, ""));
    const gated = targets.filter(([target]) => chain.includes(target));

    expect(extractInventoryBlock(readme)).toContain(
      `${targets.length} targets run a file in \`scripts/\`; ${gated.length} of them are`
    );
  });

  test("the whole generated block matches a fresh render, not only its rows", async () => {
    const readme = await Bun.file("scripts/README.md").text();

    expect(normalizeInventoryBlock(extractInventoryBlock(readme))).toBe(
      normalizeInventoryBlock(
        renderInventory(buildInventory(await readPackageScripts()))
      )
    );
  });

  test("is wired into `bun run check`", async () => {
    const scripts = await readPackageScripts();

    expect(scripts["scripts:inventory:generate"]).toBeDefined();
    expect(scripts.check).toContain("scripts:inventory:check");
  });
});
