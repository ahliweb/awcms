/**
 * `/login` second-factor step (Issue #1365): the pure client helpers and the
 * page's source contract. The browser flow itself is covered by the E2E spec
 * `tests/e2e/login-mfa.e2e.ts`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildEnrolHeaders,
  buildEnrolVerifyBody,
  buildVerifyBody,
  createChallengeBudget,
  isPlausibleTotpCode,
  readEnrolStart,
  readEnrolVerify,
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
      "RATE_LIMITED",
      "ACCOUNT_LOCKED",
      "SOMETHING_NEW"
    ]) {
      expect(readLoginOutcome(false, mfaBody(code))).toEqual({
        kind: "failed"
      });
    }
  });

  test("MFA_ENROLLMENT_REQUIRED with a token selects the enrolment branch (#1425)", () => {
    const body = (code: unknown, token: unknown = "enrol-tok") => ({
      success: false,
      error: {
        code,
        message: "ignored",
        details: { mfaEnrollmentToken: token, expiresAt: "2030-01-01" }
      }
    });
    expect(readLoginOutcome(false, body("MFA_ENROLLMENT_REQUIRED"))).toEqual({
      kind: "enrol",
      enrolmentToken: "enrol-tok"
    });
    // No usable token, or the token under the wrong code: generic failure.
    expect(
      readLoginOutcome(false, body("MFA_ENROLLMENT_REQUIRED", ""))
    ).toEqual({ kind: "failed" });
    expect(readLoginOutcome(false, body("MFA_REQUIRED"))).toEqual({
      kind: "failed"
    });
    expect(readLoginOutcome(true, body("MFA_ENROLLMENT_REQUIRED"))).toEqual({
      kind: "failed"
    });
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

describe("enrolment helpers (#1425)", () => {
  test("headers carry the tenant and the grant, never a cookie-less guess", () => {
    expect(buildEnrolHeaders("tenant-1", "grant-1")).toEqual({
      "Content-Type": "application/json",
      "X-AWCMS-Tenant-ID": "tenant-1",
      "X-AWCMS-MFA-Enrollment-Token": "grant-1"
    });
  });

  test("readEnrolStart needs success and both secret fields", () => {
    const good = {
      success: true,
      data: { secret: "JBSWY3DP", otpauthUri: "otpauth://totp/x?secret=J" }
    };
    expect(readEnrolStart(true, good)).toEqual({
      secret: "JBSWY3DP",
      otpauthUri: "otpauth://totp/x?secret=J"
    });
    expect(readEnrolStart(false, good)).toBeNull();
    expect(readEnrolStart(true, { ...good, success: false })).toBeNull();
    expect(
      readEnrolStart(true, { success: true, data: { secret: "A" } })
    ).toBeNull();
    expect(readEnrolStart(true, null)).toBeNull();
  });

  test("readEnrolVerify reads success and the recovery codes only", () => {
    expect(
      readEnrolVerify(true, {
        success: true,
        data: { recoveryCodes: ["a", "b", 3], token: "ignored" }
      })
    ).toEqual({ recoveryCodes: ["a", "b"] });
    expect(readEnrolVerify(true, { success: true, data: {} })).toEqual({
      recoveryCodes: []
    });
    expect(
      readEnrolVerify(false, {
        success: false,
        error: { code: "MFA_INVALID_CODE" }
      })
    ).toBeNull();

    const touched: string[] = [];
    const body = new Proxy(
      { success: false, error: { code: "MFA_ENROLLMENT_EXHAUSTED" } },
      {
        get(obj, key) {
          touched.push(String(key));
          return Reflect.get(obj, key);
        }
      }
    );
    expect(readEnrolVerify(false, body)).toBeNull();
    expect(touched.filter((key) => key !== "success")).toEqual([]);
  });

  test("the verify body is the code without spaces", () => {
    expect(buildEnrolVerifyBody(" 123 456 ")).toEqual({ code: "123456" });
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

  test("the enrolment step reuses the shared QR renderer and keeps the grant out of storage, URL and DOM (#1425)", () => {
    expect(page).toContain('id="enrol-form"');
    expect(page).toContain("/api/v1/auth/mfa/totp/enroll/start");
    expect(page).toContain("/api/v1/auth/mfa/totp/enroll/verify");
    expect(page).toContain("renderEnrolmentQr");
    // The QR encoder is a lazy chunk, never part of the initial login script.
    expect(page).toContain('await import("../lib/ui/enrolment-qr")');
    expect(page).not.toMatch(/^\s*import[^;]*enrolment-qr/m);
    expect(page).toContain("readEnrolStart(");
    expect(page).toContain("readEnrolVerify(");
    expect(page).not.toMatch(/data-[a-z-]*enrol[a-z-]*token/i);
    expect(page).not.toMatch(/dataset\.[a-zA-Z]*[Ee]nrol[a-zA-Z]*[Tt]oken/);
  });

  test("TTL and attempt cap are rendered from server configuration", () => {
    expect(page).toContain("resolveChallengeTtlSec()");
    expect(page).toContain("resolveMfaMaxVerifyAttempts()");
  });
});
