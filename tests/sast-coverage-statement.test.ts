/**
 * The security workflow (`keamanan.yml`, ADR-0173) keeps the promises the
 * CodeQL workflow used to keep, and states what it does NOT cover.
 *
 * `tests/codeql-coverage-statement.test.ts` left with `codeql.yml`. Gap C16 of
 * `docs/awcms/standar-performa-dan-keamanan.md` §9 was closed on the condition
 * that the scan STATES its coverage with numbers computed at run time, and the
 * comparison table there says every `uses:` is SHA-pinned. Without a guard,
 * both conditions would have left with the old workflow while the documents
 * kept citing them.
 *
 * Plain file reads: no scan, no network.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";

const ROOT = path.resolve(import.meta.dir, "..");
const WORKFLOW = ".github/workflows/keamanan.yml";

const workflow = readFileSync(path.join(ROOT, WORKFLOW), "utf8");

/** The `- name: <name>` step, up to the next same-indent step. */
function step(name: string): string {
  const start = workflow.indexOf(`- name: ${name}`);
  expect(start).toBeGreaterThan(-1);

  const rest = workflow.slice(start + 1);
  const next = rest.indexOf("\n      - ");

  return next === -1 ? rest : rest.slice(0, next);
}

describe("keamanan.yml — the required check", () => {
  test("the job name is the context the ruleset requires", () => {
    expect(workflow).toContain("name: keamanan / sast-rahasia-dependensi");
  });

  test("it runs on every pull request: no `paths` filter", () => {
    // A required check that is never reported blocks merging forever.
    expect(workflow).not.toMatch(/^\s+paths(-ignore)?:/m);
    expect(workflow).toMatch(/^on:\s*\n\s+pull_request:/m);
  });

  test("read-only token, and nothing is uploaded to code scanning", () => {
    expect(workflow).toMatch(/^permissions:\s*\n\s+contents: read\s*$/m);
    expect(workflow).not.toContain("security-events");
    expect(workflow).not.toContain("upload-sarif");
    expect(workflow).not.toContain("codeql-action");
  });

  test("every action is pinned to a commit SHA with a readable version comment", () => {
    const lines = workflow
      .split("\n")
      .filter((line) => /^\s*-?\s*uses:/.test(line));

    expect(lines.length).toBeGreaterThan(0);

    for (const line of lines) {
      expect(line).toMatch(/uses:\s*\S+@[0-9a-f]{40}\s+#\s*v\d/);
    }
  });
});

describe("keamanan.yml — the scan itself", () => {
  test("gitleaks scans the event's commit range, never the whole history", () => {
    const gitleaks = step("Gitleaks");

    expect(gitleaks).toContain("--redact");
    expect(gitleaks).toContain("sha256sum -c");
    expect(gitleaks).toContain('--log-opts="$rentang"');
    expect(gitleaks).toContain('rentang="${PR_BASE}..${PR_HEAD}"');
  });

  test("the SAST step runs the pinned script and excludes only `design`", () => {
    const sast = step('"SAST OpenGrep');

    expect(sast).toContain("bun tools/ci/sast/opengrep-scan.ts");
    const excludes = [...sast.matchAll(/--exclude[= ](\S+)/g)].map(
      (match) => match[1]
    );
    // Widening this list is how a scan quietly stops covering `src/` or the
    // workflows; it has to be argued for in ADR-0173 §Coverage first.
    expect(excludes).toEqual(["design"]);
  });

  test("the cache key carries the same engine pin as the script", () => {
    const script = readFileSync(
      path.join(ROOT, "tools/ci/sast/opengrep-scan.ts"),
      "utf8"
    );
    const version = /OPENGREP_VERSION = "(v[\d.]+)"/.exec(script)?.[1];
    const sha =
      /asset: "opengrep_linux_x86",\s*sha256:\s*"([0-9a-f]{64})"/.exec(
        script
      )?.[1];

    expect(version).toBeDefined();
    expect(sha).toBeDefined();
    expect(workflow).toContain(`OPENGREP_VERSION: ${version}`);
    expect(workflow).toContain(`OPENGREP_SHA256_X86: ${sha}`);
  });
});

describe("keamanan.yml — the coverage statement", () => {
  test("the step exists, always runs, and writes the run summary", () => {
    const coverage = step("State coverage");

    expect(coverage).toContain("always()");
    expect(coverage).toContain("GITHUB_STEP_SUMMARY");
  });

  test("it names `.astro` as NOT analysed, and says why", () => {
    const coverage = step("State coverage");

    expect(coverage).toContain(".astro");
    expect(coverage).toContain("NOT analysed");
    expect(coverage.toLowerCase()).toContain("no astro parser");
  });

  test("the numbers are computed at run time, never written by hand", () => {
    const coverage = step("State coverage");

    expect(coverage).toContain("git ls-files '*.ts' '*.mjs' '*.js'");
    expect(coverage).toContain("git ls-files '*.astro'");
    expect(coverage).toContain("${ANALYSED}");
    expect(coverage).toContain("${ASTRO}");
    expect(coverage).not.toMatch(/\b\d+\s+`?\\?`?\.astro\s+files/);
  });

  test("the count excludes the same folder the scan excludes", () => {
    expect(step("State coverage")).toContain("':!design'");
  });
});
