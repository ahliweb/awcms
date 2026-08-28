/**
 * release-verify-checks.ts — logika murni untuk `release:verify`
 * (docs/awcms/release-process.md §`validate` job, real release only).
 *
 * Memastikan tag rilis yang di-push konsisten dengan state repo sebelum
 * `build`/`sign-attest-publish` job berjalan: versi tag == package.json,
 * CHANGELOG.md punya section untuk versi itu, dan tidak ada changeset yang
 * belum dikonsumsi tersisa di `.changeset/`.
 */

import {
  compareReleaseVersions,
  isReleaseTag,
  parseReleaseVersion,
  parseVersionFromTag
} from "./semver";

export type Problem = { message: string };

/**
 * Re-exported from `scripts/lib/semver.ts`, which owns the `vX.Y.Z` model for
 * the whole repo (`version:check` enforces the same definition at every
 * commit, not just at tag-push time). The pattern used to live here as a
 * private `/^v(\d+\.\d+\.\d+)$/`, which admitted `v01.2.3` — SemVer §2 forbids
 * leading zeros exactly because `01.2.3` and `1.2.3` read as one release under
 * two names, and this repo already carries a same-commit tag pair (`3.0.0` +
 * `v3.0.0`) showing what that looks like.
 */
export { parseVersionFromTag } from "./semver";

/**
 * Memilih SATU tag rilis dari daftar tag yang menunjuk sebuah commit.
 *
 * Ini menggantikan `git describe --tags --exact-match HEAD`, yang tidak
 * deterministik pada commit bertag ganda. Kasusnya nyata di repo ini: commit
 * `b23d3308` memikul `3.0.0` DAN `v3.0.0` — satu rilis, dua nama — sehingga
 * `describe` memilih menurut urutan internal git, bukan menurut model. Bila
 * yang terpilih `3.0.0`, release:verify gagal dengan "tidak cocok pola
 * vX.Y.Z" sambil menyebut tag yang tidak dipilih siapa pun, dan penyebab
 * sebenarnya (ada tag kedua) tidak muncul di pesan mana pun.
 *
 * @param pointingTags nama tag yang menunjuk commit tersebut
 */
export function selectReleaseTag(
  pointingTags: readonly string[]
): { tag: string } | { error: string } {
  const releaseTags = pointingTags.filter(isReleaseTag);

  if (releaseTags.length === 1) return { tag: releaseTags[0]! };

  if (releaseTags.length === 0) {
    return {
      error:
        pointingTags.length > 0
          ? `HEAD memikul tag [${pointingTags.join(", ")}], tidak satu pun berpola vX.Y.Z.`
          : "RELEASE_VERIFY_TAG tidak diset dan HEAD tidak memikul tag apa pun."
    };
  }

  return {
    error: `HEAD memikul ${releaseTags.length} tag rilis (${releaseTags.join(", ")}) — set RELEASE_VERIFY_TAG secara eksplisit.`
  };
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

/**
 * Satu rilis yang SUDAH terbit, sebagaimana `gh release list --json` menyebutnya.
 */
export type PublishedRelease = {
  tagName: string;
  isPrerelease?: boolean;
  isDraft?: boolean;
};

/**
 * Apakah rilis untuk `tag` boleh memikul badge **"Latest"** GitHub (ADR-0119).
 *
 * ## Kenapa ini perlu diputuskan, bukan diwariskan
 *
 * `gh release create` TANPA flag `--latest` memakai default GitHub, dan default
 * itu mengandaikan rilis selalu bergerak MAJU. Andaian itu salah di repo ini:
 * gerbang approval `release` bisa menahan sebuah run berhari-hari, jadi rilis
 * bisa terbit **di luar urutan versi**. Terbukti 28 Agustus 2026 — menyetujui
 * run `v10.0.0`/`v10.0.1` yang tertahan menerbitkan release-nya dan badge
 * "Latest" langsung berpindah dari `v10.0.4` ke `v10.0.0`, yaitu ke versi yang
 * SUDAH digantikan empat rilis sebelumnya.
 *
 * Yang membuatnya lolos lama: empat backfill sehari sebelumnya melakukan hal
 * yang sama, lalu `v10.0.3` dan `v10.0.4` terbit sejam kemudian dan merebut
 * badge itu kembali — sehingga state akhir terlihat seperti "backfill tidak
 * memindahkan badge". **State akhir tak bisa menjawab pertanyaan tentang
 * urutan**; dua peristiwa yang saling menutupi terlihat seperti satu peristiwa
 * yang tak pernah terjadi.
 *
 * ## Aturannya
 *
 * Latest hanya bila TIDAK ADA rilis terbit yang versinya lebih tinggi. Draft
 * dan pre-release diabaikan karena GitHub sendiri tak pernah menaruh badge itu
 * pada keduanya — memperhitungkannya akan membuat sebuah pre-release lama
 * menolak badge dari rilis stabil yang sah.
 *
 * Tag yang tak berpola `vX.Y.Z` (dan rilis terbit yang tagnya begitu) diabaikan
 * dengan sengaja: repo ini memikul tag lama tanpa prefix (`3.0.0`, `4.5.0`),
 * dan membandingkan sesuatu yang bukan versi rilis hanya menghasilkan urutan
 * yang tak berarti.
 *
 * @param tag tag yang sedang diterbitkan, mis. `v10.0.5`
 * @param published rilis yang sudah ada — `gh release list --json tagName,isPrerelease,isDraft`
 */
export function shouldMarkReleaseLatest(
  tag: string,
  published: readonly PublishedRelease[]
): boolean {
  const thisVersionText = parseVersionFromTag(tag);
  if (thisVersionText === null) return false;

  const thisVersion = parseReleaseVersion(thisVersionText);
  if (thisVersion === null) return false;

  for (const release of published) {
    if (release.isDraft || release.isPrerelease) continue;

    const otherText = parseVersionFromTag(release.tagName);
    if (otherText === null) continue;

    const other = parseReleaseVersion(otherText);
    if (other === null) continue;

    if (compareReleaseVersions(other, thisVersion) > 0) return false;
  }

  return true;
}
