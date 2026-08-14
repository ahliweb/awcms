#!/usr/bin/env bun
/**
 * jobs:crontab — render the job schedule from the module registry, and hold the
 * rendered artefact to it.
 *
 * ## Why this exists
 *
 * `crontab -l` on the production host carried exactly ONE of the 32 declared
 * jobs. Scheduled posts never published, the domain-event outbox was never
 * drained, push delivery was inert, reporting projections went stale, and the
 * whole retention family never ran — so the retention guarantees ADR-0094 states
 * were enforced by nothing.
 *
 * `modules:jobs:check` already ensured every worker script HAS a descriptor with
 * a `recommendedSchedule`. That closed half the gap: the descriptor existed, and
 * the schedule was PROSE. "Every 1-2 minutes via cron/systemd timer." is
 * readable and unexecutable, so the schedule lived in a document and the
 * production crontab lived on a host, and nothing compared them. Now the
 * schedule is data (`ModuleJobSchedule`) and the crontab is generated from it.
 *
 * ## Why the risky jobs ship COMMENTED OUT
 *
 * Enabling these on a deployment that has been up for months is not "resuming a
 * schedule". For some of them the first tick is a single unbounded action
 * against a backlog that accumulated the entire time: every overdue post
 * published at once, every queued push delivered to real devices, every expired
 * grant revoked, every row past retention deleted in one pass. Each is the
 * CORRECT behaviour. Each deserves to be seen once before it happens.
 *
 * So a job declaring `backlog: "review-before-first-run"` is rendered as a
 * commented line carrying its own reason. Installing this file cannot fire a
 * mass delete; enabling one is a deliberate edit after a `--dry-run`. That makes
 * the review a physical act rather than a paragraph someone might read.
 *
 * Usage:
 *   bun run jobs:crontab:generate
 *   bun run jobs:crontab:check
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { listModules } from "../src/modules";
import type { ModuleJobSchedule } from "../src/modules/_shared/module-contract";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUTPUT = "ops/awcms-jobs.crontab";
const CHECK_ONLY = process.argv.includes("--check");

export type ScheduledJob = {
  moduleKey: string;
  target: string;
  purpose: string;
  schedule: ModuleJobSchedule;
};

/** Five fields, each a cron atom. Deliberately strict — a typo here is silence. */
const CRON_FIELD = /^(\*|\d+|\d+-\d+)(\/\d+)?(,(\*|\d+|\d+-\d+)(\/\d+)?)*$/;

export function isValidCronExpression(expression: string): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  return fields.every((field) => CRON_FIELD.test(field));
}

/** Every declared job, with its schedule, ordered for a stable artefact. */
export function collectScheduledJobs(modules: ReturnType<typeof listModules>): {
  jobs: ScheduledJob[];
  undeclared: string[];
} {
  const jobs: ScheduledJob[] = [];
  const undeclared: string[] = [];

  for (const module of modules) {
    for (const job of module.jobs ?? []) {
      const target = job.command.replace(/^bun run /, "");
      if (!job.schedule) {
        undeclared.push(`${module.key}: ${target}`);
        continue;
      }
      jobs.push({
        moduleKey: module.key,
        target,
        purpose: job.purpose,
        schedule: job.schedule
      });
    }
  }

  jobs.sort((a, b) => a.target.localeCompare(b.target));
  return { jobs, undeclared };
}

/** Problems that make the artefact untrustworthy rather than merely stale. */
export function validateSchedules(jobs: ScheduledJob[]): string[] {
  const problems: string[] = [];

  for (const job of jobs) {
    if (job.schedule.mode === "manual") {
      if (job.schedule.because.trim().length === 0) {
        problems.push(`${job.target}: manual schedule with an empty reason.`);
      }
      continue;
    }

    if (!isValidCronExpression(job.schedule.expression)) {
      problems.push(
        `${job.target}: "${job.schedule.expression}" is not a five-field cron expression.`
      );
    }

    if (
      job.schedule.backlog === "review-before-first-run" &&
      (job.schedule.backlogNote ?? "").trim().length === 0
    ) {
      problems.push(
        `${job.target}: backlog "review-before-first-run" without a backlogNote — say what the first run would actually do.`
      );
    }
  }

  return problems;
}

/** Wrap a note into `# ` comment lines at a readable width. */
function commentWrap(text: string, prefix: string, width = 76): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line.length > 0 && line.length + 1 + word.length > width) {
      lines.push(prefix + line);
      line = word;
    } else {
      line = line.length === 0 ? word : `${line} ${word}`;
    }
  }
  if (line.length > 0) lines.push(prefix + line);
  return lines;
}

export function renderCrontab(jobs: ScheduledJob[]): string {
  const cron = jobs.filter(
    (j): j is ScheduledJob & { schedule: { mode: "cron" } } =>
      j.schedule.mode === "cron"
  );
  const active = cron.filter((j) => j.schedule.backlog === "bounded");
  const review = cron.filter(
    (j) => j.schedule.backlog === "review-before-first-run"
  );
  const manual = jobs.filter((j) => j.schedule.mode === "manual");

  const out: string[] = [
    "# AWCMS scheduled jobs — GENERATED by `bun run jobs:crontab:generate`.",
    "# Do not edit this file; edit the `schedule` on the job's descriptor in its",
    "# module.ts and regenerate. `jobs:crontab:check` fails when the two drift.",
    "#",
    "# Install:  crontab ops/awcms-jobs.crontab   (after setting the two paths below)",
    "#",
    "# The runtime image ships only `dist/`, so `bun run <target>` cannot execute",
    "# there. `run-job.sh` runs each job in the `awcms-jobs` image instead, reading",
    "# env from the running app container so a config change takes effect on the",
    "# next tick.",
    "",
    "AWCMS_RUN_JOB=/home/admin1/awcms-jobs/run-job.sh",
    "AWCMS_JOB_LOG=/home/admin1/awcms-jobs/logs",
    "AWCMS_LOCK=/home/admin1/awcms-jobs/locks",
    "",
    "# Every line is wrapped in `flock -n`, matching the convention already used by",
    "# the other services on this host. The job runner takes an advisory lock in",
    "# Postgres, so overlapping runs cannot corrupt anything — but a job on a */2",
    "# schedule that occasionally takes longer than two minutes would still stack up",
    "# `docker run` processes, each pulling env and starting a container, until the",
    "# host feels it. `-n` means a tick that finds the lock held simply does not run,",
    "# which is the correct behaviour for every job here: they are all resumable and",
    "# the next tick is at most a few minutes away.",
    "",
    "# ===========================================================================",
    "# ACTIVE — the first run costs no more than any later run.",
    "# ==========================================================================="
  ];

  for (const job of active) {
    out.push("");
    out.push(...commentWrap(`${job.moduleKey} — ${job.purpose}`, "# "));
    out.push(
      `${job.schedule.expression} /usr/bin/flock -n $AWCMS_LOCK/${logName(job.target)}.lock $AWCMS_RUN_JOB ${job.target} >> $AWCMS_JOB_LOG/${logName(job.target)}.log 2>&1`
    );
  }

  out.push(
    "",
    "# ===========================================================================",
    "# DISABLED PENDING A FIRST-RUN REVIEW.",
    "#",
    "# Each of these is correct and each has a backlog behind it, because it has",
    "# never run on this deployment. Uncomment ONE at a time, after running it with",
    "# --dry-run and reading the counts. The reason is on every entry.",
    "# ==========================================================================="
  );

  for (const job of review) {
    out.push("");
    out.push(...commentWrap(`${job.moduleKey} — ${job.purpose}`, "# "));
    out.push(...commentWrap(`FIRST RUN: ${job.schedule.backlogNote}`, "#   "));
    out.push(
      `# ${job.schedule.expression} /usr/bin/flock -n $AWCMS_LOCK/${logName(job.target)}.lock $AWCMS_RUN_JOB ${job.target} >> $AWCMS_JOB_LOG/${logName(job.target)}.log 2>&1`
    );
  }

  out.push(
    "",
    "# ===========================================================================",
    "# NOT SCHEDULED — structurally operator-run. Listed so that the absence is a",
    "# recorded decision rather than an omission.",
    "# ==========================================================================="
  );

  for (const job of manual) {
    out.push("");
    out.push(`# ${job.target}`);
    out.push(
      ...commentWrap(
        job.schedule.mode === "manual" ? job.schedule.because : "",
        "#   "
      )
    );
  }

  out.push("");
  return out.join("\n");
}

/** `email:dispatch` -> `email-dispatch` */
function logName(target: string): string {
  return target.replace(/:/g, "-");
}

if (import.meta.main) {
  const { jobs, undeclared } = collectScheduledJobs(listModules());

  if (undeclared.length > 0) {
    console.error(
      `jobs:crontab FAILED — ${undeclared.length} job(s) declare no \`schedule\`:`
    );
    for (const entry of undeclared) console.error(`  - ${entry}`);
    console.error(
      "\n  A job with no schedule is a job that never runs, and nothing else\n" +
        "  reports that — it produces silence, not an error. Add a `schedule` to\n" +
        '  its descriptor: `{ mode: "cron", expression, backlog }`, or\n' +
        '  `{ mode: "manual", because }` with a STRUCTURAL reason.'
    );
    process.exit(1);
  }

  const problems = validateSchedules(jobs);
  if (problems.length > 0) {
    console.error(
      `jobs:crontab FAILED — ${problems.length} invalid schedule(s):`
    );
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  const rendered = renderCrontab(jobs);
  const outputPath = path.join(ROOT, OUTPUT);

  if (CHECK_ONLY) {
    let current: string | null = null;
    try {
      current = readFileSync(outputPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    if (current !== rendered) {
      console.error(
        `jobs:crontab:check FAILED — ${OUTPUT} is ${current === null ? "missing" : "stale"}.\n` +
          "  Run `bun run jobs:crontab:generate` and commit the result."
      );
      process.exit(1);
    }

    const cron = jobs.filter((j) => j.schedule.mode === "cron");
    const active = cron.filter(
      (j) => j.schedule.mode === "cron" && j.schedule.backlog === "bounded"
    );
    console.log(
      `jobs:crontab:check OK — ${jobs.length} job(s): ${active.length} active, ${cron.length - active.length} awaiting a first-run review, ${jobs.length - cron.length} operator-run.`
    );
  } else {
    writeFileSync(outputPath, rendered);
    console.log(`jobs:crontab — wrote ${OUTPUT} (${jobs.length} job(s)).`);
  }
}
