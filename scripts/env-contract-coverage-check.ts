/**
 * Every environment variable the code reads must appear in `.env.example`.
 *
 * ## What this closes
 *
 * `tests/env-required-vars-doc.test.ts` already compares the documented list of
 * MANDATORY variables against the enforced one. That leaves the larger half
 * unwatched: a variable that is optional but CHANGES BEHAVIOUR. Nothing looked
 * at those, and eleven had accumulated — including
 * `TENANT_DOMAIN_DNS_PROVIDER`, whose only two values are "make no outbound
 * call" and "talk to a real DNS API", and the four `R2_*` credentials that
 * `R2_ENABLED=true` requires but that no template offered.
 *
 * Worse than absent: `.env.example` referred to "the `TENANT_DOMAIN_CLOUDFLARE_*`
 * settings above" when no such settings existed anywhere in the file.
 *
 * `.env.example` is the artefact an operator COPIES, which is why it is the
 * target rather than doc 18: a variable documented only in prose is one an
 * operator has to already know to go looking for. A commented placeholder is
 * enough — that is how the `EMAIL_MAILKETING_*` credentials were already
 * handled, and it keeps secrets out of the repo.
 *
 * ## The blind spot this used to have
 *
 * This matched `process.env.X` only, and the comment here recorded that as an
 * accepted limit: config modules that thread `env: NodeJS.ProcessEnv =
 * process.env` through a parameter and then read `env.X` were invisible.
 * The limit was not academic — it hid roughly 129 of the ~178 variables the
 * code actually reads, so the gate printed OK over 53 while 42 real deployment
 * variables were missing from `.env.example`, `REDIS_*` among them. Wave 4 paid
 * for it in the obvious way: three invitation variables had to be added BY HAND
 * because nothing would have caught their absence.
 *
 * The fix keeps the precision the old comment was protecting. Broadening to any
 * `env.X` would indeed swallow unrelated identifiers, so instead we resolve
 * ALIASES: within a single file, find the names actually bound to `process.env`
 * (`const env = process.env`, `env: NodeJS.ProcessEnv = process.env`), then read
 * `<thatName>.X`. An `env.X` on a variable that is not bound to `process.env`
 * stays invisible, which is the correct answer.
 *
 * ## The second blind spot (Issue #1119)
 *
 * Binding detection required `= process.env` on the same declaration, so a
 * function that RECEIVES the environment — `parseVapidConfig(env:
 * NodeJS.ProcessEnv)`, no default — was invisible: its `env.PUSH_VAPID_*` reads
 * never reached `.env.example` coverage or the generated jobs allow-list
 * (`ops/awcms-jobs.env-global`, formerly `env-allowlist`), so a host running `push:dispatch` through
 * `ops/run-job.sh` started the dispatcher with push enabled and no VAPID
 * material. A name is now ALSO an alias when it is DECLARED with the type
 * `NodeJS.ProcessEnv` / `ProcessEnv` / `Readonly<ProcessEnv>` / `typeof
 * process.env` (parameter, method parameter, arrow parameter, field, or local),
 * with or without a default. That is still "provably the environment": the
 * type says so, and an `env` of any other type stays invisible. The reads are
 * recognised in the shapes `alias.X`, `alias?.X`, `alias["X"]`, `process.env["X"]`,
 * `{ X: alias.X }` (which is just `alias.X`) and `const { X } = alias`.
 *
 * Still not seen, and no longer worth hiding: computed reads
 * (`process.env[prefix + suffix]`), whose name does not exist as a literal
 * anywhere; and an env object received UNTYPED or typed as a plain
 * `Record<string, string | undefined>`. Those need a human.
 *
 * Pure text, no database, no network — runs in `quality` on every PR.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { stripComments } from "./lib/source-text";

const SOURCE_ROOTS = ["src", "scripts"];
const SOURCE_EXTENSIONS = [".ts", ".astro", ".mjs"];
const ENV_EXAMPLE = ".env.example";

/** `process.env.NAME` — the direct read. */
const ENV_READ = /process\.env\.([A-Z][A-Z0-9_]*)/g;

/** `process.env["NAME"]` / `process.env['NAME']` — the string-literal index read. */
const ENV_INDEX_READ =
  /process\.env\[\s*[\x22\x27]([A-Z][A-Z0-9_]*)[\x22\x27]\s*\]/g;

/**
 * A name bound to the whole `process.env` object — `const env = process.env`,
 * `env: NodeJS.ProcessEnv = process.env`, or a class field initialiser. The
 * negative lookahead is what keeps `process.env.FOO` from being read as a
 * binding of the object itself. The type annotation may carry generics with
 * commas inside `<...>` (`env: Record<string, string | undefined> = process.env`)
 * but a bare comma still ends it, so one parameter's default cannot bind its
 * neighbour.
 */
const ENV_ALIAS_BINDING =
  /([A-Za-z_$][\w$]*)\s*(?::\s*(?:[^=;,()<>{}]|<(?:[^<>]|<[^<>]*>)*>)+?)?\s*=\s*process\.env(?![.[\w$])/g;

/**
 * A name DECLARED as the environment by its type, with or without a default:
 * `(env: NodeJS.ProcessEnv)`, `env?: ProcessEnv`, `env: Readonly<NodeJS.ProcessEnv>`,
 * `env: typeof process.env`. The trailing `\b` / `(?![\w$])` keeps a longer type
 * name (`ProcessEnvironment`) from matching. `Record<string, string | undefined>`
 * is deliberately NOT here: the type does not say the object is the environment.
 */
const ENV_TYPED_BINDING =
  /([A-Za-z_$][\w$]*)\s*\??\s*:\s*(?:Readonly\s*<\s*)?(?:(?:NodeJS\s*\.\s*)?ProcessEnv(?![\w$])|typeof\s+process\.env(?![.[\w$]))/g;

/** `const { NAME, OTHER } = process.env` — a read of each destructured name. */
const ENV_DESTRUCTURE = /\{([^}]*)\}\s*=\s*process\.env(?![.[\w$])/g;

/** Names inside a destructuring pattern, ignoring any `: rename` and defaults. */
const DESTRUCTURED_NAME = /([A-Z][A-Z0-9_]*)\s*(?::|=|,|$)/g;

/** `process.env.X` and `process.env["X"]` — reads that need no alias. */
export function directEnvReads(source: string): Set<string> {
  const names = new Set<string>();

  for (const match of source.matchAll(ENV_READ)) names.add(match[1]!);
  for (const match of source.matchAll(ENV_INDEX_READ)) names.add(match[1]!);

  return names;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Reads reached through an alias, resolved per FILE so a binding in one module
 * never authorises an `env.X` in another.
 */
export function aliasedEnvReads(source: string): Set<string> {
  const aliases = new Set<string>();

  for (const match of source.matchAll(ENV_ALIAS_BINDING)) {
    aliases.add(match[1]!);
  }

  for (const match of source.matchAll(ENV_TYPED_BINDING)) {
    aliases.add(match[1]!);
  }

  const names = new Set<string>();

  for (const match of source.matchAll(ENV_DESTRUCTURE)) {
    for (const name of match[1]!.matchAll(DESTRUCTURED_NAME)) {
      names.add(name[1]!);
    }
  }

  for (const alias of aliases) {
    const escaped = escapeRegExp(alias);

    // `alias.X` and `alias?.X`. The leading boundary is `(?<![\w$])` rather than
    // `\b` so an alias beginning with `$` is still anchored. A plain assignment
    // (`alias.X = "true"`) is a WRITE — `ci-local` sets `CI`, `PATH` and the
    // database URLs on the environment it hands a child process — and is not a
    // read, so `(?!\s*=(?!=))` skips it; `===`, `==`, `??=` and `||=` still count.
    const read = new RegExp(
      `(?<![\\w$])${escaped}\\s*\\??\\.([A-Z][A-Z0-9_]*)(?![\\w$])(?!\\s*=(?!=))`,
      "g"
    );
    for (const match of source.matchAll(read)) names.add(match[1]!);

    // `alias["X"]`
    const index = new RegExp(
      `(?<![\\w$])${escaped}\\s*\\??\\.?\\[\\s*["']([A-Z][A-Z0-9_]*)["']\\s*\\]`,
      "g"
    );
    for (const match of source.matchAll(index)) names.add(match[1]!);

    // `const { X, Y } = alias`
    const destructure = new RegExp(
      `\\{([^}]*)\\}\\s*=\\s*${escaped}(?![\\w$])`,
      "g"
    );
    for (const match of source.matchAll(destructure)) {
      for (const name of match[1]!.matchAll(DESTRUCTURED_NAME)) {
        names.add(name[1]!);
      }
    }
  }

  return names;
}

/**
 * Variables that steer TOOLING rather than a deployment, so an operator copying
 * `.env.example` has no use for them. Each needs a reason; "it felt noisy" is
 * not one.
 */
export const TOOLING_ONLY: readonly { name: string; reason: string }[] = [
  {
    name: "CHANGESET_POLICY_BASE_REF",
    reason:
      "Overrides the base ref `changesets:policy:check` diffs against. Set by CI (and by a developer reproducing a PR check locally), never by a deployment."
  },
  {
    name: "CI_LOCAL_DATABASE_URL",
    reason:
      "Superuser connection string `ci:local` uses to create and drop the throwaway databases of its integration and e2e jobs (falls back to DATABASE_URL). A developer-machine setting for running the CI jobs locally, never read by a running deployment."
  },
  {
    name: "PLAYWRIGHT_BROWSERS_PATH",
    reason:
      "Playwright's own variable for where its browsers live. `ci:local` reads it only to check that the Chromium the e2e job needs is installed before starting; the application never reads it."
  },
  {
    name: "PLAYWRIGHT_CHROMIUM_EXECUTABLE",
    reason:
      "Points playwright.config.ts at a pre-installed system Chromium on machines where `playwright install` cannot run. `ci:local` reads it only to decide whether the e2e job can run; the application never reads it."
  },
  {
    name: "RELEASE_VERIFY_TAG",
    reason:
      "The tag `release:verify` validates. Meaningful only on a tagged release commit inside release.yml, never in a running environment."
  },
  {
    name: "GITHUB_SHA",
    reason:
      "Set by GitHub Actions to the pushed commit. `release:verify` falls back to it as the tag's commit when the checkout lacks the tag ref; never deployment configuration."
  },
  {
    name: "FAMILY_CONFORMANCE_REPORT_PATH",
    reason:
      "Where `family:conformance:check` writes its machine-readable report. A CI artefact path, not deployment configuration."
  },
  {
    name: "CI",
    reason:
      "Set by the CI provider itself. Nothing in a deployment sets or reads it as configuration."
  },
  {
    name: "NODE_ENV",
    reason:
      "Set by the runtime/toolchain. This codebase's own environment switch is APP_ENV, which IS in .env.example."
  },
  {
    name: "PATH",
    reason:
      "The operating system's own executable search path. `ci:local` reads the child environment's PATH only to PREPEND a toolchain directory to it; it is the host's variable, not configuration, and `ops/run-job.sh` deliberately leaves it behind."
  },
  {
    name: "E2E_LOGIN_IDENTIFIER",
    reason:
      "Owner login the e2e harness seeds through POST /api/v1/setup/initialize on a throwaway database (`ci:local` builds the setup body from it; ci.yml sets a fixture value). A test fixture, never deployment configuration."
  },
  {
    name: "E2E_OFFICE_CODE",
    reason:
      "Office code the e2e harness seeds through POST /api/v1/setup/initialize on a throwaway database (`ci:local` builds the setup body from it; ci.yml sets a fixture value). A test fixture, never deployment configuration."
  },
  {
    name: "E2E_PASSWORD",
    reason:
      "Owner password the e2e harness seeds through POST /api/v1/setup/initialize on a throwaway database (`ci:local` builds the setup body from it; ci.yml sets a fixture value). A test fixture, never deployment configuration."
  },
  {
    name: "ASTRO_NODE_AUTOSTART",
    reason:
      "Read by @astrojs/node's own built entry, and set to `disabled` by src/lib/server/standalone-entry.ts immediately before importing it (Issue #464) so the adapter does not bind the port with its un-wrapped handler. An internal handshake between two files in this repo — an operator setting it in a deployment could only break the server, never configure it."
  }
];

/**
 * Reads whose NAME is computed, so no scan can see it as a literal read
 * (`process.env[name]`, `env[POOL_MAX_OVERRIDE_ENV_VAR[kind]]`). The scanner
 * above recognises every literal spelling it can; what is left is declared
 * here, by a human, with the file that makes the read.
 *
 * It is NOT optional bookkeeping. `WORKER_DATABASE_URL` is read only as
 * `process.env[envVarName]` in `getNamedDatabaseClient`, so the generated jobs
 * allow-list silently dropped it — the prefix pattern it replaced carried it —
 * and every cron job fell back to `DATABASE_URL` (the `awcms_app` connection)
 * instead of the least-privilege `awcms_worker` role (Issue #1119).
 *
 * `tests/env-contract-coverage.test.ts` requires each entry's `file` to still
 * contain `name` as a string literal, so an entry cannot outlive the code that
 * justified it.
 */
export const COMPUTED_ENV_READS: readonly {
  name: string;
  file: string;
  /**
   * The CODE shape of the read, matched against the file with comments
   * stripped. A name that only survives in a doc comment (client.ts names every
   * entry below in one) must not keep an entry alive after the real literal is
   * renamed or removed.
   */
  needle: RegExp;
  reason: string;
}[] = [
  {
    name: "WORKER_DATABASE_URL",
    file: "src/lib/database/client.ts",
    needle: /\?\s*"WORKER_DATABASE_URL"/,
    reason:
      "getNamedDatabaseClient picks the variable per client kind and reads process.env[envVarName]; the worker kind is every scheduled job's connection."
  },
  {
    name: "SETUP_DATABASE_URL",
    file: "src/lib/database/client.ts",
    needle: /:\s*"SETUP_DATABASE_URL"/,
    reason:
      "Same computed read, setup kind: the one-time bootstrap connection (awcms_setup)."
  },
  {
    name: "DATABASE_POOL_MAX_WORKER",
    file: "src/lib/database/client.ts",
    needle: /worker:\s*"DATABASE_POOL_MAX_WORKER"/,
    reason:
      "POOL_MAX_OVERRIDE_ENV_VAR maps the worker kind to this name and resolvePoolMaxForKind reads env[overrideVar]."
  },
  {
    name: "DATABASE_POOL_MAX_SETUP",
    file: "src/lib/database/client.ts",
    needle: /setup:\s*"DATABASE_POOL_MAX_SETUP"/,
    reason:
      "Same map, setup kind; read as env[overrideVar] by resolvePoolMaxForKind."
  },
  {
    name: "PLATFORM_TENANT_ID",
    file: "src/lib/tenant/platform-tenant.ts",
    needle: /PLATFORM_TENANT_ENV_VAR\s*=\s*"PLATFORM_TENANT_ID"/,
    reason:
      "Read as env[PLATFORM_TENANT_ENV_VAR] by resolvePlatformTenant and resolvePlatformTenantIdIgnoringStatus: request-time platform-authority checks and the operator-run security:readiness CLI."
  },
  {
    name: "AUTH_IP_HASH_SECRET",
    file: "src/lib/security/client-fingerprint.ts",
    needle: /IP_HASH_SECRET_ENV\s*=\s*"AUTH_IP_HASH_SECRET"/,
    reason:
      "Read as process.env[IP_HASH_SECRET_ENV] by resolveIpHashKey: the keyed hash of the client address on the public auth surface."
  },
  ...["app", "worker", "setup"].flatMap((processClass) =>
    ["MIN", "EXPECTED", "MAX"].map((bound) => ({
      name: `DATABASE_CAPACITY_${processClass.toUpperCase()}_INSTANCES_${bound}`,
      file: "src/lib/database/capacity-config.ts",
      needle: new RegExp(
        "DATABASE_CAPACITY_\\$\\{processClass\\.toUpperCase\\(\\)\\}_INSTANCES_`" +
          "[\\s\\S]*?env\\[`\\$\\{prefix\\}" +
          bound +
          "`\\]"
      ),
      reason:
        "loadInstanceCounts builds the name from the process class and reads env[`${prefix}" +
        bound +
        "`]; it feeds the pool-health route and the capacity check."
    }))
  )
];

export type EnvCoverageViolation = { name: string; files: string[] };

/** Present whether assigned or left as a commented placeholder. */
export function declaredInEnvExample(source: string): Set<string> {
  const declared = new Set<string>();

  for (const line of source.split("\n")) {
    const match = line.match(/^\s*#?\s*([A-Z][A-Z0-9_]*)=/);
    if (match) declared.add(match[1]!);
  }

  return declared;
}

export function findCoverageViolations(
  reads: ReadonlyMap<string, string[]>,
  declared: ReadonlySet<string>
): EnvCoverageViolation[] {
  const excused = new Set(TOOLING_ONLY.map((entry) => entry.name));

  return [...reads.entries()]
    .filter(([name]) => !declared.has(name) && !excused.has(name))
    .map(([name, files]) => ({ name, files: [...files].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function* walk(directory: string): AsyncGenerator<string> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      yield* walk(full);
      continue;
    }

    if (SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      yield full;
    }
  }
}

export async function collectEnvReads(): Promise<Map<string, string[]>> {
  const reads = new Map<string, string[]>();

  for (const root of SOURCE_ROOTS) {
    for await (const file of walk(root)) {
      const source = stripComments(await Bun.file(file).text());

      const names = new Set<string>();

      for (const name of directEnvReads(source)) names.add(name);
      for (const name of aliasedEnvReads(source)) names.add(name);

      for (const name of names) {
        const files = reads.get(name) ?? [];
        if (!files.includes(file)) files.push(file);
        reads.set(name, files);
      }
    }
  }

  for (const entry of COMPUTED_ENV_READS) {
    const files = reads.get(entry.name) ?? [];
    if (!files.includes(entry.file)) files.push(entry.file);
    reads.set(entry.name, files);
  }

  return reads;
}

async function main(): Promise<void> {
  const reads = await collectEnvReads();
  const declared = declaredInEnvExample(await Bun.file(ENV_EXAMPLE).text());
  const violations = findCoverageViolations(reads, declared);

  if (violations.length === 0) {
    console.log(
      `config:env:coverage:check OK — ${reads.size} variabel env dibaca kode, ` +
        `semuanya ada di ${ENV_EXAMPLE} atau tercatat sebagai tooling-only ` +
        `(${TOOLING_ONLY.length}).`
    );
    return;
  }

  for (const violation of violations) {
    console.error(
      `${violation.name} — dibaca kode tapi tidak ada di ${ENV_EXAMPLE}. ` +
        "Operator yang menyalin berkas itu tak punya cara menemukannya. " +
        "Tambahkan (placeholder ber-komentar sudah cukup, dan wajib untuk secret) " +
        "atau catat di TOOLING_ONLY dengan alasannya.\n    " +
        violation.files.join("\n    ")
    );
  }

  process.exitCode = 1;
}

if (import.meta.main) {
  await main();
}

/**
 * Re-exported for the callers that already import it from here — finding D2
 * moved the implementation to `scripts/lib/source-text.ts` and left the name
 * reachable rather than editing 21 import lines in the same change.
 */
export { stripComments };
