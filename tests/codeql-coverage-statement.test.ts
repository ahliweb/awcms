/**
 * CodeQL runs, and says what it does NOT cover — gap C16 of
 * `docs/awcms/standar-performa-dan-keamanan.md` §9.
 *
 * The workflow itself is not the finding: CodeQL has been scanning this repo
 * for months. The finding was the sentence next to it. The matrix comment read
 * "TypeScript/Astro source", and CodeQL ships no Astro extractor — so 42
 * `.astro` files (22.328 lines, the same surface `astro check` cannot reach
 * either, gap C4) were outside every scan while the repo's own comment told
 * readers they were inside it. A claim larger than the scan is worse than no
 * claim, because it is the one people cite when asked whether the code is
 * analysed.
 *
 * `awcms-astro` bound itself to the same honesty condition in its ADR-0032 §A
 * and guards it with `tests/analisis-statik.test.mjs`. This is that guard on
 * this side: the declaration step cannot be deleted quietly, and its numbers
 * cannot quietly become hand-written ones — the failure mode that turns a
 * coverage statement back into a claim as soon as a file is added.
 *
 * Plain file reads: no CodeQL run, no network.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";

const ROOT = path.resolve(import.meta.dir, "..");
const WORKFLOW = ".github/workflows/codeql.yml";

const workflow = readFileSync(path.join(ROOT, WORKFLOW), "utf8");

/** The `- name: State coverage` step, up to the next same-indent step. */
function coverageStep(): string {
  const start = workflow.indexOf("- name: State coverage");
  expect(start).toBeGreaterThan(-1);

  const rest = workflow.slice(start + 1);
  const next = rest.indexOf("\n      - ");

  return next === -1 ? rest : rest.slice(0, next);
}

describe("codeql.yml — the scan itself", () => {
  test("analyses the source language and runs on a schedule", () => {
    expect(workflow).toContain("language: javascript-typescript");
    // Weekly rescan: CodeQL's queries keep improving, so code that has not
    // changed still deserves to be scanned again.
    expect(workflow).toMatch(/schedule:\s*\n\s*- cron:/);
  });

  test("every action is pinned to a commit SHA with a readable version comment", () => {
    const uses = [...workflow.matchAll(/uses:\s*(\S+)/g)].map(
      (match) => match[1]
    );

    expect(uses.length).toBeGreaterThan(0);

    for (const reference of uses) {
      expect(reference).toMatch(/@[0-9a-f]{40}$/);
    }

    for (const line of workflow
      .split("\n")
      .filter((l) => l.includes("uses:"))) {
      expect(line).toMatch(/#\s*v\d/);
    }
  });
});

describe("codeql.yml — the coverage statement", () => {
  test("the step exists and is bound to the source language only", () => {
    const step = coverageStep();

    // `always()` so a failed analysis still tells the reader what the scan
    // would and would not have covered; the language guard keeps the `.astro`
    // sentence off the `actions` leg, where it would be false.
    expect(step).toContain("always()");
    expect(step).toContain("matrix.language == 'javascript-typescript'");
    expect(step).toContain("GITHUB_STEP_SUMMARY");
  });

  test("it names `.astro` as NOT analysed, and says why", () => {
    const step = coverageStep();

    expect(step).toContain(".astro");
    expect(step).toContain("NOT analysed");
    expect(step.toLowerCase()).toContain("no astro extractor");
  });

  test("the numbers are computed at run time, never written by hand", () => {
    const step = coverageStep();

    // Two counts, both from `git ls-files` — the tracked-file list the
    // extractor actually reads. A directory list (or a `find` over one) is a
    // hand-written number in another shape: it drops whatever sits outside
    // the directories someone remembered.
    expect(step).toContain("git ls-files '*.ts' '*.mjs' '*.js'");
    expect(step).toContain("git ls-files '*.astro'");

    // The summary must interpolate those variables rather than state a
    // literal. Without this, "42 .astro files" survives the 43rd file.
    expect(step).toContain("${ANALYSED}");
    expect(step).toContain("${ASTRO}");
    expect(step).not.toMatch(/\b\d+\s+`?\\?`?\.astro\s+files/);
  });

  test("the matrix comment no longer claims Astro is analysed", () => {
    const matrixComment = workflow.slice(
      0,
      workflow.indexOf("- language: javascript-typescript")
    );

    expect(matrixComment).not.toContain("TypeScript/Astro source");
    expect(matrixComment).toContain("no Astro extractor");
  });
});

describe("codeql.yml — the surface it claims to cover is real", () => {
  test("the analysed extensions are the ones this repo actually writes", () => {
    const step = coverageStep();

    for (const extension of ["*.ts", "*.mjs", "*.js", "*.astro"]) {
      expect(step).toContain(extension);
    }
  });
});
