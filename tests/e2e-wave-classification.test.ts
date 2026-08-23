/**
 * Every e2e spec is classified into a wave, and the read wave is guarded.
 *
 * ## What went wrong without this
 *
 * All e2e specs share ONE seeded tenant. Two of them change it tenant-wide —
 * `admin-roles.e2e.ts` adds a role that the `/admin/users` assign picker lists,
 * `admin-modules-toggle.e2e.ts` switches off `reporting`, which `/admin`
 * authorizes on. Under `fullyParallel: true` a reader could observe either
 * change mid-flight and fail describing a tenant nobody set up. That cost three
 * diagnoses, two of them wrong, and it kept a working read-only sweep off
 * `main`.
 *
 * The ordering fix lives in `playwright.config.ts`. This is what stops the
 * ordering from quietly becoming a lie.
 *
 * ## Two different things are checked, and only one is bookkeeping
 *
 * A new spec must be classified — that is bookkeeping, and it fails here rather
 * than in whichever unrelated file it eventually breaks.
 *
 * The claim that a read-wave spec only reads is NOT checked here, because it
 * cannot be: a spec's behaviour is not visible in its text. It is checked at run
 * time by the fixture in `tests/e2e/support/e2e-read-wave.ts`, which fails any
 * test that issues a mutating request to the app. What this file enforces is
 * that read-wave specs actually IMPORT that fixture — without which the label
 * would be a comment and the guard would never run.
 *
 * Pure — no database, no browser. Runs in `quality` on every PR, which is where
 * it is useful: the e2e suite itself is env-gated and skips wherever no tenant
 * is seeded.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { READ_WAVE, WRITE_WAVE, waveTestMatch } from "./e2e/support/e2e-waves";

const E2E_ROOT = path.resolve(import.meta.dir, "e2e");
const CONFIG = path.resolve(import.meta.dir, "../playwright.config.ts");

const GUARDED_IMPORT = './support/e2e-read-wave"';

function specFilesOnDisk(): string[] {
  return readdirSync(E2E_ROOT)
    .filter((name) => name.endsWith(".e2e.ts"))
    .sort();
}

function read(spec: string): string {
  return readFileSync(path.join(E2E_ROOT, spec), "utf8");
}

describe("e2e wave classification", () => {
  test("every spec on disk is in exactly one wave", () => {
    const onDisk = specFilesOnDisk();
    const classified = [...READ_WAVE, ...WRITE_WAVE].sort();

    // Not a set comparison in either direction alone: a duplicate would survive
    // one and a missing file would survive the other.
    expect(
      classified,
      "tests/e2e/support/e2e-waves.ts does not account for exactly the specs " +
        "that exist. A new spec must be classified: does it change tenant-wide " +
        "state (WRITE_WAVE), or only observe it (READ_WAVE)? Leaving it out is " +
        "not an option, because an unclassified spec would never run at all — " +
        "the projects match on these lists."
    ).toEqual(onDisk);

    expect(
      new Set(classified).size,
      "a spec appears in both waves, or twice in one"
    ).toBe(classified.length);
  });

  test("read-wave specs import the guarded test, write-wave specs do not", () => {
    for (const spec of READ_WAVE) {
      expect(
        read(spec).includes(GUARDED_IMPORT),
        `${spec} is in READ_WAVE but imports \`test\` from somewhere other ` +
          "than ./support/e2e-read-wave. The wave label is only a claim; that " +
          "fixture is what checks it at run time by failing on any mutating " +
          "request. Without the import the claim is unverified, and a spec that " +
          "starts writing would break OTHER files instead of this one."
      ).toBe(true);
    }

    for (const spec of WRITE_WAVE) {
      expect(
        read(spec).includes(GUARDED_IMPORT),
        `${spec} is in WRITE_WAVE but imports the read-wave guard, which fails ` +
          "on any mutating request. Either it belongs in READ_WAVE, or it " +
          "should import `test` from @playwright/test."
      ).toBe(false);
    }
  });

  test("the setup → read → write chain is what the config actually declares", () => {
    const config = readFileSync(CONFIG, "utf8");

    // The ordering is the whole mechanism. A config that stopped depending
    // `write` on `read` would run them concurrently again, and the symptom
    // would be an intermittent failure in a third file weeks later.
    expect(
      config,
      "playwright.config.ts no longer orders the waves. `write` must depend on " +
        "`read`, and `read` on `setup`."
    ).toContain('name: "read"');
    expect(config).toContain('dependencies: ["setup"]');
    expect(config).toContain('name: "write"');
    expect(config).toContain('dependencies: ["read"]');

    // And it must select the specs from the lists rather than from a glob that
    // silently picks up whatever is there — which would make the classification
    // decorative.
    expect(config).toContain("waveTestMatch(READ_WAVE)");
    expect(config).toContain("waveTestMatch(WRITE_WAVE)");
  });

  test("waveTestMatch produces globs Playwright can match a filename against", () => {
    expect(waveTestMatch(["a.e2e.ts", "b.e2e.ts"])).toEqual([
      "**/a.e2e.ts",
      "**/b.e2e.ts"
    ]);
  });

  test("auth.setup.ts is in neither wave — it is its own project", () => {
    // It does not end in `.e2e.ts`, so it cannot appear on disk in the list
    // above; asserting it explicitly documents that the setup project is
    // deliberately outside the classification rather than an oversight.
    expect([...READ_WAVE, ...WRITE_WAVE]).not.toContain("auth.setup.ts");
  });
});
