import { afterEach, describe, expect, test } from "bun:test";

import {
  parsePositiveIntSetting,
  resetEnvThresholdWarningsForTests
} from "../src/lib/security/env-thresholds";

/**
 * The defect these lock down (issue #593).
 *
 * `Number(process.env.X ?? 60)` guarded the three PUBLIC, UNAUTHENTICATED rate
 * limits in this repo — site search, search suggestions, and the setup
 * bootstrap. It fails open in one direction and closed in the other, and both
 * silently:
 *
 * - a non-numeric value yields `NaN`, every comparison against `NaN` is false,
 *   so the limiter never trips — while the `rate_limited` metric stays at zero
 *   and reads to an operator as evidence of no abuse;
 * - an EMPTY value is not `undefined`, so `??` does not fire; `Number("")` is
 *   `0`, and a ceiling of zero 429s every visitor on their first request.
 *
 * Each assertion below is written against the RAW expression as well, so the
 * test states what the old code actually did rather than only what the new code
 * does.
 */

afterEach(() => {
  resetEnvThresholdWarningsForTests();
});

describe("parsePositiveIntSetting", () => {
  test("absent falls back", () => {
    expect(parsePositiveIntSetting(undefined, 60, "X")).toBe(60);
  });

  test("a non-numeric value falls back instead of yielding NaN", () => {
    // The exact shape of the bug: a letter O for a zero.
    expect(Number("6O" as unknown as string)).toBeNaN();
    expect(parsePositiveIntSetting("6O", 60, "X")).toBe(60);

    // ...and the consequence the old code had, stated directly.
    const oldBehaviour = Number("6O");
    expect(5 > oldBehaviour).toBe(false);
    expect(5 > parsePositiveIntSetting("6O", 60, "X")).toBe(false);
    expect(500 > parsePositiveIntSetting("6O", 60, "X")).toBe(true);
  });

  test("an EMPTY value falls back rather than becoming zero", () => {
    // `??` never fires for "" because "" is not nullish, so the old expression
    // reached `Number("")`, which is 0 — a ceiling of zero, refusing everyone.
    // Typed as the env shape rather than the literal "", because `"" ?? 60` is
    // a compile error TypeScript is right to raise.
    const raw: string | undefined = "";
    expect(raw ?? 60).toBe("");
    expect(Number(raw ?? 60)).toBe(0);
    expect(parsePositiveIntSetting(raw, 60, "X")).toBe(60);
  });

  test("whitespace is treated as absent", () => {
    expect(parsePositiveIntSetting("   ", 60, "X")).toBe(60);
  });

  test("zero and negatives fall back — neither is a value an operator can mean", () => {
    // A ceiling of 0 refuses every request; a window of 0 divides by nothing.
    expect(parsePositiveIntSetting("0", 60, "X")).toBe(60);
    expect(parsePositiveIntSetting("-5", 60, "X")).toBe(60);
  });

  test("fractional values fall back", () => {
    expect(parsePositiveIntSetting("1.5", 60, "X")).toBe(60);
  });

  test("Infinity falls back — Number('Infinity') is finite-looking but useless as a ceiling", () => {
    expect(parsePositiveIntSetting("Infinity", 60, "X")).toBe(60);
  });

  test("a usable positive integer is returned unchanged", () => {
    expect(parsePositiveIntSetting("120", 60, "X")).toBe(120);
    expect(parsePositiveIntSetting(" 120 ", 60, "X")).toBe(120);
  });
});

describe("the call sites keep the literal process.env spelling", () => {
  /**
   * `config:env:coverage:check` resolves literal `process.env.NAME` reads and
   * `env.NAME` aliases; a COMPUTED read (`process.env[name]`) is invisible to
   * it, and its own header says such reads "need a human".
   *
   * So the helper takes the VALUE, never the name. If a future refactor
   * "tidies" these into `parsePositiveIntEnv("SITE_SEARCH_RATE_LIMIT_MAX", 60)`,
   * the variable silently stops being checked against `.env.example` and an
   * operator loses the only artefact telling them the knob exists. This test is
   * what makes that regression loud.
   */
  const FILES = [
    "src/pages/api/v1/site-search/query.ts",
    "src/pages/api/v1/site-search/suggest.ts",
    "src/pages/api/v1/setup/initialize.ts"
  ];

  const EXPECTED_LITERALS: Record<string, readonly string[]> = {
    "src/pages/api/v1/site-search/query.ts": [
      "process.env.SITE_SEARCH_RATE_LIMIT_MAX",
      "process.env.SITE_SEARCH_RATE_LIMIT_WINDOW_SEC"
    ],
    "src/pages/api/v1/site-search/suggest.ts": [
      "process.env.SITE_SEARCH_SUGGEST_RATE_LIMIT_MAX",
      "process.env.SITE_SEARCH_SUGGEST_RATE_LIMIT_WINDOW_SEC"
    ],
    "src/pages/api/v1/setup/initialize.ts": [
      "process.env.SETUP_RATE_LIMIT_MAX",
      "process.env.SETUP_RATE_LIMIT_WINDOW_SEC"
    ]
  };

  for (const file of FILES) {
    test(`${file} reads its thresholds literally and parses them safely`, async () => {
      const source = await Bun.file(file).text();

      for (const literal of EXPECTED_LITERALS[file]!) {
        expect(source).toContain(literal);
      }

      expect(source).toContain("parsePositiveIntSetting");

      // The raw coercion must be gone from these files entirely — a single
      // survivor is a limiter that can still be switched off by a typo.
      const withoutComments = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(withoutComments).not.toContain("Number(process.env");
    });
  }
});
