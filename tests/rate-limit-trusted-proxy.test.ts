import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  checkRateLimit,
  resolveClientIp,
  selectForwardedEntry
} from "../src/lib/security/rate-limit";

const originalTrustedProxy = process.env.TRUSTED_PROXY_ENABLED;
const originalHopCount = process.env.TRUSTED_PROXY_HOP_COUNT;

beforeEach(() => {
  delete process.env.TRUSTED_PROXY_ENABLED;
  delete process.env.TRUSTED_PROXY_HOP_COUNT;
});

afterEach(() => {
  if (originalTrustedProxy === undefined) {
    delete process.env.TRUSTED_PROXY_ENABLED;
  } else {
    process.env.TRUSTED_PROXY_ENABLED = originalTrustedProxy;
  }

  if (originalHopCount === undefined) {
    delete process.env.TRUSTED_PROXY_HOP_COUNT;
  } else {
    process.env.TRUSTED_PROXY_HOP_COUNT = originalHopCount;
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

  test("reads the entry ONE hop from the right, not the leftmost (#438)", () => {
    // This assertion used to read `203.0.113.7` — the leftmost entry. That is
    // the position an attacker writes when the proxy APPENDS, which is what
    // nginx's `$proxy_add_x_forwarded_for` does. The rightmost entry is the one
    // your own edge wrote.
    process.env.TRUSTED_PROXY_ENABLED = "true";

    expect(
      resolveClientIp(
        requestWithForwardedFor("203.0.113.7, 70.41.3.18"),
        "198.51.100.9"
      )
    ).toBe("70.41.3.18");
  });

  test("an overwriting proxy is unaffected — one entry is both leftmost and rightmost", () => {
    // The only topology the old rule was ever sound for, byte-identical after
    // the change. That is what makes this fix safe to land without a flag.
    process.env.TRUSTED_PROXY_ENABLED = "true";

    expect(
      resolveClientIp(requestWithForwardedFor("203.0.113.7"), "198.51.100.9")
    ).toBe("203.0.113.7");
  });

  test("a prepended spoof cannot be read at any hop count it does not reach", () => {
    process.env.TRUSTED_PROXY_ENABLED = "true";

    // The attacker sends `X-Forwarded-For: 9.9.9.9`; the edge appends the real
    // peer. Under the old rule the bucket key was 9.9.9.9 — attacker-chosen,
    // and different on every request.
    expect(
      resolveClientIp(
        requestWithForwardedFor("9.9.9.9, 203.0.113.7"),
        "198.51.100.9"
      )
    ).toBe("203.0.113.7");

    // Two real hops, declared: still never the attacker's entry.
    process.env.TRUSTED_PROXY_HOP_COUNT = "2";
    expect(
      resolveClientIp(
        requestWithForwardedFor("9.9.9.9, 203.0.113.7, 70.41.3.18"),
        "198.51.100.9"
      )
    ).toBe("203.0.113.7");
  });

  test("a header shorter than the declared chain falls back to clientAddress", () => {
    // Fewer entries than trusted hops means the request did not traverse the
    // declared chain. Degrading to the proxy's own address over-limits;
    // reading a shorter chain's leftmost value would under-limit, which is the
    // failure being closed.
    process.env.TRUSTED_PROXY_ENABLED = "true";
    process.env.TRUSTED_PROXY_HOP_COUNT = "3";

    expect(
      resolveClientIp(
        requestWithForwardedFor("9.9.9.9, 203.0.113.7"),
        "198.51.100.9"
      )
    ).toBe("198.51.100.9");
  });

  test("a malformed hop count falls back to 1, never to zero", () => {
    // Zero would index past the right edge and return null for every header —
    // silently disabling header trust on a deployment that believes it
    // configured it.
    process.env.TRUSTED_PROXY_ENABLED = "true";

    for (const value of ["0", "-1", "abc", "1.5", " "]) {
      process.env.TRUSTED_PROXY_HOP_COUNT = value;

      expect(
        resolveClientIp(
          requestWithForwardedFor("9.9.9.9, 203.0.113.7"),
          "198.51.100.9"
        )
      ).toBe("203.0.113.7");
    }
  });
});

describe("selectForwardedEntry — the arithmetic on its own", () => {
  test("counts from the right", () => {
    expect(selectForwardedEntry("a, b, c", 1)).toBe("c");
    expect(selectForwardedEntry("a, b, c", 2)).toBe("b");
    expect(selectForwardedEntry("a, b, c", 3)).toBe("a");
  });

  test("returns null rather than wrapping when the chain is shorter", () => {
    expect(selectForwardedEntry("a, b", 3)).toBeNull();
    expect(selectForwardedEntry("a", 2)).toBeNull();
  });

  test("blank and padded entries do not shift the count", () => {
    // `"a, , b"` must be a two-entry chain, or an attacker adds commas to push
    // the real client out of the counted position.
    expect(selectForwardedEntry("a, , b", 1)).toBe("b");
    expect(selectForwardedEntry("a, , b", 2)).toBe("a");
    expect(selectForwardedEntry("  a  ,  b  ", 1)).toBe("b");
    expect(selectForwardedEntry(" , , ", 1)).toBeNull();
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
