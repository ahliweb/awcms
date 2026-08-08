/**
 * Every DB-gated test file at the root of `tests/` is actually executed by a
 * pipeline — and every file a pipeline names still exists and is still
 * DB-gated. Both directions, over BOTH workflows.
 *
 * ## The failure this exists to stop
 *
 * The DB-gated suite at the root of `tests/` cannot run in the same `bun test`
 * process as `tests/integration/` (empirically: 26 collisions), so both
 * pipelines run it as a dedicated step with an EXPLICIT file list. An explicit
 * list is the right call there — a bare `bun test` would silently regrow the
 * collision — but an explicit list drifts, and this one did.
 *
 * It was born with ten entries. Five DB-gated files landed afterwards
 * (`mfa-integration`, `mfa-login-e2e`, `oidc-integration`,
 * `openapi-office-response-schema-postgres`, `turnstile-login-e2e`) and none of
 * their PRs touched it. Result: **36 tests that skipped in every pipeline**
 * while reading, on every green run, as coverage — MFA lockout/replay
 * atomicity, cross-tenant denial on the OIDC tables, Turnstile enforcement on
 * the real login handler, and the office response-vs-schema contract. Each of
 * those five files' own header says it "runs in the dedicated legacy
 * `bun test <files>` step". They were written for a step that never called
 * them.
 *
 * COUNTING NOTE, because the first draft of this file got it wrong: running
 * those five with `DATABASE_URL` unset reports **46 skip**, and 46 is not the
 * number of tests. Bun counts skipped HOOKS in that total, and each of the five
 * has exactly `beforeAll` + `afterAll` — 36 tests + 10 hooks. The declaration
 * count (`grep -cE '^\s*(test|it)\(' `) is the honest one, and it is what the
 * pipeline now executes: 14 + 3 + 9 + 1 + 9. Verified against the run that
 * restored them, per file, not inferred.
 *
 * Nothing could have caught it. `bun run check` runs with `DATABASE_URL` unset
 * by design, so these files skip there and are SUPPOSED to; skipping is not a
 * signal. The only observer that can tell "skipped because no database" from
 * "skipped forever" is a check that compares the filesystem to the workflows —
 * which is this file, and which needs no database to do it.
 *
 * ## Why the reverse direction is not decoration
 *
 * A list entry naming a file that was renamed or deleted makes `bun test` fail
 * loudly, so that half is cheap. The one that matters is an entry naming a file
 * that is no longer DB-gated: it would run in a step whose whole purpose is
 * database isolation, quietly costing nothing and proving nothing. Both are
 * asserted here.
 */
import { describe, expect, test } from "bun:test";

const WORKFLOWS = [".github/workflows/ci.yml", ".github/workflows/release.yml"];

/**
 * The gating idiom, as the files actually write it: a `DATABASE_URL` read that
 * decides between `describe` and `describe.skip`. Matching the READ plus the
 * skip keeps a file that merely mentions the variable in a comment out of the
 * set — the reason this is two conditions and not one.
 */
function isDatabaseGated(source: string): boolean {
  return (
    /process\.env\.DATABASE_URL/.test(source) &&
    /describe\.skip|test\.skip|describeOrSkip|testOrSkip/.test(source)
  );
}

async function gatedRootTestFiles(): Promise<string[]> {
  const files: string[] = [];

  for await (const file of new Bun.Glob("tests/*.test.ts").scan({
    cwd: process.cwd()
  })) {
    if (isDatabaseGated(await Bun.file(file).text())) {
      files.push(file);
    }
  }

  return files.sort();
}

/**
 * Every `tests/<name>.test.ts` a workflow hands to a `bun test` invocation.
 *
 * COMMENT LINES ARE STRIPPED FIRST, and that is load-bearing rather than tidy.
 * The first draft of this file matched the whole document, so the two step
 * comments that name this very file put it into the "listed" set — where it
 * failed the reverse check for not being DB-gated, and split the two pipelines'
 * sets because their prose differs. That is the same defect class ADR-0062
 * records for `skills:check`'s path extractor: a scanner that reads
 * documentation as if it were code answers confidently and wrongly. Here it
 * answered wrongly in the safe direction; there is no reason to assume the next
 * one will.
 */
function listedInWorkflow(source: string): string[] {
  const executable = source
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

  return [...executable.matchAll(/tests\/[\w.-]+\.test\.ts/g)]
    .map((match) => match[0])
    .sort();
}

describe("DB-gated suite ↔ CI parity", () => {
  test("the scan finds the suite it is meant to police", async () => {
    const gated = await gatedRootTestFiles();

    // A glob that resolved to nothing would make every assertion below pass
    // vacuously — the failure mode `tests/module-absence-claims.test.ts`
    // records from its own first draft.
    expect(gated.length).toBeGreaterThanOrEqual(15);
    expect(gated).toContain("tests/security-readiness-rls.test.ts");
    expect(gated).toContain("tests/mfa-integration.test.ts");
  });

  test.each(WORKFLOWS)(
    "%s runs every DB-gated root test file",
    async (workflow) => {
      const source = await Bun.file(workflow).text();
      const listed = new Set(listedInWorkflow(source));
      const missing = (await gatedRootTestFiles()).filter(
        (file) => !listed.has(file)
      );

      expect(missing).toEqual([]);
    }
  );

  test.each(WORKFLOWS)(
    "%s names nothing that vanished or stopped being DB-gated",
    async (workflow) => {
      const source = await Bun.file(workflow).text();
      const gated = new Set(await gatedRootTestFiles());
      const stale: string[] = [];

      for (const file of listedInWorkflow(source)) {
        // Only ROOT files are this suite's business — `tests/integration/` is run
        // by directory, by a different step, on purpose.
        if (file.split("/").length !== 2) continue;

        if (!(await Bun.file(file).exists())) {
          stale.push(`${file} (no such file)`);
          continue;
        }

        if (!gated.has(file)) {
          stale.push(`${file} (no longer DB-gated)`);
        }
      }

      expect(stale).toEqual([]);
    }
  );

  test("both pipelines run the SAME set", async () => {
    // A file listed in `ci.yml` but not `release.yml` is worse than one listed
    // in neither: PRs go green on evidence a release never re-checks, which is
    // exactly how the five missing entries survived — `release.yml` was the
    // pipeline they were originally written for.
    const [ci, release] = await Promise.all(
      WORKFLOWS.map(async (workflow) =>
        listedInWorkflow(await Bun.file(workflow).text()).filter(
          (file) => file.split("/").length === 2
        )
      )
    );

    expect(ci).toEqual(release!);
  });
});
