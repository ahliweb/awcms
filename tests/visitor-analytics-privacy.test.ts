/**
 * Unit tests for the privacy-critical core of `visitor_analytics`: the salted
 * hashing of visitor identifiers, the anonymous visitor-key handling, and the
 * raw-detail response gating. These are the guarantees the module's whole
 * privacy posture rests on, so they are pure/unit-tested with no DB.
 */
import { describe, expect, test } from "bun:test";

import {
  generateVisitorKey,
  hashIpAddress,
  hashUserAgent,
  hashVisitorKey,
  isValidVisitorKey,
  resolveVisitorKey
} from "../src/modules/visitor-analytics/domain/visitor-key";
import {
  shapeVisitEvent,
  shapeVisitorSession,
  type VisitEventRow,
  type VisitorSessionRow
} from "../src/modules/visitor-analytics/domain/analytics-response-shaping";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("visitor-key hashing (per-tenant salted HMAC-SHA256)", () => {
  test("is deterministic for the same value + salt + tenant", () => {
    expect(hashVisitorKey("visitor-1", "salt", TENANT_A)).toBe(
      hashVisitorKey("visitor-1", "salt", TENANT_A)
    );
  });

  test("is salt-sensitive: a different salt yields a different hash", () => {
    expect(hashIpAddress("203.0.113.5", "salt-a", TENANT_A)).not.toBe(
      hashIpAddress("203.0.113.5", "salt-b", TENANT_A)
    );
  });

  test("is tenant-sensitive: the same value + salt under a DIFFERENT tenant yields a DIFFERENT hash (cross-tenant unlinkability)", () => {
    // The whole point of FIX 2: the same browser/IP/user-agent must NOT hash to
    // the same value across tenants sharing one origin — otherwise the raw hash
    // columns would let two tenants' data be correlated at the storage layer.
    expect(hashIpAddress("203.0.113.5", "salt", TENANT_A)).not.toBe(
      hashIpAddress("203.0.113.5", "salt", TENANT_B)
    );
    expect(hashVisitorKey("visitor-1", "salt", TENANT_A)).not.toBe(
      hashVisitorKey("visitor-1", "salt", TENANT_B)
    );
    expect(hashUserAgent("Mozilla/5.0", "salt", TENANT_A)).not.toBe(
      hashUserAgent("Mozilla/5.0", "salt", TENANT_B)
    );
  });

  test("the tenant/value boundary is unambiguous (domain separator)", () => {
    // Without the `\0` domain separator, tenant "ab" + value "c" would collide
    // with tenant "a" + value "bc". They must not.
    expect(hashIpAddress("c", "salt", "ab")).not.toBe(
      hashIpAddress("bc", "salt", "a")
    );
  });

  test("is keyed HMAC, not the plain sha256 of the value", async () => {
    const value = "Mozilla/5.0";
    const salt = "deployment-salt";
    const keyed = hashUserAgent(value, salt, TENANT_A);
    // A plain unsalted SHA-256 of the value must NOT equal the keyed hash —
    // the salt is what defeats a precomputed rainbow table.
    const plain = `sha256:${new Bun.CryptoHasher("sha256").update(value).digest("hex")}`;
    expect(keyed).not.toBe(plain);
    expect(keyed.startsWith("sha256:")).toBe(true);
  });

  test("all three hashers share the same HMAC construction", () => {
    // Same salt + same tenant + same input across the three helpers -> same
    // digest (they are the same keyed function, only named per call site).
    const salt = "s";
    expect(hashVisitorKey("x", salt, TENANT_A)).toBe(
      hashIpAddress("x", salt, TENANT_A)
    );
    expect(hashIpAddress("x", salt, TENANT_A)).toBe(
      hashUserAgent("x", salt, TENANT_A)
    );
  });
});

describe("anonymous visitor key", () => {
  test("generateVisitorKey produces a valid UUID key", () => {
    expect(isValidVisitorKey(generateVisitorKey())).toBe(true);
  });

  test("resolveVisitorKey reuses a valid key but never trusts a forged one", () => {
    const valid = generateVisitorKey();
    expect(resolveVisitorKey(valid)).toBe(valid);

    // A non-UUID forged cookie value is discarded; a fresh valid key is minted.
    const forged = "'; DROP TABLE awcms_visit_events; --";
    const resolved = resolveVisitorKey(forged);
    expect(resolved).not.toBe(forged);
    expect(isValidVisitorKey(resolved)).toBe(true);
  });

  test("isValidVisitorKey rejects null/undefined/blank/non-uuid", () => {
    expect(isValidVisitorKey(null)).toBe(false);
    expect(isValidVisitorKey(undefined)).toBe(false);
    expect(isValidVisitorKey("")).toBe(false);
    expect(isValidVisitorKey("not-a-uuid")).toBe(false);
  });
});

function sessionRow(
  overrides: Partial<VisitorSessionRow> = {}
): VisitorSessionRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    visitor_key_hash: "sha256:abc",
    identity_id: null,
    login_identifier_snapshot: "user@example.com",
    is_authenticated: false,
    area: "public",
    current_path: "/",
    first_seen_at: new Date("2026-01-01T00:00:00Z"),
    last_seen_at: new Date("2026-01-01T00:05:00Z"),
    ip_hash: "sha256:iphash",
    ip_address: "203.0.113.5",
    user_agent_hash: "sha256:uahash",
    browser_name: "Chrome",
    browser_version_major: "120",
    os_name: "Windows",
    device_type: "desktop",
    is_human: true,
    bot_reason: null,
    country_code: "ID",
    region: null,
    city: null,
    timezone: null,
    ...overrides
  };
}

function eventRow(overrides: Partial<VisitEventRow> = {}): VisitEventRow {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    visitor_session_id: "11111111-1111-4111-8111-111111111111",
    identity_id: null,
    occurred_at: new Date("2026-01-01T00:00:00Z"),
    method: "GET",
    status_code: 200,
    area: "public",
    route_pattern: null,
    path_sanitized: "/",
    referrer_domain: "example.com",
    duration_ms: null,
    ip_hash: "sha256:iphash",
    user_agent_hash: "sha256:uahash",
    user_agent_parsed: { browserName: "Chrome" },
    geo: { countryCode: "ID" },
    human_status: "human",
    correlation_id: "corr-1",
    ...overrides
  };
}

describe("raw-detail response gating (server-side, single gate)", () => {
  test("a session WITHOUT raw_detail.read has all raw fields nulled", () => {
    const dto = shapeVisitorSession(sessionRow(), false);
    expect(dto.ipAddress).toBeNull();
    expect(dto.ipHash).toBeNull();
    expect(dto.userAgentHash).toBeNull();
    expect(dto.loginIdentifierSnapshot).toBeNull();
    // Non-raw aggregate fields are still present.
    expect(dto.browserName).toBe("Chrome");
    expect(dto.countryCode).toBe("ID");
  });

  test("a session WITH raw_detail.read receives the raw fields", () => {
    const dto = shapeVisitorSession(sessionRow(), true);
    expect(dto.ipAddress).toBe("203.0.113.5");
    expect(dto.ipHash).toBe("sha256:iphash");
    expect(dto.userAgentHash).toBe("sha256:uahash");
    expect(dto.loginIdentifierSnapshot).toBe("user@example.com");
  });

  test("an event WITHOUT raw_detail.read nulls ipHash/userAgentHash but keeps aggregates", () => {
    const dto = shapeVisitEvent(eventRow(), false);
    expect(dto.ipHash).toBeNull();
    expect(dto.userAgentHash).toBeNull();
    expect(dto.humanStatus).toBe("human");
    expect(dto.userAgentParsed).toEqual({ browserName: "Chrome" });
  });

  test("an event WITH raw_detail.read receives the hashes", () => {
    const dto = shapeVisitEvent(eventRow(), true);
    expect(dto.ipHash).toBe("sha256:iphash");
    expect(dto.userAgentHash).toBe("sha256:uahash");
  });
});
