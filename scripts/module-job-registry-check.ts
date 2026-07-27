/**
 * Two registries describe the same worker scripts, and nothing compared them.
 *
 * - `JOB_WORK_CLASS_REGISTRY` (`src/lib/database/work-class-registry.ts`) says
 *   which pool budget a script spends. `db:work-class:check` already holds it
 *   to ground truth: a script that opens `getWorkerDatabaseClient(` /
 *   `getSetupDatabaseClient(` and is missing from the map makes the generator
 *   REFUSE to run.
 * - `ModuleDescriptor.jobs` says what a job is FOR and how often an operator
 *   should run it (`recommendedSchedule`), and is served to operators over
 *   `GET /api/v1/modules/{moduleKey}/jobs`.
 *
 * The first is enforced against the filesystem; the second was enforced
 * against nothing. So a worker script could be fully wired into the capacity
 * model and still be invisible to the one surface an operator actually reads
 * to find out that it needs scheduling — and two were:
 * `tenant-domain:dns:sync` (its module simply declared no `jobs`) and
 * `edge-cache:purge` (see the exception below).
 *
 * A job nobody schedules never runs, and nothing says so: no gate, no health
 * check, no alarm — the backlog just grows. That is the failure this closes.
 *
 * Pure — reads the registries and `package.json`, no database, no network. It
 * runs in `quality` on every PR.
 */
import { JOB_WORK_CLASS_REGISTRY } from "../src/lib/database/work-class-registry";
import { listModules } from "../src/modules";

/**
 * A worker script with no module able to own its descriptor. Each entry has to
 * name a STRUCTURAL reason — "nobody got round to it" belongs in the registry,
 * not here.
 */
export const DOCUMENTED_EXCEPTIONS: readonly {
  target: string;
  reason: string;
}[] = [
  {
    target: "edge-cache:purge",
    reason:
      "There is no `edge_cache` MODULE to hang a descriptor on: edge cache is technical infrastructure and lives in `src/lib/edge-cache/` under ADR-0043, which forbids a `src/lib` namespace from carrying a module's name. `ModuleDescriptor.jobs` is keyed by module, so an infrastructure-owned job has nowhere to go. Its schedule is stated in the script header instead (every 10-30s) and in `docs/awcms/deployment-profiles.md`. Giving edge cache a module purely to hold one job descriptor would invert ADR-0042/ADR-0043 for a documentation convenience."
  }
];

export type JobRegistryViolation = {
  target: string;
  script: string;
  kind: "missing_descriptor" | "missing_schedule";
};

export type PackageScripts = Record<string, string>;

/** Resolves `scripts/x.ts` back to the `bun run <target>` a descriptor names. */
export function targetForScript(
  script: string,
  packageScripts: PackageScripts
): string | null {
  const entry = Object.entries(packageScripts).find(([, command]) =>
    command.includes(script)
  );

  return entry ? entry[0] : null;
}

export function findJobRegistryViolations(
  workClassScripts: readonly string[],
  declaredJobs: readonly { command: string; recommendedSchedule?: string }[],
  packageScripts: PackageScripts
): JobRegistryViolation[] {
  const excused = new Set(DOCUMENTED_EXCEPTIONS.map((e) => e.target));
  const byTarget = new Map(
    declaredJobs.map((job) => [job.command.replace(/^bun run /, ""), job])
  );
  const violations: JobRegistryViolation[] = [];

  for (const script of workClassScripts) {
    const target = targetForScript(script, packageScripts);
    if (!target || excused.has(target)) continue;

    const descriptor = byTarget.get(target);

    if (!descriptor) {
      violations.push({ target, script, kind: "missing_descriptor" });
      continue;
    }

    // A descriptor without a schedule answers "what is this?" but not the only
    // question an operator has to answer to make the job actually run.
    if (!descriptor.recommendedSchedule?.trim()) {
      violations.push({ target, script, kind: "missing_schedule" });
    }
  }

  return violations.sort((a, b) => a.target.localeCompare(b.target));
}

const REASON: Record<JobRegistryViolation["kind"], string> = {
  missing_descriptor:
    "terdaftar di JOB_WORK_CLASS_REGISTRY tapi tak punya ModuleJobDescriptor — " +
    "tak terlihat di GET /api/v1/modules/{key}/jobs, jadi operator tak punya cara " +
    "menemukan bahwa job ini perlu dijadwalkan. Tambahkan ke `jobs` di module.ts " +
    "pemiliknya, atau catat pengecualian ber-alasan STRUKTURAL di gate ini.",
  missing_schedule:
    "punya ModuleJobDescriptor tanpa recommendedSchedule — deskriptor menjawab " +
    '"ini apa" tapi bukan "seberapa sering", satu-satunya hal yang membuat job ' +
    "benar-benar jalan."
};

async function main(): Promise<void> {
  const packageScripts = (
    (await Bun.file("package.json").json()) as { scripts: PackageScripts }
  ).scripts;
  const declaredJobs = listModules().flatMap((module) => module.jobs ?? []);
  const violations = findJobRegistryViolations(
    Object.keys(JOB_WORK_CLASS_REGISTRY),
    declaredJobs,
    packageScripts
  );

  if (violations.length === 0) {
    console.log(
      `modules:jobs:check OK — ${Object.keys(JOB_WORK_CLASS_REGISTRY).length} skrip job ` +
        `di work-class registry, ${declaredJobs.length} ModuleJobDescriptor, ` +
        `${DOCUMENTED_EXCEPTIONS.length} pengecualian ber-alasan.`
    );
    return;
  }

  for (const violation of violations) {
    console.error(
      `${violation.target} (${violation.script}) — ${REASON[violation.kind]}`
    );
  }

  process.exitCode = 1;
}

if (import.meta.main) {
  await main();
}
