/**
 * Per-user time zone — ADR-0095's third display preference (sql/130).
 *
 * ## What is worth asserting here, and what is not
 *
 * The interesting part is not that a zone round-trips. It is the DEGRADATION:
 * `/admin/account` renders timestamps through `formatDateTime(locale, value,
 * zone)`, and `Intl.DateTimeFormat` throws `RangeError` on a zone it cannot
 * resolve. A stored zone that a later tzdata dropped would therefore take down
 * the account screen — the one page somebody opens when they think their
 * password leaked, which is exactly when a stack trace is most expensive.
 *
 * So the read path coerces, and these tests pin the coercion rather than the
 * happy path.
 *
 * ## Why the validator is `Intl` and not a list
 *
 * sql/130 constrains only the SHAPE of the column, deliberately: there are 445
 * zones in this runtime, the list is tzdata's, and it changes several times a
 * year. A CHECK enumerating them would begin REFUSING legitimate values within
 * months — the failure an operator cannot work around. `Intl` ships with the
 * runtime and answers exactly the question that matters: can this be rendered?
 *
 * Pure: no database, no network.
 */
import { describe, expect, test } from "bun:test";

import {
  FALLBACK_TIME_ZONE,
  coerceTimeZone,
  isRenderableTimeZone
} from "../src/modules/identity-access/application/principal-preference-store";
import { formatDateTime } from "../src/lib/i18n";

describe("time-zone validation", () => {
  test("accepts real IANA zones, including the ones with three segments", () => {
    for (const zone of [
      "UTC",
      "Asia/Jakarta",
      "Europe/London",
      "America/Argentina/Buenos_Aires",
      "Etc/GMT+7"
    ]) {
      expect(isRenderableTimeZone(zone)).toBe(true);
    }
  });

  test("rejects anything this runtime cannot render", () => {
    for (const value of [
      "Not/AZone",
      "Mars/Olympus_Mons",
      "",
      "   ",
      null,
      undefined,
      42,
      {}
    ]) {
      expect(isRenderableTimeZone(value)).toBe(false);
    }
  });

  test("coerceTimeZone turns an unrenderable value into 'not chosen'", () => {
    // The shape the read path depends on: a zone written under an older tzdata
    // and dropped since must read as null, not throw and not pass through.
    expect(coerceTimeZone("Asia/Jakarta")).toBe("Asia/Jakarta");
    expect(coerceTimeZone("Not/AZone")).toBeNull();
    expect(coerceTimeZone(null)).toBeNull();
  });

  test("the fallback is UTC, not the server's zone", () => {
    // Load-bearing, and the reason the feature did not exist before: a server
    // zone renders "last seen 14:02" to a reader in Jakarta with nothing saying
    // whose 14:02 it is, and they believe it. UTC is nobody's local time, which
    // is what makes it safe as a default.
    expect(FALLBACK_TIME_ZONE).toBe("UTC");
  });
});

describe("rendering a timestamp in the reader's zone", () => {
  // 2026-08-15T00:30:00Z — chosen because it falls on a DIFFERENT calendar day
  // in Jakarta (+07:00) than in UTC. A same-day instant would let a broken
  // zone argument pass unnoticed.
  const instant = "2026-08-15T00:30:00.000Z";

  test("the same instant renders differently per zone", () => {
    const utc = formatDateTime("en", instant, "UTC");
    const jakarta = formatDateTime("en", instant, "Asia/Jakarta");

    expect(utc).not.toBe(jakarta);
  });

  test("a zone that crosses midnight moves the DATE, not just the clock", () => {
    // The assertion that would fail if the zone were dropped somewhere between
    // the preference and the formatter: both strings would name the 15th.
    expect(formatDateTime("en", instant, "UTC")).toContain("15");
    expect(formatDateTime("en", instant, "Asia/Jakarta")).toContain("15");
    expect(formatDateTime("en", instant, "America/Los_Angeles")).toContain(
      "14"
    );
  });

  test("an unrenderable zone would throw — which is why nothing may reach here uncoerced", () => {
    // Documents the hazard the coercion exists for. If this ever stops
    // throwing, `coerceTimeZone` on the read path has become optional and the
    // comment justifying it is wrong.
    expect(() => formatDateTime("en", instant, "Not/AZone")).toThrow();
    expect(() =>
      formatDateTime(
        "en",
        instant,
        coerceTimeZone("Not/AZone") ?? FALLBACK_TIME_ZONE
      )
    ).not.toThrow();
  });
});

describe("the picker offers what the server will accept", () => {
  test("every option the account screen renders is renderable", () => {
    // `/admin/account` builds its `<select>` from `Intl.supportedValuesOf`
    // SERVER-side precisely so this holds. A list from anywhere else could
    // offer a zone `coerceTimeZone` then rejects, and the reader would be
    // looking at a value the page itself suggested.
    const zones = Intl.supportedValuesOf("timeZone");

    expect(zones.length).toBeGreaterThan(100);

    for (const zone of zones) {
      if (!isRenderableTimeZone(zone)) {
        throw new Error(`Intl offers ${zone} but cannot render it`);
      }
    }
  });

  test("UTC is reachable even though Intl does not list it", () => {
    // `supportedValuesOf` returns the IANA zone names and omits the `UTC`
    // alias, so the screen renders it as its own first option. If that stopped
    // being accepted, the "not chosen" default would be unselectable.
    expect(isRenderableTimeZone(FALLBACK_TIME_ZONE)).toBe(true);
  });
});
