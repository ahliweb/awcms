/**
 * Issue #163 — real-PostgreSQL test that `checkWorkerSetupRoleGrants` verifies
 * the opt-in `awcms_worker`/`awcms_setup` roles hold EXACTLY their
 * least-privilege matrix, and fails in BOTH directions (under-grant ->
 * permission denied at runtime; over-grant -> isolation breach).
 *
 * Gated on `DATABASE_URL`, same convention as
 * `security-readiness-failclosed.test.ts`: `ci.yml`'s `quality` job has no
 * database so it skips cleanly; this actually executes in `ci.yml`'s
 * `integration-tests` job and `release.yml`'s `validate` job (both apply
 * `sql/022`, creating both roles, before this suite's dedicated
 * `bun test <legacy files>` step — run separately from the harness-based
 * `tests/integration/` suite; see `tests/integration/harness.ts` for why the
 * two collide if run together).
 *
 * The divergence cases INJECT a policy (not `mock.module`, which leaks across
 * files — PR #157) rather than mutating any grant: the real roles' grants are
 * never touched, so this test is safe to run against a shared cluster.
 */
import { describe, expect, test } from "bun:test";

import {
  SETUP_COLUMN_GRANTS,
  WORKER_COLUMN_GRANTS,
  checkWorkerSetupRoleGrants,
  defaultWorkerSetupRoleGrantsPolicy
} from "../scripts/security-readiness";

const DATABASE_URL = process.env.DATABASE_URL;
const describeOrSkip = DATABASE_URL ? describe : describe.skip;

describeOrSkip(
  "security:readiness worker/setup grant check (Issue #163)",
  () => {
    async function awcmsWorkerExists(): Promise<boolean> {
      const sql = new Bun.SQL(DATABASE_URL!, { max: 1 });
      try {
        const rows = (await sql`
          SELECT 1 AS present FROM pg_roles WHERE rolname = 'awcms_worker'
        `) as { present: number }[];
        return rows.length > 0;
      } finally {
        await sql.close({ timeout: 1 });
      }
    }

    test("the real least-privilege matrix PASSES (roles present or on the fallback)", async () => {
      const result = await checkWorkerSetupRoleGrants();

      expect(result.severity).toBe("critical");
      // Either the roles exist and hold exactly their matrix (migrated onto
      // sql/022), or they are absent and the check is non-blocking-pass by the
      // opt-in design. Neither is a critical failure.
      expect(result.status).toBe("pass");
    });

    test("a COLUMN grant wider than the pinned list FAILS (audit M2 of #1044)", async () => {
      if (!(await awcmsWorkerExists())) {
        return;
      }

      // Pin one column fewer than the role really holds: the extra column is a
      // column-only grant the table-level matrix cannot see.
      const base = defaultWorkerSetupRoleGrantsPolicy();
      const narrowed = structuredClone(WORKER_COLUMN_GRANTS);
      narrowed.awcms_email_messages!.INSERT =
        narrowed.awcms_email_messages!.INSERT!.filter(
          (column) => column !== "subject"
        );
      const result = await checkWorkerSetupRoleGrants({
        ...base,
        workerColumns: narrowed
      });

      expect(result.status).toBe("fail");
      expect(result.evidence).toContain("column grant over-granted");
      expect(result.evidence).toContain(
        "INSERT on awcms_email_messages(subject)"
      );
    });

    test("awcms_setup column grants are pinned in both directions (Issue #1082)", async () => {
      const sql = new Bun.SQL(DATABASE_URL!, { max: 1 });
      try {
        const rows = (await sql`
          SELECT 1 AS present FROM pg_roles WHERE rolname = 'awcms_setup'
        `) as unknown[];
        if (rows.length === 0) return;
      } finally {
        await sql.close({ timeout: 1 });
      }

      const base = defaultWorkerSetupRoleGrantsPolicy();
      const real = await checkWorkerSetupRoleGrants(base);
      expect(real.status).toBe("pass");

      const narrowed = structuredClone(SETUP_COLUMN_GRANTS);
      narrowed.awcms_identities!.SELECT = ["id"];
      const over = await checkWorkerSetupRoleGrants({
        ...base,
        setupColumns: narrowed
      });
      expect(over.status).toBe("fail");
      expect(over.evidence).toContain(
        "awcms_setup column grant over-granted: SELECT on awcms_identities(principal_id)"
      );

      const widened = structuredClone(SETUP_COLUMN_GRANTS);
      widened.awcms_identities!.SELECT!.push("password_hash");
      const under = await checkWorkerSetupRoleGrants({
        ...base,
        setupColumns: widened
      });
      expect(under.status).toBe("fail");
      expect(under.evidence).toContain(
        "awcms_setup column grant under-granted: SELECT on awcms_identities(password_hash)"
      );
    });

    for (const [role, table, column, privilege] of [
      ["awcms_setup", "awcms_push_subscriptions", "endpoint", "SELECT"],
      ["awcms_setup", "awcms_tenant_users", "status", "UPDATE"],
      ["awcms_worker", "awcms_sessions", "token_hash", "SELECT"],
      ["awcms_worker", "awcms_tenant_users", "status", "UPDATE"]
    ] as const) {
      test(`a stray column grant on an UNPINNED table fails: ${role} ${privilege} ${table}(${column})`, async () => {
        const admin = new Bun.SQL(DATABASE_URL!, { max: 1 });
        try {
          const rows = (await admin`
            SELECT 1 AS present FROM pg_roles WHERE rolname = ${role}
          `) as unknown[];
          expect(rows.length, `${role} must exist (sql/022)`).toBe(1);

          await admin.unsafe(
            `GRANT ${privilege} (${column}) ON ${table} TO ${role}`
          );
          try {
            const result = await checkWorkerSetupRoleGrants();

            expect(result.status).toBe("fail");
            expect(result.evidence).toContain(
              `${role} column grant over-granted: ${privilege} on ${table}(${column})`
            );
          } finally {
            await admin.unsafe(
              `REVOKE ${privilege} (${column}) ON ${table} FROM ${role}`
            );
          }
          expect((await checkWorkerSetupRoleGrants()).status).toBe("pass");
        } finally {
          await admin.close({ timeout: 1 });
        }
      });
    }

    test("disabling the link-once trigger or dropping the restrictive policy FAILS", async () => {
      const admin = new Bun.SQL(DATABASE_URL!, { max: 1 });
      try {
        await admin.unsafe(
          "ALTER TABLE awcms_identities DISABLE TRIGGER awcms_identities_principal_link_once"
        );
        let noTrigger;
        try {
          noTrigger = await checkWorkerSetupRoleGrants();
        } finally {
          await admin.unsafe(
            "ALTER TABLE awcms_identities ENABLE TRIGGER awcms_identities_principal_link_once"
          );
        }

        expect(noTrigger.status).toBe("fail");
        expect(noTrigger.evidence).toContain(
          "awcms_identities_principal_link_once is missing"
        );

        await admin.unsafe(
          "DROP POLICY awcms_identities_setup_link_once ON awcms_identities"
        );
        let noPolicy;
        try {
          noPolicy = await checkWorkerSetupRoleGrants();
        } finally {
          await admin.unsafe(
            `CREATE POLICY awcms_identities_setup_link_once ON awcms_identities
             AS RESTRICTIVE FOR UPDATE TO awcms_setup
             USING (principal_id IS NULL) WITH CHECK (principal_id IS NOT NULL)`
          );
        }

        expect(noPolicy.status).toBe("fail");
        expect(noPolicy.evidence).toContain("awcms_identities_setup_link_once");
        expect((await checkWorkerSetupRoleGrants()).status).toBe("pass");
      } finally {
        await admin.close({ timeout: 1 });
      }
    });

    test("a pinned COLUMN the role does not hold FAILS", async () => {
      if (!(await awcmsWorkerExists())) {
        return;
      }

      const base = defaultWorkerSetupRoleGrantsPolicy();
      const widened = structuredClone(WORKER_COLUMN_GRANTS);
      widened.awcms_profiles!.SELECT!.push("profile_type");
      const result = await checkWorkerSetupRoleGrants({
        ...base,
        workerColumns: widened
      });

      expect(result.status).toBe("fail");
      expect(result.evidence).toContain("column grant under-granted");
      expect(result.evidence).toContain(
        "SELECT on awcms_profiles(profile_type)"
      );
    });

    test("an UNDER-granted matrix (expects a privilege the role lacks) FAILS", async () => {
      if (!(await awcmsWorkerExists())) {
        // Pre-sql/022 database: the check short-circuits to non-blocking-pass
        // before inspecting grants. The failure branch is asserted where the
        // role exists (release.yml).
        return;
      }

      const base = defaultWorkerSetupRoleGrantsPolicy();
      // Demand a privilege awcms_worker deliberately does NOT hold: any write on
      // the permission catalog. The role has zero grant there, so the check must
      // report it under-granted.
      const result = await checkWorkerSetupRoleGrants({
        worker: { ...base.worker, awcms_permissions: ["INSERT"] }
      });

      expect(result.severity).toBe("critical");
      expect(result.status).toBe("fail");
      expect(result.evidence).toContain("awcms_worker");
      expect(result.evidence).toContain("awcms_permissions");
      expect(result.evidence).toContain("under-granted");
    });

    test("an OVER-granted role (holds a privilege absent from its matrix) FAILS closed", async () => {
      if (!(await awcmsWorkerExists())) {
        return;
      }

      const base = defaultWorkerSetupRoleGrantsPolicy();
      // Drop awcms_tenants from the expected matrix. The real role DOES hold
      // SELECT on it (every worker reads the active-tenant list), so the check
      // must flag that real grant as an out-of-matrix over-grant / isolation
      // breach — the fail-closed direction.
      const { awcms_tenants, ...workerWithoutTenants } = base.worker;
      void awcms_tenants;
      const result = await checkWorkerSetupRoleGrants({
        worker: workerWithoutTenants
      });

      expect(result.severity).toBe("critical");
      expect(result.status).toBe("fail");
      expect(result.evidence).toContain("awcms_tenants");
      expect(result.evidence).toContain("over-granted");
      expect(result.evidence).toContain("isolation breach");
    });
  }
);
