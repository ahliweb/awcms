/**
 * The CLI contracts of `blog:legacy:edge:verify` and `blog:legacy:article-paths`,
 * driven as real processes (Issues #599 / #711, ADR-0115).
 *
 * ## Why a spawned process and not an imported function
 *
 * Every property below lives OUTSIDE the pure domain, and the pure suites next
 * door are green whether or not any of them holds. That is not hypothetical
 * here — an adversarial review of the change that added these two scripts found
 * all three of the following, each with the DB-free suite at 167 pass / 0 fail:
 *
 *  - `process.exitCode = 1` deleted from `usage()` in BOTH scripts: every usage
 *    error exits 0. Both files carry a docblock naming exactly this defect in
 *    their sibling — "`bun run … && deploy` deployed when a flag was mistyped,
 *    having verified nothing" — and neither had a test for it.
 *  - `signal: AbortSignal.timeout(...)` deleted from the probe's `fetch`:
 *    `--timeout` parses, validates, and does nothing, and one hung origin
 *    stalls a pool worker forever over a 25,029-URL corpus.
 *  - `process.exitCode = 1; return;` deleted from the artefact generator's
 *    problem branch: it prints the problems and then writes the artefact
 *    anyway. "It REFUSES to emit while any row lacks a section" is ADR-0115's
 *    headline consequence and property 3 of that test file's own header, and
 *    nothing invoked `main()`.
 *
 * `tests/blog-legacy-cutover-verify-cli.test.ts` earned its existence for the
 * first of those on the sibling job. This is the same argument for the two
 * scripts that came after it.
 *
 * No database is required: every case here fails before `getDatabaseClient()`
 * is reached, or talks only to a local `Bun.serve`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE_VERIFY = join(
  import.meta.dir,
  "..",
  "scripts",
  "blog-legacy-edge-verify.ts"
);
const ARTICLE_PATHS = join(
  import.meta.dir,
  "..",
  "scripts",
  "blog-legacy-article-paths.ts"
);

let workDir = "";

type Run = { code: number; stdout: string; stderr: string };

function run(script: string, args: string[]): Run {
  const result = Bun.spawnSync(["bun", script, ...args], {
    env: { ...process.env, DATABASE_URL: "" },
    stdout: "pipe",
    stderr: "pipe"
  });

  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString()
  };
}

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "awcms-legacy-cli-"));
});

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe("a usage error FAILS the run", () => {
  // The property both scripts' docblocks describe and neither could prove.
  // `&& deploy` is the shape that makes it expensive.

  test("blog:legacy:edge:verify — no args", () => {
    const result = run(EDGE_VERIFY, []);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--urls");
  });

  test("blog:legacy:edge:verify — a non-numeric --limit", () => {
    const result = run(EDGE_VERIFY, ["--urls=/dev/null", "--limit=abc"]);

    expect(result.code).toBe(1);
  });

  test("blog:legacy:article-paths — no args", () => {
    const result = run(ARTICLE_PATHS, []);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--tenant");
  });

  test("blog:legacy:article-paths — a missing --default-locale", () => {
    // The flag that is REQUIRED rather than defaulted, because it belongs to
    // the consuming repo and its wrong answer is silent. It must therefore be
    // a usage error and not a fallback.
    const result = run(ARTICLE_PATHS, [
      "--tenant=11111111-1111-4111-8111-111111111111",
      "--system=seputarborneo"
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--default-locale");
  });

  test("neither script opens a database for a usage error", () => {
    // `DATABASE_URL` is emptied for every run in this file, so a script that
    // reached `getDatabaseClient()` would die with its own error rather than
    // the banner. Asserted because the banner is what tells an operator which
    // flag they got wrong.
    for (const script of [EDGE_VERIFY, ARTICLE_PATHS]) {
      const result = run(script, []);
      expect(result.stderr).not.toContain("DATABASE_URL");
    }
  });
});

describe("--timeout is a real budget, not a parsed flag", () => {
  test("a hung origin ends the run rather than stalling a worker", async () => {
    // Deleting `signal: AbortSignal.timeout(...)` from the probe's fetch left
    // every other test green: the one case that looked like it covered this
    // used port 1 on loopback, which refuses INSTANTLY and exercises the catch
    // branch without ever reaching a timeout.
    //
    // The hung server is a SEPARATE PROCESS, not a `Bun.serve` in this one.
    // With both in the same process `Bun.spawnSync` blocks the event loop that
    // owns the server, and the pair deadlocks — measured: the child was still
    // running after two minutes, while the same script against a hung server in
    // its own process finishes in 1.54s. The deadlock is a property of the test
    // harness, not of the code under test, and a test that cannot tell the two
    // apart is worse than no test.
    const serverFile = join(workDir, "hung-server.ts");
    writeFileSync(
      serverFile,
      "const s = Bun.serve({ port: 0, fetch: () => new Promise(() => {}) });\n" +
        "console.log(String(s.port));\n"
    );

    const server = Bun.spawn(["bun", serverFile], {
      stdout: "pipe",
      stderr: "ignore"
    });

    try {
      // ONE chunk, not `new Response(stdout).text()`. That reads to EOF, and a
      // server that stays up never closes its stdout — so the read itself
      // hangs, for a reason that has nothing to do with what is under test.
      const reader = server.stdout.getReader();
      const first = await reader.read();
      await reader.cancel();
      const port = new TextDecoder().decode(first.value).trim();
      expect(port).toMatch(/^\d+$/);

      const corpus = join(workDir, "hung.txt");
      writeFileSync(corpus, `http://127.0.0.1:${port}/news/1_x.html\n`);

      const started = Date.now();
      const result = run(EDGE_VERIFY, [
        `--urls=${corpus}`,
        "--timeout=1500",
        "--allow-private"
      ]);
      const elapsed = Date.now() - started;

      // The property is that it finished within the budget the OPERATOR set —
      // not merely that it finished, which was this assertion's first and
      // useless form.
      //
      // Measured, both against a hung server in its own process: with the
      // signal the run takes **1.54s**; with `signal:` deleted it still
      // finishes, in **12.04s**, because Bun's `fetch` has an idle timeout of
      // its own around ten seconds. So a 20s ceiling passed the mutation and
      // proved nothing. The window below sits between the two: comfortably
      // above 1.5s + Bun's start-up, and comfortably below the ~10s default
      // that takes over when `--timeout` does nothing.
      expect(elapsed).toBeGreaterThan(1_000);
      expect(elapsed).toBeLessThan(6_000);
      // A URL nobody could observe is not clean.
      expect(result.code).toBe(1);
      expect(result.stdout).toContain("unreachable");
    } finally {
      server.kill();
    }
  }, 30_000);
});

describe("the artefact generator refuses rather than emitting a partial map", () => {
  test("a usage error exits 1 before any file is written", () => {
    // The `--emit` refusal itself needs a tenant, which this DB-free file
    // cannot provide; what it CAN pin is that the refusal path is reached and
    // fails the run, and that nothing is written on the way there.
    const result = run(ARTICLE_PATHS, ["--emit"]);

    expect(result.code).toBe(1);
    expect(result.stdout).not.toContain("wrote ");
  });
});
