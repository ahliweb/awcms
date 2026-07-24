/**
 * Contract/parity tests for `visitor_analytics` — cheap guards that keep the
 * three sources of truth aligned: the module descriptor's permission catalog,
 * the permission-seed migration (sql/049), and the OpenAPI contract. No DB.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { visitorAnalyticsModule } from "../src/modules/visitor-analytics/module";

const ROOT = join(import.meta.dir, "..");

function permKey(activityCode: string, action: string): string {
  return `${visitorAnalyticsModule.key}.${activityCode}.${action}`;
}

describe("descriptor <-> permission seed parity", () => {
  test("module.ts permissions exactly match sql/049 seed", () => {
    const seed = readFileSync(
      join(ROOT, "sql/049_awcms_visitor_analytics_permissions.sql"),
      "utf8"
    );
    // Extract every ('visitor_analytics', '<activity>', '<action>', ...) tuple.
    const seededKeys = new Set(
      [
        ...seed.matchAll(/\('visitor_analytics',\s*'([^']+)',\s*'([^']+)'/g)
      ].map((m) => permKey(m[1]!, m[2]!))
    );
    const descriptorKeys = new Set(
      (visitorAnalyticsModule.permissions ?? []).map((p) =>
        permKey(p.activityCode, p.action)
      )
    );

    expect([...descriptorKeys].sort()).toEqual([...seededKeys].sort());
    // Sanity: the exact set expected (protects against silent drift both ways).
    expect(descriptorKeys.has("visitor_analytics.raw_detail.read")).toBe(true);
    expect(descriptorKeys.has("visitor_analytics.retention.purge")).toBe(true);
    expect(descriptorKeys.size).toBe(8);
  });

  test("navigation requiredPermission is a declared permission key", () => {
    const declared = new Set(
      (visitorAnalyticsModule.permissions ?? []).map((p) =>
        permKey(p.activityCode, p.action)
      )
    );
    for (const nav of visitorAnalyticsModule.navigation ?? []) {
      if (nav.requiredPermission) {
        expect(declared.has(nav.requiredPermission)).toBe(true);
      }
    }
  });

  test("descriptor is a standalone system module with the expected deps", () => {
    expect(visitorAnalyticsModule.type).toBe("system");
    expect(visitorAnalyticsModule.dependencies).toEqual([
      "tenant_admin",
      "identity_access",
      "logging",
      "reporting"
    ]);
    expect(visitorAnalyticsModule.api?.basePath).toBe("/api/v1/analytics");
  });
});

describe("OpenAPI contract", () => {
  const bundle = readFileSync(
    join(ROOT, "openapi/awcms-public-api.openapi.yaml"),
    "utf8"
  );

  test("the bundled spec declares every analytics route path", () => {
    for (const path of [
      "/api/v1/analytics/collect",
      "/api/v1/analytics/summary",
      "/api/v1/analytics/realtime",
      "/api/v1/analytics/sessions",
      "/api/v1/analytics/events",
      "/api/v1/analytics/pages",
      "/api/v1/analytics/devices",
      "/api/v1/analytics/locations",
      "/api/v1/analytics/security",
      "/api/v1/analytics/settings",
      "/api/v1/analytics/retention/purge"
    ]) {
      expect(bundle).toContain(`${path}:`);
    }
  });

  test("the public ingest beacon declares an operationId + the module job commands exist", () => {
    expect(bundle).toContain("operationId: analyticsCollect");
    const commands = (visitorAnalyticsModule.jobs ?? []).map((j) => j.command);
    expect(commands).toContain("bun run analytics:rollup");
    expect(commands).toContain("bun run analytics:purge");
  });
});
