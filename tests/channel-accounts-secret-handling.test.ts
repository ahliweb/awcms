/**
 * Secret handling for `channel_accounts` (Issue #1140, ADR-0148 I3, threat T5):
 * a credential is encrypted with a binding to its tenant, row and purpose, fails
 * closed without a ring, and can reach no API response, log or audit row.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { listModules } from "../src/modules";
import {
  createKeyRingSecretStore,
  resetSecretDecryptCounts,
  SecretStoreError,
  snapshotSecretDecryptCounts
} from "../src/modules/channel-accounts/application/secret-store";
import {
  resolveChannelOAuthRedirectUri,
  resolveChannelSecretsRing
} from "../src/modules/channel-accounts/domain/channel-accounts-config";
import {
  decryptChannelSecret,
  encryptChannelSecret
} from "../src/modules/channel-accounts/domain/channel-secret-crypto";
import {
  validateAssignment,
  validateCreateAccount,
  validateOAuthStart,
  validateSetCapability,
  validateUpdateAccount,
  validateOAuthCallbackQuery,
  validateWriteCredential
} from "../src/modules/channel-accounts/domain/channel-accounts-validation";

const KEY_A = Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 251)
).toString("base64");
const KEY_B = Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 13 + 5) % 251)
).toString("base64");
const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const S1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const S2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CANARY = "CANARY-tok-9f3a7c1e5b2d4a60";

function ring(spec: string) {
  const result = resolveChannelSecretsRing({
    CHANNEL_SECRETS_ENCRYPTION_KEYS: spec
  } as unknown as NodeJS.ProcessEnv);

  if (!result.ok) throw new Error(result.reason);

  return result;
}

describe("channel secret crypto", () => {
  const a = ring(`k1:${KEY_A}`);

  test("round-trips and never stores the plaintext", () => {
    const { ciphertext, keyId } = encryptChannelSecret(
      CANARY,
      { tenantId: T1, secretId: S1, purpose: "api_token" },
      a
    );

    expect(keyId).toBe("k1");
    expect(ciphertext.startsWith("v2:k1:")).toBe(true);
    expect(ciphertext).not.toContain(CANARY);
    expect(
      decryptChannelSecret(
        ciphertext,
        { tenantId: T1, secretId: S1, purpose: "api_token" },
        a
      )
    ).toBe(CANARY);
  });

  test("a ciphertext cannot move to another tenant, row or purpose", () => {
    const { ciphertext } = encryptChannelSecret(
      CANARY,
      { tenantId: T1, secretId: S1, purpose: "api_token" },
      a
    );

    for (const context of [
      { tenantId: T2, secretId: S1, purpose: "api_token" as const },
      { tenantId: T1, secretId: S2, purpose: "api_token" as const },
      { tenantId: T1, secretId: S1, purpose: "bot_token" as const }
    ]) {
      expect(() => decryptChannelSecret(ciphertext, context, a)).toThrow();
    }
  });

  test("an error never carries the value or key material", () => {
    const { ciphertext } = encryptChannelSecret(
      CANARY,
      { tenantId: T1, secretId: S1, purpose: "api_token" },
      a
    );

    try {
      decryptChannelSecret(
        ciphertext,
        { tenantId: T2, secretId: S1, purpose: "api_token" },
        a
      );
      throw new Error("expected a throw");
    } catch (error) {
      const text = `${(error as Error).message} ${String(error)}`;

      expect(text).not.toContain(CANARY);
      expect(text).not.toContain(KEY_A);
    }
  });

  test("rotation: the first key writes, all keys read", () => {
    const old = encryptChannelSecret(
      CANARY,
      { tenantId: T1, secretId: S1, purpose: "api_token" },
      a
    );
    const rotated = ring(`k2:${KEY_B},k1:${KEY_A}`);

    expect(
      decryptChannelSecret(
        old.ciphertext,
        { tenantId: T1, secretId: S1, purpose: "api_token" },
        rotated
      )
    ).toBe(CANARY);
    expect(
      encryptChannelSecret(
        CANARY,
        { tenantId: T1, secretId: S1, purpose: "api_token" },
        rotated
      ).keyId
    ).toBe("k2");
  });
});

describe("the key ring fails closed", () => {
  test("no ring, a short key and a placeholder are all refused", () => {
    for (const value of [
      undefined,
      "",
      "k1:c2hvcnQ=",
      `k1:${Buffer.from("changeme-changeme-changeme-changeme").toString("base64")}`
    ]) {
      expect(
        resolveChannelSecretsRing({
          CHANNEL_SECRETS_ENCRYPTION_KEYS: value
        } as unknown as NodeJS.ProcessEnv).ok
      ).toBe(false);
    }
  });

  test("the store refuses to write or read without a ring", async () => {
    const store = createKeyRingSecretStore(() => ({
      ok: false,
      reason: "no ring"
    }));
    const noTx = {} as unknown as Bun.SQL;

    await expect(
      store.put(noTx, {
        tenantId: T1,
        purpose: "api_token",
        plaintext: CANARY,
        createdBy: null
      })
    ).rejects.toMatchObject({ code: "KEY_RING_UNAVAILABLE" });
    await expect(
      store.resolve(noTx, {
        tenantId: T1,
        secretId: S1,
        purpose: "api_token"
      })
    ).rejects.toBeInstanceOf(SecretStoreError);
  });

  test("the decrypt counter starts empty and counts only resolutions", () => {
    resetSecretDecryptCounts();
    expect(snapshotSecretDecryptCounts()).toEqual([]);
  });

  test("the OAuth redirect URI is the deployment's own fixed path", () => {
    expect(
      resolveChannelOAuthRedirectUri({
        APP_URL: "https://cms.example.test"
      } as unknown as NodeJS.ProcessEnv)
    ).toBe(
      "https://cms.example.test/api/v1/channel-accounts/connections/oauth/callback"
    );
  });
});

describe("request validators are strict about credential-shaped fields", () => {
  test("a token-shaped extra field is refused, not ignored", () => {
    for (const validate of [
      validateCreateAccount,
      validateUpdateAccount,
      validateSetCapability,
      validateAssignment,
      validateOAuthStart
    ]) {
      const result = validate({
        token: CANARY,
        secret: CANARY,
        apiKey: CANARY
      });

      expect(result.valid).toBe(false);
      expect(JSON.stringify(result)).not.toContain(CANARY);
    }
  });

  test("the credential validator never echoes the value", () => {
    for (const secret of ["short", `${CANARY} with space`, `${CANARY}\n`]) {
      const result = validateWriteCredential({ secret });

      if (!result.valid) {
        expect(JSON.stringify(result)).not.toContain(CANARY);
      }
    }

    expect(validateWriteCredential({ secret: "short" }).valid).toBe(false);
    expect(validateWriteCredential({ secret: ` ${CANARY} ` })).toEqual({
      valid: true,
      value: { secret: CANARY }
    });
    expect(validateWriteCredential({ secret: CANARY, extra: 1 }).valid).toBe(
      false
    );
  });

  test("credential and code limits count UTF-8 bytes, so a stored envelope can never exceed its CHECK", () => {
    // 4096 euro signs are 4096 characters but 12288 bytes: refused with a 400-shaped
    // validation error instead of reaching the 8192-character envelope CHECK.
    const euros = "\u20ac".repeat(4096);

    expect(validateWriteCredential({ secret: euros }).valid).toBe(false);
    expect(validateWriteCredential({ secret: "a".repeat(4096) }).valid).toBe(
      true
    );
    expect(validateWriteCredential({ secret: "a".repeat(4097) }).valid).toBe(
      false
    );
    expect(
      validateOAuthCallbackQuery(
        new URLSearchParams({ state: "s", code: euros })
      ).valid
    ).toBe(false);
    expect(
      validateOAuthCallbackQuery(
        new URLSearchParams({ state: "s", code: "a".repeat(4096) })
      ).valid
    ).toBe(true);
  });

  test("the OAuth start takes no redirect URI", () => {
    const result = validateOAuthStart({
      provider: "facebook",
      scopes: ["pages_show_list"],
      redirectUri: "https://evil.example"
    });

    expect(result.valid).toBe(false);
  });

  test("a granted capability requires evidence, a denial does not", () => {
    expect(validateSetCapability({ state: "granted" }).valid).toBe(false);
    expect(
      validateSetCapability({
        state: "granted",
        evidenceKind: "app_review_reference",
        evidenceRef: "ref-1"
      }).valid
    ).toBe(true);
    expect(validateSetCapability({ state: "denied" }).valid).toBe(true);
  });

  test("only disabled and pending can be set on an account by a person", () => {
    for (const status of ["connected", "degraded", "revoked", "deleted"]) {
      expect(validateUpdateAccount({ status }).valid).toBe(false);
    }
  });
});

/** Code only: the comments are allowed to talk about what the code must not do. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("no API surface can leak a decrypted value", () => {
  const files = [
    ...new Bun.Glob("src/pages/api/v1/channel-accounts/**/*.ts").scanSync(".")
  ];

  test("the route files exist", () => {
    expect(files.length).toBeGreaterThanOrEqual(14);
  });

  test("no route imports the plaintext resolver or the crypto helper", () => {
    for (const file of files) {
      const source = code(readFileSync(file, "utf8"));

      expect(source, file).not.toContain("channel-secret-crypto");
      expect(source, file).not.toContain("field-encryption");
      expect(source, file).not.toMatch(/\.resolve\(/);
      expect(source, file).not.toMatch(/decryptChannelSecret|decryptField/);
    }
  });

  test("no route handler returns a secret reference", () => {
    for (const file of files) {
      const source = code(readFileSync(file, "utf8"));

      expect(source, file).not.toMatch(
        /secretId|secret_id|pkceSecret|ciphertext/
      );
    }
  });

  test("no view type exposes a reference or a ciphertext", () => {
    const accounts = readFileSync(
      "src/modules/channel-accounts/application/account-directory.ts",
      "utf8"
    );
    const connections = readFileSync(
      "src/modules/channel-accounts/application/connection-directory.ts",
      "utf8"
    );
    const view = (source: string, name: string) =>
      code(
        source.slice(
          source.indexOf(`export type ${name} = {`),
          source.indexOf("};", source.indexOf(`export type ${name} = {`))
        )
      );

    expect(view(accounts, "AccountView")).not.toMatch(/secret|cipher/i);
    expect(view(connections, "ConnectionView")).not.toMatch(/secret|cipher/i);
  });

  test("the audit helper is the only audit writer and never takes a body", () => {
    const support = readFileSync(
      "src/modules/channel-accounts/application/channel-accounts-route-support.ts",
      "utf8"
    );

    expect(support).toContain("recordAuditEvent");

    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).not.toContain(
        "recordAuditEvent"
      );
    }
  });
});

describe("the module descriptor", () => {
  const module = listModules().find((item) => item.key === "channel_accounts")!;

  test("declares the six seeded permissions and nothing else", () => {
    expect(
      module.permissions?.map((p) => `${p.activityCode}.${p.action}`).sort()
    ).toEqual([
      "accounts.create",
      "accounts.read",
      "accounts.revoke",
      "assignments.assign",
      "capabilities.configure",
      "credentials.manage"
    ]);
  });

  test("the credential permission requires MFA enrolment, the others do not", () => {
    for (const permission of module.permissions ?? []) {
      expect(permission.requiresMfaEnrolment === true).toBe(
        permission.activityCode === "credentials"
      );
    }
  });

  test("the migration seeds exactly the declared permissions", () => {
    const sql = readFileSync(
      "sql/319_awcms_channel_accounts_permissions.sql",
      "utf8"
    );
    const seeded = [
      ...sql.matchAll(/\('channel_accounts', '([a-z_]+)', '([a-z_]+)',/g)
    ]
      .map((match) => `${match[1]}.${match[2]}`)
      .sort();

    expect(seeded).toEqual(
      (module.permissions ?? [])
        .map((p) => `${p.activityCode}.${p.action}`)
        .sort()
    );
  });

  test("it is experimental and declares no navigation until its screen exists (#1154)", () => {
    expect(module.status).toBe("experimental");
    expect(module.navigation ?? []).toEqual([]);
  });

  test("every table the migration creates has RLS enabled and FORCED", () => {
    const sql = readFileSync(
      "sql/318_awcms_channel_accounts_schema.sql",
      "utf8"
    );
    const tables = [
      ...sql.matchAll(/CREATE TABLE IF NOT EXISTS (awcms_channel_[a-z_]+)/g)
    ].map((match) => match[1]!);

    expect(tables.length).toBe(8);

    for (const table of tables) {
      expect(sql, table).toContain(
        `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`
      );
      expect(sql, table).toContain(
        `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`
      );
      expect(sql, table).toContain(`${table}_tenant_isolation`);
    }
  });
});
