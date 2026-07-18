/**
 * Real-PostgreSQL tests for the two `security:readiness` checks Issue #142
 * exists for: `checkRlsEnabled` and `checkAppDbUserNotSuperuser`.
 *
 * These CANNOT be written against a fake `Bun.SQL`. The whole bug class is a
 * property of PostgreSQL itself — `relrowsecurity` without
 * `relforcerowsecurity` means the table OWNER silently bypasses every policy
 * — so a stubbed driver would only prove that a stub returns what the stub
 * was told to return. That is exactly how 23 tables shipped with inert RLS
 * across migrations 002-008/010-012 while every check stayed green.
 *
 * Requires a throwaway database whose schema has had `sql/` applied
 * (`bun run db:migrate`). Gated on `DATABASE_URL` — the same convention
 * `workflow-approval-concurrency.test.ts` uses. `ci.yml`'s `quality` job has
 * no database so it skips cleanly; this actually executes in `ci.yml`'s
 * `integration-tests` job and `release.yml`'s `validate` job, each in a
 * dedicated `bun test <legacy files>` step run separately from the
 * harness-based `tests/integration/` suite (see `tests/integration/
 * harness.ts` — the two collide if run together in one `bun test` process).
 * Gating on a bespoke variable instead would mean the suite never runs in any
 * pipeline.
 *
 * The suite only creates its own probe table and drops it again afterwards.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  checkAppDbUserNotSuperuser,
  checkLeastPrivilegeRoleProvisioned,
  checkRlsEnabled,
  checkRuntimeRoleGrants
} from "../scripts/security-readiness";

const DATABASE_URL = process.env.DATABASE_URL;
const describeOrSkip = DATABASE_URL ? describe : describe.skip;

/** Matches `awcms\_%`, is not in `RLS_FREE_TABLES` — so the check must treat it as tenant-scoped and demand FORCE. */
const PROBE_TABLE = "awcms_security_readiness_probe_inert_rls";

describeOrSkip("security:readiness RLS checks (real PostgreSQL)", () => {
  let sql: Bun.SQL;

  beforeAll(async () => {
    sql = new Bun.SQL(DATABASE_URL!, { max: 2 });
    await sql.unsafe(`DROP TABLE IF EXISTS ${PROBE_TABLE}`);
  });

  afterAll(async () => {
    await sql.unsafe(`DROP TABLE IF EXISTS ${PROBE_TABLE}`);
    await sql.close({ timeout: 1 });
  });

  test("catches a tenant-scoped table with ENABLE but no FORCE", async () => {
    // The exact shape of the 002-008/010-012 bug: a correctly-written
    // tenant isolation policy that is never evaluated for the table owner.
    await sql.unsafe(`
      CREATE TABLE ${PROBE_TABLE} (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        note text
      )
    `);
    await sql.unsafe(`ALTER TABLE ${PROBE_TABLE} ENABLE ROW LEVEL SECURITY`);
    await sql.unsafe(`
      CREATE POLICY ${PROBE_TABLE}_tenant_isolation ON ${PROBE_TABLE}
        USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    `);

    const flags = (await sql.unsafe(`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relname = '${PROBE_TABLE}'
    `)) as { relrowsecurity: boolean; relforcerowsecurity: boolean }[];

    // Guard the guard: if this ever stops being ENABLE-without-FORCE, the
    // assertion below would pass for the wrong reason.
    expect(flags[0]).toEqual({
      relrowsecurity: true,
      relforcerowsecurity: false
    });

    const result = await checkRlsEnabled();

    expect(result.status).toBe("fail");
    expect(result.severity).toBe("critical");
    expect(result.evidence).toContain(PROBE_TABLE);
    expect(result.evidence).toContain("force=false");
  });

  test("stops flagging the table once FORCE is applied", async () => {
    await sql.unsafe(`ALTER TABLE ${PROBE_TABLE} FORCE ROW LEVEL SECURITY`);

    const result = await checkRlsEnabled();

    // Deliberately not asserting `status === "pass"` for the whole database:
    // that would couple this test to every other table in whatever schema
    // the run happens to target. The claim under test is narrower and
    // exact — this table is no longer a finding.
    expect(result.evidence).not.toContain(`${PROBE_TABLE}(`);
  });

  test("the tenant-scoped/RLS-free split covers every awcms_ table", async () => {
    await sql.unsafe(`DROP TABLE IF EXISTS ${PROBE_TABLE}`);

    const result = await checkRlsEnabled();

    // On a correctly-migrated database with no probe table present, every
    // awcms_ table is either documented RLS-free or fully enforced. This is
    // the regression that would fire if a future migration adds a
    // tenant-scoped table with ENABLE but no FORCE — i.e. the entire point
    // of Issue #142.
    expect(result.status).toBe("pass");
    expect(result.evidence).toContain("relforcerowsecurity=true");
  });

  test("connection role check matches the real pg_roles state", async () => {
    const rows = (await sql`
      SELECT rolname, rolsuper, rolbypassrls
      FROM pg_roles WHERE rolname = current_user
    `) as { rolname: string; rolsuper: boolean; rolbypassrls: boolean }[];
    const role = rows[0]!;
    const bypasses = role.rolsuper || role.rolbypassrls;

    const result = await checkAppDbUserNotSuperuser();

    // The expectation is derived from the database, not hardcoded: a CI
    // service container usually connects as a superuser (must FAIL — that
    // is the finding), a properly provisioned deployment does not (must
    // PASS). Both directions are asserted by the same test wherever it runs.
    expect(result.severity).toBe("critical");
    expect(result.status).toBe(bypasses ? "fail" : "pass");

    if (bypasses) {
      expect(result.evidence).toContain("bypasses RLS entirely");
    }
  });

  test("least-privilege role check is non-blocking either way", async () => {
    const result = await checkLeastPrivilegeRoleProvisioned();

    // Whether `awcms_app` exists depends on whether this database has had
    // sql/019 (Issue #141) applied. Both states are legitimate, so the
    // severity must stay `warning` — a `critical` here would block go-live
    // on an un-migrated database.
    expect(result.severity).toBe("warning");
    expect(["pass", "fail"]).toContain(result.status);
  });
});

/**
 * Issue #160 — real-PostgreSQL tests for `checkRuntimeRoleGrants`, the grant
 * check that closes the gap `checkRlsEnabled` structurally cannot see: a
 * table's RLS FLAGS say nothing about whether `awcms_app` can actually reach
 * it. This is a property of PostgreSQL's grant system (`has_table_privilege`,
 * `ALTER DEFAULT PRIVILEGES` being executing-role-bound), so a stubbed driver
 * would prove nothing — same reasoning as the RLS suite above.
 */
describeOrSkip(
  "security:readiness runtime-role grant check (real PostgreSQL)",
  () => {
    let sql: Bun.SQL;

    beforeAll(async () => {
      sql = new Bun.SQL(DATABASE_URL!, { max: 2 });
    });

    afterAll(async () => {
      await sql.close({ timeout: 1 });
    });

    async function awcmsAppExists(): Promise<boolean> {
      const rows = (await sql`
      SELECT 1 AS present FROM pg_roles WHERE rolname = 'awcms_app'
    `) as { present: number }[];
      return rows.length > 0;
    }

    async function connectionIsSuperuser(): Promise<boolean> {
      const rows = (await sql`
      SELECT rolsuper FROM pg_roles WHERE rolname = current_user
    `) as { rolsuper: boolean }[];
      return rows[0]?.rolsuper === true;
    }

    test("passes on a correctly-narrowed, fully-migrated database", async () => {
      if (!(await awcmsAppExists())) {
        // Pre-sql/019 database: the check is non-blocking by design. Its own
        // unit-level "role absent -> pass" path is asserted separately; here we
        // only guard against a false failure when the role is simply not present.
        const result = await checkRuntimeRoleGrants();
        expect(result.severity).toBe("critical");
        expect(result.status).toBe("pass");
        return;
      }

      // Independently derive the two halves of the expectation from the database,
      // NOT from the check under test: sql/021 must have removed the residual
      // writes, and the tenant root must still be reachable for the writes real
      // code paths use. This proves the migration actually took effect AND that
      // the check agrees with reality.
      const probes = (await sql`
      SELECT
        has_table_privilege('awcms_app', 'awcms_tenants', 'DELETE') AS tenants_delete,
        has_table_privilege('awcms_app', 'awcms_permissions', 'INSERT') AS perms_insert,
        has_table_privilege('awcms_app', 'awcms_schema_migrations', 'DELETE') AS migrations_delete,
        has_table_privilege('awcms_app', 'awcms_tenants', 'INSERT') AS tenants_insert,
        has_table_privilege('awcms_app', 'awcms_tenants', 'UPDATE') AS tenants_update
    `) as {
        tenants_delete: boolean;
        perms_insert: boolean;
        migrations_delete: boolean;
        tenants_insert: boolean;
        tenants_update: boolean;
      }[];
      const p = probes[0]!;

      // The residual #160 closes.
      expect(p.tenants_delete).toBe(false);
      expect(p.perms_insert).toBe(false);
      expect(p.migrations_delete).toBe(false);
      // The grants the setup fallback + tenant-settings screen depend on.
      expect(p.tenants_insert).toBe(true);
      expect(p.tenants_update).toBe(true);

      const result = await checkRuntimeRoleGrants();
      expect(result.severity).toBe("critical");
      expect(result.status).toBe("pass");
    });

    test("flags a tenant-scoped table that is RLS-forced but ungranted", async () => {
      if (!(await awcmsAppExists()) || !(await connectionIsSuperuser())) {
        // The setup needs to CREATE a table owned by a DIFFERENT role than the
        // one `ALTER DEFAULT PRIVILEGES` is bound to (the exact bug: a db:migrate
        // under a second superuser). That requires superuser + the role present.
        // Where either is missing (e.g. connected as awcms_app itself), skip
        // rather than assert a scenario we cannot construct.
        return;
      }

      const probeTable = "awcms_grant_probe_ungranted_owner";
      const probeOwner = "awcms_grant_probe_owner_role";

      try {
        await sql.unsafe(`DROP TABLE IF EXISTS ${probeTable}`);
        await sql.unsafe(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${probeOwner}') THEN
            CREATE ROLE ${probeOwner} NOLOGIN;
          END IF;
        END $$;
      `);
        await sql.unsafe(`GRANT CREATE ON SCHEMA public TO ${probeOwner}`);
        // Create the table AS the probe owner so the migration owner's default
        // privileges do NOT fire — awcms_app ends up with zero grant on it, i.e.
        // RLS-forced-but-ungranted once RLS is enforced.
        await sql.unsafe(`SET ROLE ${probeOwner}`);
        await sql.unsafe(`
        CREATE TABLE ${probeTable} (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id uuid NOT NULL
        )
      `);
        await sql.unsafe(`RESET ROLE`);
        await sql.unsafe(`ALTER TABLE ${probeTable} ENABLE ROW LEVEL SECURITY`);
        await sql.unsafe(`ALTER TABLE ${probeTable} FORCE ROW LEVEL SECURITY`);

        // Guard the guard: awcms_app really holds no privilege on the probe.
        const priv = (await sql.unsafe(`
        SELECT has_table_privilege('awcms_app', '${probeTable}', 'SELECT') AS sel
      `)) as { sel: boolean }[];
        expect(priv[0]?.sel).toBe(false);

        const result = await checkRuntimeRoleGrants();

        expect(result.severity).toBe("critical");
        expect(result.status).toBe("fail");
        expect(result.evidence).toContain(probeTable);
        expect(result.evidence).toContain("permission denied");
      } finally {
        await sql.unsafe(`RESET ROLE`);
        await sql.unsafe(`DROP TABLE IF EXISTS ${probeTable}`);
        await sql.unsafe(`REVOKE CREATE ON SCHEMA public FROM ${probeOwner}`);
        await sql.unsafe(`DROP ROLE IF EXISTS ${probeOwner}`);
      }
    });
  }
);
