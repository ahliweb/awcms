/**
 * The offline gate that ties exact-version `overrides` to the held-back
 * register (Issue #1367).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  checkTransitiveHolds,
  isExactVersion,
  resolvedVersionFromLock
} from "../scripts/dependency-held-back-check";
import { HELD_BACK, type HeldBackEntry } from "../scripts/dependency-held-back";

const LOCK = `{
  "packages": {
    "@astrojs/compiler-rs": ["@astrojs/compiler-rs@0.5.2", "", {}, "sha512-x"],

    "postcss": ["postcss@8.5.23", "", {}, "sha512-y"],

    "astro/@astrojs/compiler-rs": ["@astrojs/compiler-rs@0.5.3", "", {}, "sha512-z"],
  }
}`;

const entry: HeldBackEntry = {
  packageName: "@astrojs/compiler-rs",
  transitive: true,
  heldVersion: "0.5.2",
  reason: "x".repeat(70),
  releaseCondition: "A binding release that runs on the x86-64 baseline.",
  owner: "ahliweb",
  reviewDate: "2099-01-01"
};

describe("isExactVersion / resolvedVersionFromLock", () => {
  test("exact versus range", () => {
    expect(isExactVersion("0.5.2")).toBe(true);
    expect(isExactVersion("1.0.0-rc.1")).toBe(true);
    expect(isExactVersion("^8.5.23")).toBe(false);
    expect(isExactVersion(">=1.0.0")).toBe(false);
  });

  test("reads the top-level resolution, not a nested copy", () => {
    expect(resolvedVersionFromLock(LOCK, "@astrojs/compiler-rs")).toBe("0.5.2");
    expect(resolvedVersionFromLock(LOCK, "postcss")).toBe("8.5.23");
    expect(resolvedVersionFromLock(LOCK, "absent")).toBeNull();
  });
});

describe("checkTransitiveHolds", () => {
  const overrides = { "@astrojs/compiler-rs": "0.5.2", postcss: "^8.5.23" };

  test("a matching transitive entry passes; range overrides are ignored", () => {
    expect(
      checkTransitiveHolds({ entries: [entry], overrides, lockText: LOCK })
    ).toEqual([]);
  });

  test("an exact override without an entry is red", () => {
    const problems = checkTransitiveHolds({
      entries: [],
      overrides,
      lockText: LOCK
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("no `transitive: true` entry");
  });

  test("a transitive entry without an override is red", () => {
    const problems = checkTransitiveHolds({
      entries: [entry],
      overrides: { postcss: "^8.5.23" },
      lockText: LOCK
    });

    expect(problems.join("\n")).toContain("has no entry for it");
  });

  test("version mismatches against overrides or bun.lock are red", () => {
    expect(
      checkTransitiveHolds({
        entries: [{ ...entry, heldVersion: "0.5.1" }],
        overrides,
        lockText: LOCK
      }).length
    ).toBeGreaterThanOrEqual(2);

    expect(
      checkTransitiveHolds({
        entries: [entry],
        overrides,
        lockText: LOCK.replace(
          '"@astrojs/compiler-rs@0.5.2"',
          '"@astrojs/compiler-rs@0.5.3"'
        )
      }).join("\n")
    ).toContain("bun.lock resolves 0.5.3");
  });

  test("a transitive entry needs a release condition", () => {
    const bare: HeldBackEntry = { ...entry };

    delete bare.releaseCondition;

    expect(
      checkTransitiveHolds({
        entries: [bare],
        overrides,
        lockText: LOCK
      }).join("\n")
    ).toContain("releaseCondition");
  });
});

describe("the repository itself", () => {
  test("package.json overrides, bun.lock and HELD_BACK agree", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      overrides?: Record<string, string>;
    };

    expect(
      checkTransitiveHolds({
        entries: HELD_BACK,
        overrides: pkg.overrides ?? {},
        lockText: readFileSync("bun.lock", "utf8")
      })
    ).toEqual([]);
  });
});
