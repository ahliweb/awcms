/**
 * `security:readiness` pins the role of the scheduled payroll catalog check
 * (sql/420, Issue #1095), and the role really can run the check while reading no
 * data. Proven both ways against a migrated database: PASS on the real schema,
 * FAIL for each privilege widening, PASS again once reverted; and a REAL LOGIN as
 * the role runs the catalog check but cannot read a payroll row.
 *
 * Gated on `DATABASE_URL` (a database migrated through sql/420, connected as a
 * role that may GRANT).
 */
import { describe, expect, test } from "bun:test";

import {
  checkPayrollCatalogAuditActivated,
  checkPayrollCatalogAuditRole,
  PAYROLL_CATALOG_AUDIT_ROLE
} from "../scripts/security-readiness";
import { runPayrollCatalogCheck } from "../scripts/lib/payroll-catalog-check-run";

const DATABASE_URL = process.env.DATABASE_URL;
const describeOrSkip = DATABASE_URL ? describe : describe.skip;
const TABLE = "awcms_hr_commission_accruals";

describeOrSkip("security:readiness - payroll catalog audit role", () => {
  async function withAdmin<T>(work: (sql: Bun.SQL) => Promise<T>): Promise<T> {
    const sql = new Bun.SQL(DATABASE_URL!, { max: 1 });

    try {
      return await work(sql);
    } finally {
      await sql.close({ timeout: 1 });
    }
  }

  const exec = (statement: string) =>
    withAdmin(async (sql) => {
      await sql.unsafe(statement);
    });

  async function expectRed(widen: string, revert: string, mention: string) {
    try {
      await exec(widen);

      const widened = await checkPayrollCatalogAuditRole();

      expect(widened.status).toBe("fail");
      expect(widened.evidence).toContain(mention);
    } finally {
      await exec(revert);
    }

    expect((await checkPayrollCatalogAuditRole()).status).toBe("pass");
  }

  test("passes on the real schema", async () => {
    const result = await checkPayrollCatalogAuditRole();

    expect(result.status).toBe("pass");
    expect(result.severity).toBe("critical");
  });

  test("MUTATION: a table-level SELECT on a payroll table is refused", async () => {
    await expectRed(
      `GRANT SELECT ON ${TABLE} TO ${PAYROLL_CATALOG_AUDIT_ROLE}`,
      `REVOKE ALL ON ${TABLE} FROM ${PAYROLL_CATALOG_AUDIT_ROLE}`,
      "TABLE-level privilege"
    );
  });

  test("MUTATION: a column-level SELECT is refused", async () => {
    await expectRed(
      `GRANT SELECT (id) ON ${TABLE} TO ${PAYROLL_CATALOG_AUDIT_ROLE}`,
      `REVOKE ALL (id) ON ${TABLE} FROM ${PAYROLL_CATALOG_AUDIT_ROLE}`,
      "COLUMN-level privilege"
    );
  });

  test("MUTATION: a privilege granted to PUBLIC reaches the role and is refused", async () => {
    await expectRed(
      `GRANT SELECT ON ${TABLE} TO PUBLIC`,
      `REVOKE ALL ON ${TABLE} FROM PUBLIC`,
      "TABLE-level privilege"
    );
  });

  test("MUTATION: a membership of another role is refused", async () => {
    await expectRed(
      `GRANT awcms_app TO ${PAYROLL_CATALOG_AUDIT_ROLE}`,
      `REVOKE awcms_app FROM ${PAYROLL_CATALOG_AUDIT_ROLE}`,
      "member of awcms_app"
    );
  });

  test("MUTATION: BYPASSRLS is refused", async () => {
    await expectRed(
      `ALTER ROLE ${PAYROLL_CATALOG_AUDIT_ROLE} BYPASSRLS`,
      `ALTER ROLE ${PAYROLL_CATALOG_AUDIT_ROLE} NOBYPASSRLS`,
      "BYPASSRLS"
    );
  });

  test("MUTATION (M1): a SECURITY DEFINER function it may EXECUTE through PUBLIC is refused", async () => {
    await expectRed(
      `CREATE FUNCTION awcms_zz_leak() RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS 'SELECT 1'`,
      `DROP FUNCTION awcms_zz_leak()`,
      "awcms_zz_leak"
    );
  });

  test("MUTATION (M1): a definer function with EXECUTE revoked from PUBLIC and granted to the role is refused too", async () => {
    await exec(
      `CREATE FUNCTION awcms_zz_leak2() RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS 'SELECT 1'`
    );
    await exec(`REVOKE EXECUTE ON FUNCTION awcms_zz_leak2() FROM PUBLIC`);

    try {
      // Revoked from PUBLIC: not reachable, the check stays green.
      expect((await checkPayrollCatalogAuditRole()).status).toBe("pass");

      await exec(
        `GRANT EXECUTE ON FUNCTION awcms_zz_leak2() TO ${PAYROLL_CATALOG_AUDIT_ROLE}`
      );

      const widened = await checkPayrollCatalogAuditRole();

      expect(widened.status).toBe("fail");
      expect(widened.evidence).toContain("awcms_zz_leak2");
    } finally {
      await exec(`DROP FUNCTION awcms_zz_leak2()`);
    }

    expect((await checkPayrollCatalogAuditRole()).status).toBe("pass");
  });

  test("MUTATION (M1): INHERIT is refused", async () => {
    await expectRed(
      `ALTER ROLE ${PAYROLL_CATALOG_AUDIT_ROLE} INHERIT`,
      `ALTER ROLE ${PAYROLL_CATALOG_AUDIT_ROLE} NOINHERIT`,
      "INHERIT"
    );
  });

  test("M3: the activation WARNING fails without a LOGIN, passes with one, and never blocks go-live", async () => {
    const inactive = await checkPayrollCatalogAuditActivated();

    expect(inactive.severity).toBe("warning");
    expect(inactive.status).toBe("fail");
    expect(inactive.evidence).toContain("SKIPPED (not activated)");

    await exec(`ALTER ROLE ${PAYROLL_CATALOG_AUDIT_ROLE} LOGIN`);

    try {
      expect((await checkPayrollCatalogAuditActivated()).status).toBe("pass");
    } finally {
      await exec(`ALTER ROLE ${PAYROLL_CATALOG_AUDIT_ROLE} NOLOGIN`);
    }
  });

  test("a REAL login as the role runs the catalog check and reads no payroll row", async () => {
    const password = `p${crypto.randomUUID().replaceAll("-", "")}`;
    const url = new URL(DATABASE_URL!);

    await exec(
      `ALTER ROLE ${PAYROLL_CATALOG_AUDIT_ROLE} LOGIN PASSWORD '${password}'`
    );

    url.username = PAYROLL_CATALOG_AUDIT_ROLE;
    url.password = password;

    const audit = new Bun.SQL(url.toString(), { max: 1 });

    try {
      const result = await runPayrollCatalogCheck(
        audit,
        { PAYROLL_EXPECTED_OWNERS: process.env.PAYROLL_EXPECTED_OWNERS },
        { requireOwnersOnSplitRole: true }
      );

      // The migrated test database is clean, or its only findings are about
      // owners (a superuser migration role); never a connection failure.
      expect(result.lines.length).toBeGreaterThan(0);

      let denied = false;

      try {
        await audit.unsafe(`SELECT count(*) FROM ${TABLE}`);
      } catch {
        denied = true;
      }

      expect(denied).toBe(true);
    } finally {
      await audit.close({ timeout: 1 });
      await exec(
        `ALTER ROLE ${PAYROLL_CATALOG_AUDIT_ROLE} NOLOGIN PASSWORD NULL`
      );
    }
  });
});
