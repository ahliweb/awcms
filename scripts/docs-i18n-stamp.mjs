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
 * Usage:
 *   bun run docs:i18n:stamp            # rewrite banners + markers in place
 *   bun run docs:i18n:stamp --check    # report what would change, exit 1 if any
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  MARKER_REGEX,
  computeSourceHash,
  deriveSourcePath
} from "./lib/docs-i18n-checks.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const CHECK_ONLY = process.argv.includes("--check");

/** A line is a language banner when it opens with either flag. */
const BANNER_REGEX = /^(?:🇬🇧|🇮🇩).*$/u;

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
 */
/**
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

/** Marker goes immediately after the banner, before the first heading. */
/**
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
    .filter(Boolean)
    .filter((file) => existsSync(join(ROOT, file)));
}

/** @type {string[]} */
const changed = [];

for (const mirrorPath of listMirrors()) {
  const sourcePath = deriveSourcePath(mirrorPath);
  if (!sourcePath) continue;

  const sourceFull = join(ROOT, sourcePath);
  if (!existsSync(sourceFull)) continue;

  const originalSource = readFileSync(sourceFull, "utf8");
  const nextSource = withBanner(
    withoutMarker(originalSource),
    englishBanner(mirrorPath)
  );

  const mirrorFull = join(ROOT, mirrorPath);
  const originalMirror = readFileSync(mirrorFull, "utf8");
  const nextMirror = withMarker(
    withBanner(originalMirror, indonesianBanner(sourcePath)),
    // Hash the source AS IT WILL BE WRITTEN, not as it was read — otherwise the
    // banner rewrite below changes the file after we hashed it and the gate
    // fails on a tree this tool just produced.
    computeSourceHash(nextSource)
  );

  if (nextSource !== originalSource) {
    changed.push(sourcePath);
    if (!CHECK_ONLY) writeFileSync(sourceFull, nextSource);
  }
  if (nextMirror !== originalMirror) {
    changed.push(mirrorPath);
    if (!CHECK_ONLY) writeFileSync(mirrorFull, nextMirror);
  }
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
      : `docs:i18n:stamp — updated ${changed.length} file(s). Run \`bun run format\`.`
  );
}
