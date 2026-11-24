/**
 * The sharded DB-gated integration job (Issue #1510).
 *
 * `Integration tests (RLS + DB role separation)` is a REQUIRED status check in
 * the `main` ruleset. It used to be one ~39-minute job; it is now an
 * aggregator over a 5-way matrix (`integration-shards`). The danger of that
 * shape is silent: an aggregator that can pass while a shard failed, was
 * cancelled or was skipped turns a required check into decoration, and a
 * matrix whose `--shard=<i>/N` disagrees with its own length runs a fraction of
 * the suite while looking green. This test pins both, plus the once-only
 * steps (payroll boundary, legacy suite) that must not be repeated per shard
 * and must not be dropped.
 *
 * Pure: a YAML parse of ci.yml, no database.
 */
import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";
import { parse } from "yaml";

const REQUIRED_NAME = "Integration tests (RLS + DB role separation)";
const WORKFLOW_PATH = ".github/workflows/ci.yml";

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
};
type Job = {
  name?: string;
  needs?: string | string[];
  if?: string;
  "runs-on"?: string;
  permissions?: Record<string, string>;
  strategy?: {
    "fail-fast"?: boolean;
    matrix?: { shard?: number[] };
  };
  services?: Record<string, { image?: string }>;
  steps: Step[];
};

function loadJobs(source: string): Record<string, Job> {
  return (parse(source) as { jobs: Record<string, Job> }).jobs;
}

const source = readFileSync(WORKFLOW_PATH, "utf8");
const jobs = loadJobs(source);

const aggregators = Object.entries(jobs).filter(
  ([, job]) => job.name === REQUIRED_NAME
);
const shardJobs = Object.entries(jobs).filter(
  ([, job]) => job.strategy?.matrix?.shard !== undefined
);

function needsOf(job: Job): string[] {
  return Array.isArray(job.needs) ? job.needs : job.needs ? [job.needs] : [];
}

describe("the required check is an aggregator that cannot pass over a bad shard", () => {
  test("exactly one job carries the required check name", () => {
    expect(aggregators.length).toBe(1);
  });

  const [aggregatorId, aggregator] = aggregators[0]!;

  test("it needs EVERY integration job and runs even when they fail", () => {
    expect(shardJobs.length).toBeGreaterThanOrEqual(1);
    expect(needsOf(aggregator).sort()).toEqual(
      shardJobs.map(([id]) => id).sort()
    );
    // `always()` — without it a failed shard SKIPS this job, and a skipped
    // required check is not a failure.
    expect(String(aggregator.if).replace(/\s+/g, "")).toBe("always()");
  });

  test("it runs on a plain runner, read-only, and spins up no database", () => {
    expect(aggregator["runs-on"]).toBe("ubuntu-latest");
    expect(aggregator.permissions).toEqual({ contents: "read" });
    expect(aggregator.services).toBeUndefined();
  });

  test("its script fails unless every needed job's result is `success`", () => {
    const gate = aggregator.steps.find((step) => step.run !== undefined)!;
    const script = gate.run!;

    // Results go through env, never interpolated into the script body.
    expect(script).not.toContain("${{");
    for (const id of needsOf(aggregator)) {
      expect(gate.env?.SHARDS_RESULT ?? "").toContain(`needs.${id}.result`);
    }
    // Only an exact `success` passes: `!= "success"` is the failing branch, so
    // failure, cancelled and skipped all exit non-zero.
    expect(script).toMatch(/\[ "\$SHARDS_RESULT" != "success" \]/);
    expect(script).toMatch(/exit 1/);
    expect(aggregatorId).toBe("integration-tests");
  });

  test("the aggregator is the only job with that name; shard names differ", () => {
    for (const [id, job] of shardJobs) {
      expect(job.name, id).not.toBe(REQUIRED_NAME);
      expect(job.name, id).toMatch(
        /^Integration shard \$\{\{ matrix\.shard \}\}\/\d+$/
      );
    }
  });
});

describe("the shard matrix partitions the suite", () => {
  const [, shardJob] = shardJobs[0]!;
  const shards = shardJob.strategy!.matrix!.shard!;
  const n = shards.length;
  const shardStep = shardJob.steps.find((step) =>
    step.run?.startsWith("bun test tests/integration/")
  )!;

  test("there is exactly one shard job and it does not cancel its siblings", () => {
    expect(shardJobs.length).toBe(1);
    expect(shardJob.strategy!["fail-fast"]).toBe(false);
  });

  test("the shard list is 1..N, in order, without gaps", () => {
    expect(n).toBeGreaterThanOrEqual(2);
    expect(shards).toEqual(Array.from({ length: n }, (_, i) => i + 1));
  });

  test("the command is the whole directory, sharded i/N with N = the matrix length, same timeout", () => {
    expect(shardStep.run).toBe(
      `bun test tests/integration/ --shard=\${{ matrix.shard }}/${n} --timeout 60000`
    );
    // The display name carries the same N.
    expect(shardJob.name).toBe(`Integration shard \${{ matrix.shard }}/${n}`);
  });

  test("each shard has its OWN Postgres service and migrates before testing", () => {
    expect(shardJob.services?.postgres?.image).toMatch(/^postgres:18\./);
    const names = shardJob.steps.map((step) => step.run ?? "");
    const migrate = names.indexOf("bun run db:migrate");
    expect(migrate).toBeGreaterThanOrEqual(0);
    expect(migrate).toBeLessThan(names.indexOf(shardStep.run!));
  });

  test("no in-job parallelism: the files share one Postgres cluster", () => {
    expect(source.replace(/^\s*#.*$/gm, "")).not.toMatch(/--parallel/);
  });
});

describe("once-only steps run exactly once, on shard 1", () => {
  const [, shardJob] = shardJobs[0]!;
  const payroll = "bun run payroll:catalog-boundary:check";

  test("the payroll catalog boundary appears once in the whole workflow, guarded to shard 1", () => {
    const occurrences = Object.values(jobs).flatMap((job) =>
      job.steps.filter((step) => step.run?.trim() === payroll)
    );
    expect(occurrences.length).toBe(1);
    expect(occurrences[0]!.if).toBe("matrix.shard == 1");
  });

  test("the legacy ad-hoc suite appears once in ci.yml, guarded to shard 1", () => {
    const occurrences = Object.values(jobs).flatMap((job) =>
      job.steps.filter((step) =>
        step.run?.includes("tests/workflow-approval-concurrency.test.ts")
      )
    );
    expect(occurrences.length).toBe(1);
    expect(occurrences[0]!.if).toBe("matrix.shard == 1");
    expect(shardJob.steps).toContain(occurrences[0]!);
  });
});
