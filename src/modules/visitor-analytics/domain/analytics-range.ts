/**
 * `range` query parameter validation for analytics aggregate endpoints
 * (ported from awcms-micro epic #617-#624). Pure — the four values
 * `24h|7d|30d|12m`.
 */
export const ANALYTICS_RANGES = ["24h", "7d", "30d", "12m"] as const;

export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export function isKnownAnalyticsRange(
  value: string | null | undefined
): value is AnalyticsRange {
  return (ANALYTICS_RANGES as readonly string[]).includes(value ?? "");
}

/** `range=7d` (default) when the query param is omitted entirely. */
export const DEFAULT_ANALYTICS_RANGE: AnalyticsRange = "7d";

/** The start of the window for `range`, relative to `now`. Never throws. */
export function resolveRangeStart(range: AnalyticsRange, now: Date): Date {
  const start = new Date(now);

  switch (range) {
    case "24h":
      start.setUTCHours(start.getUTCHours() - 24);
      return start;
    case "7d":
      start.setUTCDate(start.getUTCDate() - 7);
      return start;
    case "30d":
      start.setUTCDate(start.getUTCDate() - 30);
      return start;
    case "12m":
      start.setUTCMonth(start.getUTCMonth() - 12);
      return start;
  }
}
