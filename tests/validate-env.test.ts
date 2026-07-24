import { describe, expect, test } from "bun:test";

import { validateEnv } from "../scripts/validate-env";

const base = {
  APP_ENV: "development",
  APP_URL: "http://localhost:4321",
  DATABASE_URL: "postgres://awcms:awcms_password@localhost:5432/awcms"
} as Record<string, string | undefined>;

describe("validateEnv", () => {
  test("a minimal valid env has no problems", () => {
    expect(validateEnv(base)).toEqual([]);
  });

  test("missing required vars are reported", () => {
    const problems = validateEnv({ APP_ENV: "development" });
    expect(problems.some((p) => p.startsWith("APP_URL"))).toBe(true);
    expect(problems.some((p) => p.startsWith("DATABASE_URL"))).toBe(true);
  });

  test("rejects a non-integer int and a below-min int", () => {
    expect(
      validateEnv({ ...base, AUTH_LOGIN_MAX_ATTEMPTS: "abc" }).some((p) =>
        p.includes("bilangan bulat")
      )
    ).toBe(true);
    expect(
      validateEnv({ ...base, AUTH_SESSION_TTL_MIN: "0" }).some((p) =>
        p.includes(">= 1")
      )
    ).toBe(true);
  });

  test("rejects a bad boolean and a bad enum", () => {
    expect(
      validateEnv({ ...base, AUTH_COOKIE_SECURE: "yes" }).some((p) =>
        p.includes("true")
      )
    ).toBe(true);
    expect(
      validateEnv({ ...base, APP_ENV: "prod" }).some((p) =>
        p.startsWith("APP_ENV")
      )
    ).toBe(true);
  });

  test("rejects a non-postgres DATABASE_URL", () => {
    expect(
      validateEnv({ ...base, DATABASE_URL: "mysql://x/y" }).some((p) =>
        p.startsWith("DATABASE_URL")
      )
    ).toBe(true);
  });

  test("production requires https APP_URL, secure cookie, and a real sync secret", () => {
    const problems = validateEnv({
      ...base,
      APP_ENV: "production",
      APP_URL: "http://example.com",
      AUTH_COOKIE_SECURE: "false",
      AWCMS_SYNC_ENABLED: "true",
      AWCMS_SYNC_HMAC_SECRET: "change-me"
    });
    expect(problems.some((p) => p.includes("https"))).toBe(true);
    expect(problems.some((p) => p.startsWith("AUTH_COOKIE_SECURE"))).toBe(true);
    expect(problems.some((p) => p.startsWith("AWCMS_SYNC_HMAC_SECRET"))).toBe(
      true
    );
  });

  test("sync secret only required when sync is enabled", () => {
    expect(validateEnv({ ...base, AWCMS_SYNC_ENABLED: "false" }).length).toBe(
      0
    );
  });

  test("visitor analytics hash salt is required only when the module is enabled", () => {
    // Disabled (default) -> no salt required.
    expect(
      validateEnv({ ...base, VISITOR_ANALYTICS_ENABLED: "false" }).length
    ).toBe(0);
    // Enabled without a real salt -> problem.
    expect(
      validateEnv({ ...base, VISITOR_ANALYTICS_ENABLED: "true" }).some((p) =>
        p.startsWith("VISITOR_ANALYTICS_HASH_SALT")
      )
    ).toBe(true);
    // Enabled with a placeholder salt -> still a problem.
    expect(
      validateEnv({
        ...base,
        VISITOR_ANALYTICS_ENABLED: "true",
        VISITOR_ANALYTICS_HASH_SALT: "change-me"
      }).some((p) => p.startsWith("VISITOR_ANALYTICS_HASH_SALT"))
    ).toBe(true);
    // Enabled with a too-short salt (< 16 chars) -> a problem (FIX 4).
    expect(
      validateEnv({
        ...base,
        VISITOR_ANALYTICS_ENABLED: "true",
        VISITOR_ANALYTICS_HASH_SALT: "short-salt"
      }).some(
        (p) => p.startsWith("VISITOR_ANALYTICS_HASH_SALT") && p.includes("16")
      )
    ).toBe(true);
    // Enabled with a real, long-enough salt -> clean.
    expect(
      validateEnv({
        ...base,
        VISITOR_ANALYTICS_ENABLED: "true",
        VISITOR_ANALYTICS_HASH_SALT: "a-real-deployment-salt"
      }).length
    ).toBe(0);
  });
});
