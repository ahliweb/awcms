/**
 * Unit tests for the remaining pure `visitor_analytics` domain/application
 * logic: the env config resolver (privacy-first defaults), range windows, geo
 * enrichment + client-IP trust gates, the visitor-key cookie plan, the
 * collect-gate, the dashboard view-model helpers, and rollup date resolution.
 */
import { describe, expect, test } from "bun:test";

import {
  resolveVisitorAnalyticsConfig,
  isVisitorAnalyticsEnabled,
  parsePositiveInt,
  resolveVisitorKeyCookieMaxAgeSeconds,
  VISITOR_ANALYTICS_DEFAULTS,
  type VisitorAnalyticsConfig
} from "../src/modules/visitor-analytics/domain/visitor-analytics-config";
import {
  DEFAULT_ANALYTICS_RANGE,
  isKnownAnalyticsRange,
  resolveRangeStart
} from "../src/modules/visitor-analytics/domain/analytics-range";
import { resolveGeoEnrichment } from "../src/modules/visitor-analytics/domain/geo-enrichment";
import { resolveAnalyticsClientIp } from "../src/modules/visitor-analytics/domain/client-ip";
import {
  planVisitorKeyCookie,
  shouldRevokeVisitorKeyCookie
} from "../src/modules/visitor-analytics/domain/visitor-key-cookie";
import { shouldCollectRequest } from "../src/modules/visitor-analytics/application/collector";
import {
  buildSessionRowCells,
  displayOrPlaceholder,
  isNamedCountListEmpty,
  isSummaryEmpty
} from "../src/modules/visitor-analytics/domain/dashboard-view";
import {
  resolveDefaultRollupDate,
  resolveRollupDate
} from "../scripts/visitor-analytics-rollup";

describe("config resolver (privacy-first defaults)", () => {
  test("defaults to disabled with an empty salt and privacy flags off", () => {
    const config = resolveVisitorAnalyticsConfig({});
    expect(config.enabled).toBe(false);
    expect(config.hashSalt).toBe("");
    expect(config.rawIpEnabled).toBe(false);
    expect(config.rawUserAgentEnabled).toBe(false);
    expect(config.geoEnabled).toBe(false);
    expect(config.mode).toBe("basic");
    expect(isVisitorAnalyticsEnabled({})).toBe(false);
  });

  test("explicit env values win over defaults", () => {
    const config = resolveVisitorAnalyticsConfig({
      VISITOR_ANALYTICS_ENABLED: "true",
      VISITOR_ANALYTICS_HASH_SALT: "real-salt",
      VISITOR_ANALYTICS_EVENT_RETENTION_DAYS: "45"
    });
    expect(config.enabled).toBe(true);
    expect(config.hashSalt).toBe("real-salt");
    expect(config.eventRetentionDays).toBe(45);
  });

  test("parsePositiveInt rejects non-positive / malformed values", () => {
    expect(parsePositiveInt("30")).toBe(30);
    expect(parsePositiveInt("0")).toBeUndefined();
    expect(parsePositiveInt("-5")).toBeUndefined();
    expect(parsePositiveInt("abc")).toBeUndefined();
    expect(parsePositiveInt(undefined)).toBeUndefined();
  });

  test("cookie TTL days -> maxAge seconds", () => {
    expect(
      resolveVisitorKeyCookieMaxAgeSeconds({ visitorKeyCookieTtlDays: 30 })
    ).toBe(2_592_000);
  });
});

describe("analytics range windows", () => {
  test("known-range guard + default", () => {
    expect(isKnownAnalyticsRange("7d")).toBe(true);
    expect(isKnownAnalyticsRange("99y")).toBe(false);
    expect(DEFAULT_ANALYTICS_RANGE).toBe("7d");
  });

  test("resolveRangeStart moves back the right amount", () => {
    const now = new Date("2026-07-24T12:00:00Z");
    expect(resolveRangeStart("24h", now).toISOString()).toBe(
      "2026-07-23T12:00:00.000Z"
    );
    expect(resolveRangeStart("7d", now).toISOString()).toBe(
      "2026-07-17T12:00:00.000Z"
    );
  });
});

describe("geo enrichment double-gate", () => {
  const req = new Request("http://x/", { headers: { "cf-ipcountry": "ID" } });

  test("returns country only when BOTH geoEnabled and trustCloudflare are true", () => {
    expect(
      resolveGeoEnrichment(req, { geoEnabled: true, trustCloudflare: true })
        .countryCode
    ).toBe("ID");
    expect(
      resolveGeoEnrichment(req, { geoEnabled: true, trustCloudflare: false })
        .countryCode
    ).toBeNull();
    expect(
      resolveGeoEnrichment(req, { geoEnabled: false, trustCloudflare: true })
        .countryCode
    ).toBeNull();
  });
});

describe("client-IP trust gate", () => {
  test("never trusts forwarded headers unless explicitly opted in", () => {
    const req = new Request("http://x/", {
      headers: { "x-forwarded-for": "1.2.3.4", "cf-connecting-ip": "5.6.7.8" }
    });
    // No trust -> falls back to the socket address.
    expect(
      resolveAnalyticsClientIp(req, "9.9.9.9", {
        trustProxy: false,
        trustCloudflare: false
      })
    ).toBe("9.9.9.9");
    // Trust CF -> uses the CF header.
    expect(
      resolveAnalyticsClientIp(req, "9.9.9.9", {
        trustProxy: false,
        trustCloudflare: true
      })
    ).toBe("5.6.7.8");
  });

  test("an ambiguous multi-value forwarded header is NOT trusted (falls through)", () => {
    const req = new Request("http://x/", {
      headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2" }
    });
    expect(
      resolveAnalyticsClientIp(req, "9.9.9.9", {
        trustProxy: true,
        trustCloudflare: false
      })
    ).toBe("9.9.9.9");
  });
});

describe("visitor-key cookie lifecycle", () => {
  test("revokes a lingering cookie only when disabled + a valid cookie exists", () => {
    const valid = "11111111-1111-4111-8111-111111111111";
    expect(
      shouldRevokeVisitorKeyCookie({
        config: { enabled: false },
        existingValue: valid
      })
    ).toBe(true);
    expect(
      shouldRevokeVisitorKeyCookie({
        config: { enabled: true },
        existingValue: valid
      })
    ).toBe(false);
    expect(
      shouldRevokeVisitorKeyCookie({
        config: { enabled: false },
        existingValue: undefined
      })
    ).toBe(false);
  });

  test("plan reuses a valid cookie (no re-set) and mints one otherwise", () => {
    const valid = "11111111-1111-4111-8111-111111111111";
    const reuse = planVisitorKeyCookie({
      config: { visitorKeyCookieTtlDays: 30 },
      existingValue: valid
    });
    expect(reuse.value).toBe(valid);
    expect(reuse.shouldSetCookie).toBe(false);

    const fresh = planVisitorKeyCookie({
      config: { visitorKeyCookieTtlDays: 30 },
      existingValue: undefined
    });
    expect(fresh.shouldSetCookie).toBe(true);
    expect(fresh.maxAgeSeconds).toBe(2_592_000);
  });
});

describe("collect gate", () => {
  function cfg(
    overrides: Partial<VisitorAnalyticsConfig>
  ): VisitorAnalyticsConfig {
    return { ...VISITOR_ANALYTICS_DEFAULTS, ...overrides };
  }

  test("disabled module never collects", () => {
    expect(
      shouldCollectRequest({
        pathname: "/",
        area: "public",
        config: cfg({ enabled: false })
      })
    ).toBe(false);
  });

  test("respects per-area toggles and skips non-trackable paths", () => {
    const enabled = cfg({
      enabled: true,
      collectPublic: true,
      collectApi: false,
      collectAdmin: false
    });
    expect(
      shouldCollectRequest({ pathname: "/", area: "public", config: enabled })
    ).toBe(true);
    expect(
      shouldCollectRequest({
        pathname: "/admin/x",
        area: "admin",
        config: enabled
      })
    ).toBe(false);
    expect(
      shouldCollectRequest({
        pathname: "/logo.png",
        area: "public",
        config: enabled
      })
    ).toBe(false);
  });
});

describe("dashboard view-model helpers", () => {
  test("displayOrPlaceholder never renders literal null/blank", () => {
    expect(displayOrPlaceholder(null)).toBe("—");
    expect(displayOrPlaceholder("  ")).toBe("—");
    expect(displayOrPlaceholder("Chrome")).toBe("Chrome");
  });

  test("empty-state detectors", () => {
    expect(isNamedCountListEmpty([])).toBe(true);
    expect(isNamedCountListEmpty([{ name: "x", count: 0 }])).toBe(true);
    expect(isNamedCountListEmpty([{ name: "x", count: 3 }])).toBe(false);
    expect(
      isSummaryEmpty({
        humanUniqueVisitors: 0,
        humanPageviews: 0,
        botPageviews: 0
      })
    ).toBe(true);
  });

  test("buildSessionRowCells hides raw block when not permitted", () => {
    const base = {
      area: "public",
      currentPath: "/",
      browserName: "Chrome",
      osName: "Windows",
      deviceType: "desktop",
      isHuman: true,
      countryCode: "ID",
      ipAddress: "203.0.113.5",
      ipHash: "sha256:h",
      userAgentHash: "sha256:u",
      loginIdentifierSnapshot: null
    };
    expect(
      buildSessionRowCells(base, {
        showRawDetailColumns: false,
        humanLabel: "H",
        botLabel: "B"
      }).raw
    ).toBeNull();
    expect(
      buildSessionRowCells(base, {
        showRawDetailColumns: true,
        humanLabel: "H",
        botLabel: "B"
      }).raw?.ipAddress
    ).toBe("203.0.113.5");
  });
});

describe("rollup date resolution", () => {
  test("defaults to yesterday (UTC)", () => {
    const now = new Date("2026-07-24T03:00:00Z");
    expect(resolveDefaultRollupDate(now)).toBe("2026-07-23");
  });

  test("honors a valid --date flag, ignores a malformed one", () => {
    const now = new Date("2026-07-24T03:00:00Z");
    expect(resolveRollupDate(["--date=2026-01-15"], now)).toBe("2026-01-15");
    expect(resolveRollupDate(["--date=nope"], now)).toBe("2026-07-23");
  });
});
