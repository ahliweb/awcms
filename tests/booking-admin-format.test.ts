/**
 * The form <-> API mapping of the booking admin screens (Issue #942): the
 * seconds-to-minutes ROUND TRIP must never rewrite what the operator did not
 * touch. A review found that showing `Math.round(seconds / 60)` and sending
 * `minutes * 60` back turned a 90 s setup into 120 s, a 330 s slot step into
 * 360 s (which changes availability), made a 20 s duration unsavable, and had an
 * unrelated policy edit rewrite the hold, notice and grace values under a
 * `critical` audit row.
 */
import { describe, expect, test } from "bun:test";

import {
  buildBody,
  countOrNull,
  isInexactMinutes,
  localTimeOrNull,
  minutesDisplay,
  minutesToSeconds,
  textOrNull,
  type FieldSpec
} from "../src/lib/booking-admin-format";

describe("minutes display and parse", () => {
  test("whole minutes are plain; the rest are decimals, never rounded to a whole minute", () => {
    expect(minutesDisplay(null)).toBe("");
    expect(minutesDisplay(0)).toBe("0");
    expect(minutesDisplay(60)).toBe("1");
    expect(minutesDisplay(90)).toBe("1.5");
    expect(minutesDisplay(330)).toBe("5.5");
    expect(minutesDisplay(20)).toBe("0.33");
    expect(isInexactMinutes(90)).toBe(false);
    expect(isInexactMinutes(20)).toBe(true);
    expect(isInexactMinutes(60)).toBe(false);
    expect(isInexactMinutes(null)).toBe(false);
  });

  test("typed minutes become whole seconds", () => {
    expect(minutesToSeconds("2")).toBe(120);
    expect(minutesToSeconds("1.5")).toBe(90);
    expect(minutesToSeconds("0.5")).toBe(30);
    expect(minutesToSeconds("")).toBeNull();
    expect(Number.isNaN(minutesToSeconds("abc"))).toBe(true);
    expect(countOrNull("")).toBeNull();
    expect(countOrNull("3")).toBe(3);
    expect(Number.isNaN(countOrNull("1.5"))).toBe(true);
    expect(textOrNull("  ")).toBeNull();
    expect(localTimeOrNull("14:00")).toBe("14:00:00");
    expect(localTimeOrNull("14:00:30")).toBe("14:00:30");
  });
});

/** A control as the page renders it, then (optionally) as the operator edited it. */
function control(
  key: string,
  original: unknown,
  display: string,
  convert: FieldSpec["convert"],
  edited?: string
): FieldSpec {
  return { key, raw: edited ?? display, initial: display, original, convert };
}

describe("an offering PATCH", () => {
  const fields = (edits: Record<string, string> = {}) => [
    control("name", "Cut", "Cut", (raw) => raw.trim(), edits.name),
    control(
      "setupSeconds",
      90,
      minutesDisplay(90),
      minutesToSeconds,
      edits.setup
    ),
    control(
      "slotStepSeconds",
      330,
      minutesDisplay(330),
      minutesToSeconds,
      edits.step
    ),
    control(
      "durationSeconds",
      20,
      minutesDisplay(20),
      minutesToSeconds,
      edits.duration
    )
  ];

  test("an edit of the name alone sends the name alone: 90 s, 330 s and 20 s are never re-sent", () => {
    expect(
      buildBody(fields({ name: "Cut and wash" }), { onlyChanged: true })
    ).toEqual({
      name: "Cut and wash"
    });
  });

  test("nothing edited is an empty body (the screen says there is nothing to change)", () => {
    expect(buildBody(fields(), { onlyChanged: true })).toEqual({});
  });

  test("a 20 s duration stays editable: it shows 0.33 and a typed value is converted", () => {
    expect(minutesDisplay(20)).toBe("0.33");
    expect(
      buildBody(fields({ duration: "0.5" }), { onlyChanged: true })
    ).toEqual({
      durationSeconds: 30
    });
  });

  test("an edited minute field converts exactly what was typed", () => {
    expect(buildBody(fields({ setup: "2" }), { onlyChanged: true })).toEqual({
      setupSeconds: 120
    });
  });
});

describe("the policy PUT", () => {
  const policy = {
    defaultHoldSeconds: 600,
    maxHoldSeconds: 1790,
    maxActiveHoldsPerCustomer: 3,
    maxActiveHoldsPerTenant: null,
    minLeadSeconds: 90,
    maxHorizonDays: 180,
    noShowGraceSeconds: 1210,
    defaultTimezone: "Asia/Jakarta",
    defaultCheckInTime: "14:00:30",
    defaultCheckOutTime: null
  };
  const fields = (edits: Record<string, string> = {}): FieldSpec[] => [
    control(
      "defaultHoldSeconds",
      policy.defaultHoldSeconds,
      minutesDisplay(600),
      minutesToSeconds,
      edits.hold
    ),
    control(
      "maxHoldSeconds",
      policy.maxHoldSeconds,
      minutesDisplay(1790),
      minutesToSeconds
    ),
    control("maxActiveHoldsPerCustomer", 3, "3", countOrNull, edits.cap),
    control("maxActiveHoldsPerTenant", null, "", countOrNull),
    control(
      "minLeadSeconds",
      policy.minLeadSeconds,
      minutesDisplay(90),
      minutesToSeconds
    ),
    control("maxHorizonDays", 180, "180", countOrNull),
    control(
      "noShowGraceSeconds",
      policy.noShowGraceSeconds,
      minutesDisplay(1210),
      minutesToSeconds
    ),
    control("defaultTimezone", "Asia/Jakarta", "Asia/Jakarta", textOrNull),
    // The time control shows HH:MM and drops the seconds; the original keeps them.
    control("defaultCheckInTime", "14:00:30", "14:00", localTimeOrNull),
    control("defaultCheckOutTime", null, "", localTimeOrNull)
  ];

  test("an unedited save is byte-identical to what was read", () => {
    const body = buildBody(fields(), { onlyChanged: false });

    expect(JSON.stringify(body)).toBe(JSON.stringify(policy));
  });

  test("editing one unrelated field leaves every other value exactly as read", () => {
    const body = buildBody(fields({ cap: "4" }), { onlyChanged: false });

    expect(body).toEqual({ ...policy, maxActiveHoldsPerCustomer: 4 });
    // The values a minutes round trip would have rewritten:
    expect(body.maxHoldSeconds).toBe(1790);
    expect(body.minLeadSeconds).toBe(90);
    expect(body.noShowGraceSeconds).toBe(1210);
    expect(body.defaultCheckInTime).toBe("14:00:30");
  });

  test("an edited minute field converts to seconds", () => {
    expect(
      buildBody(fields({ hold: "20" }), { onlyChanged: false })
        .defaultHoldSeconds
    ).toBe(1200);
  });
});
