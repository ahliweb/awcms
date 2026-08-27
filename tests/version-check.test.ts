/**
 * Unit tests for `version:check` (`scripts/version-check.ts`) and the shared
 * `vX.Y.Z` model it is built on (`scripts/lib/semver.ts`).
 *
 * Every case below is a defect SHAPE this repo can actually produce, not an
 * invented one:
 *
 *   - the six unprefixed tags that really are in this repo's history, and the
 *     seventh that must not be able to join them;
 *   - `3.0.0` and `v3.0.0` on one commit — the same release under two names;
 *   - `v1.2.3-rc.1`, which `release.yml`'s trigger glob `v*.*.*` DOES match,
 *     so only `release:verify` stands between it and a signed publish;
 *   - a CHANGELOG whose newest section lags `package.json`, the drift that
 *     `release:verify` used to catch only after the tag was already public.
 *
 * Two of these tests exist specifically to catch a gate that stops looking:
 * `enforced: false` on an empty tag list, and the CI-parity test binding
 * `fetch-tags: true` in `ci.yml`. A rule that examines nothing reports the
 * same "OK" as a rule that passed.
 */
import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  checkPackageVersion,
  checkChangelog,
  checkTagNamespace,
  checkVersionNotBehindTags,
  checkReleaseTriggerBackstop,
  checkPendingChangesets,
  changelogHeadings,
  readGitTags,
  readPendingChangesets,
  LEGACY_UNPREFIXED_TAGS
} from "../scripts/version-check.ts";
import {
  parseReleaseVersion,
  parseVersionFromTag,
  isReleaseTag,
  isReleaseVersion,
  releaseTagFor,
  compareReleaseVersions
} from "../scripts/lib/semver.ts";
import { REPO_ROOT } from "../scripts/lib/repo-files.ts";

// ---------------------------------------------------------------------------
// The shared model
// ---------------------------------------------------------------------------

describe("semver — the vX.Y.Z model", () => {
  test("accepts the release versions this repo actually ships", () => {
    for (const version of ["9.1.2", "0.2.0", "5.0.0", "10.0.0"]) {
      expect(isReleaseVersion(version)).toBe(true);
    }
  });

  test("rejects everything the model excludes", () => {
    for (const version of [
      "9.1", // truncated
      "9.1.2.3", // four fields
      "v9.1.2", // the `v` belongs to the TAG, never the version
      "9.1.2-rc.1", // prerelease — release.yml's glob matches its tag
      "9.1.2+build.5", // build metadata
      "09.1.2", // leading zero: same number, second spelling
      "9.01.2",
      "" // empty
    ]) {
      expect(isReleaseVersion(version)).toBe(false);
    }
  });

  test("a bare X.Y.Z is not a release TAG — that is the whole point", () => {
    expect(isReleaseTag("v9.1.2")).toBe(true);
    expect(isReleaseTag("9.1.2")).toBe(false);
    expect(parseVersionFromTag("v9.1.2")).toBe("9.1.2");
    expect(parseVersionFromTag("9.1.2")).toBeNull();
  });

  test("the old pattern's leading-zero hole is closed", () => {
    // `/^v(\d+\.\d+\.\d+)$/` — the pattern this replaced — returned "01.2.3".
    expect(parseVersionFromTag("v01.2.3")).toBeNull();
    expect(parseVersionFromTag("v1.02.3")).toBeNull();
  });

  test("ordering is numeric, not lexicographic", () => {
    const nine = parseReleaseVersion("9.1.2")!;
    const ten = parseReleaseVersion("10.0.0")!;
    // String comparison says "10.0.0" < "9.1.2". It is not.
    expect(compareReleaseVersions(ten, nine)).toBeGreaterThan(0);
    expect(compareReleaseVersions(nine, ten)).toBeLessThan(0);
    expect(compareReleaseVersions(nine, parseReleaseVersion("9.1.2")!)).toBe(0);
  });

  test("releaseTagFor is the only place the `v` is added, and it refuses junk", () => {
    expect(releaseTagFor("9.1.2")).toBe("v9.1.2");
    expect(() => releaseTagFor("9.1.2-rc.1")).toThrow();
    expect(() => releaseTagFor("v9.1.2")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Rule 1 — package.json
// ---------------------------------------------------------------------------

describe("checkPackageVersion", () => {
  test("passes a release version", () => {
    expect(checkPackageVersion("9.1.2")).toBeNull();
  });

  test("fails a prerelease, which the model does not ship", () => {
    const problem = checkPackageVersion("9.2.0-rc.1");
    expect(problem).not.toBeNull();
    expect(problem!.rule).toBe("package-version");
  });

  test("fails a hand-truncated version", () => {
    expect(checkPackageVersion("9.2")).not.toBeNull();
  });

  test("fails a version that smuggled the tag's `v` in", () => {
    expect(checkPackageVersion("v9.1.2")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rules 2 + 3 — CHANGELOG
// ---------------------------------------------------------------------------

const HEALTHY_CHANGELOG =
  "# awcms\n\n## 9.1.2\n\nnotes\n\n## 9.1.1\n\nnotes\n\n## 9.0.0\n\nnotes\n";

describe("checkChangelog", () => {
  test("passes a descending changelog whose newest matches package.json", () => {
    expect(checkChangelog(HEALTHY_CHANGELOG, "9.1.2")).toEqual([]);
  });

  test("fails when the newest section lags package.json", () => {
    // The real drift: `package.json` bumped, CHANGELOG section never written.
    // Previously invisible until the tag was pushed and public.
    const problems = checkChangelog(HEALTHY_CHANGELOG, "9.2.0");
    expect(problems).toHaveLength(1);
    expect(problems[0]!.rule).toBe("changelog-newest");
    expect(problems[0]!.message).toContain("9.2.0");
  });

  test("fails when sections are out of order", () => {
    const changelog = "# awcms\n\n## 9.0.0\n\nnotes\n\n## 9.1.0\n\nnotes\n";
    const problems = checkChangelog(changelog, "9.0.0");
    expect(problems.some((p) => p.rule === "changelog-order")).toBe(true);
  });

  test("does NOT call 10.0.0 out of order above 9.1.2", () => {
    // Lexicographic ordering would. This is the mutation that proves the
    // comparison is numeric.
    const changelog = "# awcms\n\n## 10.0.0\n\nnotes\n\n## 9.1.2\n\nnotes\n";
    expect(checkChangelog(changelog, "10.0.0")).toEqual([]);
  });

  test("fails on a duplicated section", () => {
    const changelog = "# awcms\n\n## 9.1.2\n\nnotes\n\n## 9.1.2\n\nnotes\n";
    const problems = checkChangelog(changelog, "9.1.2");
    expect(problems.some((p) => p.rule === "changelog-order")).toBe(true);
  });

  test("fails on a non-version heading such as `## Unreleased`", () => {
    // release.yml slices release notes BETWEEN `## ` headings; a stray one
    // silently changes what a published GitHub Release carries.
    const changelog = "# awcms\n\n## Unreleased\n\nwip\n\n## 9.1.2\n\nnotes\n";
    const problems = checkChangelog(changelog, "9.1.2");
    expect(problems.some((p) => p.rule === "changelog-headings")).toBe(true);
  });

  test("accepts the bracketed form used by hand-written sections", () => {
    const changelog = "# awcms\n\n## [5.0.0]\n\nthe ADR-0024 jump\n";
    expect(checkChangelog(changelog, "5.0.0")).toEqual([]);
  });

  test("changelogHeadings ignores the h1 and the prose", () => {
    const headings = changelogHeadings(HEALTHY_CHANGELOG);
    expect(headings.map((h) => h.raw)).toEqual(["9.1.2", "9.1.1", "9.0.0"]);
  });
});

// ---------------------------------------------------------------------------
// Rule 4 — the tag namespace
// ---------------------------------------------------------------------------

describe("checkTagNamespace", () => {
  test("the six pre-rebuild tags are exempt, and they are exactly these", () => {
    const result = checkTagNamespace(LEGACY_UNPREFIXED_TAGS);
    expect(result.problems).toEqual([]);
    expect(LEGACY_UNPREFIXED_TAGS).toEqual([
      "2.9.9",
      "2.12.0",
      "3.0.0",
      "3.1.0",
      "4.3.1",
      "4.5.0"
    ]);
  });

  test("a SEVENTH unprefixed tag is rejected — the exemption list is closed", () => {
    const result = checkTagNamespace([...LEGACY_UNPREFIXED_TAGS, "9.2.0"]);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]!.rule).toBe("tag-namespace");
    expect(result.problems[0]!.message).toContain("9.2.0");
  });

  test("a prerelease tag is rejected even though release.yml's glob matches it", () => {
    const result = checkTagNamespace(["v9.1.2", "v9.2.0-rc.1"]);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]!.message).toContain("v9.2.0-rc.1");
  });

  test("conforming tags pass", () => {
    const result = checkTagNamespace(["v5.1.0", "v9.1.2", "v10.0.0"]);
    expect(result.problems).toEqual([]);
    expect(result.enforced).toBe(true);
  });

  test("an empty tag list reports UNENFORCED, not OK", () => {
    // A shallow checkout fetches no tags. "0 problems" from 0 tags examined
    // must never read as a pass.
    const result = checkTagNamespace([]);
    expect(result.problems).toEqual([]);
    expect(result.enforced).toBe(false);
    expect(result.examined).toBe(0);
  });
});

describe("checkVersionNotBehindTags", () => {
  const tags = ["v9.1.0", "v9.1.1", "v9.1.2", "2.9.9"];

  test("equal to the newest tag is the normal resting state", () => {
    expect(checkVersionNotBehindTags("9.1.2", tags)).toBeNull();
  });

  test("ahead of the newest tag is a version bump awaiting its tag", () => {
    expect(checkVersionNotBehindTags("9.2.0", tags)).toBeNull();
  });

  test("behind the newest tag is the defect", () => {
    const problem = checkVersionNotBehindTags("9.1.1", tags);
    expect(problem).not.toBeNull();
    expect(problem!.rule).toBe("version-behind-tags");
    expect(problem!.message).toContain("v9.1.2");
  });

  test("unprefixed legacy tags do not count as the newest release", () => {
    // `4.5.0` is not a release tag under the model, so a repo at 3.0.0 is not
    // "behind" it. Only vX.Y.Z tags define the published frontier.
    expect(checkVersionNotBehindTags("3.0.0", ["4.5.0", "2.9.9"])).toBeNull();
  });

  test("numeric comparison, so 10.0.0 is not behind v9.1.2", () => {
    expect(checkVersionNotBehindTags("10.0.0", tags)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rule 5 — the release trigger stays backstopped
// ---------------------------------------------------------------------------

describe("checkReleaseTriggerBackstop", () => {
  const realWorkflow = readFileSync(
    path.join(REPO_ROOT, ".github/workflows/release.yml"),
    "utf8"
  );

  test("the real release.yml is backstopped", () => {
    expect(checkReleaseTriggerBackstop(realWorkflow)).toEqual([]);
  });

  test("removing release:verify is caught — the glob alone would publish a prerelease", () => {
    const broken = realWorkflow.replace("bun run release:verify", "true");
    const problems = checkReleaseTriggerBackstop(broken);
    expect(problems.some((p) => p.rule === "release-backstop")).toBe(true);
  });

  test("removing the RELEASE_VERIFY_TAG hand-off is caught", () => {
    const broken = realWorkflow.replaceAll(
      "RELEASE_VERIFY_TAG",
      "SOME_OTHER_VAR"
    );
    const problems = checkReleaseTriggerBackstop(broken);
    expect(problems.some((p) => p.rule === "release-backstop")).toBe(true);
  });

  test("removing the tag trigger is caught", () => {
    const broken = realWorkflow.replace('- "v*.*.*"', '- "release-*"');
    const problems = checkReleaseTriggerBackstop(broken);
    expect(problems.some((p) => p.rule === "release-trigger")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rule 6 — pending changesets
// ---------------------------------------------------------------------------

describe("checkPendingChangesets", () => {
  test("a valid changeset passes", () => {
    const entries = [
      { name: "a.md", content: '---\n"awcms": minor\n---\n\nSomething.\n' }
    ];
    expect(checkPendingChangesets(entries)).toEqual([]);
  });

  test("accepts the unquoted package name too", () => {
    const entries = [
      { name: "a.md", content: "---\nawcms: patch\n---\n\nx.\n" }
    ];
    expect(checkPendingChangesets(entries)).toEqual([]);
  });

  test("rejects an invalid bump level", () => {
    const entries = [
      { name: "a.md", content: '---\n"awcms": breaking\n---\n\nx.\n' }
    ];
    const problems = checkPendingChangesets(entries);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain("breaking");
  });

  test("rejects a foreign package name in this single-package repo", () => {
    const entries = [
      { name: "a.md", content: '---\n"awcms-astro": minor\n---\n\nx.\n' }
    ];
    expect(checkPendingChangesets(entries)).toHaveLength(1);
  });

  test("rejects a changeset with no frontmatter", () => {
    const entries = [
      { name: "a.md", content: "Just prose, no frontmatter.\n" }
    ];
    expect(checkPendingChangesets(entries)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// CI parity — the tag rule must not be structurally blind where it runs
// ---------------------------------------------------------------------------

describe("CI supplies the tags the namespace rule needs", () => {
  test("ci.yml's quality job checks out with fetch-tags", () => {
    // Without this, `bun run check` in CI sees zero tags and the namespace
    // rule reports UNENFORCED forever — green, and blind.
    const ci = readFileSync(
      path.join(REPO_ROOT, ".github/workflows/ci.yml"),
      "utf8"
    );
    expect(ci).toContain("fetch-tags: true");
  });

  test("release.yml checks out full history, which includes tags", () => {
    const release = readFileSync(
      path.join(REPO_ROOT, ".github/workflows/release.yml"),
      "utf8"
    );
    expect(release).toContain("fetch-depth: 0");
  });
});

// ---------------------------------------------------------------------------
// Non-vacuous guard — the rules, against the real repo
// ---------------------------------------------------------------------------

describe("the real repo satisfies every rule", () => {
  const packageJson = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")
  ) as { version: string };

  test("package.json version is a release version", () => {
    expect(checkPackageVersion(packageJson.version)).toBeNull();
  });

  test("CHANGELOG.md is ordered and agrees with package.json", () => {
    const changelog = readFileSync(
      path.join(REPO_ROOT, "CHANGELOG.md"),
      "utf8"
    );
    expect(checkChangelog(changelog, packageJson.version)).toEqual([]);
    // Non-vacuous: if the heading scan silently stopped finding anything,
    // the rule above would pass on an empty list.
    expect(changelogHeadings(changelog).length).toBeGreaterThan(10);
  });

  test("the committed tag namespace conforms", () => {
    const tags = readGitTags();
    if (tags === null || tags.length === 0) return; // no git / no tags here
    const result = checkTagNamespace(tags);
    expect(result.problems).toEqual([]);
    expect(result.examined).toBeGreaterThan(20);
    expect(checkVersionNotBehindTags(packageJson.version, tags)).toBeNull();
  });

  test("every pending changeset has valid frontmatter", () => {
    // No non-vacuity guard on the LIVE count here, and that is the point. The
    // first draft asserted `pending.length > 0`, which is true on every commit
    // except the one that matters: a release consumes every changeset, so
    // `.changeset/` is legitimately empty and the guard turned the release
    // commit into a red suite. It had never fired because this test was added
    // AFTER v9.1.2 and the next release was v10.0.0 — the first time it was
    // ever asked the question.
    expect(checkPendingChangesets(readPendingChangesets())).toEqual([]);
  });

  test("the reader finds changesets and skips its own README", () => {
    // Non-vacuity belongs on the READER, against a planted directory, rather
    // than on whatever the repo happens to hold today.
    const root = mkdtempSync(path.join(tmpdir(), "awcms-changesets-"));
    mkdirSync(path.join(root, ".changeset"));
    writeFileSync(
      path.join(root, ".changeset", "README.md"),
      "# Changesets\n\nnot a changeset\n"
    );
    writeFileSync(
      path.join(root, ".changeset", "a-real-one.md"),
      '---\n"awcms": patch\n---\n\nfix(x): something\n'
    );

    const pending = readPendingChangesets(root);

    expect(pending.map((entry) => entry.name)).toEqual(["a-real-one.md"]);
    expect(checkPendingChangesets(pending)).toEqual([]);

    rmSync(root, { recursive: true, force: true });
  });

  test("an empty `.changeset/` is a release, not a failure", () => {
    const root = mkdtempSync(path.join(tmpdir(), "awcms-changesets-empty-"));
    mkdirSync(path.join(root, ".changeset"));
    writeFileSync(path.join(root, ".changeset", "README.md"), "# Changesets\n");

    expect(readPendingChangesets(root)).toEqual([]);
    expect(checkPendingChangesets([])).toEqual([]);

    rmSync(root, { recursive: true, force: true });
  });
});
