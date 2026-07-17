/**
 * Unit tests for `scripts/security-readiness.ts` (Issue #142).
 *
 * Scope: the pure, deterministic parts — the secret-scan heuristic, the
 * domain-function-backed checks, and the go-live gate rule. The two checks
 * the issue exists for (`checkRlsEnabled`, `checkAppDbUserNotSuperuser`)
 * are DB-backed and are exercised by `tests/security-readiness-rls.test.ts`
 * against a real PostgreSQL instead — asserting them here would mean
 * stubbing `getDatabaseClient`, which is exactly the shared-module
 * `mock.module` pattern that leaks into every later test file in the same
 * process (PR #157: green locally, 12 failures in CI on the same commit).
 * A fake driver could not prove anything about `relforcerowsecurity`
 * semantics anyway.
 */
import { describe, expect, test } from "bun:test";

import {
  OUT_OF_SCOPE_ITEMS,
  checkAbacDefaultDeny,
  checkEnvConfigValid,
  checkLoginLockoutImplemented,
  checkLoginRateLimitImplemented,
  checkSecurityHeadersBuilt,
  checkSyncHmacSecretNotDefault,
  printReport,
  scanLineForHardcodedSecret,
  type SecurityCheckResult
} from "../scripts/security-readiness";

describe("scanLineForHardcodedSecret", () => {
  test("flags a literal assigned to a secret-like variable", () => {
    expect(scanLineForHardcodedSecret('const apiKey = "sk-live-abc123";')).toBe(
      "apiKey"
    );
    expect(
      scanLineForHardcodedSecret('  password: "hunter2-real-value",')
    ).toBe("password");
  });

  test("ignores values read from process.env", () => {
    expect(
      scanLineForHardcodedSecret(
        'const secret = process.env.MY_SECRET ?? "fallback-value";'
      )
    ).toBeNull();
  });

  test("ignores documented placeholders", () => {
    expect(
      scanLineForHardcodedSecret('const secret = "change-me";')
    ).toBeNull();
    expect(scanLineForHardcodedSecret('url.password = "****";')).toBeNull();
  });

  test("ignores i18n/error-code lookup keys", () => {
    expect(
      scanLineForHardcodedSecret('  TOKEN_EXPIRED: "error.token_expired",')
    ).toBeNull();
  });

  /**
   * Regression for a REAL false positive this script reported on its own
   * first run against unmodified, already-merged code:
   * `src/lib/security/client-fingerprint.ts` holds the NAME of an env var in
   * a constant whose name contains "SECRET". It blocked go-live for no
   * reason — the failure mode that trains people to ignore the gate.
   */
  test("ignores a constant holding an env var NAME, not a secret", () => {
    expect(
      scanLineForHardcodedSecret(
        'const IP_HASH_SECRET_ENV = "AUTH_IP_HASH_SECRET";'
      )
    ).toBeNull();
  });

  test("still flags a real credential assigned to an _ENV-suffixed name", () => {
    // Narrowness check for the exclusion above: the name ends in `_ENV`, but
    // the value is not env-var-name-shaped, so it must still fire.
    expect(
      scanLineForHardcodedSecret('const API_SECRET_ENV = "AKIAIOSFODNN7EX";')
    ).toBe("API_SECRET_ENV");
  });
});

describe("domain-backed checks", () => {
  test("login lockout check passes against the real login policy", () => {
    const result = checkLoginLockoutImplemented();

    expect(result.status).toBe("pass");
    expect(result.severity).toBe("critical");
  });

  test("ABAC default-deny check passes against the real evaluator", () => {
    const result = checkAbacDefaultDeny();

    expect(result.status).toBe("pass");
    expect(result.severity).toBe("critical");
  });

  test("rate limit check passes against the real limiter", () => {
    expect(checkLoginRateLimitImplemented().status).toBe("pass");
  });

  test("security headers check passes against the real builder", () => {
    const result = checkSecurityHeadersBuilt();

    expect(result.status).toBe("pass");
    expect(result.evidence).toContain("Strict-Transport-Security");
  });
});

describe("checkSyncHmacSecretNotDefault", () => {
  test("is informational when sync is disabled", () => {
    const result = checkSyncHmacSecretNotDefault({
      AWCMS_SYNC_ENABLED: "false"
    });

    expect(result.severity).toBe("info");
    expect(result.status).toBe("pass");
  });

  test("fails when sync is enabled but the secret is still the placeholder", () => {
    const result = checkSyncHmacSecretNotDefault({
      AWCMS_SYNC_ENABLED: "true",
      AWCMS_SYNC_HMAC_SECRET: "change-me"
    });

    expect(result.status).toBe("fail");
    expect(result.severity).toBe("warning");
  });

  test("passes when sync is enabled with a changed secret", () => {
    const result = checkSyncHmacSecretNotDefault({
      AWCMS_SYNC_ENABLED: "true",
      AWCMS_SYNC_HMAC_SECRET: "a-real-rotated-secret"
    });

    expect(result.status).toBe("pass");
  });
});

describe("checkEnvConfigValid", () => {
  test("reports the same problems validate-env would", () => {
    const result = checkEnvConfigValid({
      APP_ENV: "development",
      APP_URL: "http://localhost:4321",
      DATABASE_URL: "not-a-postgres-url"
    });

    expect(result.status).toBe("fail");
    expect(result.severity).toBe("critical");
    expect(result.evidence).toContain("DATABASE_URL");
  });
});

describe("printReport gate rule", () => {
  function result(
    severity: SecurityCheckResult["severity"],
    status: SecurityCheckResult["status"]
  ): SecurityCheckResult {
    return { name: `${severity}-${status}`, severity, status, evidence: "x" };
  }

  test("a critical failure blocks go-live", () => {
    expect(printReport([result("critical", "fail")])).toBe(false);
  });

  test("a warning failure does NOT block go-live", () => {
    expect(
      printReport([result("warning", "fail"), result("info", "fail")])
    ).toBe(true);
  });

  test("all passing does not block go-live", () => {
    expect(
      printReport([result("critical", "pass"), result("warning", "pass")])
    ).toBe(true);
  });
});

describe("out-of-scope items", () => {
  test("every item carries a reason", () => {
    expect(OUT_OF_SCOPE_ITEMS.length).toBeGreaterThan(0);

    for (const item of OUT_OF_SCOPE_ITEMS) {
      expect(item.name.length).toBeGreaterThan(0);
      expect(item.reason.length).toBeGreaterThan(20);
    }
  });
});
