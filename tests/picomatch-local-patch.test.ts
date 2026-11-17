/**
 * Guards the local picomatch patch for GHSA-fc5q-39xc-vjpf (see
 * scripts/dependency-audit-exceptions.ts). If a dependency bump drops or
 * no longer applies the patch, the advisory's proof-of-concept patterns would
 * hang again; these tests fail fast instead.
 */
import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const POC_PATTERNS = ["+(*)", "+(*a)", "*(*)", "*(*a)", "+(*)a", "+(*a|*b)"];
const INPUT = `${"a".repeat(40)}!`;

const copies: Array<[string, string]> = [
  ["picomatch (top level)", require.resolve("picomatch")],
  [
    "picomatch (via anymatch)",
    require.resolve("picomatch", { paths: [require.resolve("anymatch")] })
  ]
];

describe("local picomatch patch (GHSA-fc5q-39xc-vjpf)", () => {
  test("package.json declares both patches", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8")
    );
    expect(Object.keys(pkg.patchedDependencies ?? {}).sort()).toEqual([
      "picomatch@2.3.2",
      "picomatch@4.0.7"
    ]);
  });

  for (const [label, entry] of copies) {
    test(`${label}: proof-of-concept patterns finish quickly`, () => {
      const pm = require(entry);
      for (const pattern of POC_PATTERNS) {
        const started = performance.now();
        pm(pattern)(INPUT);
        expect(performance.now() - started).toBeLessThan(250);
      }
    });

    test(`${label}: ordinary globs still match`, () => {
      const pm = require(entry);
      expect(pm("**/*.ts")("src/a.ts")).toBe(true);
      expect(pm("{a,b}/*.md")("a/x.md")).toBe(true);
      expect(pm("!**/node_modules/**")("x/node_modules/y")).toBe(false);
    });
  }
});
