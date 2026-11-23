/**
 * The payroll boundary read from a REAL migrated catalog (Issue #1015, M-B).
 *
 * `payroll:sql-boundary:check` reads migration text; this reads `pg_catalog`
 * after every migration has run, which is the only place a run-time name, a
 * rename, a function chain or a grant cannot hide. Three things are proved:
 *
 *   1. BASELINE: the repository's own migrated database has no object outside
 *      the payroll family that reaches a payroll table, and no grant outside
 *      the allowed roles.
 *   2. PROBES: every evasion the #978 re-audit wrote (plus the ones only the
 *      catalog can see) is applied inside a transaction that is rolled back,
 *      the catalog is read INSIDE that transaction, and the expected finding
 *      codes must be present. Each probe is also run through the static gate
 *      so the two layers' coverage is pinned side by side.
 *   3. CLEAN TWINS: the same shapes kept inside the payroll family produce no
 *      finding, so the check is not simply red about everything.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  getAdminSql,
  integrationEnabled,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import {
  analysePayrollCatalog,
  functionBodySha256,
  functionSignature,
  isPayrollFamily,
  loadPayrollCatalogSnapshot,
  multisetDistance,
  staleCatalogExemptions,
  staleSecurityDefinerAllowlist,
  type CatalogFinding,
  type CatalogSnapshot
} from "../../scripts/lib/payroll-catalog-boundary";
import { PAYROLL_REQUIRED_TABLE_FINGERPRINTS } from "../../src/modules/_shared/payroll-data-boundary";
import { findPayrollSqlLeaks } from "../../scripts/payroll-sql-boundary-check";
import { splitSqlStatements } from "../../scripts/lib/sql-statements";
import {
  PAYROLL_BOUNDARY_CLEAN_TWINS,
  PAYROLL_BOUNDARY_PROBES
} from "../fixtures/payroll-boundary-probes";

class Rollback extends Error {}

/**
 * `splitSqlStatements` ends a statement at every top-level `;`, and a
 * SQL-standard body (`BEGIN ATOMIC ...; END`) has `;` inside it. Re-join the
 * pieces of such a body so the probe runs as written (Issue #1436).
 */
function joinAtomicBodies(statements: string[]): string[] {
  const joined: string[] = [];
  let open: string | null = null;

  for (const statement of statements) {
    if (open !== null) {
      open = `${open}; ${statement}`;

      if (/^END$/i.test(statement.trim())) {
        joined.push(open);
        open = null;
      }
    } else if (/\bBEGIN\s+ATOMIC\b/i.test(statement)) {
      open = statement;
    } else {
      joined.push(statement);
    }
  }

  if (open !== null) joined.push(open);

  return joined;
}

type Tag = Parameters<typeof loadPayrollCatalogSnapshot>[0];

/** Apply `sql` in a transaction, read the catalog inside it, then roll everything back. */
async function findingsAfter(
  sql: string,
  workerExecuteAllowlist: string[] = []
): Promise<CatalogFinding[]> {
  let findings: CatalogFinding[] = [];

  try {
    await getAdminSql().begin(async (tx) => {
      for (const statement of joinAtomicBodies(splitSqlStatements(sql))) {
        await tx.unsafe(statement);
      }

      // The probe objects are created by the admin connection, which is not the
      // role that ran the migrations; that role is the expected owner here.
      const [me] = (await tx`SELECT current_user::text AS name`) as {
        name: string;
      }[];

      const snapshot = await loadPayrollCatalogSnapshot(tx as unknown as Tag);

      // A probe that removes the migration ledger must see "no expected owner".
      findings = analysePayrollCatalog(snapshot, {
        workerExecuteAllowlist,
        expectedOwners: snapshot.migrationOwner === null ? [] : [me!.name]
      });

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }

  return findings;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("payroll catalog boundary (Issue #1015)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  test("baseline: the migrated database is clean, and the probes' target table is a payroll table", async () => {
    const snapshot = await loadPayrollCatalogSnapshot(
      getAdminSql() as unknown as Tag
    );

    // The premise: the accrual ledger exists and is what the probes attack.
    expect(
      snapshot.grants.some(
        (grant) => grant.relation === "public.awcms_hr_commission_accruals"
      )
    ).toBe(true);
    expect(snapshot.functions.length).toBeGreaterThan(50);
    expect(snapshot.triggers.length).toBeGreaterThan(20);

    expect(analysePayrollCatalog(snapshot)).toEqual([]);
    expect(staleCatalogExemptions(snapshot)).toEqual([]);
  });

  test.each(PAYROLL_BOUNDARY_PROBES.map((probe) => [probe.id, probe] as const))(
    "probe %s",
    async (_id, probe) => {
      const found = (await findingsAfter(probe.sql)).map(
        (finding) => finding.code
      );

      if (probe.catalogCodes.length === 0) {
        // Honest limit: a one-shot copy leaves no dependency to read.
        expect(found).toEqual([]);
      } else {
        for (const code of probe.catalogCodes) expect(found).toContain(code);
      }

      // At least one layer holds every probe.
      const staticFailures = findPayrollSqlLeaks([
        { name: "999_probe.sql", sql: probe.sql }
      ]);

      expect(staticFailures.length > 0 || found.length > 0).toBe(true);
      expect(staticFailures.length > 0).toBe(probe.staticCaught);
    }
  );

  test.each(
    PAYROLL_BOUNDARY_CLEAN_TWINS.map((twin) => [twin.id, twin] as const)
  )("clean twin %s: no finding", async (_id, twin) => {
    expect(
      await findingsAfter(twin.sql, twin.workerExecuteAllowlist ?? [])
    ).toEqual([]);
  });

  test("a probe leaves nothing behind (the transaction really rolled back)", async () => {
    await findingsAfter(PAYROLL_BOUNDARY_PROBES[0]!.sql);

    const rows = (await getAdminSql()`
      SELECT count(*)::int AS n FROM pg_class WHERE relname LIKE 'awcms\\_probe\\_%'
    `) as { n: number }[];

    expect(rows[0]!.n).toBe(0);
  });

  /** Run `steps` in one rolled-back transaction, reading the catalog after each. */
  async function snapshotsAfter(
    steps: string[]
  ): Promise<{ me: string; snapshots: CatalogSnapshot[] }> {
    const snapshots: CatalogSnapshot[] = [];
    let me = "";

    try {
      await getAdminSql().begin(async (tx) => {
        const [row] = (await tx`SELECT current_user::text AS name`) as {
          name: string;
        }[];

        me = row!.name;

        for (const step of steps) {
          for (const statement of joinAtomicBodies(splitSqlStatements(step))) {
            await tx.unsafe(statement);
          }

          snapshots.push(
            await loadPayrollCatalogSnapshot(tx as unknown as Tag)
          );
        }

        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }

    return { me, snapshots };
  }

  describe("ADR-0173 allow-lists against the migrated catalog (Issue #1436)", () => {
    test("baseline: every required table matches its pinned fingerprint, and each name-free tolerance keeps a margin of more than twice itself", async () => {
      const snapshot = await loadPayrollCatalogSnapshot(
        getAdminSql() as unknown as Tag
      );
      const codes = analysePayrollCatalog(snapshot).map(
        (finding) => finding.code
      );

      expect(codes).not.toContain("payroll-fingerprint-drift");
      expect(codes).not.toContain("payroll-fingerprint-match");

      for (const [table, fingerprint] of Object.entries(
        PAYROLL_REQUIRED_TABLE_FINGERPRINTS
      )) {
        if (fingerprint.nameFreeTolerance === null) continue;

        const types = (columns: readonly string[]) =>
          columns.map((column) => column.slice(column.indexOf(":") + 1));
        const nearest = Math.min(
          ...snapshot.columns
            .filter((entry) => entry.relation !== `public.${table}`)
            .map((entry) =>
              multisetDistance(types(fingerprint.columns), types(entry.columns))
            )
        );

        expect(nearest).toBeGreaterThan(2 * fingerprint.nameFreeTolerance);
      }
    });

    test("baseline: no non-family SECURITY DEFINER function's owner reaches payroll (the allow-list is empty and nothing needs it)", async () => {
      const snapshot = await loadPayrollCatalogSnapshot(
        getAdminSql() as unknown as Tag
      );
      const definers = snapshot.functions.filter(
        (fn) => fn.securityDefiner && !isPayrollFamily(fn.name)
      );

      // The premise: there ARE such functions, each owned by a dedicated role.
      expect(definers.length).toBeGreaterThan(10);
      expect(
        analysePayrollCatalog(snapshot).filter((finding) =>
          finding.code.startsWith("security-definer-")
        )
      ).toEqual([]);
      expect(staleSecurityDefinerAllowlist(snapshot)).toEqual([]);
    });

    test("a reviewed entry passes; a changed body or owner is drift", async () => {
      const create = `CREATE FUNCTION awcms_probe_reviewed() RETURNS integer
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT 1 $$;`;
      const { me, snapshots } = await snapshotsAfter([
        create,
        `CREATE OR REPLACE FUNCTION awcms_probe_reviewed() RETURNS integer
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT 2 $$;`,
        `CREATE ROLE awcms_probe_reviewer NOLOGIN;
GRANT awcms_app TO awcms_probe_reviewer;
CREATE OR REPLACE FUNCTION awcms_probe_reviewed() RETURNS integer
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT 1 $$;
ALTER FUNCTION awcms_probe_reviewed() OWNER TO awcms_probe_reviewer;`
      ]);
      const reviewed = snapshots[0]!.functions.find(
        (fn) => fn.name === "public.awcms_probe_reviewed"
      )!;
      const allowlist = {
        [functionSignature(reviewed)]: {
          reason:
            "probe: a reviewed SECURITY DEFINER function owned by the payroll owner",
          approvedIn: "#1436",
          owner: me,
          bodySha256: functionBodySha256(reviewed.source)
        }
      };
      const definerCodes = (snapshot: CatalogSnapshot) =>
        analysePayrollCatalog(snapshot, {
          expectedOwners: [me],
          securityDefinerAllowlist: allowlist
        })
          .map((finding) => finding.code)
          .filter((code) => code.startsWith("security-definer-"));

      expect(functionSignature(reviewed)).toBe("public.awcms_probe_reviewed()");
      // Without the entry it is a finding; with it, nothing.
      expect(
        analysePayrollCatalog(snapshots[0]!, { expectedOwners: [me] }).map(
          (finding) => finding.code
        )
      ).toContain("security-definer-not-allow-listed");
      expect(definerCodes(snapshots[0]!)).toEqual([]);
      // A catalog exemption for the same object does not silence it.
      expect(
        analysePayrollCatalog(snapshots[0]!, {
          expectedOwners: [me],
          exemptions: {
            [functionSignature(reviewed)]: "probe: exempted",
            "public.awcms_probe_reviewed": "probe: exempted"
          }
        }).map((finding) => finding.code)
      ).toContain("security-definer-not-allow-listed");
      // The body changed under the entry.
      expect(definerCodes(snapshots[1]!)).toEqual([
        "security-definer-allowlist-drift"
      ]);
      // The original body, a different owner.
      expect(definerCodes(snapshots[2]!)).toEqual([
        "security-definer-allowlist-drift"
      ]);
    });

    test("a BEGIN ATOMIC body comes back as text and with the functions it calls", async () => {
      const { snapshots } = await snapshotsAfter([
        `CREATE FUNCTION awcms_probe_callee() RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
CREATE FUNCTION awcms_probe_atomic_reader() RETURNS bigint LANGUAGE sql
  BEGIN ATOMIC SELECT awcms_probe_callee(); END;`
      ]);
      const atomic = snapshots[0]!.functions.find(
        (fn) => fn.name === "public.awcms_probe_atomic_reader"
      )!;

      expect(atomic.atomicBody).toBe(true);
      expect(atomic.source).toContain("awcms_probe_callee()");
      expect(atomic.dependsOnFunctions).toContain("public.awcms_probe_callee");
    });

    test("the pg_depend edges of a BEGIN ATOMIC body carry the chain and the family call even when its text is not read, and an empty body fails closed", async () => {
      const { me, snapshots } = await snapshotsAfter([
        `CREATE FUNCTION awcms_hr_payroll_probe_sum() RETURNS bigint LANGUAGE sql
  AS $$ SELECT count(*) FROM awcms_hr_commission_accruals $$;
CREATE FUNCTION awcms_probe_leak3() RETURNS bigint LANGUAGE plpgsql
  AS $$ BEGIN RETURN (SELECT count(*) FROM awcms_hr_commission_accruals); END $$;
CREATE FUNCTION awcms_probe_atomic_fam2() RETURNS bigint LANGUAGE sql
  BEGIN ATOMIC SELECT awcms_hr_payroll_probe_sum(); END;
CREATE FUNCTION awcms_probe_atomic_chain2() RETURNS bigint LANGUAGE sql
  BEGIN ATOMIC SELECT awcms_probe_leak3(); END;`
      ]);
      // Keep only what pg_depend recorded: replace the deparsed text with a
      // body that names nothing (or with nothing at all).
      const withBody = (body: string): string[] =>
        analysePayrollCatalog(
          {
            ...snapshots[0]!,
            functions: snapshots[0]!.functions.map((fn) =>
              fn.atomicBody === true &&
              fn.name.startsWith("public.awcms_probe_")
                ? { ...fn, source: body }
                : fn
            )
          },
          { expectedOwners: [me] }
        ).map((finding) => `${finding.code} ${finding.object}`);

      expect(withBody("BEGIN ATOMIC SELECT 1; END")).toEqual(
        expect.arrayContaining([
          "function-calls-payroll-function public.awcms_probe_atomic_fam2",
          "function-chain public.awcms_probe_atomic_chain2"
        ])
      );
      expect(withBody("")).toEqual(
        expect.arrayContaining([
          "function-body-unreadable public.awcms_probe_atomic_fam2",
          "function-body-unreadable public.awcms_probe_atomic_chain2"
        ])
      );
    });
  });
});
