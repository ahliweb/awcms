/**
 * Changing your own password while signed in (Gelombang 2 PR 2.4 of #423).
 *
 * The load-bearing property is the CONDITIONAL step-up: the program plan asked
 * for `aal2` unconditionally, which would have permanently locked every user
 * without an enrolled factor out of changing their own password. Several tests
 * below exist only to keep that from being quietly re-tightened.
 *
 * Pure: no database, no network. The step-up and MFA lookups are exercised
 * through the recording fake's staged rows, so the ORDER of the queries — which
 * is where the cheap check must come before the expensive one — is observable.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { changeOwnPassword } from "../src/modules/identity-access/application/password-change";
import { validateCredentialChangeInput } from "../src/modules/identity-access/domain/credential-change-validation";
import { hashPassword } from "../src/lib/auth/password";
import { SESSION_EPOCH_FRAGMENT_MARKER } from "../src/modules/identity-access/application/session-credential-epoch";

type Call = { sql: string; values: unknown[] };

function recordingTx(responses: unknown[][]) {
  const calls: Call[] = [];
  let index = 0;

  const tx = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join(" ? ");

    // A FRAGMENT, not a statement (`session-credential-epoch.ts`). Real
    // Bun.SQL splices it into the outer statement and runs ONE query; a
    // recording fake sees an indistinguishable call and would count two.
    // Recording it would make every `toHaveLength` below assert something
    // Postgres never does, which is worse than asserting nothing — so it is
    // skipped, and the marker comment exists to make skipping it honest
    // rather than a guess about the text.
    if (sql.includes(SESSION_EPOCH_FRAGMENT_MARKER)) {
      return { sql, values };
    }

    calls.push({ sql, values });

    return Promise.resolve(responses[index++] ?? []);
  }) as unknown as Bun.SQL;

  return { tx, calls };
}

const NOW = new Date("2026-08-10T00:00:00.000Z");
const TENANT = "tenant-1";
const TOKEN_HASH = "hash-of-the-calling-token";
const CURRENT = "correct horse battery";
const NEXT = "staple correct horse";

/**
 * Query 1 resolves the session, 2 resolves the identity's PRINCIPAL (ADR-0087 —
 * the MFA factor belongs to the human, so every status read hops there first),
 * 3 reads that human's factors (none), 4 probes the tenant's auth policy
 * (absent = password login allowed), 5 reads the stored hash. `extra` continues
 * from there: the identity UPDATE, then the two queries `revokeOtherOwnSessions`
 * issues.
 *
 * The staging is positional, so it is also an assertion about the query SEQUENCE
 * — which is why ADR-0087 adding a hop showed up here as a failure rather than
 * as a silent shift in what each staged row answers.
 */
function stageThrough(
  passwordHash: string,
  extra: unknown[][] = []
): unknown[][] {
  return [
    [{ identity_id: "identity-7" }],
    [{ principal_id: "human-7" }],
    [],
    [],
    [{ password_hash: passwordHash }],
    ...extra
  ];
}

/** The tail after the identity UPDATE, revoking `sessionIds` other sessions. */
function stageRevocation(sessionIds: string[]): unknown[][] {
  return [
    [],
    [{ identity_id: "identity-7" }],
    sessionIds.map((id) => ({ id }))
  ];
}

describe("input validation refuses before anything is hashed", () => {
  test("an unchanged password is a validation error, not a no-op success", () => {
    // "Changed" is what a person reads as "my old password no longer works",
    // and it would not be true.
    const result = validateCredentialChangeInput({
      currentPassword: CURRENT,
      newPassword: CURRENT
    });

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.map((error) => error.field)).toContain("newPassword");
  });

  test("the length floor is the reset path's, imported rather than restated", async () => {
    const { MIN_PASSWORD_LENGTH } =
      await import("../src/modules/identity-access/domain/password-reset-validation");
    const source = readFileSync(
      "src/modules/identity-access/domain/credential-change-validation.ts",
      "utf8"
    );

    expect(source).toContain("MIN_PASSWORD_LENGTH");
    // Two constants that must agree are two constants that eventually will not.
    expect(source).not.toMatch(/newPassword\.length\s*<\s*\d/);

    const result = validateCredentialChangeInput({
      currentPassword: CURRENT,
      newPassword: "x".repeat(MIN_PASSWORD_LENGTH - 1)
    });

    expect(result.valid).toBe(false);
  });

  test("both fields are required", () => {
    expect(validateCredentialChangeInput({}).valid).toBe(false);
    expect(validateCredentialChangeInput({ newPassword: NEXT }).valid).toBe(
      false
    );
    expect(
      validateCredentialChangeInput({ currentPassword: CURRENT }).valid
    ).toBe(false);
  });
});

describe("step-up is asked for only when there is a factor to ask for", () => {
  test("a caller with NO enrolled factor is never asked to step up", async () => {
    // This is the whole reason the plan's unconditional aal2 was not shipped:
    // `requireStepUp` denies any session that is not currently aal2, and a
    // person with no factor can never reach aal2. Shipping it would have locked
    // every non-MFA user out of changing their own password, permanently.
    const hash = await hashPassword(CURRENT);
    const { tx, calls } = recordingTx(
      stageThrough(hash, stageRevocation(["session-2"]))
    );

    const result = await changeOwnPassword(
      tx,
      TENANT,
      TOKEN_HASH,
      { currentPassword: CURRENT, newPassword: NEXT },
      NOW
    );

    expect(result.outcome).toBe("changed");
    // No assurance lookup happened at all — the MFA status query answered
    // "none" and the step-up path was skipped rather than satisfied.
    expect(calls.some((call) => call.sql.includes("assurance_level"))).toBe(
      false
    );
  });

  test("a caller WITH a factor and a stale step-up is refused, and nothing is written", async () => {
    const { tx, calls } = recordingTx([
      [{ identity_id: "identity-7" }],
      // ADR-0087 — the identity → principal hop, then the human's factor.
      [{ principal_id: "human-7" }],
      [{ id: "factor-1", factor_type: "totp", activated_at: NOW }],
      // `resolveSessionAssurance` finds no live stepped-up session row.
      []
    ]);

    expect(
      await changeOwnPassword(
        tx,
        TENANT,
        TOKEN_HASH,
        { currentPassword: CURRENT, newPassword: NEXT },
        NOW
      )
    ).toEqual({ outcome: "step_up_required" });

    expect(calls.some((call) => call.sql.includes("UPDATE"))).toBe(false);
  });

  test("the step-up check runs BEFORE the argon2id verification", async () => {
    // Cheaper first, and it keeps a stale-step-up refusal from doubling as an
    // answer about whether the submitted currentPassword was right.
    const source = readFileSync(
      "src/modules/identity-access/application/password-change.ts",
      "utf8"
    );

    expect(source.indexOf("requireStepUp(")).toBeLessThan(
      source.indexOf("verifyPassword(")
    );
  });
});

describe("the write happens only after the credential is proven", () => {
  test("a wrong current password writes nothing", async () => {
    const hash = await hashPassword(CURRENT);
    const { tx, calls } = recordingTx(stageThrough(hash));

    expect(
      await changeOwnPassword(
        tx,
        TENANT,
        TOKEN_HASH,
        { currentPassword: "not it", newPassword: NEXT },
        NOW
      )
    ).toEqual({ outcome: "invalid_credentials" });

    expect(calls.some((call) => call.sql.includes("UPDATE"))).toBe(false);
  });

  test("success replaces the hash, clears the lockout, and revokes the OTHER sessions", async () => {
    const hash = await hashPassword(CURRENT);
    const { tx, calls } = recordingTx(
      stageThrough(hash, stageRevocation(["s2", "s3"]))
    );

    expect(
      await changeOwnPassword(
        tx,
        TENANT,
        TOKEN_HASH,
        { currentPassword: CURRENT, newPassword: NEXT },
        NOW
      )
    ).toEqual({
      outcome: "changed",
      identityId: "identity-7",
      revokedSessionCount: 2
    });

    const update = calls.find((call) =>
      call.sql.includes("UPDATE awcms_identities")
    )!;

    expect(update.sql).toContain("password_hash =");
    // Whoever supplied the current password proved control of the credential —
    // a stronger signal than the counter that locked it, and an attacker who
    // reached this branch already knows the password.
    expect(update.sql).toContain("failed_login_count = 0");
    expect(update.sql).toContain("locked_until = NULL");
    // The plaintext must never appear in a statement's values.
    expect(update.values).not.toContain(NEXT);
    expect(update.values).not.toContain(CURRENT);

    const revoke = calls.find((call) =>
      call.sql.includes("UPDATE awcms_sessions")
    )!;

    expect(revoke.sql).toContain("token_hash <>");
    expect(revoke.values).toContain(TOKEN_HASH);
  });

  test("an SSO-only identity is refused before the password is even read", async () => {
    // Re-checked here rather than trusted from login: the tenant may have
    // switched to SSO-only since this session was issued, and writing a new
    // password would be writing a credential the policy says must not work.
    const { tx, calls } = recordingTx([
      [{ identity_id: "identity-7" }],
      [],
      // The tenant turned password login off and this identity is not
      // break-glass.
      [{ password_login_enabled: false, break_glass_identity_ids: [] }]
    ]);

    expect(
      await changeOwnPassword(
        tx,
        TENANT,
        TOKEN_HASH,
        { currentPassword: CURRENT, newPassword: NEXT },
        NOW
      )
    ).toEqual({ outcome: "password_login_disabled" });

    expect(calls.some((call) => call.sql.includes("UPDATE"))).toBe(false);
    // And the stored hash was never even read.
    expect(calls.some((call) => call.sql.includes("password_hash"))).toBe(
      false
    );
  });

  test("a bearer naming no live session stops at the first query", async () => {
    const { tx, calls } = recordingTx([[]]);

    expect(
      await changeOwnPassword(
        tx,
        TENANT,
        TOKEN_HASH,
        { currentPassword: CURRENT, newPassword: NEXT },
        NOW
      )
    ).toEqual({ outcome: "unauthenticated" });
    expect(calls).toHaveLength(1);
  });
});

describe("the route is self-service and leaks no password anywhere", () => {
  const source = readFileSync(
    "src/pages/api/v1/auth/password/change.ts",
    "utf8"
  );

  test("it uses the self-service seam and names no permission", () => {
    // ADR-0049 §7 and ADR-0058 §E: a permission for "change your own password"
    // would be a wall in front of the feature AND an action nothing seeds,
    // which denies everyone including the tenant owner.
    expect(source).toContain("defineSelfServiceTenantRoute");
    expect(source).not.toContain("authorizeInTransaction");
    expect(source).not.toContain("activityCode");
  });

  test("the audit attributes carry no password and no length of one", () => {
    // Asserted against the `attributes:` values themselves, not against the
    // whole file: the docblock names both fields, and prose must not be able to
    // decide a test about behaviour.
    //
    // A length is a meaningful narrowing of a search space, and it is exactly
    // the kind of field that gets added because it "seems harmless".
    const attributeBlocks = [
      ...source.matchAll(/attributes:\s*(\{[\s\S]*?\}|\w+)/g)
    ].map((match) => match[1]!);

    expect(attributeBlocks.length).toBeGreaterThan(1);

    for (const block of attributeBlocks) {
      expect(block.toLowerCase()).not.toContain("password");
    }

    expect(source).not.toContain("newPassword.length");
    expect(source).not.toMatch(/passwordLength/);
  });

  test("both the success and the failure are audited", () => {
    expect(source).toContain("password_changed");
    expect(source).toContain("password_change_failed");
  });

  test("it is rate limited on the SOURCE, never on the account", () => {
    // An identifier-keyed bucket would let anyone who can reach the endpoint
    // hold one person's own password change hostage — the same objection
    // already recorded against an identifier-keyed login bucket.
    expect(source).toContain("auth-password-change:${clientIp}");
    expect(source).toContain("isMachineCredentialToken");
  });

  test("every response, including the refusals, is uncacheable", () => {
    expect(source).toContain('"cache-control": "private, no-store"');
    expect(source).not.toMatch(/\breturn ok\(/);
  });

  test("the body is read BEFORE the transaction, never inside it", () => {
    // `await request.json()` waits on the CLIENT. Reading it inside
    // `withTenant` holds a reserved pool connection — and its work-class slot —
    // for as long as a caller chooses to take sending its body, which turns one
    // slow request into a connection held against every other request in the
    // pool. `queueTimeoutMs` bounds ACQUIRING a connection, never holding one.
    //
    // Asserted positionally rather than by "does it appear": both `prepare` and
    // `handler` mention the body one way or another, and the question is which
    // side of the transaction boundary the read sits on.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    const prepareAt = code.indexOf("prepare:");
    const handlerAt = code.indexOf("handler:");
    const readAt = code.indexOf("readJsonBody(");

    expect(prepareAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(prepareAt);
    expect(readAt).toBeLessThan(handlerAt);
    // And the handler receives the parsed value rather than re-parsing it.
    expect(code.slice(handlerAt)).toContain("prepared");
    expect(code.slice(handlerAt)).not.toContain("readJsonBody");
  });
});
