/**
 * The pure staff rules of `booking` (Issue #949; booking.md section 10.3) and
 * the composition boundary (ADR-0011): only `module.ts` reaches `hr_workforce`.
 */
import { describe, expect, test } from "bun:test";

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  buildStaffAllows,
  coversInterval,
  eligibleFor,
  overlapsAny,
  toWorkingIntervals,
  type StaffCandidate
} from "../src/modules/booking/domain/booking-staff-availability";

const t = (iso: string) => Date.parse(iso);
const H = 3_600_000;
const NINE = t("2029-01-08T09:00:00Z");

describe("toWorkingIntervals", () => {
  test("unknown (and absent) is not bookable", () => {
    expect(toWorkingIntervals(undefined)).toBeNull();
    expect(
      toWorkingIntervals({ staffRef: "a", status: "unknown", intervals: [] })
    ).toBeNull();
  });

  test("resolved with no intervals is scheduled for nothing, not unknown", () => {
    expect(
      toWorkingIntervals({ staffRef: "a", status: "resolved", intervals: [] })
    ).toEqual([]);
  });

  test("converts and sorts", () => {
    expect(
      toWorkingIntervals({
        staffRef: "a",
        status: "resolved",
        intervals: [
          { startUtc: "2029-01-08T12:00:00Z", endUtc: "2029-01-08T13:00:00Z" },
          { startUtc: "2029-01-08T09:00:00Z", endUtc: "2029-01-08T10:00:00Z" }
        ]
      })?.map((interval) => interval.fromMs)
    ).toEqual([NINE, NINE + 3 * H]);
  });
});

describe("coversInterval and overlapsAny are half-open", () => {
  const working = [{ fromMs: NINE, toMs: NINE + 3 * H }];

  test("a service must sit inside ONE working interval", () => {
    expect(coversInterval(working, NINE, NINE + H)).toBe(true);
    expect(coversInterval(working, NINE + 2 * H, NINE + 3 * H)).toBe(true);
    expect(coversInterval(working, NINE + 2 * H, NINE + 3 * H + 1)).toBe(false);
    expect(coversInterval(working, NINE - 1, NINE + H)).toBe(false);
    expect(
      coversInterval(
        [
          { fromMs: NINE, toMs: NINE + H },
          { fromMs: NINE + H + 1, toMs: NINE + 3 * H }
        ],
        NINE + H / 2,
        NINE + 2 * H
      )
    ).toBe(false);
  });

  test("adjacent claims do not overlap", () => {
    const busy = [{ fromMs: NINE, toMs: NINE + H }];

    expect(overlapsAny(busy, NINE + H, NINE + 2 * H)).toBe(false);
    expect(overlapsAny(busy, NINE - H, NINE)).toBe(false);
    expect(overlapsAny(busy, NINE + H - 1, NINE + 2 * H)).toBe(true);
  });
});

describe("eligibleFor", () => {
  const candidates: StaffCandidate[] = [
    { staffRef: "unknown", working: null, busy: [] },
    {
      staffRef: "busy",
      working: [{ fromMs: NINE, toMs: NINE + 4 * H }],
      busy: [{ fromMs: NINE, toMs: NINE + H }]
    },
    {
      staffRef: "free",
      working: [{ fromMs: NINE, toMs: NINE + 4 * H }],
      busy: []
    },
    { staffRef: "off", working: [], busy: [] }
  ];

  test("keeps the order given and drops unknown, busy and not-working people", () => {
    expect(eligibleFor(candidates, NINE, NINE + H)).toEqual(["free"]);
    expect(eligibleFor(candidates, NINE + H, NINE + 2 * H)).toEqual([
      "busy",
      "free"
    ]);
  });

  test("a resource whose candidates are all unknown is unbookable (fail closed)", () => {
    const allows = buildStaffAllows([
      { staffRef: "a", working: null, busy: [] },
      { staffRef: "b", working: null, busy: [] }
    ]);

    expect(allows(NINE, NINE + H)).toBe(false);
  });

  test("the predicate agrees with eligibleFor", () => {
    const allows = buildStaffAllows(candidates);

    expect(allows(NINE, NINE + H)).toBe(true);
    expect(allows(NINE + 4 * H, NINE + 5 * H)).toBe(false);
  });
});

describe("booking's asks stay within the port's limits (L2)", () => {
  test("the availability window and the candidate list fit the port", async () => {
    const { AVAILABILITY_LIMITS } =
      await import("../src/modules/booking/domain/booking-availability");
    const { SHIFT_LIMITS } =
      await import("../src/modules/hr-workforce/domain/hr-shift-types");
    const { MAX_STAFF_CANDIDATES } =
      await import("../src/modules/booking/application/booking-staff-availability-consumer");

    // The read path asks the port for the whole search window.
    expect(AVAILABILITY_LIMITS.maxSlotWindowDays).toBeLessThanOrEqual(
      SHIFT_LIMITS.availabilityMaxWindowDays
    );
    // The consumer never sends more references than the port accepts, and the
    // table CHECK (sql/305) states the same cap.
    expect(MAX_STAFF_CANDIDATES).toBeLessThanOrEqual(
      SHIFT_LIMITS.availabilityMaxStaff
    );
    expect(
      await Bun.file("sql/305_awcms_booking_staff_assignments.sql").text()
    ).toContain(`cardinality(required_staff_refs) <= ${MAX_STAFF_CANDIDATES}`);
  });
});

describe("composition boundary (ADR-0011)", () => {
  test("only module.ts imports hr_workforce, and lazily", async () => {
    const root = "src/modules/booking";
    const offenders: string[] = [];

    async function walk(directory: string): Promise<void> {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);

        if (entry.isDirectory()) {
          await walk(path);
        } else if (
          entry.name.endsWith(".ts") &&
          path !== join(root, "module.ts")
        ) {
          if (
            /hr-workforce|hr_workforce\//.test(await readFile(path, "utf8"))
          ) {
            // The provider's module KEY as a string constant is not an import.
            const imports = (await readFile(path, "utf8"))
              .split("\n")
              .filter((line) =>
                /(from|import\()\s*["'][^"']*hr-workforce/.test(line)
              );

            if (imports.length > 0) {
              offenders.push(path);
            }
          }
        }
      }
    }

    await walk(root);
    expect(offenders).toEqual([]);

    const moduleSource = await readFile(join(root, "module.ts"), "utf8");

    expect(moduleSource).toMatch(
      /await import\("\.\.\/hr-workforce\/application\/staff-availability-adapter"\)/
    );
    expect(moduleSource).not.toMatch(/^import .*hr-workforce/m);
    expect(moduleSource).toMatch(
      /capability: "staff_availability",\s*providedBy: "hr_workforce",\s*optional: true/
    );
  });
});
