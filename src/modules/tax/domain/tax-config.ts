/**
 * The tax-date window (ADR-0127 §6): how far from the SERVER's date a caller may
 * state a document's tax date without holding `tax.snapshots.backdate`.
 *
 * ## Why this exists
 *
 * A tax date selects the rule version AND the reporting period. The caller states
 * it (a late-synced offline POS sale legitimately carries yesterday's date), but a
 * caller that may state ANY date can post a document into a closed period, or into
 * a period whose rule has not started. So a small skew is free and everything
 * beyond it needs a separate, high-risk permission — never accepted silently.
 *
 * Two settings, read from the environment (`.env.example`), with the defaults the
 * ADR names: 7 days back, 1 day forward. A malformed or out-of-range value falls
 * back to the default rather than widening the window — a typo must not open it.
 * The server date is `now()` FROM THE DATABASE (UTC), never JavaScript time, so
 * every application node agrees; the comparison is done by the caller in SQL.
 */
export type TaxDateWindow = { pastDays: number; forwardDays: number };

export const DEFAULT_TAX_DATE_WINDOW: TaxDateWindow = {
  pastDays: 7,
  forwardDays: 1
};

const MAX_WINDOW_DAYS = 366;

function boundedDays(raw: string | undefined, fallback: number): number {
  if (raw === undefined || !/^\d{1,3}$/.test(raw.trim())) return fallback;

  const value = Number(raw.trim());

  return value <= MAX_WINDOW_DAYS ? value : fallback;
}

export function resolveTaxDateWindow(
  env: Readonly<Record<string, string | undefined>> = process.env
): TaxDateWindow {
  return {
    pastDays: boundedDays(
      env.TAX_TAXDATE_PAST_DAYS,
      DEFAULT_TAX_DATE_WINDOW.pastDays
    ),
    forwardDays: boundedDays(
      env.TAX_TAXDATE_FORWARD_DAYS,
      DEFAULT_TAX_DATE_WINDOW.forwardDays
    )
  };
}

/** `offsetDays` = tax date minus server date, in whole days (negative = past). */
export function isWithinTaxDateWindow(
  offsetDays: number,
  window: TaxDateWindow
): boolean {
  return offsetDays >= -window.pastDays && offsetDays <= window.forwardDays;
}
