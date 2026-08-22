/**
 * A tenant SSO admin may not name an arbitrary environment variable as the OIDC
 * client secret — finding A3 of the 17 August 2026 audit round.
 *
 * ## The primitive this closes
 *
 * `client_secret_env_var` was validated as "a non-empty string". A tenant SSO
 * administrator could write `DATABASE_URL` into it, point `issuer_url` at a host
 * they control, and receive that value in the `client_secret` field of the
 * token-exchange POST — before any ID token is validated, and with the SSRF
 * guard satisfied because the host really is reachable.
 *
 * Nothing was broken. Every component did exactly what it was written to do, and
 * the composition was a tenant-admin → deployment-compromise primitive. It is
 * not live (`AUTH_SSO_ENABLED` is off in production), which is precisely why it
 * is cheap to close now and expensive to close the day SSO is switched on.
 *
 * ## Two assertions, and only one of them is load-bearing
 *
 * The validators refuse a bad name at write time. That is the visible half and
 * the half a test naturally reaches for. The half that matters is
 * `resolveProviderClientSecret`: it reads rows written in the PAST, by writers
 * that predate this rule, and without a check on that side every provider row
 * already in the table keeps working exactly as before. A gate on the front door
 * does nothing about what is already inside.
 *
 * Pure — no database, no network.
 */
import { describe, expect, test } from "bun:test";

import {
  SSO_CLIENT_SECRET_ENV_VAR_PATTERN,
  isAllowedSsoClientSecretEnvVar,
  validateCreateAuthProviderInput,
  validateUpdateAuthProviderInput
} from "../src/modules/identity-access/domain/tenant-sso-policy";
import { resolveProviderClientSecret } from "../src/modules/identity-access/application/tenant-sso";
import type { AuthProviderRow } from "../src/modules/identity-access/application/auth-provider-directory";

/** The names an attacker would actually reach for, plus the near-miss. */
const REFUSED_NAMES = [
  "DATABASE_URL",
  "WORKER_DATABASE_URL",
  "SETUP_DATABASE_URL",
  "AUTH_MFA_SECRET_ENCRYPTION_KEY",
  // One underscore-separated word away from the allowed prefix, and the single
  // most valuable variable in the SSO subsystem: it decrypts every OTHER
  // provider's stored client secret.
  "AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY",
  "SYNC_HMAC_SECRET",
  "R2_SECRET_ACCESS_KEY",
  "PATH",
  "HOME",
  // Shape attacks on the pattern itself.
  "auth_sso_client_secret_acme",
  "XAUTH_SSO_CLIENT_SECRET_ACME",
  "AUTH_SSO_CLIENT_SECRET_ACME\nDATABASE_URL",
  "AUTH_SSO_CLIENT_SECRET_ACME DATABASE_URL",
  "AUTH_SSO_CLIENT_SECRET_acme",
  "AUTH_SSO_CLIENT_SECRET_",
  `AUTH_SSO_CLIENT_SECRET_${"A".repeat(49)}`
];

const ALLOWED_NAMES = [
  "AUTH_SSO_CLIENT_SECRET_ACME",
  "AUTH_SSO_CLIENT_SECRET_OKTA_PRIMARY",
  "AUTH_SSO_CLIENT_SECRET_A",
  `AUTH_SSO_CLIENT_SECRET_${"A".repeat(48)}`
];

function providerRow(envVar: string | null): AuthProviderRow {
  return {
    client_secret_env_var: envVar,
    client_secret_ciphertext: null
  } as unknown as AuthProviderRow;
}

describe("the namespace itself", () => {
  test("refuses every name an attacker would want", () => {
    for (const name of REFUSED_NAMES) {
      expect(isAllowedSsoClientSecretEnvVar(name)).toBe(false);
    }
  });

  test("accepts a name an operator created for a provider", () => {
    for (const name of ALLOWED_NAMES) {
      expect(isAllowedSsoClientSecretEnvVar(name)).toBe(true);
    }
  });

  test("is anchored at BOTH ends", () => {
    // An unanchored pattern would accept `DATABASE_URL` with the prefix merely
    // appearing somewhere inside it, which is the classic way this kind of
    // allow-list is written and the classic way it fails.
    expect(SSO_CLIENT_SECRET_ENV_VAR_PATTERN.source.startsWith("^")).toBe(true);
    expect(SSO_CLIENT_SECRET_ENV_VAR_PATTERN.source.endsWith("$")).toBe(true);
    expect(SSO_CLIENT_SECRET_ENV_VAR_PATTERN.flags).not.toContain("g");
  });
});

describe("the admin validators refuse it at write time", () => {
  const base = {
    providerKey: "acme",
    displayName: "Acme",
    issuerUrl: "https://idp.example.test",
    clientId: "client-123"
  };

  test("create refuses an arbitrary variable, and names the field", () => {
    const result = validateCreateAuthProviderInput({
      ...base,
      clientSecretEnvVar: "DATABASE_URL"
    });

    expect(result.valid).toBe(false);
    if (result.valid) return;

    expect(
      result.errors.some((error) => error.field === "clientSecretEnvVar")
    ).toBe(true);
  });

  test("create accepts a namespaced one", () => {
    const result = validateCreateAuthProviderInput({
      ...base,
      clientSecretEnvVar: "AUTH_SSO_CLIENT_SECRET_ACME"
    });

    expect(result.valid).toBe(true);
    if (!result.valid) return;

    expect(result.value.clientSecretEnvVar).toBe("AUTH_SSO_CLIENT_SECRET_ACME");
  });

  test("update refuses it too — the second door, not only the first", () => {
    // A create-only check is a control an admin walks around by creating a valid
    // provider and then patching it.
    const result = validateUpdateAuthProviderInput({
      clientSecretEnvVar: "AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY"
    });

    expect(result.valid).toBe(false);
    if (result.valid) return;

    expect(
      result.errors.some((error) => error.field === "clientSecretEnvVar")
    ).toBe(true);
  });

  test("update still accepts a namespaced one", () => {
    const result = validateUpdateAuthProviderInput({
      clientSecretEnvVar: "AUTH_SSO_CLIENT_SECRET_OKTA_PRIMARY"
    });

    expect(result.valid).toBe(true);
  });
});

describe("the READER refuses it too, which is the assertion that matters", () => {
  test("a row written before the rule existed reads as misconfigured", () => {
    // The validators never saw this row. Without the check on the read side it
    // would still hand `DATABASE_URL` to whatever host the tenant admin's
    // `issuer_url` resolves to, at every single login.
    const env = { DATABASE_URL: "postgres://user:password@db/awcms" };

    expect(resolveProviderClientSecret(providerRow("DATABASE_URL"), env)).toBe(
      null
    );
  });

  test("the encryption key one word away is refused as well", () => {
    const env = { AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY: "kkkk" };

    expect(
      resolveProviderClientSecret(
        providerRow("AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY"),
        env
      )
    ).toBe(null);
  });

  test("NON-VACUOUS: a namespaced variable still resolves", () => {
    // Without this, every assertion above would also pass against a reader that
    // had simply stopped working.
    const env = { AUTH_SSO_CLIENT_SECRET_ACME: "the-real-secret" };

    expect(
      resolveProviderClientSecret(
        providerRow("AUTH_SSO_CLIENT_SECRET_ACME"),
        env
      )
    ).toBe("the-real-secret");
  });

  test("an empty namespaced variable is still misconfigured, not empty-string", () => {
    const env = { AUTH_SSO_CLIENT_SECRET_ACME: "" };

    expect(
      resolveProviderClientSecret(
        providerRow("AUTH_SSO_CLIENT_SECRET_ACME"),
        env
      )
    ).toBe(null);
  });

  test("the check precedes the env read in source order", () => {
    // Placement is the property: a check AFTER `env[...]` would still have read
    // the value into memory, and the point is that it is never read at all.
    const source = Bun.file(
      "src/modules/identity-access/application/tenant-sso.ts"
    );

    return source.text().then((text) => {
      const fn = text.slice(
        text.indexOf("export function resolveProviderClientSecret"),
        text.indexOf("if (provider.client_secret_ciphertext)")
      );

      const guard = fn.indexOf("isAllowedSsoClientSecretEnvVar(");
      const read = fn.indexOf("env[provider.client_secret_env_var]");

      expect(guard).toBeGreaterThan(-1);
      expect(read).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(read);
    });
  });
});
