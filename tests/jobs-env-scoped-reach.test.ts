/**
 * `JOB_SCOPED` (scripts/jobs-env-allowlist.ts) hands a secret to named jobs only.
 * This test holds that hand-written map to the code, in BOTH directions
 * (Issue #1120):
 *
 * - (a) every job that can reach a file reading a scoped secret is granted it.
 *   This is the direction that matters most: an ungranted job does not crash, it
 *   sees the secret as unset, takes the inert default and reports success.
 * - (b) every granted job really reaches a reader. A stale grant is a secret in a
 *   container that has no use for it, and it is how the global list got wide.
 *
 * "Reaches" is the static import closure of the job's entry script
 * (`scripts/lib/job-import-graph.ts`), over EVERY `bun scripts/…` package.json
 * target, because `ops/run-job.sh <target>` will run any of them — the crontab
 * is only the ones that run on a timer. A target that reaches a reader but is
 * deliberately not granted must say why, in `REACHES_WITHOUT_READING` (imports the
 * file, never calls the reader) or `OPERATOR_ONLY_TARGETS` (cannot run in a job
 * container at all). An import the tracer cannot follow must be on
 * `UNTRACEABLE_IMPORT_SITES` or the test fails: a computed import is exactly how a
 * reader would hide from this guard.
 *
 * The exemption lists are themselves held to the code (Issue #1131, L4): an
 * exempt site is the file AND the expression, so a second computed import in a
 * listed file fails; a `REACHES_WITHOUT_READING` reader file may not gain a
 * function that calls a reader; and `ops/run-job.sh` refuses the
 * `OPERATOR_ONLY_TARGETS` by name (`tests/jobs-env-exemption-guards.test.ts`
 * proves each of those checks fires on a synthetic violation).
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";

import { collectEnvReads } from "../scripts/env-contract-coverage-check";
import {
  diffImportSites,
  enclosingDeclaration,
  readerFileProblems,
  referencesOf,
  type ImportSite
} from "../scripts/lib/exemption-guards";
import {
  GLOBAL_SECRETS,
  JOB_SCOPED,
  NAME_REGISTRY_FILES,
  OPERATOR_ONLY_TARGETS,
  READER_FILE_EXCUSES,
  REACHES_WITHOUT_READING,
  UNTRACEABLE_EXECUTION_SITES,
  UNTRACEABLE_IMPORT_SITES,
  WEB_ONLY,
  findUnexplainedGlobalSecrets,
  scopedPairs,
  validateGlobalSecrets
} from "../scripts/jobs-env-allowlist";
import {
  readImports,
  resolveTargetEntry,
  traceImports,
  type ImportTrace
} from "../scripts/lib/job-import-graph";
import { stripComments } from "../scripts/lib/source-text";
import { listModules } from "../src/modules";

const packageScripts: Record<string, string> = JSON.parse(
  readFileSync("package.json", "utf8")
).scripts;

/** Every package.json target that runs a `scripts/` file: what `run-job.sh` can be pointed at. */
const universe = Object.keys(packageScripts)
  .filter((target) => resolveTargetEntry(target, packageScripts) !== null)
  .sort();

const traces = new Map<string, ImportTrace>();
let reads: Map<string, string[]>;

beforeAll(async () => {
  reads = await collectEnvReads();
  for (const target of universe) {
    traces.set(
      target,
      traceImports(resolveTargetEntry(target, packageScripts) as string)
    );
  }
}, 60000);

const sourceCache = new Map<string, string>();
function strippedSource(file: string): string {
  let source = sourceCache.get(file);
  if (source === undefined) {
    source = stripComments(readFileSync(file, "utf8"));
    sourceCache.set(file, source);
  }
  return source;
}

/**
 * A name spelled as a string literal. `collectEnvReads()` only sees
 * `env.NAME` and friends; a helper such as `readConfiguredUrl("DATABASE_URL")`
 * reads the variable without ever writing that shape, so a file that merely
 * MENTIONS the name as a literal counts as a reader too. That errs toward
 * granting, which is the safe side: the failure to avoid is a job silently
 * missing a secret. (`scripts/validate-env.ts` mentions every name, and is
 * reachable only from `config:validate`, which is operator-only.)
 */
function mentionsLiteral(file: string, name: string): boolean {
  return new RegExp(`["'\`]${name}["'\`]`).test(strippedSource(file));
}

/** A reader before any excuse: an `env.NAME`-style read, or the name as a literal. */
function rawIsReader(file: string, name: string): boolean {
  if (NAME_REGISTRY_FILES.includes(file)) return false;
  return (reads.get(name) ?? []).includes(file) || mentionsLiteral(file, name);
}

function isReader(file: string, name: string): boolean {
  if (
    READER_FILE_EXCUSES.some(
      (excuse) => excuse.name === name && excuse.file === file
    )
  ) {
    return false;
  }
  return rawIsReader(file, name);
}

function reaches(target: string, name: string): boolean {
  const trace = traces.get(target);
  if (!trace) throw new Error(`${target} is not a bun scripts/ target`);
  return trace.files.some((file) => isReader(file, name));
}

const granted = (name: string, target: string): boolean =>
  JOB_SCOPED.some(
    (secret) =>
      secret.name === name && secret.jobs.some((job) => job.target === target)
  );
const exempt = (name: string, target: string): boolean =>
  REACHES_WITHOUT_READING.some(
    (entry) => entry.name === name && entry.target === target
  );
const operatorOnly = (target: string): boolean =>
  OPERATOR_ONLY_TARGETS.some((entry) => entry.target === target);

describe("the universe the guard walks", () => {
  test("every job target in the crontab and the module registry is a traceable script", () => {
    const crontab = readFileSync("ops/awcms-jobs.crontab", "utf8");
    const crontabTargets = [
      ...crontab.matchAll(/\$AWCMS_RUN_JOB\s+(\S+)/g)
    ].map((match) => match[1] as string);
    const registryTargets = listModules().flatMap((module) =>
      (module.jobs ?? []).map((job) => job.command.replace(/^bun run /, ""))
    );

    expect(crontabTargets.length).toBeGreaterThan(20);
    expect(registryTargets.length).toBeGreaterThan(20);

    const untraceable = [...new Set([...crontabTargets, ...registryTargets])]
      .filter((target) => !universe.includes(target))
      .sort();
    expect(untraceable).toEqual([]);
  });

  test("the tracer sees real code: push:dispatch reaches the push provider and telegram:dispatch the telegram one", () => {
    // A tracer that returned only the entry file would make (a) vacuously true.
    expect(traces.get("push:dispatch")?.files.length ?? 0).toBeGreaterThan(5);
    expect(
      traces
        .get("push:dispatch")
        ?.files.some((f) => f.includes("push-delivery/"))
    ).toBe(true);
    expect(
      traces
        .get("telegram:dispatch")
        ?.files.some((f) => f.includes("telegram-delivery/"))
    ).toBe(true);
  });

  test("no import the tracer cannot follow is hiding in a job's reach, except the listed sites", () => {
    const sites = new Map<string, Set<string>>();
    const unresolved: string[] = [];
    for (const [target, trace] of traces) {
      for (const site of trace.dynamic) {
        sites.set(site.from, (sites.get(site.from) ?? new Set()).add(target));
      }
      for (const miss of trace.unresolved) {
        unresolved.push(`${target}: ${miss.from} imports ${miss.specifier}`);
      }
    }

    expect(unresolved).toEqual([]);

    // A site is the file AND the exact expression (Issue #1131, L4). Counted per
    // occurrence in the file itself, not per job that reaches it, so a second
    // computed import in a listed file is NOT covered by the first one's entry.
    const reachedFiles = new Set(
      [...traces.values()].flatMap((trace) => trace.files)
    );
    const found: ImportSite[] = [...reachedFiles]
      .filter((file) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(file))
      .flatMap((file) =>
        readImports(readFileSync(file, "utf8")).dynamic.map((expression) => ({
          file,
          expression
        }))
      );
    // The traces and this recount must agree, or the recount is not the proof.
    expect(found.length).toBeGreaterThanOrEqual(sites.size);

    const { unexplained, stale } = diffImportSites(
      found,
      UNTRACEABLE_IMPORT_SITES
    );
    expect(
      unexplained,
      `computed import(...) the tracer cannot follow, so a reader could hide behind it: ${unexplained.map((site) => `${site.file}: import(${site.expression})`).join("; ")}. Replace it with a literal import or list the file AND expression in UNTRACEABLE_IMPORT_SITES with a reason.`
    ).toEqual([]);

    // A listed site that no longer exists is a stale excuse.
    expect(
      stale,
      "UNTRACEABLE_IMPORT_SITES lists a file/expression with no matching computed import"
    ).toEqual([]);

    for (const entry of UNTRACEABLE_IMPORT_SITES) {
      expect(entry.reason.length).toBeGreaterThan(20);
    }
  });
});

describe("(a) a job that can reach a reader is granted the secret", () => {
  for (const secret of JOB_SCOPED) {
    test(secret.name, () => {
      const ungranted = universe.filter(
        (target) =>
          reaches(target, secret.name) &&
          !granted(secret.name, target) &&
          !exempt(secret.name, target) &&
          !operatorOnly(target)
      );

      expect(
        ungranted,
        `${ungranted.join(", ")} can reach a file that reads ${secret.name} but is not granted it. ` +
          "Add the job to JOB_SCOPED if it calls the reader, or to REACHES_WITHOUT_READING / " +
          "OPERATOR_ONLY_TARGETS with a reason if it does not. An ungranted job fails silently."
      ).toEqual([]);
    });
  }
});

describe("(b) a granted job really reaches a reader", () => {
  for (const secret of JOB_SCOPED) {
    test(secret.name, () => {
      const stale = secret.jobs
        .map((job) => job.target)
        .filter(
          (target) =>
            !universe.includes(target) || !reaches(target, secret.name)
        );

      expect(
        stale,
        `${stale.join(", ")} is granted ${secret.name} but is not a script that reaches a file reading it. Remove the stale grant.`
      ).toEqual([]);
    });
  }

  test("no grant goes to a target that is declared operator-only", () => {
    const both = scopedPairs()
      .map((pair) => pair.job)
      .filter(operatorOnly);

    expect(both).toEqual([]);
  });
});

describe("the explicit exceptions are each still true", () => {
  test("every REACHES_WITHOUT_READING pair really reaches the file and really never references the reader", () => {
    for (const entry of REACHES_WITHOUT_READING) {
      expect(entry.reason.length).toBeGreaterThan(20);
      expect(granted(entry.name, entry.target)).toBe(false);
      // A stale exemption: it no longer reaches the file at all.
      expect(
        reaches(entry.target, entry.name),
        `${entry.target} no longer reaches a reader of ${entry.name}; drop the exemption`
      ).toBe(true);

      const trace = traces.get(entry.target) as ImportTrace;

      // The reader file itself is skipped by the loop below, so hold it here:
      // readerCalls must be a closed set inside it (Issue #1131, L4).
      const readerFiles = trace.files.filter((file) =>
        rawIsReader(file, entry.name)
      );
      expect(readerFiles.length).toBeGreaterThan(0);
      // A misspelt entry would make the closed-set check vacuous.
      for (const call of entry.readerCalls) {
        expect(
          readerFiles.some((file) =>
            new RegExp(`\\b${call}\\b`).test(strippedSource(file))
          ),
          `${call} is not mentioned in any reader file of ${entry.name}`
        ).toBe(true);
      }
      for (const file of readerFiles) {
        expect(
          readerFileProblems(
            file,
            strippedSource(file),
            entry.name,
            entry.readerCalls
          ),
          `${file} is excused for ${entry.name} but has a reader the excuse does not name`
        ).toEqual([]);
      }

      for (const file of trace.files) {
        if (isReader(file, entry.name)) continue;
        const source = readFileSync(file, "utf8");
        for (const call of entry.readerCalls) {
          expect(
            new RegExp(`\\b${call}\\b`).test(source),
            `${entry.target} reaches ${file}, which references ${call}: it does read ${entry.name}. Grant it instead.`
          ).toBe(false);
        }
      }
    }
  });

  test("every READER_FILE_EXCUSES file really reads the name and no job reaches the function that does", () => {
    for (const excuse of READER_FILE_EXCUSES) {
      expect(excuse.reason.length).toBeGreaterThan(20);
      // Stale if the file no longer reads the name at all.
      expect(
        rawIsReader(excuse.file, excuse.name),
        `${excuse.file} no longer reads ${excuse.name}; drop the excuse`
      ).toBe(true);

      // A listed caller is a reader call in its own right.
      const calls = [...excuse.readerCalls, ...(excuse.callers ?? [])];

      // Inside the excused file itself: a wrapper that calls a reader would make
      // every job that calls the wrapper a reader, with the excuse still green.
      const fileSource = strippedSource(excuse.file);
      for (const call of calls) {
        for (const reference of referencesOf(fileSource, call)) {
          const inside = enclosingDeclaration(fileSource, reference);
          expect(
            (excuse.callers ?? []).includes(inside),
            `${excuse.file}: ${inside} references ${call}, which reads ${excuse.name}, and is not listed in the excuse's callers. Either it is a reader (scope the secret) or list it and prove no job reaches it.`
          ).toBe(true);
        }
      }

      for (const target of universe) {
        if (operatorOnly(target)) continue;
        const trace = traces.get(target) as ImportTrace;
        if (!trace.files.includes(excuse.file)) continue;
        for (const file of trace.files) {
          if (file === excuse.file) continue;
          const source = strippedSource(file);
          for (const call of calls) {
            expect(
              new RegExp(`\\b${call}\\b`).test(source),
              `${target} reaches ${file}, which references ${call}: it does read ${excuse.name}. Remove the excuse and scope the secret.`
            ).toBe(false);
          }
        }
      }
    }
  });

  test("every OPERATOR_ONLY target is what it says it is", () => {
    const crontab = readFileSync("ops/awcms-jobs.crontab", "utf8");
    const scheduled = new Set(
      [...crontab.matchAll(/\$AWCMS_RUN_JOB\s+(\S+)/g)].map((m) => m[1])
    );

    for (const entry of OPERATOR_ONLY_TARGETS) {
      expect(universe).toContain(entry.target);
      expect(entry.reason.length).toBeGreaterThan(20);
      // Never on a timer, whichever kind it is.
      expect(scheduled.has(entry.target)).toBe(false);

      if (entry.kind === "needs-web-only") {
        const trace = traces.get(entry.target) as ImportTrace;
        expect(
          WEB_ONLY.some((web) =>
            trace.files.some((file) => isReader(file, web.name))
          ),
          `${entry.target} reaches no web-only variable, so it can run in a job container: grant it the secrets it reads instead of excusing it`
        ).toBe(true);
      }
    }
  });

  test("every grant has a reason and the secret list has no duplicates", () => {
    const names = JOB_SCOPED.map((secret) => secret.name);
    expect(new Set(names).size).toBe(names.length);
    for (const secret of JOB_SCOPED) {
      expect(secret.reason.length).toBeGreaterThan(20);
      for (const job of secret.jobs) {
        expect(job.reason.length).toBeGreaterThan(10);
      }
    }
  });
});

describe("(c) WEB_ONLY moves do not break any job", () => {
  // Moving a secret to WEB_ONLY removes it from every job container. That is only
  // safe if no job can reach a reader of it - checked against EVERY package
  // script, with the literal-mention rule, not only the cron ones.
  for (const entry of WEB_ONLY) {
    test(entry.name, () => {
      const reachers = universe.filter(
        (target) => reaches(target, entry.name) && !operatorOnly(target)
      );

      expect(
        reachers,
        `${reachers.join(", ")} can reach a file that reads ${entry.name}, which is WEB_ONLY and so never copied into a job container. ` +
          "Scope it to those jobs in JOB_SCOPED, or list the target in OPERATOR_ONLY_TARGETS if it only ever runs with the full environment."
      ).toEqual([]);
    });
  }
});

describe("the global list hands no unexplained secret to every job", () => {
  const globalNames = readFileSync("ops/awcms-jobs.env-global", "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  test("every secret-looking name left in the global file is on GLOBAL_SECRETS", () => {
    expect(findUnexplainedGlobalSecrets(globalNames)).toEqual([]);
    expect(validateGlobalSecrets(globalNames)).toEqual([]);
  });

  test("the gate fires on a secret-looking name nobody explained", () => {
    expect(
      findUnexplainedGlobalSecrets([
        "SOME_NEW_API_TOKEN",
        "ANOTHER_SIGNING_SECRET",
        "PUSH_NEW_PRIVATE_KEY",
        "WORKER_DATABASE_URL"
      ])
    ).toEqual([
      "SOME_NEW_API_TOKEN",
      "ANOTHER_SIGNING_SECRET",
      "PUSH_NEW_PRIVATE_KEY"
    ]);
  });

  test("the broadened pattern catches connection strings, access keys, peppers, HMACs and auth names, not plain config", () => {
    expect(
      findUnexplainedGlobalSecrets([
        "SOME_SERVICE_URL",
        "ANOTHER_DSN",
        "X_ACCESS_KEY_ID",
        "MY_PEPPER",
        "SYNC_HMAC_KEY",
        "BASIC_AUTH",
        "DB_PASS",
        // Plain configuration: must NOT be flagged, or the gate is noise.
        "AUTH_LOGIN_RATE_LIMIT_MAX",
        "REDIS_KEY_PREFIX",
        "APP_ENV"
      ])
    ).toEqual([
      "SOME_SERVICE_URL",
      "ANOTHER_DSN",
      "X_ACCESS_KEY_ID",
      "MY_PEPPER",
      "SYNC_HMAC_KEY",
      "BASIC_AUTH",
      "DB_PASS"
    ]);
  });

  test("a scoped or web-only secret is not in the global file", () => {
    const hidden = new Set([
      ...JOB_SCOPED.map((s) => s.name),
      ...WEB_ONLY.map((w) => w.name)
    ]);
    expect(globalNames.filter((name) => hidden.has(name))).toEqual([]);
  });

  test("every GLOBAL_SECRETS entry says why, and the secrets are the ones every job really opens", () => {
    for (const entry of GLOBAL_SECRETS) {
      expect(entry.reason.length).toBeGreaterThan(20);
    }
    const secrets = GLOBAL_SECRETS.filter((e) => e.kind === "secret").map(
      (e) => e.name
    );
    // Connection strings and the one shared HMAC; anything new must be argued.
    expect(secrets.sort()).toEqual([
      "DATABASE_URL",
      "IDEMPOTENCY_HMAC_SECRET",
      "WORKER_DATABASE_URL"
    ]);
  });

  test("a scoped VAR never also appears in the global file", () => {
    const scoped = new Set(scopedPairs().map((pair) => pair.name));
    expect(globalNames.filter((name) => scoped.has(name))).toEqual([]);
  });
});

describe("what the tracer cannot see is accounted for", () => {
  test("every bare specifier in a job's reach is a builtin or a declared dependency", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8"));
    const known = new Set<string>([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
      ...builtinModules
    ]);

    const unknown = new Set<string>();
    for (const trace of traces.values()) {
      for (const { from, specifier } of trace.bare) {
        if (/^(node|bun|astro):/.test(specifier) || specifier === "bun") {
          continue;
        }
        if (!known.has(specifier)) unknown.add(`${from} imports ${specifier}`);
      }
    }

    expect([...unknown]).toEqual([]);
  });

  test("require() and process spawning appear only in listed files, none reachable from a job", () => {
    const crontab = readFileSync("ops/awcms-jobs.crontab", "utf8");
    const scheduled = new Set(
      [...crontab.matchAll(/\$AWCMS_RUN_JOB\s+(\S+)/g)].map((m) => m[1])
    );
    const registry = new Set(
      listModules().flatMap((module) =>
        (module.jobs ?? []).map((job) => job.command.replace(/^bun run /, ""))
      )
    );
    const allowed = new Set(UNTRACEABLE_EXECUTION_SITES.map((s) => s.file));
    const seen = new Set<string>();
    const unexplained = new Set<string>();

    for (const [target, trace] of traces) {
      for (const site of trace.escapes) {
        seen.add(site.from);
        if (!allowed.has(site.from)) {
          unexplained.add(
            `${site.from} (${site.specifier}) reached by ${target}`
          );
        }
        // Reached from a timer or a registry job, an excuse is not enough.
        if (
          (scheduled.has(target) || registry.has(target)) &&
          !operatorOnly(target)
        ) {
          unexplained.add(
            `${site.from} (${site.specifier}) is reachable from the job ${target}`
          );
        }
      }
    }

    expect([...unexplained]).toEqual([]);
    expect([...allowed].filter((file) => !seen.has(file))).toEqual([]);
    for (const entry of UNTRACEABLE_EXECUTION_SITES) {
      expect(entry.reason.length).toBeGreaterThan(20);
    }
  });
});
