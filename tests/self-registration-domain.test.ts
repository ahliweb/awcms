/**
 * Pure-layer tests for self-registration (Wave 2 delta auth): request
 * validation and the deployment gate.
 *
 * The DB-backed behaviour — enumeration safety, the pending-duplicate rule,
 * approval materializing exactly one account under concurrency, and the
 * unusable-credential posture — is in
 * `tests/integration/self-registration.integration.test.ts`.
 */
import { describe, expect, test } from "bun:test";

import { isSelfRegistrationEnabled } from "../src/lib/auth/self-registration-config";
import {
  MAX_DISPLAY_NAME_LENGTH,
  MAX_IDENTIFIER_LENGTH,
  validateRegistrationInput
} from "../src/modules/identity-access/domain/self-registration-validation";

describe("validateRegistrationInput", () => {
  test("accepts a name and an email address, trimming both", () => {
    const result = validateRegistrationInput({
      displayName: "  Ada Lovelace  ",
      loginIdentifier: "  ada@example.com  "
    });

    expect(result).toEqual({
      valid: true,
      value: { loginIdentifier: "ada@example.com", displayName: "Ada Lovelace" }
    });
  });

  test("requires an identifier that can actually receive the approval email", () => {
    // The whole flow depends on reaching the applicant: an approved account
    // whose link cannot be delivered is an account nobody can ever sign into.
    const result = validateRegistrationInput({
      displayName: "Ada",
      loginIdentifier: "not-an-address"
    });

    expect(result.valid).toBe(false);
    expect(result.valid === false && result.errors[0]!.field).toBe(
      "loginIdentifier"
    );
  });

  test.each([
    ["both missing", {}],
    ["null body", null],
    ["blank name", { displayName: "   ", loginIdentifier: "a@b.co" }],
    ["blank identifier", { displayName: "Ada", loginIdentifier: "  " }],
    ["non-string name", { displayName: 7, loginIdentifier: "a@b.co" }]
  ])("rejects %s", (_label, body) => {
    expect(validateRegistrationInput(body).valid).toBe(false);
  });

  test("bounds both fields", () => {
    const longName = validateRegistrationInput({
      displayName: "x".repeat(MAX_DISPLAY_NAME_LENGTH + 1),
      loginIdentifier: "a@b.co"
    });
    expect(longName.valid).toBe(false);

    const longIdentifier = validateRegistrationInput({
      displayName: "Ada",
      loginIdentifier: `${"x".repeat(MAX_IDENTIFIER_LENGTH)}@b.co`
    });
    expect(longIdentifier.valid).toBe(false);
  });

  test("accepts exactly the bound", () => {
    expect(
      validateRegistrationInput({
        displayName: "x".repeat(MAX_DISPLAY_NAME_LENGTH),
        loginIdentifier: "a@b.co"
      }).valid
    ).toBe(true);
  });

  test("ignores every privilege field a public caller might try", () => {
    // Not "rejects" — ignores. An extra key is not an attack worth a 400, but
    // it must never reach the row, and the returned value is the only thing
    // that does.
    const result = validateRegistrationInput({
      displayName: "Ada",
      loginIdentifier: "ada@example.com",
      roleIds: ["11111111-1111-1111-1111-111111111111"],
      status: "approved",
      password: "hunter2",
      tenantUserId: "22222222-2222-2222-2222-222222222222"
    });

    expect(result.valid).toBe(true);
    expect(result.valid === true && Object.keys(result.value).sort()).toEqual([
      "displayName",
      "loginIdentifier"
    ]);
  });
});

describe("isSelfRegistrationEnabled", () => {
  test.each([
    ["unset", {}, false],
    ["false", { AUTH_SELF_REGISTRATION_ENABLED: "false" }, false],
    ["empty", { AUTH_SELF_REGISTRATION_ENABLED: "" }, false],
    ["1", { AUTH_SELF_REGISTRATION_ENABLED: "1" }, false],
    ["TRUE (wrong case)", { AUTH_SELF_REGISTRATION_ENABLED: "TRUE" }, false],
    ["true", { AUTH_SELF_REGISTRATION_ENABLED: "true" }, true]
  ])("%s -> %s", (_label, env, expected) => {
    // Exact-string `"true"` only: a truthy-ish value must not open a public
    // write endpoint by accident.
    expect(isSelfRegistrationEnabled(env as NodeJS.ProcessEnv)).toBe(expected);
  });
});
