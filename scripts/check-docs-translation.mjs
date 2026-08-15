#!/usr/bin/env bun
/**
 * check-docs-translation.mjs — documentation translation gates (ADR-0097).
 *
 * ENGLISH at the bare path is the source; Indonesian at `<name>.id.md` is the
 * mirror, and the mirror records the hash of the English it was translated from.
 * ADR-0023 ran this the other way; ADR-0097 inverts it and widens the scope from
 * three front-door documents to the whole corpus.
 *
 * Two questions, kept separate on purpose (see `lib/docs-i18n-checks.mjs`):
 * whether an existing mirror is CURRENT, and which documents have NO mirror yet.
 *
 * Pure logic lives in `scripts/lib/docs-i18n-checks.mjs`; this file does I/O and
 * exit codes. Run: `bun run check:docs:translation`.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  checkMirrorCoverage,
  checkTranslationPair,
  deriveSourcePath
} from "./lib/docs-i18n-checks.mjs";

const ROOT = resolve(import.meta.dirname, "..");

/** @typedef {import("./lib/docs-i18n-checks.mjs").Problem} Problem */

/**
 * Documents whose language is decided by a GENERATOR or by an upstream spec, so
 * hand-translating the artefact would be overwritten on the next run.
 *
 * These are not exempt from being English — they are exempt from being mirrored
 * BY HAND. `api-reference.md` is regenerated from the OpenAPI `description`
 * fields (ADR-0023 already scoped it out for this reason, and ADR-0097 keeps
 * that carve-out); the other two are emitted by scripts in `scripts/`. Making
 * them English is a change to the generator or the spec, not to the file.
 */
const GENERATED_NOT_HAND_MIRRORED = new Set([
  "docs/awcms/api-reference.md",
  "docs/awcms/repo-inventory.md",
  "docs/awcms/agent-memory.md"
]);

/**
 * Documents still awaiting their Indonesian mirror.
 *
 * **This list may only SHRINK.** Removing an entry is how the migration records
 * progress; the gate rejects an entry whose mirror now exists, so the ledger
 * cannot overstate the debt and quietly stop being believed. Nothing new may be
 * added: a document written after ADR-0097 is written in English and mirrored in
 * the same change.
 *
 * It started at 253 — the whole corpus minus the four documents ADR-0023 had
 * already paired and the three generated artefacts above.
 *
 * **IT IS NOW EMPTY, AND THAT IS THE END STATE, NOT A RESET.** Every document in
 * scope has its mirror. The ledger stays here rather than being deleted because
 * it is the mechanism that makes coverage a gate: `checkMirrorCoverage` reports
 * any un-mirrored document that is not listed, so an empty list means "no
 * document may be added without its mirror". Deleting the export would turn that
 * from an assertion into an absence.
 *
 * The `@type` annotation is load-bearing now that it is empty: with no elements
 * TypeScript infers `any[]`, and `bun run typecheck` refuses an implicit `any`.
 * That failure is the ledger doing its job one last time — it appeared at
 * exactly the moment the migration finished.
 */
/** @type {readonly string[]} */
export const DOCS_AWAITING_MIRROR = [];

/** Tracked markdown in scope: docs, skills, module READMEs, front-door READMEs. */
function listSources() {
  // `--others --exclude-standard` so a document added in THIS change is checked
  // before it is committed. Plain `git ls-files` sees only tracked files, so a
  // brand-new document would pass unexamined and fail for whoever ran the gate
  // next — `check-docs.mjs` already enumerates this way for the same reason.
  const out = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "*.md"],
    { cwd: ROOT, encoding: "utf8" }
  );
  return out
    .split("\n")
    .filter(Boolean)
    .filter((file) => !file.endsWith(".id.md"))
    .filter((file) => !file.startsWith(".changeset/"))
    .filter((file) => file !== "CHANGELOG.md")
    .filter((file) =>
      /^(docs\/|\.claude\/skills\/|README\.md$|scripts\/README\.md$|src\/.*README\.md$)/.test(
        file
      )
    )
    .filter((file) => !GENERATED_NOT_HAND_MIRRORED.has(file));
}

/** @returns {string[]} tracked `.id.md` mirrors that exist on disk. */
function listMirrors() {
  // Untracked mirrors included, for the same reason as `listSources`: a pair
  // created in this change must be judged now. Enumerating sources one way and
  // mirrors the other is worse than either — the coverage check would then
  // report a brand-new document as unmirrored while its mirror sat right there.
  const out = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "*.id.md"],
    { cwd: ROOT, encoding: "utf8" }
  );
  return out.split("\n").filter(Boolean);
}

/**
 * Read a file, or return null when it is not there.
 *
 * Not `existsSync` + `readFileSync`: that pair is a time-of-check/time-of-use
 * race. Here the consequence is a spurious finding rather than a corrupt write,
 * but the sibling writer (`docs-i18n-stamp.mjs`) had the same shape and CodeQL
 * `js/file-system-race` flagged it — leaving the twin in place would be knowing
 * about a defect and keeping it.
 *
 * @param {string} path
 * @returns {string | null}
 */
function readFileIfPresent(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      /** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

/** @returns {Problem[]} */
export function runChecks() {
  /** @type {Problem[]} */
  const problems = [];
  const mirrors = listMirrors();

  for (const mirrorPath of mirrors) {
    const sourcePath = deriveSourcePath(mirrorPath);
    if (!sourcePath) continue;

    const mirrorContent = readFileIfPresent(join(ROOT, mirrorPath));
    if (mirrorContent === null) continue;
    const sourceContent = readFileIfPresent(join(ROOT, sourcePath));

    problems.push(
      ...checkTranslationPair(
        sourcePath,
        sourceContent,
        mirrorPath,
        mirrorContent
      )
    );
  }

  problems.push(
    ...checkMirrorCoverage(
      listSources(),
      new Set(mirrors),
      DOCS_AWAITING_MIRROR
    )
  );

  return problems;
}

if (import.meta.main) {
  const problems = runChecks();
  if (problems.length > 0) {
    console.error(
      `check:docs:translation FAILED — ${problems.length} finding(s):`
    );
    for (const p of problems) console.error(`  - ${p.file}: ${p.message}`);
    process.exit(1);
  }
  const mirrored = listMirrors().length;
  console.log(
    `check:docs:translation OK — ${mirrored} mirror(s) current against their English source; ${DOCS_AWAITING_MIRROR.length} document(s) on the shrink-only translation ledger.`
  );
}
