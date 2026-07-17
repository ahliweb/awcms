import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  checkRateLimit,
  resolveClientIp
} from "../src/lib/security/rate-limit";

const originalTrustedProxy = process.env.TRUSTED_PROXY_ENABLED;

beforeEach(() => {
  delete process.env.TRUSTED_PROXY_ENABLED;
});

afterEach(() => {
  if (originalTrustedProxy === undefined) {
    delete process.env.TRUSTED_PROXY_ENABLED;
  } else {
    process.env.TRUSTED_PROXY_ENABLED = originalTrustedProxy;
  }
});

function requestWithForwardedFor(forwardedFor?: string): Request {
  return new Request("https://example.test/api/v1/auth/login", {
    method: "POST",
    headers:
      forwardedFor === undefined ? {} : { "x-forwarded-for": forwardedFor }
  });
}

describe("resolveClientIp (Issue #147 §3)", () => {
  test("ignores X-Forwarded-For by default — the header is attacker-controlled when the app is exposed directly", () => {
    const resolved = resolveClientIp(
      requestWithForwardedFor("1.2.3.4"),
      "198.51.100.9"
    );

    expect(resolved).toBe("198.51.100.9");
  });

  test("ignores X-Forwarded-For when TRUSTED_PROXY_ENABLED is anything but the exact string `true`", () => {
    for (const value of ["false", "1", "yes", "TRUE", ""]) {
      process.env.TRUSTED_PROXY_ENABLED = value;

      expect(
        resolveClientIp(requestWithForwardedFor("1.2.3.4"), "198.51.100.9")
      ).toBe("198.51.100.9");
    }
  });

  test("honors the first X-Forwarded-For entry once a trusted proxy is declared", () => {
    process.env.TRUSTED_PROXY_ENABLED = "true";

    expect(
      resolveClientIp(
        requestWithForwardedFor("203.0.113.7, 70.41.3.18"),
        "198.51.100.9"
      )
    ).toBe("203.0.113.7");
  });

  test("falls back to clientAddress when a trusted proxy sends no X-Forwarded-For", () => {
    process.env.TRUSTED_PROXY_ENABLED = "true";

    expect(resolveClientIp(requestWithForwardedFor(), "198.51.100.9")).toBe(
      "198.51.100.9"
    );
    expect(resolveClientIp(requestWithForwardedFor("  "), "198.51.100.9")).toBe(
      "198.51.100.9"
    );
  });

  test("falls back to a placeholder when there is no address at all", () => {
    expect(resolveClientIp(requestWithForwardedFor(), undefined)).toBe(
      "unknown"
    );
  });
});

describe("login rate limit under a spoofed X-Forwarded-For (Issue #147 §3)", () => {
  /**
   * The attack this closes: one source rotating `X-Forwarded-For` per request
   * landed in a fresh bucket every time, so the login limiter never fired and
   * an attacker kept unlimited access to an endpoint that runs argon2id m=64MB
   * per call.
   */
  function attemptsAllowedFromOneSource(spoofPerRequest: boolean): number {
    const tenantId = `tenant-${Math.random()}`;
    const maxAttempts = 20;
    let allowed = 0;

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const request = requestWithForwardedFor(
        spoofPerRequest ? `10.0.0.${attempt}` : "10.0.0.1"
      );
      const clientIp = resolveClientIp(request, "198.51.100.9");
      const result = checkRateLimit(`${clientIp}:${tenantId}`, {
        maxAttempts,
        windowMs: 60_000
      });

      if (result.allowed) allowed += 1;
    }

    return allowed;
  }

  test("a rotating X-Forwarded-For no longer buys a fresh bucket per request", () => {
    expect(attemptsAllowedFromOneSource(true)).toBe(20);
  });

  test("the limit is unchanged for a non-spoofing source", () => {
    expect(attemptsAllowedFromOneSource(false)).toBe(20);
  });
});
