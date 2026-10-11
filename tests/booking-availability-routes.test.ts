/**
 * Structural guarantees of the `booking` availability and schedule routes (Issue
 * #938) that no behavioural test can see by itself: each handler is wired
 * through the tenant-route factory with its OWN permission, the availability
 * read is rate limited, and the pure domain files stay free of I/O.
 *
 * Comments are stripped first: a rule named only in a comment must not satisfy
 * an assertion about the code.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const ROUTES = "src/pages/api/v1/booking";
const DOMAIN = "src/modules/booking/domain";

describe("route wiring", () => {
  const expected: [string, string, string][] = [
    [`${ROUTES}/availability.ts`, "GET", "availability.read"],
    [`${ROUTES}/schedules/index.ts`, "GET", "schedules.read"],
    [`${ROUTES}/schedules/index.ts`, "POST", "schedules.create"],
    [`${ROUTES}/schedules/[id].ts`, "GET", "schedules.read"],
    [`${ROUTES}/schedules/[id].ts`, "PATCH", "schedules.update"],
    [`${ROUTES}/schedules/[id].ts`, "DELETE", "schedules.delete"],
    [`${ROUTES}/schedule-exceptions/index.ts`, "GET", "schedules.read"],
    [`${ROUTES}/schedule-exceptions/index.ts`, "POST", "schedules.create"],
    [`${ROUTES}/schedule-exceptions/[id].ts`, "DELETE", "schedules.delete"]
  ];

  test.each(expected)(
    "%s %s is guarded by BOOKING_GUARDS.%s",
    (file, verb, guard) => {
      const source = code(file);
      const start = source.indexOf(`export const ${verb} = defineTenantRoute`);

      expect(start).toBeGreaterThanOrEqual(0);

      const next = source.indexOf("export const ", start + 10);
      const block = source.slice(start, next === -1 ? undefined : next);

      expect(block).toContain(`authorize: BOOKING_GUARDS.${guard}`);
      expect(block).toContain('workClass: "interactive"');
    }
  );

  test("every booking route file declares only seeded permissions", () => {
    const seeded = readFileSync(
      "sql/181_awcms_booking_permissions.sql",
      "utf8"
    );

    for (const [, , guard] of expected) {
      const [activity, action] = guard.split(".");

      expect(seeded).toContain(`('booking', '${activity}', '${action}'`);
    }
  });

  test("the availability read is rate limited per principal, after authorization", () => {
    const source = code(`${ROUTES}/availability.ts`);

    expect(source).toContain("checkSharedRateLimit");
    expect(source).toContain('"RATE_LIMITED"');
    expect(source).toContain("retry-after");
    expect(source.indexOf("checkSharedRateLimit(")).toBeGreaterThan(
      source.indexOf("handler:")
    );
  });

  test("the availability read never writes", () => {
    const directory = code(
      "src/modules/booking/application/booking-availability-directory.ts"
    );

    expect(directory).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });
});

describe("the calculation is pure", () => {
  const pure = [
    "booking-time.ts",
    "booking-schedule.ts",
    "booking-availability.ts",
    "booking-validation.ts",
    "booking-staff-availability.ts"
  ];

  test.each(pure)("%s has no I/O, clock or randomness", (file) => {
    const source = code(join(DOMAIN, file));

    expect(source).not.toMatch(/\bDate\.now\s*\(/);
    expect(source).not.toMatch(/new Date\s*\(\s*\)/);
    expect(source).not.toMatch(/Math\.random/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(
      /from\s+["'][^"']*(database|logging|application)[^"']*["']/
    );
    expect(source).not.toMatch(/\bBun\./);
    expect(source).not.toMatch(/process\.env/);
  });

  test("the staff seam does not import the hr_workforce port", () => {
    const source = code(join(DOMAIN, "booking-staff-availability.ts"));

    expect(source).not.toMatch(/_shared\/ports/);
  });

  test("the no-op seam imposes no constraint", async () => {
    const { NO_OP_STAFF_AVAILABILITY } =
      await import("../src/modules/booking/domain/booking-staff-availability");

    expect(
      await NO_OP_STAFF_AVAILABILITY.resolve({
        tenantId: "t",
        staffRole: null,
        fromMs: 0,
        toMs: 1
      })
    ).toBeNull();
  });
});
