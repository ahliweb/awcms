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

  /**
   * The defect this pins is NOT "`false` is rejected" — that always worked, and
   * the test above already covers it. It is the state the old rule could not
   * see: `AUTH_COOKIE_SECURE` **absent**.
   *
   * `required: false` permits absence, and the old production cross-rule only
   * matched the literal string `"false"`. Runtime, meanwhile, evaluates
   * `process.env.AUTH_COOKIE_SECURE === "true"` — so an absent variable in
   * production means session cookies without `Secure` while
   * `bun run config:validate` reports the configuration clean.
   *
   * Assert on the ABSENT case explicitly. A test that only feeds `"false"` is
   * green on the defective rule, which is exactly how the gap survived.
   */
  test("production rejects AUTH_COOKIE_SECURE when it is not set at all", () => {
    const production: Record<string, string | undefined> = {
      ...base,
      APP_ENV: "production",
      APP_URL: "https://awcms.example",
      TRUSTED_PROXY_ENABLED: "true"
    };

    expect(production.AUTH_COOKIE_SECURE).toBeUndefined();

    const problems = validateEnv(production).filter((problem) =>
      problem.startsWith("AUTH_COOKIE_SECURE")
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("tidak diset");

    // And the only accepted spelling is the one runtime compares against.
    expect(
      validateEnv({ ...production, AUTH_COOKIE_SECURE: "true" }).filter((p) =>
        p.startsWith("AUTH_COOKIE_SECURE")
      )
    ).toEqual([]);
  });

  /**
   * Non-production is deliberately untouched: development runs over plain
   * `http://`, where a `Secure` cookie would never be sent at all
   * (`environments.md` records that as an intentional per-environment
   * difference). Widening the rule to every environment would have made the
   * documented dev setup fail its own validator.
   */
  test("non-production does not require AUTH_COOKIE_SECURE", () => {
    expect(
      validateEnv(base).filter((p) => p.startsWith("AUTH_COOKIE_SECURE"))
    ).toEqual([]);
    expect(
      validateEnv({ ...base, AUTH_COOKIE_SECURE: "false" }).filter((p) =>
        p.startsWith("AUTH_COOKIE_SECURE")
      )
    ).toEqual([]);
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
