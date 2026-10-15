/**
 * A subject export reaches a table through its PARENT row (ADR-0142, Issue #985)
 * against a real PostgreSQL, as the least-privilege runtime role, FORCE RLS on.
 *
 * `awcms_hr_employment_terms` and `awcms_hr_shift_assignments` never carry a
 * person's id; `employment_id` -> `awcms_hr_employments` (`profile_id` /
 * `tenant_user_id`) does. Every test here asserts something only a database can
 * answer, because the join is a generated SQL string:
 *
 *   1. The employee's export contains their OWN terms history and shift
 *      assignments, and NOT another employee's.
 *   2. The actor stamps do not leak: the HR user who recorded another person's
 *      rows exports none of them (the OR-with-`created_by` mistake).
 *   3. Tenant isolation: another tenant's employee, even with a look-alike
 *      shape, never appears.
 *   4. Both ways of being the employee work: via the profile and via the login.
 *   5. Erasure does not follow the join: the rows survive an erasure of the
 *      same subject (retained under obligation), and the planner would not
 *      even hand them to the executor.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
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
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { listModules } from "../../src/modules";
import {
  loadColumnTypes,
  loadUniqueColumns,
  readSubjectExport,
  runSubjectErasure
} from "../../src/modules/data-lifecycle/application/subject-data-executor";
import { resolveSubject } from "../../src/modules/data-lifecycle/application/subject-request-service";
import {
  buildSubjectPlan,
  erasureTargets,
  type SubjectIdentifiers
} from "../../src/modules/data-lifecycle/domain/subject-data-plan";
import { collectSubjectDataDescriptors } from "../../src/modules/data-lifecycle/domain/subject-data-registry";

const TENANT_A = "a9850000-0000-4000-8000-00000000000a";
const TENANT_B = "a9850000-0000-4000-8000-00000000000b";

type Person = { userId: string; identityId: string; profileId: string };

let employee: Person; // the subject, employed (header linked by profile AND login)
let colleague: Person; // another employee of the same tenant
let hrUser: Person; // recorded other people's rows; has no employment of their own
let outsider: Person; // an employee of tenant B

let employeeEmployment = "";
let colleagueEmployment = "";
let outsiderEmployment = "";

async function seedPerson(
  tenantId: string,
  tag: string,
  userId: string
): Promise<Person> {
  const admin = getAdminSql();
  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`Person ${tag}`})
    RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${tag}@example.test`}, 'hash')
    RETURNING id
  `) as { id: string }[];
  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
    VALUES (${userId}, ${tenantId}, ${identity[0]!.id})
  `;

  return {
    userId,
    identityId: identity[0]!.id,
    profileId: profile[0]!.id
  };
}

/** Header + two terms + two shifts, written as the runtime role; stamped with `createdBy`. */
async function employ(
  tenantId: string,
  person: Person,
  employeeNo: string,
  createdBy: string,
  linkLogin: boolean
): Promise<string> {
  return withTenantOrThrow(getRuntimeSql(), tenantId, async (tx) => {
    const header = (await tx`
      INSERT INTO awcms_hr_employments
        (tenant_id, profile_id, tenant_user_id, employee_no, hired_on, created_by)
      VALUES (${tenantId}, ${person.profileId}, ${linkLogin ? person.userId : null},
              ${employeeNo}, '2026-01-01', ${createdBy})
      RETURNING id
    `) as { id: string }[];
    const id = header[0]!.id;

    await tx`
      INSERT INTO awcms_hr_employment_terms
        (tenant_id, employment_id, employment_type, status, effective_from,
         effective_to, job_title, created_by)
      VALUES
        (${tenantId}, ${id}, 'fixed_term', 'active', '2026-01-01', '2026-06-01',
         ${`first ${employeeNo}`}, ${createdBy}),
        (${tenantId}, ${id}, 'permanent', 'active', '2026-06-01', NULL,
         ${`second ${employeeNo}`}, ${createdBy})
    `;
    await tx`
      INSERT INTO awcms_hr_shift_assignments
        (tenant_id, employment_id, kind, time_off_kind, starts_at, ends_at,
         time_zone, created_by)
      VALUES
        (${tenantId}, ${id}, 'work', NULL, '2026-07-01T01:00:00Z',
         '2026-07-01T09:00:00Z', 'Asia/Jakarta', ${createdBy}),
        (${tenantId}, ${id}, 'time_off', 'leave', '2026-07-02T01:00:00Z',
         '2026-07-02T09:00:00Z', 'Asia/Jakarta', ${createdBy})
    `;

    return id;
  });
}

function planFor(tenantId: string, person: Person) {
  return planForIds({
    tenantId,
    tenantUserId: person.userId,
    identityId: person.identityId,
    profileId: person.profileId
  });
}

function planForIds(ids: SubjectIdentifiers) {
  return buildSubjectPlan(collectSubjectDataDescriptors(listModules()), ids);
}

async function exportFor(
  tenantId: string,
  person: Person
): Promise<Map<string, Record<string, unknown>[]>> {
  const tables = await withTenantOrThrow(
    getRuntimeSql(),
    tenantId,
    async (tx) => {
      const resolution = await resolveSubject(tx, tenantId, person.userId);
      if (!resolution.resolved) throw new Error("subject did not resolve");
      const plan = planForIds({ ...resolution.subject, tenantId });
      const columnTypes = await loadColumnTypes(
        tx,
        plan.exportEntries.map((entry) => entry.tableName)
      );
      return readSubjectExport(tx, tenantId, plan, columnTypes);
    }
  );

  return new Map(
    tables.map((table) => [table.tableName, [...table.rows]] as const)
  );
}

const suite = integrationEnabled ? describe : describe.skip;

suite(
  "subject export reaches a table through its parent row (ADR-0142, #985)",
  () => {
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
      VALUES (${TENANT_A}, 'sv-a', 'Via A'), (${TENANT_B}, 'sv-b', 'Via B')
    `;

      employee = await seedPerson(
        TENANT_A,
        "employee",
        "a9850000-0000-4000-8000-000000000001"
      );
      colleague = await seedPerson(
        TENANT_A,
        "colleague",
        "a9850000-0000-4000-8000-000000000002"
      );
      hrUser = await seedPerson(
        TENANT_A,
        "hr",
        "a9850000-0000-4000-8000-000000000003"
      );
      outsider = await seedPerson(
        TENANT_B,
        "outsider",
        "b9850000-0000-4000-8000-000000000001"
      );

      // The HR user recorded EVERYTHING in tenant A: the stamp trap.
      employeeEmployment = await employ(
        TENANT_A,
        employee,
        "E-1",
        hrUser.userId,
        true
      );
      colleagueEmployment = await employ(
        TENANT_A,
        colleague,
        "E-2",
        hrUser.userId,
        false
      );
      outsiderEmployment = await employ(
        TENANT_B,
        outsider,
        "E-1",
        outsider.userId,
        true
      );
    });

    test("the plan reaches both tables through the employment, with no stamp column", () => {
      const plan = planFor(TENANT_A, employee);

      for (const key of [
        "hr_workforce.employment_terms",
        "hr_workforce.shift_assignments"
      ]) {
        const entry = plan.exportEntries.find((e) => e.key === key);
        expect(entry).toBeDefined();
        expect(entry!.matches).toEqual([]);
        expect(entry!.via?.column).toBe("employment_id");
        expect(entry!.via?.parentTableName).toBe("awcms_hr_employments");
        expect(entry!.via?.parentMatches.map((m) => m.column).sort()).toEqual([
          "last_tenant_user_id",
          "profile_id",
          "tenant_user_id"
        ]);
      }
    });

    test("the employee's export carries their OWN terms history and shifts, not a colleague's", async () => {
      const exported = await exportFor(TENANT_A, employee);

      const terms = exported.get("awcms_hr_employment_terms")!;
      expect(terms).toHaveLength(2);
      expect(new Set(terms.map((row) => row.employment_id))).toEqual(
        new Set([employeeEmployment])
      );
      expect(terms.map((row) => row.job_title).sort()).toEqual([
        "first E-1",
        "second E-1"
      ]);

      const shifts = exported.get("awcms_hr_shift_assignments")!;
      expect(shifts).toHaveLength(2);
      expect(new Set(shifts.map((row) => row.employment_id))).toEqual(
        new Set([employeeEmployment])
      );
      expect(shifts.map((row) => row.kind).sort()).toEqual([
        "time_off",
        "work"
      ]);

      const everyEmployment = [...terms, ...shifts].map(
        (row) => row.employment_id
      );
      expect(everyEmployment).not.toContain(colleagueEmployment);
      expect(everyEmployment).not.toContain(outsiderEmployment);
    });

    test("an employee linked ONLY by profile (no login link) is still found", async () => {
      // The colleague's header has tenant_user_id NULL; `profile_id` reaches them.
      const exported = await exportFor(TENANT_A, colleague);

      expect(exported.get("awcms_hr_employment_terms")).toHaveLength(2);
      expect(exported.get("awcms_hr_shift_assignments")).toHaveLength(2);
      expect(
        new Set(
          exported.get("awcms_hr_employment_terms")!.map((r) => r.employment_id)
        )
      ).toEqual(new Set([colleagueEmployment]));
    });

    test("the HR user who recorded everyone's rows exports NONE of them", async () => {
      // `created_by` names the scheduler/recorder. Following it would hand the
      // administrator every employee's history under the administrator's request.
      const exported = await exportFor(TENANT_A, hrUser);

      expect(exported.get("awcms_hr_employment_terms")).toEqual([]);
      expect(exported.get("awcms_hr_shift_assignments")).toEqual([]);
    });

    test("another tenant's employee never appears, in either direction", async () => {
      const mine = await exportFor(TENANT_A, employee);
      const theirs = await exportFor(TENANT_B, outsider);

      expect(theirs.get("awcms_hr_employment_terms")).toHaveLength(2);
      expect(
        new Set(
          theirs.get("awcms_hr_employment_terms")!.map((r) => r.employment_id)
        )
      ).toEqual(new Set([outsiderEmployment]));
      expect(
        mine.get("awcms_hr_employment_terms")!.map((r) => r.employment_id)
      ).not.toContain(outsiderEmployment);

      // Asking tenant A's database context about tenant B's person finds nothing:
      // RLS and the explicit tenant predicate (also inside the subquery).
      const crossed = await withTenantOrThrow(
        getRuntimeSql(),
        TENANT_A,
        async (tx) => {
          const plan = planFor(TENANT_A, outsider);
          const columnTypes = await loadColumnTypes(
            tx,
            plan.exportEntries.map((entry) => entry.tableName)
          );
          return readSubjectExport(tx, TENANT_A, plan, columnTypes);
        }
      );
      const crossedTerms = crossed.find(
        (table) => table.tableName === "awcms_hr_employment_terms"
      );
      expect(crossedTerms?.rows).toEqual([]);
    });

    test("erasure does NOT follow the join: the rows survive, and the executor is never handed them", async () => {
      const admin = getAdminSql();

      await withTenantOrThrow(getRuntimeSql(), TENANT_A, async (tx) => {
        const plan = planFor(TENANT_A, employee);
        expect(
          erasureTargets(plan).some((entry) => entry.via !== undefined)
        ).toBe(false);
        const tables = plan.entries.map((entry) => entry.tableName);
        await runSubjectErasure(
          tx,
          TENANT_A,
          plan,
          await loadColumnTypes(tx, tables),
          await loadUniqueColumns(tx, tables)
        );
      });

      const terms = (await admin`
      SELECT count(*)::int AS n FROM awcms_hr_employment_terms
      WHERE employment_id = ${employeeEmployment}
    `) as { n: number }[];
      const shifts = (await admin`
      SELECT count(*)::int AS n FROM awcms_hr_shift_assignments
      WHERE employment_id = ${employeeEmployment}
    `) as { n: number }[];
      expect(terms[0]!.n).toBe(2);
      expect(shifts[0]!.n).toBe(2);
    });
  }
);
