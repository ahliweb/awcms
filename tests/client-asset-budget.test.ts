/**
 * `build:asset-budget:check` — the C6 gate, driven with planted fixtures.
 *
 * The live `dist/client` passing proves little: the budgets were derived from
 * it. What has to hold is that the gate FAILS on the shapes it exists for — a
 * total over budget, a single oversized file inside a healthy total, a missing
 * `dist/client`, an empty one — and passes only the under-budget shape. Every
 * case here plants its own directory under a temp root and hands explicit
 * budgets to `evaluateBudget`, so the tests stay pinned to behaviour, not to
 * whatever the real budget constants are this month.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  evaluateBudget,
  formatFailure,
  measureClientAssets,
  PER_FILE_BUDGET_BYTES,
  TOTAL_BUDGET_BYTES,
  type Budget
} from "../scripts/client-asset-budget";

const BUDGET: Budget = { totalBudgetBytes: 100, perFileBudgetBytes: 60 };

const tempRoots: string[] = [];

async function plantDirectory(files: Record<string, number>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "client-asset-budget-"));
  tempRoots.push(root);

  for (const [relative, bytes] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, "x".repeat(bytes));
  }

  return root;
}

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("measureClientAssets", () => {
  test("sums nested files and sorts them largest-first", async () => {
    const root = await plantDirectory({
      "_astro/big.js": 50,
      "_astro/small.css": 10,
      "js/nested/deep.js": 30
    });

    const measurement = await measureClientAssets(root);

    expect(measurement.totalBytes).toBe(90);
    expect(measurement.files.map((file) => file.path)).toEqual([
      path.join("_astro", "big.js"),
      path.join("js", "nested", "deep.js"),
      path.join("_astro", "small.css")
    ]);
  });

  test("a missing directory rejects instead of measuring zero", async () => {
    await expect(
      measureClientAssets(
        path.join(os.tmpdir(), "client-asset-budget-does-not-exist")
      )
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("evaluateBudget", () => {
  test("under both budgets passes", async () => {
    const root = await plantDirectory({ "a.js": 40, "b.css": 40 });

    const report = evaluateBudget(await measureClientAssets(root), BUDGET);

    expect(report.ok).toBe(true);
    expect(report.overTotal).toBe(false);
    expect(report.oversizedFiles).toEqual([]);
  });

  test("a total over budget fails even when every file is small", async () => {
    const root = await plantDirectory({ "a.js": 50, "b.js": 50, "c.js": 50 });

    const report = evaluateBudget(await measureClientAssets(root), BUDGET);

    expect(report.ok).toBe(false);
    expect(report.overTotal).toBe(true);
    expect(report.oversizedFiles).toEqual([]);
  });

  test("one oversized file fails even when the total is healthy", async () => {
    const root = await plantDirectory({ "chunk.js": 70, "tiny.css": 10 });

    const report = evaluateBudget(await measureClientAssets(root), BUDGET);

    expect(report.ok).toBe(false);
    expect(report.overTotal).toBe(false);
    expect(report.oversizedFiles).toEqual([{ path: "chunk.js", bytes: 70 }]);
  });

  test("an empty directory fails — the build always emits assets", async () => {
    const root = await plantDirectory({});

    const report = evaluateBudget(await measureClientAssets(root), BUDGET);

    expect(report.ok).toBe(false);
    expect(report.empty).toBe(true);
  });

  test("exactly on budget passes: the limit is exceed, not reach", async () => {
    const root = await plantDirectory({ "a.js": 60, "b.js": 40 });

    const report = evaluateBudget(await measureClientAssets(root), BUDGET);

    expect(report.ok).toBe(true);
  });
});

describe("formatFailure", () => {
  test("names the broken budget and lists the five largest files", async () => {
    const root = await plantDirectory({
      "a.js": 90,
      "b.js": 26,
      "c.js": 25,
      "d.js": 24,
      "e.js": 23,
      "f.js": 22
    });

    const measurement = await measureClientAssets(root);
    const report = evaluateBudget(measurement, BUDGET);
    const lines = formatFailure(report, measurement, BUDGET).join("\n");

    expect(report.ok).toBe(false);
    expect(lines).toContain("total 210 B");
    expect(lines).toContain("a.js");
    expect(lines).toContain("e.js");
    // Only the five largest are listed; the sixth stays out.
    expect(lines).not.toContain("f.js");
  });
});

describe("the real budget constants", () => {
  test("stay ordered: per-file below total, both positive", () => {
    // A per-file budget at or above the total budget would make one of the
    // two rules unreachable — the gate would still print OK.
    expect(PER_FILE_BUDGET_BYTES).toBeGreaterThan(0);
    expect(TOTAL_BUDGET_BYTES).toBeGreaterThan(PER_FILE_BUDGET_BYTES);
  });
});
