/**
 * The tenant-selection token — ADR-0088, Gelombang 7 PR 7.4 of Issue #423.
 *
 * One property matters more than everything else in this PR:
 *
 *   **A selection token must never authenticate `authorizeInTransaction`.**
 *
 * It is the only bearer in the system bound to NO tenant, so a path that let
 * one authorize would authorize against whichever tenant the caller named in a
 * header. The tests below pin it from three directions — the namespace that
 * carries the bearer kind, the guard that refuses it, and the token generator
 * that must never mint a session token which would land in that namespace by
 * accident.
 *
 * Pure: no database. The guard refusal is proven with a transaction fake that
 * FAILS THE TEST if the guard queries anything at all, which is a stronger
 * statement than "it returned 401" — it is "it returned 401 without looking".
 */
import { describe, expect, test } from "bun:test";

import {
  PRINCIPAL_SELECTION_HASH_PREFIX,
  PRINCIPAL_SELECTION_TOKEN_PREFIX,
  generatePrincipalSelectionToken,
  hashPrincipalSelectionToken,
  isPrincipalSelectionHash,
  isPrincipalSelectionToken
} from "../src/lib/auth/principal-selection-token";
import {
  generateSessionToken,
  hashSessionToken
} from "../src/lib/auth/session-token";
import { MACHINE_CREDENTIAL_TOKEN_PREFIX } from "../src/lib/auth/machine-credential-token";
import { authorizeInTransaction } from "../src/modules/identity-access/application/access-guard";

const GUARD = {
  moduleKey: "identity_access",
  activityCode: "users",
  action: "read" as const
};

/** A transaction that fails the test if it is used at all. */
function forbiddenTx(): Bun.SQL {
  return ((strings: TemplateStringsArray) => {
    throw new Error(
      `the guard queried the database for a selection token: ${strings.join("?")}`
    );
  }) as unknown as Bun.SQL;
}

describe("the bearer KIND survives hashing", () => {
  test("a selection token hashes into its own namespace", () => {
    const token = generatePrincipalSelectionToken();

    expect(isPrincipalSelectionToken(token)).toBe(true);
    expect(token.startsWith(PRINCIPAL_SELECTION_TOKEN_PREFIX)).toBe(true);
    expect(hashPrincipalSelectionToken(token)).toStartWith(
      PRINCIPAL_SELECTION_HASH_PREFIX
    );
  });

  test("`hashSessionToken` dispatches it there too", () => {
    // The 183 route files call `hashSessionToken`, so this is the function the
    // guard actually receives its input from. A selection token that hashed
    // into the SESSION namespace would be looked up as a session — the exact
    // confusion ADR-0049 made structurally impossible for machine credentials.
    const token = generatePrincipalSelectionToken();

    expect(hashSessionToken(token)).toBe(hashPrincipalSelectionToken(token));
    expect(hashSessionToken(token)).not.toStartWith("sha256:");
  });

  test("an ordinary session token still hashes into the session namespace", () => {
    expect(hashSessionToken(generateSessionToken())).toStartWith("sha256:");
  });

  test("the three namespaces are mutually exclusive", () => {
    expect(
      isPrincipalSelectionHash(hashSessionToken(generateSessionToken()))
    ).toBe(false);
    expect(
      isPrincipalSelectionHash(
        hashPrincipalSelectionToken(generatePrincipalSelectionToken())
      )
    ).toBe(true);
  });

  test("a generated session token never begins with a reserved prefix", () => {
    // p ≈ 64^-7 per draw, so this cannot be caught by sampling — the assertion
    // documents the property the reroll loop exists for, and the loop itself is
    // what makes it true. A session token starting with `awcmsp_` would hash
    // into the namespace the guard REFUSES: a valid session row whose every
    // request answers 401.
    for (let i = 0; i < 200; i += 1) {
      const token = generateSessionToken();

      expect(token.startsWith(PRINCIPAL_SELECTION_TOKEN_PREFIX)).toBe(false);
      expect(token.startsWith(MACHINE_CREDENTIAL_TOKEN_PREFIX)).toBe(false);
    }
  });
});

describe("THE invariant — a selection token authorizes nothing", () => {
  test("the guard refuses it before issuing a single query", async () => {
    const hash = hashPrincipalSelectionToken(generatePrincipalSelectionToken());

    const result = await authorizeInTransaction(
      forbiddenTx(),
      "11111111-1111-4111-8111-111111111111",
      hash,
      new Date(),
      GUARD
    );

    expect(result.allowed).toBe(false);
    if (result.allowed) return;
    expect(result.denied.status).toBe(401);
  });

  test("no decision log row can exist, because nothing is written at all", async () => {
    // `recordDecisionLog` needs a resolved `tenantUserId`, and the refusal
    // returns before any context is resolved. `forbiddenTx` proves the stronger
    // form: not one statement is issued, so there is nothing that COULD be a
    // log row.
    const hash = hashPrincipalSelectionToken(generatePrincipalSelectionToken());

    await expect(
      authorizeInTransaction(
        forbiddenTx(),
        "11111111-1111-4111-8111-111111111111",
        hash,
        new Date(),
        GUARD
      )
    ).resolves.toBeDefined();
  });

  test("the refusal is byte-identical to an unknown session", async () => {
    // A caller must not learn that the token it holds is a REAL selection
    // token — that would turn the guard into an oracle for a live credential.
    const selection = await authorizeInTransaction(
      forbiddenTx(),
      "11111111-1111-4111-8111-111111111111",
      hashPrincipalSelectionToken(generatePrincipalSelectionToken()),
      new Date(),
      GUARD
    );

    // An unknown SESSION hash takes the ordinary path, which queries; the fake
    // below answers "no rows" the way an unknown session would.
    const emptyTx = (() => Promise.resolve([])) as unknown as Bun.SQL;

    const unknown = await authorizeInTransaction(
      emptyTx,
      "11111111-1111-4111-8111-111111111111",
      hashSessionToken(generateSessionToken()),
      new Date(),
      GUARD
    );

    expect(selection.allowed).toBe(false);
    expect(unknown.allowed).toBe(false);
    if (selection.allowed || unknown.allowed) return;

    expect(selection.denied.status).toBe(unknown.denied.status);
    expect(await selection.denied.clone().text()).toBe(
      await unknown.denied.clone().text()
    );
  });

  test("the guard's refusal is the FIRST thing in the function", async () => {
    // Source-pinned, because the ordering is the whole guarantee and it is
    // invisible in behaviour once the token also fails to match a session row.
    // A future refactor that moved the check below `resolveTenantContext` would
    // still pass every behavioural test here.
    const source = await Bun.file(
      "src/modules/identity-access/application/access-guard.ts"
    ).text();

    const body = source.slice(
      source.indexOf("export async function authorizeInTransaction")
    );

    expect(body.indexOf("isPrincipalSelectionHash")).toBeLessThan(
      body.indexOf("isMachineCredentialHash(tokenHash)")
    );
    expect(body.indexOf("isPrincipalSelectionHash")).toBeLessThan(
      body.indexOf("resolveTenantPrincipal(")
    );
  });
});
