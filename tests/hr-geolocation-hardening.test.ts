/**
 * Hardening of geolocation attendance evidence after the security audit of
 * Issue #970 (ADR-0138): geofence shape limits, the geometry fingerprint, wider
 * log scrubbing, a source-level ban on touching the sample outside its call
 * chain, and the owner-exclusion walls (no blanket owner grant may hand out the
 * configure permission).
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

import {
  redactSecretsInText,
  redactSensitiveAttributes
} from "../src/modules/_shared/redaction";
import { OWNER_GRANT_EXCLUDED_PERMISSION_KEYS } from "../src/modules/_shared/owner-grant-exclusions";
import { geometryHash } from "../src/modules/hr-workforce/application/hr-location-evidence";
import { analysePolygon } from "../src/modules/hr-workforce/domain/hr-geolocation-geometry";
import { validateGeofence } from "../src/modules/hr-workforce/domain/hr-geolocation-validation";

const LAT = -6.175392;
const LON = 106.827153;
const M = 1 / 111_195;
const OFFICE = "11111111-1111-4111-8111-111111111111";

const polygon = (vertices: [number, number][]) =>
  validateGeofence({
    officeId: OFFICE,
    label: "Yard",
    shape: "polygon",
    vertices
  });
const circle = (radiusMeters: number) =>
  validateGeofence({
    officeId: OFFICE,
    label: "HQ",
    shape: "circle",
    latitude: LAT,
    longitude: LON,
    radiusMeters
  });
const at = (north: number, east: number): [number, number] => [
  LAT + north * M,
  LON + east * M
];

describe("geofence shape limits (M-2)", () => {
  test("a circle needs at least 50 m and at most 5 km", () => {
    expect(circle(49).valid).toBe(false);
    expect(circle(50).valid).toBe(true);
    expect(circle(5000).valid).toBe(true);
    expect(circle(5001).valid).toBe(false);
  });

  test("a real polygon is accepted; a bow-tie, a line, a repeated vertex and a speck are not", () => {
    expect(
      polygon([at(0, 0), at(0, 100), at(100, 100), at(100, 0)]).valid
    ).toBe(true);
    // Bow-tie: edges 0-1 and 2-3 cross.
    expect(
      polygon([at(0, 0), at(100, 100), at(100, 0), at(0, 100)]).valid
    ).toBe(false);
    // A line (zero area, collinear).
    expect(polygon([at(0, 0), at(0, 50), at(0, 100)]).valid).toBe(false);
    // A repeated vertex.
    expect(polygon([at(0, 0), at(0, 0), at(100, 100), at(0, 100)]).valid).toBe(
      false
    );
    // Valid shape but under 2500 square metres.
    expect(polygon([at(0, 0), at(0, 30), at(30, 30), at(30, 0)]).valid).toBe(
      false
    );
  });

  test("a polygon may not span more than 10 km", () => {
    expect(
      polygon([at(0, 0), at(0, 9_000), at(9_000, 9_000), at(9_000, 0)]).valid
    ).toBe(true);
    expect(
      polygon([at(0, 0), at(0, 11_000), at(11_000, 11_000), at(11_000, 0)])
        .valid
    ).toBe(false);
    const shape = analysePolygon([
      at(0, 0),
      at(0, 100),
      at(100, 100),
      at(100, 0)
    ]);

    expect(Math.round(shape.areaSquareMeters / 1000)).toBe(10);
    expect(Math.round(shape.extentMeters)).toBe(100);
  });

  test("the database mirrors the limits it can (radius, vertex count, per-office cap, last fence)", () => {
    const sql = readFileSync(
      "sql/306_awcms_hr_geolocation_evidence.sql",
      "utf8"
    );

    expect(sql).toContain("radius_m BETWEEN 50 AND 5000");
    expect(sql).toContain("jsonb_array_length(vertices) BETWEEN 3 AND 32");
    expect(sql).toContain("HR_GEO_OFFICE_CAP");
    expect(sql).toContain("HR_GEO_LAST_FENCE");
    expect(sql).toContain("HR_GEO_FENCE_MISMATCH");
  });

  test("the geometry fingerprint is stable, changes with the shape, and is not a coordinate", () => {
    const base = {
      shape: "circle",
      latitude: LAT,
      longitude: LON,
      radiusMeters: 100,
      vertices: null
    };
    const hash = geometryHash(base);

    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(geometryHash({ ...base })).toBe(hash);
    expect(geometryHash({ ...base, radiusMeters: 101 })).not.toBe(hash);
    expect(hash).not.toContain("6.17");
  });
});

describe("wider log scrubbing (L-3)", () => {
  test("escaped-quote JSON, short aliases and a rounded coordinate are caught", () => {
    const cases = [
      String.raw`body={\"latitude\":-6.2004,\"longitude\":106.8004}`,
      String.raw`{\"lat\": -6.2, \"lng\": 106.8}`,
      '{"lat":-6.2,"lon":106.8}',
      "lat=-6.2&lng=106.8",
      "positionSample: { latitude: -6.2 }",
      // Reformatted / rounded by a careless logger.
      "latitude: -6.20, longitude: 106.80"
    ];

    for (const text of cases) {
      const scrubbed = redactSecretsInText(text);

      expect(scrubbed).not.toMatch(/-6\.2|106\.8/);
      expect(scrubbed).toContain("[REDACTED]");
    }
  });

  test("structured keys by alias are redacted; 'late', 'latest' and 'translation' are not", () => {
    const redacted = redactSensitiveAttributes({
      lat: -6.2,
      lng: 106.8,
      lon: 106.8,
      coords: [1, 2],
      late: true,
      latest: "x",
      translation: "y"
    })!;

    expect(redacted.lat).toBe("[REDACTED]");
    expect(redacted.lng).toBe("[REDACTED]");
    expect(redacted.lon).toBe("[REDACTED]");
    expect(redacted.coords).toBe("[REDACTED]");
    expect(redacted.late).toBe(true);
    expect(redacted.latest).toBe("x");
    expect(redacted.translation).toBe("y");
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;

    if (entry.isDirectory()) walk(path, out);
    else if (/\.(ts|astro)$/.test(entry.name)) out.push(path);
  }

  return out;
}

describe("the sample stays inside its call chain (L-3)", () => {
  test("`positionSample` appears only in the validator, the types, the clock route, the evidence directory and the redaction wall", () => {
    const allowed = new Set([
      "src/modules/_shared/redaction.ts",
      "src/modules/hr-workforce/domain/hr-attendance-validation.ts",
      "src/modules/hr-workforce/domain/hr-geolocation-validation.ts",
      "src/modules/hr-workforce/domain/hr-geolocation-types.ts",
      "src/modules/hr-workforce/application/hr-location-evidence.ts",
      "src/pages/api/v1/hr-workforce/attendance-events/index.ts"
    ]);
    const found = walk("src").filter((file) =>
      /positionSample/.test(readFileSync(file, "utf8"))
    );

    expect(found.filter((file) => !allowed.has(file))).toEqual([]);
    expect(found.length).toBeGreaterThanOrEqual(4);
  });

  test("the evidence directory never hands the sample to anything but the evaluator", () => {
    const text = readFileSync(
      "src/modules/hr-workforce/application/hr-location-evidence.ts",
      "utf8"
    );
    const uses = [...text.matchAll(/\baccepted\b|\bsample\b/g)].length;

    expect(uses).toBeGreaterThan(0);
    // The only calls that receive the accepted sample are the evaluator.
    expect(text.match(/evaluatePositionSample\(/g)?.length).toBe(1);
    expect(text).not.toMatch(/JSON\.stringify\(\s*(accepted|sample)/);
  });
});

describe("owner exclusion walls (M-1)", () => {
  test("the SQL trigger and the TypeScript list name the same permissions", () => {
    const sql = readFileSync(
      "sql/306_awcms_hr_geolocation_evidence.sql",
      "utf8"
    );
    const body = /awcms_guard_owner_excluded_permission[\s\S]*?\$\$;/.exec(
      sql
    )![0];
    const keys = [...body.matchAll(/'([a-z_]+\.[a-z_]+\.[a-z_]+)'/g)].map(
      (match) => match[1]
    );

    expect(keys.sort()).toEqual(
      [...OWNER_GRANT_EXCLUDED_PERMISSION_KEYS].sort()
    );
    expect(sql).toContain("pg_temp");
    expect(sql).toContain("awcms_role_permissions_owner_exclusion");
  });

  test("no code path or migration after the permission existed grants every permission to an owner without excluding it", () => {
    const statement =
      /INSERT INTO awcms_role_permissions[\s\S]*?(?:`|;)\s*(?:\n|$)/g;
    const offenders: string[] = [];
    const sources = [
      ...walk("src"),
      ...readdirSync("sql")
        .filter(
          (name) => name.endsWith(".sql") && Number(name.slice(0, 3)) >= 306
        )
        .map((name) => `sql/${name}`)
    ];

    for (const file of sources) {
      const text = readFileSync(file, "utf8").replace(/^\s*--.*$/gm, "");

      for (const match of text.matchAll(statement)) {
        const sql = match[0];

        if (!/FROM awcms_permissions/i.test(sql)) continue;
        // A platform-scope grant is the wizard's, and a role-admin grant of ONE
        // permission is explicit by definition.
        if (/scope = 'platform'/.test(sql)) continue;
        if (/OWNER_GRANT_EXCLUDED_PERMISSION_KEYS|owner_excluded/i.test(sql))
          continue;
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});
