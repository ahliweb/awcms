#!/usr/bin/env bun
/**
 * version:check — the `vX.Y.Z` model, checked at every commit instead of
 * only at tag-push time.
 *
 * ## Why a gate
 *
 * The model was already written down and already enforced — but only inside
 * `release.yml`'s `validate` job, by a step that runs *because* a tag was
 * pushed. That ordering is the problem. Every way of getting the version
 * wrong (a `package.json` bumped by hand to `9.2`, a prerelease suffix, a
 * CHANGELOG section that never got written) sat green through all 51 gates on
 * `main` and surfaced only after `git push origin vX.Y.Z` — at which point the
 * tag is public, and `release-process.md` §Yanking is explicit that the repo
 * does not force-push a corrected tag over a published one. The cheapest
 * failure was reachable only at the most expensive moment.
 *
 * The tag namespace shows what that costs. Six tags do not match the model —
 * `2.9.9`, `2.12.0`, `3.0.0`, `3.1.0`, `4.3.1`, `4.5.0` — and `3.0.0` sits on
 * commit `b23d3308` beside `v3.0.0`, the same release under two names. All six
 * predate the rebuild (ADR-0024), and every one of the 15 tags cut since
 * (`v5.1.0`, 2026-07-16 onward) conforms. So the model has in fact been
 * followed perfectly for a year — this gate is what turns that from a streak
 * into an invariant.
 *
 * ## What is deliberately NOT checked
 *
 * **"Every CHANGELOG version has a tag."** `5.0.0` and `0.2.0` have sections
 * and no tag, correctly: ADR-0024 §4 records that `5.0.0` was a number in
 * `package.json` only, never published, because `release.yml` did not exist
 * yet.
 *
 * **"Every tag has a CHANGELOG section."** `v3.0.0`–`v4.6.0` have none. They
 * are pre-rebuild legacy releases of a codebase that no longer exists on
 * `main`; the CHANGELOG deliberately starts after them.
 *
 * Both would be red on arrival for reasons that are history, not drift. A gate
 * whose first act is to demand a `--force` flag teaches everyone to pass one.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { REPO_ROOT } from "./lib/repo-files";
import {
  parseReleaseVersion,
  parseVersionFromTag,
  compareReleaseVersions,
  isReleaseTag,
  releaseTagFor,
  type ReleaseVersion
} from "./lib/semver";

export type Problem = { rule: string; message: string };

/**
 * Tags that predate the rebuild (ADR-0024) and are exempt from the `vX.Y.Z`
 * model because they were cut by the legacy codebase's tooling, before this
 * repo existed in its current form.
 *
 * Listed by exact name rather than by a date cutoff on purpose: a date
 * boundary is re-derived from tag metadata, which a re-tag or a mirror push
 * can change, and would silently widen the exemption. This list cannot widen
 * without someone editing it.
 *
 * It is closed. Nothing may be added — a new non-conforming tag is the defect
 * this gate exists to report.
 */
export const LEGACY_UNPREFIXED_TAGS: readonly string[] = [
  "2.9.9",
  "2.12.0",
  "3.0.0",
  "3.1.0",
  "4.3.1",
  "4.5.0"
];

/** Frontmatter bump levels a changeset may declare for this single-package repo. */
const VALID_BUMPS = new Set(["major", "minor", "patch"]);
const CHANGESET_PACKAGE_NAME = "awcms";

// ---------------------------------------------------------------------------
// Rule 1 — package.json carries a release version
// ---------------------------------------------------------------------------

export function checkPackageVersion(packageVersion: string): Problem | null {
  if (parseReleaseVersion(packageVersion)) return null;
  return {
    rule: "package-version",
    message:
      `package.json version "${packageVersion}" is not an X.Y.Z release version. ` +
      `This repo releases X.Y.Z only — no prerelease suffix, no build metadata, ` +
      `no leading zeros, no "v" prefix (the "v" belongs to the git tag).`
  };
}

// ---------------------------------------------------------------------------
// Rules 2 + 3 — the CHANGELOG agrees with package.json, and is ordered
// ---------------------------------------------------------------------------

export type ChangelogHeading = {
  /** The raw heading text after `## `, e.g. `9.1.2` or `[9.1.2]`. */
  raw: string;
  /** Line number (1-indexed) for a message that points somewhere. */
  line: number;
};

/** Every `## ` heading in the changelog, in document order (newest first). */
export function changelogHeadings(
  changelogContent: string
): ChangelogHeading[] {
  const headings: ChangelogHeading[] = [];
  const lines = changelogContent.split("\n");
  for (const [index, line] of lines.entries()) {
    const match = line.match(/^##\s+(.+?)\s*$/);
    if (match) headings.push({ raw: match[1]!, line: index + 1 });
  }
  return headings;
}

/** `[9.1.2]` and `9.1.2` both denote version `9.1.2`. */
function versionOfHeading(raw: string): string {
  return raw.replace(/^\[/, "").replace(/\]$/, "");
}

/**
 * Every `## ` heading must be a release version, they must be strictly
 * descending, and the newest must be what `package.json` says the repo is.
 *
 * The ordering rule is not hypothetical bookkeeping: `release.yml` extracts
 * release notes with an awk range that starts at the matching `## ` heading
 * and stops at the NEXT `## `. A heading out of order, or a stray
 * `## Unreleased`, silently changes which text a published GitHub Release
 * carries — after signing and attestation have already succeeded.
 */
export function checkChangelog(
  changelogContent: string,
  packageVersion: string
): Problem[] {
  const problems: Problem[] = [];
  const headings = changelogHeadings(changelogContent);

  if (headings.length === 0) {
    return [
      {
        rule: "changelog-headings",
        message: "CHANGELOG.md has no `## ` version headings at all."
      }
    ];
  }

  const parsed: { version: string; fields: ReleaseVersion; line: number }[] =
    [];
  for (const heading of headings) {
    const version = versionOfHeading(heading.raw);
    const fields = parseReleaseVersion(version);
    if (!fields) {
      problems.push({
        rule: "changelog-headings",
        message:
          `CHANGELOG.md:${heading.line} heading "## ${heading.raw}" is not an ` +
          `X.Y.Z release version. Every \`## \` heading in this file is a ` +
          `release section — release.yml slices the notes between them.`
      });
      continue;
    }
    parsed.push({ version, fields, line: heading.line });
  }

  for (let i = 1; i < parsed.length; i += 1) {
    const newer = parsed[i - 1]!;
    const older = parsed[i]!;
    const order = compareReleaseVersions(newer.fields, older.fields);
    if (order === 0) {
      problems.push({
        rule: "changelog-order",
        message:
          `CHANGELOG.md has two sections for ${newer.version} ` +
          `(lines ${newer.line} and ${older.line}).`
      });
    } else if (order < 0) {
      problems.push({
        rule: "changelog-order",
        message:
          `CHANGELOG.md:${older.line} — ${older.version} appears BELOW ` +
          `${newer.version} (line ${newer.line}), but sections must run ` +
          `newest to oldest.`
      });
    }
  }

  const newest = parsed[0];
  if (newest && newest.version !== packageVersion) {
    problems.push({
      rule: "changelog-newest",
      message:
        `CHANGELOG.md's newest section is ${newest.version} but package.json ` +
        `says ${packageVersion}. Run \`bun run changeset:version\`, which ` +
        `writes both together.`
    });
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Rule 4 — the tag namespace holds only vX.Y.Z
// ---------------------------------------------------------------------------

export type TagCheckResult = {
  problems: Problem[];
  /** Tags actually examined. Zero means the rule could not run — see `enforced`. */
  examined: number;
  /**
   * False when no tags were visible. A shallow checkout without
   * `fetch-tags: true` fetches none, and a rule that reports "OK, 0 tags
   * checked" is indistinguishable from a rule that passed.
   */
  enforced: boolean;
};

export function checkTagNamespace(tags: readonly string[]): TagCheckResult {
  const problems: Problem[] = [];
  const legacy = new Set(LEGACY_UNPREFIXED_TAGS);

  for (const tag of tags) {
    if (isReleaseTag(tag)) continue;
    if (legacy.has(tag)) continue;
    problems.push({
      rule: "tag-namespace",
      message:
        `Tag "${tag}" does not match the vX.Y.Z model. Release tags are ` +
        `created as \`git tag -a v<version> -m "v<version>"\`; see ` +
        `docs/awcms/release-process.md §Cutting a release.`
    });
  }

  return { problems, examined: tags.length, enforced: tags.length > 0 };
}

/**
 * `package.json` must never sit BELOW the newest published tag.
 *
 * Equal is the normal resting state: between releases `main` carries the last
 * released version while changesets pile up in `.changeset/`, and
 * `changeset version` moves it ahead only when a release is cut. So "already
 * tagged" is not a defect — the first draft of this rule said it was, and was
 * red on arrival against a perfectly healthy repo.
 *
 * Behind is the defect. A revert or a bad merge that drops `package.json` to
 * 9.1.1 while `v9.1.2` is published leaves the repo claiming to be a version
 * whose bytes are already public and different. From there `changeset version`
 * recomputes the NEXT version from the wrong base and would re-issue a number
 * that is already taken — the exact re-release `release-process.md` §Yanking
 * forbids, arrived at without anyone deciding to.
 */
export function checkVersionNotBehindTags(
  packageVersion: string,
  tags: readonly string[]
): Problem | null {
  const current = parseReleaseVersion(packageVersion);
  if (!current) return null;

  let newest: { version: string; fields: ReleaseVersion } | null = null;
  for (const tag of tags) {
    const version = parseVersionFromTag(tag);
    if (!version) continue;
    const fields = parseReleaseVersion(version)!;
    if (!newest || compareReleaseVersions(fields, newest.fields) > 0) {
      newest = { version, fields };
    }
  }
  if (!newest) return null;

  if (compareReleaseVersions(current, newest.fields) >= 0) return null;
  return {
    rule: "version-behind-tags",
    message:
      `package.json is at ${packageVersion}, BEHIND the newest published tag ` +
      `${releaseTagFor(newest.version)}. Those bytes are already public; ` +
      `bumping from here would re-issue a version number that is taken.`
  };
}

/** `git tag --list`, or null when git/tags are unavailable. */
export function readGitTags(root: string = REPO_ROOT): string[] | null {
  try {
    const output = execFileSync("git", ["tag", "--list"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Rule 5 — the loose release trigger stays backstopped
// ---------------------------------------------------------------------------

/**
 * `release.yml` fires on the glob `v*.*.*`, which is looser than the model:
 * it also matches `v1.2.3-rc.1`, `v9.1.2.3`, and `vfoo.bar.baz`. That is fine
 * — and ONLY fine — because `release:verify` runs inside `validate` and
 * rejects anything the model does not admit.
 *
 * The glob cannot be tightened (GitHub tag filters are globs, not regexes), so
 * the backstop is load-bearing. Removing the `release:verify` step while
 * leaving the glob in place would turn a prerelease tag into a published
 * release, signed and attested. This rule binds the two halves together.
 */
export function checkReleaseTriggerBackstop(workflowYaml: string): Problem[] {
  const problems: Problem[] = [];

  if (!/^\s*-\s*["']v\*\.\*\.\*["']\s*$/m.test(workflowYaml)) {
    problems.push({
      rule: "release-trigger",
      message:
        'release.yml no longer declares the tag trigger `- "v*.*.*"`. If the ' +
        "trigger moved, this gate's assumption about what can reach the " +
        "publish path moved with it."
    });
  }

  if (!/bun run release:verify/.test(workflowYaml)) {
    problems.push({
      rule: "release-backstop",
      message:
        "release.yml's `v*.*.*` trigger matches tags the vX.Y.Z model rejects " +
        "(`v1.2.3-rc.1`, `v9.1.2.3`), and `bun run release:verify` — the only " +
        "thing that rejects them — is gone. A prerelease tag would publish."
    });
  }

  if (!/RELEASE_VERIFY_TAG/.test(workflowYaml)) {
    problems.push({
      rule: "release-backstop",
      message:
        "release.yml no longer passes `RELEASE_VERIFY_TAG`, so release:verify " +
        "falls back to `git describe` and validates a tag nobody chose."
    });
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Rule 6 — pending changesets declare a bump the model understands
// ---------------------------------------------------------------------------

/**
 * `changesets:policy:check` validates frontmatter too, but only for files a
 * PR ADDS, against `origin/main`. A changeset edited after it landed, or one
 * added on a branch that never opened a PR, is checked by nothing. This reads
 * whatever is sitting in `.changeset/` right now, with no git required.
 */
export function checkPendingChangesets(
  entries: readonly { name: string; content: string }[]
): Problem[] {
  const problems: Problem[] = [];
  for (const entry of entries) {
    const match = entry.content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) {
      problems.push({
        rule: "changeset-frontmatter",
        message: `.changeset/${entry.name} has no YAML frontmatter (--- ... ---).`
      });
      continue;
    }
    const line = match[1]!.match(/^["']?([\w.-]+)["']?\s*:\s*([\w]+)\s*$/m);
    if (!line) {
      problems.push({
        rule: "changeset-frontmatter",
        message:
          `.changeset/${entry.name} frontmatter needs a line ` +
          `"${CHANGESET_PACKAGE_NAME}": <major|minor|patch>.`
      });
      continue;
    }
    const [, packageName, bump] = line as unknown as [string, string, string];
    if (packageName !== CHANGESET_PACKAGE_NAME) {
      problems.push({
        rule: "changeset-frontmatter",
        message:
          `.changeset/${entry.name} declares package "${packageName}" — this ` +
          `repo is single-package, the only valid name is "${CHANGESET_PACKAGE_NAME}".`
      });
      continue;
    }
    if (!VALID_BUMPS.has(bump)) {
      problems.push({
        rule: "changeset-frontmatter",
        message:
          `.changeset/${entry.name} declares bump "${bump}" — must be one of ` +
          `major, minor, patch.`
      });
    }
  }
  return problems;
}

/** Changeset files sitting in `.changeset/`, excluding its own config/README. */
export function readPendingChangesets(
  root: string = REPO_ROOT
): { name: string; content: string }[] {
  const dir = path.join(root, ".changeset");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .sort()
    .map((name) => ({
      name,
      content: readFileSync(path.join(dir, name), "utf8")
    }));
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const problems: Problem[] = [];
  const notes: string[] = [];

  const packageJson = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")
  ) as { version: string };
  const packageVersion = packageJson.version;

  const versionProblem = checkPackageVersion(packageVersion);
  if (versionProblem) problems.push(versionProblem);

  const changelog = readFileSync(path.join(REPO_ROOT, "CHANGELOG.md"), "utf8");
  problems.push(...checkChangelog(changelog, packageVersion));

  const tags = readGitTags();
  if (tags === null || tags.length === 0) {
    notes.push(
      "tag namespace UNENFORCED — no git tags visible. A shallow checkout " +
        "fetches none; `.github/workflows/ci.yml` sets `fetch-tags: true` so " +
        "this rule really runs in CI (bound by tests/version-check.test.ts)."
    );
  } else {
    const tagResult = checkTagNamespace(tags);
    problems.push(...tagResult.problems);
    const behind = checkVersionNotBehindTags(packageVersion, tags);
    if (behind) problems.push(behind);
    notes.push(
      `tag namespace: ${tagResult.examined} tags checked, ` +
        `${LEGACY_UNPREFIXED_TAGS.length} pre-rebuild legacy exemptions (ADR-0024).`
    );
  }

  const releaseWorkflow = path.join(REPO_ROOT, ".github/workflows/release.yml");
  if (existsSync(releaseWorkflow)) {
    problems.push(
      ...checkReleaseTriggerBackstop(readFileSync(releaseWorkflow, "utf8"))
    );
  } else {
    problems.push({
      rule: "release-trigger",
      message: ".github/workflows/release.yml is missing."
    });
  }

  const pending = readPendingChangesets();
  problems.push(...checkPendingChangesets(pending));
  notes.push(
    `${pending.length} pending changeset${pending.length === 1 ? "" : "s"} in .changeset/.`
  );

  for (const note of notes) console.log(`version:check — ${note}`);

  if (problems.length > 0) {
    console.error(`\nversion:check FAILED — ${problems.length} problem(s):`);
    for (const problem of problems) {
      console.error(`  [${problem.rule}] ${problem.message}`);
    }
    process.exit(1);
  }

  console.log(
    `\nversion:check OK — package.json ${packageVersion}, tag would be ` +
      `${releaseTagFor(packageVersion)}, CHANGELOG newest section matches, ` +
      `tag namespace conforms to vX.Y.Z.`
  );
}
