/**
 * ci-local.ts — `bun run ci:local` (Issue #1001).
 *
 * Runs, on the developer's machine, every job that GitHub Actions runs for a
 * pull request (`.github/workflows/ci.yml` and `changesets.yml`), with the same
 * commands in the same order, and prints one summary table.
 *
 * ## Why it exists
 *
 * `bun run check` is only the `quality` job. The other jobs — repo hygiene, the
 * changeset policy, the DB-gated integration suites, the Bun 1.3.0 floor and the
 * Playwright smoke — had no local equivalent, so the only way to learn whether a
 * branch was green was to push it and wait. That spends Actions minutes and
 * review cycles on failures a laptop could have shown in advance.
 *
 * This is the verification BEFORE push. It does not replace the ruleset: the
 * required checks in ruleset `11653326` still gate merging (see
 * `docs/awcms/branch-protection.md`).
 *
 * ## How it mirrors the workflows, and how that is kept honest
 *
 * Each job is a list of steps. A `shell` step carries the workflow's `run:` text
 * VERBATIM and is executed with `bash -e -c`, which is what Actions does for a
 * `run:` step. A `native` step is one the workflow expresses with a GitHub
 * feature that has no local meaning (a `services:` container, `$GITHUB_ENV`, a
 * `uses:` action, a server started on a fixed port); it is reimplemented here and
 * says why. Every workflow step is either one of those or listed in `omitted`
 * with a reason.
 *
 * `tests/ci-local-parity.test.ts` parses both workflows and holds this file to
 * them in BOTH directions: a new workflow job, a new step inside an existing
 * job, a changed `run:` text, a renamed step, or a changed Bun / PostgreSQL pin
 * turns it red. Without it this file would drift the way a hand-copied mirror
 * always does (PR #770: a gate added to `check` that CI never ran).
 *
 * ## Semantics worth knowing
 *
 * - Jobs run SEQUENTIALLY in a fixed order, cheapest first. They share `dist/`
 *   and the machine, and Actions' parallelism would only make a laptop slower.
 * - Within a job, a failing step stops the job (as in Actions). Across jobs the
 *   default is KEEP GOING, so one run shows every red job; `--fail-fast` stops at
 *   the first red one.
 * - A job that cannot run here is reported `skipped (reason)`, never `pass`.
 *   Exit code: 0 only when every selected job passed; 1 when any failed; 2 when
 *   nothing failed but something was skipped (unverified is not green;
 *   `--allow-skip` makes that 0); 64 for a usage error.
 * - `CI=true` is set for every job, as GitHub-hosted runners do (Playwright
 *   retries and `forbidOnly`, `bun test` snapshot behaviour).
 * - DATABASE_URL, SETUP_DATABASE_URL and WORKER_DATABASE_URL are pinned for every
 *   child process: blank for jobs without a database (what CI has), the throwaway
 *   database for the two that have one. A URL exported in the developer's shell
 *   can therefore never point a test run at a real database.
 * - Credentials come from the environment; nothing is written into the repo. The
 *   admin connection string is read from `CI_LOCAL_DATABASE_URL`, else
 *   `DATABASE_URL`, and is never printed (passwords are redacted).
 * - SIGINT / SIGTERM / SIGHUP: stop starting anything, terminate the process
 *   trees of the children THIS run spawned, drop the throwaway database, exit
 *   128+signal. The tree is found by walking parent links from our own PIDs —
 *   never by name or command line, and never with `pkill` / `killall` — because
 *   the machine may be shared and a `bun` that is not ours is not ours to kill.
 *   (Signalling only the direct child would orphan a whole `bun run check`:
 *   `bun run` exits on SIGTERM and leaves its script running.)
 *
 * ## What it cannot reproduce
 *
 * Bun on PATH may not be the version CI pins (the runner prints both); the local
 * PostgreSQL may not be 18 (16 and up is accepted, with a note); `.env` is
 * auto-loaded by Bun and CI has none (the runner warns); the `changesets` job
 * diffs COMMITTED history against the base, so uncommitted work is invisible to
 * it (the runner warns). GitHub Actions stays the authority.
 */
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Constants that mirror the workflows (pinned by tests/ci-local-parity.test.ts)
// ---------------------------------------------------------------------------

export const WORKFLOW_CI = ".github/workflows/ci.yml";
export const WORKFLOW_CHANGESETS = ".github/workflows/changesets.yml";

/** `bun-version:` of the `quality`, `e2e-smoke`, `integration-tests` jobs. */
export const CI_BUN_CURRENT = "1.4.2";
/** `bun-version:` of the `minimum-supported` job (`engines.bun >=1.3.0`). */
export const CI_BUN_MINIMUM = "1.3.0";
/** Major of the `postgres:<tag>` service image CI uses. */
export const CI_POSTGRES_MAJOR = 18;
/**
 * Oldest PostgreSQL major the runner accepts for the database jobs. 16 is the
 * version the migrations and the RLS behaviour have been verified live on
 * (docs/awcms/AUDIT_STANDAR_PENGEMBANGAN_2026-07-04.md) and what local
 * development containers use; anything older is refused (job skipped), anything
 * other than CI's 18 gets a note.
 */
export const MIN_POSTGRES_MAJOR = 16;

export const DEFAULT_BASE_REF = "origin/main";

export const EXIT = {
  pass: 0,
  failed: 1,
  incomplete: 2,
  usage: 64
} as const;

/** Environment the `e2e-smoke` job's "Start server…" step sets (minus PORT / E2E_BASE_URL). */
export const E2E_STATIC_ENV: Readonly<Record<string, string>> = {
  HOST: "127.0.0.1",
  E2E_LOGIN_IDENTIFIER: "e2e-owner@example.com",
  E2E_PASSWORD: "e2e-password-123",
  E2E_OFFICE_CODE: "HQ-E2E",
  E2E_CWV_LAB: "1"
};

/** The workflow readiness probe: an unknown path answers the catch-all 404 once the server is up. */
export const E2E_PROBE_PATH = "/__e2e_probe";
export const E2E_SETUP_PATH = "/api/v1/setup/initialize";
export const E2E_SERVER_COMMAND = [
  "bun",
  "./dist/standalone-entry.mjs"
] as const;
export const E2E_TEST_COMMAND = ["bun", "run", "test:e2e"] as const;
export const E2E_READY_ATTEMPTS = 30;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JobId =
  | "hygiene"
  | "changesets"
  | "quality"
  | "integration"
  | "minimum-supported"
  | "e2e";

/** Execution order: cheap and fast to fail first, the browser job last. */
export const JOB_ORDER: readonly JobId[] = [
  "hygiene",
  "changesets",
  "quality",
  "integration",
  "minimum-supported",
  "e2e"
];

export type CliOptions = {
  jobs: JobId[];
  base: string;
  failFast: boolean;
  allowSkip: boolean;
  list: boolean;
  help: boolean;
};

export type ParseResult =
  { ok: true; options: CliOptions } | { ok: false; error: string };

export type JobStatus = "pass" | "fail" | "skipped";

export type JobResult = {
  id: JobId;
  status: JobStatus;
  durationMs: number;
  /** pass: notes; fail: the failing step; skipped: the reason. */
  detail: string;
};

export type Verdict = "pass" | "fail" | "incomplete";

export type StepOutcome = { ok: true } | { ok: false; detail: string };

export type RunnerIO = {
  log: (line: string) => void;
  /** `inherit` for real runs; tests pass `ignore` to keep their output clean. */
  stdio: "inherit" | "ignore";
};

type EnvValue = string | ((run: JobRun) => string);

export type ShellStep = {
  kind: "shell";
  /**
   * Label printed while running. Not what the parity test matches on: a shell
   * step is identified by its `run` text, so renaming a workflow step does not
   * fail the test but changing what it executes does.
   */
  step: string;
  /** The workflow's `run:` text, verbatim. */
  run: string;
  /** The workflow step's own `env:`; a function where the value is a CLI option. */
  env?: Record<string, EnvValue>;
};

export type NativeStep = {
  kind: "native";
  /** `name:` (or the `uses:` action) of the workflow step this replaces; parity matches on it. */
  step: string;
  /** Why this cannot be the workflow text verbatim. */
  adapted: string;
  run: (run: JobRun) => Promise<StepOutcome>;
};

export type StepDef = ShellStep | NativeStep;

export type JobDef = {
  id: JobId;
  /** Other names `--job` accepts: the workflow job id. */
  aliases: readonly string[];
  workflow: typeof WORKFLOW_CI | typeof WORKFLOW_CHANGESETS;
  workflowJob: string;
  title: string;
  /** Whether the job needs the admin PostgreSQL connection. */
  needsDatabase: boolean;
  /** A reason this job cannot run on this machine, or null. */
  preflight?: (run: JobRun) => Promise<string | null>;
  steps: readonly StepDef[];
  /** Workflow steps with no local counterpart, and why. */
  omitted: Readonly<Record<string, string>>;
};

export type JobRun = {
  job: JobDef;
  options: CliOptions;
  io: RunnerIO;
  /** Environment for child processes; steps may add to it (DATABASE_URL). */
  env: Record<string, string>;
  /** Registered cleanups, run in reverse order when the job ends or on a signal. */
  cleanups: Array<() => Promise<void>>;
  /** The cleanup currently running, so a second caller waits for it instead of returning early. */
  draining?: Promise<void> | undefined;
  /** Facts the preflight established for the steps (admin URL, Bun shim, browser). */
  facts: {
    adminUrl?: string;
    postgresMajor?: number;
    minimumBunDir?: string;
    browser?: string;
  };
};

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

export function resolveJobId(name: string): JobId | undefined {
  const wanted = name.trim().toLowerCase();

  for (const job of JOBS) {
    if (job.id === wanted || job.aliases.includes(wanted)) return job.id;
  }

  return undefined;
}

export function parseArgs(argv: readonly string[]): ParseResult {
  const wanted = new Set<JobId>();
  let base = DEFAULT_BASE_REF;
  let failFast = false;
  let allowSkip = false;
  let list = false;
  let help = false;

  const takeValue = (index: number): string | undefined => {
    const value = argv[index + 1];
    return value === undefined || value.startsWith("--") ? undefined : value;
  };

  const addJobs = (raw: string): string | null => {
    for (const piece of raw.split(",")) {
      if (piece.trim() === "") continue;
      const id = resolveJobId(piece);
      if (id === undefined) {
        return `unknown job "${piece.trim()}". Valid jobs: ${JOB_ORDER.join(", ")}.`;
      }
      wanted.add(id);
    }
    return null;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);

    switch (flag) {
      case "--job":
      case "--base": {
        const value = inline ?? takeValue(i);
        if (value === undefined || value === "") {
          return { ok: false, error: `${flag} needs a value.` };
        }
        if (inline === undefined) i += 1;

        if (flag === "--base") {
          base = value;
        } else {
          const problem = addJobs(value);
          if (problem) return { ok: false, error: problem };
        }
        break;
      }
      case "--fail-fast":
        failFast = true;
        break;
      case "--keep-going":
        failFast = false;
        break;
      case "--allow-skip":
        allowSkip = true;
        break;
      case "--list":
        list = true;
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        return {
          ok: false,
          error: arg.startsWith("-")
            ? `unknown option "${arg}".`
            : `unexpected argument "${arg}" (select jobs with --job <name>).`
        };
    }
  }

  const jobs =
    wanted.size === 0
      ? [...JOB_ORDER]
      : JOB_ORDER.filter((id) => wanted.has(id));

  return { ok: true, options: { jobs, base, failFast, allowSkip, list, help } };
}

export function usage(): string {
  return [
    "Usage: bun run ci:local [options]",
    "",
    "Runs every GitHub Actions job of ci.yml and changesets.yml locally.",
    "",
    "Options:",
    "  --job <name>     Run only this job (repeatable, or comma separated).",
    `                   Jobs: ${JOB_ORDER.join(", ")}.`,
    "                   Workflow job ids (policy-check, integration-tests,",
    "                   e2e-smoke) are accepted as aliases.",
    `  --base <ref>     Base ref for the changesets job (default ${DEFAULT_BASE_REF}).`,
    "  --fail-fast      Stop at the first job that fails (default: keep going).",
    "  --keep-going     Run every selected job even after a failure (default).",
    "  --allow-skip     Exit 0 when nothing failed but some job was skipped.",
    "  --list           Print the jobs and the workflow job each one mirrors.",
    "  -h, --help       Show this help.",
    "",
    "Environment:",
    "  CI_LOCAL_DATABASE_URL  Superuser connection string of a PostgreSQL server;",
    "                         falls back to DATABASE_URL. Needed by `integration`",
    "                         and `e2e`, which create and drop their own database.",
    "",
    "Exit code: 0 all passed; 1 a job failed; 2 nothing failed but a job was",
    "skipped (not verified); 64 usage error."
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Verdict, exit code, summary
// ---------------------------------------------------------------------------

export function verdictOf(results: readonly JobResult[]): Verdict {
  if (results.some((result) => result.status === "fail")) return "fail";
  if (results.some((result) => result.status === "skipped"))
    return "incomplete";
  return "pass";
}

export function exitCodeFor(
  results: readonly JobResult[],
  options: { allowSkip: boolean }
): number {
  switch (verdictOf(results)) {
    case "fail":
      return EXIT.failed;
    case "incomplete":
      return options.allowSkip ? EXIT.pass : EXIT.incomplete;
    case "pass":
      return EXIT.pass;
  }
}

export function formatDuration(ms: number): string {
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

const STATUS_LABEL: Record<JobStatus, string> = {
  pass: "PASS",
  fail: "FAIL",
  skipped: "SKIPPED"
};

export function formatSummary(
  results: readonly JobResult[],
  options: { allowSkip: boolean }
): string {
  const rows = results.map((result) => ({
    job: result.id,
    status: STATUS_LABEL[result.status],
    time: result.status === "skipped" ? "-" : formatDuration(result.durationMs),
    detail:
      result.status === "skipped" && result.detail
        ? `(${result.detail})`
        : result.detail
  }));

  const width = (
    header: string,
    pick: (row: (typeof rows)[number]) => string
  ) => Math.max(header.length, ...rows.map((row) => pick(row).length));

  const jobWidth = width("JOB", (row) => row.job);
  const statusWidth = width("RESULT", (row) => row.status);
  const timeWidth = width("TIME", (row) => row.time);
  const line = (job: string, status: string, time: string, detail: string) =>
    `  ${job.padEnd(jobWidth)}  ${status.padEnd(statusWidth)}  ${time.padEnd(timeWidth)}  ${detail}`.trimEnd();

  const counts = {
    pass: results.filter((result) => result.status === "pass").length,
    fail: results.filter((result) => result.status === "fail").length,
    skipped: results.filter((result) => result.status === "skipped").length
  };
  const verdict = verdictOf(results);
  const tally = `${counts.pass} passed, ${counts.fail} failed, ${counts.skipped} skipped`;

  const out = [
    "ci:local summary",
    "",
    line("JOB", "RESULT", "TIME", "DETAIL"),
    ...rows.map((row) => line(row.job, row.status, row.time, row.detail)),
    ""
  ];

  if (verdict === "pass") {
    out.push(`Verdict: PASS (${tally}).`);
  } else if (verdict === "fail") {
    out.push(`Verdict: FAIL (${tally}).`);
  } else {
    out.push(
      `Verdict: INCOMPLETE (${tally}). Skipped jobs were NOT verified here; GitHub Actions will run them.` +
        (options.allowSkip ? " Exiting 0 because --allow-skip was given." : "")
    );
  }

  out.push(
    "GitHub's required checks (ruleset 11653326) still gate merging; this run is the check before push."
  );

  return out.join("\n");
}

/**
 * Run the selected jobs in order. `runJob` is injected so the ordering,
 * fail-fast and skip bookkeeping can be tested without spawning anything.
 */
export async function runSelected(
  ids: readonly JobId[],
  runJob: (id: JobId) => Promise<JobResult>,
  options: { failFast: boolean }
): Promise<JobResult[]> {
  const results: JobResult[] = [];
  let stoppedBy: JobId | undefined;

  for (const id of ids) {
    if (stoppedBy !== undefined) {
      results.push({
        id,
        status: "skipped",
        durationMs: 0,
        detail: `not run: --fail-fast after ${stoppedBy} failed`
      });
      continue;
    }

    const result = await runJob(id);
    results.push(result);

    if (result.status === "fail" && options.failFast) stoppedBy = id;
  }

  return results;
}

// ---------------------------------------------------------------------------
// Database helpers (pure parts are unit tested)
// ---------------------------------------------------------------------------

/** The admin connection string: `CI_LOCAL_DATABASE_URL`, else `DATABASE_URL`. */
export function resolveAdminDatabaseUrl(env: {
  CI_LOCAL_DATABASE_URL?: string | undefined;
  DATABASE_URL?: string | undefined;
}): { url: string; source: "CI_LOCAL_DATABASE_URL" | "DATABASE_URL" } | null {
  const dedicated = env.CI_LOCAL_DATABASE_URL?.trim();
  if (dedicated) return { url: dedicated, source: "CI_LOCAL_DATABASE_URL" };

  const fallback = env.DATABASE_URL?.trim();
  if (fallback) return { url: fallback, source: "DATABASE_URL" };

  return null;
}

const DATABASE_NAME_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

/** `awcms_cilocal_<job>_<pid>_<time>`: unique per run, a valid unquoted identifier (<= 63). */
export function throwawayDatabaseName(
  job: JobId,
  pid: number,
  now: number
): string {
  const name = `awcms_cilocal_${job.replace(/-/g, "_")}_${pid}_${now.toString(36)}`;

  if (!DATABASE_NAME_PATTERN.test(name)) {
    throw new Error(
      `generated database name is not a safe identifier: ${name}`
    );
  }

  return name;
}

/** The same server and credentials, another database. */
export function withDatabase(adminUrl: string, database: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

/** Never print a password: replace it, and the whole URL if it cannot be parsed. */
export function redactDatabaseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return "[unparseable database url]";
  }
}

/** Strip every occurrence of the secret URL (and its password) from free text. */
export function scrubSecrets(text: string, urls: readonly string[]): string {
  let out = text;

  for (const raw of urls) {
    if (!raw) continue;
    out = out.split(raw).join("[redacted url]");
    try {
      const password = new URL(raw).password;
      if (password) out = out.split(password).join("***");
    } catch {
      // not a URL: the whole-string replacement above is all there is to do
    }
  }

  return out;
}

export function postgresMajorFromVersionNum(versionNum: number): number {
  return Math.floor(versionNum / 10_000);
}

async function withAdminSql<T>(
  adminUrl: string,
  fn: (sql: Bun.SQL) => Promise<T>
): Promise<T> {
  const sql = new Bun.SQL(adminUrl, { max: 1 });

  try {
    return await fn(sql);
  } finally {
    await sql.close();
  }
}

export type AdminCheck =
  { ok: true; major: number } | { ok: false; reason: string };

/**
 * Can this connection run the database jobs? They need to CREATE DATABASE and
 * the migrations ALTER ROLE ... SET on a customised GUC (sql/019), which needs
 * SUPERUSER — CI's role is one, and so must this be.
 */
export async function checkAdminDatabase(
  adminUrl: string
): Promise<AdminCheck> {
  try {
    return await withAdminSql<AdminCheck>(adminUrl, async (sql) => {
      const rows = (await sql`
        SELECT current_setting('server_version_num')::int AS version_num,
               (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser
      `) as Array<{ version_num: number; is_superuser: boolean }>;
      const row = rows[0];

      if (!row)
        return { ok: false, reason: "the server returned no version row" };

      const major = postgresMajorFromVersionNum(Number(row.version_num));

      if (major < MIN_POSTGRES_MAJOR) {
        return {
          ok: false,
          reason: `PostgreSQL ${major} is older than the ${MIN_POSTGRES_MAJOR} minimum (CI uses ${CI_POSTGRES_MAJOR})`
        };
      }

      if (row.is_superuser !== true) {
        return {
          ok: false,
          reason:
            "the admin role is not a superuser (CI's is; the migrations and the integration harness need one)"
        };
      }

      return { ok: true, major };
    });
  } catch (error) {
    return {
      ok: false,
      reason: `cannot connect to the admin database: ${scrubSecrets(describeError(error), [adminUrl])}`
    };
  }
}

export async function createThrowawayDatabase(
  adminUrl: string,
  name: string
): Promise<void> {
  if (!DATABASE_NAME_PATTERN.test(name)) {
    throw new Error(
      `refusing to create database "${name}": not a safe identifier`
    );
  }

  await withAdminSql(adminUrl, (sql) =>
    sql.unsafe(`CREATE DATABASE "${name}"`)
  );
}

export async function dropThrowawayDatabase(
  adminUrl: string,
  name: string
): Promise<void> {
  if (!DATABASE_NAME_PATTERN.test(name) || !name.startsWith("awcms_cilocal_")) {
    throw new Error(
      `refusing to drop database "${name}": not one this runner creates`
    );
  }

  await withAdminSql(adminUrl, (sql) =>
    sql.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
  );
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

/** The part of a spawned process this file relies on. */
type Child = {
  readonly pid: number;
  kill(signal?: NodeJS.Signals | number): void;
  readonly exited: Promise<number>;
  readonly exitCode: number | null;
};

const activeChildren = new Set<Child>();

export type ProcessRow = { pid: number; ppid: number; stat: string };

/**
 * Every descendant of `root` in a process table — its children, theirs, and so
 * on — top-down (breadth first). Pure: the table is passed in.
 *
 * Why this exists: a signal to a step's DIRECT child does not reach what that
 * child started. `bun run <script>` exits on SIGTERM and leaves its script's
 * processes running (measured with a one-line package script around a long
 * `sleep`: the `sleep` survived the SIGTERM), so
 * terminating only direct children on Ctrl-C / SIGTERM would orphan a whole
 * `bun run check` underneath the runner, still holding the throwaway database.
 *
 * It walks PARENT LINKS from a PID this runner spawned itself. It never matches
 * by name or command line, so it cannot reach another session's `bun` — the
 * runner terminates its own process tree and nothing else.
 */
export function descendantsOf(
  table: readonly Pick<ProcessRow, "pid" | "ppid">[],
  root: number
): number[] {
  const byParent = new Map<number, number[]>();

  for (const { pid, ppid } of table) {
    const siblings = byParent.get(ppid) ?? [];
    siblings.push(pid);
    byParent.set(ppid, siblings);
  }

  const seen = new Set<number>([root]);
  const found: number[] = [];
  const queue = [root];

  while (queue.length > 0) {
    const current = queue.shift()!;

    for (const child of byParent.get(current) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      found.push(child);
      queue.push(child);
    }
  }

  return found;
}

/** Parse `ps -A -o pid=,ppid=,stat=` output; unparseable lines are ignored. */
export function parseProcessTable(output: string): ProcessRow[] {
  return output.split("\n").flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)$/);
    return match
      ? [{ pid: Number(match[1]), ppid: Number(match[2]), stat: match[3]! }]
      : [];
  });
}

async function processTable(): Promise<ProcessRow[]> {
  try {
    const listing = await capture(
      ["ps", "-A", "-o", "pid=,ppid=,stat="],
      10_000
    );
    return listing.code === 0 ? parseProcessTable(listing.out) : [];
  } catch {
    return [];
  }
}

function signalPid(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch {
    // already gone, or not ours to signal: nothing to do
  }
}

/**
 * Terminate `child` and everything it started — and nothing else.
 *
 * Top-down, so a shell cannot start the next command of its script after the
 * current one dies. SIGTERM first; whatever is still alive after `graceMs`
 * (zombies excluded) gets SIGKILL. A child that has already exited is left
 * alone: its PID may belong to someone else by now.
 */
export async function terminateTree(
  child: Pick<Child, "pid" | "kill" | "exitCode">,
  graceMs = 3000
): Promise<void> {
  if (child.exitCode !== null) return;

  const victims = [
    child.pid,
    ...descendantsOf(await processTable(), child.pid)
  ];

  child.kill("SIGTERM");
  for (const pid of victims.slice(1)) signalPid(pid, "SIGTERM");

  const stillAlive = async () => {
    const table = await processTable();
    return victims.filter((pid) =>
      table.some((row) => row.pid === pid && !row.stat.startsWith("Z"))
    );
  };

  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if ((await stillAlive()).length === 0) return;
    await sleep(100);
  }

  for (const pid of await stillAlive()) signalPid(pid, "SIGKILL");
}

function bashPath(): string | null {
  return Bun.which("bash");
}

async function exec(
  run: JobRun,
  argv: string[],
  env: Record<string, string>
): Promise<number> {
  // Nothing may start after the first SIGINT / SIGTERM / SIGHUP; the step
  // fails like any other and the job unwinds into its cleanups.
  if (isInterrupted()) return 130;

  const child = Bun.spawn(argv, {
    env,
    stdin: "ignore",
    stdout: run.io.stdio,
    stderr: run.io.stdio
  });
  activeChildren.add(child);

  try {
    return await child.exited;
  } finally {
    activeChildren.delete(child);
  }
}

async function capture(
  argv: string[],
  timeoutMs = 30_000
): Promise<{ code: number; out: string }> {
  const child = Bun.spawn(argv, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe"
  });
  const timer = setTimeout(() => child.kill(), timeoutMs);

  try {
    const [out, code] = await Promise.all([
      new Response(child.stdout).text(),
      child.exited
    ]);
    return { code, out: out.trim() };
  } finally {
    clearTimeout(timer);
  }
}

function resolveEnv(
  run: JobRun,
  stepEnv: Record<string, EnvValue> | undefined
): Record<string, string> {
  const resolved: Record<string, string> = {};

  for (const [key, value] of Object.entries(stepEnv ?? {})) {
    resolved[key] = typeof value === "function" ? value(run) : value;
  }

  return { ...run.env, ...resolved };
}

/** Comment-free, one-line-per-command echo, like the "Run ..." header Actions prints. */
function echoCommand(run: JobRun, text: string): void {
  for (const line of text.trim().split("\n")) run.io.log(`  $ ${line}`);
}

// ---------------------------------------------------------------------------
// Steps shared by several jobs
// ---------------------------------------------------------------------------

const INSTALL_STEP: ShellStep = {
  kind: "shell",
  step: "Install dependencies",
  run: "bun install --frozen-lockfile"
};

const GITHUB_ACTION_OMISSIONS = {
  "actions/checkout":
    "the working tree you are in is the checkout (committed state plus any local edits)",
  "Setup Bun":
    "uses the `bun` on PATH; the runner prints it next to the version CI pins",
  "Cache Bun install cache":
    "Bun's global install cache already persists on a developer machine"
} as const;

/** The native step that stands in for the workflow's `services: postgres` + `$GITHUB_ENV` line. */
const ASSEMBLE_DATABASE_URL_STEP: NativeStep = {
  kind: "native",
  step: "Assemble DATABASE_URL for this job's Postgres",
  adapted:
    "CI starts a postgres:18.4 service container and exports DATABASE_URL through $GITHUB_ENV; locally the runner creates a uniquely named throwaway database on the admin server, points DATABASE_URL (and the setup/worker URLs) at it, and drops it when the job ends",
  async run(run) {
    const adminUrl = run.facts.adminUrl;
    if (!adminUrl)
      return {
        ok: false,
        detail: "no admin database URL (preflight did not run)"
      };

    const name = throwawayDatabaseName(run.job.id, process.pid, Date.now());

    try {
      await createThrowawayDatabase(adminUrl, name);
    } catch (error) {
      return {
        ok: false,
        detail: `could not create ${name}: ${scrubSecrets(describeError(error), [adminUrl])}`
      };
    }

    run.cleanups.push(async () => {
      await dropThrowawayDatabase(adminUrl, name);
      run.io.log(`  dropped throwaway database ${name}`);
    });

    const url = withDatabase(adminUrl, name);
    run.env.DATABASE_URL = url;
    run.env.SETUP_DATABASE_URL = url;
    run.env.WORKER_DATABASE_URL = url;
    run.io.log(
      `  created throwaway database ${name} on ${redactDatabaseUrl(adminUrl)}`
    );

    return { ok: true };
  }
};

async function databasePreflight(run: JobRun): Promise<string | null> {
  const admin = resolveAdminDatabaseUrl({
    CI_LOCAL_DATABASE_URL: process.env.CI_LOCAL_DATABASE_URL,
    DATABASE_URL: process.env.DATABASE_URL
  });

  if (!admin) {
    return "no PostgreSQL admin URL: set CI_LOCAL_DATABASE_URL (or DATABASE_URL) to a superuser connection string";
  }

  const checked = await checkAdminDatabase(admin.url);
  if (!checked.ok) return checked.reason;

  run.facts.adminUrl = admin.url;
  run.facts.postgresMajor = checked.major;
  run.io.log(
    `  admin database: ${redactDatabaseUrl(admin.url)} (from ${admin.source}), PostgreSQL ${checked.major}` +
      (checked.major === CI_POSTGRES_MAJOR
        ? ""
        : ` (CI uses ${CI_POSTGRES_MAJOR}; accepted, but the GitHub job is authoritative)`)
  );

  return null;
}

// ---------------------------------------------------------------------------
// Minimum-supported Bun
// ---------------------------------------------------------------------------

/**
 * Locate a Bun at exactly `CI_BUN_MINIMUM` and expose it as `bun` in a temp
 * directory that the job puts first on PATH — every nested `bun run` inside a
 * package script then resolves to it too.
 *
 * Order: `bun` on PATH if it already is that version, else `bunx bun@<version>`
 * (the npm package ships the binary; once cached it also works offline). If
 * neither works the job is skipped, never run on the wrong Bun.
 */
export async function provisionMinimumBun(
  version: string
): Promise<{ ok: true; dir: string } | { ok: false; reason: string }> {
  let binary: string | null = null;
  const onPath = Bun.which("bun");

  if (onPath) {
    const probe = await capture([onPath, "--version"]);
    if (probe.code === 0 && probe.out === version) binary = onPath;
  }

  if (binary === null) {
    const probe = await capture(
      [process.execPath, "x", `bun@${version}`, "--print", "process.execPath"],
      120_000
    ).catch(() => ({ code: 1, out: "" }));
    const candidate = probe.out.split("\n").pop()?.trim() ?? "";

    if (probe.code !== 0 || !candidate || !(await exists(candidate))) {
      return {
        ok: false,
        reason: `Bun ${version} is not available (\`bunx bun@${version}\` failed — offline with a cold cache?)`
      };
    }

    binary = candidate;
  }

  const verified = await capture([binary, "--version"]);
  if (verified.code !== 0 || verified.out !== version) {
    return {
      ok: false,
      reason: `found a Bun at ${binary} but it reports ${verified.out || "no version"}, not ${version}`
    };
  }

  const dir = await mkdtemp(path.join(tmpdir(), "ci-local-bun-"));
  await symlink(binary, path.join(dir, "bun"));
  await symlink(binary, path.join(dir, "bunx"));

  return { ok: true, dir };
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Playwright browser detection (e2e)
// ---------------------------------------------------------------------------

/** `chromium` / `chromium-headless-shell` revisions the installed Playwright wants. */
export function expectedChromiumRevisions(browsersJson: string): string[] {
  const parsed = JSON.parse(browsersJson) as {
    browsers?: Array<{ name?: string; revision?: string }>;
  };

  const revisions = (parsed.browsers ?? [])
    .filter(
      (b) => b.name === "chromium" || b.name === "chromium-headless-shell"
    )
    .map((b) => b.revision ?? "")
    .filter(Boolean);

  return [...new Set(revisions)];
}

function browsersDirectory(env: NodeJS.ProcessEnv): string | null {
  const configured = env.PLAYWRIGHT_BROWSERS_PATH;
  if (configured && configured !== "0") return configured;
  if (configured === "0") return null;

  switch (process.platform) {
    case "linux":
      return path.join(homedir(), ".cache", "ms-playwright");
    case "darwin":
      return path.join(homedir(), "Library", "Caches", "ms-playwright");
    default:
      return null;
  }
}

/**
 * A reason the browser job cannot run, or null (with `run.facts.browser` set).
 * The workflow runs `bun run test:e2e:install`, which is `playwright install
 * --with-deps` — it needs root/apt and the network, so the runner verifies
 * instead of installing, and says what to do when the browser is missing.
 */
export async function browserPreflight(run: JobRun): Promise<string | null> {
  const executable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

  if (executable) {
    if (await exists(executable)) {
      run.facts.browser = executable;
      return null;
    }
    return `PLAYWRIGHT_CHROMIUM_EXECUTABLE points at ${executable}, which does not exist`;
  }

  let revisions: string[] = [];
  try {
    revisions = expectedChromiumRevisions(
      await readFile("node_modules/playwright-core/browsers.json", "utf8")
    );
  } catch {
    // Dependencies not installed or layout changed: let Playwright be the judge.
    run.facts.browser = "(not verified)";
    return null;
  }

  const directory = browsersDirectory(process.env);
  const present = directory
    ? await readdir(directory).catch(() => [] as string[])
    : [];
  const hit = present.find((entry) =>
    revisions.some(
      (revision) =>
        entry === `chromium-${revision}` ||
        entry === `chromium_headless_shell-${revision}`
    )
  );

  if (hit && directory) {
    run.facts.browser = path.join(directory, hit);
    return null;
  }

  const found = present.filter((entry) => entry.startsWith("chromium"));
  return (
    `Playwright Chromium revision ${revisions.join("/") || "?"} is not installed in ${directory ?? "the default browsers directory"}` +
    (found.length > 0 ? ` (found: ${found.join(", ")})` : "") +
    "; run `bun run test:e2e:install` once, or set PLAYWRIGHT_CHROMIUM_EXECUTABLE to a Chromium binary"
  );
}

// ---------------------------------------------------------------------------
// e2e: server start + seed + test
// ---------------------------------------------------------------------------

export function buildSetupBody(env: Readonly<Record<string, string>>) {
  return {
    tenantCode: "e2e",
    tenantName: "E2E Tenant",
    officeCode: env.E2E_OFFICE_CODE,
    officeName: "E2E Head Office",
    ownerDisplayName: "E2E Owner",
    ownerLoginIdentifier: env.E2E_LOGIN_IDENTIFIER,
    ownerPassword: env.E2E_PASSWORD
  };
}

async function pickFreePort(): Promise<number> {
  const probe = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response("")
  });
  const port = probe.port;
  await probe.stop(true);

  if (!port) throw new Error("could not reserve a free local port");
  return port;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer(
  baseUrl: string,
  server: Child
): Promise<{ ok: true } | { ok: false; detail: string }> {
  for (let attempt = 1; attempt <= E2E_READY_ATTEMPTS; attempt++) {
    if (server.exitCode !== null) {
      return {
        ok: false,
        detail: `the server exited early with code ${server.exitCode}`
      };
    }

    try {
      const response = await fetch(`${baseUrl}${E2E_PROBE_PATH}`, {
        signal: AbortSignal.timeout(3000)
      });
      if (response.status === 404) return { ok: true };
    } catch {
      // not listening yet
    }

    await sleep(1000);
  }

  return { ok: false, detail: `server never became ready on ${baseUrl}` };
}

const e2eServerStep: NativeStep = {
  kind: "native",
  step: "Start server, seed a tenant via the setup wizard, run E2E",
  adapted:
    "the workflow script hard-codes 127.0.0.1:4321, which collides with a running `bun run dev` (the probe would get the DEV server's 404 and seed the wrong database); the runner picks a free port, waits for ITS OWN child, seeds through the same POST with fetch instead of curl+jq, and kills the server when done",
  async run(run) {
    const port = await pickFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const serverEnv = {
      ...run.env,
      ...E2E_STATIC_ENV,
      PORT: String(port),
      E2E_BASE_URL: baseUrl
    };
    const bun = Bun.which("bun") ?? process.execPath;

    if (isInterrupted()) return { ok: false, detail: "interrupted" };

    echoCommand(run, `${E2E_SERVER_COMMAND.join(" ")} &   # PORT=${port}`);
    const server = Bun.spawn([bun, ...E2E_SERVER_COMMAND.slice(1)], {
      env: serverEnv,
      stdin: "ignore",
      stdout: run.io.stdio,
      stderr: run.io.stdio
    });
    activeChildren.add(server);

    try {
      const ready = await waitForServer(baseUrl, server);
      if (!ready.ok) return ready;

      const response = await fetch(`${baseUrl}${E2E_SETUP_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSetupBody(E2E_STATIC_ENV)),
        signal: AbortSignal.timeout(60_000)
      });
      const text = await response.text();
      run.io.log(`  setup response: ${text}`);

      let tenantId: unknown;
      try {
        tenantId = (JSON.parse(text) as { data?: { tenantId?: unknown } }).data
          ?.tenantId;
      } catch {
        tenantId = undefined;
      }

      if (typeof tenantId !== "string" || tenantId === "") {
        return {
          ok: false,
          detail: "setup/initialize did not return a tenantId"
        };
      }

      echoCommand(run, E2E_TEST_COMMAND.join(" "));
      const code = await exec(run, [bun, ...E2E_TEST_COMMAND.slice(1)], {
        ...serverEnv,
        E2E_TENANT_ID: tenantId
      });

      return code === 0
        ? { ok: true }
        : {
            ok: false,
            detail: `\`${E2E_TEST_COMMAND.join(" ")}\` exited with code ${code}`
          };
    } finally {
      activeChildren.delete(server);
      await terminateTree(server);
    }
  }
};

// ---------------------------------------------------------------------------
// Job definitions — the workflow text, step by step
// ---------------------------------------------------------------------------

export const JOBS: readonly JobDef[] = [
  {
    id: "hygiene",
    aliases: [],
    workflow: WORKFLOW_CI,
    workflowJob: "hygiene",
    title: "Repo hygiene (Bun-only + no secrets)",
    needsDatabase: false,
    steps: [
      {
        kind: "shell",
        step: "No Node.js tooling in package scripts (Bun-only)",
        run: `if grep -REn '"[^"]*":\\s*"(npm|npx|pnpm|yarn|node) ' package.json; then
  echo "::error::package.json scripts harus Bun-only (lihat AGENTS.md aturan Bun-only)."
  exit 1
fi
echo "OK: tidak ada tooling Node.js di package scripts."`
      },
      {
        kind: "shell",
        step: "No committed .env / secret files",
        run: `if git ls-files | grep -E '(^|/)\\.env($|\\.)' | grep -v '\\.env\\.example$'; then
  echo "::error::Berkas .env tidak boleh di-commit."
  exit 1
fi
echo "OK: tidak ada berkas .env yang ter-track."`
      }
    ],
    omitted: { "actions/checkout": GITHUB_ACTION_OMISSIONS["actions/checkout"] }
  },
  {
    id: "changesets",
    aliases: ["policy-check"],
    workflow: WORKFLOW_CHANGESETS,
    workflowJob: "policy-check",
    title: "Changeset required for behavior changes",
    needsDatabase: false,
    async preflight(run) {
      const base = await capture([
        "git",
        "rev-parse",
        "--verify",
        "--quiet",
        `${run.options.base}^{commit}`
      ]);
      if (base.code !== 0) {
        return `base ref ${run.options.base} does not exist locally; fetch it or pass --base <ref>`;
      }

      // The policy diffs `<base>...HEAD`, which needs a merge-base. CI checks
      // out with `fetch-depth: 0` for exactly that; a shallow clone may not
      // have one, and then `git diff` would fail with "no merge base".
      const mergeBase = await capture([
        "git",
        "merge-base",
        run.options.base,
        "HEAD"
      ]);
      if (mergeBase.code !== 0) {
        const shallow = await capture([
          "git",
          "rev-parse",
          "--is-shallow-repository"
        ]);
        return shallow.out === "true"
          ? `no merge-base between ${run.options.base} and HEAD in this shallow clone (CI uses fetch-depth: 0); run \`git fetch --unshallow\``
          : `no merge-base between ${run.options.base} and HEAD`;
      }

      return null;
    },
    steps: [
      {
        kind: "native",
        step: "Fetch base branch tip for diffing",
        adapted:
          "CI fetches `origin main`; locally the base is --base <ref> (default origin/main), fetched only when it is an origin/<branch> ref, and a failed fetch (offline) falls back to the local ref with a note",
        async run(run) {
          const match = run.options.base.match(/^origin\/(.+)$/);

          if (!match) {
            run.io.log(
              `  base ${run.options.base} is a local ref; nothing to fetch`
            );
            return { ok: true };
          }

          echoCommand(run, `git fetch origin ${match[1]}`);
          const code = await exec(
            run,
            ["git", "fetch", "origin", match[1]!],
            run.env
          );
          if (code !== 0) {
            run.io.log(
              `  note: could not fetch origin/${match[1]} (offline?); diffing against the local ${run.options.base}, which may be stale`
            );
          }

          return { ok: true };
        }
      },
      INSTALL_STEP,
      {
        kind: "shell",
        step: "Verify required changeset(s) for this PR's changes",
        run: "bun run changesets:policy:check",
        env: { CHANGESET_POLICY_BASE_REF: (run) => run.options.base }
      }
    ],
    omitted: {
      "actions/checkout":
        "the repository you are in; a base with no merge-base (typically a shallow clone) is refused in the preflight, where CI uses fetch-depth: 0",
      "Setup Bun": GITHUB_ACTION_OMISSIONS["Setup Bun"],
      "Cache Bun install cache":
        GITHUB_ACTION_OMISSIONS["Cache Bun install cache"]
    }
  },
  {
    id: "quality",
    aliases: [],
    workflow: WORKFLOW_CI,
    workflowJob: "quality",
    title: "Quality (lint + docs + contracts + typecheck + test + build)",
    needsDatabase: false,
    steps: [
      {
        kind: "native",
        step: "actions/checkout",
        adapted:
          "the checkout sets `fetch-tags: true` because `bun run check` includes `version:check`, which reports OK over zero tags otherwise; locally the runner fetches tags (a failure only warns, and version:check then sees the local tags)",
        async run(run) {
          echoCommand(run, "git fetch --tags origin");
          const code = await exec(
            run,
            ["git", "fetch", "--tags", "origin"],
            run.env
          );
          if (code !== 0) {
            run.io.log(
              "  note: could not fetch tags (offline?); version:check will only see the tags already present locally"
            );
          }

          return { ok: true };
        }
      },
      INSTALL_STEP,
      {
        kind: "shell",
        step: "Full quality gate (bun run check)",
        run: "bun run check",
        env: { DATABASE_URL: "" }
      }
    ],
    omitted: {
      "Setup Bun": GITHUB_ACTION_OMISSIONS["Setup Bun"],
      "Cache Bun install cache":
        GITHUB_ACTION_OMISSIONS["Cache Bun install cache"],
      "Upload failure diagnostics":
        "an `if: failure()` artifact upload; the output is already on your terminal and in dist/"
    }
  },
  {
    id: "integration",
    aliases: ["integration-tests"],
    workflow: WORKFLOW_CI,
    workflowJob: "integration-tests",
    title: "Integration tests (RLS + DB role separation)",
    needsDatabase: true,
    preflight: databasePreflight,
    steps: [
      ASSEMBLE_DATABASE_URL_STEP,
      INSTALL_STEP,
      {
        kind: "shell",
        step: "Apply migrations against this job's Postgres",
        run: "bun run db:migrate"
      },
      {
        kind: "shell",
        step: "Payroll catalog boundary (the migrated database)",
        run: "bun run payroll:catalog-boundary:check"
      },
      {
        kind: "shell",
        step: "Run DB-gated integration tests",
        run: "bun test tests/integration/ --timeout 60000"
      },
      {
        kind: "shell",
        step: "Run DB-gated integration tests (legacy ad-hoc suite)",
        run: `bun test tests/audit-log-purge.test.ts tests/family-conformance-db.test.ts tests/keyset-pagination-precision-postgres.test.ts tests/mfa-integration.test.ts tests/mfa-login-e2e.test.ts tests/office-directory-postgres.test.ts tests/partner-delegated-access-e2e.test.ts tests/oidc-integration.test.ts tests/openapi-office-response-schema-postgres.test.ts tests/reporting-projection-rebuild-lock.test.ts tests/security-readiness-failclosed.test.ts tests/security-readiness-rls.test.ts tests/security-readiness-worker-setup-grants.test.ts tests/security-readiness-worker-credential-columns.test.ts tests/sync-hmac-versioned.test.ts tests/tenant-selection-e2e.test.ts tests/turnstile-login-e2e.test.ts tests/workflow-approval-concurrency.test.ts`
      }
    ],
    omitted: {
      "actions/checkout": GITHUB_ACTION_OMISSIONS["actions/checkout"],
      "Setup Bun": GITHUB_ACTION_OMISSIONS["Setup Bun"],
      "Cache Bun install cache":
        GITHUB_ACTION_OMISSIONS["Cache Bun install cache"]
    }
  },
  {
    id: "minimum-supported",
    aliases: [],
    workflow: WORKFLOW_CI,
    workflowJob: "minimum-supported",
    title: `Minimum-supported versions (Bun ${CI_BUN_MINIMUM} floor)`,
    needsDatabase: false,
    async preflight(run) {
      const provisioned = await provisionMinimumBun(CI_BUN_MINIMUM);
      if (!provisioned.ok) return provisioned.reason;

      run.facts.minimumBunDir = provisioned.dir;
      run.cleanups.push(async () => {
        await rm(provisioned.dir, { recursive: true, force: true });
      });

      return null;
    },
    steps: [
      {
        kind: "native",
        step: "Setup Bun (minimum-supported floor)",
        adapted: `oven-sh/setup-bun installs Bun ${CI_BUN_MINIMUM}; locally the runner resolves that exact version (\`bun\` on PATH if it already is ${CI_BUN_MINIMUM}, else \`bunx bun@${CI_BUN_MINIMUM}\`) and puts it first on PATH for this job only, so nested \`bun run\` calls use it too`,
        async run(run) {
          const dir = run.facts.minimumBunDir;
          if (!dir)
            return { ok: false, detail: "no Bun shim (preflight did not run)" };

          run.env.PATH = `${dir}${path.delimiter}${run.env.PATH ?? ""}`;
          echoCommand(run, "bun --version");
          const code = await exec(
            run,
            [bashPath() ?? "bash", "-e", "-c", "bun --version"],
            run.env
          );

          return code === 0
            ? { ok: true }
            : { ok: false, detail: "the minimum Bun shim did not run" };
        }
      },
      { ...INSTALL_STEP, step: "Install dependencies (frozen)" },
      {
        kind: "shell",
        step: "Typecheck on minimum Bun",
        run: "bun run typecheck"
      },
      {
        kind: "shell",
        step: "Build Astro SSR on minimum Bun",
        run: "bun run build"
      },
      {
        kind: "shell",
        step: "Family conformance on minimum Bun",
        run: "bun run family:conformance:check"
      }
    ],
    omitted: {
      "actions/checkout": GITHUB_ACTION_OMISSIONS["actions/checkout"],
      "Cache Bun install cache":
        GITHUB_ACTION_OMISSIONS["Cache Bun install cache"]
    }
  },
  {
    id: "e2e",
    aliases: ["e2e-smoke"],
    workflow: WORKFLOW_CI,
    workflowJob: "e2e-smoke",
    title: "E2E smoke (Playwright)",
    needsDatabase: true,
    async preflight(run) {
      return (await databasePreflight(run)) ?? (await browserPreflight(run));
    },
    steps: [
      ASSEMBLE_DATABASE_URL_STEP,
      INSTALL_STEP,
      {
        kind: "shell",
        step: "Apply migrations",
        run: "bun run db:migrate"
      },
      {
        kind: "shell",
        step: "Build Astro foundation",
        run: "bun run build"
      },
      {
        kind: "native",
        step: "Install Playwright Chromium (with OS deps)",
        adapted:
          "`bun run test:e2e:install` is `playwright install --with-deps`, which needs root/apt and the network; the preflight verified the browser instead (or skipped the job and said how to install it)",
        async run(run) {
          run.io.log(
            `  Playwright Chromium: ${run.facts.browser ?? "(unknown)"}`
          );
          return { ok: true };
        }
      },
      e2eServerStep
    ],
    omitted: {
      "actions/checkout": GITHUB_ACTION_OMISSIONS["actions/checkout"],
      "Setup Bun": GITHUB_ACTION_OMISSIONS["Setup Bun"],
      "Cache Bun install cache":
        GITHUB_ACTION_OMISSIONS["Cache Bun install cache"]
    }
  }
];

export function jobById(id: JobId): JobDef {
  const job = JOBS.find((candidate) => candidate.id === id);
  if (!job) throw new Error(`no job definition for ${id}`);
  return job;
}

/** Key the parity test and the omissions share: a step's `name`, else its action. */
export function workflowStepKey(step: {
  name?: string;
  uses?: string;
}): string {
  return step.name ?? (step.uses ? step.uses.split("@")[0]! : "(unnamed step)");
}

// ---------------------------------------------------------------------------
// Running one job
// ---------------------------------------------------------------------------

/** Environment every child process starts from (before job and step overrides). */
export function baseChildEnv(
  processEnv: Readonly<Record<string, string | undefined>>
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(processEnv)) {
    if (value !== undefined) env[key] = value;
  }

  // GitHub-hosted runners set CI=true; Playwright (retries, forbidOnly,
  // reporter) and bun test (snapshot writes) change behaviour on it.
  env.CI = "true";
  // Pinned for every job, whatever the shell or .env exports: blank is what CI
  // has (client.ts treats blank as unset); the two database jobs overwrite them
  // with the throwaway database. A URL for a real database can never leak in.
  env.DATABASE_URL = "";
  env.SETUP_DATABASE_URL = "";
  env.WORKER_DATABASE_URL = "";

  return env;
}

export async function runJob(
  job: JobDef,
  options: CliOptions,
  io: RunnerIO,
  processEnv: Readonly<Record<string, string | undefined>> = process.env
): Promise<JobResult> {
  const started = Date.now();
  const run: JobRun = {
    job,
    options,
    io,
    env: baseChildEnv(processEnv),
    cleanups: [],
    facts: {}
  };
  const elapsed = () => Date.now() - started;
  const finish = (status: JobStatus, detail: string): JobResult => ({
    id: job.id,
    status,
    durationMs: elapsed(),
    detail
  });

  io.log("");
  io.log(`==> ${job.id}: ${job.title}`);
  io.log(`    mirrors ${job.workflow} > ${job.workflowJob}`);
  activeRuns.add(run);

  try {
    if (!bashPath()) {
      return finish(
        "skipped",
        "bash not found on PATH (the workflow `run:` steps are bash scripts)"
      );
    }

    const skip = await job.preflight?.(run);
    if (skip) {
      io.log(`    skipped: ${skip}`);
      return finish("skipped", skip);
    }

    for (const step of job.steps) {
      if (isInterrupted())
        return finish("fail", "interrupted before the next step");

      io.log("");
      io.log(`--> ${job.id} / ${step.step}`);

      let outcome: StepOutcome;

      if (step.kind === "native") {
        try {
          outcome = await step.run(run);
        } catch (error) {
          outcome = { ok: false, detail: describeError(error) };
        }
      } else {
        echoCommand(run, step.run);
        const code = await exec(
          run,
          [bashPath()!, "-e", "-c", step.run],
          resolveEnv(run, step.env)
        );
        outcome =
          code === 0
            ? { ok: true }
            : { ok: false, detail: `exited with code ${code}` };
      }

      if (!outcome.ok) {
        const detail = `step "${step.step}" ${outcome.detail}`;
        io.log(`    FAILED: ${detail}`);
        return finish("fail", detail);
      }
    }

    return finish("pass", passNotes(run));
  } finally {
    await runCleanups(run);
    activeRuns.delete(run);
  }
}

function passNotes(run: JobRun): string {
  const notes: string[] = [];

  if (
    run.facts.postgresMajor !== undefined &&
    run.facts.postgresMajor !== CI_POSTGRES_MAJOR
  ) {
    notes.push(
      `PostgreSQL ${run.facts.postgresMajor} (CI ${CI_POSTGRES_MAJOR})`
    );
  }
  if (run.job.id === "minimum-supported") notes.push(`Bun ${CI_BUN_MINIMUM}`);

  return notes.join("; ");
}

/**
 * Run the registered cleanups, newest first, one at a time.
 *
 * Callable from two places at once — the job's own `finally` and the signal
 * handler — and that is why it is not a plain pop-and-await loop. The first
 * version of this was one, and a live SIGTERM showed the flaw: the handler
 * popped the throwaway-database drop and began awaiting it, the job's `finally`
 * then saw an EMPTY list, returned at once, and the next job started while the
 * drop was still in flight (and the handler's `process.exit` later cut a build
 * short). So a caller that finds a cleanup in flight waits for it, then looks
 * again — a cleanup registered meanwhile still runs.
 */
export async function runCleanups(run: JobRun): Promise<void> {
  for (;;) {
    if (run.draining) {
      await run.draining;
      continue;
    }

    const cleanup = run.cleanups.pop();
    if (!cleanup) return;

    const settled = (async () => {
      try {
        await cleanup();
      } catch (error) {
        run.io.log(
          `    cleanup failed: ${scrubSecrets(describeError(error), [run.facts.adminUrl ?? ""])}`
        );
      }
    })().finally(() => {
      run.draining = undefined;
    });

    run.draining = settled;
    await settled;
  }
}

const activeRuns = new Set<JobRun>();

/** How long after the interrupt work is done the handler waits for `main` to print its summary. */
const INTERRUPT_EXIT_DELAY_MS = 1500;

/** Set by the first SIGINT / SIGTERM / SIGHUP: nothing new may start after it. */
let interrupted: { exitCode: number; done: Promise<void> } | null = null;

export function isInterrupted(): boolean {
  return interrupted !== null;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function describeRepository(): Promise<string> {
  const sha = await capture(["git", "rev-parse", "--short", "HEAD"]).catch(
    () => null
  );
  const branch = await capture(["git", "branch", "--show-current"]).catch(
    () => null
  );

  return `${branch?.out || "(detached)"} @ ${sha?.out || "?"}`;
}

async function preRunNotes(options: CliOptions, io: RunnerIO): Promise<void> {
  io.log(
    `bun ${Bun.version} here; CI pins ${CI_BUN_CURRENT} (quality, integration, e2e) and ${CI_BUN_MINIMUM} (minimum-supported).`
  );

  const status = await capture(["git", "status", "--porcelain"]).catch(
    () => null
  );
  if (status && status.out !== "" && options.jobs.includes("changesets")) {
    io.log(
      "note: the working tree has uncommitted changes. The changesets job diffs COMMITTED history against the base, so uncommitted files (including a new changeset) are not seen by it; commit first for a faithful result."
    );
  }

  for (const name of [".env", ".env.local", ".env.development", ".env.test"]) {
    if (await exists(name)) {
      io.log(
        `note: ${name} exists. Bun loads it automatically and CI has none, so variables in it can make a local run differ from CI (the database URLs are pinned regardless).`
      );
      break;
    }
  }
}

/**
 * On the first SIGINT / SIGTERM / SIGHUP: stop starting anything, terminate the
 * process trees of the children THIS runner spawned (and no other process), run
 * the registered cleanups — the throwaway-database drops — and exit with the
 * conventional 128+signal code. A second signal gets the default behaviour.
 */
export function installSignalHandlers(): void {
  const stop = (signal: NodeJS.Signals, exitCode: number) => {
    process.once(signal, () => {
      // Set synchronously: from this tick on nothing new may start.
      const state = { exitCode, done: Promise.resolve() };
      interrupted = state;

      state.done = (async () => {
        await Promise.all(
          [...activeChildren].map((child) => terminateTree(child))
        );
        for (const run of [...activeRuns]) await runCleanups(run);
      })();

      // Exit once the work is done — after a short window in which `main` can
      // print its summary and return the same code first (it normally wins).
      void state.done.then(() => {
        setTimeout(() => process.exit(exitCode), INTERRUPT_EXIT_DELAY_MS);
      });
    });
  };

  stop("SIGINT", 130);
  stop("SIGTERM", 143);
  stop("SIGHUP", 129);
}

export async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv);

  if (!parsed.ok) {
    console.log(`ci:local: ${parsed.error}\n\n${usage()}`);
    return EXIT.usage;
  }

  const { options } = parsed;

  if (options.help) {
    console.log(usage());
    return EXIT.pass;
  }

  if (options.list) {
    for (const id of JOB_ORDER) {
      const job = jobById(id);
      console.log(
        `${job.id.padEnd(18)} ${job.workflow} > ${job.workflowJob}${job.needsDatabase ? "  (needs PostgreSQL)" : ""}`
      );
    }
    return EXIT.pass;
  }

  const io: RunnerIO = { log: (line) => console.log(line), stdio: "inherit" };
  installSignalHandlers();

  io.log(
    `ci:local: ${options.jobs.join(", ")} on ${await describeRepository()} (base ${options.base})`
  );
  await preRunNotes(options, io);

  const results = await runSelected(
    options.jobs,
    async (id) =>
      isInterrupted()
        ? { id, status: "skipped", durationMs: 0, detail: "interrupted" }
        : runJob(jobById(id), options, io),
    { failFast: options.failFast }
  );

  io.log("");
  io.log(formatSummary(results, options));

  if (interrupted) {
    // The handler is still terminating process trees and dropping databases;
    // returning now would let process.exit cut that short.
    await interrupted.done;
    return interrupted.exitCode;
  }

  return exitCodeFor(results, options);
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
