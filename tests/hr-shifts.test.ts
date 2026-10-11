/**
 * Shifts and the staff-availability port, pure parts (Issue #946, ADR-0132):
 * wall-clock to UTC resolution (daylight saving), interval algebra, request
 * validation, the port contract with a FAKE consumer, and the source-text
 * guarantees about the adapter. No database.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import type {
  StaffAvailabilityPort,
  StaffAvailabilityResult
} from "../src/modules/_shared/ports/staff-availability-port";
import {
  clipSpans,
  computeWorkingTime,
  mergeSpans,
  subtractSpans
} from "../src/modules/hr-workforce/domain/availability-intervals";
import {
  isValidTimeZone,
  localToUtcMs,
  materialiseTemplate,
  zoneOffsetMinutes
} from "../src/modules/hr-workforce/domain/hr-shift-time";
import {
  parseInstant,
  validateCreateAssignment,
  validateCreateTemplate,
  validateUpdateTemplate
} from "../src/modules/hr-workforce/domain/hr-shift-validation";
import { createStaffAvailabilityAdapter } from "../src/modules/hr-workforce/application/staff-availability-adapter";
import { hrWorkforceModule } from "../src/modules/hr-workforce/module";

const iso = (ms: number) => new Date(ms).toISOString();
const E1 = "11111111-1111-4111-8111-111111111111";
const T1 = "22222222-2222-4222-8222-222222222222";

describe("wall clock to UTC (DST fixtures)", () => {
  test("Indonesian zones have a fixed offset and no daylight saving", () => {
    expect(iso(localToUtcMs("2026-03-08", "22:00", "Asia/Jakarta"))).toBe(
      "2026-03-08T15:00:00.000Z"
    );
    expect(iso(localToUtcMs("2026-03-08", "22:00", "Asia/Makassar"))).toBe(
      "2026-03-08T14:00:00.000Z"
    );
    expect(iso(localToUtcMs("2026-03-08", "22:00", "Asia/Jayapura"))).toBe(
      "2026-03-08T13:00:00.000Z"
    );
  });

  test("an ordinary day in a DST zone uses the offset in force that day", () => {
    // New York: EST (-5) in January, EDT (-4) in July.
    expect(iso(localToUtcMs("2026-01-15", "09:00", "America/New_York"))).toBe(
      "2026-01-15T14:00:00.000Z"
    );
    expect(iso(localToUtcMs("2026-07-15", "09:00", "America/New_York"))).toBe(
      "2026-07-15T13:00:00.000Z"
    );
  });

  test("a GAP (spring forward) resolves to the instant after the jump, not before", () => {
    // 2026-03-08 02:30 does not exist in New York (02:00 -> 03:00). The
    // pre-change offset (-5) is used: 07:30Z, which reads 03:30 EDT.
    const gap = localToUtcMs("2026-03-08", "02:30", "America/New_York");

    expect(iso(gap)).toBe("2026-03-08T07:30:00.000Z");
    expect(zoneOffsetMinutes(gap, "America/New_York")).toBe(-240);
    // Berlin: 2026-03-29 02:30 does not exist either.
    expect(iso(localToUtcMs("2026-03-29", "02:30", "Europe/Berlin"))).toBe(
      "2026-03-29T01:30:00.000Z"
    );
  });

  test("an OVERLAP (fall back) resolves to the EARLIER occurrence", () => {
    // 2026-11-01 01:30 happens twice in New York: 05:30Z (EDT) and 06:30Z (EST).
    expect(iso(localToUtcMs("2026-11-01", "01:30", "America/New_York"))).toBe(
      "2026-11-01T05:30:00.000Z"
    );
    // Berlin: 2026-10-25 02:30 happens twice: 00:30Z (CEST) then 01:30Z (CET).
    expect(iso(localToUtcMs("2026-10-25", "02:30", "Europe/Berlin"))).toBe(
      "2026-10-25T00:30:00.000Z"
    );
  });

  test("a half-hour zone (Lord Howe) and a +13 zone resolve", () => {
    expect(
      iso(localToUtcMs("2026-06-01", "09:00", "Australia/Lord_Howe"))
    ).toBe("2026-05-31T22:30:00.000Z");
    expect(iso(localToUtcMs("2026-01-10", "09:00", "Pacific/Auckland"))).toBe(
      "2026-01-09T20:00:00.000Z"
    );
  });

  test("a shift that spans the clock change keeps its true ELAPSED length", () => {
    // 22:00 on the eve of spring-forward, for 8 ELAPSED hours.
    const shape = materialiseTemplate(
      {
        localStart: "22:00",
        durationMinutes: 480,
        breakOffsetMinutes: 240,
        breakMinutes: 30,
        timeZone: "America/New_York"
      },
      "2026-03-07"
    );

    expect(iso(shape.startsAt.getTime())).toBe("2026-03-08T03:00:00.000Z");
    expect(shape.endsAt.getTime() - shape.startsAt.getTime()).toBe(
      480 * 60_000
    );
    // On the wall clock the end reads 07:00 EDT, not 06:00: one hour was skipped.
    expect(iso(shape.endsAt.getTime())).toBe("2026-03-08T11:00:00.000Z");
    expect(iso(shape.breakStartsAt!.getTime())).toBe(
      "2026-03-08T07:00:00.000Z"
    );
    expect(iso(shape.breakEndsAt!.getTime())).toBe("2026-03-08T07:30:00.000Z");
  });

  test("an overnight shift in Jakarta crosses midnight as one interval", () => {
    const shape = materialiseTemplate(
      {
        localStart: "22:00",
        durationMinutes: 480,
        breakOffsetMinutes: null,
        breakMinutes: null,
        timeZone: "Asia/Jakarta"
      },
      "2026-10-12"
    );

    expect(iso(shape.startsAt.getTime())).toBe("2026-10-12T15:00:00.000Z");
    expect(iso(shape.endsAt.getTime())).toBe("2026-10-12T23:00:00.000Z");
    expect(shape.breakStartsAt).toBeNull();
  });

  test("isValidTimeZone refuses junk", () => {
    expect(isValidTimeZone("Asia/Jakarta")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("Asia/Jakarta; DROP TABLE")).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("interval algebra", () => {
  test("merge joins overlapping AND adjacent half-open spans, drops empties", () => {
    expect(
      mergeSpans([
        { start: 10, end: 20 },
        { start: 20, end: 30 },
        { start: 5, end: 8 },
        { start: 40, end: 40 },
        { start: 25, end: 28 }
      ])
    ).toEqual([
      { start: 5, end: 8 },
      { start: 10, end: 30 }
    ]);
  });

  test("subtract splits, trims and leaves a touching cut alone", () => {
    expect(
      subtractSpans([{ start: 0, end: 100 }], [{ start: 40, end: 60 }])
    ).toEqual([
      { start: 0, end: 40 },
      { start: 60, end: 100 }
    ]);
    expect(
      subtractSpans([{ start: 0, end: 100 }], [{ start: 100, end: 120 }])
    ).toEqual([{ start: 0, end: 100 }]);
    expect(
      subtractSpans([{ start: 0, end: 100 }], [{ start: -5, end: 200 }])
    ).toEqual([]);
  });

  test("clip bounds to the half-open window", () => {
    expect(
      clipSpans(
        [
          { start: 0, end: 50 },
          { start: 90, end: 120 },
          { start: 130, end: 140 }
        ],
        { start: 10, end: 100 }
      )
    ).toEqual([
      { start: 10, end: 50 },
      { start: 90, end: 100 }
    ]);
  });

  test("working time = work minus own break minus time off, clipped, adjacent work merged", () => {
    const spans = computeWorkingTime(
      [
        { kind: "work", start: 0, end: 100, breakStart: 40, breakEnd: 50 },
        {
          kind: "work",
          start: 100,
          end: 160,
          breakStart: null,
          breakEnd: null
        },
        {
          kind: "time_off",
          start: 150,
          end: 400,
          breakStart: null,
          breakEnd: null
        }
      ],
      { start: 10, end: 1000 }
    );

    expect(spans).toEqual([
      { start: 10, end: 40 },
      { start: 50, end: 150 }
    ]);
  });
});

describe("request validation", () => {
  test("template: strict, break must fit, zone must be real", () => {
    const base = {
      code: "MORNING",
      name: "Morning",
      localStart: "07:00",
      durationMinutes: 480,
      timeZone: "Asia/Jakarta"
    };

    expect(validateCreateTemplate(base).valid).toBe(true);
    expect(
      validateCreateTemplate({
        ...base,
        breakOffsetMinutes: 240,
        breakMinutes: 60
      }).valid
    ).toBe(true);

    for (const bad of [
      { ...base, localStart: "7:00" },
      { ...base, localStart: "24:00" },
      { ...base, durationMinutes: 0 },
      { ...base, durationMinutes: 14 },
      { ...base, durationMinutes: 1441 },
      { ...base, breakOffsetMinutes: 240 },
      { ...base, breakOffsetMinutes: 450, breakMinutes: 60 },
      { ...base, timeZone: "Mars/Olympus" },
      { ...base, code: "bad code" },
      { ...base, note: "free text" }
    ]) {
      expect(validateCreateTemplate(bad).valid).toBe(false);
    }
  });

  test("template patch: needs a field, can clear the break and the office", () => {
    expect(validateUpdateTemplate({}).valid).toBe(false);
    expect(validateUpdateTemplate({ code: "X" }).valid).toBe(false);

    const cleared = validateUpdateTemplate({
      breakOffsetMinutes: null,
      breakMinutes: null,
      officeId: null
    });

    expect(cleared.valid).toBe(true);
    if (cleared.valid) {
      expect(cleared.value.break).toBeNull();
      expect(cleared.value.officeId).toBeNull();
    }
  });

  test("assignment: explicit interval rules", () => {
    const work = {
      employmentId: E1,
      kind: "work",
      startsAt: "2026-10-12T01:00:00Z",
      endsAt: "2026-10-12T09:00:00Z",
      timeZone: "Asia/Jakarta"
    };

    expect(validateCreateAssignment(work).valid).toBe(true);
    expect(
      validateCreateAssignment({ ...work, endsAt: "2026-10-12T01:15:00Z" })
        .valid
    ).toBe(true);

    for (const bad of [
      { ...work, endsAt: "2026-10-12T01:00:00Z" },
      { ...work, endsAt: "2026-10-12T01:14:00Z" },
      { ...work, endsAt: "2026-10-13T01:00:01Z" },
      { ...work, endsAt: "2026-10-12T09:00:30Z" },
      { ...work, startsAt: "2026-10-12T01:00:00+07:00" },
      { ...work, startsAt: "2026-10-12 01:00:00" },
      { ...work, timeZone: undefined },
      { ...work, timeOffKind: "leave" },
      { ...work, reason: "flu" },
      { ...work, note: "x" },
      { ...work, breakStartsAt: "2026-10-12T04:00:00Z" },
      {
        ...work,
        breakStartsAt: "2026-10-12T00:00:00Z",
        breakEndsAt: "2026-10-12T02:00:00Z"
      },
      { ...work, templateId: T1, localDate: "2026-10-12" },
      { ...work, kind: "sabbatical" }
    ]) {
      expect(validateCreateAssignment(bad).valid).toBe(false);
    }
  });

  test("assignment: time off takes a coarse category, never a reason, and may run 31 days", () => {
    const off = {
      employmentId: E1,
      kind: "time_off",
      timeOffKind: "leave",
      startsAt: "2026-10-01T00:00:00Z",
      endsAt: "2026-10-31T00:00:00Z",
      timeZone: "Asia/Jakarta"
    };

    expect(validateCreateAssignment(off).valid).toBe(true);
    expect(
      validateCreateAssignment({ ...off, timeOffKind: undefined }).valid
    ).toBe(false);
    expect(
      validateCreateAssignment({ ...off, timeOffKind: "sick" }).valid
    ).toBe(false);
    expect(validateCreateAssignment({ ...off, reason: "chemo" }).valid).toBe(
      false
    );
    expect(
      validateCreateAssignment({ ...off, endsAt: "2026-11-02T00:00:00Z" }).valid
    ).toBe(false);
    expect(
      validateCreateAssignment({
        ...off,
        breakStartsAt: "2026-10-02T00:00:00Z",
        breakEndsAt: "2026-10-02T01:00:00Z"
      }).valid
    ).toBe(false);
  });

  test("assignment: template form excludes explicit fields and time off", () => {
    const viaTemplate = {
      employmentId: E1,
      kind: "work",
      templateId: T1,
      localDate: "2026-10-12"
    };

    expect(validateCreateAssignment(viaTemplate).valid).toBe(true);
    expect(
      validateCreateAssignment({ ...viaTemplate, localDate: "2026-02-30" })
        .valid
    ).toBe(false);
    expect(
      validateCreateAssignment({ ...viaTemplate, timeZone: "UTC" }).valid
    ).toBe(false);
    expect(
      validateCreateAssignment({
        ...viaTemplate,
        kind: "time_off",
        timeOffKind: "leave"
      }).valid
    ).toBe(false);
  });

  test("parseInstant accepts whole minutes in Z only", () => {
    expect(parseInstant("2026-10-12T01:00:00Z")).not.toBeNull();
    expect(parseInstant("2026-10-12T01:00Z")).not.toBeNull();
    expect(parseInstant("2026-10-12T01:00:00.000Z")).not.toBeNull();
    expect(parseInstant("2026-10-12T01:00:00.5Z")).toBeNull();
    expect(parseInstant("2026-10-12T01:00:30Z")).toBeNull();
    expect(parseInstant("2026-10-12T01:00:00")).toBeNull();
    expect(parseInstant("2026-13-12T01:00:00Z")).toBeNull();
  });
});

describe("StaffAvailabilityPort contract (a FAKE consumer and a FAKE provider)", () => {
  /** Stands in for Booking: it sees only the port type, never hr_workforce. */
  async function bookableAt(
    port: StaffAvailabilityPort,
    tx: Bun.SQL,
    staffRef: string,
    atUtc: string
  ): Promise<boolean> {
    const at = Date.parse(atUtc);
    const result = await port.getAvailability(tx, {
      staffRefs: [staffRef],
      fromUtc: new Date(at).toISOString(),
      toUtc: new Date(at + 60_000).toISOString()
    });
    const entry = result.staff.find((staff) => staff.staffRef === staffRef);

    // `unknown` is UNBOOKABLE; an empty `resolved` answer is "scheduled for nothing".
    return (
      entry?.status === "resolved" &&
      entry.intervals.some(
        (interval) =>
          Date.parse(interval.startUtc) <= at &&
          at < Date.parse(interval.endUtc)
      )
    );
  }

  const fake: StaffAvailabilityPort = {
    async getAvailability(_tx, query): Promise<StaffAvailabilityResult> {
      return {
        asOf: "2026-10-12T00:00:00.000Z",
        staff: query.staffRefs.map((staffRef) =>
          staffRef === "known"
            ? {
                staffRef,
                status: "resolved" as const,
                intervals: [
                  {
                    startUtc: "2026-10-12T01:00:00.000Z",
                    endUtc: "2026-10-12T09:00:00.000Z"
                  }
                ]
              }
            : { staffRef, status: "unknown" as const, intervals: [] }
        )
      };
    }
  };
  const noTx = {} as Bun.SQL;

  test("a consumer that sees only the port type can decide bookability", async () => {
    expect(await bookableAt(fake, noTx, "known", "2026-10-12T01:00:00Z")).toBe(
      true
    );
    expect(await bookableAt(fake, noTx, "known", "2026-10-12T09:00:00Z")).toBe(
      false
    );
    expect(
      await bookableAt(fake, noTx, "stranger", "2026-10-12T03:00:00Z")
    ).toBe(false);
  });

  test("the result shape is an allow-list of three fields per person", async () => {
    const result = await fake.getAvailability(noTx, {
      staffRefs: ["known"],
      fromUtc: "2026-10-12T00:00:00Z",
      toUtc: "2026-10-13T00:00:00Z"
    });

    expect(Object.keys(result).sort()).toEqual(["asOf", "staff"]);
    expect(Object.keys(result.staff[0]!).sort()).toEqual([
      "intervals",
      "staffRef",
      "status"
    ]);
  });

  test("the port file imports nothing (ADR-0011) and the module does not import booking", () => {
    const port = readFileSync(
      "src/modules/_shared/ports/staff-availability-port.ts",
      "utf8"
    );

    expect(port).not.toMatch(/^\s*import\s/m);

    for (const file of [
      "src/modules/hr-workforce/application/staff-availability-adapter.ts",
      "src/modules/hr-workforce/application/hr-shift-directory.ts"
    ]) {
      expect(readFileSync(file, "utf8")).not.toMatch(
        /from\s+["'][^"']*booking/i
      );
    }

    expect(hrWorkforceModule.dependencies).toEqual([
      "tenant_admin",
      "profile_identity"
    ]);
  });
});

describe("the adapter: caller errors and the source it reads", () => {
  const adapter = createStaffAvailabilityAdapter({
    now: () => new Date("2026-10-12T00:00:00Z")
  });
  // Every refusal below happens BEFORE any query, so this tx is never touched.
  const noTx = {} as Bun.SQL;
  const window = {
    fromUtc: "2026-10-12T00:00:00Z",
    toUtc: "2026-10-13T00:00:00Z"
  };

  test("caller errors are RangeErrors, raised before the database", async () => {
    const refs = (n: number) =>
      Array.from(
        { length: n },
        (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`
      );

    for (const query of [
      { staffRefs: [], ...window },
      { staffRefs: refs(201), ...window },
      { staffRefs: [E1], fromUtc: "2026-10-12T00:00:00", toUtc: window.toUtc },
      { staffRefs: [E1], fromUtc: window.toUtc, toUtc: window.fromUtc },
      { staffRefs: [E1], fromUtc: window.fromUtc, toUtc: window.fromUtc },
      {
        staffRefs: [E1],
        fromUtc: "2026-10-01T00:00:00Z",
        toUtc: "2026-11-06T00:00:01Z"
      },
      { staffRefs: [E1], ...window, officeId: "not-a-uuid" }
    ]) {
      await expect(adapter.getAvailability(noTx, query)).rejects.toBeInstanceOf(
        RangeError
      );
    }
  });

  test("duplicates collapse before the 200 bound is applied", async () => {
    // 300 asks for the same reference is ONE staff member: it must get past
    // the bound (and then fail on the stub tx, which proves it did).
    await expect(
      adapter.getAvailability(noTx, {
        staffRefs: Array.from({ length: 300 }, () => E1),
        ...window
      })
    ).rejects.not.toBeInstanceOf(RangeError);
  });

  test("a reference that is not a UUID is `unknown` without a database call", async () => {
    const result = await adapter.getAvailability(noTx, {
      staffRefs: ["alice", "../etc/passwd", "'; DROP TABLE x; --"],
      ...window
    });

    expect(result.asOf).toBe("2026-10-12T00:00:00.000Z");
    expect(result.staff.map((s) => s.status)).toEqual([
      "unknown",
      "unknown",
      "unknown"
    ]);
    expect(result.staff.every((s) => s.intervals.length === 0)).toBe(true);
  });

  test("its SQL names only the schedule tables and never a pay table or a name column", () => {
    const source = readFileSync(
      "src/modules/hr-workforce/application/staff-availability-adapter.ts",
      "utf8"
    );
    // Only SQL text: strip the doc comments, which are allowed to NAME what is forbidden.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    const tables = new Set(code.match(/awcms_[a-z_]+/g) ?? []);

    expect([...tables].sort()).toEqual([
      "awcms_hr_employment_terms",
      "awcms_hr_employments",
      "awcms_hr_shift_assignments"
    ]);
    expect(code).not.toMatch(
      /compensation|payroll|commission|payout|payslip|salary|awcms_profiles|display_name/i
    );
    // Writes and locks are not this port's business.
    expect(code).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b\s/i);
    expect(code).not.toMatch(/FOR\s+(UPDATE|SHARE)|pg_advisory/i);
  });
});
