/**
 * Geolocation attendance evidence, the parts that need no database (Issue #970,
 * ADR-0138): the pure evaluator, the strict validators, the redaction walls and
 * the source-text guarantees ("no coordinate anywhere").
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";

import {
  accuracyBandOf,
  distanceBandOf,
  evaluatePositionSample,
  haversineMeters,
  measureAgainstGeofence
} from "../src/modules/hr-workforce/domain/hr-geolocation-evaluator";
import {
  GEO_LIMITS,
  isGeoEligibleEvent,
  type Geofence
} from "../src/modules/hr-workforce/domain/hr-geolocation-types";
import {
  parsePositionSample,
  validateAcknowledgement,
  validateGeofence,
  validateGeolocationSettings,
  validateNotice
} from "../src/modules/hr-workforce/domain/hr-geolocation-validation";
import { validateCreateAttendanceEvent } from "../src/modules/hr-workforce/domain/hr-attendance-validation";
import {
  findSensitiveKeys,
  redactSecretsInText,
  redactSensitiveAttributes
} from "../src/modules/_shared/redaction";
import { OWNER_GRANT_EXCLUDED_PERMISSION_KEYS } from "../src/modules/_shared/owner-grant-exclusions";
import { hrWorkforceModule } from "../src/modules/hr-workforce/module";

// A distinctive point: Jakarta, Monas. Offsets below are in metres.
const LAT = -6.175392;
const LON = 106.827153;
const METRE_LAT = 1 / 111_195; // degrees of latitude per metre

const circle = (radiusMeters: number, id = "g-circle"): Geofence => ({
  id,
  officeId: "office-1",
  label: "HQ",
  shape: "circle",
  latitude: LAT,
  longitude: LON,
  radiusMeters,
  vertices: null
});

// A ~200 m square centred on the point.
const square = (id = "g-square"): Geofence => ({
  id,
  officeId: "office-1",
  label: "Yard",
  shape: "polygon",
  latitude: null,
  longitude: null,
  radiusMeters: null,
  vertices: [
    [LAT + 100 * METRE_LAT, LON - 100 * METRE_LAT],
    [LAT + 100 * METRE_LAT, LON + 100 * METRE_LAT],
    [LAT - 100 * METRE_LAT, LON + 100 * METRE_LAT],
    [LAT - 100 * METRE_LAT, LON - 100 * METRE_LAT]
  ]
});

const at = (northMeters: number, accuracyMeters = 10) => ({
  latitude: LAT + northMeters * METRE_LAT,
  longitude: LON,
  accuracyMeters
});

describe("the pure evaluator", () => {
  test("haversine is metres, to within a metre over 100 m", () => {
    expect(
      Math.abs(haversineMeters(LAT, LON, LAT + 100 * METRE_LAT, LON) - 100)
    ).toBeLessThan(1);
  });

  test("a sample in a circle is inside, in the 'within' band, naming that geofence", () => {
    const result = evaluatePositionSample(at(20), [circle(100)], 100);

    expect(result).toEqual({
      verdict: "inside",
      distanceBand: "within",
      accuracyBand: "lt_25m",
      geofenceId: "g-circle"
    });
  });

  test("outside is banded by the distance to the BOUNDARY, never an exact figure", () => {
    const fence = circle(100);

    expect(evaluatePositionSample(at(150), [fence], 100).distanceBand).toBe(
      "lt_250m"
    );
    expect(evaluatePositionSample(at(700), [fence], 100).distanceBand).toBe(
      "lt_1km"
    );
    expect(evaluatePositionSample(at(5000), [fence], 100).distanceBand).toBe(
      "gte_1km"
    );
    expect(evaluatePositionSample(at(150), [fence], 100).verdict).toBe(
      "outside"
    );
  });

  test("a polygon: inside, just outside, and far outside", () => {
    expect(evaluatePositionSample(at(0), [square()], 100).verdict).toBe(
      "inside"
    );
    expect(evaluatePositionSample(at(130), [square()], 100)).toMatchObject({
      verdict: "outside",
      distanceBand: "lt_250m"
    });
    expect(evaluatePositionSample(at(3000), [square()], 100)).toMatchObject({
      verdict: "outside",
      distanceBand: "gte_1km"
    });
  });

  test("a sample worse than the accuracy ceiling is not_provided, NEVER inside, and no distance is derived", () => {
    // Dead centre of the fence, but the fix is 400 m wide: it proves nothing.
    const result = evaluatePositionSample(at(0, 400), [circle(100)], 100);

    expect(result.verdict).toBe("not_provided");
    expect(result.distanceBand).toBeNull();
    expect(result.geofenceId).toBeNull();
    expect(result.accuracyBand).toBe("lt_500m");
  });

  test("the ceiling is inclusive: exactly at it is still evaluated", () => {
    expect(evaluatePositionSample(at(0, 100), [circle(100)], 100).verdict).toBe(
      "inside"
    );
    expect(
      evaluatePositionSample(at(0, 100.5), [circle(100)], 100).verdict
    ).toBe("not_provided");
  });

  test("no sample (declined / no fix) and no geofence are both not_provided", () => {
    expect(evaluatePositionSample(null, [circle(100)], 100)).toEqual({
      verdict: "not_provided",
      distanceBand: null,
      accuracyBand: null,
      geofenceId: null
    });
    expect(evaluatePositionSample(at(0), [], 100)).toMatchObject({
      verdict: "not_provided",
      geofenceId: null
    });
  });

  test("inside any geofence wins; otherwise the nearest; ties are by id, independent of order", () => {
    const near = circle(50, "b-near");
    const far = { ...circle(50, "a-far"), latitude: LAT + 1000 * METRE_LAT };
    const sample = at(100);

    expect(evaluatePositionSample(sample, [far, near], 100).geofenceId).toBe(
      "b-near"
    );
    expect(evaluatePositionSample(sample, [near, far], 100).geofenceId).toBe(
      "b-near"
    );
    // The point is inside `wide`, outside `near`: inside beats nearer.
    const wide = circle(300, "z-wide");

    expect(evaluatePositionSample(sample, [near, wide], 100)).toMatchObject({
      verdict: "inside",
      geofenceId: "z-wide"
    });
    const twinA = circle(50, "a");
    const twinB = circle(50, "b");

    expect(
      evaluatePositionSample(at(500), [twinB, twinA], 100).geofenceId
    ).toBe("a");
  });

  test("the result carries no coordinate and no raw accuracy", () => {
    const result = evaluatePositionSample(
      { latitude: 12.3456789, longitude: 98.7654321, accuracyMeters: 7.77 },
      [circle(100)],
      100
    );
    const text = JSON.stringify(result);

    expect(text).not.toContain("12.3456789");
    expect(text).not.toContain("98.7654321");
    expect(text).not.toContain("7.77");
    expect(Object.keys(result).sort()).toEqual([
      "accuracyBand",
      "distanceBand",
      "geofenceId",
      "verdict"
    ]);
  });

  test("band edges", () => {
    expect(accuracyBandOf(24.9)).toBe("lt_25m");
    expect(accuracyBandOf(25)).toBe("lt_100m");
    expect(accuracyBandOf(99.9)).toBe("lt_100m");
    expect(accuracyBandOf(100)).toBe("lt_500m");
    expect(accuracyBandOf(500)).toBe("gte_500m");
    expect(distanceBandOf(true, 0)).toBe("within");
    expect(distanceBandOf(false, 249)).toBe("lt_250m");
    expect(distanceBandOf(false, 250)).toBe("lt_1km");
    expect(distanceBandOf(false, 1000)).toBe("gte_1km");
  });

  test("a malformed stored geofence is skipped, not trusted", () => {
    expect(
      measureAgainstGeofence(at(0), { ...circle(100), radiusMeters: null })
    ).toBeNull();
    expect(
      measureAgainstGeofence(at(0), { ...square(), vertices: [[1, 1]] })
    ).toBeNull();
  });

  test("only a self clock_in / clock_out is eligible", () => {
    expect(isGeoEligibleEvent("clock_in", "self")).toBe(true);
    expect(isGeoEligibleEvent("clock_out", "self")).toBe(true);
    for (const source of ["supervisor", "kiosk", "import", "correction"]) {
      expect(isGeoEligibleEvent("clock_in", source)).toBe(false);
    }
    expect(isGeoEligibleEvent("break_start", "self")).toBe(false);
    expect(isGeoEligibleEvent("break_end", "self")).toBe(false);
  });
});

describe("the position sample validator", () => {
  const base = {
    employmentId: "11111111-1111-4111-8111-111111111111",
    kind: "clock_in",
    occurredAt: "2026-10-12T08:00:00Z",
    source: "self",
    clientEventKey: "k-1"
  };
  const sample = { latitude: -6.2, longitude: 106.8, accuracyMeters: 12 };

  test("a self clock_in / clock_out may carry a well-formed sample, or null, or none", () => {
    for (const kind of ["clock_in", "clock_out"]) {
      const result = validateCreateAttendanceEvent({
        ...base,
        kind,
        positionSample: sample
      });

      expect(result.valid).toBe(true);
    }

    for (const positionSample of [null, undefined]) {
      const result = validateCreateAttendanceEvent({ ...base, positionSample });

      expect(result.valid).toBe(true);
      expect(result.valid && result.value.positionSample).toBeNull();
    }
  });

  test("kiosk, import, supervisor and any break event are refused when they carry a sample", () => {
    for (const source of ["kiosk", "import", "supervisor"]) {
      expect(
        validateCreateAttendanceEvent({
          ...base,
          source,
          positionSample: sample
        }).valid
      ).toBe(false);
    }

    for (const kind of ["break_start", "break_end"]) {
      expect(
        validateCreateAttendanceEvent({
          ...base,
          kind,
          positionSample: sample
        }).valid
      ).toBe(false);
    }
  });

  test("the sample accepts exactly three numbers: altitude, speed, heading, address and device are refused, not ignored", () => {
    for (const extra of [
      { altitude: 3 },
      { speed: 1 },
      { heading: 90 },
      { address: "Jl. X" },
      { deviceId: "abc" },
      { ssid: "wifi" }
    ]) {
      expect(
        validateCreateAttendanceEvent({
          ...base,
          positionSample: { ...sample, ...extra }
        }).valid
      ).toBe(false);
    }
  });

  test("ranges and types", () => {
    for (const bad of [
      { ...sample, latitude: 91 },
      { ...sample, latitude: -91 },
      { ...sample, longitude: 181 },
      { ...sample, latitude: "1" },
      { ...sample, latitude: Number.NaN },
      { ...sample, accuracyMeters: 0 },
      { ...sample, accuracyMeters: -1 },
      { ...sample, accuracyMeters: GEO_LIMITS.maxReportedAccuracyMeters + 1 },
      { latitude: 1, longitude: 1 },
      "here",
      [1, 2, 3]
    ]) {
      expect(
        validateCreateAttendanceEvent({ ...base, positionSample: bad }).valid
      ).toBe(false);
    }
  });

  test("a refusal names the field and NEVER echoes the value", () => {
    const secret = 7.123456789;
    const errors: { field: string; message: string }[] = [];

    parsePositionSample(
      { latitude: 91.987654321, longitude: secret, accuracyMeters: -3.14159 },
      errors
    );
    const result = validateCreateAttendanceEvent({
      ...base,
      source: "kiosk",
      positionSample: {
        latitude: 5.5555555,
        longitude: secret,
        accuracyMeters: 4
      }
    });
    const text = JSON.stringify([errors, result]);

    expect(errors.length).toBeGreaterThan(0);
    expect(text).not.toContain("91.987654321");
    expect(text).not.toContain("7.123456789");
    expect(text).not.toContain("3.14159");
    expect(text).not.toContain("5.5555555");
  });

  test("the old top-level location fields are still refused", () => {
    for (const extra of [
      { latitude: 1 },
      { longitude: 1 },
      { location: { lat: 1 } },
      { accuracy: 5 },
      { photo: "x" },
      { deviceId: "x" }
    ]) {
      expect(validateCreateAttendanceEvent({ ...base, ...extra }).valid).toBe(
        false
      );
    }
  });
});

describe("the configuration validators", () => {
  test("settings: enabled is required and boolean; bounds on the ceiling; unknown keys refused", () => {
    expect(validateGeolocationSettings({}).valid).toBe(false);
    expect(validateGeolocationSettings({ enabled: "yes" }).valid).toBe(false);
    expect(validateGeolocationSettings({ enabled: false }).valid).toBe(true);
    expect(
      validateGeolocationSettings({ enabled: true, accuracyCeilingMeters: 9 })
        .valid
    ).toBe(false);
    expect(
      validateGeolocationSettings({ enabled: true, accuracyCeilingMeters: 501 })
        .valid
    ).toBe(false);
    expect(
      validateGeolocationSettings({
        enabled: true,
        dpiaRecordedOn: "2026-02-30"
      }).valid
    ).toBe(false);
    expect(
      validateGeolocationSettings({ enabled: false, locationHistory: true })
        .valid
    ).toBe(false);

    const ok = validateGeolocationSettings({
      enabled: true,
      accuracyCeilingMeters: 50,
      dpiaReference: " DPIA-2026-007 ",
      dpiaRecordedOn: "2026-10-01",
      noticeId: "11111111-1111-4111-8111-111111111111"
    });

    expect(ok.valid && ok.value.dpiaReference).toBe("DPIA-2026-007");
  });

  test("geofence: a circle needs centre + radius, a polygon needs 3-32 vertices, the shapes do not mix", () => {
    const office = "11111111-1111-4111-8111-111111111111";

    expect(
      validateGeofence({
        officeId: office,
        label: "HQ",
        shape: "circle",
        latitude: LAT,
        longitude: LON,
        radiusMeters: 80
      }).valid
    ).toBe(true);
    expect(
      validateGeofence({
        officeId: office,
        label: "HQ",
        shape: "circle",
        latitude: LAT,
        longitude: LON,
        radiusMeters: 9
      }).valid
    ).toBe(false);
    expect(
      validateGeofence({
        officeId: office,
        label: "HQ",
        shape: "circle",
        latitude: LAT,
        longitude: LON,
        radiusMeters: 80,
        vertices: []
      }).valid
    ).toBe(false);
    expect(
      validateGeofence({
        officeId: office,
        label: "Yard",
        shape: "polygon",
        vertices: [
          [LAT, LON],
          [LAT, LON + 100 * METRE_LAT],
          [LAT + 100 * METRE_LAT, LON + 100 * METRE_LAT]
        ]
      }).valid
    ).toBe(true);
    expect(
      validateGeofence({
        officeId: office,
        label: "Yard",
        shape: "polygon",
        vertices: [
          [1, 1],
          [1, 2]
        ]
      }).valid
    ).toBe(false);
    expect(
      validateGeofence({
        officeId: office,
        label: "Yard",
        shape: "polygon",
        vertices: Array.from({ length: 33 }, () => [1, 1])
      }).valid
    ).toBe(false);
    expect(
      validateGeofence({
        officeId: office,
        label: "Yard",
        shape: "polygon",
        vertices: [
          [1, 1],
          [1, 2],
          [200, 2]
        ]
      }).valid
    ).toBe(false);
    expect(
      validateGeofence({
        officeId: office,
        label: "Yard",
        shape: "polygon",
        latitude: 1,
        vertices: [
          [1, 1],
          [1, 2],
          [2, 2]
        ]
      }).valid
    ).toBe(false);
  });

  test("notice: locale -> text, bounded, no control characters; acknowledgement: two uuids", () => {
    expect(
      validateNotice({ texts: { en: "We check where you clock in." } }).valid
    ).toBe(true);
    expect(validateNotice({ texts: {} }).valid).toBe(false);
    expect(validateNotice({ texts: { "not a locale": "x" } }).valid).toBe(
      false
    );
    expect(validateNotice({ texts: { en: "" } }).valid).toBe(false);
    expect(validateNotice({ texts: { en: "bad\u0000" } }).valid).toBe(false);
    expect(
      validateNotice({
        texts: { en: "x".repeat(GEO_LIMITS.noticeTextMaxLength + 1) }
      }).valid
    ).toBe(false);
    expect(
      validateAcknowledgement({ employmentId: "x", noticeId: "y" }).valid
    ).toBe(false);
  });
});

describe("the redaction walls (ADR-0138: request-log scrubbing)", () => {
  test("a position in a structured log / audit context prints as [REDACTED]", () => {
    const redacted = redactSensitiveAttributes({
      kind: "clock_in",
      positionSample: { latitude: -6.2, longitude: 106.8, accuracyMeters: 5 },
      latitude: -6.2,
      geoLongitude: 106.8,
      coordinates: [1, 2],
      geolocation: { a: 1 }
    })!;
    const text = JSON.stringify(redacted);

    expect(redacted.kind).toBe("clock_in");
    expect(text).not.toContain("-6.2");
    expect(text).not.toContain("106.8");
    expect(findSensitiveKeys({ nested: { longitude: 1 } })).toEqual([
      "longitude"
    ]);
  });

  test("a position printed into free text (an error message, a query string) is scrubbed", () => {
    const cases = [
      'validation failed for {"latitude": -6.200001, "longitude":106.800001}',
      "?latitude=-6.200001&longitude=106.800001&x=1",
      "positionSample={ latitude: -6.200001, longitude: 106.800001 }"
    ];

    for (const text of cases) {
      const scrubbed = redactSecretsInText(text);

      expect(scrubbed).not.toContain("6.200001");
      expect(scrubbed).not.toContain("106.800001");
      expect(scrubbed).toContain("[REDACTED]");
    }
  });

  test("ordinary text is untouched", () => {
    expect(redactSecretsInText("clock in at the main office")).toBe(
      "clock in at the main office"
    );
  });
});

describe("source-text guarantees: no coordinate at rest, anywhere", () => {
  const sql = readFileSync("sql/306_awcms_hr_geolocation_evidence.sql", "utf8");
  const code = (text: string) =>
    text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/^\s*\*.*$/gm, "");

  function columnsOf(table: string): string[] {
    const body = new RegExp(
      `CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`
    ).exec(sql)![1]!;

    return body
      .split("\n")
      .filter(
        (line) =>
          /^ {2}[a-z_]+ [a-z]/.test(line) && !/^ {2}CONSTRAINT/.test(line)
      )
      .map((line) => line.trim().split(" ")[0]!);
  }

  test("the evidence table has exactly the verdict columns and no location-like column", () => {
    expect(columnsOf("awcms_hr_attendance_location_evidence")).toEqual([
      "id",
      "tenant_id",
      "event_id",
      "employment_id",
      "verdict",
      "distance_band",
      "accuracy_band",
      "geofence_id",
      "rule_version",
      "evaluated_at"
    ]);
  });

  test("no table of this migration other than the geofence (a work site) has a coordinate column", () => {
    for (const table of [
      "awcms_hr_attendance_location_evidence",
      "awcms_hr_geolocation_settings",
      "awcms_hr_geolocation_notices",
      "awcms_hr_geolocation_notice_acknowledgements"
    ]) {
      expect(columnsOf(table).join(" ")).not.toMatch(
        /lat|lon|lng|coord|accuracy_m\b|altitude|speed|heading|address|device|ssid|photo|biometric|\bip\b/
      );
    }
  });

  test("the attendance event table and its migration are untouched: no location column was added to the event", () => {
    expect(sql).not.toMatch(
      /ALTER TABLE awcms_hr_attendance_events\s+ADD COLUMN/i
    );
    expect(sql).not.toMatch(/ALTER TABLE awcms_hr_attendance_events\b/i);
  });

  test("the sample is never bound into a SQL statement, an audit row, a log or an event", () => {
    const directory = code(
      readFileSync(
        "src/modules/hr-workforce/application/hr-location-evidence.ts",
        "utf8"
      )
    );

    // No template interpolation mentions the sample or any of its three fields.
    expect(directory).not.toMatch(/\$\{[^}]*(sample|accuracyMeters\b)[^}]*\}/i);
    // `latitude` / `longitude` appear only for the geofence (a WORK SITE) rows.
    for (const match of directory.matchAll(
      /\$\{([^}]*(?:latitude|longitude)[^}]*)\}/gi
    )) {
      expect(match[1]).toMatch(/^input\.(latitude|longitude)$/);
    }
    expect(directory).not.toMatch(/console\.|log\(/);
    // The only audit attributes are states, ids and counts.
    const blocks = [
      ...directory.matchAll(/attributes: \{(?:[^{}]|\{[^{}]*\})*\}/g)
    ];

    expect(blocks.length).toBeGreaterThanOrEqual(4);

    for (const block of blocks) {
      expect(block[0]).not.toMatch(/sample|latitude|longitude/i);
    }
  });

  test("the clock route hashes only the PRESENCE of a sample and hands it to nothing but the evaluator's caller", () => {
    const route = code(
      readFileSync(
        "src/pages/api/v1/hr-workforce/attendance-events/index.ts",
        "utf8"
      )
    );

    expect(route).toContain(
      'positionSample: input.positionSample === null ? null : "present"'
    );
    expect(route.match(/input\.positionSample/g)?.length).toBe(2);
    expect(route).not.toMatch(/recordAuditEvent|log\(|console\./);
  });

  test("the attendance directory (event insert) was not taught about location", () => {
    const directory = readFileSync(
      "src/modules/hr-workforce/application/hr-attendance-directory.ts",
      "utf8"
    );

    expect(code(directory)).not.toMatch(
      /positionSample|location_evidence|geofence/
    );
  });

  test("no route under geolocation/ accepts or echoes a coordinate except the geofence configuration", () => {
    const dir = "src/pages/api/v1/hr-workforce/geolocation";
    const files = readdirSync(dir, { recursive: true, withFileTypes: false })
      .map(String)
      .filter((file) => file.endsWith(".ts"));

    expect(files.length).toBeGreaterThanOrEqual(8);

    for (const file of files) {
      const text = code(readFileSync(`${dir}/${file}`, "utf8"));

      if (file.startsWith("geofences")) continue;

      expect(text).not.toMatch(/latitude|longitude|positionSample/i);
    }
  });
});

describe("registration", () => {
  test("the two permissions are declared; the configure one is withheld from the owner blanket grant", () => {
    const declared = (hrWorkforceModule.permissions ?? []).map(
      (permission) => `${permission.activityCode}.${permission.action}`
    );

    expect(declared).toContain("attendance_evidence.read");
    expect(declared).toContain("geolocation_evidence.configure");
    expect(OWNER_GRANT_EXCLUDED_PERMISSION_KEYS).toEqual([
      "hr_workforce.geolocation_evidence.configure"
    ]);
    // It is NOT platform-scoped: the tenant is the controller.
    const configure = (hrWorkforceModule.permissions ?? []).find(
      (permission) => permission.activityCode === "geolocation_evidence"
    )!;

    expect(configure.scope ?? "tenant").toBe("tenant");
  });

  test("the evidence descriptor matches ADR-0138 section 7", () => {
    const descriptor = (hrWorkforceModule.dataLifecycle ?? []).find(
      (entry) => entry.tableName === "awcms_hr_attendance_location_evidence"
    )!;

    expect(descriptor.cursorColumn).toBe("evaluated_at");
    expect(descriptor.retentionMinDays).toBe(30);
    expect(descriptor.defaultRetentionDays).toBe(90);
    expect(descriptor.retentionMaxDays).toBe(180);
    expect(descriptor.deletion.mode).toBe("hard_delete");
    expect(descriptor.archive.archivable).toBe(false);
    expect(descriptor.legalHold).toEqual({
      applicable: true,
      precedence: "overrides_retention"
    });
    expect(descriptor.executionMode).toBe("generic");
  });

  test("every table of the migration has a retention descriptor, and the evidence is a subject-data table", () => {
    const described = new Set(
      (hrWorkforceModule.dataLifecycle ?? []).map((entry) => entry.tableName)
    );

    for (const table of [
      "awcms_hr_attendance_location_evidence",
      "awcms_hr_geofences",
      "awcms_hr_geolocation_settings",
      "awcms_hr_geolocation_notices",
      "awcms_hr_geolocation_notice_acknowledgements"
    ]) {
      expect(described.has(table)).toBe(true);
    }

    const subject = (hrWorkforceModule.subjectData ?? []).find(
      (entry) => entry.tableName === "awcms_hr_attendance_location_evidence"
    )!;

    expect(subject.exportable).toBe(true);
    expect(subject.subjectVia?.column).toBe("employment_id");
  });
});
