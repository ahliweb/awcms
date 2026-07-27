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
 * ## Known limit, stated rather than hidden
 *
 * This matches `process.env.X` only. Config modules that thread
 * `env: NodeJS.ProcessEnv = process.env` through a parameter and then read
 * `env.X` are invisible here — `tenant-domain-dns-config.ts` does exactly that.
 * Broadening the pattern to any `env.X` would swallow unrelated identifiers, so
 * the gate stays precise and this comment records what it does not see.
 *
 * Pure text, no database, no network — runs in `quality` on every PR.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";

const SOURCE_ROOTS = ["src", "scripts"];
const SOURCE_EXTENSIONS = [".ts", ".astro", ".mjs"];
const ENV_EXAMPLE = ".env.example";

/** `process.env.NAME` — the direct read. */
const ENV_READ = /process\.env\.([A-Z][A-Z0-9_]*)/g;

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
  }
];

export type EnvCoverageViolation = { name: string; files: string[] };

/**
 * Comments are stripped so a docblock that MENTIONS `process.env.TOKEN` while
 * explaining a rule is not read as a read — `security-readiness.ts` does
 * exactly that, and without this the gate reports a variable that no code ever
 * touches.
 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(?:\/\/|\*)/.test(line))
    .join("\n");
}

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

      for (const match of source.matchAll(ENV_READ)) {
        const name = match[1]!;
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
