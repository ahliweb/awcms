import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  DEFAULT_MAX_FAILED_ATTEMPTS,
  DEFAULT_SESSION_TTL_MIN,
  parsePositiveIntEnv,
  resetLoginPolicyEnvWarningsForTests,
  resolveLoginDenyResponse,
  resolveLoginPolicyConfig,
  verifyPasswordOrDummy
} from "../src/modules/identity-access/application/login-policy";
import { evaluateLoginAttempt } from "../src/modules/identity-access/domain/login-policy";
import { hashPassword } from "../src/lib/auth/password";
import { type LogEntry, setLogSink } from "../src/lib/logging/logger";

const TOUCHED_ENV_VARS = [
  "AUTH_LOGIN_MAX_ATTEMPTS",
  "AUTH_SESSION_TTL_MIN",
  "AUTH_LOGIN_RATE_LIMIT_MAX",
  "AUTH_LOGIN_RATE_LIMIT_WINDOW_SEC",
  "AWCMS_TEST_THRESHOLD"
] as const;

const originalEnv = new Map<string, string | undefined>(
  TOUCHED_ENV_VARS.map((name) => [name, process.env[name]])
);

let logEntries: LogEntry[] = [];

beforeEach(() => {
  resetLoginPolicyEnvWarningsForTests();
  logEntries = [];
  setLogSink((entry) => logEntries.push(entry));

  for (const name of TOUCHED_ENV_VARS) {
    delete process.env[name];
  }
});

afterEach(() => {
  setLogSink(null);

  for (const [name, value] of originalEnv) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

function warnings(): LogEntry[] {
  return logEntries.filter(
    (entry) =>
      entry.message === "identity_access.login_policy.invalid_env_value"
  );
}

describe("parsePositiveIntEnv (Issue #147 §4)", () => {
  test("returns the configured value when it is a positive integer", () => {
    process.env.AWCMS_TEST_THRESHOLD = "7";

    expect(parsePositiveIntEnv("AWCMS_TEST_THRESHOLD", 5)).toBe(7);
    expect(warnings()).toHaveLength(0);
  });

  test("falls back silently when unset or blank (the documented default is not a misconfiguration)", () => {
    expect(parsePositiveIntEnv("AWCMS_TEST_THRESHOLD", 5)).toBe(5);

    process.env.AWCMS_TEST_THRESHOLD = "   ";
    expect(parsePositiveIntEnv("AWCMS_TEST_THRESHOLD", 5)).toBe(5);

    expect(warnings()).toHaveLength(0);
  });

  test.each([
    ["5x", "typo'd suffix — `Number()` yields NaN"],
    ["abc", "non-numeric"],
    ["", "empty after an `=` with nothing behind it"],
    ["0", "zero would lock every account on the first attempt"],
    ["-3", "negative"],
    ["2.5", "fractional"],
    ["Infinity", "not finite"],
    ["NaN", "literally NaN"]
  ])("falls back to the default for %p (%s)", (raw) => {
    process.env.AWCMS_TEST_THRESHOLD = raw;

    const parsed = parsePositiveIntEnv("AWCMS_TEST_THRESHOLD", 5);

    expect(parsed).toBe(5);
    expect(Number.isSafeInteger(parsed)).toBe(true);
  });

  test("warns exactly once per bad value, so a public endpoint cannot be turned into a log amplifier", () => {
    process.env.AWCMS_TEST_THRESHOLD = "5x";

    parsePositiveIntEnv("AWCMS_TEST_THRESHOLD", 5);
    parsePositiveIntEnv("AWCMS_TEST_THRESHOLD", 5);
    parsePositiveIntEnv("AWCMS_TEST_THRESHOLD", 5);

    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toMatchObject({
      level: "warning",
      envVar: "AWCMS_TEST_THRESHOLD",
      value: "5x",
      fallback: 5
    });
  });
});

describe("resolveLoginPolicyConfig (Issue #147 §4)", () => {
  test("a malformed AUTH_LOGIN_MAX_ATTEMPTS can no longer disable the account lockout", () => {
    process.env.AUTH_LOGIN_MAX_ATTEMPTS = "5x";

    const config = resolveLoginPolicyConfig();

    expect(config.maxFailedAttempts).toBe(DEFAULT_MAX_FAILED_ATTEMPTS);

    // The regression this guards: with NaN, `failedLoginCount >= NaN` is always
    // false, so the identity below would never be locked no matter how many
    // times it failed — unlimited brute-force, silently.
    const result = evaluateLoginAttempt({
      now: new Date("2026-07-17T00:00:00Z"),
      tenantStatus: "active",
      identity: {
        status: "active",
        failedLoginCount: config.maxFailedAttempts - 1,
        lockedUntil: null
      },
      tenantUserStatus: "active",
      passwordMatches: false,
      maxFailedAttempts: config.maxFailedAttempts,
      lockoutMinutes: config.lockoutMinutes
    });

    expect(result.outcome).toBe("deny");
    expect(result).toMatchObject({ reason: "invalid_credentials" });
    expect(
      result.outcome === "deny" ? result.lockedUntil : null
    ).toBeInstanceOf(Date);
  });

  test("a malformed AUTH_SESSION_TTL_MIN can no longer mint an Invalid Date expiry", () => {
    process.env.AUTH_SESSION_TTL_MIN = "two hours";

    const config = resolveLoginPolicyConfig();
    expect(config.sessionTtlMin).toBe(DEFAULT_SESSION_TTL_MIN);

    const now = new Date("2026-07-17T00:00:00Z");
    const expiresAt = new Date(now.getTime() + config.sessionTtlMin * 60_000);

    expect(Number.isNaN(expiresAt.getTime())).toBe(false);
    expect(expiresAt.toISOString()).toBe("2026-07-17T02:00:00.000Z");
  });

  test("valid env values are honored", () => {
    process.env.AUTH_LOGIN_MAX_ATTEMPTS = "3";
    process.env.AUTH_SESSION_TTL_MIN = "30";
    process.env.AUTH_LOGIN_RATE_LIMIT_MAX = "10";
    process.env.AUTH_LOGIN_RATE_LIMIT_WINDOW_SEC = "120";

    expect(resolveLoginPolicyConfig()).toMatchObject({
      maxFailedAttempts: 3,
      sessionTtlMin: 30,
      rateLimitMaxAttempts: 10,
      rateLimitWindowSec: 120
    });
  });
});

describe("resolveLoginDenyResponse (Issue #147 §2)", () => {
  test("`locked` is byte-identical to `invalid_credentials` — no existence oracle", () => {
    expect(resolveLoginDenyResponse("locked")).toEqual(
      resolveLoginDenyResponse("invalid_credentials")
    );
  });

  test("the shared credential response says nothing about the account", () => {
    const response = resolveLoginDenyResponse("locked");

    expect(response).toEqual({
      status: 401,
      code: "AUTH_INVALID_CREDENTIALS",
      message: "Invalid login identifier or password."
    });
    expect(response.message.toLowerCase()).not.toContain("lock");
  });

  test("`tenant_inactive` stays distinct — the tenant is caller-supplied, so it leaks no identity", () => {
    expect(resolveLoginDenyResponse("tenant_inactive")).toEqual({
      status: 403,
      code: "ACCESS_DENIED",
      message: "Tenant is not active."
    });
  });
});

describe("verifyPasswordOrDummy (Issue #147 §1)", () => {
  /**
   * argon2id m=64MB costs ~50-100ms; the pre-fix unknown-identifier path
   * short-circuited to `false` in well under 1ms. The bound is deliberately
   * far below the real cost (and only ever exceeded, never undercut, on slower
   * hardware) so this asserts "the hash actually ran", not a specific speed.
   */
  const MIN_ARGON2ID_MS = 10;

  async function timeMs(fn: () => Promise<unknown>): Promise<number> {
    const started = performance.now();
    await fn();
    return performance.now() - started;
  }

  test("an unknown identifier still pays a full argon2id verify", async () => {
    const elapsed = await timeMs(() =>
      verifyPasswordOrDummy("whatever-the-attacker-guessed", undefined)
    );

    expect(elapsed).toBeGreaterThan(MIN_ARGON2ID_MS);
  });

  test("an unknown identifier never authenticates", async () => {
    expect(await verifyPasswordOrDummy("whatever", undefined)).toBe(false);
  });

  test("a known identifier still verifies its real hash", async () => {
    const hash = await hashPassword("correct horse battery staple");

    expect(
      await verifyPasswordOrDummy("correct horse battery staple", hash)
    ).toBe(true);
    expect(await verifyPasswordOrDummy("wrong password", hash)).toBe(false);
  });

  test("unknown and known identifiers cost the same order of magnitude", async () => {
    const hash = await hashPassword("correct horse battery staple");

    const unknownMs = await timeMs(() =>
      verifyPasswordOrDummy("guess", undefined)
    );
    const knownMs = await timeMs(() => verifyPasswordOrDummy("guess", hash));

    // Pre-fix this ratio was ~100x (a ~0ms miss vs a ~75ms hit); 4x is a
    // deliberately loose bound that a shared/noisy CI runner cannot trip while
    // still failing loudly if the hash is skipped again.
    const ratio =
      Math.max(unknownMs, knownMs) /
      Math.max(Math.min(unknownMs, knownMs), 0.01);

    expect(ratio).toBeLessThan(4);
  });
});
