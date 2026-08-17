/**
 * Unit test untuk logika murni `release:verify`
 * (`scripts/lib/release-verify-checks.ts`). Dijalankan dengan `bun test`.
 */
import { describe, expect, test } from "bun:test";
import {
  parseVersionFromTag,
  checkTagMatchesPackageVersion,
  checkChangelogHasSection,
  checkNoPendingChangesets,
  selectReleaseTag
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

describe("selectReleaseTag", () => {
  /**
   * Mempersempit union `{tag} | {error}` dan GAGAL keras bila ternyata sebuah
   * tag terpilih — supaya "seharusnya error" tidak lolos diam-diam sebagai
   * `undefined.toContain(...)`.
   * @param {{ tag: string } | { error: string }} result
   * @returns {string}
   */
  function errorOf(result) {
    if (!("error" in result)) {
      throw new Error(`Diharapkan error, malah terpilih tag ${result.tag}.`);
    }
    return result.error;
  }

  test("memilih satu-satunya tag rilis", () => {
    const result = selectReleaseTag(["v9.1.2"]);
    expect(result).toEqual({ tag: "v9.1.2" });
  });

  test("commit bertag ganda `3.0.0` + `v3.0.0` resolve deterministik ke v3.0.0", () => {
    // Kasus nyata: commit b23d3308. `git describe --tags --exact-match`
    // memilih menurut urutan internal git; filter ini memilih menurut model.
    expect(selectReleaseTag(["3.0.0", "v3.0.0"])).toEqual({ tag: "v3.0.0" });
    // Urutan masukan tidak boleh mengubah hasil.
    expect(selectReleaseTag(["v3.0.0", "3.0.0"])).toEqual({ tag: "v3.0.0" });
  });

  test("tag non-rilis diabaikan, bukan dipilih", () => {
    expect(selectReleaseTag(["dryrun-abc123", "v8.1.0"])).toEqual({
      tag: "v8.1.0"
    });
  });

  test("error menyebut tag yang ADA ketika tak satu pun berpola vX.Y.Z", () => {
    const message = errorOf(selectReleaseTag(["3.0.0", "nightly"]));
    expect(message).toContain("3.0.0");
    expect(message).toContain("nightly");
  });

  test("error ketika HEAD tidak memikul tag apa pun", () => {
    expect(errorOf(selectReleaseTag([]))).toContain(
      "tidak memikul tag apa pun"
    );
  });

  test("dua tag rilis pada satu commit menuntut keputusan eksplisit", () => {
    // Ambigu SEBENARNYA — bukan sesuatu yang boleh ditebak diam-diam.
    const message = errorOf(selectReleaseTag(["v9.1.2", "v9.2.0"]));
    expect(message).toContain("RELEASE_VERIFY_TAG");
  });
});
