/**
 * The one definition of "a version this repo releases", and the one definition
 * of the `vX.Y.Z` tag that names it.
 *
 * ## Why this file exists
 *
 * The `vX.Y.Z` model was real but it lived in a single regex on the release
 * path (`release-verify-checks.ts`), reachable only after a tag had already
 * been pushed. Nothing else in the repo could ask "is this a release version?"
 * without writing the pattern again, and the pattern that existed was looser
 * than the model it enforced:
 *
 *   - `/^v(\d+\.\d+\.\d+)$/` accepts `v01.2.3` and `v1.02.3`. SemVer §2
 *     forbids leading zeros precisely because `01.2.3` and `1.2.3` are the
 *     same number written two ways, and a tag namespace that admits both can
 *     hold two tags that a human reads as one release.
 *
 * So the patterns here are deliberately STRICTER than "three numbers with
 * dots", and the strictness is the point:
 *
 *   - **No prerelease** (`-rc.1`) and **no build metadata** (`+build.5`).
 *     The model this repo committed to is `vX.Y.Z` — release versions only.
 *     A gate that accepted `v1.2.3-rc.1` would be a rubber stamp for the one
 *     thing the model exists to exclude, and `release.yml`'s trigger glob
 *     `v*.*.*` already matches `v1.2.3-rc.1`, so this pattern is the only
 *     thing standing between that tag and a published release.
 *   - **No `v` prefix in a VERSION**, always a `v` prefix in a TAG. The two
 *     are different strings and the repo depends on the difference: the git
 *     tag is `v9.1.2`, the container image is `ghcr.io/ahliweb/awcms:9.1.2`,
 *     and `docs/awcms/release-process.md` records that writing the `v` into
 *     an image reference fails with `manifest unknown`. Keeping both spellings
 *     derivable from one function (`releaseTagFor`) is what stops the third
 *     spelling from appearing.
 *
 * ## Ordering
 *
 * `compareReleaseVersions` compares NUMERICALLY, field by field. String
 * comparison is the trap it exists to avoid: `"9" > "10"` lexicographically,
 * so a string-sorted changelog would call `9.1.2` newer than `10.0.0` and be
 * wrong on the first release after the next major.
 */

/** A release version as this repo writes it in `package.json`: `X.Y.Z`. */
export const RELEASE_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** A release tag as this repo writes it in git: `vX.Y.Z`. */
export const RELEASE_TAG_PATTERN =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export type ReleaseVersion = {
  major: number;
  minor: number;
  patch: number;
};

/**
 * @param version e.g. `9.1.2` (no `v` prefix)
 * @returns the parsed fields, or null when `version` is not a release version
 *   under this repo's model — including when it is a valid SemVer string that
 *   this repo does not release (`1.2.3-rc.1`, `1.2.3+build.5`).
 */
export function parseReleaseVersion(version: string): ReleaseVersion | null {
  const match = version.trim().match(RELEASE_VERSION_PATTERN);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

/** True when `version` is a release version this repo may ship (`X.Y.Z`). */
export function isReleaseVersion(version: string): boolean {
  return parseReleaseVersion(version) !== null;
}

/**
 * @param tag e.g. `v9.1.2`
 * @returns the version WITHOUT the `v` prefix (`9.1.2`), or null when `tag`
 *   does not match the `vX.Y.Z` model. A bare `9.1.2` returns null on
 *   purpose: six such tags exist in this repo's history and the whole point
 *   of the model is that they are the exception, not a second accepted form.
 */
export function parseVersionFromTag(tag: string): string | null {
  const trimmed = tag.trim();
  if (!RELEASE_TAG_PATTERN.test(trimmed)) return null;
  return trimmed.slice(1);
}

/** True when `tag` is a release tag under this repo's model (`vX.Y.Z`). */
export function isReleaseTag(tag: string): boolean {
  return RELEASE_TAG_PATTERN.test(tag.trim());
}

/**
 * The single place the `v` prefix is added. Callers that need the image tag
 * want the bare version instead — see `release-process.md` §Verifying a
 * published release for why the two must not be confused.
 *
 * @param version a release version (`9.1.2`)
 * @throws when `version` is not a release version, so a malformed tag can
 *   never be constructed and then compared against a well-formed one.
 */
export function releaseTagFor(version: string): string {
  if (!isReleaseVersion(version)) {
    throw new Error(
      `Cannot build a release tag from "${version}" — not an X.Y.Z release version.`
    );
  }
  return `v${version.trim()}`;
}

/**
 * Numeric SemVer precedence. Negative when `a` is older than `b`, positive
 * when newer, 0 when equal.
 */
export function compareReleaseVersions(
  a: ReleaseVersion,
  b: ReleaseVersion
): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}
