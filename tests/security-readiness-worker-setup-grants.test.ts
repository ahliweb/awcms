/**
 * Issue #163 — real-PostgreSQL test that `checkWorkerSetupRoleGrants` verifies
 * the opt-in `awcms_worker`/`awcms_setup` roles hold EXACTLY their
 * least-privilege matrix, and fails in BOTH directions (under-grant ->
 * permission denied at runtime; over-grant -> isolation breach).
 *
 * Gated on `DATABASE_URL`, same convention as
 * `security-readiness-failclosed.test.ts`: `ci.yml` has no database so it skips
 * cleanly; `release.yml` provides a throwaway `postgres:18.4`, runs
 * `bun run db:migrate` (which applies `sql/022`, creating both roles), and sets
 * the var — that is where these actually execute.
 *
 * The divergence cases INJECT a policy (not `mock.module`, which leaks across
 * files — PR #157) rather than mutating any grant: the real roles' grants are
 * never touched, so this test is safe to run against a shared cluster.
 */
import { describe, expect, test } from "bun:test";

import {
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
