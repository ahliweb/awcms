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
 * Still not seen, and no longer worth hiding: computed reads
 * (`process.env[prefix + suffix]`), whose name does not exist as a literal
 * anywhere. Those need a human.
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

/**
 * A name bound to the whole `process.env` object — `const env = process.env`,
 * `env: NodeJS.ProcessEnv = process.env`, or a class field initialiser. The
 * negative lookahead is what keeps `process.env.FOO` from being read as a
 * binding of the object itself.
 */
const ENV_ALIAS_BINDING =
  /([A-Za-z_$][\w$]*)\s*(?::\s*[^=;,)]+?)?\s*=\s*process\.env(?![.[\w$])/g;

/** `const { NAME, OTHER } = process.env` — a read of each destructured name. */
const ENV_DESTRUCTURE = /\{([^}]*)\}\s*=\s*process\.env(?![.[\w$])/g;

/** Names inside a destructuring pattern, ignoring any `: rename` and defaults. */
const DESTRUCTURED_NAME = /([A-Z][A-Z0-9_]*)\s*(?::|=|,|$)/g;

/**
 * Reads reached through an alias, resolved per FILE so a binding in one module
 * never authorises an `env.X` in another.
 */
export function aliasedEnvReads(source: string): Set<string> {
  const aliases = new Set<string>();

  for (const match of source.matchAll(ENV_ALIAS_BINDING)) {
    aliases.add(match[1]!);
  }

  const names = new Set<string>();

  for (const match of source.matchAll(ENV_DESTRUCTURE)) {
    for (const name of match[1]!.matchAll(DESTRUCTURED_NAME)) {
      names.add(name[1]!);
    }
  }

  for (const alias of aliases) {
    const read = new RegExp(`\\b${alias}\\.([A-Z][A-Z0-9_]*)\\b`, "g");
    for (const match of source.matchAll(read)) names.add(match[1]!);
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
    name: "RELEASE_VERIFY_TAG",
    reason:
      "The tag `release:verify` validates. Meaningful only on a tagged release commit inside release.yml, never in a running environment."
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
    name: "ASTRO_NODE_AUTOSTART",
    reason:
      "Read by @astrojs/node's own built entry, and set to `disabled` by src/lib/server/standalone-entry.ts immediately before importing it (Issue #464) so the adapter does not bind the port with its un-wrapped handler. An internal handshake between two files in this repo — an operator setting it in a deployment could only break the server, never configure it."
  }
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

      for (const match of source.matchAll(ENV_READ)) names.add(match[1]!);
      for (const name of aliasedEnvReads(source)) names.add(name);

      for (const name of names) {
        const files = reads.get(name) ?? [];
        if (!files.includes(file)) files.push(file);
        reads.set(name, files);
      }
    }
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
