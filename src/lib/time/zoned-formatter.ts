/**
 * One bounded cache of `Intl.DateTimeFormat` instances per IANA time zone, for
 * every module that converts between UTC instants and a zone's wall clock
 * (`crm_follow_up`, `booking`, `hr_workforce`). Pure module: no database.
 *
 * ## Why this exists (audit of PR #1266, HIGH-1)
 *
 * Each module used to keep its OWN unbounded `Map<string, Intl.DateTimeFormat>`
 * and fill it from request validation, BEFORE authorization. A formatter costs
 * tens of kilobytes and ICU accepts many spellings of one zone (`asia/jakarta`,
 * `ASIA/JAKARTA`, ...), so an unauthenticated caller could grow the process
 * without limit by cycling spellings. Now:
 *
 *   - VALIDATION never touches the cache (`canonicalTimeZone` builds a
 *     throw-away formatter and returns the zone's canonical name);
 *   - the cache is keyed by the CANONICAL name, so spellings of one zone share
 *     one entry;
 *   - the cache holds at most `ZONED_FORMATTER_CACHE_MAX` entries and evicts
 *     the least recently used one.
 */

/** The bound. A deployment serves a handful of zones; 64 is generous. */
export const ZONED_FORMATTER_CACHE_MAX = 64;

const MAX_ZONE_NAME_LENGTH = 64;

const cache = new Map<string, Intl.DateTimeFormat>();

function build(zone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

/**
 * The canonical IANA name of `zone` as this runtime's tz database knows it
 * (`asia/jakarta` -> `Asia/Jakarta`), or `null` when it is not a zone (or not
 * a string, or longer than 64 characters). Fills NO cache.
 */
export function canonicalTimeZone(zone: unknown): string | null {
  if (
    typeof zone !== "string" ||
    zone.length === 0 ||
    zone.length > MAX_ZONE_NAME_LENGTH
  ) {
    return null;
  }

  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions()
      .timeZone;
  } catch {
    return null;
  }
}

/**
 * A formatter of `zone`'s wall clock (year, month, day, 24-hour hour, minute,
 * second as numeric parts). Throws `RangeError` for an unknown zone, like
 * `Intl.DateTimeFormat` itself. Bounded LRU keyed by the canonical name.
 */
export function zonedPartsFormatter(zone: string): Intl.DateTimeFormat {
  const direct = cache.get(zone);

  if (direct) {
    // Refresh recency.
    cache.delete(zone);
    cache.set(zone, direct);
    return direct;
  }

  const canonical = canonicalTimeZone(zone);

  if (canonical === null) {
    throw new RangeError("Unknown time zone.");
  }

  let formatter = cache.get(canonical);

  if (formatter) {
    cache.delete(canonical);
  } else {
    formatter = build(canonical);
  }

  cache.set(canonical, formatter);

  while (cache.size > ZONED_FORMATTER_CACHE_MAX) {
    const oldest = cache.keys().next().value;

    if (oldest === undefined) break;
    cache.delete(oldest);
  }

  return formatter;
}

/** Test-only: how many formatters are cached. */
export function zonedFormatterCacheSizeForTests(): number {
  return cache.size;
}

/** Test-only: empties the cache. */
export function resetZonedFormatterCacheForTests(): void {
  cache.clear();
}
