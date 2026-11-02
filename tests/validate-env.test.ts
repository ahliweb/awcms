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

  describe("channel_accounts (#1215 L7, N7)", () => {
    const ring = (seed: number) =>
      `k1:${Buffer.from(
        Array.from({ length: 32 }, (_, i) => (i * seed + 5) % 251)
      ).toString("base64")}`;
    const enabled = {
      ...base,
      CHANNEL_ACCOUNTS_ENABLED: "true",
      CHANNEL_SECRETS_ENCRYPTION_KEYS: ring(7)
    };

    test("enabled with a declared APP_URL and a valid ring is clean", () => {
      expect(validateEnv(enabled)).toEqual([]);
    });

    test("enabled without a usable APP_URL is refused, with the value never echoed", () => {
      for (const appUrl of [
        "https://user:hunter2@cms.example.test",
        "ftp://cms.example.test",
        "not a url"
      ]) {
        const problems = validateEnv({ ...enabled, APP_URL: appUrl });

        expect(
          problems.some((p) => p.includes("CHANNEL_ACCOUNTS_ENABLED=true"))
        ).toBe(true);
        expect(problems.join("\n")).not.toContain("hunter2");
      }
    });

    test("a disabled module does not care about APP_URL beyond the global rule", () => {
      expect(
        validateEnv({ ...base, CHANNEL_ACCOUNTS_ENABLED: "false" })
      ).toEqual([]);
    });

    test("the ring may not share a key with the WhatsApp recipient hash ring", () => {
      const problems = validateEnv({
        ...enabled,
        WHATSAPP_RECIPIENT_HASH_KEYS: ring(7)
      });

      expect(
        problems.some((p) => p.includes("WHATSAPP_RECIPIENT_HASH_KEYS"))
      ).toBe(true);
      expect(
        validateEnv({ ...enabled, WHATSAPP_RECIPIENT_HASH_KEYS: ring(11) })
      ).toEqual([]);
    });

    test("a malformed sibling entry does not hide a shared key beside it", () => {
      // The sibling ring is not strictly valid (a placeholder entry) but still
      // carries OUR key: the comparison is per entry, not all-or-nothing.
      const problems = validateEnv({
        ...enabled,
        WHATSAPP_RECIPIENT_HASH_KEYS: `${ring(7)},k2:changeme`
      });

      expect(
        problems.some((p) => p.includes("WHATSAPP_RECIPIENT_HASH_KEYS"))
      ).toBe(true);
    });
  });

  describe("Mailketing API version switch (Issue #1159)", () => {
    const email = { ...base, EMAIL_ENABLED: "true" };

    test("unset is clean (v1 is the default; nothing is required)", () => {
      expect(validateEnv(email)).toEqual([]);
    });

    test("v1 is clean and does not constrain the v1 base URL", () => {
      expect(
        validateEnv({
          ...email,
          EMAIL_MAILKETING_API_VERSION: "v1",
          EMAIL_MAILKETING_API_BASE_URL: "https://mock.internal.test"
        })
      ).toEqual([]);
    });

    test.each(["V2", "v3", "2", "true"])(
      "%p is rejected, not coerced to v1",
      (value) => {
        expect(
          validateEnv({ ...email, EMAIL_MAILKETING_API_VERSION: value }).some(
            (p) => p.startsWith("EMAIL_MAILKETING_API_VERSION")
          )
        ).toBe(true);
      }
    );

    test("v2 with a token and the default host is clean", () => {
      expect(
        validateEnv({
          ...email,
          EMAIL_MAILKETING_API_VERSION: "v2",
          EMAIL_MAILKETING_API_TOKEN: "real-looking-token",
          EMAIL_MAILKETING_API_BASE_URL: "https://api.mailketing.co.id"
        })
      ).toEqual([]);
    });

    test("v2 refuses any base URL off the allow-list, without echoing it", () => {
      const problems = validateEnv({
        ...email,
        EMAIL_MAILKETING_API_VERSION: "v2",
        EMAIL_MAILKETING_API_TOKEN: "t",
        EMAIL_MAILKETING_API_BASE_URL: "https://user:hunter2@evil.example"
      });

      expect(
        problems.some((p) => p.includes("EMAIL_MAILKETING_API_BASE_URL"))
      ).toBe(true);
      expect(problems.join("\n")).not.toContain("hunter2");
      expect(problems.join("\n")).not.toContain("evil.example");
    });

    test("v2 refuses a token that cannot be a header value, without echoing it", () => {
      const problems = validateEnv({
        ...email,
        EMAIL_MAILKETING_API_VERSION: "v2",
        EMAIL_MAILKETING_API_TOKEN: "sekrit value\nX: y"
      });

      expect(
        problems.some((p) => p.startsWith("EMAIL_MAILKETING_API_TOKEN"))
      ).toBe(true);
      expect(problems.join("\n")).not.toContain("sekrit");
    });

    test("v2 with email enabled requires the token; disabled email does not", () => {
      expect(
        validateEnv({ ...email, EMAIL_MAILKETING_API_VERSION: "v2" }).some(
          (p) => p.startsWith("EMAIL_MAILKETING_API_TOKEN")
        )
      ).toBe(true);
      expect(
        validateEnv({ ...base, EMAIL_MAILKETING_API_VERSION: "v2" })
      ).toEqual([]);
    });
  });
});
