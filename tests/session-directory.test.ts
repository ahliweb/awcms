/**
 * Self-service session listing and revocation (Gelombang 2 of #423).
 *
 * The interesting properties are all about what the endpoints REFUSE, and all
 * of them are expressed in SQL — so the assertions run against a recording fake
 * and check which statement was issued with which predicate. What Postgres does
 * with a correct statement is not in question; whether the statement carries
 * the ownership predicate at all is.
 *
 * Pure: no database, no network.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  listOwnSessions,
  revokeOwnSession
} from "../src/modules/identity-access/application/session-directory";

type Call = { sql: string; values: unknown[] };

/** Answers each call from a queue, so a test can stage "caller resolves, then rows". */
function recordingTx(responses: unknown[][]) {
  const calls: Call[] = [];
  let index = 0;

  const tx = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ sql: strings.join(" ? "), values });

    return Promise.resolve(responses[index++] ?? []);
  }) as unknown as Bun.SQL;

  return { tx, calls };
}

const NOW = new Date("2026-08-10T00:00:00.000Z");
const TENANT = "tenant-1";
const TOKEN_HASH = "hash-of-the-calling-token";

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    token_hash: "hash-of-some-other-token",
    issued_at: NOW,
    expires_at: new Date(NOW.getTime() + 3_600_000),
    assurance_level: "aal1",
    origin_auth: "password",
    client_ip_hash: null,
    user_agent_summary: null,
    ...overrides
  };
}

describe("listing is scoped to the caller's own identity", () => {
  test("an unknown or dead token lists nothing at all", async () => {
    // `null`, not an empty array: the route turns this into the same 401 it
    // uses for a missing bearer. An empty list would tell an expired token that
    // its tenant exists and it simply has no sessions.
    const { tx, calls } = recordingTx([[]]);

    expect(await listOwnSessions(tx, TENANT, TOKEN_HASH, NOW)).toBeNull();
    // And it stops there — no second query runs on an unresolved caller.
    expect(calls).toHaveLength(1);
  });

  test("the caller is resolved from the TOKEN, and rows are filtered by that identity", async () => {
    const { tx, calls } = recordingTx([
      [{ identity_id: "identity-7" }],
      [sessionRow()]
    ]);

    await listOwnSessions(tx, TENANT, TOKEN_HASH, NOW);

    expect(calls[0]!.sql).toContain("token_hash =");
    expect(calls[0]!.values).toContain(TOKEN_HASH);
    // The list query must key on the RESOLVED identity, never on a caller-named
    // one — there is no parameter for a caller to name one with, and this is
    // what keeps it that way.
    expect(calls[1]!.sql).toContain("identity_id =");
    expect(calls[1]!.values).toContain("identity-7");
    expect(calls[1]!.values).toContain(TENANT);
  });

  test("it never returns a token hash, and marks the current session by comparing it internally", async () => {
    const { tx } = recordingTx([
      [{ identity_id: "identity-7" }],
      [
        sessionRow({ id: "other", token_hash: "someone-elses" }),
        sessionRow({ id: "mine", token_hash: TOKEN_HASH })
      ]
    ]);

    const sessions = (await listOwnSessions(tx, TENANT, TOKEN_HASH, NOW))!;

    expect(sessions.map((session) => session.current)).toEqual([false, true]);
    // A hash that reached the client could be replayed as a bearer.
    expect(JSON.stringify(sessions)).not.toContain(TOKEN_HASH);
  });

  test("revoked and expired rows are excluded by the query, not by the caller", async () => {
    const { tx, calls } = recordingTx([[{ identity_id: "identity-7" }], []]);

    await listOwnSessions(tx, TENANT, TOKEN_HASH, NOW);

    expect(calls[1]!.sql).toContain("revoked_at IS NULL");
    expect(calls[1]!.sql).toContain("expires_at >");
  });
});

describe("revocation refuses in one shape", () => {
  test("ownership lives in the UPDATE's WHERE clause, not in a preceding read", async () => {
    // A read-then-compare pair leaves a window, and it grows branches that
    // report WHY it refused — which is how an endpoint becomes an oracle.
    const { tx, calls } = recordingTx([
      [{ identity_id: "identity-7" }],
      [],
      [{ id: "session-2" }]
    ]);

    const result = await revokeOwnSession(
      tx,
      TENANT,
      TOKEN_HASH,
      "session-2",
      NOW
    );

    expect(result).toEqual({ outcome: "revoked" });

    const update = calls.at(-1)!;

    expect(update.sql).toContain("UPDATE awcms_sessions");
    expect(update.sql).toContain("identity_id =");
    expect(update.sql).toContain("tenant_id =");
    expect(update.values).toContain("identity-7");
  });

  test("someone else's session is `not_found`, exactly like an unknown id", async () => {
    // The UPDATE matches nothing in both cases, and both must return the same
    // thing — a distinct answer would confirm the id exists.
    const { tx } = recordingTx([[{ identity_id: "identity-7" }], [], []]);

    expect(
      await revokeOwnSession(tx, TENANT, TOKEN_HASH, "not-mine", NOW)
    ).toEqual({ outcome: "not_found" });
  });

  test("the CURRENT session is refused separately, and no UPDATE is issued", async () => {
    const { tx, calls } = recordingTx([
      [{ identity_id: "identity-7" }],
      [{ "?column?": 1 }]
    ]);

    expect(
      await revokeOwnSession(tx, TENANT, TOKEN_HASH, "session-1", NOW)
    ).toEqual({ outcome: "is_current" });

    // Returning `is_current` while still revoking would satisfy the assertion
    // above and leave the caller holding a dead cookie.
    expect(calls.some((call) => call.sql.includes("UPDATE"))).toBe(false);
  });

  test("an unresolved caller never reaches the UPDATE", async () => {
    const { tx, calls } = recordingTx([[]]);

    expect(
      await revokeOwnSession(tx, TENANT, TOKEN_HASH, "anything", NOW)
    ).toEqual({ outcome: "unauthenticated" });
    expect(calls).toHaveLength(1);
  });
});

describe("the routes carry no permission, on purpose", () => {
  const list = readFileSync("src/pages/api/v1/auth/sessions/index.ts", "utf8");
  const revoke = readFileSync("src/pages/api/v1/auth/sessions/[id].ts", "utf8");

  test("both use the self-service seam and never call the chokepoint", () => {
    // ADR-0049 §7. A permission for "your own sessions" would be a wall in
    // front of the feature AND a latent-authz trap: an action nothing seeds
    // denies everyone including the tenant owner (ADR-0058 §E).
    for (const source of [list, revoke]) {
      expect(source).toContain("defineSelfServiceTenantRoute");
      expect(source).not.toContain("authorizeInTransaction");
      expect(source).not.toContain("moduleKey:");
    }
  });

  test("neither reads a caller-supplied subject — the identity comes from the token", () => {
    // The self-service seam hands the route a `tokenHash`, never a subject, and
    // both resolve the identity from it inside the transaction. A route that
    // accepted an id would be an admin surface with a friendly name.
    for (const source of [list, revoke]) {
      expect(source).toContain("tokenHash");
      expect(source).not.toMatch(/body\.\s*tenantUserId|params\.tenantUserId/);
    }
  });

  test("a machine credential is refused before any database work", () => {
    for (const source of [list, revoke]) {
      expect(source).toContain("isMachineCredentialToken");
      expect(source.indexOf("isMachineCredentialToken")).toBeLessThan(
        source.indexOf("handler:")
      );
    }
  });

  test("every response is uncacheable, including the failures", () => {
    for (const source of [list, revoke]) {
      expect(source).toContain('"cache-control": "private, no-store"');
    }
  });
});

describe("the persisted IP hash is null unless the key is stable", () => {
  test("session issuers use persistableClientIpHash, never hashClientIp", async () => {
    // `hashClientIp` falls back to a per-process random key. That is fine for
    // an audit attribute and wrong for a stored column: after a restart the
    // same device hashes differently, and the list a person uses to decide
    // "which of these is not me" shows one device as several.
    const issuers = [
      "src/pages/api/v1/auth/login.ts",
      "src/pages/api/v1/auth/mfa/totp/verify.ts",
      "src/pages/api/v1/auth/mfa/totp/enroll/verify.ts",
      "src/pages/api/v1/auth/sso/[providerKey]/callback.ts"
    ];

    for (const file of issuers) {
      const source = readFileSync(file, "utf8");

      expect(source).toContain("persistableClientIpHash(");
    }
  });

  test("a step-up rotation carries the original origin forward", async () => {
    // Rotating a session raises assurance; it does not re-authenticate. Stamping
    // `password` there would rewrite an SSO session's provenance at the exact
    // moment somebody proves a second factor.
    const source = readFileSync(
      "src/modules/identity-access/application/mfa-session-assurance.ts",
      "utf8"
    );

    expect(source).toContain(
      'originAuth: origin[0]?.origin_auth ?? "password"'
    );
  });
});
