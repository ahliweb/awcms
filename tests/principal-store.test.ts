/**
 * The global credential store — ADR-0085, Gelombang 7 PR 7.1 of Issue #423.
 *
 * `awcms_principals` has no RLS, so the controls that stand in for it are the
 * thing worth testing. Three of the four are checkable without a database and
 * are checked here; the fourth (narrowed privileges) is a property of a real
 * PostgreSQL and belongs to `security:readiness` + the DB-gated suite.
 */
import { describe, expect, test } from "bun:test";

import { normalizeLoginIdentifier } from "../src/modules/identity-access/domain/principal-preflight";
import {
  ensurePrincipalForEmail,
  findPrincipalByEmail,
  findPrincipalById,
  loadPrincipalSecret,
  normalizePrincipalEmail
} from "../src/modules/identity-access/application/principal-store";
import { findPrincipalAccessViolations } from "../scripts/identity-principal-access-check";

const STORE = "src/modules/identity-access/application/principal-store.ts";

function recordingTx(rows: unknown[]): { tx: Bun.SQL; statements: string[] } {
  const statements: string[] = [];
  const tx = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push(
      strings.raw
        .map((part, i) => part + (i < values.length ? "?" : ""))
        .join("")
    );
    return Promise.resolve(rows);
  }) as unknown as Bun.SQL;

  return { tx, statements };
}

describe("normalization is ONE rule, stated twice and pinned together", () => {
  test("the store and the census normalize identically", () => {
    // The store restates the rule rather than importing it (no cycle with the
    // census domain). Restating without pinning is how two spellings drift, and
    // the drift would be silent: a login would look up an address the backfill
    // never created.
    for (const value of [
      "Alice@Corp.com",
      "  bob@x.io  ",
      "ÇASE@x.io",
      "already@lower.test",
      "\tmixed@Case.NET\n"
    ]) {
      expect(normalizePrincipalEmail(value)).toBe(
        normalizeLoginIdentifier(value)
      );
    }
  });

  test("it is lowercase + trim and NOTHING else", () => {
    // Explicitly NOT dot-stripping or `+tag` removal: both merge addresses that
    // are genuinely different people at some providers, and a merge is
    // unrecoverable in a way a collision report is not.
    expect(normalizePrincipalEmail("First.Last+tag@Example.COM")).toBe(
      "first.last+tag@example.com"
    );
  });

  test("it matches what sql/112's CHECK constraint enforces", async () => {
    // `email_normalized = lower(btrim(email_normalized))`. A value this function
    // did not produce is refused by the database rather than stored in a shape
    // nothing can look up.
    const migration = await Bun.file("sql/112_awcms_principals.sql").text();

    expect(migration).toContain("lower(btrim(email_normalized))");
    expect(migration).toContain("lower(btrim(i.login_identifier))");
  });
});

describe("control 3 — password_hash never leaves the store", () => {
  test("the ordinary readers return no hash, only whether one exists", async () => {
    const row = {
      id: "p-1",
      email_normalized: "alice@corp.com",
      password_hash: "argon2id$secret"
    };

    for (const read of [
      () => findPrincipalByEmail(recordingTx([row]).tx, "Alice@Corp.com"),
      () => findPrincipalById(recordingTx([row]).tx, "p-1")
    ]) {
      const principal = await read();

      expect(principal).not.toBeNull();
      expect(Object.keys(principal!).sort()).toEqual([
        "emailNormalized",
        "hasCredential",
        "id"
      ]);
      expect(JSON.stringify(principal)).not.toContain("argon2id");
      expect(principal!.hasCredential).toBe(true);
    }
  });

  test("a principal with no promoted credential reports hasCredential false", async () => {
    // The state every row is in immediately after the sql/112 backfill. It must
    // be legible WITHOUT exposing the field, because "has this human logged in
    // since the migration" is an operational question somebody will ask.
    const { tx } = recordingTx([
      { id: "p-2", email_normalized: "bob@x.io", password_hash: null }
    ]);

    expect((await findPrincipalById(tx, "p-2"))!.hasCredential).toBe(false);
  });

  test("exactly ONE exported function returns the hash, and it is named for it", async () => {
    const { tx } = recordingTx([
      { id: "p-1", email_normalized: "alice@corp.com", password_hash: "h" }
    ]);

    expect(await loadPrincipalSecret(tx, "p-1")).toEqual({ passwordHash: "h" });

    // Comments stripped first: the file's prose discusses `password_hash` at
    // length on purpose, and an assertion that counted the discussion would
    // measure documentation rather than escape routes.
    const code = (await Bun.file(STORE).text())
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*\/\/.*$/gm, " ");

    // Counting raw occurrences was the wrong measure and said so by failing:
    // ONE function legitimately produces three (row type, return annotation,
    // returned value). What matters is how many EXPORTED functions can hand a
    // caller the hash — a second one is a second escape route.
    const exportsReturningHash = [
      ...code.matchAll(/export\s+async\s+function\s+(\w+)/g)
    ]
      // The signature, not a brace-delimited body: `Promise<{ passwordHash … }>`
      // means the first `{` after the name is INSIDE the return type, so a
      // non-greedy match to `{` stops before the thing being looked for.
      .filter((match) =>
        code.slice(match.index!, match.index! + 300).includes("passwordHash")
      )
      .map((match) => match[1]);

    expect(exportsReturningHash).toEqual(["loadPrincipalSecret"]);
  });
});

describe("every query is keyed — control 2, applied to the store itself", () => {
  test("the reads bind to one row", async () => {
    const byEmail = recordingTx([]);
    await findPrincipalByEmail(byEmail.tx, "a@b.co");
    expect(byEmail.statements[0]).toContain("WHERE email_normalized = ?");

    const byId = recordingTx([]);
    await findPrincipalById(byId.tx, "p-1");
    expect(byId.statements[0]).toContain("WHERE id = ?");
  });

  test("the live store passes its own gate", async () => {
    const source = await Bun.file(STORE).text();

    expect(findPrincipalAccessViolations(STORE, source)).toEqual([]);
  });

  test("the gate rejects an unkeyed read even when a keyed one sits beside it", () => {
    // The defect this detector had until it was mutated: a fixed window around
    // one query reached into its neighbour and borrowed ITS `WHERE id =`.
    const twoQueries = [
      "const a = await tx`SELECT id FROM awcms_principals ORDER BY created_at`;",
      "const b = await tx`SELECT id FROM awcms_principals WHERE id = ${x}`;"
    ].join("\n");

    const findings = findPrincipalAccessViolations(STORE, twoQueries);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.problem).toContain("UNKEYED");
  });

  test("a file that merely DECLARES the table is not accused of querying it", () => {
    // `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` names it as a key. Demanding a
    // credential-boundary widening for that would push the next person toward
    // declaring it somewhere the privilege gates cannot see.
    const declaration =
      'export const MAP: Record<string, string[]> = { awcms_principals: ["DELETE"] };';

    expect(
      findPrincipalAccessViolations(
        "scripts/security-readiness.ts",
        declaration
      )
    ).toEqual([]);
  });
});

describe("ensurePrincipalForEmail converges rather than overwriting", () => {
  test("it inserts ON CONFLICT DO NOTHING and re-reads", async () => {
    // `DO UPDATE … RETURNING` would touch the row under concurrency, and the one
    // thing this must never do is disturb a credential while ensuring a row
    // exists.
    const { tx, statements } = recordingTx([
      { id: "p-3", email_normalized: "carol@x.io", password_hash: null }
    ]);

    const principal = await ensurePrincipalForEmail(tx, " Carol@X.io ");

    expect(principal.emailNormalized).toBe("carol@x.io");
    expect(statements[0]).toContain(
      "ON CONFLICT (email_normalized) DO NOTHING"
    );
    expect(statements[0]).not.toContain("DO UPDATE");
    expect(statements[1]).toContain("WHERE email_normalized = ?");
  });

  test("a missing row after an idempotent insert throws instead of returning null", async () => {
    // A caller treating "no principal" as ordinary would silently create an
    // unlinked identity.
    const { tx } = recordingTx([]);

    expect(ensurePrincipalForEmail(tx, "d@x.io")).rejects.toThrow(
      /missing immediately after an idempotent insert/
    );
  });
});

describe("control 4 — the authorization boundary did not move", () => {
  test("the store resolves no role, permission, or membership", async () => {
    const source = await Bun.file(STORE).text();
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*\/\/.*$/gm, " ");

    // A principal is an AUTHENTICATION fact, never an AUTHORIZATION fact. The
    // day this file learns to answer "what may this principal do", the sentence
    // ADR-0085 stands on has stopped being true.
    for (const forbidden of [
      "awcms_tenant_users",
      "awcms_roles",
      "awcms_role_permissions",
      "awcms_access_policies",
      "fetchGrantedPermissionKeys"
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });
});
