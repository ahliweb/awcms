#!/usr/bin/env bun
/**
 * docs-i18n-stamp.mjs — put the translation bookkeeping where ADR-0097 says.
 *
 * For every `<name>.id.md` mirror that has a `<name>.md` source, this:
 *
 *  1. writes the language-switcher banner on BOTH files, naming English as the
 *     source (ADR-0023's banners named Indonesian as the source, which ADR-0097
 *     reverses — a banner that lies about which file is authoritative sends the
 *     next editor to change the wrong one);
 *  2. records `<!-- i18n-source-hash: sha256:... -->` in the MIRROR, hashing the
 *     English source;
 *  3. REMOVES any marker left in the English source, where ADR-0023 used to keep
 *     it. A stale marker on the source side is not inert — it looks like
 *     bookkeeping and records nothing.
 *
 * Idempotent: running it twice changes nothing. It does NOT translate; it only
 * moves the bookkeeping, which is why `--check` can be trusted to say whether a
 * tree is already correct.
 *
 * ## It will REFUSE to declare a mirror current that nobody re-translated
 *
 * The marker says "this mirror was translated from a source with this hash".
 * Re-writing it is a CLAIM about the translation, and until this guard existed
 * the tool made that claim unconditionally — so the sequence "edit the English,
 * run the stamp" turned `check:docs:translation` green over an Indonesian
 * mirror that still said the old thing. That happened for real: a generated
 * §2 count went 141 -> 142 in `PROJECT_STATE.md`, the stamp declared the mirror
 * current, and the mirror still read 141. It was caught by a test that checks
 * `sql/NNN` ranges across documents — a backstop that exists for a different
 * reason and covers one field.
 *
 * So when a mirror's recorded hash is stale, re-stamping is allowed only when
 * something says the translation was actually looked at:
 *
 *  1. **the mirror itself is modified** in this working tree (or untracked) —
 *     somebody edited the translation, which is the whole signal; or
 *  2. **the source changed only in whitespace** since `HEAD` — the case this
 *     tool was built for, where `bun run format` reflows an English document
 *     and no translator needs to do anything.
 *
 * Otherwise it refuses, names the file, and says what to do. `--force-restamp`
 * is the deliberate override for a reword the translation genuinely survives.
 *
 * Usage:
 *   bun run docs:i18n:stamp                   # rewrite banners + markers in place
 *   bun run docs:i18n:stamp --check           # report what would change, exit 1 if any
 *   bun run docs:i18n:stamp --force-restamp   # re-stamp even an untouched mirror
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  MARKER_REGEX,
  computeSourceHash,
  deriveSourcePath,
  extractRecordedHash
} from "./lib/docs-i18n-checks.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const CHECK_ONLY = process.argv.includes("--check");
const FORCE_RESTAMP = process.argv.includes("--force-restamp");

/** A line is a language banner when it opens with either flag. */
const BANNER_REGEX = /^(?:🇬🇧|🇮🇩).*$/u;

/**
 * A leading YAML frontmatter block, which must stay the FIRST bytes of the file.
 *
 * All 55 `.claude/skills/*​/SKILL.md` files open with one, and the loader that
 * reads them requires `---` at byte zero. Prepending the banner above it would
 * not fail loudly — it would silently stop the frontmatter being frontmatter, so
 * every skill would lose the `name`/`description` that decide when it is
 * selected. The banner therefore goes AFTER the block, not before the file.
 */
const FRONTMATTER_REGEX = /^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/;

/**
 * @param {string} content
 * @returns {{ frontmatter: string, body: string }}
 */
function splitFrontmatter(content) {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) return { frontmatter: "", body: content };
  const block = match[0];
  return { frontmatter: block, body: content.slice(block.length) };
}

/**
 * Apply `transform` to the body only, leaving any frontmatter block untouched
 * and still first.
 *
 * @param {string} content
 * @param {(body: string) => string} transform
 * @returns {string}
 */
function inBody(content, transform) {
  const { frontmatter, body } = splitFrontmatter(content);
  if (!frontmatter) return transform(body);
  return `${frontmatter}\n${transform(body.replace(/^\s*\n/, ""))}`;
}

/**
 * @param {string} mirrorPath
 * @returns {string}
 */
function englishBanner(mirrorPath) {
  return `🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](${basename(mirrorPath)})`;
}

/**
 * @param {string} sourcePath
 * @returns {string}
 */
function indonesianBanner(sourcePath) {
  return `🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](${basename(sourcePath)})`;
}

/**
 * Replace a leading banner line, or insert one. Everything after the banner is
 * preserved byte for byte — this tool must never be a reason to re-review prose.
 *
 * @param {string} content
 * @param {string} banner
 * @returns {string}
 */
function withBanner(content, banner) {
  const lines = content.split("\n");
  if (lines.length > 0 && BANNER_REGEX.test(lines[0] ?? "")) {
    lines[0] = banner;
    return lines.join("\n");
  }
  return `${banner}\n\n${content}`;
}

/**
 * @param {string} content
 * @returns {string}
 */
function withoutMarker(content) {
  return content
    .split("\n")
    .filter((/** @type {string} */ line) => !MARKER_REGEX.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * Marker goes immediately after the banner, before the first heading.
 *
 * @param {string} content
 * @param {string} hash
 * @returns {string}
 */
function withMarker(content, hash) {
  const stripped = withoutMarker(content);
  const lines = stripped.split("\n");
  const marker = `<!-- i18n-source-hash: ${hash} -->`;

  if (lines.length > 0 && BANNER_REGEX.test(lines[0] ?? "")) {
    const rest = lines.slice(1).join("\n").replace(/^\n+/, "");
    return `${lines[0]}\n\n${marker}\n\n${rest}`;
  }
  return `${marker}\n\n${stripped}`;
}

/** @returns {string[]} */
function listMirrors() {
  return execFileSync(
    "git",
    // Untracked mirrors included: a pair created in this change must be stamped
    // now, not after someone commits it.
    ["ls-files", "--cached", "--others", "--exclude-standard", "*.id.md"],
    { cwd: ROOT, encoding: "utf8" }
  )
    .split("\n")
    .filter(Boolean);
}

/**
 * Read a file, or return null when it is not there.
 *
 * Deliberately not `existsSync` + `readFileSync`: that pair is a
 * time-of-check/time-of-use race, and the failure it invites is silent — the
 * check passes, the file disappears, and the read throws in the middle of a
 * multi-file rewrite, leaving the tree half-stamped.
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

/**
 * Paths git reports as modified, staged, or untracked in this working tree.
 *
 * Computed once: `git status --porcelain` over the whole repository is one
 * process, where asking per file would be one per mirror.
 *
 * @returns {Set<string>}
 */
function workingTreeChanges() {
  const output = execFileSync("git", ["status", "--porcelain", "-z"], {
    cwd: ROOT,
    encoding: "utf8"
  });

  const paths = new Set();

  // NUL-separated so a path containing a space or a quote cannot be misparsed.
  // A rename entry is `R  new\0old`, and both halves matter to us: the new path
  // is the changed file, and the old one no longer exists.
  for (const entry of output.split("\0")) {
    if (entry.length < 4) continue;
    paths.add(entry.slice(3));
  }

  return paths;
}

/**
 * The committed content of `path`, or `null` when it is not in `HEAD` (a new
 * file, or a repository with no commits yet).
 *
 * @param {string} path
 * @returns {string | null}
 */
function committedContent(path) {
  try {
    return execFileSync("git", ["show", `HEAD:${path}`], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
  } catch {
    return null;
  }
}

/**
 * Every whitespace run to one space, so a reflow compares equal.
 *
 * @param {string} content
 * @returns {string}
 */
function withoutWhitespace(content) {
  return content.replace(/\s+/g, " ").trim();
}

/**
 * May this mirror's marker be re-written to claim the source's new hash?
 *
 * @param {string} mirrorPath
 * @param {string} sourcePath
 * @param {string} originalMirror
 * @param {string} nextSource
 * @param {Set<string>} touched
 * @returns {boolean}
 */
function mayRestamp(
  mirrorPath,
  sourcePath,
  originalMirror,
  nextSource,
  touched
) {
  if (FORCE_RESTAMP) return true;

  const recorded = extractRecordedHash(originalMirror);

  // No marker yet, or the marker already matches: nothing is being CLAIMED that
  // was not already true, so there is nothing to refuse.
  if (!recorded || recorded === computeSourceHash(nextSource)) return true;

  // Somebody edited the translation in this working tree.
  if (touched.has(mirrorPath)) return true;

  // A formatting-only change to the source — the case this tool exists for.
  const committed = committedContent(sourcePath);

  return (
    committed !== null &&
    withoutWhitespace(committed) === withoutWhitespace(nextSource)
  );
}

const touchedPaths = workingTreeChanges();

/** @type {string[]} */
const refused = [];

/** @type {string[]} */
const changed = [];

for (const mirrorPath of listMirrors()) {
  const sourcePath = deriveSourcePath(mirrorPath);
  if (!sourcePath) continue;

  const sourceFull = join(ROOT, sourcePath);

  // Read and handle absence from the READ, rather than asking `existsSync`
  // first. The two-step form is a time-of-check/time-of-use race — the file can
  // vanish between the check and the read — and it is not hypothetical here:
  // this tool runs over a tree that `git`, Prettier and an editor may all be
  // touching. CodeQL `js/file-system-race` flagged it.
  const originalSource = readFileIfPresent(sourceFull);
  if (originalSource === null) continue;

  const nextSource = inBody(originalSource, (body) =>
    withBanner(withoutMarker(body), englishBanner(mirrorPath))
  );

  const mirrorFull = join(ROOT, mirrorPath);
  const originalMirror = readFileIfPresent(mirrorFull);
  if (originalMirror === null) continue;
  const nextMirror = inBody(originalMirror, (body) =>
    withMarker(
      withBanner(body, indonesianBanner(sourcePath)),
      // Hash the source AS IT WILL BE WRITTEN, not as it was read — otherwise
      // the banner rewrite above changes the file after we hashed it and the
      // gate fails on a tree this tool just produced.
      computeSourceHash(nextSource)
    )
  );

  if (nextSource !== originalSource) {
    changed.push(sourcePath);
    if (!CHECK_ONLY) writeFileSync(sourceFull, nextSource);
  }
  if (nextMirror !== originalMirror) {
    if (
      !mayRestamp(
        mirrorPath,
        sourcePath,
        originalMirror,
        nextSource,
        touchedPaths
      )
    ) {
      refused.push(mirrorPath);
      continue;
    }

    changed.push(mirrorPath);
    if (!CHECK_ONLY) writeFileSync(mirrorFull, nextMirror);
  }
}

if (refused.length > 0) {
  console.error(
    `docs:i18n:stamp REFUSES to re-stamp ${refused.length} mirror(s) nobody re-translated:`
  );
  for (const file of refused) console.error(`  - ${file}`);
  console.error(
    "\n  Their English source changed by more than whitespace and the mirror was\n" +
      "  not touched in this working tree. Re-stamping would make\n" +
      "  `check:docs:translation` green over a translation that still says the old\n" +
      "  thing — which is the failure this guard exists for, and which has\n" +
      "  happened.\n\n" +
      "  Update the mirror, or pass --force-restamp if the translation genuinely\n" +
      "  survives the reword."
  );
  process.exit(1);
}

if (CHECK_ONLY) {
  if (changed.length > 0) {
    console.error(
      `docs:i18n:stamp --check FAILED — ${changed.length} file(s) need stamping:`
    );
    for (const file of changed) console.error(`  - ${file}`);
    process.exit(1);
  }
  console.log("docs:i18n:stamp --check OK — banners and markers are in place.");
} else {
  console.log(
    changed.length === 0
      ? "docs:i18n:stamp — nothing to do."
      : `docs:i18n:stamp — updated ${changed.length} file(s).\n` +
          "  If `bun run format` then changes an English source, its mirror's hash goes\n" +
          "  STALE and `check:docs:translation` fails on files nothing translated wrongly.\n" +
          "  The order is FORMAT FIRST, THEN STAMP. Re-run this after formatting."
  );
}
