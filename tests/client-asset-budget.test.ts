/**
 * `build:asset-budget:check` — the C6 gate, driven with planted fixtures.
 *
 * The live `dist/client` passing proves little: the budgets were derived from
 * it. What has to hold is that the gate FAILS on the shapes it exists for — a
 * surface over budget, a single oversized file inside a healthy total, a
 * missing `dist/client`, an empty one, and (since ADR-0101) an asset whose
 * audience nobody declared — and passes only the under-budget shape.
 *
 * Every case plants its own directory under a temp root and hands explicit
 * budgets AND an explicit registry to `evaluateBudget`, so the tests stay
 * pinned to behaviour, not to whatever the real constants are this month.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  APP_BUDGET_BYTES,
  classifyAsset,
  evaluateBudget,
  formatFailure,
  measureClientAssets,
  PER_FILE_BUDGET_BYTES,
  PUBLIC_ASSET_AUDIENCE,
  READER_BUDGET_BYTES,
  type Audience,
  type Budget
} from "../scripts/client-asset-budget";

const BUDGET: Budget = {
  readerBudgetBytes: 100,
  appBudgetBytes: 100,
  perFileBudgetBytes: 60
};

/** Two declared public files, so fixtures can exercise both audiences. */
const REGISTRY: Readonly<Record<string, Audience>> = {
  "css/reader.css": "reader",
  "worker.js": "app"
};

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

/** The two declared files at a negligible size, so a case can ignore them. */
const DECLARED_BASELINE = { "css/reader.css": 1, "worker.js": 1 };

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
      "_astro/small.js": 10,
      "_astro/nested/big.css": 30
    });

    const measurement = await measureClientAssets(root);

    expect(measurement.totalBytes).toBe(40);
    expect(measurement.files.map((file) => file.bytes)).toEqual([30, 10]);
  });

  test("a missing directory rejects instead of measuring zero", async () => {
    await expect(
      measureClientAssets(path.join(os.tmpdir(), "definitely-not-here-590"))
    ).rejects.toThrow();
  });
});

describe("classifyAsset", () => {
  test("_astro output is app-surface structurally, with no list to maintain", () => {
    expect(classifyAsset("_astro/anything.Ab12.js", REGISTRY)).toBe("app");
    expect(classifyAsset("_astro/nested/deep.css", REGISTRY)).toBe("app");
  });

  test("a public/ file takes the audience the registry declares", () => {
    expect(classifyAsset("css/reader.css", REGISTRY)).toBe("reader");
    expect(classifyAsset("worker.js", REGISTRY)).toBe("app");
  });

  test("an undeclared public/ file classifies as nothing, not as a default", () => {
    // The whole point: silence must not resolve to an audience. If this
    // returned "app", a reader-facing file could be added and counted against
    // the loose budget — which is the defect ADR-0101 exists to prevent.
    expect(classifyAsset("css/surprise.css", REGISTRY)).toBeUndefined();
  });
});

describe("evaluateBudget", () => {
  test("under both budgets passes", async () => {
    const root = await plantDirectory({
      ...DECLARED_BASELINE,
      "_astro/a.js": 40
    });

    const report = evaluateBudget(
      await measureClientAssets(root),
      BUDGET,
      REGISTRY
    );

    expect(report.ok).toBe(true);
    expect(report.overReader).toBe(false);
    expect(report.overApp).toBe(false);
    expect(report.oversizedFiles).toEqual([]);
  });

  test("reader over budget fails while the app surface stays healthy", async () => {
    const root = await plantDirectory({
      "css/reader.css": 101,
      "worker.js": 1
    });

    const report = evaluateBudget(
      await measureClientAssets(root),
      BUDGET,
      REGISTRY
    );

    expect(report.ok).toBe(false);
    expect(report.overReader).toBe(true);
    expect(report.overApp).toBe(false);
    expect(report.readerBytes).toBe(101);
  });

  test("app over budget fails while the reader surface stays healthy", async () => {
    const root = await plantDirectory({
      ...DECLARED_BASELINE,
      "_astro/a.js": 50,
      "_astro/b.js": 50
    });

    const report = evaluateBudget(
      await measureClientAssets(root),
      BUDGET,
      REGISTRY
    );

    expect(report.ok).toBe(false);
    expect(report.overApp).toBe(true);
    expect(report.overReader).toBe(false);
  });

  test("reader growth is NOT absorbed by app headroom — the split's whole point", async () => {
    // Before ADR-0101 these 101 reader bytes were summed with everything else
    // against one ceiling, so app headroom paid for reader growth and the gate
    // stayed green. Here the app surface is nearly empty and it still fails.
    const root = await plantDirectory({
      "css/reader.css": 101,
      "worker.js": 1
    });

    const report = evaluateBudget(
      await measureClientAssets(root),
      BUDGET,
      REGISTRY
    );

    expect(report.totalBytes).toBeLessThan(
      BUDGET.readerBudgetBytes + BUDGET.appBudgetBytes
    );
    expect(report.ok).toBe(false);
  });

  test("an undeclared public/ asset fails, naming the file", async () => {
    const root = await plantDirectory({
      ...DECLARED_BASELINE,
      "css/snuck-in.css": 5
    });

    const measurement = await measureClientAssets(root);
    const report = evaluateBudget(measurement, BUDGET, REGISTRY);

    expect(report.ok).toBe(false);
    expect(report.undeclared).toEqual([{ path: "css/snuck-in.css", bytes: 5 }]);
    expect(formatFailure(report, measurement, BUDGET).join("\n")).toContain(
      "css/snuck-in.css"
    );
  });

  test("an undeclared asset counts against NEITHER budget", async () => {
    // It must not be quietly absorbed: a file nobody classified has to fail
    // loudly rather than inflate one surface's number and pass.
    const root = await plantDirectory({
      ...DECLARED_BASELINE,
      "mystery.js": 40
    });

    const report = evaluateBudget(
      await measureClientAssets(root),
      BUDGET,
      REGISTRY
    );

    expect(report.readerBytes).toBe(1);
    expect(report.appBytes).toBe(1);
    expect(report.totalBytes).toBe(42);
  });

  test("a declared file the build did not emit fails as a stale registry", async () => {
    const root = await plantDirectory({ "css/reader.css": 10 });

    const measurement = await measureClientAssets(root);
    const report = evaluateBudget(measurement, BUDGET, REGISTRY);

    expect(report.ok).toBe(false);
    expect(report.missing).toEqual(["worker.js"]);
    expect(formatFailure(report, measurement, BUDGET).join("\n")).toContain(
      "worker.js"
    );
  });

  test("one oversized file fails even when both surfaces are healthy", async () => {
    const root = await plantDirectory({
      ...DECLARED_BASELINE,
      "_astro/chunk.js": 70
    });

    const report = evaluateBudget(
      await measureClientAssets(root),
      BUDGET,
      REGISTRY
    );

    expect(report.ok).toBe(false);
    expect(report.overApp).toBe(false);
    expect(report.oversizedFiles).toEqual([
      { path: "_astro/chunk.js", bytes: 70 }
    ]);
  });

  test("an empty directory fails — the build always emits assets", async () => {
    const root = await plantDirectory({});

    const report = evaluateBudget(
      await measureClientAssets(root),
      BUDGET,
      REGISTRY
    );

    expect(report.ok).toBe(false);
    expect(report.empty).toBe(true);
  });

  test("exactly on budget passes: the limit is exceed, not reach", async () => {
    const root = await plantDirectory({
      "css/reader.css": 100,
      "worker.js": 1
    });

    const report = evaluateBudget(
      await measureClientAssets(root),
      BUDGET,
      REGISTRY
    );

    expect(report.readerBytes).toBe(100);
    expect(report.overReader).toBe(false);
  });
});

describe("formatFailure", () => {
  test("names the broken surface and lists the five largest files", async () => {
    const root = await plantDirectory({
      ...DECLARED_BASELINE,
      "_astro/a.js": 90,
      "_astro/b.js": 26,
      "_astro/c.js": 25,
      "_astro/d.js": 24,
      "_astro/e.js": 23,
      "_astro/f.js": 22
    });

    const measurement = await measureClientAssets(root);
    const report = evaluateBudget(measurement, BUDGET, REGISTRY);
    const lines = formatFailure(report, measurement, BUDGET).join("\n");

    expect(report.ok).toBe(false);
    expect(lines).toContain("APP assets");
    expect(lines).toContain("a.js");
    expect(lines).toContain("e.js");
    // Only the five largest are listed; the sixth stays out.
    expect(lines).not.toContain("f.js");
  });

  test("a reader breach says READER, so the reader budget is not mistaken for the app one", async () => {
    const root = await plantDirectory({
      "css/reader.css": 101,
      "worker.js": 1
    });

    const measurement = await measureClientAssets(root);
    const report = evaluateBudget(measurement, BUDGET, REGISTRY);
    const lines = formatFailure(report, measurement, BUDGET).join("\n");

    expect(lines).toContain("READER assets");
    expect(lines).not.toContain("APP assets");
  });
});

describe("the real budget constants and registry", () => {
  test("the per-file rule stays reachable on the app surface", () => {
    // A per-file budget at or above the APP budget would make one of the two
    // rules unreachable there — the gate would still print OK.
    expect(PER_FILE_BUDGET_BYTES).toBeGreaterThan(0);
    expect(APP_BUDGET_BYTES).toBeGreaterThan(PER_FILE_BUDGET_BYTES);
  });

  test("the reader budget binds TIGHTER than the per-file cap, by design", () => {
    // Deliberately inverted against the app surface: the reader budget
    // (24,000) is below the per-file cap (27,000), so a single reader-facing
    // file large enough to trip the per-file rule has already broken the
    // reader budget. The tighter of the two is the one that should fire, and
    // for the reader surface that is the surface budget — this asserts the
    // ordering is the intended one rather than an accident nobody noticed.
    expect(READER_BUDGET_BYTES).toBeGreaterThan(0);
    expect(READER_BUDGET_BYTES).toBeLessThan(PER_FILE_BUDGET_BYTES);
  });

  test("every declared audience is one of the two known values", () => {
    for (const audience of Object.values(PUBLIC_ASSET_AUDIENCE)) {
      expect(["reader", "app"]).toContain(audience);
    }
  });

  test("the registry is frozen, so a consumer cannot widen it at runtime", () => {
    expect(Object.isFrozen(PUBLIC_ASSET_AUDIENCE)).toBe(true);
  });

  test("at least one asset is declared reader-facing", () => {
    // If this ever reaches zero, the reader budget has stopped measuring
    // anything and would pass no matter what the public pages ship.
    expect(
      Object.values(PUBLIC_ASSET_AUDIENCE).filter((a) => a === "reader").length
    ).toBeGreaterThan(0);
  });
});
