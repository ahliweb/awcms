/**
 * ADR-0066 — the shared, cross-instance rate limiter.
 *
 * The properties that matter are the ones a single-process test would never
 * notice: that two independent callers counting against the same window AGREE
 * (which is the whole reason Redis is involved), and that a Redis outage
 * degrades to ALLOW rather than to a site-wide login lockout.
 */
import { describe, expect, test } from "bun:test";

import { checkSharedRateLimit } from "../src/lib/security/rate-limit";

const CONFIG = { maxAttempts: 3, windowMs: 60_000 };
const NOW = 1_800_000_000_000;

/** A Redis stand-in that two "instances" can share, so the counter is genuinely common. */
function fakeRedis() {
  const store = new Map<string, number>();
  const expires: string[] = [];

  return {
    store,
    expires,
    client: {
      async send(command: string, args: string[]): Promise<unknown> {
        if (command === "INCR") {
          const next = (store.get(args[0]!) ?? 0) + 1;
          store.set(args[0]!, next);
          return next;
        }

        if (command === "PEXPIRE") {
          expires.push(args[0]!);
          return 1;
        }

        throw new Error(`unexpected command ${command}`);
      }
    }
  };
}

describe("shared counting", () => {
  test("two instances share one counter", async () => {
    // The defect this closes: with an in-process Map, N replicas each allow the
    // full quota, so the effective limit is N x configured.
    const redis = fakeRedis();
    const call = () =>
      checkSharedRateLimit("ip:1.2.3.4", CONFIG, NOW, {
        client: redis.client,
        buildKey: (raw) => raw
      });

    expect((await call()).allowed).toBe(true);
    expect((await call()).allowed).toBe(true);
    expect((await call()).allowed).toBe(true);

    const fourth = await call();

    expect(fourth.allowed).toBe(false);
    expect(fourth.allowed === false && fourth.retryAfterSec).toBeGreaterThan(0);
  });

  test("the window is part of the KEY, so instances need no shared clock read", async () => {
    const redis = fakeRedis();

    await checkSharedRateLimit("k", CONFIG, NOW, {
      client: redis.client,
      buildKey: (raw) => raw
    });
    await checkSharedRateLimit("k", CONFIG, NOW + CONFIG.windowMs, {
      client: redis.client,
      buildKey: (raw) => raw
    });

    // Two windows, two keys, each counted once — no read-modify-write anywhere.
    expect([...redis.store.values()]).toEqual([1, 1]);
  });

  test("the TTL is set once, on the first hit of a window", async () => {
    const redis = fakeRedis();
    const call = () =>
      checkSharedRateLimit("k", CONFIG, NOW, {
        client: redis.client,
        buildKey: (raw) => raw
      });

    await call();
    await call();
    await call();

    // Re-setting it on every hit would slide the window and let a steady
    // attacker hold the key alive indefinitely.
    expect(redis.expires).toHaveLength(1);
  });
});

describe("failure behaviour", () => {
  test("a Redis outage ALLOWS rather than locking everyone out", async () => {
    // Deliberately the opposite of this repo's default posture. Failing closed
    // would make a Redis outage an attacker-triggerable denial of the entire
    // control plane, and the DB-enforced per-identity lockout is unaffected by
    // it — this limiter is the source-scoped backstop, not the last line.
    const broken = {
      async send(): Promise<unknown> {
        throw new Error("connection refused");
      }
    };

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(
        (
          await checkSharedRateLimit("k", CONFIG, NOW, {
            client: broken,
            buildKey: (raw) => raw
          })
        ).allowed
      ).toBe(true);
    }
  });

  test("with no Redis configured it still limits, in-process", async () => {
    // A single-instance deployment has nothing to share, and must not need
    // Redis to get a limiter at all.
    const key = `no-redis-${NOW}`;
    const call = () => checkSharedRateLimit(key, CONFIG, NOW, { client: null });

    expect((await call()).allowed).toBe(true);
    expect((await call()).allowed).toBe(true);
    expect((await call()).allowed).toBe(true);
    expect((await call()).allowed).toBe(false);
  });
});

describe("every authentication surface is limited", () => {
  test.each([
    ["auth/login.ts"],
    ["auth/register.ts"],
    ["auth/mfa/totp/verify.ts"],
    ["auth/mfa/step-up.ts"],
    ["auth/password/reset.ts"],
    ["auth/password/forgot.ts"],
    ["auth/session.ts"],
    ["auth/session-handoff/issue.ts"],
    ["auth/session-handoff/redeem.ts"],
    ["auth/sso/[providerKey]/start.ts"],
    ["auth/sso/[providerKey]/callback.ts"],
    // ADR-0082 — eleven became thirteen. Both are unauthenticated and
    // token-bearing, and the second of them CREATES AN ACCOUNT, which makes it
    // the most consequential unauthenticated write in this module.
    ["auth/invitations/[token].ts"],
    ["auth/invitations/[token]/accept.ts"]
  ])("%s calls the shared limiter", async (route) => {
    // ASVS V11.2 wants anti-automation across the WHOLE authentication surface,
    // not most of it. Three of these had none before ADR-0066.
    //
    // Either entry point counts, and #447 is why there are two: seven of these
    // routes keyed their bucket on the raw tenant header, so they now go
    // through `checkAuthRateLimit`, which calls the shared limiter twice — once
    // for a source ceiling whose key the caller cannot choose, once for the
    // per-tenant bucket they already had. Asserting the inner name here would
    // have made this ledger a reason NOT to fix that.
    const source = await Bun.file(`src/pages/api/v1/${route}`).text();

    expect(
      source.includes("checkSharedRateLimit(") ||
        source.includes("checkAuthRateLimit(")
    ).toBe(true);
  });

  test("no route still uses the per-instance limiter directly", async () => {
    const offenders: string[] = [];

    for (const entry of await Array.fromAsync(
      new Bun.Glob("**/*.ts").scan({ cwd: "src/pages/api/v1" })
    )) {
      const source = await Bun.file(`src/pages/api/v1/${entry}`).text();

      if (/(?<!Shared)(?<!\w)checkRateLimit\(/.test(source)) {
        offenders.push(entry);
      }
    }

    expect(offenders).toEqual([]);
  });
});
