/**
 * `/login` second-factor step (Issue #1365): the pure client helpers and the
 * page's source contract. The browser flow itself is covered by the E2E spec
 * `tests/e2e/login-mfa.e2e.ts`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildVerifyBody,
  createChallengeBudget,
  isPlausibleTotpCode,
  readLoginOutcome,
  readVerifySuccess
} from "../src/lib/ui/login-mfa-client";

const mfaBody = (code: unknown, token: unknown = "tok-123") => ({
  success: false,
  error: { code, message: "ignored", details: { mfaChallengeToken: token } }
});

describe("readLoginOutcome", () => {
  test("success only when ok and success === true", () => {
    expect(readLoginOutcome(true, { success: true, data: {} })).toEqual({
      kind: "success"
    });
    expect(readLoginOutcome(true, { success: false })).toEqual({
      kind: "failed"
    });
    expect(readLoginOutcome(false, { success: true })).toEqual({
      kind: "failed"
    });
  });

  test("MFA_REQUIRED with a token selects the MFA branch", () => {
    expect(readLoginOutcome(false, mfaBody("MFA_REQUIRED"))).toEqual({
      kind: "mfa",
      challengeToken: "tok-123"
    });
  });

  test("every other error code is the same generic failure", () => {
    for (const code of [
      "INVALID_CREDENTIALS",
      "MFA_ENROLLMENT_REQUIRED",
      "RATE_LIMITED",
      "ACCOUNT_LOCKED",
      "SOMETHING_NEW"
    ]) {
      expect(readLoginOutcome(false, mfaBody(code))).toEqual({
        kind: "failed"
      });
    }
  });

  test("MFA_REQUIRED without a usable token, or a non-object body, fails", () => {
    expect(readLoginOutcome(false, mfaBody("MFA_REQUIRED", ""))).toEqual({
      kind: "failed"
    });
    expect(readLoginOutcome(false, mfaBody("MFA_REQUIRED", 42))).toEqual({
      kind: "failed"
    });
    expect(readLoginOutcome(false, null)).toEqual({ kind: "failed" });
    expect(readLoginOutcome(false, "oops")).toEqual({ kind: "failed" });
  });

  test("reads no property beyond success, error.code and the token", () => {
    const touched: string[] = [];
    const spy = (target: object, path: string): object =>
      new Proxy(target, {
        get(obj, key) {
          touched.push(`${path}.${String(key)}`);
          const value = Reflect.get(obj, key);
          return value && typeof value === "object"
            ? spy(value, `${path}.${String(key)}`)
            : value;
        }
      });

    readLoginOutcome(false, spy(mfaBody("MFA_REQUIRED"), "body"));
    expect(new Set(touched)).toEqual(
      new Set([
        "body.success",
        "body.error",
        "body.error.code",
        "body.error.details",
        "body.error.details.mfaChallengeToken"
      ])
    );
  });
});

describe("readVerifySuccess", () => {
  test("reads success and nothing else", () => {
    expect(readVerifySuccess(true, { success: true })).toBe(true);
    expect(readVerifySuccess(false, { success: true })).toBe(false);
    expect(readVerifySuccess(true, { success: "yes" })).toBe(false);
    expect(readVerifySuccess(true, null)).toBe(false);

    const touched: string[] = [];
    const body = new Proxy(
      { success: false, error: { code: "MFA_CHALLENGE_EXPIRED" } },
      {
        get(obj, key) {
          touched.push(String(key));
          return Reflect.get(obj, key);
        }
      }
    );
    expect(readVerifySuccess(false, body)).toBe(false);
    expect(touched.filter((key) => key !== "success")).toEqual([]);
  });
});

describe("buildVerifyBody and code shape", () => {
  test("code vs recovery code are mutually exclusive", () => {
    expect(buildVerifyBody("t", " 123 456 ", false)).toEqual({
      mfaChallengeToken: "t",
      code: "123456"
    });
    expect(buildVerifyBody("t", " ABCD-1234 ", true)).toEqual({
      mfaChallengeToken: "t",
      recoveryCode: "ABCD-1234"
    });
  });

  test("a TOTP code is exactly six digits", () => {
    expect(isPlausibleTotpCode("123456")).toBe(true);
    expect(isPlausibleTotpCode("123 456")).toBe(true);
    expect(isPlausibleTotpCode("12345")).toBe(false);
    expect(isPlausibleTotpCode("1234567")).toBe(false);
    expect(isPlausibleTotpCode("12345a")).toBe(false);
  });
});

describe("createChallengeBudget", () => {
  test("exhausted after the attempt cap", () => {
    const budget = createChallengeBudget(300, 3, () => 0);
    budget.recordFailure();
    budget.recordFailure();
    expect(budget.exhausted()).toBe(false);
    budget.recordFailure();
    expect(budget.exhausted()).toBe(true);
  });

  test("exhausted once the challenge lifetime has elapsed", () => {
    let clock = 1_000;
    const budget = createChallengeBudget(300, 5, () => clock);
    clock += 299_999;
    expect(budget.exhausted()).toBe(false);
    clock += 1;
    expect(budget.exhausted()).toBe(true);
  });
});

describe("login.astro source contract", () => {
  const page = readFileSync(
    join(import.meta.dir, "..", "src", "pages", "login.astro"),
    "utf8"
  );

  test("has the code step with the one-time-code input attributes", () => {
    expect(page).toContain('id="mfa-form"');
    expect(page).toContain('autocomplete="one-time-code"');
    expect(page).toContain('inputmode="numeric"');
    expect(page).toContain("/api/v1/auth/mfa/totp/verify");
  });

  test("the challenge token never reaches storage, URL or DOM", () => {
    expect(page).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    expect(page).not.toMatch(/history\.(push|replace)State/);
    expect(page).not.toMatch(/location\.(search|hash)/);
    expect(page).not.toMatch(/dataset\.[a-zA-Z]*[Tt]oken/);
    expect(page).not.toMatch(/data-[a-z-]*token/);
  });

  test("the outcome is chosen by the helpers, not by reading the body inline", () => {
    expect(page).toContain("readLoginOutcome(response.ok, payload)");
    expect(page).toContain("readVerifySuccess(response.ok, payload)");
    expect(page).not.toContain("payload.error");
  });

  test("TTL and attempt cap are rendered from server configuration", () => {
    expect(page).toContain("resolveChallengeTtlSec()");
    expect(page).toContain("resolveMfaMaxVerifyAttempts()");
  });
});
