/**
 * Which rule version applies to a tax date (ADR-0127).
 *
 * Pure, and over ISO calendar dates compared as strings: `YYYY-MM-DD` sorts
 * lexically in date order, so there is no `Date`, no time zone and no
 * "midnight in which zone" question. A tax date is a CALENDAR date — the day the
 * supply happened — and it is the caller's to state, never the server's clock.
 * That is what makes a back-dated or late-synced document resolve to the rule
 * that was in force on its own date.
 *
 * Intervals are half-open: `effectiveFrom` inclusive, `effectiveTo` EXCLUSIVE
 * (`null` = open-ended). A version ending `2027-01-01` and its successor
 * starting `2027-01-01` therefore never both apply to one day, and never leave a
 * gap — the boundary day belongs to exactly one of them.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);

  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));

  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

export type EffectiveWindow = {
  effectiveFrom: string;
  effectiveTo: string | null;
};

export function isEffectiveOn(
  window: EffectiveWindow,
  taxDate: string
): boolean {
  return (
    window.effectiveFrom <= taxDate &&
    (window.effectiveTo === null || taxDate < window.effectiveTo)
  );
}

/**
 * The single version in force on `taxDate`, or `null`. More than one match means
 * the non-overlap invariant (enforced in the database) has been broken, which is
 * not something to resolve by picking one — it throws.
 */
export function selectEffectiveVersion<T extends EffectiveWindow>(
  versions: readonly T[],
  taxDate: string
): T | null {
  const matches = versions.filter((version) => isEffectiveOn(version, taxDate));

  if (matches.length > 1) {
    throw new Error(
      `Overlapping published tax rule versions both apply on ${taxDate}.`
    );
  }

  return matches[0] ?? null;
}

/** Do two half-open windows share at least one day? */
export function windowsOverlap(
  a: EffectiveWindow,
  b: EffectiveWindow
): boolean {
  return (
    (a.effectiveTo === null || b.effectiveFrom < a.effectiveTo) &&
    (b.effectiveTo === null || a.effectiveFrom < b.effectiveTo)
  );
}
