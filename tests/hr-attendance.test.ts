/**
 * Attendance and corrections, pure parts (Issue #947, ADR-0132): request
 * validation, the permission catalogue against its SQL seed, and the
 * source-text guarantees (no location column, no reason in an audit row or a
 * workflow fact, no mutation of an event). No database.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

import {
  parseAttendanceInstant,
  validateCreateAttendanceEvent,
  validateCreateCorrection
} from "../src/modules/hr-workforce/domain/hr-attendance-validation";
import { refusalOf } from "../src/modules/hr-workforce/application/hr-attendance-directory";
import { HR_WORKFORCE_GUARDS } from "../src/modules/hr-workforce/domain/hr-workforce-permissions";
import { hrWorkforceModule } from "../src/modules/hr-workforce/module";

const E1 = "11111111-1111-4111-8111-111111111111";
const T1 = "22222222-2222-4222-8222-222222222222";

const event = (extra: Record<string, unknown> = {}) => ({
  employmentId: E1,
  kind: "clock_in",
  occurredAt: "2026-10-12T08:00:00Z",
  source: "self",
  clientEventKey: "queue-1",
  ...extra
});

const correction = (extra: Record<string, unknown> = {}) => ({
  employmentId: E1,
  kind: "add",
  proposedKind: "clock_out",
  proposedOccurredAt: "2026-10-12T17:00:00Z",
  reason: "Forgot to clock out",
  ...extra
});

describe("instants", () => {
  test("a UTC instant with seconds, optional milliseconds, ending in Z", () => {
    expect(parseAttendanceInstant("2026-10-12T08:00:00Z")?.toISOString()).toBe(
      "2026-10-12T08:00:00.000Z"
    );
    expect(parseAttendanceInstant("2026-10-12T08:00:00.250Z")).not.toBeNull();

    for (const bad of [
      "2026-10-12T08:00:00",
      "2026-10-12T08:00:00+07:00",
      "2026-10-12",
      "2026-02-30T08:00:00Z",
      "2026-13-01T08:00:00Z",
      "now",
      42,
      null
    ]) {
      expect(parseAttendanceInstant(bad)).toBeNull();
    }
  });
});

describe("validateCreateAttendanceEvent", () => {
  test("accepts the four kinds and the four client sources", () => {
    for (const kind of ["clock_in", "clock_out", "break_start", "break_end"]) {
      expect(validateCreateAttendanceEvent(event({ kind })).valid).toBe(true);
    }

    for (const source of ["self", "supervisor", "kiosk", "import"]) {
      expect(validateCreateAttendanceEvent(event({ source })).valid).toBe(true);
    }
  });

  test("`correction` is not a source a client may claim", () => {
    expect(
      validateCreateAttendanceEvent(event({ source: "correction" })).valid
    ).toBe(false);
  });

  test("an unknown key is refused: no location, photo, device, recorded time or late flag can be asserted", () => {
    for (const extra of [
      { recordedAt: "2026-10-12T08:00:00Z" },
      { late: true },
      { latitude: 1 },
      { longitude: 1 },
      { location: { lat: 1 } },
      { accuracy: 5 },
      { photo: "x" },
      { deviceId: "x" },
      { ip: "10.0.0.1" },
      { supersedesEventId: E1 }
    ]) {
      expect(validateCreateAttendanceEvent(event(extra)).valid).toBe(false);
    }
  });

  test("shape: uuid ids, a bounded key, a real instant", () => {
    for (const bad of [
      { employmentId: "nope" },
      { officeId: "nope" },
      { clientEventKey: "" },
      { clientEventKey: " leading-space" },
      { clientEventKey: "a".repeat(129) },
      { clientEventKey: "has space" },
      { occurredAt: "2026-10-12" },
      { kind: "lunch" }
    ]) {
      expect(validateCreateAttendanceEvent(event(bad)).valid).toBe(false);
    }

    expect(validateCreateAttendanceEvent(event({ officeId: T1 })).valid).toBe(
      true
    );
    expect(validateCreateAttendanceEvent(null).valid).toBe(false);
    expect(validateCreateAttendanceEvent([]).valid).toBe(false);
  });
});

describe("validateCreateCorrection", () => {
  test("add has no target; replace needs one", () => {
    expect(validateCreateCorrection(correction()).valid).toBe(true);
    expect(
      validateCreateCorrection(
        correction({ kind: "replace", targetEventId: T1 })
      ).valid
    ).toBe(true);
    expect(
      validateCreateCorrection(correction({ kind: "replace" })).valid
    ).toBe(false);
    expect(
      validateCreateCorrection(correction({ kind: "add", targetEventId: T1 }))
        .valid
    ).toBe(false);
    expect(validateCreateCorrection(correction({ kind: "void" })).valid).toBe(
      false
    );
  });

  test("a reason is mandatory, trimmed, bounded and free of control characters", () => {
    const parsed = validateCreateCorrection(
      correction({ reason: "  spaced  " })
    );

    expect(parsed.valid && parsed.value.reason).toBe("spaced");

    for (const reason of [
      undefined,
      null,
      "",
      "   ",
      "x".repeat(501),
      "a\u0000b",
      5
    ]) {
      expect(validateCreateCorrection(correction({ reason })).valid).toBe(
        false
      );
    }

    expect(
      validateCreateCorrection(correction({ reason: "two\nlines\tand tab" }))
        .valid
    ).toBe(true);
  });

  test("an unknown key is refused (no status, no workflow id, no decider, no location)", () => {
    for (const extra of [
      { status: "approved" },
      { workflowInstanceId: T1 },
      { decidedBy: T1 },
      { latitude: 1 },
      { photo: "x" }
    ]) {
      expect(validateCreateCorrection(correction(extra)).valid).toBe(false);
    }
  });
});

describe("the permission catalogue", () => {
  const seed = readFileSync(
    "sql/199_awcms_hr_attendance_permissions.sql",
    "utf8"
  );
  const seeded = [
    ...seed.matchAll(
      /\('hr_workforce', '([a-z_]+)', '([a-z_]+)',\s*'((?:[^']|'')*)'\)/g
    )
  ].map((m) => ({
    activityCode: m[1]!,
    action: m[2]!,
    description: m[3]!.replace(/''/g, "'")
  }));
  const declared = (hrWorkforceModule.permissions ?? []).filter((p) =>
    ["clock", "attendance", "corrections"].includes(p.activityCode)
  );

  test("the module descriptor and the SQL seed agree verbatim", () => {
    expect(seeded.length).toBe(7);
    expect(
      [...declared].sort((a, b) =>
        `${a.activityCode}.${a.action}`.localeCompare(
          `${b.activityCode}.${b.action}`
        )
      )
    ).toEqual(
      [...seeded].sort((a, b) =>
        `${a.activityCode}.${a.action}`.localeCompare(
          `${b.activityCode}.${b.action}`
        )
      )
    );
  });

  test("every guard literal names a declared permission", () => {
    const guards = [
      HR_WORKFORCE_GUARDS.clock.create,
      HR_WORKFORCE_GUARDS.attendance.read,
      HR_WORKFORCE_GUARDS.attendance.create,
      HR_WORKFORCE_GUARDS.corrections.read,
      HR_WORKFORCE_GUARDS.corrections.create,
      HR_WORKFORCE_GUARDS.corrections.cancel,
      HR_WORKFORCE_GUARDS.corrections.approve
    ];

    for (const guard of guards) {
      expect(
        declared.some(
          (p) =>
            p.activityCode === guard.activityCode && p.action === guard.action
        )
      ).toBe(true);
    }
  });

  test("the only permissions that touch evidence or location are ADR-0138's two (Issue #970); none for photo or biometric", () => {
    const allowed = [
      "attendance_evidence.read",
      "geolocation_evidence.configure"
    ];

    for (const p of hrWorkforceModule.permissions ?? []) {
      const key = `${p.activityCode}.${p.action}`;

      expect(key).not.toMatch(/photo|biometric|fingerprint|device/i);

      if (/evidence|geolocation|location/i.test(key)) {
        expect(allowed).toContain(key);
      }
    }
  });
});

describe("source-text guarantees", () => {
  const directory = readFileSync(
    "src/modules/hr-workforce/application/hr-attendance-directory.ts",
    "utf8"
  );
  const code = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  test("no audit row carries the reason or the proposed instant", () => {
    const blocks = [
      ...code(directory).matchAll(/attributes:\s*\{[\s\S]*?\n\s*\}/g)
    ].map((m) => m[0]);

    expect(blocks.length).toBeGreaterThanOrEqual(3);

    for (const block of blocks) {
      expect(block).not.toMatch(/reason|proposedOccurredAt|occurredAt/i);
    }
  });

  test("the workflow instance is started with NO facts", () => {
    const start = code(directory).match(
      /startWorkflowInstance\(sp, \{[\s\S]*?\}\)/
    )![0];

    expect(start).not.toMatch(/facts/);
    expect(start).not.toMatch(/reason/);
  });

  test("the directory never UPDATEs or DELETEs an event, and only moves a correction's status", () => {
    const text = code(directory);

    expect(text).not.toMatch(/UPDATE\s+awcms_hr_attendance_events/);
    expect(text).not.toMatch(/DELETE\s+FROM\s+awcms_hr_attendance_/);

    for (const update of text.matchAll(
      /UPDATE\s+awcms_hr_attendance_corrections\s+SET([\s\S]*?)WHERE/g
    )) {
      expect(update[1]).toMatch(/status\s*=/);
      expect(update[1]).not.toMatch(
        /\b(reason|proposed_[a-z_]+|requested_by|kind|target_event_id)\s*=/
      );
    }
  });

  test("the reason column is selected only on the single read, behind the caller-visibility flag", () => {
    const text = code(directory);

    expect(text.match(/c\.reason/g)?.length).toBe(1);
    expect(text).toMatch(/options\.includeReason \? ", c\.reason" : ""/);
    // And no write path asks for it.
    expect(text).not.toMatch(/includeReason:\s*true/);
  });

  test("no attendance migration, route or domain file names a location, photo or device column", () => {
    const files = [
      "sql/198_awcms_hr_attendance_schema.sql",
      "src/modules/hr-workforce/domain/hr-attendance-types.ts",
      ...readdirSync("src/pages/api/v1/hr-workforce/attendance-events").map(
        (f) => `src/pages/api/v1/hr-workforce/attendance-events/${f}`
      )
    ];

    for (const file of files) {
      // Comments and COMMENT ON strings legitimately say what is NOT stored.
      const text = code(
        readFileSync(file, "utf8")
          .replace(/^--.*$/gm, "")
          .replace(/COMMENT ON [\s\S]*?';/g, "")
      );

      expect(text).not.toMatch(
        /\b(latitude|longitude|geo_?location|gps|photo|biometric|fingerprint|device_id|ssid)\b/i
      );
    }
  });
});

describe("database refusals are named, never a 500 (Issue #947)", () => {
  test("the correction guard's own refusals map to a named reason, like the event guard's", () => {
    const named: Record<string, string> = {
      HR_ATTENDANCE_FUTURE: "future",
      HR_CORRECTION_SELF_APPROVAL: "self_approval",
      HR_CORRECTION_NO_APPROVER: "no_approver",
      HR_CORRECTION_VERDICT_MISMATCH: "verdict_mismatch"
    };

    for (const [tag, reason] of Object.entries(named)) {
      expect(refusalOf(new Error(`awcms_hr: ${tag}`))).toBe(reason as never);
    }

    expect(refusalOf(new Error("connection reset"))).toBeNull();
    expect(refusalOf("not an error")).toBeNull();
  });

  test("every status-move refusal the SQL raises on `approved` has a mapping", () => {
    const sql = readFileSync(
      "sql/198_awcms_hr_attendance_schema.sql",
      "utf8"
    ).replace(/^--.*$/gm, "");

    for (const tag of [
      "HR_CORRECTION_SELF_APPROVAL",
      "HR_CORRECTION_NO_APPROVER",
      "HR_CORRECTION_VERDICT_MISMATCH"
    ]) {
      expect(sql).toContain(tag);
      expect(refusalOf(new Error(`awcms_hr: ${tag}`))).not.toBeNull();
    }
  });
});
