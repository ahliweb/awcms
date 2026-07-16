/**
 * Unit test untuk logika murni `release:verify`
 * (`scripts/lib/release-verify-checks.ts`). Dijalankan dengan `bun test`.
 */
import { describe, expect, test } from "bun:test";
import {
  parseVersionFromTag,
  checkTagMatchesPackageVersion,
  checkChangelogHasSection,
  checkNoPendingChangesets
} from "../scripts/lib/release-verify-checks.ts";

describe("parseVersionFromTag", () => {
  test("mengekstrak versi dari tag vX.Y.Z", () => {
    expect(parseVersionFromTag("v5.0.0")).toBe("5.0.0");
    expect(parseVersionFromTag("v0.2.1")).toBe("0.2.1");
  });

  test("null untuk tag yang tidak cocok pola", () => {
    expect(parseVersionFromTag("5.0.0")).toBeNull();
    expect(parseVersionFromTag("v5.0")).toBeNull();
    expect(parseVersionFromTag("dryrun-abc123")).toBeNull();
    expect(parseVersionFromTag("v5.0.0-rc.1")).toBeNull();
  });
});

describe("checkTagMatchesPackageVersion", () => {
  test("null bila cocok", () => {
    expect(checkTagMatchesPackageVersion("5.0.0", "5.0.0")).toBeNull();
  });

  test("melapor bila tidak cocok", () => {
    const problem = checkTagMatchesPackageVersion("5.0.0", "5.0.1");
    expect(problem).not.toBeNull();
    expect(problem?.message).toContain("5.0.0");
    expect(problem?.message).toContain("5.0.1");
  });
});

describe("checkChangelogHasSection", () => {
  test("null bila section tanpa bracket ada (format changesets asli)", () => {
    const changelog = "# awcms\n\n## 5.0.0\n\nSome notes.\n\n## 0.2.0\n";
    expect(checkChangelogHasSection(changelog, "5.0.0")).toBeNull();
  });

  test("null bila section dengan bracket ada (format manual)", () => {
    const changelog = "# awcms\n\n## [5.0.0]\n\nSome notes.\n";
    expect(checkChangelogHasSection(changelog, "5.0.0")).toBeNull();
  });

  test("melapor bila section tidak ada", () => {
    const changelog = "# awcms\n\n## 0.2.0\n";
    const problem = checkChangelogHasSection(changelog, "5.0.0");
    expect(problem).not.toBeNull();
    expect(problem?.message).toContain("5.0.0");
  });

  test("tidak salah cocok versi lain sebagai prefix (mis. 5.0.0 vs 5.0.0-beta)", () => {
    const changelog = "# awcms\n\n## 5.0.0-beta\n";
    const problem = checkChangelogHasSection(changelog, "5.0.0");
    expect(problem).not.toBeNull();
  });
});

describe("checkNoPendingChangesets", () => {
  test("null bila hanya README.md tersisa", () => {
    expect(checkNoPendingChangesets(["README.md"])).toBeNull();
  });

  test("null bila direktori kosong", () => {
    expect(checkNoPendingChangesets([])).toBeNull();
  });

  test("melapor changeset pending, README.md diabaikan", () => {
    const problem = checkNoPendingChangesets(["README.md", "fix-something.md"]);
    expect(problem).not.toBeNull();
    expect(problem?.message).toContain("fix-something.md");
    expect(problem?.message).not.toContain("README.md,");
  });

  test("mengabaikan berkas non-.md (mis. config.json bila ikut ter-list)", () => {
    expect(checkNoPendingChangesets(["config.json", "README.md"])).toBeNull();
  });
});
