import { describe, expect, test } from "bun:test";

import { createHash } from "node:crypto";

import {
  ANONYMOUS_IDEMPOTENCY_ACTOR,
  computeRequestHash,
  machineIdempotencyActor,
  userIdempotencyActor
} from "../src/modules/_shared/idempotency";
import {
  describeIdempotencySecretProblem,
  IdempotencyConfigurationError,
  keyedRequestHash,
  resetIdempotencyHmacKeyForTests
} from "../src/lib/security/idempotency-hmac";
import { validateEnv } from "../scripts/validate-env";

describe("computeRequestHash", () => {
  test("is deterministic and independent of key order", () => {
    const a = computeRequestHash({ amount: 100, currency: "IDR" });
    const b = computeRequestHash({ currency: "IDR", amount: 100 });

    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test("normalizes nested object key order too", () => {
    const a = computeRequestHash({
      meta: { b: 1, a: 2 },
      items: [{ y: 1, x: 2 }]
    });
    const b = computeRequestHash({
      items: [{ x: 2, y: 1 }],
      meta: { a: 2, b: 1 }
    });

    expect(a).toBe(b);
  });

  test("differs for different payloads", () => {
    expect(computeRequestHash({ amount: 100 })).not.toBe(
      computeRequestHash({ amount: 101 })
    );
  });

  test("preserves array order (arrays are ordered, not sorted)", () => {
    expect(computeRequestHash([1, 2, 3])).not.toBe(
      computeRequestHash([3, 2, 1])
    );
  });
});

describe("keyed request hash (ADR-0145)", () => {
  const SECRET_A = "a".repeat(40);
  const SECRET_B = "b".repeat(40);
  const stable = JSON.stringify({ reason: "late" });

  test("is an HMAC, not the plain SHA-256 of the body", () => {
    const plain = createHash("sha256").update(stable).digest("hex");
    const keyed = keyedRequestHash(stable, {
      IDEMPOTENCY_HMAC_SECRET: SECRET_A
    });

    expect(keyed).toMatch(/^[0-9a-f]{64}$/);
    expect(keyed).not.toBe(plain);
  });

  test("depends on the secret, so a table reader without it cannot confirm a guess", () => {
    const a = keyedRequestHash(stable, { IDEMPOTENCY_HMAC_SECRET: SECRET_A });

    expect(a).not.toBe(
      keyedRequestHash(stable, { IDEMPOTENCY_HMAC_SECRET: SECRET_B })
    );
    expect(a).toBe(
      keyedRequestHash(stable, { IDEMPOTENCY_HMAC_SECRET: SECRET_A })
    );
  });

  test("fails closed in production when the secret is unset, a placeholder or short", () => {
    for (const value of [undefined, "", "change-me", "short-secret"]) {
      expect(() =>
        keyedRequestHash(stable, {
          APP_ENV: "production",
          IDEMPOTENCY_HMAC_SECRET: value
        })
      ).toThrow(IdempotencyConfigurationError);
    }

    expect(() =>
      keyedRequestHash(stable, {
        APP_ENV: "production",
        IDEMPOTENCY_HMAC_SECRET: SECRET_A
      })
    ).not.toThrow();
  });

  test("outside production an unset secret falls back to a stable per-process key", () => {
    resetIdempotencyHmacKeyForTests();
    const first = keyedRequestHash(stable, { APP_ENV: "development" });
    const second = keyedRequestHash(stable, { APP_ENV: "development" });

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  test("describeIdempotencySecretProblem names why a value is unusable", () => {
    expect(describeIdempotencySecretProblem(undefined)).toBe("not set");
    expect(describeIdempotencySecretProblem("Change-Me")).toMatch(
      /placeholder/
    );
    expect(describeIdempotencySecretProblem("x".repeat(31))).toMatch(/shorter/);
    expect(describeIdempotencySecretProblem("x".repeat(32))).toBeNull();
  });

  test("config:validate requires a real secret in production only", () => {
    const mentions = (env: Record<string, string>) =>
      validateEnv(env).some((p) => p.includes("IDEMPOTENCY_HMAC_SECRET"));
    const base = { DATABASE_URL: "postgres://u@h/db" };

    expect(mentions({ ...base, APP_ENV: "production" })).toBe(true);
    expect(
      mentions({
        ...base,
        APP_ENV: "production",
        IDEMPOTENCY_HMAC_SECRET: SECRET_A
      })
    ).toBe(false);
    expect(mentions({ ...base, APP_ENV: "development" })).toBe(false);
  });
});

describe("idempotency actors (ADR-0145)", () => {
  test("constructors prefix the kind and refuse an empty id", () => {
    expect(String(userIdempotencyActor("u-1"))).toBe("user:u-1");
    expect(String(machineIdempotencyActor("m-1"))).toBe("machine:m-1");
    expect(String(ANONYMOUS_IDEMPOTENCY_ACTOR)).toBe("anonymous");
    expect(() => userIdempotencyActor("")).toThrow(TypeError);
    expect(() => userIdempotencyActor("   ")).toThrow(TypeError);
    expect(() => machineIdempotencyActor("")).toThrow(TypeError);
  });
});
