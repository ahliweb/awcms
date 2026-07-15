/**
 * Dependency-free SemVer parse/compare/range-satisfaction (Issue #741,
 * epic #738 `platform-evolution`, Wave 1). No `semver` (or any other) npm
 * package exists anywhere in this repo's `package.json` today — adding
 * one for a handful of comparisons would be a new third-party dependency
 * for a genuinely small amount of logic, so this is a small,
 * intentionally NARROW hand-written subset, not a full SemVer 2.0.0
 * implementation. Used by
 * `src/modules/module-management/domain/extension-compatibility.ts`
 * (pure, no I/O — reads only the plain strings this file exports/accepts)
 * and its CLI caller `scripts/extension-check.ts`.
 *
 * Deliberately NOT supported (documented here so a caller never assumes
 * silent support): pre-release/build-metadata tags (`-rc.1`/`+build`),
 * `||` OR-composition of ranges, `x`/`*`/`latest` wildcards, npm-style
 * hyphen ranges (`1.2.3 - 2.3.4`). Every version string this module
 * accepts must be plain `MAJOR.MINOR.PATCH` (`^\d+\.\d+\.\d+$` — the same
 * shape `scripts/api-spec-check.ts`'s own `SEMVER_PATTERN` already
 * enforces for OpenAPI/AsyncAPI `info.version`, ADR-0008). A range is one
 * or more comparator tokens separated by whitespace, ALL of which must be
 * satisfied (AND semantics only) — `>=0.20.0 <1.0.0`, `^0.23.0`,
 * `~0.23.5`, or a bare `0.23.5` (exact match).
 */

export type ParsedSemver = {
  major: number;
  minor: number;
  patch: number;
};

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseSemver(version: string): ParsedSemver | null {
  const match = SEMVER_PATTERN.exec(version.trim());
  if (!match) return null;

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

export function isValidSemver(version: string): boolean {
  return parseSemver(version) !== null;
}

/** -1 if `a` < `b`, 0 if equal, 1 if `a` > `b`. */
export function compareSemver(a: ParsedSemver, b: ParsedSemver): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

type Comparator = {
  operator: ">=" | "<=" | ">" | "<" | "=" | "^" | "~";
  version: ParsedSemver;
};

const COMPARATOR_PATTERN = /^(>=|<=|>|<|\^|~|=)?(\d+\.\d+\.\d+)$/;

/**
 * Parses a range string into its AND-composed comparator tokens, or
 * `null` if any token is malformed — callers must treat `null` as "the
 * range itself is invalid", a distinct diagnostic from "the range is
 * valid but not satisfied".
 */
export function parseSemverRange(range: string): Comparator[] | null {
  const tokens = range.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const comparators: Comparator[] = [];
  for (const token of tokens) {
    const match = COMPARATOR_PATTERN.exec(token);
    if (!match) return null;

    const version = match[2] ? parseSemver(match[2]) : null;
    if (!version) return null;

    comparators.push({
      operator: (match[1] as Comparator["operator"] | undefined) ?? "=",
      version
    });
  }
  return comparators;
}

function satisfiesComparator(
  version: ParsedSemver,
  comparator: Comparator
): boolean {
  const cmp = compareSemver(version, comparator.version);

  switch (comparator.operator) {
    case "=":
      return cmp === 0;
    case ">":
      return cmp > 0;
    case "<":
      return cmp < 0;
    case ">=":
      return cmp >= 0;
    case "<=":
      return cmp <= 0;
    case "^":
      // Caret: same major, >= the specified version (compatible-with,
      // the common case this repo's own versions fall under pre-1.0.0 —
      // treated the same as post-1.0.0 here, no special 0.x narrowing,
      // since this repo's own range declarations (ADR-0015) always pin
      // an explicit upper bound via a second `<` token instead of relying
      // on npm's 0.x caret-narrowing quirk).
      return version.major === comparator.version.major && cmp >= 0;
    case "~":
      // Tilde: same major.minor, >= the specified version.
      return (
        version.major === comparator.version.major &&
        version.minor === comparator.version.minor &&
        cmp >= 0
      );
  }
}

/**
 * `null` return (rather than `false`) signals the RANGE STRING was
 * malformed — callers must surface this as its own diagnostic
 * (`base_version_range_invalid`), never silently treat a typo'd range as
 * "incompatible" (which would misdirect a derived-repo author toward
 * fixing the wrong thing).
 */
export function satisfiesSemverRange(
  version: string,
  range: string
): boolean | null {
  const parsedVersion = parseSemver(version);
  if (!parsedVersion) return null;

  const comparators = parseSemverRange(range);
  if (!comparators) return null;

  return comparators.every((comparator) =>
    satisfiesComparator(parsedVersion, comparator)
  );
}
