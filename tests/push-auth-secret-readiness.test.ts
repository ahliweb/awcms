/**
 * security:readiness wiring for the push auth secret rollout (Issue #1089).
 * Source-level, no database.
 */
import { describe, expect, test } from "bun:test";

import {
  checkPushAuthSecretRingConfigured,
  WORKER_COLUMN_GRANTS,
  WORKER_CREDENTIAL_COLUMN_EXCEPTIONS
} from "../scripts/security-readiness";

describe("security:readiness wiring for push auth secrets", () => {
  test("the plaintext-rows check runs before the check that closes the shared pool", async () => {
    const source = await Bun.file("scripts/security-readiness.ts").text();
    const body = source.slice(
      source.indexOf("export async function runSecurityReadinessChecks")
    );
    const ours = body.indexOf("checkPushAuthSecretsEncryptedAtRest");

    expect(ours).toBeGreaterThan(0);
    expect(ours).toBeLessThan(body.indexOf("checkEntitlementBlastRadius"));
  });

  test("the ciphertext column is a documented worker exception and the plaintext one is marked legacy", () => {
    expect(
      WORKER_CREDENTIAL_COLUMN_EXCEPTIONS[
        "awcms_push_subscriptions.auth_secret_ciphertext"
      ]
    ).toBeDefined();
    expect(
      WORKER_CREDENTIAL_COLUMN_EXCEPTIONS[
        "awcms_push_subscriptions.auth_secret"
      ]
    ).toContain("LEGACY");
  });

  test("the ring warning fires only for web_push with a missing or invalid ring, and leaks no key", () => {
    const key = Buffer.from(
      Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 251)
    ).toString("base64");

    expect(checkPushAuthSecretRingConfigured({}).status).toBe("pass");
    expect(
      checkPushAuthSecretRingConfigured({
        PUSH_ENABLED: "true",
        PUSH_PROVIDER: "fcm"
      } as never).status
    ).toBe("pass");

    const missing = checkPushAuthSecretRingConfigured({
      PUSH_ENABLED: "true",
      PUSH_PROVIDER: "web_push"
    } as never);
    const invalid = checkPushAuthSecretRingConfigured({
      PUSH_ENABLED: "true",
      PUSH_PROVIDER: "web_push",
      PUSH_AUTH_SECRET_ENCRYPTION_KEYS: "k1:not-a-key"
    } as never);
    const valid = checkPushAuthSecretRingConfigured({
      PUSH_ENABLED: "true",
      PUSH_PROVIDER: "web_push",
      PUSH_AUTH_SECRET_ENCRYPTION_KEYS: `k1:${key}`
    } as never);

    expect(missing.status).toBe("fail");
    expect(missing.severity).toBe("warning");
    expect(invalid.status).toBe("fail");
    expect(invalid.evidence).not.toContain("not-a-key");
    expect(valid.status).toBe("pass");
    expect(valid.evidence).not.toContain(key);
  });

  test("worker INSERT is not in the table matrix and UPDATE is column-pinned", async () => {
    const source = await Bun.file("scripts/security-readiness.ts").text();

    expect(source).toContain('awcms_push_subscriptions: ["DELETE", "SELECT"],');
  });

  test("worker UPDATE on push subscriptions is column-pinned and cannot reach the endpoint", () => {
    const update = WORKER_COLUMN_GRANTS.awcms_push_subscriptions?.UPDATE ?? [];

    expect(update).toContain("auth_secret_ciphertext");
    expect(update).toContain("auth_secret");
    expect(update).not.toContain("endpoint");
    expect(update).not.toContain("endpoint_hash");
    expect(update).not.toContain("p256dh_key");
  });
});
