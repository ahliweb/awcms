/**
 * Unit tests for the MFA/TOTP primitives (Issue #184) — pure, no database.
 * Covers RFC 6238 test vectors, clock window, recovery-code hashing, secret
 * encryption round-trip/tamper, and the pure policy decisions.
 */
import { describe, expect, test } from "bun:test";

import {
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  generateTotpCode,
  generateTotpSecret,
  verifyTotpCode
} from "../src/lib/auth/totp";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  resolveMfaEncryptionKey
} from "../src/lib/auth/mfa-secret-crypto";
import {
  generateRecoveryCode,
  hashRecoveryCode
} from "../src/lib/auth/mfa-recovery-code";
import {
  evaluateMfaChallenge,
  evaluateStepUp,
  isMfaEnforcementLevel,
  isPrivilegedFromPermissionKeys,
  resolveMfaRequirement
} from "../src/modules/identity-access/domain/mfa-policy";
import {
  isMfaFeatureEnabled,
  resolveMfaLockoutMinutes,
  resolveMfaMaxVerifyAttempts,
  resolveWindowSteps
} from "../src/lib/auth/mfa-config";
import { checkMfaEncryptionKeyConfigured } from "../scripts/security-readiness";

describe("TOTP — RFC 6238 test vectors (Appendix B, SHA1, 8 digits)", () => {
  // Seed "12345678901234567890" is the RFC's SHA1 shared secret.
  const secret = Buffer.from("12345678901234567890", "ascii");
  const options = { periodSec: 30, digits: 8 };

  const vectors: Array<[number, string]> = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"]
  ];

  for (const [unixSec, expected] of vectors) {
    test(`T=${unixSec} -> ${expected}`, () => {
      expect(generateTotpCode(secret, unixSec * 1000, options)).toBe(expected);
    });

    test(`verify T=${unixSec} returns the matched step`, () => {
      const step = verifyTotpCode(secret, expected, unixSec * 1000, {
        ...options,
        windowSteps: 0
      });
      expect(step).toBe(Math.floor(unixSec / 30));
    });
  }
});

describe("TOTP — clock window", () => {
  const secret = generateTotpSecret();
  const now = 1_700_000_000_000; // arbitrary ms
  const opts = { periodSec: 30, digits: 6 };

  test("accepts the previous timestep within windowSteps=1", () => {
    const prevCode = generateTotpCode(secret, now - 30_000, opts);
    expect(
      verifyTotpCode(secret, prevCode, now, { ...opts, windowSteps: 1 })
    ).not.toBeNull();
  });

  test("rejects the previous timestep with windowSteps=0", () => {
    const prevCode = generateTotpCode(secret, now - 30_000, opts);
    expect(
      verifyTotpCode(secret, prevCode, now, { ...opts, windowSteps: 0 })
    ).toBeNull();
  });

  test("rejects a code two steps away with windowSteps=1", () => {
    const farCode = generateTotpCode(secret, now - 60_000, opts);
    expect(
      verifyTotpCode(secret, farCode, now, { ...opts, windowSteps: 1 })
    ).toBeNull();
  });

  test("rejects malformed codes (wrong length / non-digit)", () => {
    expect(verifyTotpCode(secret, "12345", now, opts)).toBeNull();
    expect(verifyTotpCode(secret, "abcdef", now, opts)).toBeNull();
  });
});

describe("base32", () => {
  test("round-trips arbitrary bytes", () => {
    const buf = generateTotpSecret();
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
  });

  test("otpauth URI carries the base32 secret and SHA1 algorithm", () => {
    const secret = Buffer.from("12345678901234567890", "ascii");
    const uri = buildOtpauthUri({
      secret,
      issuer: "AWCMS",
      accountName: "user@example.com",
      digits: 6,
      periodSec: 30
    });
    expect(uri).toStartWith("otpauth://totp/");
    expect(uri).toContain(`secret=${base32Encode(secret)}`);
    expect(uri).toContain("algorithm=SHA1");
  });
});

describe("recovery codes", () => {
  test("format is XXXX-XXXX base32", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(generateRecoveryCode()).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    }
  });

  test("hash is normalization-insensitive (dash/case)", () => {
    const canonical = hashRecoveryCode("ABCD-EFGH");
    expect(hashRecoveryCode("abcd-efgh")).toBe(canonical);
    expect(hashRecoveryCode("abcdefgh")).toBe(canonical);
    expect(hashRecoveryCode(" AbCd EfGh ")).toBe(canonical);
  });

  test("different codes hash differently", () => {
    expect(hashRecoveryCode("AAAA-BBBB")).not.toBe(
      hashRecoveryCode("AAAA-BBBC")
    );
  });
});

describe("secret encryption at rest", () => {
  const key = resolveMfaEncryptionKey({
    AUTH_MFA_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64")
  } as NodeJS.ProcessEnv)!;

  test("round-trips the secret", () => {
    const secret = generateTotpSecret();
    const round = decryptMfaSecret(encryptMfaSecret(secret, key), key);
    expect(round.equals(secret)).toBe(true);
  });

  test("tampered ciphertext throws (authenticated cipher), never returns garbage", () => {
    const secret = generateTotpSecret();
    const encoded = encryptMfaSecret(secret, key);
    const parts = encoded.split(":");
    // Flip the ciphertext part.
    const ct = Buffer.from(parts[3]!, "base64");
    ct[0] = ct[0]! ^ 0xff;
    parts[3] = ct.toString("base64");
    expect(() => decryptMfaSecret(parts.join(":"), key)).toThrow();
  });

  test("resolveMfaEncryptionKey returns null (no default) for missing/short key", () => {
    expect(resolveMfaEncryptionKey({} as NodeJS.ProcessEnv)).toBeNull();
    expect(
      resolveMfaEncryptionKey({
        AUTH_MFA_SECRET_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64")
      } as NodeJS.ProcessEnv)
    ).toBeNull();
  });
});

describe("tenant enforcement policy", () => {
  test("resolveMfaRequirement", () => {
    expect(
      resolveMfaRequirement({ level: "optional", isPrivileged: true })
    ).toBe(false);
    expect(
      resolveMfaRequirement({ level: "required_for_all", isPrivileged: false })
    ).toBe(true);
    expect(
      resolveMfaRequirement({
        level: "required_for_privileged",
        isPrivileged: true
      })
    ).toBe(true);
    expect(
      resolveMfaRequirement({
        level: "required_for_privileged",
        isPrivileged: false
      })
    ).toBe(false);
  });

  test("isMfaEnforcementLevel", () => {
    expect(isMfaEnforcementLevel("optional")).toBe(true);
    expect(isMfaEnforcementLevel("required_for_all")).toBe(true);
    expect(isMfaEnforcementLevel("nope")).toBe(false);
    expect(isMfaEnforcementLevel(123)).toBe(false);
  });

  test("isPrivilegedFromPermissionKeys: any non-read permission => privileged", () => {
    expect(isPrivilegedFromPermissionKeys([])).toBe(false);
    expect(
      isPrivilegedFromPermissionKeys([
        "reporting.dashboard.read",
        "identity_access.access_control.read"
      ])
    ).toBe(false);
    expect(
      isPrivilegedFromPermissionKeys([
        "reporting.dashboard.read",
        "identity_access.access_control.configure"
      ])
    ).toBe(true);
    expect(
      isPrivilegedFromPermissionKeys(["tenant_admin.office_management.delete"])
    ).toBe(true);
    // Fail-closed: an unknown/new action is treated as privileged.
    expect(isPrivilegedFromPermissionKeys(["some.new.frobnicate"])).toBe(true);
  });
});

describe("step-up evaluation", () => {
  const now = new Date("2026-07-19T12:00:00Z");

  test("aal1 session is never stepped up", () => {
    expect(
      evaluateStepUp({ assuranceLevel: "aal1", steppedUpAt: now }, now, 300)
    ).toEqual({ satisfied: false, reason: "not_stepped_up" });
  });

  test("fresh aal2 within ttl is satisfied", () => {
    const steppedUpAt = new Date(now.getTime() - 60_000);
    expect(
      evaluateStepUp({ assuranceLevel: "aal2", steppedUpAt }, now, 300)
    ).toEqual({ satisfied: true });
  });

  test("stale aal2 beyond ttl expires", () => {
    const steppedUpAt = new Date(now.getTime() - 400_000);
    expect(
      evaluateStepUp({ assuranceLevel: "aal2", steppedUpAt }, now, 300)
    ).toEqual({ satisfied: false, reason: "expired" });
  });
});

describe("challenge evaluation", () => {
  const now = new Date("2026-07-19T12:00:00Z");
  const future = new Date(now.getTime() + 60_000);

  test("not_found on null", () => {
    expect(evaluateMfaChallenge(null, now, 5).outcome).toBe("invalid");
  });

  test("already_used when consumed", () => {
    expect(
      evaluateMfaChallenge(
        { expiresAt: future, consumedAt: now, failedAttempts: 0 },
        now,
        5
      )
    ).toEqual({ outcome: "invalid", reason: "already_used" });
  });

  test("too_many_attempts at the cap", () => {
    expect(
      evaluateMfaChallenge(
        { expiresAt: future, consumedAt: null, failedAttempts: 5 },
        now,
        5
      )
    ).toEqual({ outcome: "invalid", reason: "too_many_attempts" });
  });

  test("expired when past expiry", () => {
    expect(
      evaluateMfaChallenge(
        { expiresAt: now, consumedAt: null, failedAttempts: 0 },
        now,
        5
      )
    ).toEqual({ outcome: "invalid", reason: "expired" });
  });

  test("valid otherwise", () => {
    expect(
      evaluateMfaChallenge(
        { expiresAt: future, consumedAt: null, failedAttempts: 0 },
        now,
        5
      )
    ).toEqual({ outcome: "valid" });
  });
});

describe("config resolvers", () => {
  test("window steps are bounded to [0,10]", () => {
    expect(
      resolveWindowSteps({
        AUTH_MFA_TOTP_WINDOW_STEPS: "-3"
      } as NodeJS.ProcessEnv)
    ).toBe(1);
    expect(
      resolveWindowSteps({
        AUTH_MFA_TOTP_WINDOW_STEPS: "100"
      } as NodeJS.ProcessEnv)
    ).toBe(10);
    expect(
      resolveWindowSteps({
        AUTH_MFA_TOTP_WINDOW_STEPS: "2"
      } as NodeJS.ProcessEnv)
    ).toBe(2);
    expect(resolveWindowSteps({} as NodeJS.ProcessEnv)).toBe(1);
  });

  test("feature flag gates enrollment only", () => {
    expect(
      isMfaFeatureEnabled({ AUTH_MFA_ENABLED: "true" } as NodeJS.ProcessEnv)
    ).toBe(true);
    expect(isMfaFeatureEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });

  test("lockout config falls back on bad values (never disabled)", () => {
    expect(resolveMfaMaxVerifyAttempts({} as NodeJS.ProcessEnv)).toBe(5);
    expect(
      resolveMfaMaxVerifyAttempts({
        AUTH_MFA_MAX_VERIFY_ATTEMPTS: "0"
      } as NodeJS.ProcessEnv)
    ).toBe(5);
    expect(
      resolveMfaMaxVerifyAttempts({
        AUTH_MFA_MAX_VERIFY_ATTEMPTS: "3"
      } as NodeJS.ProcessEnv)
    ).toBe(3);
    expect(resolveMfaLockoutMinutes({} as NodeJS.ProcessEnv)).toBe(15);
    expect(
      resolveMfaLockoutMinutes({
        AUTH_MFA_LOCKOUT_MINUTES: "-1"
      } as NodeJS.ProcessEnv)
    ).toBe(15);
  });
});

describe("security-readiness: MFA encryption key", () => {
  test("passes (info) when MFA disabled", () => {
    const r = checkMfaEncryptionKeyConfigured({} as NodeJS.ProcessEnv);
    expect(r.status).toBe("pass");
    expect(r.severity).toBe("info");
  });

  test("critical fail when enabled without a key (no default)", () => {
    const r = checkMfaEncryptionKeyConfigured({
      AUTH_MFA_ENABLED: "true"
    } as NodeJS.ProcessEnv);
    expect(r.status).toBe("fail");
    expect(r.severity).toBe("critical");
  });

  test("critical fail when the key is not 32 bytes", () => {
    const r = checkMfaEncryptionKeyConfigured({
      AUTH_MFA_ENABLED: "true",
      AUTH_MFA_SECRET_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64")
    } as NodeJS.ProcessEnv);
    expect(r.status).toBe("fail");
  });

  test("passes with a valid 32-byte key", () => {
    const r = checkMfaEncryptionKeyConfigured({
      AUTH_MFA_ENABLED: "true",
      AUTH_MFA_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64")
    } as NodeJS.ProcessEnv);
    expect(r.status).toBe("pass");
  });
});
