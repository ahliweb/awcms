#!/usr/bin/env bun
/**
 * `bun run db:work-class:generate` — Issue #263.
 *
 * Snapshots which work class every API route and every worker/setup job is
 * classified as, into `docs/awcms/work-class-registry.generated.json`.
 * `db:work-class:check` regenerates in memory and diffs, so a new or
 * reclassified route/job cannot merge without a reviewable diff to that file.
 *
 * ## Why this exists now
 *
 * The JSON has been in the repo since it was copied from awcms-mini, with NO
 * generator and NO check behind it — the design was specified in
 * `docs/awcms/database-capacity-runbook.md` §CI drift gate and never built. It
 * therefore listed 284 awcms-mini routes, most of them ghosts, while claiming
 * in its own `_disclaimer` to describe "96 real routes" in a repo that has 221.
 *
 * A `.generated` suffix is a claim: derived from code, do not hand-edit. That
 * makes such a file MORE trusted than ordinary prose, which is exactly why one
 * with nothing behind it is worse than no file at all — and it was already
 * cited by the capacity runbook, the document an operator reads when sizing the
 * pool.
 *
 * ## Two halves, two sources of truth
 *
 * **Routes are generated**, because every route already declares its work class
 * inline — through `defineTenantRoute({ workClass })` (Issue #255, where it is
 * a compile error to omit) or through `withTenant(..., { workClass })`, or by
 * relying on the documented `"interactive"` default. Generating from that is
 * strictly more reliable than a second hand-maintained copy.
 *
 * Recognising `defineTenantRoute` is not optional. Without it, every route
 * migrated to the factory would silently VANISH from the snapshot — the exact
 * regression awcms-micro hit when it migrated its first module.
 *
 * **Jobs are declared**, in `src/lib/database/work-class-registry.ts`. Worker
 * scripts never call `withTenant`, so there is nothing to generate from. The
 * generator instead discovers them by ground truth (`getWorkerDatabaseClient(`
 * / `getSetupDatabaseClient(` in `scripts/*.ts`) and REFUSES TO RUN when the
 * declared map and reality disagree — refusing to generate, not just to check,
 * is the behaviour that file's own header specifies.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";

import { JOB_WORK_CLASS_REGISTRY } from "../src/lib/database/work-class-registry";
import type { WorkClass } from "../src/lib/database/work-class";
import { stripComments } from "./lib/source-text";

const ROUTES_ROOT = "src/pages/api";
const SCRIPTS_ROOT = "scripts";
export const REGISTRY_PATH = "docs/awcms/work-class-registry.generated.json";

/**
 * `withTenant(`, `withTenant<T>(` (the generic form is what the factory itself
 * writes), and `withTenantOrThrow(`. Both names open the same tenant
 * transaction through the same pool gate, so both declare a work class and
 * both belong in the registry — a pattern that matched only one of them would
 * make a route or job disappear from the snapshot by renaming its call.
 */
const WITH_TENANT_CALL = /\bwithTenant(?:OrThrow)?\s*(?:<[^()]*>)?\s*\(/;
const DEFINE_TENANT_ROUTE_CALL = /\bdefineTenantRoute\s*(?:<[^()]*>)?\s*\(/;
const WORK_CLASS_LITERAL = /workClass\s*:\s*"([a-z_]+)"/g;

/** Ground truth for "this script opens its own worker/setup connection". */
const WORKER_CONNECTION =
  /\b(getWorkerDatabaseClient|getSetupDatabaseClient)\s*\(/;

export type RouteEntry = {
  path: string;
  workClass: WorkClass | WorkClass[];
  /** `factory` = via defineTenantRoute; `explicit` = a literal on withTenant; `default` = withTenant's own "interactive". */
  source: "factory" | "explicit" | "default";
};

export type JobEntry = {
  path: string;
  workClass: WorkClass;
  source: "registry";
  rationale: string;
};

export type WorkClassRegistrySnapshot = {
  _note: string;
  routes: RouteEntry[];
  jobs: JobEntry[];
};

async function* walk(directory: string): AsyncGenerator<string> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.name.endsWith(".ts")) {
      yield full;
    }
  }
}

/**
 * Comments are blanked so a docblock mentioning a call is not a call.
 *
 * `stripComments` from `./lib/source-text` rather than the line-based filter
 * this used to carry (finding D2). The old one was not the swallowing variety —
 * it had no whole-file block regex — but it was blind in the other direction: a
 * block comment whose middle lines do not begin with `*`, or a trailing
 * `/* … *\/` after code, survived it intact and could be read as a call. The
 * shared scanner tracks string state and handles both, and it is now the only
 * implementation in the repository.
 */
function codeOnly(content: string): string {
  return stripComments(content);
}

/**
 * Pure over already-read contents, so the classification rules are unit
 * testable without a file tree.
 *
 * A file with several handlers can declare several classes; they are reported
 * sorted and de-duplicated rather than collapsed to the first, because "this
 * route file is partly `reporting` and partly `interactive`" is exactly the
 * kind of thing a capacity reviewer needs to see.
 */
export function classifyRoute(
  filePath: string,
  content: string
): RouteEntry | null {
  const code = codeOnly(content);
  const usesFactory = DEFINE_TENANT_ROUTE_CALL.test(code);
  const usesWithTenant = WITH_TENANT_CALL.test(code);

  if (!usesFactory && !usesWithTenant) {
    return null;
  }

  const declared = [
    ...new Set([...code.matchAll(WORK_CLASS_LITERAL)].map((m) => m[1]!))
  ].sort() as WorkClass[];

  if (declared.length === 0) {
    // Only reachable through `withTenant` — the factory makes `workClass` a
    // compile error to omit, so a factory route can never land here.
    return { path: filePath, workClass: "interactive", source: "default" };
  }

  return {
    path: filePath,
    workClass: declared.length === 1 ? declared[0]! : declared,
    source: usesFactory ? "factory" : "explicit"
  };
}

export type JobDiscrepancy = { unregistered: string[]; stale: string[] };

/** Declared map vs ground truth. A non-empty result means the generator must refuse. */
export function compareJobRegistry(
  discoveredPaths: readonly string[],
  registryKeys: readonly string[]
): JobDiscrepancy {
  const discovered = new Set(discoveredPaths);
  const registered = new Set(registryKeys);

  return {
    unregistered: discoveredPaths.filter((p) => !registered.has(p)).sort(),
    stale: registryKeys.filter((k) => !discovered.has(k)).sort()
  };
}

export async function buildSnapshot(): Promise<WorkClassRegistrySnapshot> {
  const routes: RouteEntry[] = [];

  for await (const file of walk(ROUTES_ROOT)) {
    const routePath = file.split(path.sep).join("/");
    const entry = classifyRoute(routePath, await Bun.file(file).text());

    if (entry) {
      routes.push(entry);
    }
  }

  const discovered: string[] = [];

  for (const entry of await readdir(SCRIPTS_ROOT, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) {
      continue;
    }

    const scriptPath = `${SCRIPTS_ROOT}/${entry.name}`;

    if (WORKER_CONNECTION.test(codeOnly(await Bun.file(scriptPath).text()))) {
      discovered.push(scriptPath);
    }
  }

  const { unregistered, stale } = compareJobRegistry(
    discovered,
    Object.keys(JOB_WORK_CLASS_REGISTRY)
  );

  if (unregistered.length > 0 || stale.length > 0) {
    const detail = [
      ...unregistered.map(
        (p) =>
          `  ${p} — opens a worker/setup connection but has no JOB_WORK_CLASS_REGISTRY entry.`
      ),
      ...stale.map(
        (p) =>
          `  ${p} — has a JOB_WORK_CLASS_REGISTRY entry but no longer opens a worker/setup connection.`
      )
    ].join("\n");

    throw new Error(
      "db:work-class:generate REFUSES to run — the job registry disagrees with " +
        `the scripts on disk. Fix src/lib/database/work-class-registry.ts first:\n${detail}\n` +
        "Refusing to GENERATE (not merely to check) is deliberate: a snapshot " +
        "written from a half-true map would look authoritative."
    );
  }

  const jobs: JobEntry[] = discovered.sort().map((scriptPath) => {
    const entry = JOB_WORK_CLASS_REGISTRY[scriptPath]!;

    return {
      path: scriptPath,
      workClass: entry.workClass,
      source: "registry",
      rationale: entry.rationale
    };
  });

  return {
    _note:
      "GENERATED by `bun run db:work-class:generate` — do not hand-edit. " +
      "Routes are derived from src/pages/api (defineTenantRoute's required " +
      "workClass, an explicit literal on withTenant, or withTenant's " +
      '"interactive" default); jobs come from ' +
      "src/lib/database/work-class-registry.ts, cross-checked against the " +
      "scripts that actually open a worker/setup connection. " +
      "`bun run db:work-class:check` fails when this file drifts from either.",
    routes: routes.sort((a, b) => a.path.localeCompare(b.path)),
    jobs
  };
}

/** Deterministic: sorted, timestamp-free, trailing newline — safe to diff. */
export function serialize(snapshot: WorkClassRegistrySnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

async function main(): Promise<void> {
  const snapshot = await buildSnapshot();

  if (snapshot.routes.length === 0) {
    console.error(
      `db:work-class:generate GAGAL — 0 rute ditemukan di ${ROUTES_ROOT}. ` +
        "Jalankan dari root repository."
    );
    process.exit(1);
  }

  await Bun.write(REGISTRY_PATH, serialize(snapshot));

  const defaults = snapshot.routes.filter((r) => r.source === "default").length;

  console.log(
    `Diperbarui: ${REGISTRY_PATH} — ${snapshot.routes.length} rute ` +
      `(${defaults} masih memakai default "interactive"), ${snapshot.jobs.length} job.`
  );
}

if (import.meta.main) {
  await main();
}
