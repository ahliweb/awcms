/**
 * `bun run ci:local` (Issue #1001) — the runner's own logic: argument parsing,
 * the verdict / exit-code rule, the summary table, job sequencing, the database
 * helpers, and a few real jobs run through bash. The workflow-parity half lives
 * in `tests/ci-local-parity.test.ts`.
 *
 * What these pin, and why each is worth a test:
 *
 * - **A skipped job is never a pass.** The whole point of the runner is to be
 *   believed before a push. A job it could not run (no Postgres, no Bun 1.3.0)
 *   that came out as green would be the same lie as a coverage gate that is green
 *   because it saw nothing. So the exit code for "nothing failed, something
 *   skipped" is non-zero by default, and `--allow-skip` is an explicit opt-out
 *   that still prints INCOMPLETE.
 * - **A failure is never masked** by `--allow-skip`, nor by anything after it.
 * - **The database helpers cannot be pointed at a name the runner did not
 *   create**: `DROP DATABASE` is the one destructive thing it does, and the name
 *   is interpolated into SQL (identifiers cannot be parameters).
 * - **Nothing leaks a password** into a message that gets printed.
 */
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import {
  DEFAULT_BASE_REF,
  EXIT,
  E2E_STATIC_ENV,
  JOB_ORDER,
  JOBS,
  baseChildEnv,
  buildSetupBody,
  createThrowawayDatabase,
  descendantsOf,
  dropThrowawayDatabase,
  exitCodeFor,
  expectedChromiumRevisions,
  formatDuration,
  formatSummary,
  parseArgs,
  parseProcessTable,
  postgresMajorFromVersionNum,
  redactDatabaseUrl,
  resolveAdminDatabaseUrl,
  resolveJobId,
  runCleanups,
  runJob,
  runSelected,
  scrubSecrets,
  terminateTree,
  throwawayDatabaseName,
  verdictOf,
  withDatabase,
  type CliOptions,
  type JobDef,
  type JobId,
  type JobResult,
  type JobRun,
  type RunnerIO
} from "../scripts/ci-local";

const result = (
  id: JobId,
  status: JobResult["status"],
  detail = ""
): JobResult => ({ id, status, durationMs: 1500, detail });

function parsed(...argv: string[]): CliOptions {
  const out = parseArgs(argv);
  if (!out.ok) throw new Error(`expected a clean parse, got: ${out.error}`);
  return out.options;
}

describe("parseArgs", () => {
  test("no arguments selects every job, in the fixed order, against origin/main", () => {
    const options = parsed();

    expect(options.jobs).toEqual([...JOB_ORDER]);
    expect(options.base).toBe(DEFAULT_BASE_REF);
    expect(options.base).toBe("origin/main");
    expect(options.failFast).toBe(false);
    expect(options.allowSkip).toBe(false);
  });

  test("--job is repeatable, comma separated and accepts --job=<name>", () => {
    expect(parsed("--job", "quality", "--job", "hygiene").jobs).toEqual([
      "hygiene",
      "quality"
    ]);
    expect(parsed("--job", "e2e,integration").jobs).toEqual([
      "integration",
      "e2e"
    ]);
    expect(parsed("--job=changesets").jobs).toEqual(["changesets"]);
  });

  test("jobs always run in the canonical order whatever order they were asked for", () => {
    expect(
      parsed("--job", "e2e", "--job", "hygiene", "--job", "quality").jobs
    ).toEqual(["hygiene", "quality", "e2e"]);
  });

  test("the same job named twice (or by its alias too) runs once", () => {
    expect(
      parsed("--job", "e2e", "--job", "e2e-smoke", "--job", "e2e").jobs
    ).toEqual(["e2e"]);
  });

  test("workflow job ids are accepted as aliases", () => {
    expect(resolveJobId("policy-check")).toBe("changesets");
    expect(resolveJobId("integration-tests")).toBe("integration");
    expect(resolveJobId("e2e-smoke")).toBe("e2e");
    expect(resolveJobId("MINIMUM-SUPPORTED")).toBe("minimum-supported");
    expect(resolveJobId("nonsense")).toBeUndefined();
  });

  test("an unknown job is an error that names the valid ones", () => {
    const out = parseArgs(["--job", "nope"]);

    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toContain('unknown job "nope"');
      for (const id of JOB_ORDER) expect(out.error).toContain(id);
    }
  });

  test("--base takes a value in both spellings", () => {
    expect(parsed("--base", "origin/release").base).toBe("origin/release");
    expect(parsed("--base=upstream/main").base).toBe("upstream/main");
  });

  test("a flag that needs a value refuses a missing one, and does not swallow the next flag", () => {
    for (const argv of [
      ["--job"],
      ["--base"],
      ["--job", "--base", "x"],
      ["--base="]
    ]) {
      const out = parseArgs(argv);
      expect(out.ok).toBe(false);
    }
  });

  test("--fail-fast and --keep-going: the last one wins, keep going is the default", () => {
    expect(parsed("--fail-fast").failFast).toBe(true);
    expect(parsed("--fail-fast", "--keep-going").failFast).toBe(false);
    expect(parsed("--keep-going", "--fail-fast").failFast).toBe(true);
  });

  test("--allow-skip, --list and --help are recognised", () => {
    expect(parsed("--allow-skip").allowSkip).toBe(true);
    expect(parsed("--list").list).toBe(true);
    expect(parsed("--help").help).toBe(true);
    expect(parsed("-h").help).toBe(true);
  });

  test("unknown options and stray positionals are usage errors, not ignored", () => {
    for (const argv of [["--wat"], ["-x"], ["quality"]]) {
      const out = parseArgs(argv);
      expect(out.ok).toBe(false);
    }
  });
});

describe("verdict and exit code", () => {
  test("all passed is the only way to exit 0 without opting out", () => {
    const results = [result("hygiene", "pass"), result("quality", "pass")];

    expect(verdictOf(results)).toBe("pass");
    expect(exitCodeFor(results, { allowSkip: false })).toBe(EXIT.pass);
  });

  test("any failure exits 1", () => {
    const results = [result("hygiene", "pass"), result("quality", "fail", "x")];

    expect(verdictOf(results)).toBe("fail");
    expect(exitCodeFor(results, { allowSkip: false })).toBe(EXIT.failed);
    expect(EXIT.failed).toBe(1);
  });

  test("nothing failed but something was skipped is NOT green: exit 2", () => {
    const results = [
      result("hygiene", "pass"),
      result("e2e", "skipped", "no browser")
    ];

    expect(verdictOf(results)).toBe("incomplete");
    expect(exitCodeFor(results, { allowSkip: false })).toBe(EXIT.incomplete);
    expect(EXIT.incomplete).not.toBe(0);
  });

  test("--allow-skip turns skipped-only into 0, but never hides a failure", () => {
    const skippedOnly = [
      result("hygiene", "pass"),
      result("e2e", "skipped", "r")
    ];
    const failedToo = [
      result("quality", "fail", "x"),
      result("e2e", "skipped", "r")
    ];

    expect(exitCodeFor(skippedOnly, { allowSkip: true })).toBe(0);
    expect(verdictOf(skippedOnly)).toBe("incomplete");
    expect(exitCodeFor(failedToo, { allowSkip: true })).toBe(EXIT.failed);
  });

  test("a usage error has its own code, distinct from a failed or incomplete run", () => {
    expect(
      new Set([EXIT.pass, EXIT.failed, EXIT.incomplete, EXIT.usage]).size
    ).toBe(4);
  });
});

describe("formatSummary", () => {
  const mixed = [
    result("hygiene", "pass"),
    result("quality", "fail", 'step "Full quality gate" exited with code 1'),
    result("integration", "skipped", "no PostgreSQL admin URL"),
    result("changesets", "pass", "")
  ];

  test("one row per job with its status, and a skipped job carries its reason", () => {
    const text = formatSummary(mixed, { allowSkip: false });

    for (const id of ["hygiene", "quality", "integration", "changesets"]) {
      expect(text).toContain(id);
    }
    expect(text).toContain("FAIL");
    expect(text).toContain("SKIPPED");
    expect(text).toContain("(no PostgreSQL admin URL)");
    expect(text).toContain('step "Full quality gate" exited with code 1');
  });

  test("a skipped row never reads PASS", () => {
    const text = formatSummary([result("e2e", "skipped", "no browser")], {
      allowSkip: false
    });
    const row = text.split("\n").find((line) => line.includes("e2e  "))!;

    expect(row).toContain("SKIPPED");
    expect(row).not.toContain("PASS");
    expect(text).toContain("Verdict: INCOMPLETE");
    expect(text).toContain("NOT verified");
  });

  test("the verdict line carries the tally", () => {
    const text = formatSummary(mixed, { allowSkip: false });

    expect(text).toContain("Verdict: FAIL (2 passed, 1 failed, 1 skipped)");
  });

  test("--allow-skip is announced in the summary so a green exit is not mistaken for verified", () => {
    const text = formatSummary([result("e2e", "skipped", "r")], {
      allowSkip: true
    });

    expect(text).toContain("Verdict: INCOMPLETE");
    expect(text).toContain("--allow-skip");
  });

  test("states that the required checks still gate merging", () => {
    const text = formatSummary([result("hygiene", "pass")], {
      allowSkip: false
    });

    expect(text).toContain("Verdict: PASS");
    expect(text).toContain("11653326");
  });

  test("formatDuration is compact and monotone", () => {
    expect(formatDuration(0)).toBe("0.0s");
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(61_000)).toBe("1m 01s");
    expect(formatDuration(725_000)).toBe("12m 05s");
  });
});

describe("runSelected", () => {
  const ids: JobId[] = ["hygiene", "quality", "integration"];
  const outcome = (failing: JobId[]) => async (id: JobId) =>
    result(
      id,
      failing.includes(id) ? "fail" : "pass",
      failing.includes(id) ? "boom" : ""
    );

  test("keep-going (the default) runs every job even after a failure", async () => {
    const ran: JobId[] = [];
    const results = await runSelected(
      ids,
      async (id) => {
        ran.push(id);
        return outcome(["hygiene"])(id);
      },
      { failFast: false }
    );

    expect(ran).toEqual(ids);
    expect(results.map((r) => r.status)).toEqual(["fail", "pass", "pass"]);
  });

  test("fail-fast stops after the first failure and marks the rest as not run (skipped, not pass)", async () => {
    const ran: JobId[] = [];
    const results = await runSelected(
      ids,
      async (id) => {
        ran.push(id);
        return outcome(["quality"])(id);
      },
      { failFast: true }
    );

    expect(ran).toEqual(["hygiene", "quality"]);
    expect(results.map((r) => r.status)).toEqual(["pass", "fail", "skipped"]);
    expect(results[2]!.detail).toContain("--fail-fast after quality failed");
  });

  test("a skipped job does not trigger fail-fast", async () => {
    const results = await runSelected(
      ids,
      async (id) => result(id, id === "hygiene" ? "skipped" : "pass", "r"),
      { failFast: true }
    );

    expect(results.map((r) => r.status)).toEqual(["skipped", "pass", "pass"]);
  });

  test("results keep the order jobs were given in", async () => {
    const results = await runSelected(ids, outcome([]), { failFast: false });

    expect(results.map((r) => r.id)).toEqual(ids);
  });
});

describe("database helpers", () => {
  test("the dedicated variable wins over DATABASE_URL, which is the fallback", () => {
    expect(
      resolveAdminDatabaseUrl({
        CI_LOCAL_DATABASE_URL: "postgres://a@h/x",
        DATABASE_URL: "postgres://b@h/y"
      })
    ).toEqual({ url: "postgres://a@h/x", source: "CI_LOCAL_DATABASE_URL" });
    expect(
      resolveAdminDatabaseUrl({ DATABASE_URL: "postgres://b@h/y" })
    ).toEqual({
      url: "postgres://b@h/y",
      source: "DATABASE_URL"
    });
  });

  test("blank and whitespace-only values count as unset, so no URL is invented", () => {
    expect(resolveAdminDatabaseUrl({})).toBeNull();
    expect(
      resolveAdminDatabaseUrl({ CI_LOCAL_DATABASE_URL: "  ", DATABASE_URL: "" })
    ).toBeNull();
    expect(
      resolveAdminDatabaseUrl({
        CI_LOCAL_DATABASE_URL: "",
        DATABASE_URL: "postgres://b@h/y"
      })?.source
    ).toBe("DATABASE_URL");
  });

  test("throwaway names are unique per run, valid unquoted identifiers, and recognisably ours", () => {
    const name = throwawayDatabaseName(
      "minimum-supported",
      4242,
      1_700_000_000_000
    );

    expect(name).toMatch(/^awcms_cilocal_[a-z0-9_]+$/);
    expect(name).not.toContain("-");
    expect(name.length).toBeLessThanOrEqual(63);
    expect(throwawayDatabaseName("e2e", 1, 1)).not.toBe(
      throwawayDatabaseName("e2e", 2, 1)
    );
    expect(throwawayDatabaseName("e2e", 1, 1)).not.toBe(
      throwawayDatabaseName("e2e", 1, 2)
    );
    expect(throwawayDatabaseName("e2e", 1, 1)).not.toBe(
      throwawayDatabaseName("integration", 1, 1)
    );
  });

  test("withDatabase keeps host, port and credentials and swaps only the database", () => {
    const url = new URL(
      withDatabase(
        "postgres://u:p%40ss@db.local:5433/postgres?sslmode=disable",
        "awcms_cilocal_e2e_1_a"
      )
    );

    expect(url.hostname).toBe("db.local");
    expect(url.port).toBe("5433");
    expect(url.username).toBe("u");
    expect(decodeURIComponent(url.password)).toBe("p@ss");
    expect(url.pathname).toBe("/awcms_cilocal_e2e_1_a");
    expect(url.searchParams.get("sslmode")).toBe("disable");
  });

  test("a password never survives redaction, and an unparseable value is not echoed", () => {
    const redacted = redactDatabaseUrl(
      "postgres://admin:s3cr3t-pw@db.local:5432/postgres"
    );

    expect(redacted).not.toContain("s3cr3t-pw");
    expect(redacted).toContain("db.local");
    expect(redactDatabaseUrl("not a url s3cr3t")).not.toContain("s3cr3t");
  });

  test("scrubSecrets removes the URL and its password from free text", () => {
    const url = "postgres://admin:s3cr3t-pw@db.local:5432/postgres";
    const text = scrubSecrets(
      `connect ECONNREFUSED ${url}; auth failed for password s3cr3t-pw`,
      [url, ""]
    );

    expect(text).not.toContain("s3cr3t-pw");
    expect(text).not.toContain(url);
    expect(text).toContain("ECONNREFUSED");
  });

  test("postgresMajorFromVersionNum reads server_version_num", () => {
    expect(postgresMajorFromVersionNum(160014)).toBe(16);
    expect(postgresMajorFromVersionNum(180004)).toBe(18);
    expect(postgresMajorFromVersionNum(150002)).toBe(15);
  });

  test("DROP and CREATE refuse a name the runner did not make, before any connection is tried", async () => {
    // The URL points at a closed port: if validation did not come first these
    // would reject with a connection error instead, and `.toThrow(/refusing/)`
    // would fail. The name is interpolated into SQL, so this is the injection
    // and the wrong-database guard in one.
    const unreachable = "postgres://nobody@127.0.0.1:1/postgres";

    await expect(
      dropThrowawayDatabase(unreachable, "production")
    ).rejects.toThrow(/refusing/);
    await expect(dropThrowawayDatabase(unreachable, "awcms")).rejects.toThrow(
      /refusing/
    );
    await expect(
      dropThrowawayDatabase(
        unreachable,
        'awcms_cilocal_x"; DROP DATABASE prod; --'
      )
    ).rejects.toThrow(/refusing/);
    await expect(
      createThrowawayDatabase(unreachable, 'x"; DROP DATABASE prod; --')
    ).rejects.toThrow(/refusing/);
  });
});

describe("the child environment", () => {
  test("CI=true is set and the three database URLs are blanked, whatever the shell exports", () => {
    const env = baseChildEnv({
      CI: "false",
      DATABASE_URL: "postgres://real-db/prod",
      SETUP_DATABASE_URL: "postgres://real-db/prod",
      WORKER_DATABASE_URL: "postgres://real-db/prod",
      PATH: "/usr/bin",
      MARKER: "kept"
    });

    expect(env.CI).toBe("true");
    expect(env.DATABASE_URL).toBe("");
    expect(env.SETUP_DATABASE_URL).toBe("");
    expect(env.WORKER_DATABASE_URL).toBe("");
    expect(env.PATH).toBe("/usr/bin");
    expect(env.MARKER).toBe("kept");
  });

  test("undefined entries are dropped instead of becoming the string 'undefined'", () => {
    const env = baseChildEnv({ PATH: "/usr/bin", GONE: undefined });

    expect("GONE" in env).toBe(false);
  });

  test("the seed body is built from the same e2e values the workflow exports", () => {
    expect(buildSetupBody(E2E_STATIC_ENV)).toEqual({
      tenantCode: "e2e",
      tenantName: "E2E Tenant",
      officeCode: "HQ-E2E",
      officeName: "E2E Head Office",
      ownerDisplayName: "E2E Owner",
      ownerLoginIdentifier: "e2e-owner@example.com",
      ownerPassword: "e2e-password-123"
    });
  });
});

describe("Playwright browser detection", () => {
  test("reads the chromium and headless-shell revisions, once each", () => {
    const json = JSON.stringify({
      browsers: [
        { name: "chromium", revision: "1248" },
        { name: "chromium-headless-shell", revision: "1248" },
        { name: "firefox", revision: "1555" },
        { name: "ffmpeg", revision: "1013" }
      ]
    });

    expect(expectedChromiumRevisions(json)).toEqual(["1248"]);
    expect(expectedChromiumRevisions("{}")).toEqual([]);
  });
});

describe("job definitions", () => {
  test("every id in the execution order has exactly one definition, with unique aliases", () => {
    expect(JOBS.map((job) => job.id).sort()).toEqual([...JOB_ORDER].sort());

    const names = JOBS.flatMap((job) => [job.id, ...job.aliases]);
    expect(new Set(names).size).toBe(names.length);
  });

  test("only the two jobs the workflow gives a Postgres service need a database", () => {
    expect(
      JOBS.filter((job) => job.needsDatabase)
        .map((job) => job.id)
        .sort()
    ).toEqual(["e2e", "integration"]);
  });
});

describe("running a job through bash", () => {
  const temps: string[] = [];
  const quiet: RunnerIO = { log: () => undefined, stdio: "ignore" };
  const options = parsed();

  afterEach(async () => {
    while (temps.length > 0) {
      await rm(temps.pop()!, { recursive: true, force: true });
    }
  });

  async function scratch(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "ci-local-test-"));
    temps.push(dir);
    return dir;
  }

  const fakeJob = (
    steps: JobDef["steps"],
    extra: Partial<JobDef> = {}
  ): JobDef => ({
    id: "hygiene",
    aliases: [],
    workflow: ".github/workflows/ci.yml",
    workflowJob: "hygiene",
    title: "fake",
    needsDatabase: false,
    steps,
    omitted: {},
    ...extra
  });

  test("steps run in order and the job passes when every step exits 0", async () => {
    const dir = await scratch();
    const log = path.join(dir, "order.txt");

    const outcome = await runJob(
      fakeJob([
        { kind: "shell", step: "one", run: `echo one >> '${log}'` },
        { kind: "shell", step: "two", run: `echo two >> '${log}'` }
      ]),
      options,
      quiet,
      { PATH: process.env.PATH }
    );

    expect(outcome.status).toBe("pass");
    expect((await readFile(log, "utf8")).trim().split("\n")).toEqual([
      "one",
      "two"
    ]);
  });

  test("a failing step fails the job, names the step and its exit code, and stops the job", async () => {
    const dir = await scratch();
    const marker = path.join(dir, "should-not-exist");

    const outcome = await runJob(
      fakeJob([
        { kind: "shell", step: "boom", run: "exit 3" },
        { kind: "shell", step: "after", run: `touch '${marker}'` }
      ]),
      options,
      quiet,
      { PATH: process.env.PATH }
    );

    expect(outcome.status).toBe("fail");
    expect(outcome.detail).toContain('step "boom"');
    expect(outcome.detail).toContain("code 3");
    expect(await Bun.file(marker).exists()).toBe(false);
  });

  test("bash -e semantics: a failing command in the middle of a step stops that step", async () => {
    const dir = await scratch();
    const marker = path.join(dir, "reached");

    const outcome = await runJob(
      fakeJob([{ kind: "shell", step: "e", run: `false\ntouch '${marker}'` }]),
      options,
      quiet,
      { PATH: process.env.PATH }
    );

    expect(outcome.status).toBe("fail");
    expect(await Bun.file(marker).exists()).toBe(false);
  });

  test("a preflight reason skips the job without running any step", async () => {
    const dir = await scratch();
    const marker = path.join(dir, "ran");

    const outcome = await runJob(
      fakeJob([{ kind: "shell", step: "s", run: `touch '${marker}'` }], {
        preflight: async () => "no database here"
      }),
      options,
      quiet,
      { PATH: process.env.PATH }
    );

    expect(outcome.status).toBe("skipped");
    expect(outcome.detail).toBe("no database here");
    expect(await Bun.file(marker).exists()).toBe(false);
  });

  test("a native step that reports failure fails the job; one that throws does too", async () => {
    const reported = await runJob(
      fakeJob([
        {
          kind: "native",
          step: "n",
          adapted: "x",
          run: async () => ({ ok: false, detail: "nope" })
        }
      ]),
      options,
      quiet,
      { PATH: process.env.PATH }
    );
    const thrown = await runJob(
      fakeJob([
        {
          kind: "native",
          step: "n",
          adapted: "x",
          run: async () => {
            throw new Error("kaboom");
          }
        }
      ]),
      options,
      quiet,
      { PATH: process.env.PATH }
    );

    expect(reported.status).toBe("fail");
    expect(reported.detail).toContain("nope");
    expect(thrown.status).toBe("fail");
    expect(thrown.detail).toContain("kaboom");
  });

  test("cleanups registered by a step run when the job fails, newest first", async () => {
    const order: string[] = [];

    const outcome = await runJob(
      fakeJob([
        {
          kind: "native",
          step: "register",
          adapted: "x",
          run: async (run) => {
            run.cleanups.push(async () => void order.push("first-registered"));
            run.cleanups.push(async () => void order.push("second-registered"));
            return { ok: true };
          }
        },
        { kind: "shell", step: "fail", run: "exit 1" }
      ]),
      options,
      quiet,
      { PATH: process.env.PATH }
    );

    expect(outcome.status).toBe("fail");
    expect(order).toEqual(["second-registered", "first-registered"]);
  });

  test("a throwing cleanup does not turn a pass into a crash, and later cleanups still run", async () => {
    const order: string[] = [];

    const outcome = await runJob(
      fakeJob([
        {
          kind: "native",
          step: "register",
          adapted: "x",
          run: async (run) => {
            run.cleanups.push(async () => void order.push("ran"));
            run.cleanups.push(async () => {
              throw new Error("drop failed");
            });
            return { ok: true };
          }
        }
      ]),
      options,
      quiet,
      { PATH: process.env.PATH }
    );

    expect(outcome.status).toBe("pass");
    expect(order).toEqual(["ran"]);
  });

  test("children see CI=true and blank database URLs even when the parent exports real ones", async () => {
    const dir = await scratch();
    const out = path.join(dir, "env.txt");

    const outcome = await runJob(
      fakeJob([
        {
          kind: "shell",
          step: "env",
          run: `printf '%s|%s|%s|%s' "$CI" "$DATABASE_URL" "$SETUP_DATABASE_URL" "$WORKER_DATABASE_URL" > '${out}'`
        }
      ]),
      options,
      quiet,
      {
        PATH: process.env.PATH,
        DATABASE_URL: "postgres://real/prod",
        SETUP_DATABASE_URL: "postgres://real/prod",
        WORKER_DATABASE_URL: "postgres://real/prod"
      }
    );

    expect(outcome.status).toBe("pass");
    expect(await readFile(out, "utf8")).toBe("true|||");
  });

  test("a step's own env overrides the job env, and a function value sees the CLI options", async () => {
    const dir = await scratch();
    const out = path.join(dir, "env.txt");

    const outcome = await runJob(
      fakeJob([
        {
          kind: "shell",
          step: "env",
          run: `printf '%s|%s' "$FROM_OPTION" "$STATIC" > '${out}'`,
          env: { FROM_OPTION: (run) => run.options.base, STATIC: "s" }
        }
      ]),
      parsed("--base", "origin/release"),
      quiet,
      { PATH: process.env.PATH }
    );

    expect(outcome.status).toBe("pass");
    expect(await readFile(out, "utf8")).toBe("origin/release|s");
  });
});

describe("terminating only the runner's own process tree", () => {
  // The runner must end what IT started on Ctrl-C / SIGTERM — a `bun run check`
  // and everything under it — and nothing else on a machine that other sessions
  // share. A signal to the direct child is not enough (`bun run` exits on SIGTERM
  // and leaves its script running, which is measured, not assumed), and a
  // pattern-based kill (`pkill -f bun`) is not acceptable (it kills other
  // people's runs). So it walks parent links from PIDs it spawned.
  const tracked: number[] = [];

  /** Alive means present in the process table and not a zombie. */
  function alive(pid: number): boolean {
    const listing = Bun.spawnSync(["ps", "-o", "stat=", "-p", String(pid)]);
    const state = listing.stdout.toString().trim();
    return state !== "" && !state.startsWith("Z");
  }

  async function until(condition: () => boolean, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    while (!condition() && Date.now() < deadline) await Bun.sleep(50);
    return condition();
  }

  afterEach(() => {
    // Whatever a failed assertion left behind, by the explicit PIDs this test started.
    for (const pid of tracked.splice(0)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  });

  test("descendantsOf walks parent links top-down and ignores everything unrelated", () => {
    const table = [
      { pid: 10, ppid: 1 },
      { pid: 11, ppid: 10 },
      { pid: 12, ppid: 10 },
      { pid: 13, ppid: 11 },
      { pid: 14, ppid: 13 },
      { pid: 20, ppid: 1 },
      { pid: 21, ppid: 20 }
    ];

    expect(descendantsOf(table, 10)).toEqual([11, 12, 13, 14]);
    expect(descendantsOf(table, 13)).toEqual([14]);
    expect(descendantsOf(table, 14)).toEqual([]);
    expect(descendantsOf(table, 999)).toEqual([]);
    expect(descendantsOf(table, 20)).toEqual([21]);
  });

  test("descendantsOf is cycle-safe and never returns its own root", () => {
    const cyclic = [
      { pid: 2, ppid: 1 },
      { pid: 3, ppid: 2 },
      { pid: 1, ppid: 3 }
    ];

    expect(descendantsOf(cyclic, 1).sort()).toEqual([2, 3]);
  });

  test("parseProcessTable reads ps output and skips what it cannot parse", () => {
    const rows = parseProcessTable(
      ["    1     0 Ss", "  482   1 S<s", "  77 482 Z+", "garbage", ""].join(
        "\n"
      )
    );

    expect(rows).toEqual([
      { pid: 1, ppid: 0, stat: "Ss" },
      { pid: 482, ppid: 1, stat: "S<s" },
      { pid: 77, ppid: 482, stat: "Z+" }
    ]);
  });

  test("terminateTree ends the child AND its grandchildren, and leaves an unrelated process alone", async () => {
    const bystander = Bun.spawn(["sleep", "299"], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore"
    });
    tracked.push(bystander.pid);

    const child = Bun.spawn(["bash", "-c", "sleep 298 & echo $!; wait"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore"
    });
    tracked.push(child.pid);

    const first = await child.stdout.getReader().read();
    const grandchild = Number(new TextDecoder().decode(first.value).trim());
    expect(Number.isInteger(grandchild)).toBe(true);
    tracked.push(grandchild);
    expect(alive(grandchild)).toBe(true);

    await terminateTree(child);
    await child.exited;

    expect(await until(() => !alive(grandchild))).toBe(true);
    // The bystander is what `pkill sleep` (or pkill -f on a shared pattern) would
    // have taken with it. It must still be running.
    expect(alive(bystander.pid)).toBe(true);
  }, 30_000);

  test("a child that already exited is left alone (its PID may be someone else's by now)", async () => {
    const child = Bun.spawn(["true"], { stdout: "ignore", stderr: "ignore" });
    await child.exited;

    // Would otherwise snapshot the process table and signal whatever now owns the PID.
    await terminateTree(child);
    expect(child.exitCode).toBe(0);
  });

  test("SIGTERM to the runner stops its children, runs the cleanups and exits 143 — end to end", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ci-local-signal-"));
    const marker = path.join(dir, "cleanup-ran");
    const pidFile = path.join(dir, "grandchild.pid");
    const returnedFile = path.join(dir, "returned.txt");
    const nextFile = path.join(dir, "next-job.txt");
    const lateMarker = path.join(dir, "late-step-started");
    const fixture = path.join(dir, "fixture.ts");
    const script = path.resolve(import.meta.dir, "../scripts/ci-local.ts");

    await Bun.write(
      fixture,
      `
import { existsSync, writeFileSync } from "node:fs";
import { installSignalHandlers, parseArgs, runJob } from ${JSON.stringify(script)};

installSignalHandlers();
const parsed = parseArgs([]);
if (!parsed.ok) throw new Error(parsed.error);

const job = (steps) => ({
  id: "hygiene",
  aliases: [],
  workflow: ".github/workflows/ci.yml",
  workflowJob: "hygiene",
  title: "signal fixture",
  needsDatabase: false,
  omitted: {},
  steps
});
const quiet = { log() {}, stdio: "ignore" };
const env = { PATH: process.env.PATH };

await runJob(
  job([
    {
      kind: "native",
      step: "register a slow cleanup",
      adapted: "stands in for a throwaway-database drop that takes a while",
      async run(run) {
        run.cleanups.push(async () => {
          await new Promise((resolve) => setTimeout(resolve, 400));
          writeFileSync(${JSON.stringify(marker)}, "cleaned");
        });
        return { ok: true };
      }
    },
    {
      kind: "shell",
      step: "something long-running with a grandchild",
      run: "sleep 296 & echo $! > ${pidFile}; wait"
    }
  ]),
  parsed.options,
  quiet,
  env
);

// The job must not report back before its cleanup has finished, whichever of
// the job and the signal handler reached the cleanup first.
writeFileSync(
  ${JSON.stringify(returnedFile)},
  existsSync(${JSON.stringify(marker)}) ? "cleanup-finished-first" : "returned-early"
);

// After an interrupt nothing new may start, not even the first step of the next job.
const next = await runJob(
  job([{ kind: "shell", step: "must never start", run: "touch ${lateMarker}" }]),
  parsed.options,
  quiet,
  env
);
writeFileSync(${JSON.stringify(nextFile)}, next.status + ":" + next.detail);
`
    );

    const bystander = Bun.spawn(["sleep", "295"], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore"
    });
    tracked.push(bystander.pid);

    const runner = Bun.spawn([process.execPath, fixture], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "inherit"
    });
    tracked.push(runner.pid);

    try {
      expect(
        await until(
          () => existsSync(pidFile) && (Bun.file(pidFile).size ?? 0) > 0,
          20_000
        )
      ).toBe(true);
      const grandchild = Number((await readFile(pidFile, "utf8")).trim());
      tracked.push(grandchild);
      expect(alive(grandchild)).toBe(true);

      process.kill(runner.pid, "SIGTERM");

      expect(await runner.exited).toBe(143);
      expect(existsSync(marker)).toBe(true);
      expect(await readFile(returnedFile, "utf8")).toBe(
        "cleanup-finished-first"
      );
      expect(await readFile(nextFile, "utf8")).toBe(
        "fail:interrupted before the next step"
      );
      expect(existsSync(lateMarker)).toBe(false);
      expect(await until(() => !alive(grandchild))).toBe(true);
      expect(alive(bystander.pid)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("cleanups are shared between the job's finally and the signal handler", () => {
  // Found by a live SIGTERM against the integration job: the handler popped the
  // throwaway-database drop and awaited it, the job's own `finally` found an
  // EMPTY list and returned at once, and the next job started while the drop was
  // still running. A caller that finds a cleanup in flight must wait for it.
  const quiet: RunnerIO = { log: () => undefined, stdio: "ignore" };
  const makeRun = (): JobRun => ({
    job: JOBS[0]!,
    options: parsed(),
    io: quiet,
    env: {},
    cleanups: [],
    facts: {}
  });

  test("a second caller waits for the cleanup already in flight instead of returning early", async () => {
    const run = makeRun();
    const events: string[] = [];
    run.cleanups.push(async () => {
      events.push("drop:start");
      await Bun.sleep(150);
      events.push("drop:end");
    });

    const handler = runCleanups(run);
    await Bun.sleep(20); // the drop is now in flight
    const finallyBlock = runCleanups(run).then(() => {
      events.push("job-returned");
    });
    await Promise.all([handler, finallyBlock]);

    expect(events).toEqual(["drop:start", "drop:end", "job-returned"]);
  });

  test("a cleanup registered while another is draining still runs, newest first", async () => {
    const run = makeRun();
    const order: string[] = [];
    run.cleanups.push(async () => {
      await Bun.sleep(100);
      order.push("first");
    });

    const draining = runCleanups(run);
    await Bun.sleep(20);
    run.cleanups.push(async () => void order.push("registered-late"));
    await draining;
    await runCleanups(run); // a later caller finds nothing left to do

    expect(order).toEqual(["first", "registered-late"]);
    expect(run.cleanups).toEqual([]);
  });

  test("each cleanup runs exactly once however many callers race for it", async () => {
    const run = makeRun();
    let runs = 0;
    run.cleanups.push(async () => {
      runs += 1;
      await Bun.sleep(50);
    });

    await Promise.all([runCleanups(run), runCleanups(run), runCleanups(run)]);

    expect(runs).toBe(1);
  });
});
