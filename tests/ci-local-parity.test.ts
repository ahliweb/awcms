/**
 * `bun run ci:local` ↔ the GitHub Actions workflows (Issue #1001).
 *
 * `scripts/ci-local.ts` is a hand-written mirror of `ci.yml` and
 * `changesets.yml`, and a hand-written mirror drifts: PR #770 added a gate to
 * `check` that CI never ran, and `tests/db-gated-suite-ci-parity.test.ts` exists
 * because a file list in a workflow went stale for five files. This is the same
 * guard, pointed the other way — it keeps the LOCAL runner honest about the
 * workflows — and it holds the mirror in both directions:
 *
 * - **A new workflow job** with no local counterpart fails here, so the runner
 *   cannot silently stop covering what CI covers.
 * - **A new step inside an existing job** fails here unless it is mirrored or
 *   explicitly omitted with a reason.
 * - **A changed `run:` text** fails here: the shell steps carry the workflow text
 *   verbatim, so editing one side only is caught.
 * - **A step the runner mirrors that the workflow dropped**, or an omission that
 *   names a step that no longer exists, fails too — stale mirror entries are how
 *   a gate keeps "passing" something CI stopped doing.
 * - The constants that stand for workflow facts (the Bun versions, the
 *   PostgreSQL major, the e2e environment and seed body, the base ref) are
 *   compared with the workflow values.
 *
 * Steps are matched by what they EXECUTE (`run:` text), not by their label, so
 * renaming a step does not fail the test but changing it does. Steps without a
 * `run:` (checkout, setup-bun, cache, upload) are matched by name / action.
 *
 * A guard that has never failed proves nothing (docs/awcms/alur-pengembangan.md
 * §11), so the last block feeds `accountForJob` a mutated copy of the real
 * workflow and demands that it complain.
 *
 * Pure file reads plus a YAML parse: no database, no network.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";
import { parse } from "yaml";

import {
  CI_BUN_CURRENT,
  CI_BUN_MINIMUM,
  CI_POSTGRES_MAJOR,
  DEFAULT_BASE_REF,
  E2E_PROBE_PATH,
  E2E_READY_ATTEMPTS,
  E2E_SERVER_COMMAND,
  E2E_SETUP_PATH,
  E2E_STATIC_ENV,
  E2E_TEST_COMMAND,
  JOBS,
  JOB_ORDER,
  WORKFLOW_CHANGESETS,
  WORKFLOW_CI,
  buildSetupBody,
  jobById,
  workflowStepKey,
  type JobDef,
  type JobRun,
  type NativeStep,
  type ShellStep
} from "../scripts/ci-local";

const ROOT = path.resolve(import.meta.dir, "..");

type WorkflowStep = {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
};

type WorkflowJob = {
  name?: string;
  steps: WorkflowStep[];
  services?: Record<string, { image?: string }>;
};

type Workflow = { jobs: Record<string, WorkflowJob> };

const WORKFLOW_FILES = [WORKFLOW_CI, WORKFLOW_CHANGESETS] as const;

function loadWorkflow(file: string): Workflow {
  return parse(readFileSync(path.join(ROOT, file), "utf8")) as Workflow;
}

function workflowJobsOf(workflow: Workflow): Array<[string, WorkflowJob]> {
  return Object.entries(workflow.jobs);
}

/** Whitespace-insensitive at line ends and the edges; everything else must match. */
function normalizeRun(text: string): string {
  return text
    .trim()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
}

const isShell = (step: JobDef["steps"][number]): step is ShellStep =>
  step.kind === "shell";
const isNative = (step: JobDef["steps"][number]): step is NativeStep =>
  step.kind === "native";

/** What the runner's `env` for a step resolves to under the default options. */
function resolveStepEnv(step: ShellStep, job: JobDef): Record<string, string> {
  const fake = {
    job,
    options: { base: DEFAULT_BASE_REF }
  } as unknown as JobRun;

  return Object.fromEntries(
    Object.entries(step.env ?? {}).map(([key, value]) => [
      key,
      typeof value === "function" ? value(fake) : value
    ])
  );
}

function stringifyEnv(
  env: Record<string, unknown> | undefined
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env ?? {}).map(([key, value]) => [key, String(value)])
  );
}

/**
 * Every workflow step must be accounted for by the runner and the reverse.
 * Returns the problems found (empty means in step).
 */
function accountForJob(steps: WorkflowStep[], job: JobDef): string[] {
  const problems: string[] = [];
  const where = `${job.workflow} > ${job.workflowJob}`;

  const shellByRun = new Map<string, ShellStep>();
  for (const step of job.steps.filter(isShell)) {
    shellByRun.set(normalizeRun(step.run), step);
  }
  const nativeByName = new Map<string, NativeStep>();
  for (const step of job.steps.filter(isNative))
    nativeByName.set(step.step, step);

  const matchedShell = new Set<string>();
  const matchedNative = new Set<string>();
  const usedOmissions = new Set<string>();

  for (const step of steps) {
    const key = workflowStepKey(step);

    if (step.run !== undefined) {
      const normalized = normalizeRun(step.run);

      if (shellByRun.has(normalized)) {
        matchedShell.add(normalized);
        continue;
      }
    }

    if (nativeByName.has(key)) {
      matchedNative.add(key);
      continue;
    }

    if (key in job.omitted) {
      usedOmissions.add(key);
      continue;
    }

    problems.push(
      step.run !== undefined
        ? `${where}: step "${key}" runs text that ci:local does not mirror verbatim (new step, or its run: changed). Update the matching shell step in scripts/ci-local.ts, or add a native step named "${key}", or list it in \`omitted\` with a reason.`
        : `${where}: step "${key}" (${step.uses ?? "no uses"}) is neither mirrored nor listed in \`omitted\` in scripts/ci-local.ts.`
    );
  }

  for (const [normalized, step] of shellByRun) {
    if (!matchedShell.has(normalized)) {
      problems.push(
        `${where}: ci:local shell step "${step.step}" has no workflow step with that run: text (the workflow dropped or changed it).`
      );
    }
  }
  for (const name of nativeByName.keys()) {
    if (!matchedNative.has(name)) {
      problems.push(
        `${where}: ci:local native step "${name}" matches no workflow step (renamed or removed).`
      );
    }
  }
  for (const key of Object.keys(job.omitted)) {
    if (!usedOmissions.has(key)) {
      problems.push(
        `${where}: \`omitted\` names "${key}", which is not a step of this job (stale omission).`
      );
    }
  }

  return problems;
}

const workflows = new Map<string, Workflow>(
  WORKFLOW_FILES.map((file) => [file, loadWorkflow(file)])
);

function allWorkflowJobIds(): string[] {
  return WORKFLOW_FILES.flatMap((file) =>
    workflowJobsOf(workflows.get(file)!).map(([id]) => `${file}#${id}`)
  );
}

/** Job ids the workflows have that the runner lacks, and the reverse. */
function jobMappingProblems(
  inWorkflows: string[],
  inRunner: string[]
): { missing: string[]; stale: string[] } {
  return {
    missing: inWorkflows.filter((id) => !inRunner.includes(id)).sort(),
    stale: inRunner.filter((id) => !inWorkflows.includes(id)).sort()
  };
}

function workflowJob(file: string, id: string): WorkflowJob {
  const job = workflows.get(file)?.jobs[id];
  if (!job) throw new Error(`${file} has no job "${id}"`);
  return job;
}

describe("ci:local ↔ workflow jobs", () => {
  test("the scan finds the workflows it is meant to police", () => {
    // A parse that came back empty would make every assertion below vacuous.
    const ids = allWorkflowJobIds();

    expect(ids.length).toBeGreaterThanOrEqual(6);
    expect(ids).toContain(`${WORKFLOW_CI}#quality`);
    expect(ids).toContain(`${WORKFLOW_CHANGESETS}#policy-check`);
  });

  test("every job in ci.yml and changesets.yml is mapped in the runner, and nothing else is", () => {
    const { missing, stale } = jobMappingProblems(
      allWorkflowJobIds(),
      JOBS.map((job) => `${job.workflow}#${job.workflowJob}`)
    );

    expect(
      missing,
      `workflow job(s) with no ci:local counterpart — add them to JOBS in scripts/ci-local.ts: ${missing.join(", ")}`
    ).toEqual([]);
    expect(
      stale,
      `ci:local maps workflow job(s) that no longer exist: ${stale.join(", ")}`
    ).toEqual([]);
  });

  test("each runner job is selectable (in JOB_ORDER) and the order lists no unknown job", () => {
    expect([...JOB_ORDER].sort()).toEqual(JOBS.map((job) => job.id).sort());
  });

  test("a job's title is the workflow job's display name — the required-check name in the ruleset", () => {
    for (const job of JOBS) {
      expect(job.title).toBe(workflowJob(job.workflow, job.workflowJob).name!);
    }
  });

  test.each(JOBS.map((job) => [job.id, job] as const))(
    "%s: every workflow step is mirrored or omitted with a reason, and no entry is stale",
    (_id, job) => {
      expect(
        accountForJob(workflowJob(job.workflow, job.workflowJob).steps, job)
      ).toEqual([]);
    }
  );

  test("every omission and every native step explains itself", () => {
    for (const job of JOBS) {
      for (const [key, reason] of Object.entries(job.omitted)) {
        expect(reason.length, `${job.id}: omission "${key}"`).toBeGreaterThan(
          20
        );
      }
      for (const step of job.steps.filter(isNative)) {
        expect(
          step.adapted.length,
          `${job.id}: native step "${step.step}"`
        ).toBeGreaterThan(40);
      }
    }
  });

  test("a shell step's env is the workflow step's env (the base ref is the one parameter)", () => {
    for (const job of JOBS) {
      const steps = workflowJob(job.workflow, job.workflowJob).steps;

      for (const step of job.steps.filter(isShell)) {
        const workflowStep = steps.find(
          (candidate) =>
            candidate.run !== undefined &&
            normalizeRun(candidate.run) === normalizeRun(step.run)
        );

        // A text mismatch is reported precisely by the per-job accounting test;
        // here it only means there is no env to compare.
        if (!workflowStep) continue;

        expect(resolveStepEnv(step, job), `${job.id}: ${step.step}`).toEqual(
          stringifyEnv(workflowStep.env)
        );
      }
    }
  });
});

describe("ci:local ↔ workflow facts it hard-codes", () => {
  const bunVersionsOf = (file: string, id: string) =>
    workflowJob(file, id)
      .steps.filter((step) => step.uses?.startsWith("oven-sh/setup-bun@"))
      .map((step) => String(step.with?.["bun-version"]));

  test("the Bun versions the runner reports are the ones CI pins", () => {
    expect(CI_BUN_CURRENT).toBe("1.4.4");
    for (const id of ["quality", "e2e-smoke", "integration-tests"]) {
      expect(bunVersionsOf(WORKFLOW_CI, id), id).toEqual([CI_BUN_CURRENT]);
    }
    expect(bunVersionsOf(WORKFLOW_CHANGESETS, "policy-check")).toEqual([
      CI_BUN_CURRENT
    ]);
    expect(bunVersionsOf(WORKFLOW_CI, "minimum-supported")).toEqual([
      CI_BUN_MINIMUM
    ]);
  });

  test("the minimum-supported floor is the declared engines.bun floor", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(ROOT, "package.json"), "utf8")
    ) as {
      engines?: { bun?: string };
    };

    expect(pkg.engines?.bun).toBe(`>=${CI_BUN_MINIMUM}`);
  });

  test("the PostgreSQL major is the one the database jobs' service container runs", () => {
    for (const id of ["e2e-smoke", "integration-tests"]) {
      expect(
        workflowJob(WORKFLOW_CI, id).services?.postgres?.image,
        id
      ).toMatch(new RegExp(`^postgres:${CI_POSTGRES_MAJOR}\\.`));
    }
  });

  test("the default base ref is the ref the changesets workflow diffs against", () => {
    const step = workflowJob(WORKFLOW_CHANGESETS, "policy-check").steps.find(
      (candidate) => candidate.run === "bun run changesets:policy:check"
    );

    expect(step?.env?.CHANGESET_POLICY_BASE_REF).toBe(DEFAULT_BASE_REF);
  });

  test("the quality job's checkout still fetches tags, which is what the runner's tag step stands for", () => {
    const checkout = workflowJob(WORKFLOW_CI, "quality").steps.find((step) =>
      step.uses?.startsWith("actions/checkout@")
    );

    expect(checkout?.with?.["fetch-tags"]).toBe(true);
    expect(
      jobById("quality").steps.some((step) => step.step === "actions/checkout")
    ).toBe(true);
  });

  test("the changesets job's checkout still takes full history, which the runner's merge-base preflight stands for", () => {
    const checkout = workflowJob(
      WORKFLOW_CHANGESETS,
      "policy-check"
    ).steps.find((step) => step.uses?.startsWith("actions/checkout@"));

    expect(checkout?.with?.["fetch-depth"]).toBe(0);
  });

  test("the quality job disables the DB-gated suites, as the runner's step does", () => {
    const step = workflowJob(WORKFLOW_CI, "quality").steps.find(
      (candidate) => candidate.run === "bun run check"
    );

    expect(step?.env?.DATABASE_URL).toBe("");
  });
});

describe("ci:local ↔ the e2e-smoke start/seed script it reimplements", () => {
  const step = workflowJob(WORKFLOW_CI, "e2e-smoke").steps.find((candidate) =>
    candidate.name?.startsWith("Start server")
  )!;
  const script = step.run!;

  test("the step was found (the assertions below would be vacuous otherwise)", () => {
    expect(script.length).toBeGreaterThan(200);
  });

  test("the environment the runner sets is the workflow's, apart from the port it chooses", () => {
    const { PORT, E2E_BASE_URL, ...rest } = stringifyEnv(step.env);

    expect(PORT).toBeDefined();
    expect(E2E_BASE_URL).toBeDefined();
    expect(rest).toEqual({ ...E2E_STATIC_ENV });
  });

  test("it starts the same server, waits on the same probe, seeds the same endpoint and runs the same tests", () => {
    expect(script).toContain(`${E2E_SERVER_COMMAND.join(" ")} &`);
    expect(script).toContain(`http://127.0.0.1:4321${E2E_PROBE_PATH}`);
    expect(script).toContain('if [ "$code" = "404" ]');
    expect(script).toContain(`$(seq 1 ${E2E_READY_ATTEMPTS})`);
    expect(script).toContain(`http://127.0.0.1:4321${E2E_SETUP_PATH}`);
    expect(script.trimEnd().split("\n").pop()!.trim()).toBe(
      E2E_TEST_COMMAND.join(" ")
    );
    expect(script).toContain('export E2E_TENANT_ID="$tenant_id"');
  });

  test("the seed body is the JSON the workflow posts", () => {
    const posted = script.match(/-d "(\{.*\})"/)?.[1];
    expect(posted, "the curl -d body was not found").toBeDefined();

    const body = JSON.parse(
      posted!
        .replace(/\\"/g, '"')
        .replace(
          /\$\{(\w+)\}/g,
          (_match, name: string) => E2E_STATIC_ENV[name] ?? `\${${name}}`
        )
    );

    expect(body).toEqual(buildSetupBody(E2E_STATIC_ENV));
  });
});

describe("ci:local ↔ package.json", () => {
  const pkg = JSON.parse(
    readFileSync(path.join(ROOT, "package.json"), "utf8")
  ) as {
    scripts: Record<string, string>;
  };

  test("`ci:local` is a Bun script running scripts/ci-local.ts", () => {
    expect(pkg.scripts["ci:local"]).toBe("bun scripts/ci-local.ts");
  });

  test("`check` does not run `ci:local` — the runner runs `check`, so that would recurse", () => {
    expect(pkg.scripts.check).not.toContain("ci:local");
  });

  test("the runner mirrors the same `check` the quality job runs", () => {
    const quality = jobById("quality").steps.filter(isShell);

    expect(quality.some((step) => step.run === "bun run check")).toBe(true);
    expect(pkg.scripts.check).toBeDefined();
  });
});

describe("the parity guard itself bites", () => {
  // "A gate must be proven to FAIL" (alur-pengembangan.md §11): feed the real
  // accounting a mutated copy of the real workflow and demand a complaint.
  const job = jobById("integration");
  const real = workflowJob(job.workflow, job.workflowJob).steps;

  test("the real workflow is in step (the baseline for every mutation below)", () => {
    expect(accountForJob(real, job)).toEqual([]);
  });

  test("a NEW step in an existing job is reported", () => {
    const mutated = structuredClone(real);
    mutated.push({ name: "Brand new gate", run: "bun run some:new:check" });

    const problems = accountForJob(mutated, job);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain("Brand new gate");
  });

  test("a CHANGED run: text is reported on both sides", () => {
    const mutated = structuredClone(real);
    const target = mutated.find((step) => step.run === "bun run db:migrate")!;
    target.run = "bun run db:migrate --verbose";

    const problems = accountForJob(mutated, job);
    expect(problems.some((p) => p.includes("does not mirror verbatim"))).toBe(
      true
    );
    expect(
      problems.some((p) => p.includes("workflow dropped or changed it"))
    ).toBe(true);
  });

  test("a step REMOVED from the workflow leaves a stale runner step, which is reported", () => {
    const mutated = structuredClone(real).filter(
      (step) => step.run !== "bun test tests/integration/ --timeout 60000"
    );

    const problems = accountForJob(mutated, job);
    expect(problems.some((p) => p.includes("dropped or changed it"))).toBe(
      true
    );
  });

  test("a stale omission and a stale native step are reported", () => {
    const mutated = structuredClone(real).filter(
      (step) =>
        step.name !== "Cache Bun install cache" &&
        step.name !== "Assemble DATABASE_URL for this job's Postgres"
    );

    const problems = accountForJob(mutated, job);
    expect(problems.some((p) => p.includes("stale omission"))).toBe(true);
    expect(problems.some((p) => p.includes("matches no workflow step"))).toBe(
      true
    );
  });

  test("a NEW workflow job, or a job removed from the workflows, is reported by the job-level check", () => {
    const mapped = JOBS.map(
      (candidate) => `${candidate.workflow}#${candidate.workflowJob}`
    );
    const real = allWorkflowJobIds();

    expect(jobMappingProblems(real, mapped)).toEqual({
      missing: [],
      stale: []
    });
    expect(
      jobMappingProblems([...real, `${WORKFLOW_CI}#brand-new-job`], mapped)
        .missing
    ).toEqual([`${WORKFLOW_CI}#brand-new-job`]);
    expect(
      jobMappingProblems(
        real.filter((id) => !id.endsWith("#hygiene")),
        mapped
      ).stale
    ).toEqual([`${WORKFLOW_CI}#hygiene`]);
  });
});
