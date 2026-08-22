/**
 * Other people's sessions — the guarded, audited half of the pair (Gelombang 2
 * PR 2.2 of #423).
 *
 * The properties worth defending are all about what the SQL excludes and what
 * the two routes refuse to share, so the assertions run against a recording fake
 * and against the route sources. What Postgres does with a correct statement is
 * not in question; whether the statement carries the exclusion at all is.
 *
 * Pure: no database, no network.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  listSessionsForTenantUser,
  revokeSessionsForTenantUser
} from "../src/modules/identity-access/application/admin-session-directory";
import { identityAccessModule } from "../src/modules/identity-access/module";
import { SESSION_EPOCH_FRAGMENT_MARKER } from "../src/modules/identity-access/application/session-credential-epoch";

type Call = { sql: string; values: unknown[] };

/** Answers each call from a queue, so a test can stage "user resolves, then rows". */
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
const CALLER_TOKEN_HASH = "hash-of-the-calling-token";
const TARGET_USER = "tenant-user-9";

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

describe("the subject is resolved through tenant membership", () => {
  test("an id this tenant does not own is `not_found`, and nothing else runs", async () => {
    const { tx, calls } = recordingTx([[]]);

    expect(
      await listSessionsForTenantUser(
        tx,
        TENANT,
        TARGET_USER,
        CALLER_TOKEN_HASH,
        NOW
      )
    ).toEqual({ outcome: "not_found" });
    expect(calls).toHaveLength(1);
  });

  test("the membership hop is the tenant check — sessions are keyed on the RESOLVED identity", async () => {
    // `awcms_sessions` keys on `identity_id` while the surface names a
    // `tenant_user_id`, so the hop is unavoidable. It is also what stops a
    // caller reaching sessions by naming an identity that merely exists.
    const { tx, calls } = recordingTx([
      [{ identity_id: "identity-7" }],
      [sessionRow()]
    ]);

    await listSessionsForTenantUser(
      tx,
      TENANT,
      TARGET_USER,
      CALLER_TOKEN_HASH,
      NOW
    );

    expect(calls[0]!.sql).toContain("awcms_tenant_users");
    expect(calls[0]!.values).toContain(TENANT);
    expect(calls[0]!.values).toContain(TARGET_USER);

    expect(calls[1]!.sql).toContain("identity_id =");
    expect(calls[1]!.values).toContain("identity-7");
    expect(calls[1]!.values).toContain(TENANT);
  });

  test("revocation resolves through the same hop and refuses the same way", async () => {
    const { tx, calls } = recordingTx([[]]);

    expect(
      await revokeSessionsForTenantUser(
        tx,
        TENANT,
        TARGET_USER,
        CALLER_TOKEN_HASH,
        NOW
      )
    ).toEqual({ outcome: "not_found" });
    // No UPDATE may be issued against an unresolved subject.
    expect(calls.some((call) => call.sql.includes("UPDATE"))).toBe(false);
  });
});

describe("listing discloses the minimum that supports the decision", () => {
  test("no token hash reaches the caller, and `isCallerSession` is computed internally", async () => {
    const { tx } = recordingTx([
      [{ identity_id: "identity-7" }],
      [
        sessionRow({ id: "theirs", token_hash: "someone-elses" }),
        sessionRow({ id: "mine", token_hash: CALLER_TOKEN_HASH })
      ]
    ]);

    const result = await listSessionsForTenantUser(
      tx,
      TENANT,
      TARGET_USER,
      CALLER_TOKEN_HASH,
      NOW
    );

    expect(result.outcome).toBe("ok");
    if (result.outcome !== "ok") return;

    expect(result.sessions.map((session) => session.isCallerSession)).toEqual([
      false,
      true
    ]);
    // A hash that reached a client could be replayed as a bearer.
    expect(JSON.stringify(result.sessions)).not.toContain(CALLER_TOKEN_HASH);
    expect(JSON.stringify(result.sessions)).not.toContain("someone-elses");
  });

  test("revoked and expired rows are excluded by the query, not by the caller", async () => {
    const { tx, calls } = recordingTx([[{ identity_id: "identity-7" }], []]);

    await listSessionsForTenantUser(
      tx,
      TENANT,
      TARGET_USER,
      CALLER_TOKEN_HASH,
      NOW
    );

    expect(calls[1]!.sql).toContain("revoked_at IS NULL");
    expect(calls[1]!.sql).toContain("expires_at >");
  });

  test("a deactivated user lists empty rather than 404 — the two mean different things", async () => {
    // `setTenantUserStatus` already revokes their sessions, so empty is the
    // expected answer; a 404 would be indistinguishable from a wrong id, which
    // is the check an operator is making at that moment.
    const { tx } = recordingTx([[{ identity_id: "identity-7" }], []]);

    expect(
      await listSessionsForTenantUser(
        tx,
        TENANT,
        TARGET_USER,
        CALLER_TOKEN_HASH,
        NOW
      )
    ).toEqual({ outcome: "ok", sessions: [] });
  });
});

describe("revocation never ends the session making the call", () => {
  test("the UPDATE excludes the caller's own token hash", async () => {
    const { tx, calls } = recordingTx([
      [{ identity_id: "identity-7" }],
      [],
      [{ id: "session-1" }, { id: "session-2" }]
    ]);

    const result = await revokeSessionsForTenantUser(
      tx,
      TENANT,
      TARGET_USER,
      CALLER_TOKEN_HASH,
      NOW
    );

    expect(result).toEqual({
      outcome: "revoked",
      revokedCount: 2,
      keptCallerSession: false
    });

    const update = calls.at(-1)!;

    expect(update.sql).toContain("UPDATE awcms_sessions");
    expect(update.sql).toContain("token_hash <>");
    expect(update.values).toContain(CALLER_TOKEN_HASH);
    // Restamping an already-revoked row would move the only timestamp an
    // investigation has for when access actually ended.
    expect(update.sql).toContain("revoked_at IS NULL");
  });

  test("pointing it at yourself reports the kept session instead of hiding it", async () => {
    // An operator told "revoked 1" whose console still works needs to know why,
    // or they conclude the control does not work.
    const { tx } = recordingTx([
      [{ identity_id: "identity-7" }],
      [{ "?column?": 1 }],
      [{ id: "session-2" }]
    ]);

    expect(
      await revokeSessionsForTenantUser(
        tx,
        TENANT,
        TARGET_USER,
        CALLER_TOKEN_HASH,
        NOW
      )
    ).toEqual({
      outcome: "revoked",
      revokedCount: 1,
      keptCallerSession: true
    });
  });

  test("revoking nothing is still a success with a count, not a 404", async () => {
    const { tx } = recordingTx([[{ identity_id: "identity-7" }], [], []]);

    expect(
      await revokeSessionsForTenantUser(
        tx,
        TENANT,
        TARGET_USER,
        CALLER_TOKEN_HASH,
        NOW
      )
    ).toEqual({
      outcome: "revoked",
      revokedCount: 0,
      keptCallerSession: false
    });
  });
});

describe("the two permissions are declared, and separately", () => {
  const permissions = identityAccessModule.permissions ?? [];

  test("`user_sessions` seeds read and revoke as distinct entries", () => {
    const actions = permissions
      .filter((permission) => permission.activityCode === "user_sessions")
      .map((permission) => permission.action)
      .sort();

    expect(actions).toEqual(["read", "revoke"]);
  });

  test("neither route names the other's action", () => {
    // The whole value of the split is that `revoke` is grantable without
    // `read`. A route that guarded on both — or on one activity covering both —
    // would erase it while every test above still passed.
    const list = readFileSync(
      "src/pages/api/v1/users/[id]/sessions/index.ts",
      "utf8"
    );
    const revoke = readFileSync(
      "src/pages/api/v1/users/[id]/sessions/revoke-all.ts",
      "utf8"
    );

    expect(list).toContain('action: "read"');
    expect(list).not.toContain('action: "revoke"');
    expect(revoke).toContain('action: "revoke"');
    expect(revoke).not.toContain('action: "read"');

    for (const source of [list, revoke]) {
      expect(source).toContain('activityCode: "user_sessions"');
      expect(source).toContain("defineTenantRoute");
    }
  });

  test("both are seeded by a migration, or the owner is denied by default", () => {
    // ADR-0058 §E — an action nothing seeds denies everyone including the
    // tenant owner, while the calling code reads as correctly guarded.
    const migration = readFileSync(
      "sql/101_awcms_identity_user_sessions_permissions.sql",
      "utf8"
    );

    expect(migration).toContain("'user_sessions', 'read'");
    expect(migration).toContain("'user_sessions', 'revoke'");
  });
});

describe("neither route leaks session metadata into a cache", () => {
  const list = readFileSync(
    "src/pages/api/v1/users/[id]/sessions/index.ts",
    "utf8"
  );
  const revoke = readFileSync(
    "src/pages/api/v1/users/[id]/sessions/revoke-all.ts",
    "utf8"
  );

  test("every response, including the refusals, carries private, no-store", () => {
    for (const source of [list, revoke]) {
      expect(source).toContain('"cache-control": "private, no-store"');
      // Every `fail(`/`jsonResponse(` in these files must be the header-bearing
      // form; a bare `ok(...)` would answer without it.
      expect(source).not.toMatch(/\breturn ok\(/);
    }
  });

  test("a malformed id answers 404, never 400", () => {
    // A 400 for "not a uuid" and a 404 for "no such user" together tell a
    // caller which ids are well-formed AND which exist.
    for (const source of [list, revoke]) {
      expect(source).toContain("UUID_PATTERN");
      expect(source).not.toContain("VALIDATION_ERROR");
    }
  });

  test("the revocation is audited", () => {
    expect(revoke).toContain("recordAuditEvent");
    expect(revoke).toContain("user_sessions.revoked_all");
  });
});
