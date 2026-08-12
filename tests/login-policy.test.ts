import { readFileSync } from "node:fs";

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

  test("marks a credential failure as countable and offers a lockout timestamp", () => {
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
      expect(result.countFailedAttempt).toBe(true);
      expect(result.lockoutCandidateAt).toEqual(
        new Date(now.getTime() + 15 * 60_000)
      );
    }
  });

  test("it does NOT return a counter value — the count belongs to the database", () => {
    // Issue #483. This function used to return `identity.failedLoginCount + 1`
    // and the route wrote that absolute value back, so two concurrent failures
    // both read N and both wrote N+1. The absence asserted here is what stops
    // anyone reintroducing a JS-side count: there is no field to put it in.
    const result = evaluateLoginAttempt({
      now,
      tenantStatus: "active",
      identity: { status: "active", failedLoginCount: 4, lockedUntil: null },
      tenantUserStatus: "active",
      passwordMatches: false,
      maxFailedAttempts: 5,
      lockoutMinutes: 15
    });

    expect(Object.keys(result)).not.toContain("failedLoginCount");
  });

  test("the route's SQL uses the same threshold this module states", () => {
    // `shouldLockAccount` is the readable statement of the rule; the comparison
    // that actually runs is in the UPDATE. Pinned here so the two cannot drift
    // into saying different things — a `>` where the policy says `>=` would give
    // every account one extra attempt, silently.
    //
    // ADR-0086 moved that UPDATE out of the route and onto the principal store,
    // so this follows it. Pinning the route would have kept passing against a
    // statement that no longer runs — the failure mode this whole test exists to
    // prevent, one level up.
    const writer = readFileSync(
      "src/modules/identity-access/application/principal-store.ts",
      "utf8"
    );

    expect(shouldLockAccount(5, 5)).toBe(true);
    expect(writer).toContain("failed_login_count = failed_login_count + 1");
    expect(writer).toMatch(
      /CASE WHEN failed_login_count \+ 1 >= \$\{maxFailedAttempts\}/
    );
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
