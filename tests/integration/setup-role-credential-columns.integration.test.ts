/**
 * Issue #1082 — `awcms_setup` cannot read a credential column, and the setup
 * wizard still works as that role.
 *
 * `sql/022` gave the setup role a TABLE-level `SELECT` on `awcms_identities`,
 * which included `password_hash`. `sql/310` narrows it to the columns the
 * bootstrap actually reads. This runs the REAL `bootstrapPlatformTenant`
 * (the body of `POST /api/v1/setup/initialize`) as `awcms_setup` against a real
 * PostgreSQL: if a grant the wizard needs were removed it fails with 42501 here
 * instead of in a customer's first-run install.
 *
 * Failures are asserted with `assertRejected` (try/catch). Never rewrite them as
 * `expect(sqlQuery).rejects`: against a `Bun.SQL` promise that HANGS the process.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import {
  assertRejected,
  getAdminSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { bootstrapPlatformTenant } from "../../src/modules/tenant-admin/application/platform-bootstrap";
import { CREDENTIAL_COLUMNS } from "../../scripts/security-readiness";

const suite = integrationEnabled ? describe : describe.skip;

const INPUT = {
  tenantCode: "t-1082",
  tenantName: "Setup role",
  officeCode: "HQ",
  officeName: "Head office",
  ownerLoginIdentifier: "owner-1082@example.com",
  ownerPassword: "correct horse battery staple",
  ownerDisplayName: "Owner"
};

/**
 * `awcms_setup` is created by `sql/022`, which every database has. A missing role
 * is a broken environment, so these tests FAIL on it instead of passing vacuously.
 */
async function requireSetupRole(): Promise<void> {
  const rows = (await getAdminSql()`
    SELECT 1 AS present FROM pg_roles WHERE rolname = 'awcms_setup'
  `) as unknown[];

  expect(rows.length, "awcms_setup role must exist (sql/022)").toBe(1);
}

const TENANT = "a1082000-0000-4000-8000-00000000000a";

async function seedIdentity(
  linkedTo: string | null
): Promise<{ identityId: string }> {
  await getAdminSql()`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT}, 't-1082-link', 'Link once')
  `;
  const profile = (await getAdminSql()`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT}, 'person', 'Victim') RETURNING id
  `) as { id: string }[];
  const identity = (await getAdminSql()`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${TENANT}, ${profile[0]!.id}, 'victim@example.com', 'x')
    RETURNING id
  `) as { id: string }[];

  if (linkedTo) {
    await getAdminSql()`
      UPDATE awcms_identities SET principal_id = ${linkedTo}
      WHERE id = ${identity[0]!.id}
    `;
  }

  return { identityId: identity[0]!.id };
}

async function seedPrincipal(email: string): Promise<string> {
  const rows = (await getAdminSql()`
    INSERT INTO awcms_principals (email_normalized) VALUES (${email}) RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

async function principalOf(identityId: string): Promise<string | null> {
  const rows = (await getAdminSql()`
    SELECT principal_id FROM awcms_identities WHERE id = ${identityId}
  `) as { principal_id: string | null }[];

  return rows[0]!.principal_id;
}

function asSetup<T>(fn: (tx: Bun.TransactionSQL) => Promise<T>): Promise<T> {
  return getAdminSql().begin(async (tx) => {
    await tx.unsafe("SET LOCAL ROLE awcms_setup");
    await tx.unsafe(
      `SELECT set_config('app.current_tenant_id', '${TENANT}', true)`
    );

    return fn(tx);
  }) as Promise<T>;
}

suite("awcms_setup credential column access (#1082)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  test("the setup wizard bootstrap runs end to end as awcms_setup", async () => {
    await requireSetupRole();

    const result = await getAdminSql().begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE awcms_setup");

      return bootstrapPlatformTenant(tx, INPUT);
    });

    expect(result.outcome).toBe("initialized");

    const rows = (await getAdminSql()`
      SELECT password_hash, principal_id FROM awcms_identities
      WHERE login_identifier = ${INPUT.ownerLoginIdentifier}
    `) as { password_hash: string; principal_id: string | null }[];
    expect(rows.length).toBe(1);
    expect(rows[0]!.password_hash.length).toBeGreaterThan(20);
    expect(rows[0]!.principal_id).not.toBeNull();
  });

  test("SELECT password_hash / SELECT * on awcms_identities is refused with 42501", async () => {
    await requireSetupRole();

    for (const statement of [
      "SELECT password_hash FROM awcms_identities",
      "SELECT * FROM awcms_identities",
      "SELECT count(*) FROM awcms_identities WHERE password_hash = 'x'",
      "SELECT failed_login_count, locked_until FROM awcms_identities"
    ]) {
      const error = await assertRejected(
        (async () =>
          getAdminSql().begin(async (tx) => {
            await tx.unsafe("SET LOCAL ROLE awcms_setup");
            await tx.unsafe(
              "SELECT set_config('app.current_tenant_id', '00000000-0000-4000-8000-000000000001', true)"
            );
            return tx.unsafe(statement);
          }))(),
        statement
      );

      expect(
        `${(error as { errno?: string }).errno} ${error.message}`
      ).toStartWith("42501");
    }
  });

  test("no declared credential column is readable by awcms_setup", async () => {
    await requireSetupRole();

    for (const qualified of CREDENTIAL_COLUMNS) {
      const [table, column] = qualified.split(".") as [string, string];
      const rows = (await getAdminSql()`
        SELECT has_column_privilege('awcms_setup', ${table}, ${column}, 'SELECT') AS readable
      `) as { readable: boolean }[];

      expect(rows[0]!.readable, `${qualified} readable by awcms_setup`).toBe(
        false
      );
    }
  });

  test("awcms_setup holds no direct privilege on awcms_principals", async () => {
    await requireSetupRole();

    for (const column of ["id", "email_normalized", "password_hash"]) {
      for (const privilege of ["SELECT", "INSERT", "UPDATE"]) {
        const rows = (await getAdminSql()`
          SELECT has_column_privilege('awcms_setup', 'awcms_principals', ${column}, ${privilege}) AS held
        `) as { held: boolean }[];

        expect(rows[0]!.held, `${privilege} ${column}`).toBe(false);
      }
    }
  });

  test("the first link works for awcms_setup", async () => {
    await requireSetupRole();
    const principal = await seedPrincipal("attacker@example.com");
    const { identityId } = await seedIdentity(null);

    const updated = await asSetup(
      (tx) => tx`
        UPDATE awcms_identities SET principal_id = ${principal}
        WHERE id = ${identityId} AND principal_id IS NULL
        RETURNING id
      `
    );

    expect(updated.length).toBe(1);
    expect(await principalOf(identityId)).toBe(principal);
  });

  test("awcms_setup cannot repoint an already-linked identity (account takeover)", async () => {
    await requireSetupRole();
    const victim = await seedPrincipal("victim@example.com");
    const attacker = await seedPrincipal("attacker@example.com");
    const { identityId } = await seedIdentity(victim);

    // Even with the WHERE clause dropped, the restrictive policy hides the row.
    const updated = await asSetup(
      (tx) => tx`
        UPDATE awcms_identities SET principal_id = ${attacker}
        WHERE id = ${identityId} RETURNING id
      `
    );
    expect(updated.length).toBe(0);
    expect(await principalOf(identityId)).toBe(victim);

    // Unlinking is refused too (the policy hides the row; nothing changes).
    const unlinked = await asSetup(
      (tx) => tx`
        UPDATE awcms_identities SET principal_id = NULL
        WHERE id = ${identityId} RETURNING id
      `
    );
    expect(unlinked.length).toBe(0);
    expect(await principalOf(identityId)).toBe(victim);
  });

  test("no role can repoint or unlink a linked identity (trigger, owner path)", async () => {
    await requireSetupRole();
    const victim = await seedPrincipal("victim@example.com");
    const attacker = await seedPrincipal("attacker@example.com");
    const { identityId } = await seedIdentity(victim);

    for (const value of [attacker, null]) {
      const error = await assertRejected(
        (async () =>
          getAdminSql()`
            UPDATE awcms_identities SET principal_id = ${value}
            WHERE id = ${identityId}
          `)(),
        "repoint as the table owner"
      );

      expect((error as { errno?: string }).errno).toBe("23000");
    }
    expect(await principalOf(identityId)).toBe(victim);

    // Re-writing the same value is a no-op, not an error.
    await getAdminSql()`
      UPDATE awcms_identities SET principal_id = ${victim} WHERE id = ${identityId}
    `;
  });

  test("awcms_ensure_principal_id is find-or-create and returns only an id", async () => {
    await requireSetupRole();

    const first = await asSetup(
      (tx) => tx`SELECT awcms_ensure_principal_id('new@example.com') AS id`
    );
    const second = await asSetup(
      (tx) => tx`SELECT awcms_ensure_principal_id('new@example.com') AS id`
    );

    expect(first[0]!.id).toBe(second[0]!.id);
    const rows = (await getAdminSql()`
      SELECT count(*)::int AS n FROM awcms_principals WHERE email_normalized = 'new@example.com'
    `) as { n: number }[];
    expect(rows[0]!.n).toBe(1);
  });
});
