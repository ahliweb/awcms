/**
 * release-verify-checks.ts — logika murni untuk `release:verify`
 * (docs/awcms/release-process.md §`validate` job, real release only).
 *
 * Memastikan tag rilis yang di-push konsisten dengan state repo sebelum
 * `build`/`sign-attest-publish` job berjalan: versi tag == package.json,
 * CHANGELOG.md punya section untuk versi itu, dan tidak ada changeset yang
 * belum dikonsumsi tersisa di `.changeset/`.
 */

export type Problem = { message: string };

const TAG_PATTERN = /^v(\d+\.\d+\.\d+)$/;

/**
 * @param tag mis. `v5.0.0`
 * @returns versi tanpa prefix `v` (mis. `5.0.0`), atau null bila tag tidak
 *   cocok pola `vX.Y.Z`.
 */
export function parseVersionFromTag(tag: string): string | null {
  const match = tag.trim().match(TAG_PATTERN);
  return match ? match[1]! : null;
}

/**
 * @param tagVersion versi hasil `parseVersionFromTag` (tanpa prefix `v`)
 * @param packageVersion `package.json`'s `version` field
 */
export function checkTagMatchesPackageVersion(
  tagVersion: string,
  packageVersion: string
): Problem | null {
  if (tagVersion !== packageVersion) {
    return {
      message: `Versi tag (${tagVersion}) tidak cocok dengan package.json (${packageVersion}) — jalankan bun run changeset:version dan tag ulang versi yang benar.`
    };
  }
  return null;
}

/**
 * CHANGELOG.md yang dihasilkan `changeset version` memakai heading
 * `## X.Y.Z` (tanpa bracket) — pola ini juga menerima `## [X.Y.Z]` untuk
 * entry yang ditulis/diedit manual (lihat CHANGELOG.md's section `## 5.0.0`,
 * ditulis manual untuk lompatan versi ADR-0024).
 * @param changelogContent isi CHANGELOG.md
 * @param version mis. `5.0.0`
 */
export function checkChangelogHasSection(
  changelogContent: string,
  version: string
): Problem | null {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^##\\s+\\[?${escaped}\\]?\\s*$`, "m");
  if (!pattern.test(changelogContent)) {
    return {
      message: `CHANGELOG.md tidak punya section "## ${version}" — tambahkan entry rilis ini sebelum tagging (lihat CHANGELOG.md's format yang sudah ada).`
    };
  }
  return null;
}

/**
 * @param changesetFileNames nama file (bukan path) di `.changeset/`, hasil
 *   listing direktori — README.md dan config.json TIDAK termasuk changeset
 *   pending (filter dilakukan pemanggil atau di sini via nama).
 */
export function checkNoPendingChangesets(
  changesetFileNames: string[]
): Problem | null {
  const pending = changesetFileNames.filter(
    (name) => name.endsWith(".md") && name !== "README.md"
  );
  if (pending.length > 0) {
    return {
      message: `${pending.length} changeset belum dikonsumsi tersisa di .changeset/ (${pending.join(", ")}) — jalankan bun run changeset:version sebelum tagging.`
    };
  }
  return null;
}
