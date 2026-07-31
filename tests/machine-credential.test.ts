/**
 * Pure rules for machine credentials (ADR-0049). Everything here is a security
 * property that must hold without a database: token shape, the hash namespace
 * that keeps the two kinds of bearer apart, the read-only allow-list, and the
 * intersection that stops a credential from ever widening.
 */
import { describe, expect, test } from "bun:test";

import {
  MACHINE_CREDENTIAL_HASH_PREFIX,
  MACHINE_CREDENTIAL_TOKEN_PREFIX,
  generateMachineCredentialToken,
  hashMachineCredentialToken,
  isMachineCredentialHash,
  isMachineCredentialToken,
  parseMachineCredentialToken
} from "../src/lib/auth/machine-credential-token";
import {
  generateSessionToken,
  hashSessionToken
} from "../src/lib/auth/session-token";
import {
  MACHINE_CREDENTIAL_ALLOWED_ACTIONS,
  MACHINE_CREDENTIAL_MAX_LIFETIME_DAYS,
  isMachineCredentialAllowedAction,
  narrowPermissionKeys,
  validateIssueMachineCredentialInput
} from "../src/modules/identity-access/domain/machine-credential";

const TENANT = "3f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8";

describe("machine credential token format", () => {
  test("round-trips the tenant it was minted for", () => {
    const token = generateMachineCredentialToken(TENANT);

    expect(token.startsWith(MACHINE_CREDENTIAL_TOKEN_PREFIX)).toBe(true);
    expect(parseMachineCredentialToken(token)?.tenantId).toBe(TENANT);
  });

  test("two tokens for the same tenant differ (the secret is random)", () => {
    expect(generateMachineCredentialToken(TENANT)).not.toBe(
      generateMachineCredentialToken(TENANT)
    );
  });

  test("refuses to mint for a non-uuid tenant", () => {
    expect(() => generateMachineCredentialToken("not-a-uuid")).toThrow();
  });

  // A prefix-only recogniser plus a STRICT parser is the point: a malformed
  // machine token must be routed to the machine path and refused there, never
  // silently retried as a session token.
  test("prefix recognition is separate from strict parsing", () => {
    const malformed = `${MACHINE_CREDENTIAL_TOKEN_PREFIX}deadbeef_short`;

    expect(isMachineCredentialToken(malformed)).toBe(true);
    expect(parseMachineCredentialToken(malformed)).toBeNull();
  });

  test.each([
    ["session-shaped token", "Ab3-_xyzAb3-_xyzAb3-_xyzAb3-_xyzAb3-_xyz123"],
    ["empty", ""],
    ["prefix only", MACHINE_CREDENTIAL_TOKEN_PREFIX],
    [
      "uppercase hex tenant",
      `${MACHINE_CREDENTIAL_TOKEN_PREFIX}${"A".repeat(32)}_${"a".repeat(43)}`
    ],
    [
      "secret too long",
      `${MACHINE_CREDENTIAL_TOKEN_PREFIX}${"a".repeat(32)}_${"a".repeat(44)}`
    ]
  ])("parse rejects %s", (_label, token) => {
    expect(parseMachineCredentialToken(token)).toBeNull();
  });
});

describe("hash namespace keeps the two bearer kinds apart", () => {
  test("a machine token hashes into the machine namespace", () => {
    const token = generateMachineCredentialToken(TENANT);
    const hash = hashSessionToken(token);

    expect(hash.startsWith(MACHINE_CREDENTIAL_HASH_PREFIX)).toBe(true);
    expect(isMachineCredentialHash(hash)).toBe(true);
    // `hashSessionToken` DISPATCHES — the 183 route files that call it between
    // `resolveAuthInputs` and `authorizeInTransaction` get this for free.
    expect(hash).toBe(hashMachineCredentialToken(token));
  });

  test("a session token keeps the shape it has had since sql/004", () => {
    const hash = hashSessionToken(generateSessionToken());

    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(isMachineCredentialHash(hash)).toBe(false);
  });

  test("generated session tokens never collide with the machine prefix", () => {
    for (let i = 0; i < 500; i += 1) {
      expect(
        generateSessionToken().startsWith(MACHINE_CREDENTIAL_TOKEN_PREFIX)
      ).toBe(false);
    }
  });
});

describe("read-only allow-list", () => {
  test("holds exactly `read`", () => {
    expect([...MACHINE_CREDENTIAL_ALLOWED_ACTIONS]).toEqual(["read"]);
  });

  // The whole point of ADR-0049 §3: this is decided BEFORE permissions are
  // looked up, so a credential pointed at an `owner` still cannot mutate.
  test.each([
    "create",
    "update",
    "delete",
    "approve",
    "configure",
    "purge",
    "export",
    "publish",
    "revoke"
  ] as const)("refuses %s", (action) => {
    expect(isMachineCredentialAllowedAction(action)).toBe(false);
  });

  test("allows read", () => {
    expect(isMachineCredentialAllowedAction("read")).toBe(true);
  });
});

describe("narrowPermissionKeys", () => {
  const granted = new Set([
    "blog_content.posts.read",
    "blog_content.posts.update",
    "media_library.objects.read"
  ]);

  test("is an intersection, not a union", () => {
    expect(
      [
        ...narrowPermissionKeys(granted, [
          "blog_content.posts.read",
          "media_library.objects.read"
        ])
      ].sort()
    ).toEqual(["blog_content.posts.read", "media_library.objects.read"]);
  });

  test("a key the account does not hold grants nothing", () => {
    expect([
      ...narrowPermissionKeys(granted, ["identity_access.access_control.read"])
    ]).toEqual([]);
  });

  test("a key the account holds but the credential omits is dropped", () => {
    const narrowed = narrowPermissionKeys(granted, ["blog_content.posts.read"]);

    expect(narrowed.has("blog_content.posts.update")).toBe(false);
    expect(narrowed.has("media_library.objects.read")).toBe(false);
  });

  test("an empty allow-list means nothing, never everything", () => {
    expect(narrowPermissionKeys(granted, []).size).toBe(0);
  });
});

describe("validateIssueMachineCredentialInput", () => {
  const now = new Date("2026-08-01T00:00:00.000Z");
  const valid = {
    name: "awcms-astro build feed",
    tenantUserId: "11111111-2222-3333-4444-555555555555",
    allowedPermissionKeys: ["blog_content.posts.read"],
    expiresAt: "2026-09-01T00:00:00.000Z"
  };

  test("accepts a well-formed request and trims the name", () => {
    const result = validateIssueMachineCredentialInput(
      { ...valid, name: "  build feed  " },
      now
    );

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.name).toBe("build feed");
      expect(result.value.expiresAt.toISOString()).toBe(
        "2026-09-01T00:00:00.000Z"
      );
    }
  });

  test("de-duplicates permission keys", () => {
    const result = validateIssueMachineCredentialInput(
      {
        ...valid,
        allowedPermissionKeys: [
          "blog_content.posts.read",
          "blog_content.posts.read"
        ]
      },
      now
    );

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.allowedPermissionKeys).toEqual([
        "blog_content.posts.read"
      ]);
    }
  });

  test.each([
    ["missing allow-list", { ...valid, allowedPermissionKeys: undefined }],
    ["empty allow-list", { ...valid, allowedPermissionKeys: [] }],
    ["malformed key", { ...valid, allowedPermissionKeys: ["Blog.Posts.Read"] }],
    ["two-part key", { ...valid, allowedPermissionKeys: ["blog.posts"] }],
    ["blank name", { ...valid, name: "   " }],
    ["non-uuid tenant user", { ...valid, tenantUserId: "svc" }],
    ["expiry missing", { ...valid, expiresAt: undefined }],
    ["expiry unparseable", { ...valid, expiresAt: "whenever" }],
    ["expiry in the past", { ...valid, expiresAt: "2026-07-31T00:00:00.000Z" }],
    ["expiry equal to now", { ...valid, expiresAt: now.toISOString() }],
    ["not an object", "nope"]
  ])("rejects %s", (_label, body) => {
    expect(validateIssueMachineCredentialInput(body, now).valid).toBe(false);
  });

  test("rejects a lifetime beyond the ceiling", () => {
    const tooFar = new Date(
      now.getTime() +
        (MACHINE_CREDENTIAL_MAX_LIFETIME_DAYS + 1) * 24 * 60 * 60 * 1000
    );

    expect(
      validateIssueMachineCredentialInput(
        { ...valid, expiresAt: tooFar.toISOString() },
        now
      ).valid
    ).toBe(false);
  });

  test("reports every offending field at once, not just the first", () => {
    const result = validateIssueMachineCredentialInput(
      { name: "", tenantUserId: "x", allowedPermissionKeys: [], expiresAt: "" },
      now
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(new Set(result.errors.map((error) => error.field))).toEqual(
        new Set(["name", "tenantUserId", "allowedPermissionKeys", "expiresAt"])
      );
    }
  });
});
