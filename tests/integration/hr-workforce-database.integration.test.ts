/**
 * The hr_workforce schema against a real PostgreSQL, as the least-privilege
 * runtime role, with FORCE RLS in force (Issue #945, ADR-0132).
 *
 * `hr-workforce-api.integration.test.ts` proves the HTTP wiring. This file
 * attacks the invariants that live in the DATABASE and must hold even if the
 * application code were bypassed:
 *
 *   * RLS: a tenant cannot read, write or re-point another tenant's rows;
 *   * composite (tenant_id, id) foreign keys: no reference crosses tenants
 *     (profile, office, login, manager);
 *   * one ACTIVE employment per profile and per login (partial unique indexes);
 *   * terms: never overlap, append-only (the only UPDATE closes the open row),
 *     terminated is terminal and stamps the header, the manager chain is
 *     acyclic and bounded;
 *   * an employment's person never changes and nothing is ever deleted;
 *   * a profile merge between two actively employed profiles is refused;
 *   * no personal, photo, biometric or device column exists on any table.
 *
 * Gated on `DATABASE_URL` (harness §Gating).
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
  assertRejected as assertRejectedByDatabase,
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { resetDatabaseCircuitBreakerForTests } from "../../src/lib/database/circuit-breaker";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";

/** Pins WHY the database refused, so a test cannot pass on an unrelated failure. */
async function assertRejected(
  promise: Promise<unknown>,
  expected: RegExp
): Promise<Error> {
  const error = await assertRejectedByDatabase(promise, String(expected));
  resetDatabaseCircuitBreakerForTests();
  const text = `${error.message} ${String((error as { errno?: unknown }).errno ?? "")}`;
  expect(text).toMatch(expected);
  return error;
}

const TENANT_A = "a9450000-0000-4000-8000-00000000000a";
const TENANT_B = "a9450000-0000-4000-8000-00000000000b";

function inTenant<T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return withTenantOrThrow(getRuntimeSql(), tenantId, fn);
}

async function seedProfile(tenantId: string, tag: string): Promise<string> {
  const rows = (await getAdminSql()`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`Person ${tag}`})
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

async function seedTenantUser(tenantId: string, tag: string): Promise<string> {
  const admin = getAdminSql();
  const profile = await seedProfile(tenantId, `login-${tag}`);
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile}, ${`${tag}@example.com`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const user = (await admin`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id})
    RETURNING id
  `) as { id: string }[];

  return user[0]!.id;
}

async function seedOffice(tenantId: string, code: string): Promise<string> {
  const rows = (await getAdminSql()`
    INSERT INTO awcms_offices (tenant_id, office_code, office_name)
    VALUES (${tenantId}, ${code}, ${`Office ${code}`})
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

let counter = 0;

/** An employment header + its first term, written as the RUNTIME role. */
async function employ(
  tenantId: string,
  profileId: string,
  extra: { managerId?: string | null; officeId?: string | null } = {}
): Promise<string> {
  counter += 1;

  return inTenant(tenantId, async (tx) => {
    const header = (await tx`
      INSERT INTO awcms_hr_employments (tenant_id, profile_id, employee_no, hired_on)
      VALUES (${tenantId}, ${profileId}, ${`N-${counter}`}, '2026-01-01')
      RETURNING id
    `) as { id: string }[];

    await tx`
      INSERT INTO awcms_hr_employment_terms
        (tenant_id, employment_id, office_id, manager_employment_id,
         employment_type, status, effective_from)
      VALUES (${tenantId}, ${header[0]!.id}, ${extra.officeId ?? null},
              ${extra.managerId ?? null}, 'permanent', 'active', '2026-01-01')
    `;

    return header[0]!.id;
  });
}

function closeOpenTerm(tenantId: string, employmentId: string, on: string) {
  return inTenant(
    tenantId,
    (tx) => tx`
      UPDATE awcms_hr_employment_terms SET effective_to = ${on}::date
      WHERE employment_id = ${employmentId} AND effective_to IS NULL
    `
  );
}

function insertTerm(
  tenantId: string,
  employmentId: string,
  values: {
    from: string;
    to?: string | null;
    status?: string;
    managerId?: string | null;
  }
) {
  return inTenant(
    tenantId,
    (tx) => tx`
      INSERT INTO awcms_hr_employment_terms
        (tenant_id, employment_id, manager_employment_id, employment_type,
         status, effective_from, effective_to)
      VALUES (${tenantId}, ${employmentId}, ${values.managerId ?? null},
              'permanent', ${values.status ?? "active"}, ${values.from}::date,
              ${values.to ?? null}::date)
    `
  );
}

const suite = integrationEnabled ? describe : describe.skip;

suite("hr_workforce database invariants (Issue #945, ADR-0132)", () => {
  let profileA = "";
  let profileB = "";

  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await getAdminSql()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${TENANT_A}, 'hr-a', 'HR A'), (${TENANT_B}, 'hr-b', 'HR B')
    `;
    profileA = await seedProfile(TENANT_A, "a");
    profileB = await seedProfile(TENANT_B, "b");
  });

  describe("tenant isolation", () => {
    test("RLS is ENABLED and FORCED on every table, with USING and WITH CHECK", async () => {
      const rows = (await getAdminSql()`
        SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
               count(p.polname)::int AS policies,
               bool_and(p.polqual IS NOT NULL AND p.polwithcheck IS NOT NULL) AS both
        FROM pg_class c
        LEFT JOIN pg_policy p ON p.polrelid = c.oid
        WHERE c.relname IN ('awcms_hr_employments', 'awcms_hr_employment_terms',
                            'awcms_hr_workforce_settings')
        GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
      `) as {
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
        policies: number;
        both: boolean;
      }[];

      expect(rows).toHaveLength(3);

      for (const row of rows) {
        expect(row.relrowsecurity).toBe(true);
        expect(row.relforcerowsecurity).toBe(true);
        expect(row.policies).toBeGreaterThanOrEqual(1);
        expect(row.both).toBe(true);
      }
    });

    test("a tenant cannot read, write or re-point another tenant's employment", async () => {
      const id = await employ(TENANT_A, profileA);

      const seenByB = await inTenant(
        TENANT_B,
        (tx) =>
          tx`SELECT id FROM awcms_hr_employments WHERE id = ${id}` as Promise<
            unknown[]
          >
      );
      expect(seenByB).toHaveLength(0);

      const updated = await inTenant(
        TENANT_B,
        (tx) =>
          tx`UPDATE awcms_hr_employments SET hired_on = '2020-01-01'
             WHERE id = ${id} RETURNING id` as Promise<unknown[]>
      );
      expect(updated).toHaveLength(0);

      // WITH CHECK: B cannot write a row that names A.
      await assertRejected(
        inTenant(
          TENANT_B,
          (tx) => tx`
            INSERT INTO awcms_hr_employments (tenant_id, profile_id, employee_no, hired_on)
            VALUES (${TENANT_A}, ${profileA}, 'X-1', '2026-01-01')
          `
        ),
        /row-level security|violates/i
      );
    });

    test("composite foreign keys: no profile, office, login or manager crosses tenants", async () => {
      const officeB = await seedOffice(TENANT_B, "ob");
      const userB = await seedTenantUser(TENANT_B, "ub");
      const employmentA = await employ(TENANT_A, profileA);

      // A profile of tenant B on an employment of tenant A.
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            INSERT INTO awcms_hr_employments (tenant_id, profile_id, employee_no, hired_on)
            VALUES (${TENANT_A}, ${profileB}, 'X-2', '2026-01-01')
          `
        ),
        /foreign key|23503/i
      );

      // A login of tenant B.
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            UPDATE awcms_hr_employments SET tenant_user_id = ${userB}
            WHERE id = ${employmentA}
          `
        ),
        /foreign key|23503/i
      );

      // Close the open row first: the overlap guard runs before the foreign key.
      await closeOpenTerm(TENANT_A, employmentA, "2027-01-01");

      // An office of tenant B on a term.
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            INSERT INTO awcms_hr_employment_terms
              (tenant_id, employment_id, office_id, employment_type, status, effective_from)
            VALUES (${TENANT_A}, ${employmentA}, ${officeB}, 'permanent', 'active', '2027-01-01')
          `
        ),
        /foreign key|23503/i
      );

      // A manager employment of tenant B.
      const employmentB = await employ(TENANT_B, profileB);
      await assertRejected(
        insertTerm(TENANT_A, employmentA, {
          from: "2027-01-01",
          managerId: employmentB
        }),
        /foreign key|23503/i
      );
    });
  });

  describe("one active employment", () => {
    test("per profile and tenant: a second is refused, a terminated one frees the person", async () => {
      const first = await employ(TENANT_A, profileA);

      await assertRejected(
        employ(TENANT_A, profileA),
        /awcms_hr_employments_one_active_per_profile|23505/
      );

      await insertTerm(TENANT_A, first, {
        from: "2026-06-01",
        status: "terminated"
      }).catch(() => null);
      // (the open row must be closed first; the terminal row cannot overlap it)
      await inTenant(
        TENANT_A,
        (tx) => tx`
          UPDATE awcms_hr_employment_terms SET effective_to = '2026-06-01'
          WHERE employment_id = ${first} AND effective_to IS NULL
        `
      );
      await insertTerm(TENANT_A, first, {
        from: "2026-06-01",
        status: "terminated"
      });

      await employ(TENANT_A, profileA);
    });

    test("per login: one login cannot be two active employees", async () => {
      const user = await seedTenantUser(TENANT_A, "shared");
      const other = await seedProfile(TENANT_A, "other");
      const one = await employ(TENANT_A, profileA);
      const two = await employ(TENANT_A, other);

      await inTenant(
        TENANT_A,
        (tx) =>
          tx`UPDATE awcms_hr_employments SET tenant_user_id = ${user} WHERE id = ${one}`
      );
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) =>
            tx`UPDATE awcms_hr_employments SET tenant_user_id = ${user} WHERE id = ${two}`
        ),
        /awcms_hr_employments_one_active_per_user|23505/
      );
    });

    test("employee numbers are unique per tenant among live rows, case-insensitively", async () => {
      const other = await seedProfile(TENANT_A, "other");
      await inTenant(
        TENANT_A,
        (tx) => tx`
          INSERT INTO awcms_hr_employments (tenant_id, profile_id, employee_no, hired_on)
          VALUES (${TENANT_A}, ${profileA}, 'EMP-1', '2026-01-01')
        `
      );
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            INSERT INTO awcms_hr_employments (tenant_id, profile_id, employee_no, hired_on)
            VALUES (${TENANT_A}, ${other}, 'emp-1', '2026-01-01')
          `
        ),
        /awcms_hr_employments_employee_no_key|23505/
      );
    });
  });

  describe("terms are effective-dated and append-only", () => {
    test("terms never overlap, and a closed history is not editable", async () => {
      const id = await employ(TENANT_A, profileA);

      // The open row is [2026-01-01, infinity): any later start overlaps it
      // until it is closed.
      await assertRejected(
        insertTerm(TENANT_A, id, { from: "2026-03-01" }),
        /HR_TERMS_OVERLAP|23P01|23505/
      );

      await inTenant(
        TENANT_A,
        (tx) => tx`
          UPDATE awcms_hr_employment_terms SET effective_to = '2026-03-01'
          WHERE employment_id = ${id} AND effective_to IS NULL
        `
      );
      await insertTerm(TENANT_A, id, { from: "2026-03-01" });

      // An earlier start now overlaps the closed row.
      await assertRejected(
        insertTerm(TENANT_A, id, { from: "2026-02-01", to: "2026-02-15" }),
        /HR_TERMS_OVERLAP|23P01/
      );

      // Nothing but "close the open row" is an UPDATE.
      const edits: (() => Promise<unknown>)[] = [
        () =>
          inTenant(
            TENANT_A,
            (tx) => tx`
              UPDATE awcms_hr_employment_terms SET job_title = 'Rewritten'
              WHERE employment_id = ${id} AND effective_to IS NOT NULL
            `
          ),
        () =>
          inTenant(
            TENANT_A,
            (tx) => tx`
              UPDATE awcms_hr_employment_terms SET status = 'suspended'
              WHERE employment_id = ${id} AND effective_to IS NULL
            `
          ),
        () =>
          inTenant(
            TENANT_A,
            (tx) => tx`
              UPDATE awcms_hr_employment_terms SET effective_to = '2027-01-01'
              WHERE employment_id = ${id} AND effective_to IS NOT NULL
            `
          )
      ];

      for (const edit of edits) {
        await assertRejected(edit(), /append-only|55000/);
      }
    });

    test("nothing is ever deleted, and awcms_app holds no DELETE", async () => {
      const id = await employ(TENANT_A, profileA);

      for (const table of [
        "awcms_hr_employments",
        "awcms_hr_employment_terms"
      ]) {
        await assertRejected(
          inTenant(
            TENANT_A,
            (tx) =>
              tx`DELETE FROM ${tx.unsafe(table)} WHERE tenant_id = ${TENANT_A}`
          ),
          /permission denied|42501/
        );
      }

      const privileges = (await getAdminSql()`
        SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'awcms_app'
          AND table_name IN ('awcms_hr_employments', 'awcms_hr_employment_terms',
                             'awcms_hr_workforce_settings')
          AND privilege_type IN ('DELETE', 'TRUNCATE')
      `) as unknown[];
      expect(privileges).toHaveLength(0);
      expect(id).toBeTruthy();
    });

    test("terminated is terminal: it stamps the header, closes the door, and cannot be cleared", async () => {
      const id = await employ(TENANT_A, profileA);

      await inTenant(
        TENANT_A,
        (tx) => tx`
          UPDATE awcms_hr_employment_terms SET effective_to = '2026-06-01'
          WHERE employment_id = ${id} AND effective_to IS NULL
        `
      );
      await insertTerm(TENANT_A, id, {
        from: "2026-06-01",
        status: "terminated"
      });

      const header = (await getAdminSql()`
        SELECT to_char(terminated_on, 'YYYY-MM-DD') AS terminated_on
        FROM awcms_hr_employments WHERE id = ${id}
      `) as { terminated_on: string }[];
      expect(header[0]!.terminated_on).toBe("2026-06-01");

      await assertRejected(
        insertTerm(TENANT_A, id, { from: "2026-07-01" }),
        /HR_EMPLOYMENT_TERMINATED|55000/
      );
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) =>
            tx`UPDATE awcms_hr_employments SET terminated_on = NULL WHERE id = ${id}`
        ),
        /terminal|55000/
      );
    });

    test("a terminated row is open-ended by CHECK", async () => {
      const id = await employ(TENANT_A, profileA);
      await closeOpenTerm(TENANT_A, id, "2026-06-01");

      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            INSERT INTO awcms_hr_employment_terms
              (tenant_id, employment_id, employment_type, status, effective_from, effective_to)
            VALUES (${TENANT_A}, ${id}, 'permanent', 'terminated', '2026-06-01', '2026-07-01')
          `
        ),
        /awcms_hr_employment_terms_terminated_open|23514/
      );
    });

    test("the person and the tenant of an employment never change", async () => {
      const id = await employ(TENANT_A, profileA);
      const other = await seedProfile(TENANT_A, "swap");

      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) =>
            tx`UPDATE awcms_hr_employments SET profile_id = ${other} WHERE id = ${id}`
        ),
        /identity and person cannot change|55000/
      );
    });
  });

  describe("the manager chain", () => {
    test("a cycle is refused by the database even if the application is bypassed", async () => {
      const boss = await employ(TENANT_A, profileA);
      const other = await seedProfile(TENANT_A, "report");
      const report = await employ(TENANT_A, other, { managerId: boss });

      await inTenant(
        TENANT_A,
        (tx) => tx`
          UPDATE awcms_hr_employment_terms SET effective_to = '2026-03-01'
          WHERE employment_id = ${boss} AND effective_to IS NULL
        `
      );
      await assertRejected(
        insertTerm(TENANT_A, boss, { from: "2026-03-01", managerId: report }),
        /HR_MANAGER_CYCLE|23514/
      );
      await assertRejected(
        insertTerm(TENANT_A, boss, { from: "2026-03-01", managerId: boss }),
        /not_own_manager|HR_MANAGER_CYCLE|23514/
      );
    });

    test("the chain is bounded at ten levels", async () => {
      let top = await employ(TENANT_A, profileA);

      for (let level = 0; level < 10; level += 1) {
        top = await employ(TENANT_A, await seedProfile(TENANT_A, `c${level}`), {
          managerId: top
        });
      }

      await assertRejected(
        employ(TENANT_A, await seedProfile(TENANT_A, "deep"), {
          managerId: top
        }),
        /HR_MANAGER_DEPTH|23514/
      );
    });
  });

  describe("the manager chain under concurrency and depth (audit M1, M2)", () => {
    test("two concurrent edges that would close a cycle: exactly one commits", async () => {
      const a = await employ(TENANT_A, profileA);
      const b = await employ(TENANT_A, await seedProfile(TENANT_A, "b"));

      // Each transaction closes its own open row, writes its manager edge and
      // then HOLDS the transaction open, so the two overlap. Without the
      // per-tenant advisory lock both walks see an acyclic committed chain.
      const edge = (employment: string, manager: string) =>
        inTenant(TENANT_A, async (tx) => {
          await tx`
            UPDATE awcms_hr_employment_terms SET effective_to = '2026-03-01'
            WHERE employment_id = ${employment} AND effective_to IS NULL
          `;
          await tx`
            INSERT INTO awcms_hr_employment_terms
              (tenant_id, employment_id, manager_employment_id, employment_type,
               status, effective_from)
            VALUES (${TENANT_A}, ${employment}, ${manager}, 'permanent',
                    'active', '2026-03-01')
          `;
          await tx`SELECT pg_sleep(0.5)`;
        });

      const results = await Promise.allSettled([edge(a, b), edge(b, a)]);
      resetDatabaseCircuitBreakerForTests();

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((r) => r.status === "rejected") as
        PromiseRejectedResult | undefined;
      expect(String(rejected?.reason?.message)).toMatch(/HR_MANAGER_CYCLE/);

      const cyclic = (await getAdminSql()`
        SELECT count(*)::int AS n FROM awcms_hr_employment_terms t
        WHERE t.tenant_id = ${TENANT_A} AND t.effective_to IS NULL
          AND t.manager_employment_id IS NOT NULL
      `) as { n: number }[];
      expect(cyclic[0]!.n).toBe(1);
    });

    test("depth counts the subtree BELOW: adding a manager above a full chain is refused", async () => {
      const root = await employ(TENANT_A, profileA);
      let top = root;

      for (let level = 0; level < 10; level += 1) {
        top = await employ(TENANT_A, await seedProfile(TENANT_A, `d${level}`), {
          managerId: top
        });
      }

      // root -> ... -> 10 levels below: 10 edges. Giving the ROOT a manager
      // would make 11, though the walk upward from that manager is one node.
      const newBoss = await employ(
        TENANT_A,
        await seedProfile(TENANT_A, "newboss")
      );
      await closeOpenTerm(TENANT_A, root, "2026-03-01");

      await assertRejected(
        insertTerm(TENANT_A, root, { from: "2026-03-01", managerId: newBoss }),
        /HR_MANAGER_DEPTH|23514/
      );

      // Control: one level shorter is fine.
      const shortRoot = await employ(
        TENANT_A,
        await seedProfile(TENANT_A, "short")
      );
      let shortTop = shortRoot;

      for (let level = 0; level < 9; level += 1) {
        shortTop = await employ(
          TENANT_A,
          await seedProfile(TENANT_A, `s${level}`),
          { managerId: shortTop }
        );
      }

      await closeOpenTerm(TENANT_A, shortRoot, "2026-03-01");
      await insertTerm(TENANT_A, shortRoot, {
        from: "2026-03-01",
        managerId: newBoss
      });
    });
  });

  describe("profile merge", () => {
    test("is refused while both profiles carry an ACTIVE employment, allowed once one has ended", async () => {
      const second = await seedProfile(TENANT_A, "second");
      const one = await employ(TENANT_A, profileA);
      await employ(TENANT_A, second);

      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            UPDATE awcms_profiles SET merged_into_profile_id = ${second}
            WHERE id = ${profileA}
          `
        ),
        /HR_MERGE_BOTH_EMPLOYED|23514/
      );

      await inTenant(
        TENANT_A,
        (tx) => tx`
          UPDATE awcms_hr_employment_terms SET effective_to = '2026-06-01'
          WHERE employment_id = ${one} AND effective_to IS NULL
        `
      );
      await insertTerm(TENANT_A, one, {
        from: "2026-06-01",
        status: "terminated"
      });

      const merged = (await inTenant(
        TENANT_A,
        (tx) => tx`
          UPDATE awcms_profiles SET merged_into_profile_id = ${second}
          WHERE id = ${profileA} RETURNING id
        `
      )) as unknown[];
      expect(merged).toHaveLength(1);
    });
  });

  describe("minimisation", () => {
    test("no personal, photo, biometric or device column exists on any hr table", async () => {
      const columns = (await getAdminSql()`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_name LIKE 'awcms_hr\\_%'
      `) as { table_name: string; column_name: string }[];

      expect(columns.length).toBeGreaterThan(20);

      const forbidden =
        /name$|^name|email|phone|address|birth|nik|npwp|tax_id|national|photo|image|selfie|face|biometric|fingerprint|device|latitude|longitude|geo|location|reason$/i;
      const offenders = columns
        .map((c) => `${c.table_name}.${c.column_name}`)
        // Allowed by design: a soft-delete reason (operator text, never echoed to
        // audit) and the technical `employee_no`.
        .filter((c) => forbidden.test(c.split(".")[1]!))
        .filter((c) => !c.endsWith(".delete_reason"))
        // The label of a commission RULE (Issue #950): a tenant's name for its
        // own scheme, not a person's name. hr-commission-database covers that
        // table's own minimisation (no person or employment column at all).
        .filter((c) => c !== "awcms_hr_commission_rules.name")
        // Issue #946: a shift TEMPLATE's label ("Morning", "Night") names a
        // pattern, never a person; assignments carry no label at all.
        .filter((c) => c !== "awcms_hr_shift_templates.name")
        // The publisher's justification for a BACK-DATED rule window (Issue #951):
        // operator text about a commercial term, kept on the rule row and never
        // echoed to an audit row (the audit carries a boolean). Everything else
        // an accrual stores is a code or an opaque reference, and
        // hr-commission-accrual-database scans the ledger tables itself.
        .filter((c) => c !== "awcms_hr_commission_rules.backdated_reason");

      expect(offenders).toEqual([]);
    });
  });

  describe("settings", () => {
    test("one row per tenant, bounded, and isolated", async () => {
      await inTenant(
        TENANT_A,
        (tx) => tx`
          INSERT INTO awcms_hr_workforce_settings (tenant_id, clock_skew_seconds)
          VALUES (${TENANT_A}, 120)
        `
      );
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            INSERT INTO awcms_hr_workforce_settings (tenant_id, clock_skew_seconds)
            VALUES (${TENANT_A}, 130)
          `
        ),
        /23505|duplicate key/i
      );
      await assertRejected(
        inTenant(
          TENANT_B,
          (tx) => tx`
            INSERT INTO awcms_hr_workforce_settings (tenant_id, clock_skew_seconds)
            VALUES (${TENANT_B}, 99999)
          `
        ),
        /skew_check|23514/
      );

      const seenByB = (await inTenant(
        TENANT_B,
        (tx) => tx`SELECT tenant_id FROM awcms_hr_workforce_settings`
      )) as unknown[];
      expect(seenByB).toHaveLength(0);
    });
  });
});
