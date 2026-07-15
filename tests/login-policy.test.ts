import { describe, expect, test } from "bun:test";

import {
  evaluateLoginAttempt,
  isAccountLocked,
  shouldLockAccount
} from "../src/modules/identity-access/domain/login-policy";

const now = new Date("2026-01-01T00:00:00Z");

describe("evaluateLoginAttempt", () => {
  test("denies when the tenant is not active", () => {
    const result = evaluateLoginAttempt({
      now,
      tenantStatus: "suspended",
      identity: null,
      tenantUserStatus: null,
      passwordMatches: false,
      maxFailedAttempts: 5,
      lockoutMinutes: 15
    });

    expect(result).toEqual({ outcome: "deny", reason: "tenant_inactive" });
  });

  test("allows when identity/tenant user are active and password matches", () => {
    const result = evaluateLoginAttempt({
      now,
      tenantStatus: "active",
      identity: { status: "active", failedLoginCount: 0, lockedUntil: null },
      tenantUserStatus: "active",
      passwordMatches: true,
      maxFailedAttempts: 5,
      lockoutMinutes: 15
    });

    expect(result).toEqual({ outcome: "allow" });
  });

  test("locks the account once the failed attempt count reaches the max", () => {
    const result = evaluateLoginAttempt({
      now,
      tenantStatus: "active",
      identity: { status: "active", failedLoginCount: 4, lockedUntil: null },
      tenantUserStatus: "active",
      passwordMatches: false,
      maxFailedAttempts: 5,
      lockoutMinutes: 15
    });

    expect(result.outcome).toBe("deny");
    if (result.outcome === "deny") {
      expect(result.failedLoginCount).toBe(5);
      expect(result.lockedUntil).not.toBeNull();
    }
  });

  test("denies with invalid_credentials for an unknown identity, without a failedLoginCount", () => {
    const result = evaluateLoginAttempt({
      now,
      tenantStatus: "active",
      identity: null,
      tenantUserStatus: null,
      passwordMatches: false,
      maxFailedAttempts: 5,
      lockoutMinutes: 15
    });

    expect(result).toEqual({ outcome: "deny", reason: "invalid_credentials" });
  });
});

describe("isAccountLocked / shouldLockAccount", () => {
  test("isAccountLocked is true only while lockedUntil is in the future", () => {
    expect(isAccountLocked(new Date(now.getTime() + 60_000), now)).toBe(true);
    expect(isAccountLocked(new Date(now.getTime() - 60_000), now)).toBe(false);
    expect(isAccountLocked(null, now)).toBe(false);
  });

  test("shouldLockAccount compares against maxFailedAttempts", () => {
    expect(shouldLockAccount(5, 5)).toBe(true);
    expect(shouldLockAccount(4, 5)).toBe(false);
  });
});
