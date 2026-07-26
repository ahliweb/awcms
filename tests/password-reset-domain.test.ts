/**
 * Pure-layer tests for password recovery (Wave 2 delta auth): token validity
 * evaluation, mailability, request validation, and the link-sealing helper.
 *
 * No database. The DB-backed behaviour — enumeration safety end to end, single
 * use under concurrency, session revocation, tenant isolation — is in
 * `tests/integration/password-reset.integration.test.ts`.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import {
  generateResetToken,
  hashResetToken
} from "../src/lib/auth/reset-token";
import {
  generateSessionToken,
  hashSessionToken
} from "../src/lib/auth/session-token";
import {
  openUrlParams,
  resolveUrlParamKey,
  sealUrlParams
} from "../src/lib/security/secure-url-params";
import {
  evaluatePasswordResetToken,
  isMailableLoginIdentifier
} from "../src/modules/identity-access/domain/password-reset-policy";
import {
  MIN_PASSWORD_LENGTH,
  validateCompleteResetInput,
  validateForgotIdentifierInput
} from "../src/modules/identity-access/domain/password-reset-validation";

const NOW = new Date("2026-07-26T12:00:00.000Z");
const KEY = Buffer.alloc(32, 7);

describe("evaluatePasswordResetToken", () => {
  test("a live, unused token is valid", () => {
    expect(
      evaluatePasswordResetToken(
        { expiresAt: new Date(NOW.getTime() + 60_000), usedAt: null },
        NOW
      )
    ).toEqual({ outcome: "valid" });
  });

  test("a missing row is not_found", () => {
    expect(evaluatePasswordResetToken(null, NOW)).toEqual({
      outcome: "invalid",
      reason: "not_found"
    });
  });

  test("a redeemed token is already_used even while still fresh", () => {
    expect(
      evaluatePasswordResetToken(
        { expiresAt: new Date(NOW.getTime() + 60_000), usedAt: NOW },
        NOW
      )
    ).toEqual({ outcome: "invalid", reason: "already_used" });
  });

  test("a redeemed token that has ALSO aged out still reports already_used", () => {
    // The check order is load-bearing, not incidental: `already_used` is the
    // reason that describes what actually happened, and an operator reading the
    // audit trail for a stolen-link incident needs that rather than `expired`.
    expect(
      evaluatePasswordResetToken(
        { expiresAt: new Date(NOW.getTime() - 60_000), usedAt: NOW },
        NOW
      )
    ).toEqual({ outcome: "invalid", reason: "already_used" });
  });

  test("expiry is inclusive — a token expiring exactly now is spent", () => {
    expect(
      evaluatePasswordResetToken({ expiresAt: NOW, usedAt: null }, NOW)
    ).toEqual({ outcome: "invalid", reason: "expired" });
  });
});

describe("isMailableLoginIdentifier", () => {
  test.each([
    ["owner@example.com", true],
    ["  owner@example.com  ", true],
    ["operator@sub.domain.example", true],
    ["not-an-address", false],
    ["@example.com", false],
    ["owner@", false],
    ["", false]
  ])("%s -> %s", (identifier, expected) => {
    expect(isMailableLoginIdentifier(identifier)).toBe(expected);
  });
});

describe("request validation", () => {
  test("forgot requires a non-blank loginIdentifier", () => {
    expect(
      validateForgotIdentifierInput({ loginIdentifier: "a@b.co" })
    ).toEqual({ valid: true, value: { loginIdentifier: "a@b.co" } });

    for (const body of [
      null,
      {},
      { loginIdentifier: "   " },
      { loginIdentifier: 7 }
    ]) {
      expect(validateForgotIdentifierInput(body).valid).toBe(false);
    }
  });

  test("reset requires a token and a long-enough password", () => {
    const short = "x".repeat(MIN_PASSWORD_LENGTH - 1);
    const long = "x".repeat(MIN_PASSWORD_LENGTH);

    expect(
      validateCompleteResetInput({ token: "t", newPassword: long })
    ).toEqual({ valid: true, value: { token: "t", newPassword: long } });

    const tooShort = validateCompleteResetInput({
      token: "t",
      newPassword: short
    });
    expect(tooShort.valid).toBe(false);

    const both = validateCompleteResetInput({});
    expect(both.valid).toBe(false);
    expect(both.valid === false && both.errors).toHaveLength(2);
  });

  test("the minimum length matches tenant_admin's setup bootstrap", async () => {
    // The two constants cannot be shared — `identity_access` DEPENDS ON
    // `tenant_admin`, so exporting one from here and importing it there would
    // invert the module DAG. This is what keeps them from drifting instead. Read
    // as text, deliberately: the tenant_admin constant is module-private, and
    // exporting it just to test it would create the very edge this avoids.
    const source = await readFile(
      "src/modules/tenant-admin/domain/setup-validation.ts",
      "utf8"
    );
    const match = source.match(/const MIN_PASSWORD_LENGTH = (\d+);/);

    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(MIN_PASSWORD_LENGTH);
  });
});

describe("reset tokens", () => {
  test("are 256-bit base64url values, hashed with a prefixed sha256", () => {
    const token = generateResetToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(hashResetToken(token)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("never collide across generations", () => {
    const tokens = new Set(
      Array.from({ length: 64 }, () => generateResetToken())
    );

    expect(tokens.size).toBe(64);
  });

  test("hash identically to session tokens — the SEPARATION is by name, not by algorithm", () => {
    // Stated as a test rather than left implicit: the two helper pairs exist so
    // a call site cannot confuse a reset token with a session token, NOT because
    // the constructions differ. If someone "hardens" one of them later, this
    // goes red and forces the decision to be made deliberately for both.
    const raw = generateSessionToken();

    expect(hashResetToken(raw)).toBe(hashSessionToken(raw));
  });
});

describe("sealUrlParams / openUrlParams", () => {
  test("round-trips a param map through an opaque token", () => {
    const sealed = sealUrlParams({ token: "abc", tenantId: "t-1" }, KEY);

    expect(sealed).toMatch(
      /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
    );
    expect(openUrlParams(sealed!, KEY)).toEqual({
      token: "abc",
      tenantId: "t-1"
    });
  });

  test("is randomized — the same input never seals to the same token twice", () => {
    const a = sealUrlParams({ token: "abc" }, KEY);
    const b = sealUrlParams({ token: "abc" }, KEY);

    expect(a).not.toBe(b);
    expect(openUrlParams(a!, KEY)).toEqual(openUrlParams(b!, KEY));
  });

  test("a tampered ciphertext fails closed rather than opening to garbage", () => {
    const sealed = sealUrlParams({ token: "abc", tenantId: "t-1" }, KEY)!;
    const parts = sealed.split(".");
    const flipped = Buffer.from(parts[3]!, "base64url");
    flipped[0] = flipped[0]! ^ 0xff;
    parts[3] = flipped.toString("base64url");

    expect(openUrlParams(parts.join("."), KEY)).toBeNull();
  });

  test.each([
    ["wrong version", "v2.a.b.c"],
    ["too few parts", "v1.a.b"],
    ["not base64url at all", "v1.!!!.!!!.!!!"]
  ])("rejects a malformed token (%s)", (_label, token) => {
    expect(openUrlParams(token, KEY)).toBeNull();
  });

  test("a token sealed under a different key does not open", () => {
    const sealed = sealUrlParams({ token: "abc" }, KEY)!;

    expect(openUrlParams(sealed, Buffer.alloc(32, 9))).toBeNull();
  });

  test("no key means sealing is unavailable, not silently unencrypted", () => {
    expect(sealUrlParams({ token: "abc" }, null)).toBeNull();
    expect(openUrlParams("v1.a.b.c", null)).toBeNull();
  });

  test.each([
    ["unset", {}],
    ["not base64 32 bytes", { AUTH_URL_PARAM_ENCRYPTION_KEY: "too-short" }],
    [
      "31 bytes",
      { AUTH_URL_PARAM_ENCRYPTION_KEY: Buffer.alloc(31, 1).toString("base64") }
    ]
  ])("resolveUrlParamKey returns null when the key is %s", (_label, env) => {
    expect(resolveUrlParamKey(env as NodeJS.ProcessEnv)).toBeNull();
  });

  test("resolveUrlParamKey accepts exactly 32 base64 bytes", () => {
    const key = resolveUrlParamKey({
      AUTH_URL_PARAM_ENCRYPTION_KEY: KEY.toString("base64")
    } as NodeJS.ProcessEnv);

    expect(key).not.toBeNull();
    expect(key).toHaveLength(32);
  });
});
