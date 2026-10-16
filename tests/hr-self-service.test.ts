/**
 * The pure helpers of the HR self-service screens (Issue #952): the reporting
 * window, the closed-enum label maps and the number formatting. No database, no
 * render.
 */
import { describe, expect, test } from "bun:test";

import { getTranslator } from "../src/lib/i18n";
import {
  ACCRUAL_STATUS_TONE,
  CORRECTION_STATUS_TONE,
  HR_PERIODS,
  accrualStatusLabels,
  attendanceKindLabels,
  correctionKindLabels,
  correctionStatusLabels,
  employmentStatusLabels,
  employmentTypeLabels,
  formatMinutes,
  formatRatioPercent,
  labelOf,
  parsePeriod,
  pastWindow,
  periodLabels,
  shiftKindLabels,
  shiftStatusLabels,
  timeOffKindLabels,
  upcomingWindow
} from "../src/lib/hr-self-service";
import { MAX_WINDOW_DAYS } from "../src/modules/hr-workforce/domain/hr-workforce-metrics";
import { ATTENDANCE_KINDS } from "../src/modules/hr-workforce/domain/hr-attendance-types";
import {
  CORRECTION_STATUSES,
  CORRECTION_KINDS
} from "../src/modules/hr-workforce/domain/hr-attendance-types";
import {
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_TYPES
} from "../src/modules/hr-workforce/domain/hr-workforce-types";
import {
  SHIFT_KINDS,
  SHIFT_STATUSES,
  TIME_OFF_KINDS
} from "../src/modules/hr-workforce/domain/hr-shift-types";
import { ACCRUAL_STATUSES } from "../src/modules/hr-commission/domain/hr-commission-accrual-state";

const en = getTranslator("en");
const id = getTranslator("id");

describe("the reporting window", () => {
  const now = new Date("2026-10-16T10:00:00.000Z");

  test("every offered period fits the metrics contract's cap", () => {
    for (const period of HR_PERIODS) {
      const { from, to } = pastWindow(period, now);
      const days = (to.getTime() - from.getTime()) / 86_400_000;

      expect(days).toBeLessThanOrEqual(MAX_WINDOW_DAYS);
      expect(to.getTime()).toBe(now.getTime());
      expect(from.getTime()).toBeLessThan(to.getTime());
    }
  });

  test("a hostile or missing period falls back to 7 days and never throws", () => {
    for (const raw of [
      null,
      undefined,
      "",
      "999d",
      "7d; DROP TABLE",
      "__proto__"
    ]) {
      expect(parsePeriod(raw as string | null)).toBe("7d");
    }
    expect(parsePeriod("30d")).toBe("30d");
  });

  test("the upcoming window starts now and spans the requested days", () => {
    const { from, to } = upcomingWindow(14, now);

    expect(from.getTime()).toBe(now.getTime());
    expect(to.getTime() - from.getTime()).toBe(14 * 86_400_000);
  });
});

describe("closed enums are labelled exhaustively, in both languages", () => {
  const cases: [string, readonly string[], Record<string, string>][] = [
    ["attendance kind", ATTENDANCE_KINDS, attendanceKindLabels(en.t)],
    ["correction kind", CORRECTION_KINDS, correctionKindLabels(en.t)],
    ["correction status", CORRECTION_STATUSES, correctionStatusLabels(en.t)],
    ["shift kind", SHIFT_KINDS, shiftKindLabels(en.t)],
    ["time-off kind", TIME_OFF_KINDS, timeOffKindLabels(en.t)],
    ["shift status", SHIFT_STATUSES, shiftStatusLabels(en.t)],
    ["employment type", EMPLOYMENT_TYPES, employmentTypeLabels(en.t)],
    ["employment status", EMPLOYMENT_STATUSES, employmentStatusLabels(en.t)],
    ["accrual status", ACCRUAL_STATUSES, accrualStatusLabels(en.t)],
    ["period", HR_PERIODS, periodLabels(en.t)]
  ];

  for (const [name, values, labels] of cases) {
    test(`${name}: every member has a human label, never the raw value`, () => {
      expect(Object.keys(labels).sort()).toEqual([...values].sort());

      for (const value of values) {
        expect(labels[value]).toBeTruthy();
        expect(labels[value]).not.toContain("_");
      }
    });
  }

  test("a status tone exists for every correction and accrual status", () => {
    expect(Object.keys(CORRECTION_STATUS_TONE).sort()).toEqual(
      [...CORRECTION_STATUSES].sort()
    );
    expect(Object.keys(ACCRUAL_STATUS_TONE).sort()).toEqual(
      [...ACCRUAL_STATUSES].sort()
    );
  });

  test("Indonesian differs from English for the attendance kinds", () => {
    const english = attendanceKindLabels(en.t);
    const indonesian = attendanceKindLabels(id.t);

    for (const kind of ATTENDANCE_KINDS) {
      expect(indonesian[kind]).not.toBe(english[kind]);
    }
  });

  test("a value outside the union falls back to the raw text, not a crash", () => {
    expect(labelOf(attendanceKindLabels(en.t), "teleport")).toBe("teleport");
    expect(labelOf(attendanceKindLabels(en.t), "clock_in")).toBe("Clock in");
  });
});

describe("number formatting", () => {
  test("minutes read as hours and minutes", () => {
    expect(formatMinutes(en.t, 0)).toBe("0 min");
    expect(formatMinutes(en.t, 45)).toBe("45 min");
    expect(formatMinutes(en.t, 95)).toBe("1 h 35 min");
    expect(formatMinutes(en.t, 480)).toBe("8 h 0 min");
    expect(formatMinutes(en.t, -5)).toBe("0 min");
  });

  test("a missing ratio is a dash, never 0% or NaN", () => {
    expect(formatRatioPercent(null)).toBe("—");
    expect(formatRatioPercent(Number.NaN)).toBe("—");
    expect(formatRatioPercent(0)).toBe("0%");
    expect(formatRatioPercent(0.9166)).toBe("92%");
    expect(formatRatioPercent(1.25)).toBe("125%");
  });
});
