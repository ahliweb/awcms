/**
 * Issue #1078 — the `security:readiness` gate that fails when a worker role can
 * read a credential column, and the static contracts that keep the central list,
 * the worker matrices and `sql/304` consistent.
 *
 * The database cases are gated on `DATABASE_URL` and INJECT policies (never
 * `mock.module`, which leaks across files) instead of touching grants.
 */
import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";
import path from "node:path";

import {
  CREDENTIAL_COLUMNS,
  CREDENTIAL_LOOKING_COLUMN_PATTERN,
  NON_CREDENTIAL_LOOKALIKES,
  WORKER_COLUMN_GRANTS,
  WORKER_CREDENTIAL_COLUMN_EXCEPTIONS,
  WORKER_JOB_ROLES,
  WORKER_ROLE_GRANTS,
  CREDENTIAL_CHECKED_ROLES,
  SETUP_COLUMN_GRANTS,
  SETUP_CREDENTIAL_COLUMN_EXCEPTIONS,
  SETUP_ROLE_GRANTS,
  DEFINER_OWNER_ROLES,
  checkDefinerOwnerRolesNoLogin,
  checkWorkerCredentialColumnsUnreadable
} from "../scripts/security-readiness";

const repoRoot = path.resolve(import.meta.dir, "..");
const migration = readFileSync(
  path.join(repoRoot, "sql/304_awcms_worker_credential_column_revoke.sql"),
  "utf8"
);
const statements = migration
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("credential column list (static)", () => {
  test("every entry is a well-formed awcms_ table.column, unique", () => {
    for (const qualified of CREDENTIAL_COLUMNS) {
      expect(qualified).toMatch(/^awcms_[a-z0-9_]+\.[a-z0-9_]+$/);
    }
    expect(new Set(CREDENTIAL_COLUMNS).size).toBe(CREDENTIAL_COLUMNS.length);
  });

  test("the headline columns are declared", () => {
    for (const column of [
      "awcms_identities.password_hash",
      "awcms_principals.password_hash",
      "awcms_sessions.token_hash",
      "awcms_identity_mfa_factors.secret_ciphertext",
      "awcms_identity_mfa_recovery_codes.code_hash",
      "awcms_auth_providers.client_secret_ciphertext",
      "awcms_machine_credentials.token_hash",
      "awcms_bff_clients.secret_hash"
    ]) {
      expect(CREDENTIAL_COLUMNS).toContain(column);
    }
  });

  test("no exception or lookalike is also declared a credential", () => {
    for (const qualified of [
      ...Object.keys(WORKER_CREDENTIAL_COLUMN_EXCEPTIONS),
      ...Object.keys(NON_CREDENTIAL_LOOKALIKES)
    ]) {
      expect(CREDENTIAL_COLUMNS).not.toContain(qualified);
    }
  });

  test("the wide name scan is declared and the OIDC/MFA/identifier secrets are credentials", () => {
    for (const column of [
      "awcms_oidc_auth_requests.code_verifier",
      "awcms_oidc_auth_requests.state_hash",
      "awcms_oidc_auth_requests.nonce",
      "awcms_principal_mfa_factors.enrollment_binding_hash",
      "awcms_comments_reply_subscriptions.subscriber_email_encrypted",
      "awcms_profile_identifiers.value_hash",
      "awcms_procurement_supplier_identifiers.value_hash"
    ]) {
      expect(CREDENTIAL_COLUMNS).toContain(column);
    }
    for (const name of [
      "reset_otp_hash",
      "totp_seed",
      "code_verifier",
      "pw_salt",
      "login_nonce",
      "x_ciphertext",
      "y_encrypted",
      "anything_hash"
    ]) {
      expect(CREDENTIAL_LOOKING_COLUMN_PATTERN.test(name), name).toBe(true);
    }
    expect(CREDENTIAL_LOOKING_COLUMN_PATTERN.test("display_name")).toBe(false);
    expect(CREDENTIAL_LOOKING_COLUMN_PATTERN.test("hash_key_id")).toBe(false);
  });

  test("telegram chat_ciphertext is a documented exception and every lookalike has a reason", () => {
    expect(
      WORKER_CREDENTIAL_COLUMN_EXCEPTIONS[
        "awcms_telegram_bindings.chat_ciphertext"
      ]
    ).toBeDefined();
    expect(
      NON_CREDENTIAL_LOOKALIKES["awcms_omes_worker_nonces.nonce"]
    ).toBeDefined();
    expect(
      NON_CREDENTIAL_LOOKALIKES["awcms_telegram_bindings.chat_hash"]
    ).toBeDefined();
    for (const reason of Object.values(NON_CREDENTIAL_LOOKALIKES)) {
      expect(reason.length).toBeGreaterThan(10);
    }
  });

  test("every exception carries a reason", () => {
    for (const reason of Object.values(WORKER_CREDENTIAL_COLUMN_EXCEPTIONS)) {
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  test("the name pattern matches every declared credential column", () => {
    for (const qualified of CREDENTIAL_COLUMNS) {
      expect(
        CREDENTIAL_LOOKING_COLUMN_PATTERN.test(qualified.split(".")[1]!)
      ).toBe(true);
    }
  });

  test("the worker job role list names awcms_worker", () => {
    expect(WORKER_JOB_ROLES).toContain("awcms_worker");
  });
});

describe("worker matrices never list a credential column (static)", () => {
  const credentialByTable = new Map<string, Set<string>>();
  for (const qualified of CREDENTIAL_COLUMNS) {
    const [table, column] = qualified.split(".") as [string, string];
    credentialByTable.set(
      table,
      (credentialByTable.get(table) ?? new Set()).add(column)
    );
  }

  test("no WORKER_COLUMN_GRANTS list (SELECT, INSERT or UPDATE) contains a credential column", () => {
    for (const [table, privileges] of Object.entries(WORKER_COLUMN_GRANTS)) {
      for (const [privilege, columns] of Object.entries(privileges)) {
        for (const column of columns ?? []) {
          if (privilege === "UPDATE" && column === "pin_hash") {
            // The one WRITE: sql/288 lets the worker NULL a PIN when it ends a
            // binding (a trigger refuses anything but NULL). Writing is not
            // reading, and the SELECT list below is what this test pins.
            continue;
          }
          expect(
            credentialByTable.get(table)?.has(column) ?? false,
            `${privilege} on ${table}.${column}`
          ).toBe(false);
        }
      }
    }
  });

  test("a table-wide SELECT in WORKER_ROLE_GRANTS never reaches a credential column", () => {
    for (const [table, verbs] of Object.entries(WORKER_ROLE_GRANTS)) {
      if (!verbs.includes("SELECT")) continue;
      expect(
        credentialByTable.has(table),
        `${table} holds a table-wide SELECT but contains credential column(s) ${[
          ...(credentialByTable.get(table) ?? [])
        ].join(", ")}`
      ).toBe(false);
    }
  });

  test("awcms_identities is column-only for the worker, with exactly the six named columns", () => {
    expect(WORKER_ROLE_GRANTS.awcms_identities).toBeUndefined();
    expect([...WORKER_COLUMN_GRANTS.awcms_identities!.SELECT!].sort()).toEqual(
      [
        "created_at",
        "id",
        "login_identifier",
        "profile_id",
        "status",
        "tenant_id"
      ].sort()
    );
  });
});

describe("sql/304 (static)", () => {
  test("revokes the table-wide SELECT from awcms_identities and re-grants a column list", () => {
    expect(statements).toContain(
      "REVOKE SELECT ON awcms_identities FROM awcms_worker;"
    );
    expect(statements).toMatch(
      /GRANT SELECT \(id, tenant_id, profile_id, status, login_identifier, created_at\)\s+ON awcms_identities TO awcms_worker;/
    );
  });

  test("no GRANT in the migration names a credential column", () => {
    const grants = [
      ...statements.matchAll(/GRANT\s+SELECT\s*\(([^)]*)\)\s+ON\s+(\w+)/g)
    ];

    expect(grants.length).toBeGreaterThanOrEqual(10);

    for (const grant of grants) {
      const table = grant[2]!;
      for (const column of grant[1]!.split(",").map((c) => c.trim())) {
        expect(CREDENTIAL_COLUMNS).not.toContain(`${table}.${column}`);
      }
    }
  });

  test("every column list in the migration equals the pinned WORKER_COLUMN_GRANTS list", () => {
    const grants = [
      ...statements.matchAll(
        /GRANT\s+SELECT\s*\(([^)]*)\)\s+ON\s+(\w+)\s+TO\s+awcms_worker;/g
      )
    ];

    for (const grant of grants) {
      const table = grant[2]!;
      const columns = grant[1]!
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)
        .sort();

      expect(columns, table).toEqual(
        [...(WORKER_COLUMN_GRANTS[table]?.SELECT ?? [])].sort()
      );
    }
  });

  test("every REVOKE is followed by a column GRANT for the same table (no table left unreadable)", () => {
    for (const revoke of statements.matchAll(
      /REVOKE\s+SELECT\s+ON\s+(\w+)\s+FROM\s+awcms_worker;/g
    )) {
      expect(statements).toMatch(
        new RegExp(
          String.raw`GRANT\s+SELECT\s*\([^)]*\)\s+ON\s+${revoke[1]}\s+TO\s+awcms_worker;`
        )
      );
    }
  });

  test("the header names a job for the identity columns", () => {
    for (const job of [
      "workflow:escalations:dispatch",
      "reporting:projections:refresh",
      "data-lifecycle:archive-purge"
    ]) {
      expect(migration).toContain(job);
    }
  });
});

const describeOrSkip = process.env.DATABASE_URL ? describe : describe.skip;

describeOrSkip("checkWorkerCredentialColumnsUnreadable (database)", () => {
  test("the real list PASSES on a migrated database", async () => {
    const result = await checkWorkerCredentialColumnsUnreadable();

    expect(result.severity).toBe("critical");
    expect(result.status).toBe("pass");
  });

  test("declaring a column the worker CAN read as a credential FAILS (the check asks the database)", async () => {
    const result = await checkWorkerCredentialColumnsUnreadable({
      credentialColumns: [
        ...CREDENTIAL_COLUMNS,
        // The worker legitimately reads this column today; calling it a
        // credential must therefore be a finding.
        "awcms_identities.login_identifier"
      ]
    });

    // Only meaningful where awcms_worker exists; otherwise the check passes by
    // the opt-in design.
    if (result.status === "pass") {
      expect(result.evidence).toContain("not provisioned");

      return;
    }
    expect(result.evidence).toContain(
      "awcms_worker can SELECT awcms_identities.login_identifier"
    );
  });

  test("an undeclared credential-looking column FAILS until classified", async () => {
    const result = await checkWorkerCredentialColumnsUnreadable({
      // Forget a real credential column: the name scan must catch it.
      credentialColumns: CREDENTIAL_COLUMNS.filter(
        (column) => column !== "awcms_identities.password_hash"
      )
    });

    expect(result.status).toBe("fail");
    expect(result.evidence).toContain(
      "awcms_identities.password_hash looks like a credential column"
    );
  });

  test("a stale entry (a column that does not exist) FAILS", async () => {
    const result = await checkWorkerCredentialColumnsUnreadable({
      credentialColumns: [
        ...CREDENTIAL_COLUMNS,
        "awcms_identities.no_such_hash"
      ]
    });

    expect(result.status).toBe("fail");
    expect(result.evidence).toContain(
      "awcms_identities.no_such_hash is listed in CREDENTIAL_COLUMNS but does not exist"
    );
  });

  test("removing a documented exception makes the column a finding", async () => {
    const result = await checkWorkerCredentialColumnsUnreadable({
      exceptions: {}
    });

    expect(result.status).toBe("fail");
    expect(result.evidence).toContain("awcms_push_subscriptions.auth_secret");
  });
});

describeOrSkip(
  "mutation: a new credential-shaped column is caught (database)",
  () => {
    const TABLE = "awcms_zz1078_probe";

    async function withProbeTable(
      columns: string[],
      run: () => Promise<void>
    ): Promise<void> {
      const admin = new Bun.SQL(process.env.DATABASE_URL!, { max: 1 });

      try {
        await admin.unsafe(`DROP TABLE IF EXISTS ${TABLE}`);
        await admin.unsafe(
          `CREATE TABLE ${TABLE} (id int, ${columns.map((c) => `${c} text`).join(", ")})`
        );
        const role = (await admin`
        SELECT 1 AS present FROM pg_roles WHERE rolname = 'awcms_worker'
      `) as unknown[];
        if (role.length > 0) {
          await admin.unsafe(`GRANT SELECT ON ${TABLE} TO awcms_worker`);
        }
        await run();
      } finally {
        await admin.unsafe(`DROP TABLE IF EXISTS ${TABLE}`);
        await admin.close({ timeout: 1 });
      }
    }

    for (const column of ["reset_otp_hash", "totp_seed", "code_verifier"]) {
      test(`an unclassified ${column} fails the gate`, async () => {
        await withProbeTable([column], async () => {
          const result = await checkWorkerCredentialColumnsUnreadable();

          expect(result.status).toBe("fail");
          expect(result.evidence).toContain(
            `${TABLE}.${column} looks like a credential column`
          );
        });
      });
    }

    test("declared as a credential, a column the worker can read FAILS; classified as a lookalike it passes", async () => {
      await withProbeTable(["reset_otp_hash"], async () => {
        const declared = await checkWorkerCredentialColumnsUnreadable({
          credentialColumns: [...CREDENTIAL_COLUMNS, `${TABLE}.reset_otp_hash`]
        });
        const workerExists = declared.evidence.includes(
          "awcms_worker can SELECT"
        );

        if (workerExists) {
          expect(declared.status).toBe("fail");
          expect(declared.evidence).toContain(
            `awcms_worker can SELECT ${TABLE}.reset_otp_hash`
          );
        }

        const classified = await checkWorkerCredentialColumnsUnreadable({
          lookalikes: {
            ...NON_CREDENTIAL_LOOKALIKES,
            [`${TABLE}.reset_otp_hash`]: "test-only classification"
          }
        });

        expect(classified.status).toBe("pass");
      });
    });
  }
);

describe("awcms_setup is covered by the credential check (static, Issue #1082)", () => {
  const setupMigration = readFileSync(
    path.join(
      repoRoot,
      "sql/310_awcms_setup_role_credential_column_revoke.sql"
    ),
    "utf8"
  )
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

  test("the checked roles are the worker job roles plus awcms_setup", () => {
    expect(CREDENTIAL_CHECKED_ROLES).toEqual([
      ...WORKER_JOB_ROLES,
      "awcms_setup"
    ]);
  });

  test("the setup role has NO credential-column exception", () => {
    expect(Object.keys(SETUP_CREDENTIAL_COLUMN_EXCEPTIONS)).toEqual([]);
  });

  test("the setup matrix holds no table-level SELECT on identities, and no pinned column is a credential", () => {
    expect(SETUP_ROLE_GRANTS.awcms_identities).toEqual(["INSERT"]);
    expect(SETUP_ROLE_GRANTS.awcms_principals).toBeUndefined();

    for (const [table, privileges] of Object.entries(SETUP_COLUMN_GRANTS)) {
      for (const [privilege, columns] of Object.entries(privileges)) {
        for (const column of columns ?? []) {
          // INSERT of a credential is a write, not a read; none is pinned today.
          expect(
            CREDENTIAL_COLUMNS,
            `${privilege} ${table}.${column}`
          ).not.toContain(`${table}.${column}`);
        }
      }
    }
  });

  test("sql/310 revokes the table SELECT and re-grants by column", () => {
    expect(setupMigration).toContain(
      "REVOKE SELECT ON awcms_identities FROM awcms_setup;"
    );
    expect(setupMigration).toContain(
      "GRANT SELECT (id, principal_id) ON awcms_identities TO awcms_setup;"
    );
    expect(setupMigration).not.toMatch(/GRANT[^;]*password_hash/);
    expect(setupMigration).not.toMatch(
      /GRANT[^;]*ON awcms_principals TO awcms_setup/
    );
    expect(setupMigration).toContain("AS RESTRICTIVE");
    expect(setupMigration).toContain("WITH CHECK (principal_id IS NOT NULL)");
    expect(setupMigration).toContain("awcms_identities_principal_link_once");
    expect(setupMigration).toContain("SECURITY DEFINER");
    expect(setupMigration).not.toMatch(/GRANT SELECT ON awcms_/);
  });
});

describeOrSkip(
  "awcms_setup credential exposure (database, Issue #1082)",
  () => {
    async function setupExists(): Promise<boolean> {
      const admin = new Bun.SQL(process.env.DATABASE_URL!, { max: 1 });

      try {
        const rows = (await admin`
        SELECT 1 AS present FROM pg_roles WHERE rolname = 'awcms_setup'
      `) as unknown[];

        return rows.length > 0;
      } finally {
        await admin.close({ timeout: 1 });
      }
    }

    test("a credential column readable by awcms_setup FAILS the gate", async () => {
      expect(await setupExists(), "awcms_setup must exist (sql/022)").toBe(
        true
      );

      const admin = new Bun.SQL(process.env.DATABASE_URL!, { max: 1 });

      try {
        await admin.unsafe(
          "GRANT SELECT (password_hash) ON awcms_principals TO awcms_setup"
        );
        const result = await checkWorkerCredentialColumnsUnreadable();

        expect(result.status).toBe("fail");
        expect(result.evidence).toContain(
          "awcms_setup can SELECT awcms_principals.password_hash"
        );
      } finally {
        await admin.unsafe(
          "REVOKE SELECT (password_hash) ON awcms_principals FROM awcms_setup"
        );
        await admin.close({ timeout: 1 });
      }

      expect((await checkWorkerCredentialColumnsUnreadable()).status).toBe(
        "pass"
      );
    });

    test("the worker exceptions do not extend to awcms_setup", async () => {
      expect(await setupExists(), "awcms_setup must exist (sql/022)").toBe(
        true
      );

      const admin = new Bun.SQL(process.env.DATABASE_URL!, { max: 1 });

      try {
        await admin.unsafe(
          "GRANT SELECT (auth_secret) ON awcms_push_subscriptions TO awcms_setup"
        );
        const result = await checkWorkerCredentialColumnsUnreadable();

        expect(result.status).toBe("fail");
        expect(result.evidence).toContain(
          "awcms_setup can SELECT awcms_push_subscriptions.auth_secret"
        );
      } finally {
        await admin.unsafe(
          "REVOKE SELECT (auth_secret) ON awcms_push_subscriptions FROM awcms_setup"
        );
        await admin.close({ timeout: 1 });
      }
    });
  }
);

describeOrSkip("checkDefinerOwnerRolesNoLogin (database)", () => {
  const LOGIN_ROLE = "awcms_zz1078_login";
  const MEMBER_PARENT = "awcms_zz1078_parent";
  const MEMBER_CHILD = "awcms_zz1078_child";

  async function withRoles(run: () => Promise<void>): Promise<void> {
    const admin = new Bun.SQL(process.env.DATABASE_URL!, { max: 1 });
    const drop = async () => {
      for (const role of [LOGIN_ROLE, MEMBER_CHILD, MEMBER_PARENT]) {
        await admin.unsafe(`DROP ROLE IF EXISTS ${role}`);
      }
    };

    try {
      await drop();
      await admin.unsafe(`CREATE ROLE ${LOGIN_ROLE} LOGIN`);
      await admin.unsafe(`CREATE ROLE ${MEMBER_PARENT} NOLOGIN`);
      await admin.unsafe(`CREATE ROLE ${MEMBER_CHILD} NOLOGIN`);
      await admin.unsafe(`GRANT ${MEMBER_PARENT} TO ${MEMBER_CHILD}`);
      await run();
    } finally {
      await drop();
      await admin.close({ timeout: 1 });
    }
  }

  test("the real documented owners PASS on a migrated database", async () => {
    const result = await checkDefinerOwnerRolesNoLogin();

    expect(result.severity).toBe("critical");
    expect(result.status).toBe("pass");
  });

  test("a documented owner that can log in FAILS", async () => {
    await withRoles(async () => {
      const result = await checkDefinerOwnerRolesNoLogin([
        ...DEFINER_OWNER_ROLES,
        LOGIN_ROLE
      ]);

      expect(result.status).toBe("fail");
      expect(result.evidence).toContain(`${LOGIN_ROLE} can LOG IN`);
    });
  });

  test("a documented owner that has a member FAILS", async () => {
    await withRoles(async () => {
      const result = await checkDefinerOwnerRolesNoLogin([MEMBER_PARENT]);

      expect(result.status).toBe("fail");
      expect(result.evidence).toContain(`${MEMBER_PARENT} has 1 member(s)`);
    });
  });
});
