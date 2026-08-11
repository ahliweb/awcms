/**
 * Pure invitation policy + input validation (ADR-0082, Gelombang 4 of #423).
 *
 * No database, no network — this is the decision half of the invitation flow,
 * split out for exactly the reason `password-reset-policy.ts` was: the check
 * ORDER is load-bearing and a behavioural test through HTTP could not tell a
 * correct order from a wrong one, because both collapse into the same 404.
 *
 * The behavioural counterpart is `tests/integration/invitations.integration.test.ts`.
 */
import { describe, expect, test } from "bun:test";

import {
  evaluateInvitation,
  INVITATION_MAX_RESEND_COUNT,
  MAX_INVITATION_ROLE_COUNT,
  validateAcceptInvitationInput,
  validateCreateInvitationInput
} from "../src/modules/identity-access/domain/invitation-policy";

const NOW = new Date("2026-08-11T10:00:00.000Z");
const LATER = new Date("2026-08-18T10:00:00.000Z");
const ROLE_A = "11111111-1111-4111-8111-111111111111";
const ROLE_B = "22222222-2222-4222-8222-222222222222";

const acceptAnyPassword = () => null;

describe("evaluateInvitation", () => {
  test("a pending, unexpired invitation is valid", () => {
    expect(
      evaluateInvitation({ status: "pending", expiresAt: LATER }, NOW)
    ).toEqual({ outcome: "valid" });
  });

  test("an absent row is not_found", () => {
    expect(evaluateInvitation(null, NOW)).toEqual({
      outcome: "invalid",
      reason: "not_found"
    });
  });

  test("revoked is decided BEFORE expiry", () => {
    // An administrator killed this link on purpose. Reporting "expired" would
    // describe the clock instead of the decision, and the audit trail is the
    // only place these reasons are ever seen.
    const past = new Date(NOW.getTime() - 1000);
    expect(
      evaluateInvitation({ status: "revoked", expiresAt: past }, NOW)
    ).toEqual({ outcome: "invalid", reason: "revoked" });
  });

  test("accepted is decided BEFORE expiry", () => {
    const past = new Date(NOW.getTime() - 1000);
    expect(
      evaluateInvitation({ status: "accepted", expiresAt: past }, NOW)
    ).toEqual({ outcome: "invalid", reason: "already_accepted" });
  });

  test("an invitation expiring exactly now is spent", () => {
    // `<=`, not `<`. The boundary is the whole reason this is a unit test.
    expect(
      evaluateInvitation({ status: "pending", expiresAt: NOW }, NOW)
    ).toEqual({ outcome: "invalid", reason: "expired" });
  });

  test("expiry is decided from the COLUMN, not from the status value", () => {
    // Nothing sweeps `status` to 'expired' — no job writes it. A row that aged
    // out is still literally `pending`, so a predicate keyed on the status
    // value would hand out a live link forever.
    const past = new Date(NOW.getTime() - 1);
    expect(
      evaluateInvitation({ status: "pending", expiresAt: past }, NOW)
    ).toEqual({ outcome: "invalid", reason: "expired" });
  });

  test("an unknown status collapses to not_found rather than passing", () => {
    expect(
      evaluateInvitation({ status: "something_new", expiresAt: LATER }, NOW)
    ).toEqual({ outcome: "invalid", reason: "not_found" });
  });
});

describe("validateCreateInvitationInput", () => {
  test("accepts the minimum body and defaults roles to none", () => {
    const result = validateCreateInvitationInput({
      loginIdentifier: "  someone@example.com  ",
      displayName: "  Someone  "
    });

    expect(result.valid).toBe(true);
    expect(result.valid === true && result.value).toEqual({
      loginIdentifier: "someone@example.com",
      displayName: "Someone",
      roleIds: [],
      skipEmailConfirmation: false
    });
  });

  test("TRIMS but does not LOWERCASE the identifier", () => {
    // The single most load-bearing behaviour in this file. Every lookup on the
    // auth path compares `login_identifier` with exact equality, and
    // `validateRegistrationInput` stores `.trim()` only — so `Foo@x.com` and
    // `foo@x.com` are two distinct accounts. An invitation flow that
    // lowercased would resolve to a different row than the one login looks up,
    // and the invitee would accept an invitation they then could not sign in
    // with. Changing this is a repo-wide decision and its own ADR; this test
    // is what makes the change deliberate.
    const result = validateCreateInvitationInput({
      loginIdentifier: "  Foo@Example.COM ",
      displayName: "Foo"
    });

    expect(result.valid === true && result.value.loginIdentifier).toBe(
      "Foo@Example.COM"
    );
  });

  test("rejects an identifier that cannot be mailed", () => {
    const result = validateCreateInvitationInput({
      loginIdentifier: "not-an-address",
      displayName: "Nobody"
    });

    expect(result.valid).toBe(false);
    expect(
      result.valid === false &&
        result.errors.some((e) => e.field === "loginIdentifier")
    ).toBe(true);
  });

  test("de-duplicates roleIds", () => {
    const result = validateCreateInvitationInput({
      loginIdentifier: "a@b.com",
      displayName: "A",
      roleIds: [ROLE_A, ROLE_A, ROLE_B]
    });

    expect(result.valid === true && result.value.roleIds).toEqual([
      ROLE_A,
      ROLE_B
    ]);
  });

  test("rejects a non-UUID roleId", () => {
    const result = validateCreateInvitationInput({
      loginIdentifier: "a@b.com",
      displayName: "A",
      roleIds: ["owner"]
    });

    expect(result.valid).toBe(false);
  });

  test("rejects more roles than the ceiling", () => {
    const result = validateCreateInvitationInput({
      loginIdentifier: "a@b.com",
      displayName: "A",
      roleIds: Array.from(
        { length: MAX_INVITATION_ROLE_COUNT + 1 },
        (_unused, index) =>
          `1111111${index % 10}-1111-4111-8111-11111111111${index % 10}`
      )
    });

    expect(result.valid).toBe(false);
  });

  test("only the literal true opts into skipEmailConfirmation", () => {
    // A truthy coercion here would let a caller reach a PLATFORM-gated
    // behaviour with `"false"`, `1`, or `{}` — the string "false" being the
    // one that would sting.
    for (const value of ["true", "false", 1, {}, []]) {
      const result = validateCreateInvitationInput({
        loginIdentifier: "a@b.com",
        displayName: "A",
        skipEmailConfirmation: value
      });
      expect(result.valid).toBe(false);
    }

    const explicit = validateCreateInvitationInput({
      loginIdentifier: "a@b.com",
      displayName: "A",
      skipEmailConfirmation: true
    });
    expect(
      explicit.valid === true && explicit.value.skipEmailConfirmation
    ).toBe(true);
  });

  test("ignores privilege fields it does not declare", () => {
    const result = validateCreateInvitationInput({
      loginIdentifier: "a@b.com",
      displayName: "A",
      status: "accepted",
      tenantUserId: ROLE_A,
      resendCount: 99
    });

    expect(result.valid).toBe(true);
    expect(result.valid === true && Object.keys(result.value).sort()).toEqual([
      "displayName",
      "loginIdentifier",
      "roleIds",
      "skipEmailConfirmation"
    ]);
  });
});

describe("validateAcceptInvitationInput", () => {
  test("accepts a password and an optional display name", () => {
    const result = validateAcceptInvitationInput(
      { password: "a-long-enough-secret", displayName: " Renamed " },
      acceptAnyPassword
    );

    expect(result.valid === true && result.value).toEqual({
      password: "a-long-enough-secret",
      displayName: "Renamed"
    });
  });

  test("omits displayName entirely when absent", () => {
    const result = validateAcceptInvitationInput(
      { password: "a-long-enough-secret" },
      acceptAnyPassword
    );

    expect(result.valid === true && Object.keys(result.value)).toEqual([
      "password"
    ]);
  });

  test("carries the injected password rule's own failure through", () => {
    // Strength is NOT re-derived here: it is `validateCredentialChangeInput`'s
    // rule, injected, so the two cannot drift into demanding different
    // passwords for the same account.
    const result = validateAcceptInvitationInput({ password: "short" }, () => ({
      field: "password",
      message: "too weak"
    }));

    expect(result.valid).toBe(false);
    expect(result.valid === false && result.errors[0]?.message).toBe(
      "too weak"
    );
  });

  test("declares no privilege field", () => {
    const result = validateAcceptInvitationInput(
      { password: "a-long-enough-secret", roleIds: [ROLE_A] },
      acceptAnyPassword
    );

    expect(result.valid === true && Object.keys(result.value)).toEqual([
      "password"
    ]);
  });
});

describe("the resend ceiling agrees with the database", () => {
  test("the constant mirrors awcms_invitations_resend_count_check", async () => {
    const migration = await Bun.file(
      "sql/106_awcms_identity_invitations_schema.sql"
    ).text();

    expect(migration).toContain(
      `resend_count >= 0 AND resend_count <= ${INVITATION_MAX_RESEND_COUNT}`
    );
  });
});
