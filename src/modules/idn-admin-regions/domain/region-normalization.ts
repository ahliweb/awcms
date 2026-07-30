/**
 * Turns raw `(code, name)` pairs from the upstream dump into the normalized
 * region rows `awcms_idn_admin_regions` stores (ADR-0046).
 *
 * Everything here is derived from TWO facts that are stable properties of the
 * Kemendagri coding scheme, not guesses about a particular file:
 *
 *  1. **Dot depth is the tier.** `11` = province, `11.01` = regency/city,
 *     `11.01.01` = district, `11.01.01.2001` = village. Depth 1–4, nothing else.
 *  2. **A village's fourth segment encodes its kind in its leading digit** —
 *     `1xxx` kelurahan, `2xxx` desa, `3xxx` desa adat (the customary villages
 *     Papua registers; 14 of them exist in the current dump, and they are the
 *     reason this is a lookup table rather than an `if (digit === "1")`).
 *
 * Where upstream does NOT state something, this module records `null` rather
 * than inventing it. The clearest case is the district tier: upstream ships bare
 * names ("Bakongan"), so `localTerm` stays null instead of being filled with
 * "Kecamatan" — which would be wrong for the provinces that call the same tier
 * "Distrik". A null an operator can see beats a plausible value they cannot
 * check.
 */
import type { WilayahDumpRow } from "./wilayah-dump-parser";

export type RegionType = "province" | "regency" | "district" | "village";

/** Tier order — index + 1 is the `level` column, so the two can never disagree. */
export const REGION_TYPES: readonly RegionType[] = [
  "province",
  "regency",
  "district",
  "village"
];

/** Village kind by the leading digit of the fourth code segment. */
const VILLAGE_TERM_BY_LEADING_DIGIT: Readonly<Record<string, string>> = {
  "1": "Kelurahan",
  "2": "Desa",
  "3": "Desa Adat"
};

/**
 * Regency-tier terms, longest first — "Kota Administrasi Jakarta Pusat" must
 * resolve to "Kota Administrasi", not to "Kota" with "Administrasi …" left
 * dangling in the short name.
 */
const REGENCY_TERMS: readonly string[] = [
  "Kabupaten Administrasi",
  "Kota Administrasi",
  "Kabupaten",
  "Kota"
];

export type NormalizedRegion = {
  code: string;
  codeCompact: string;
  parentCode: string | null;
  level: number;
  regionType: RegionType;
  localTerm: string | null;
  officialName: string;
  normalizedName: string;
  fullPathCode: string | null;
  fullPathName: string | null;
  provinceCode: string | null;
  regencyCode: string | null;
  districtCode: string | null;
  villageCode: string | null;
  metadata: { shortName: string; segments: number };
};

export class RegionNormalizationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly lineNumber: number
  ) {
    super(message);
    this.name = "RegionNormalizationError";
  }
}

/**
 * Case/whitespace-folded name for lookup. Diacritics are left alone on purpose:
 * Indonesian region names do not carry them, so folding would only add a
 * transformation nobody can verify against the source.
 */
export function normalizeRegionName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Strips a known tier term from the front of a name ("Kabupaten Aceh Selatan" -> "Aceh Selatan"). */
function stripTerm(name: string, term: string | null): string {
  if (!term) return name;
  const prefix = `${term} `;
  return name.startsWith(prefix) ? name.slice(prefix.length).trim() : name;
}

/** The Indonesian term this row carries, or null when upstream does not say. */
function resolveLocalTerm(
  regionType: RegionType,
  segments: string[],
  name: string
): string | null {
  if (regionType === "province") return "Provinsi";

  if (regionType === "regency") {
    return REGENCY_TERMS.find((term) => name.startsWith(`${term} `)) ?? null;
  }

  if (regionType === "village") {
    const leadingDigit = (segments[3] ?? "").slice(0, 1);
    return VILLAGE_TERM_BY_LEADING_DIGIT[leadingDigit] ?? null;
  }

  // district — upstream ships bare names; see this file's header.
  return null;
}

/**
 * Normalizes one raw row. Throws {@link RegionNormalizationError} on a code the
 * scheme cannot describe (wrong depth, empty segment, non-numeric segment) —
 * the importer turns that into a failed import, never a skipped row.
 */
export function normalizeRegionRow(row: WilayahDumpRow): NormalizedRegion {
  const segments = row.code.split(".");
  const level = segments.length;

  if (level < 1 || level > 4) {
    throw new RegionNormalizationError(
      `Region code "${row.code}" has ${level} segments; the Kemendagri scheme has exactly 1-4 (province/regency/district/village).`,
      row.code,
      row.lineNumber
    );
  }

  for (const segment of segments) {
    if (segment.length === 0 || !/^[0-9]+$/.test(segment)) {
      throw new RegionNormalizationError(
        `Region code "${row.code}" contains a non-numeric or empty segment.`,
        row.code,
        row.lineNumber
      );
    }
  }

  const regionType = REGION_TYPES[level - 1] as RegionType;
  const officialName = row.name.trim().replace(/\s+/g, " ");
  const localTerm = resolveLocalTerm(regionType, segments, officialName);

  return {
    code: row.code,
    codeCompact: segments.join(""),
    parentCode: level > 1 ? segments.slice(0, level - 1).join(".") : null,
    level,
    regionType,
    localTerm,
    officialName,
    normalizedName: normalizeRegionName(officialName),
    fullPathCode: null,
    fullPathName: null,
    provinceCode: segments[0] ?? null,
    regencyCode: level >= 2 ? segments.slice(0, 2).join(".") : null,
    districtCode: level >= 3 ? segments.slice(0, 3).join(".") : null,
    villageCode: level >= 4 ? row.code : null,
    metadata: { shortName: stripTerm(officialName, localTerm), segments: level }
  };
}

/**
 * Normalizes a whole dump and resolves each row's ancestor path.
 *
 * The path columns (`full_path_code`/`full_path_name`) are what makes a region
 * usable in a form or a report without four extra joins ("Keude Bakongan,
 * Bakongan, Kabupaten Aceh Selatan, Aceh"). They are resolved in ONE pass over a
 * code->row map rather than per-row lookups, because at 91,599 rows the naive
 * shape is the difference between an import that finishes and one that appears
 * to hang.
 *
 * An orphan (a row whose parent code is absent from the file) is an ERROR, not a
 * row with a shorter path: a hierarchy missing its middle is exactly the kind of
 * damage that stays invisible until someone's address form has an empty
 * dropdown.
 */
export function normalizeRegionRows(rows: readonly WilayahDumpRow[]): {
  regions: NormalizedRegion[];
  orphanCodes: string[];
} {
  const regions = rows.map(normalizeRegionRow);
  const byCode = new Map(regions.map((region) => [region.code, region]));
  const orphanCodes: string[] = [];

  for (const region of regions) {
    const codePath: string[] = [];
    const namePath: string[] = [];
    let cursor: NormalizedRegion | undefined = region;
    let orphaned = false;

    while (cursor) {
      codePath.unshift(cursor.code);
      namePath.unshift(cursor.officialName);

      if (cursor.parentCode === null) break;

      const parent: NormalizedRegion | undefined = byCode.get(
        cursor.parentCode
      );

      if (!parent) {
        orphaned = true;
        orphanCodes.push(region.code);
        break;
      }

      cursor = parent;
    }

    if (!orphaned) {
      // Both paths run province -> self (breadcrumb order, the order a picker
      // and an admin screen read in). The code path is joined with "/" rather
      // than "." because every code already CONTAINS dots — joining with a dot
      // would produce "11.11.01.11.01.01", a string that looks like a code and
      // is not one.
      region.fullPathCode = codePath.join("/");
      region.fullPathName = namePath.join(", ");
    }
  }

  return { regions, orphanCodes };
}
