/**
 * The auth rate limit's source ceiling — issue #447.
 *
 * The hole was not that the limit was too loose. It was that the bucket key
 * came from `x-awcms-tenant-id`, an unvalidated request header, so an attacker
 * picked their own bucket: a different random UUID per request meant the
 * limiter never counted past one. Every request that slipped through cost an
 * argon2id `m=64MB` verify, because `verifyPasswordOrDummy` runs even for an
 * identifier that resolves to nothing.
 *
 * Two things are asserted, and the second is the one that survives a year:
 *
 * 1. the source ceiling binds even when every request carries a fresh tenant;
 * 2. no route can get the per-tenant bucket WITHOUT the source ceiling, because
 *    they are one function. The structural test at the bottom is what stops the
 *    seventh route from quietly reintroducing the bypass.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  DEFAULT_SOURCE_RATE_LIMIT_MAX,
  checkAuthRateLimit
} from "../src/lib/security/auth-rate-limit";

const originalMax = process.env.AUTH_SOURCE_RATE_LIMIT_MAX;
const originalWindow = process.env.AUTH_SOURCE_RATE_LIMIT_WINDOW_SEC;

beforeEach(() => {
  delete process.env.AUTH_SOURCE_RATE_LIMIT_MAX;
  delete process.env.AUTH_SOURCE_RATE_LIMIT_WINDOW_SEC;
});

afterEach(() => {
  if (originalMax === undefined) delete process.env.AUTH_SOURCE_RATE_LIMIT_MAX;
  else process.env.AUTH_SOURCE_RATE_LIMIT_MAX = originalMax;

  if (originalWindow === undefined) {
    delete process.env.AUTH_SOURCE_RATE_LIMIT_WINDOW_SEC;
  } else {
    process.env.AUTH_SOURCE_RATE_LIMIT_WINDOW_SEC = originalWindow;
  }
});

/** A fresh source per test — the buckets are process-global by design. */
function source(label: string): string {
  return `203.0.113.${label}`;
}

async function attempt(
  clientIp: string,
  tenantId: string,
  maxAttempts = 1000
): Promise<boolean> {
  const result = await checkAuthRateLimit({
    clientIp,
    tenantId,
    scope: "login",
    config: { maxAttempts, windowMs: 60_000 }
  });

  return result.allowed;
}

describe("the bypass itself", () => {
  test("a fresh tenant per request no longer buys a fresh bucket", async () => {
    process.env.AUTH_SOURCE_RATE_LIMIT_MAX = "5";
    const ip = source("1");
    let allowed = 0;

    // Every request carries a DIFFERENT tenant, exactly as the attack does.
    // Before this change the per-tenant bucket was empty every time and all 50
    // were allowed.
    for (let i = 0; i < 50; i += 1) {
      if (
        await attempt(
          ip,
          `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`
        )
      ) {
        allowed += 1;
      }
    }

    expect(allowed).toBe(5);
  });

  test("the refusal carries a retry-after, not a lockout", async () => {
    process.env.AUTH_SOURCE_RATE_LIMIT_MAX = "1";
    const ip = source("2");

    await attempt(ip, "tenant-a");
    const refused = await checkAuthRateLimit({
      clientIp: ip,
      tenantId: "tenant-b",
      scope: "login",
      config: { maxAttempts: 1000, windowMs: 60_000 }
    });

    expect(refused.allowed).toBe(false);
    expect(refused.allowed === false && refused.retryAfterSec).toBeGreaterThan(
      0
    );
  });
});

describe("inert where it must be", () => {
  test("on one tenant the per-tenant ceiling still decides", async () => {
    // This is what lets the change land without a flag: with a single tenant
    // the per-tenant bucket fills first, so the source ceiling is unreachable
    // and behaviour is unchanged. `config:validate` refuses a source ceiling
    // below the login ceiling precisely to keep this true.
    process.env.AUTH_SOURCE_RATE_LIMIT_MAX = "60";
    const ip = source("3");
    let allowed = 0;

    for (let i = 0; i < 40; i += 1) {
      if (await attempt(ip, "the-only-tenant", 20)) allowed += 1;
    }

    expect(allowed).toBe(20);
  });

  test("one source's ceiling does not spend another's", async () => {
    process.env.AUTH_SOURCE_RATE_LIMIT_MAX = "2";

    expect(await attempt(source("4"), "t")).toBe(true);
    expect(await attempt(source("4"), "t")).toBe(true);
    expect(await attempt(source("4"), "t")).toBe(false);
    expect(await attempt(source("5"), "t")).toBe(true);
  });
});

describe("the ceiling's own configuration", () => {
  test("defaults to 60, and a malformed value does not silently become zero", async () => {
    expect(DEFAULT_SOURCE_RATE_LIMIT_MAX).toBe(60);

    for (const value of ["0", "-3", "abc", " "]) {
      process.env.AUTH_SOURCE_RATE_LIMIT_MAX = value;
      // A zero ceiling would refuse the very first request and take the whole
      // auth surface down; the fallback is the default, never zero.
      expect(await attempt(source(`6${value.length}`), "t")).toBe(true);
    }
  });
});

describe("no route can take half of it", () => {
  test("nothing keys a rate limit on the tenant header any more", async () => {
    // The structural half. `checkAuthRateLimit` pairs the two ceilings inside
    // one function so a route cannot obtain the per-tenant bucket alone — but
    // nothing stops a new route calling `checkSharedRateLimit` directly with a
    // tenant-shaped key, which is the bypass rebuilt by hand. This is the
    // assertion that notices.
    const offenders: string[] = [];

    for await (const file of new Bun.Glob("src/pages/**/*.ts").scan({
      cwd: process.cwd()
    })) {
      const source = await Bun.file(file).text();

      if (/checkSharedRateLimit\(\s*`[^`]*\$\{tenantId\}/.test(source)) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });

  test("the seven auth routes go through the paired helper", async () => {
    // Seven, not the six the issue listed. The structural test above found
    // `sso/[providerKey]/start.ts` after the first six were converted by hand —
    // which is the argument for having it, in one line.
    const routes = [
      "src/pages/api/v1/auth/login.ts",
      "src/pages/api/v1/auth/register.ts",
      "src/pages/api/v1/auth/mfa/step-up.ts",
      "src/pages/api/v1/auth/mfa/totp/verify.ts",
      "src/pages/api/v1/auth/password/forgot.ts",
      "src/pages/api/v1/auth/password/reset.ts",
      "src/pages/api/v1/auth/sso/[providerKey]/start.ts"
    ];

    for (const route of routes) {
      const contents = await Bun.file(route).text();

      expect(contents).toContain("checkAuthRateLimit(");
    }
  });
});
