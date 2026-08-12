/**
 * The global MFA store — ADR-0087, Gelombang 7 PR 7.3 of Issue #423.
 *
 * `awcms_principal_mfa_factors` and `awcms_principal_mfa_recovery_codes` have no
 * RLS, so — exactly as in `principal-store.test.ts` for the credential — what is
 * worth testing is the four controls standing in its place. Three are checkable
 * without a database and are checked here; the fourth (narrowed privileges) is a
 * property of a real PostgreSQL and belongs to `security:readiness` plus the
 * DB-gated suite.
 *
 * The compare-and-swap semantics are asserted at the STATEMENT level here and
 * behaviourally under concurrency in `tests/mfa-integration.test.ts`. Both are
 * needed: the integration test proves the database enforces it, this one proves
 * the predicate did not quietly leave the query on a machine that has no
 * database to notice.
 */
import { describe, expect, test } from "bun:test";

import {
  activateFactor,
  advanceLastUsedStep,
  clearFactorFailures,
  consumeRecoveryCode,
  deletePendingFactors,
  deleteRecoveryCodesForFactor,
  deleteRecoveryCodesForPrincipal,
  disableLiveFactors,
  findActiveFactor,
  findActiveFactorSummary,
  findLiveFactorIds,
  findPendingFactor,
  insertPendingFactor,
  insertRecoveryCodeHash,
  lockFactorForVerify,
  recordFactorVerifyFailure
} from "../src/modules/identity-access/application/principal-mfa-store";
import { findPrincipalAccessViolations } from "../scripts/identity-principal-access-check";

const STORE = "src/modules/identity-access/application/principal-mfa-store.ts";

function recordingTx(rows: unknown[]): {
  tx: Bun.SQL;
  statements: string[];
  values: unknown[][];
} {
  const statements: string[] = [];
  const values: unknown[][] = [];

  const tx = ((strings: TemplateStringsArray, ...args: unknown[]) => {
    statements.push(
      strings.raw.map((part, i) => part + (i < args.length ? "?" : "")).join("")
    );
    values.push(args);
    return Promise.resolve(rows);
  }) as unknown as Bun.SQL;

  return { tx, statements, values };
}

async function statementOf(
  call: (tx: Bun.SQL) => Promise<unknown>,
  rows: unknown[] = []
): Promise<string> {
  const { tx, statements } = recordingTx(rows);
  await call(tx);

  return statements[0]!.replace(/\s+/g, " ").trim();
}

describe("control 2 — every query binds to one row", () => {
  test("the live store passes its own gate", async () => {
    const source = await Bun.file(STORE).text();

    expect(findPrincipalAccessViolations(STORE, source)).toEqual([]);
  });

  test("the gate refuses this store reaching into the CREDENTIAL table", () => {
    // ADR-0087 widened the gate to three tables and deliberately did NOT fuse
    // the allow-lists. Holding a factor is not a licence to read password
    // hashes, and one shared list would have made "the identity-access module"
    // the boundary — which is not a boundary.
    const reach =
      "const rows = await tx`SELECT password_hash FROM awcms_principals WHERE id = ${x}`;";

    const findings = findPrincipalAccessViolations(STORE, reach);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.problem).toContain("awcms_principals");
    expect(findings[0]!.problem).toContain("allow-list");
  });

  test("no listing, no search, no pagination anywhere in the store", async () => {
    // A scannable MFA table is a targeting list: it says who holds a second
    // factor and who does not. Asserted against the code with comments removed —
    // the header prose says the words on purpose.
    const code = (await Bun.file(STORE).text())
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*\/\/.*$/gm, " ");

    expect(code).not.toMatch(/\bLIKE\b|\bILIKE\b/i);
    expect(code).not.toMatch(/\bLIMIT\b|\bOFFSET\b/i);
    expect(code).not.toMatch(/\bORDER\s+BY\b/i);
  });
});

describe("control 3 — the ciphertext leaves by exactly one shape", () => {
  const row = {
    id: "f-1",
    secret_ciphertext: "v1$cipher",
    last_used_step: 12,
    failed_verify_count: 0,
    locked_until: null,
    factor_type: "totp",
    activated_at: new Date("2026-08-01T00:00:00Z")
  };

  test("the verification read carries it", async () => {
    const factor = await findActiveFactor(recordingTx([row]).tx, "human-1");

    expect(factor!.secret_ciphertext).toBe("v1$cipher");
  });

  test("the SUMMARY read does not select it at all", async () => {
    // Not merely "does not return it" — does not ASK for it. A summary that
    // selected the column and dropped it in JS would put the ciphertext one
    // careless `...row` spread away from a response body.
    const statement = await statementOf(
      (tx) => findActiveFactorSummary(tx, "human-1"),
      [row]
    );

    expect(statement).not.toContain("secret_ciphertext");

    const summary = await findActiveFactorSummary(recordingTx([row]).tx, "h-1");

    expect(Object.keys(summary!).sort()).toEqual([
      "activatedAt",
      "factorType",
      "id"
    ]);
    expect(JSON.stringify(summary)).not.toContain("cipher");
  });

  test("the enumeration read returns ids and nothing else", async () => {
    const statement = await statementOf(
      (tx) => findLiveFactorIds(tx, "human-1"),
      [{ id: "f-1" }]
    );

    expect(statement).toContain("SELECT id FROM");
    expect(statement).not.toContain("secret_ciphertext");
  });
});

describe("control 4 — holding a factor grants nothing", () => {
  test("no authorization table is named in the store", async () => {
    const code = (await Bun.file(STORE).text())
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*\/\/.*$/gm, " ");

    for (const table of [
      "awcms_tenant_users",
      "awcms_access_policies",
      "awcms_access_assignments",
      "awcms_role_permissions",
      "awcms_permissions",
      "awcms_user_groups"
    ]) {
      expect(code).not.toContain(table);
    }
  });
});

describe("the compare-and-swap guarantees survive the move", () => {
  test("the replay guard advances only FORWARD, in the predicate", async () => {
    // `sql/024`'s guarantee, carried over unchanged. Two concurrent requests
    // replaying the same timestep cannot both win: the loser matches zero rows.
    // Turning this into a blind SET would make the move to the principal a
    // silent downgrade of a control it was only supposed to relocate.
    const statement = await statementOf(
      (tx) => advanceLastUsedStep(tx, "f-1", 42, new Date()),
      [{ id: "f-1" }]
    );

    expect(statement).toContain("last_used_step < ?");
    expect(statement).toContain("RETURNING id");
  });

  test("a losing UPDATE reports false rather than throwing", async () => {
    expect(
      await advanceLastUsedStep(recordingTx([]).tx, "f-1", 42, new Date())
    ).toBe(false);
  });

  test("a recovery code is spent under `used_at IS NULL`", async () => {
    const statement = await statementOf(
      (tx) => consumeRecoveryCode(tx, "human-1", "f-1", "hash", new Date()),
      [{ id: "rc-1" }]
    );

    expect(statement).toContain("used_at IS NULL");
    expect(statement).toContain("principal_id = ?");
    expect(statement).toContain("factor_id = ?");
  });

  test("the verify lock is a real row lock", async () => {
    const statement = await statementOf(
      (tx) => lockFactorForVerify(tx, "f-1"),
      [{ failed_verify_count: 0, locked_until: null }]
    );

    expect(statement).toContain("FOR UPDATE");
  });

  test("the failure counter increments in SQL, never read-modify-write", async () => {
    // ADR-0027 auditor HIGH-1 / F4: concurrent wrong-code verifies across
    // distinct challenges lost-update through a JS increment, so the factor
    // never reached the threshold and the lockout never bound.
    const statement = await statementOf((tx) =>
      recordFactorVerifyFailure(tx, "f-1", 5, new Date(), new Date())
    );

    expect(statement).toContain("failed_verify_count + 1 >= ?");
    expect(statement).not.toMatch(/failed_verify_count\s*=\s*\?/);
  });
});

describe("who ordered the disable is recorded on the row", () => {
  test("an administrative reset stamps the acting tenant", async () => {
    // The ONLY artefact that outlives the acting tenant's audit log and sits on
    // the side of the human who lost the factor. ADR-0087 keeps it because
    // FORCE RLS makes an audit row in the reached tenant impossible, and
    // enumerating those tenants would be a membership oracle.
    const { tx, statements, values } = recordingTx([{ id: "f-1" }]);

    await disableLiveFactors(tx, "human-1", new Date(), "tenant-a");

    expect(statements[0]).toContain("disabled_by_tenant_id = ?");
    expect(values[0]).toContain("tenant-a");
  });

  test("a self-service disable stamps NULL, not the tenant they happened to be in", async () => {
    const { tx, values } = recordingTx([{ id: "f-1" }]);

    await disableLiveFactors(tx, "human-1", new Date(), null);

    expect(values[0]).toContain(null);
    expect(values[0]).not.toContain("tenant-a");
  });

  test("it disables live factors only, and reports which", async () => {
    const { tx, statements } = recordingTx([{ id: "f-1" }, { id: "f-2" }]);

    const disabled = await disableLiveFactors(tx, "h-1", new Date(), null);

    expect(statements[0]).toContain("status IN ('active', 'pending')");
    expect(disabled).toEqual(["f-1", "f-2"]);
  });
});

describe("the ordinary writes stay keyed to the human they belong to", () => {
  test("enrolment discards a prior pending secret before inserting", async () => {
    const discard = await statementOf((tx) =>
      deletePendingFactors(tx, "human-1")
    );

    expect(discard).toContain("DELETE FROM awcms_principal_mfa_factors");
    expect(discard).toContain("principal_id = ?");
    expect(discard).toContain("status = 'pending'");

    const insert = await statementOf((tx) =>
      insertPendingFactor(tx, "human-1", "cipher", new Date())
    );

    expect(insert).toContain("'pending'");
  });

  test("activation seeds the replay guard with the confirming step", async () => {
    // Without it the very code just typed to enrol is still accepted by the
    // login path inside the same time window.
    const statement = await statementOf((tx) =>
      activateFactor(tx, "f-1", 77, new Date())
    );

    expect(statement).toContain("last_used_step = ?");
    expect(statement).toContain("status = 'active'");
    expect(statement).toContain("WHERE id = ?");
  });

  test("the pending read is keyed on the human", async () => {
    const statement = await statementOf(
      (tx) => findPendingFactor(tx, "human-1"),
      [{ id: "f-1", secret_ciphertext: "c" }]
    );

    expect(statement).toContain("principal_id = ?");
  });

  test("recovery codes are written per (principal, factor) and cleared both ways", async () => {
    const insert = await statementOf((tx) =>
      insertRecoveryCodeHash(tx, "human-1", "f-1", "hash")
    );

    expect(insert).toContain("(principal_id, factor_id, code_hash)");

    const byPrincipal = await statementOf((tx) =>
      deleteRecoveryCodesForPrincipal(tx, "human-1")
    );

    expect(byPrincipal).toContain("WHERE principal_id = ?");

    // `regenerate` replaces one factor's set; `disable` clears the human's. Two
    // functions rather than one with a flag, because the two callers mean
    // different things and a shared one would eventually clear too much.
    const byFactor = await statementOf((tx) =>
      deleteRecoveryCodesForFactor(tx, "f-1")
    );

    expect(byFactor).toContain("WHERE factor_id = ?");
  });

  test("a successful verify clears the cumulative lockout", async () => {
    const statement = await statementOf((tx) =>
      clearFactorFailures(tx, "f-1", new Date())
    );

    expect(statement).toContain("failed_verify_count = 0");
    expect(statement).toContain("locked_until = NULL");
  });
});
