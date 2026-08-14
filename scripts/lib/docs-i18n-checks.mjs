/**
 * docs-i18n-checks.mjs — pure logic for the documentation translation gates.
 *
 * ## Direction (ADR-0097, superseding ADR-0023 decisions 1 and 2)
 *
 * ENGLISH at the bare path `<name>.md` is the **authoritative source**, written
 * and edited by hand. Indonesian at `<name>.id.md` is the **mirror**. The mirror
 * carries `<!-- i18n-source-hash: sha256:<hex> -->` recording the hash of the
 * English source it was translated from; when the English source changes and the
 * mirror is not re-translated, the recorded hash stops matching and the gate
 * fails naming the stale file.
 *
 * ADR-0023 ran this the other way — Indonesian was the source and English the
 * generated default — and the marker therefore lived in the English file. The
 * direction is inverted here, so the marker moves to the `.id.md` side. That is
 * the only mechanical change; the hash and the marker syntax are unchanged.
 *
 * ## Two questions, deliberately separate
 *
 * `checkTranslationPair` answers **"is this mirror current?"** — a consistency
 * question about a pair that already exists.
 *
 * `checkMirrorCoverage` answers **"which documents have no mirror at all?"** — a
 * coverage question. Fusing them would produce a gate that is green while most
 * of the corpus is untranslated, because a document with no mirror has no pair
 * to be stale. That is the "green while every answer is wrong" failure this repo
 * has hit before, so the two stay apart.
 *
 * Neither function translates anything. There is no translation API call in this
 * repo's CI, by ADR-0023 decision 4, which ADR-0097 keeps: the gate DETECTS
 * drift and the translation is done in the same change that caused it.
 */

import { createHash } from "node:crypto";

/** @typedef {{ file: string, line: number, message: string }} Problem */

export const MARKER_REGEX =
  /<!--\s*i18n-source-hash:\s*(sha256:[0-9a-f]{64})\s*-->/;

/**
 * Hash of the ENGLISH source content. The mirror records this value.
 * @param {string} sourceContent
 * @returns {string} `sha256:<hex>`
 */
export function computeSourceHash(sourceContent) {
  return `sha256:${createHash("sha256").update(sourceContent).digest("hex")}`;
}

/**
 * @param {string} mirrorContent
 * @returns {string | null}
 */
export function extractRecordedHash(mirrorContent) {
  const match = mirrorContent.match(MARKER_REGEX);
  return match ? (match[1] ?? null) : null;
}

/**
 * `docs/awcms/README.md` -> `docs/awcms/README.id.md`.
 * @param {string} sourcePath
 * @returns {string | null} null when `sourcePath` is not a bare `.md` source.
 */
export function deriveMirrorPath(sourcePath) {
  if (!sourcePath.endsWith(".md")) return null;
  if (sourcePath.endsWith(".id.md")) return null;
  return `${sourcePath.slice(0, -".md".length)}.id.md`;
}

/**
 * `docs/awcms/README.id.md` -> `docs/awcms/README.md`.
 * @param {string} mirrorPath
 * @returns {string | null} null when `mirrorPath` is not a `.id.md` mirror.
 */
export function deriveSourcePath(mirrorPath) {
  if (!mirrorPath.endsWith(".id.md")) return null;
  return `${mirrorPath.slice(0, -".id.md".length)}.md`;
}

/**
 * Is this mirror current with its English source?
 *
 * @param {string} sourcePath
 * @param {string | null} sourceContent - null when the English source is absent.
 * @param {string} mirrorPath
 * @param {string} mirrorContent
 * @returns {Problem[]}
 */
export function checkTranslationPair(
  sourcePath,
  sourceContent,
  mirrorPath,
  mirrorContent
) {
  /** @type {Problem[]} */
  const problems = [];

  // An orphan mirror is reported against the MIRROR, not the missing source:
  // the file that exists is the one a reader can open and act on.
  if (sourceContent === null) {
    problems.push({
      file: mirrorPath,
      line: 1,
      message: `Indonesian mirror with no English source (${sourcePath} does not exist). English is the source language (ADR-0097) — either restore the source or delete the orphan mirror.`
    });
    return problems;
  }

  const recorded = extractRecordedHash(mirrorContent);
  if (!recorded) {
    problems.push({
      file: mirrorPath,
      line: 1,
      message: `no <!-- i18n-source-hash: sha256:... --> marker — add it, recording the hash of ${sourcePath}, after translating.`
    });
    return problems;
  }

  const current = computeSourceHash(sourceContent);
  if (recorded !== current) {
    problems.push({
      file: mirrorPath,
      line: 1,
      message: `stale mirror — ${sourcePath} changed since this was translated (marker ${recorded}, source is now ${current}). Re-translate, then update the marker.`
    });
  }

  return problems;
}

/**
 * Which English documents are missing their Indonesian mirror?
 *
 * `awaitingMirror` is a **shrink-only ledger**: a document may sit on it while
 * its translation is outstanding, and removing an entry is how progress is
 * recorded. A document NOT on the ledger and without a mirror is a failure, and
 * so is a ledger entry for a document that now HAS one — a ledger that overstates
 * the debt is a ledger nobody believes, and it would let the migration stall
 * while still reading as deliberate.
 *
 * @param {string[]} sourcePaths - tracked English docs in scope.
 * @param {Set<string>} existingMirrors - `.id.md` paths present on disk.
 * @param {readonly string[]} awaitingMirror - the shrink-only ledger.
 * @returns {Problem[]}
 */
export function checkMirrorCoverage(
  sourcePaths,
  existingMirrors,
  awaitingMirror
) {
  /** @type {Problem[]} */
  const problems = [];
  const ledger = new Set(awaitingMirror);
  const inScope = new Set(sourcePaths);

  for (const sourcePath of sourcePaths) {
    const mirrorPath = deriveMirrorPath(sourcePath);
    if (mirrorPath === null) continue;
    if (existingMirrors.has(mirrorPath)) continue;
    if (ledger.has(sourcePath)) continue;

    problems.push({
      file: sourcePath,
      line: 1,
      message: `no Indonesian mirror (${mirrorPath}) and not on the awaiting-translation ledger. Every document is mirrored (ADR-0097) — translate it, or add it to the ledger with the rest of the outstanding migration.`
    });
  }

  for (const entry of awaitingMirror) {
    const mirrorPath = deriveMirrorPath(entry);

    if (!inScope.has(entry)) {
      problems.push({
        file: entry,
        line: 1,
        message: `on the awaiting-translation ledger but not a tracked document in scope — remove the entry.`
      });
      continue;
    }

    if (mirrorPath !== null && existingMirrors.has(mirrorPath)) {
      problems.push({
        file: entry,
        line: 1,
        message: `on the awaiting-translation ledger but ${mirrorPath} now exists — remove the entry, the ledger may only shrink.`
      });
    }
  }

  return problems;
}
