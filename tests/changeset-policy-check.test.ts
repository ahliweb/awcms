import { describe, expect, test } from "bun:test";

import {
  evaluateChangesetPolicy,
  validateChangesetFrontmatter
} from "../scripts/changeset-policy-check";

describe("evaluateChangesetPolicy", () => {
  test("docs-only PR does not require a changeset (matches PR #595 precedent)", () => {
    const result = evaluateChangesetPolicy([
      "docs/awcms/github/issues-open-001.md",
      "docs/awcms/github/README.md"
    ]);

    expect(result.requiresChangeset).toBe(false);
    expect(result.violation).toBeNull();
  });

  test("docs + .claude skill-only PR does not require a changeset (matches PR #585 precedent)", () => {
    const result = evaluateChangesetPolicy([
      ".claude/skills/awcms-github-snapshot/SKILL.md",
      "docs/awcms/github/security.md"
    ]);

    expect(result.requiresChangeset).toBe(false);
    expect(result.violation).toBeNull();
  });

  test("root markdown file (AGENTS.md) alone is exempt", () => {
    const result = evaluateChangesetPolicy(["AGENTS.md", "CHANGELOG.md"]);

    expect(result.requiresChangeset).toBe(false);
  });

  test("workflow-only change requires a changeset when none is added", () => {
    const result = evaluateChangesetPolicy([".github/workflows/ci.yml"]);

    expect(result.requiresChangeset).toBe(true);
    expect(result.changesetFilesAdded).toEqual([]);
    expect(result.violation).not.toBeNull();
    expect(result.violation).toContain(".github/workflows/ci.yml");
  });

  test("source change with a new changeset file passes", () => {
    const result = evaluateChangesetPolicy([
      "src/modules/blog-content/module.ts",
      ".changeset/some-feature.md"
    ]);

    expect(result.requiresChangeset).toBe(true);
    expect(result.changesetFilesAdded).toEqual([".changeset/some-feature.md"]);
    expect(result.violation).toBeNull();
  });

  test("adding only .changeset/README.md does not count as a real changeset", () => {
    const result = evaluateChangesetPolicy([
      "scripts/db-migrate.ts",
      ".changeset/README.md"
    ]);

    expect(result.requiresChangeset).toBe(true);
    expect(result.changesetFilesAdded).toEqual([]);
    expect(result.violation).not.toBeNull();
  });

  test("test-only changes are not exempt (deliberately strict default)", () => {
    const result = evaluateChangesetPolicy(["tests/unit/some-new.test.ts"]);

    expect(result.requiresChangeset).toBe(true);
    expect(result.violation).not.toBeNull();
  });

  test("mixed docs + source change requires a changeset covering the whole PR", () => {
    const result = evaluateChangesetPolicy([
      "docs/awcms/09_roadmap_repository_commit.md",
      "src/lib/config/registry.ts"
    ]);

    expect(result.requiresChangeset).toBe(true);
    expect(result.nonExemptFiles).toEqual(["src/lib/config/registry.ts"]);
  });

  test("release-consumption commit (package.json version-only + deleted changesets) does not require a new changeset", () => {
    const result = evaluateChangesetPolicy(
      [
        "package.json",
        "CHANGELOG.md",
        ".changeset/foo.md",
        ".changeset/bar.md"
      ],
      [".changeset/foo.md", ".changeset/bar.md"],
      true
    );

    expect(result.requiresChangeset).toBe(true);
    expect(result.isReleaseConsumption).toBe(true);
    expect(result.violation).toBeNull();
    expect(result.changesetFilesAdded).toEqual([]);
    expect(result.changesetFilesDeleted).toEqual([
      ".changeset/foo.md",
      ".changeset/bar.md"
    ]);
  });

  test("SECURITY (Issue #810 follow-up): deleting an existing changeset instead of adding one still requires a changeset when other non-exempt files changed", () => {
    // Reproduces the security-auditor's PR #811 Critical finding: a PR
    // that makes a real source change and deletes (rather than adds) a
    // changeset must NOT be treated as satisfying the policy.
    const result = evaluateChangesetPolicy(
      ["src/a.ts", ".changeset/existing-real.md"],
      [".changeset/existing-real.md"],
      false
    );

    expect(result.requiresChangeset).toBe(true);
    expect(result.isReleaseConsumption).toBe(false);
    expect(result.changesetFilesAdded).toEqual([]);
    expect(result.changesetFilesDeleted).toEqual([
      ".changeset/existing-real.md"
    ]);
    expect(result.violation).not.toBeNull();
  });

  test("package.json changed but NOT version-only (e.g. a script/dependency edit) is never treated as release-consumption, even with a deleted changeset", () => {
    const result = evaluateChangesetPolicy(
      ["package.json", ".changeset/existing-real.md"],
      [".changeset/existing-real.md"],
      false // isPackageJsonVersionOnlyChange computed false by the caller
    );

    expect(result.requiresChangeset).toBe(true);
    expect(result.isReleaseConsumption).toBe(false);
    expect(result.violation).not.toBeNull();
  });

  test("package.json version-only change with NO deleted changeset is not release-consumption (no real consumption happened)", () => {
    const result = evaluateChangesetPolicy(["package.json"], [], true);

    expect(result.requiresChangeset).toBe(true);
    expect(result.isReleaseConsumption).toBe(false);
    expect(result.violation).not.toBeNull();
  });

  test("release-consumption carve-out never applies when any OTHER non-exempt file is touched alongside package.json", () => {
    const result = evaluateChangesetPolicy(
      ["package.json", "src/a.ts", ".changeset/foo.md"],
      [".changeset/foo.md"],
      true
    );

    expect(result.requiresChangeset).toBe(true);
    expect(result.isReleaseConsumption).toBe(false);
    expect(result.violation).not.toBeNull();
  });
});

describe("validateChangesetFrontmatter", () => {
  test("accepts a well-formed changeset", () => {
    const content = ["---", '"awcms": minor', "---", "", "Add a feature."].join(
      "\n"
    );

    expect(validateChangesetFrontmatter(content)).toEqual({ ok: true });
  });

  test("accepts unquoted package name and patch bump", () => {
    const content = ["---", "awcms: patch", "---", "", "Fix a bug."].join("\n");

    expect(validateChangesetFrontmatter(content).ok).toBe(true);
  });

  test("rejects missing frontmatter", () => {
    const result = validateChangesetFrontmatter(
      "Just a description, no frontmatter."
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("frontmatter");
  });

  test("rejects wrong package name", () => {
    const content = ["---", '"some-other-package": minor', "---", ""].join(
      "\n"
    );

    const result = validateChangesetFrontmatter(content);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("awcms");
  });

  test("rejects invalid bump level", () => {
    const content = ["---", '"awcms": banana', "---", ""].join("\n");

    const result = validateChangesetFrontmatter(content);

    expect(result.ok).toBe(false);
  });
});
