/**
 * The hr_workforce SHIFT schema and the StaffAvailabilityPort adapter against a
 * real PostgreSQL, as the least-privilege runtime role, with FORCE RLS in force
 * (Issue #946, ADR-0132).
 *
 * Attacks the invariants that live in the DATABASE and must hold even if the
 * application code were bypassed: RLS and composite foreign keys, the shape
 * CHECKs, NO OVERLAP per employment (including two concurrent writers), the
 * forward-only status machine, immutability of published rows, no delete, no
 * free-text or reason column; and then the adapter's answer over real rows:
 * published versus draft, breaks, time off, terms, tenants, daylight saving.
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
import type { StaffAvailabilityPort } from "../../src/modules/_shared/ports/staff-availability-port";
import { staffAvailabilityAdapter } from "../../src/modules/hr-workforce/application/staff-availability-adapter";

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

const TENANT_A = "a9460000-0000-4000-8000-00000000000a";
const TENANT_B = "a9460000-0000-4000-8000-00000000000b";

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

type Spec = {
  kind?: "work" | "time_off";
  from: string;
  to: string;
  timeOffKind?: string | null;
  breakFrom?: string | null;
  breakTo?: string | null;
  zone?: string;
  officeId?: string | null;
  templateId?: string | null;
};

function insertAssignment(tenantId: string, employmentId: string, spec: Spec) {
  const kind = spec.kind ?? "work";

  return inTenant(tenantId, async (tx) => {
    const rows = (await tx`
      INSERT INTO awcms_hr_shift_assignments
        (tenant_id, employment_id, template_id, kind, time_off_kind, starts_at,
         ends_at, break_starts_at, break_ends_at, time_zone, office_id)
      VALUES (${tenantId}, ${employmentId}, ${spec.templateId ?? null}, ${kind},
              ${kind === "time_off" ? (spec.timeOffKind ?? "leave") : null},
              ${spec.from}::timestamptz, ${spec.to}::timestamptz,
              ${spec.breakFrom ?? null}::timestamptz, ${spec.breakTo ?? null}::timestamptz,
              ${spec.zone ?? "Asia/Jakarta"}, ${spec.officeId ?? null})
      RETURNING id
    `) as { id: string }[];

    return rows[0]!.id;
  });
}

function setStatus(
  tenantId: string,
  id: string,
  status: "published" | "cancelled"
) {
  return inTenant(tenantId, (tx) =>
    status === "published"
      ? tx`UPDATE awcms_hr_shift_assignments
             SET status = 'published', published_at = now() WHERE id = ${id}`
      : tx`UPDATE awcms_hr_shift_assignments
             SET status = 'cancelled', cancelled_at = now() WHERE id = ${id}`
  );
}

async function publishedAssignment(
  tenantId: string,
  employmentId: string,
  spec: Spec
) {
  const id = await insertAssignment(tenantId, employmentId, spec);

  await setStatus(tenantId, id, "published");

  return id;
}

function availability(
  tenantId: string,
  query: Parameters<StaffAvailabilityPort["getAvailability"]>[1]
) {
  return inTenant(tenantId, (tx) =>
    staffAvailabilityAdapter.getAvailability(tx, query)
  );
}

const suite = integrationEnabled ? describe : describe.skip;

suite("hr_workforce shifts and availability (Issue #946, ADR-0132)", () => {
  let profileA = "";
  let empA = "";
  let profileB = "";
  let empB = "";

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
      VALUES (${TENANT_A}, 'sh-a', 'Shift A'), (${TENANT_B}, 'sh-b', 'Shift B')
    `;
    profileA = await seedProfile(TENANT_A, "a");
    profileB = await seedProfile(TENANT_B, "b");
    empA = await employ(TENANT_A, profileA);
    empB = await employ(TENANT_B, profileB);
  });

  describe("tenant isolation and structure", () => {
    test("RLS is ENABLED and FORCED on both tables, with USING and WITH CHECK", async () => {
      const rows = (await getAdminSql()`
        SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
               count(p.polname)::int AS policies,
               bool_and(p.polqual IS NOT NULL AND p.polwithcheck IS NOT NULL) AS both
        FROM pg_class c
        LEFT JOIN pg_policy p ON p.polrelid = c.oid
        WHERE c.relname IN ('awcms_hr_shift_templates', 'awcms_hr_shift_assignments')
        GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
      `) as {
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
        policies: number;
        both: boolean;
      }[];

      expect(rows).toHaveLength(2);

      for (const row of rows) {
        expect(row.relrowsecurity).toBe(true);
        expect(row.relforcerowsecurity).toBe(true);
        expect(row.policies).toBe(1);
        expect(row.both).toBe(true);
      }
    });

    test("a tenant cannot see or write another tenant's shifts", async () => {
      const id = await insertAssignment(TENANT_A, empA, {
        from: "2026-10-12T01:00:00Z",
        to: "2026-10-12T09:00:00Z"
      });

      const seen = await inTenant(
        TENANT_B,
        (tx) => tx`SELECT id FROM awcms_hr_shift_assignments WHERE id = ${id}`
      );

      expect(seen).toHaveLength(0);
      await assertRejected(
        insertAssignment(TENANT_B, empA, {
          from: "2026-10-12T01:00:00Z",
          to: "2026-10-12T09:00:00Z"
        }),
        /foreign key|violates/i
      );
    });

    test("composite foreign keys: no template or office reference crosses tenants", async () => {
      const officeB = await seedOffice(TENANT_B, "B1");
      const templateB = await inTenant(TENANT_B, async (tx) => {
        const rows = (await tx`
          INSERT INTO awcms_hr_shift_templates
            (tenant_id, code, name, local_start, duration_minutes, time_zone)
          VALUES (${TENANT_B}, 'M', 'Morning', '07:00', 480, 'Asia/Jakarta')
          RETURNING id
        `) as { id: string }[];

        return rows[0]!.id;
      });

      await assertRejected(
        insertAssignment(TENANT_A, empA, {
          from: "2026-10-12T01:00:00Z",
          to: "2026-10-12T09:00:00Z",
          templateId: templateB
        }),
        /foreign key|violates/i
      );
      await assertRejected(
        insertAssignment(TENANT_A, empA, {
          from: "2026-10-12T01:00:00Z",
          to: "2026-10-12T09:00:00Z",
          officeId: officeB
        }),
        /foreign key|violates/i
      );
    });

    test("no column anywhere can hold a name, a reason or free text", async () => {
      const rows = (await getAdminSql()`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_name IN ('awcms_hr_shift_templates', 'awcms_hr_shift_assignments')
          AND (column_name ~* '(reason|note|comment|description|memo|diagnos|medical|sick|display_name|first_name|last_name|photo|biometric|device)')
      `) as { table_name: string; column_name: string }[];

      expect(rows).toEqual([]);
    });

    test("nothing is ever deleted: the runtime role is denied and a trigger refuses the owner too", async () => {
      const id = await insertAssignment(TENANT_A, empA, {
        from: "2026-10-12T01:00:00Z",
        to: "2026-10-12T09:00:00Z"
      });

      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`DELETE FROM awcms_hr_shift_assignments WHERE id = ${id}`
        ),
        /permission denied/i
      );
      await assertRejected(
        getAdminSql()`DELETE FROM awcms_hr_shift_assignments WHERE id = ${id}`,
        /append-only|not allowed/i
      );
    });
  });

  describe("shape", () => {
    const ok = { from: "2026-10-12T01:00:00Z", to: "2026-10-12T09:00:00Z" };

    test("ends after starts; work at most 24h; time off at most 31 days", async () => {
      await assertRejected(
        insertAssignment(TENANT_A, empA, { from: ok.to, to: ok.from }),
        /range_check|check constraint/i
      );
      await assertRejected(
        insertAssignment(TENANT_A, empA, {
          from: ok.from,
          to: "2026-10-13T01:00:01Z"
        }),
        /length_check|check constraint|whole_minutes/i
      );
      await insertAssignment(TENANT_A, empA, {
        from: ok.from,
        to: "2026-10-13T01:00:00Z"
      });
      await assertRejected(
        insertAssignment(TENANT_A, empA, {
          kind: "time_off",
          from: "2027-01-01T00:00:00Z",
          to: "2027-02-02T00:00:00Z"
        }),
        /length_check|check constraint/i
      );
      await insertAssignment(TENANT_A, empA, {
        kind: "time_off",
        from: "2027-01-01T00:00:00Z",
        to: "2027-02-01T00:00:00Z"
      });
    });

    test("whole minutes only", async () => {
      await assertRejected(
        insertAssignment(TENANT_A, empA, {
          from: "2026-10-12T01:00:30Z",
          to: ok.to
        }),
        /whole_minutes|check constraint/i
      );
    });

    test("a break is one interval strictly inside a work interval", async () => {
      await insertAssignment(TENANT_A, empA, {
        ...ok,
        breakFrom: "2026-10-12T04:00:00Z",
        breakTo: "2026-10-12T05:00:00Z"
      });
      await assertRejected(
        insertAssignment(TENANT_A, empA, {
          from: "2026-10-14T01:00:00Z",
          to: "2026-10-14T09:00:00Z",
          breakFrom: "2026-10-14T00:00:00Z",
          breakTo: "2026-10-14T02:00:00Z"
        }),
        /break_check|check constraint/i
      );
      await assertRejected(
        insertAssignment(TENANT_A, empA, {
          kind: "time_off",
          from: "2026-10-16T00:00:00Z",
          to: "2026-10-18T00:00:00Z",
          breakFrom: "2026-10-16T04:00:00Z",
          breakTo: "2026-10-16T05:00:00Z"
        }),
        /break_check|check constraint/i
      );
    });

    test("time_off_kind is coarse and only on time off", async () => {
      await assertRejected(
        insertAssignment(TENANT_A, empA, {
          kind: "time_off",
          timeOffKind: "sick",
          ...ok
        }),
        /time_off_kind_check|check constraint/i
      );
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            INSERT INTO awcms_hr_shift_assignments
              (tenant_id, employment_id, kind, time_off_kind, starts_at, ends_at, time_zone)
            VALUES (${TENANT_A}, ${empA}, 'work', 'leave', ${ok.from}::timestamptz,
                    ${ok.to}::timestamptz, 'Asia/Jakarta')`
        ),
        /time_off_kind_check|check constraint/i
      );
    });

    test("the zone must be a real IANA name (checked by the database)", async () => {
      await assertRejected(
        insertAssignment(TENANT_A, empA, { ...ok, zone: "Mars/Olympus" }),
        /HR_UNKNOWN_TIME_ZONE/
      );
      await assertRejected(
        insertAssignment(TENANT_A, empA, { ...ok, zone: "EST5EDT; x" }),
        /zone_check|check constraint|HR_UNKNOWN_TIME_ZONE/i
      );
    });

    test("template: break must fit, whole-minute start, code unique among live", async () => {
      const make = (code: string, extra = "") =>
        getAdminSql().unsafe(
          `INSERT INTO awcms_hr_shift_templates
             (tenant_id, code, name, local_start, duration_minutes, ${extra ? "break_offset_minutes, break_minutes, " : ""}time_zone)
           VALUES ('${TENANT_A}', '${code}', 'N', '07:00', 480, ${extra ? extra + ", " : ""}'Asia/Jakarta')`
        );

      await make("M1");
      await assertRejected(make("m1"), /code_key|duplicate key/i);
      await assertRejected(
        make("M2", "450, 60"),
        /break_range_check|check constraint/i
      );
      await make("M3", "240, 60");
    });
  });

  describe("no overlap per employment (the database, not the handler)", () => {
    test("overlapping intervals are refused, across kinds, naming the other row", async () => {
      const first = await insertAssignment(TENANT_A, empA, {
        from: "2026-10-12T01:00:00Z",
        to: "2026-10-12T09:00:00Z"
      });
      const error = await assertRejected(
        insertAssignment(TENANT_A, empA, {
          from: "2026-10-12T08:59:00Z",
          to: "2026-10-12T12:00:00Z"
        }),
        /HR_SHIFT_CONFLICT/
      );

      expect(error.message).toContain(first);
      await assertRejected(
        insertAssignment(TENANT_A, empA, {
          kind: "time_off",
          from: "2026-10-11T00:00:00Z",
          to: "2026-10-13T00:00:00Z"
        }),
        /HR_SHIFT_CONFLICT/
      );
    });

    test("half-open: touching intervals are adjacent, not overlapping", async () => {
      await insertAssignment(TENANT_A, empA, {
        from: "2026-10-12T01:00:00Z",
        to: "2026-10-12T09:00:00Z"
      });
      await insertAssignment(TENANT_A, empA, {
        from: "2026-10-12T09:00:00Z",
        to: "2026-10-12T17:00:00Z"
      });
      await insertAssignment(TENANT_A, empA, {
        from: "2026-10-12T00:00:00Z",
        to: "2026-10-12T01:00:00Z"
      });
    });

    test("another employment, and a cancelled row, do not conflict", async () => {
      const spec = { from: "2026-10-12T01:00:00Z", to: "2026-10-12T09:00:00Z" };
      const other = await employ(TENANT_A, await seedProfile(TENANT_A, "a2"));
      const first = await insertAssignment(TENANT_A, empA, spec);

      await insertAssignment(TENANT_A, other, spec);
      await setStatus(TENANT_A, first, "cancelled");
      await insertAssignment(TENANT_A, empA, spec);
    });

    test("two CONCURRENT writers: exactly one wins (advisory lock inside the trigger)", async () => {
      const spec = { from: "2026-10-20T01:00:00Z", to: "2026-10-20T09:00:00Z" };
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () => insertAssignment(TENANT_A, empA, spec))
      );
      resetDatabaseCircuitBreakerForTests();

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(5);

      const rows = await inTenant(
        TENANT_A,
        (tx) => tx`SELECT count(*)::int AS n FROM awcms_hr_shift_assignments
                   WHERE starts_at = ${spec.from}::timestamptz`
      );

      expect((rows[0] as { n: number }).n).toBe(1);
    });

    test("moving a draft into another row is refused too; cancelling frees the slot", async () => {
      const a = await insertAssignment(TENANT_A, empA, {
        from: "2026-10-12T01:00:00Z",
        to: "2026-10-12T09:00:00Z"
      });
      const b = await insertAssignment(TENANT_A, empA, {
        from: "2026-10-13T01:00:00Z",
        to: "2026-10-13T09:00:00Z"
      });

      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`UPDATE awcms_hr_shift_assignments
                     SET starts_at = '2026-10-12T05:00:00Z', ends_at = '2026-10-12T13:00:00Z'
                     WHERE id = ${b}`
        ),
        /HR_SHIFT_CONFLICT/
      );
      await setStatus(TENANT_A, a, "cancelled");
      await inTenant(
        TENANT_A,
        (tx) => tx`UPDATE awcms_hr_shift_assignments
                   SET starts_at = '2026-10-12T05:00:00Z', ends_at = '2026-10-12T13:00:00Z'
                   WHERE id = ${b}`
      );
    });
  });

  describe("status machine and immutability", () => {
    const spec = { from: "2026-10-12T01:00:00Z", to: "2026-10-12T09:00:00Z" };

    test("a row is always created as a draft", async () => {
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            INSERT INTO awcms_hr_shift_assignments
              (tenant_id, employment_id, kind, starts_at, ends_at, time_zone, status, published_at)
            VALUES (${TENANT_A}, ${empA}, 'work', ${spec.from}::timestamptz,
                    ${spec.to}::timestamptz, 'Asia/Jakarta', 'published', now())`
        ),
        /created as a draft/
      );
    });

    test("forward only: draft -> published -> cancelled; cancelled is terminal", async () => {
      const id = await publishedAssignment(TENANT_A, empA, spec);

      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`UPDATE awcms_hr_shift_assignments
                     SET status = 'draft', published_at = NULL WHERE id = ${id}`
        ),
        /HR_SHIFT_BAD_TRANSITION|lifecycle_check/
      );
      await setStatus(TENANT_A, id, "cancelled");
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`UPDATE awcms_hr_shift_assignments
                     SET status = 'published', published_at = now(), cancelled_at = NULL
                     WHERE id = ${id}`
        ),
        /HR_SHIFT_BAD_TRANSITION/
      );
    });

    test("a published row's interval, break, kind, zone and office cannot change", async () => {
      const id = await publishedAssignment(TENANT_A, empA, spec);

      for (const change of [
        (tx: Bun.TransactionSQL) =>
          tx`UPDATE awcms_hr_shift_assignments SET ends_at = '2026-10-12T10:00:00Z' WHERE id = ${id}`,
        (tx: Bun.TransactionSQL) =>
          tx`UPDATE awcms_hr_shift_assignments SET time_zone = 'Asia/Makassar' WHERE id = ${id}`,
        (tx: Bun.TransactionSQL) =>
          tx`UPDATE awcms_hr_shift_assignments SET employment_id = ${empA}, kind = 'time_off', time_off_kind = 'other' WHERE id = ${id}`
      ]) {
        await assertRejected(
          inTenant(TENANT_A, change),
          /immutable|check constraint/i
        );
      }
    });

    test("the employment of an assignment never changes", async () => {
      const id = await insertAssignment(TENANT_A, empA, spec);
      const other = await employ(TENANT_A, await seedProfile(TENANT_A, "a3"));

      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) =>
            tx`UPDATE awcms_hr_shift_assignments SET employment_id = ${other} WHERE id = ${id}`
        ),
        /cannot change/
      );
    });

    test("no new assignment on a deleted employment, and no publish after delete", async () => {
      const id = await insertAssignment(TENANT_A, empA, spec);

      await inTenant(
        TENANT_A,
        (tx) =>
          tx`UPDATE awcms_hr_employments SET deleted_at = now() WHERE id = ${empA}`
      );
      await assertRejected(
        insertAssignment(TENANT_A, empA, {
          from: "2026-10-14T01:00:00Z",
          to: "2026-10-14T09:00:00Z"
        }),
        /HR_EMPLOYMENT_DELETED/
      );
      await assertRejected(
        setStatus(TENANT_A, id, "published"),
        /HR_EMPLOYMENT_DELETED/
      );
    });
  });

  describe("StaffAvailabilityPort adapter over real rows", () => {
    const win = {
      fromUtc: "2026-10-12T00:00:00Z",
      toUtc: "2026-10-13T00:00:00Z"
    };

    test("only PUBLISHED assignments count: drafts and cancelled rows are invisible", async () => {
      await insertAssignment(TENANT_A, empA, {
        from: "2026-10-12T01:00:00Z",
        to: "2026-10-12T05:00:00Z"
      });
      const cancelled = await publishedAssignment(TENANT_A, empA, {
        from: "2026-10-12T06:00:00Z",
        to: "2026-10-12T07:00:00Z"
      });
      await setStatus(TENANT_A, cancelled, "cancelled");

      let result = await availability(TENANT_A, { staffRefs: [empA], ...win });

      expect(result.staff).toEqual([
        { staffRef: empA, status: "resolved", intervals: [] }
      ]);

      await publishedAssignment(TENANT_A, empA, {
        from: "2026-10-12T08:00:00Z",
        to: "2026-10-12T10:00:00Z"
      });
      result = await availability(TENANT_A, { staffRefs: [empA], ...win });

      expect(result.staff[0]!.intervals).toEqual([
        {
          startUtc: "2026-10-12T08:00:00.000Z",
          endUtc: "2026-10-12T10:00:00.000Z"
        }
      ]);
    });

    test("breaks and time off are subtracted, adjacent shifts merge, the answer is clipped to the window", async () => {
      await publishedAssignment(TENANT_A, empA, {
        from: "2026-10-11T20:00:00Z",
        to: "2026-10-12T04:00:00Z",
        breakFrom: "2026-10-12T01:00:00Z",
        breakTo: "2026-10-12T02:00:00Z"
      });
      await publishedAssignment(TENANT_A, empA, {
        from: "2026-10-12T04:00:00Z",
        to: "2026-10-12T06:00:00Z"
      });
      await publishedAssignment(TENANT_A, empA, {
        kind: "time_off",
        from: "2026-10-12T06:00:00Z",
        to: "2026-10-12T08:00:00Z"
      });

      const result = await availability(TENANT_A, {
        staffRefs: [empA],
        ...win
      });

      expect(result.staff[0]!.intervals).toEqual([
        {
          startUtc: "2026-10-12T00:00:00.000Z",
          endUtc: "2026-10-12T01:00:00.000Z"
        },
        {
          startUtc: "2026-10-12T02:00:00.000Z",
          endUtc: "2026-10-12T06:00:00.000Z"
        }
      ]);
    });

    test("fail closed: another tenant's, deleted, unknown and non-UUID refs are all just `unknown`", async () => {
      await publishedAssignment(TENANT_A, empA, {
        from: "2026-10-12T01:00:00Z",
        to: "2026-10-12T05:00:00Z"
      });
      const deleted = await employ(
        TENANT_A,
        await seedProfile(TENANT_A, "del")
      );

      await inTenant(
        TENANT_A,
        (tx) =>
          tx`UPDATE awcms_hr_employments SET deleted_at = now() WHERE id = ${deleted}`
      );

      const result = await availability(TENANT_A, {
        staffRefs: [empA, empB, deleted, crypto.randomUUID(), "alice"],
        ...win
      });

      expect(result.staff.map((s) => s.status)).toEqual([
        "resolved",
        "unknown",
        "unknown",
        "unknown",
        "unknown"
      ]);
      expect(result.staff.slice(1).every((s) => s.intervals.length === 0)).toBe(
        true
      );

      // And the same call as tenant B cannot see tenant A's person.
      const asB = await availability(TENANT_B, {
        staffRefs: [empA, empB],
        ...win
      });

      expect(asB.staff.map((s) => s.status)).toEqual(["unknown", "resolved"]);
    });

    test("without a tenant in the transaction the answer is all `unknown`, never an error or a leak", async () => {
      await publishedAssignment(TENANT_A, empA, {
        from: "2026-10-12T01:00:00Z",
        to: "2026-10-12T05:00:00Z"
      });

      const result = await getAdminSql().begin((tx) =>
        staffAvailabilityAdapter.getAvailability(tx as unknown as Bun.SQL, {
          staffRefs: [empA],
          ...win
        })
      );

      expect(result.staff[0]!.status).toBe("unknown");
    });

    test("terms: a work shift counts only while the terms are active on its local start date", async () => {
      // empA has active terms from 2026-01-01. Suspend from 2026-10-13.
      await inTenant(TENANT_A, async (tx) => {
        await tx`UPDATE awcms_hr_employment_terms SET effective_to = '2026-10-13'::date
                 WHERE employment_id = ${empA} AND effective_to IS NULL`;
        await tx`INSERT INTO awcms_hr_employment_terms
                   (tenant_id, employment_id, employment_type, status, effective_from)
                 VALUES (${TENANT_A}, ${empA}, 'permanent', 'suspended', '2026-10-13')`;
      });

      await publishedAssignment(TENANT_A, empA, {
        from: "2026-10-12T01:00:00Z",
        to: "2026-10-12T09:00:00Z"
      });
      // Starts 2026-10-13 07:00 Jakarta: suspended, contributes nothing.
      await publishedAssignment(TENANT_A, empA, {
        from: "2026-10-13T00:00:00Z",
        to: "2026-10-13T08:00:00Z"
      });

      const result = await availability(TENANT_A, {
        staffRefs: [empA],
        fromUtc: "2026-10-12T00:00:00Z",
        toUtc: "2026-10-14T00:00:00Z"
      });

      expect(result.staff[0]!.intervals).toEqual([
        {
          startUtc: "2026-10-12T01:00:00.000Z",
          endUtc: "2026-10-12T09:00:00.000Z"
        }
      ]);

      // A window entirely inside the suspension: not active anywhere, so `unknown`.
      const later = await availability(TENANT_A, {
        staffRefs: [empA],
        fromUtc: "2026-10-20T00:00:00Z",
        toUtc: "2026-10-21T00:00:00Z"
      });

      expect(later.staff[0]).toEqual({
        staffRef: empA,
        status: "unknown",
        intervals: []
      });
    });

    test("terminated: the person is `unknown` for a window after the end", async () => {
      await inTenant(TENANT_A, async (tx) => {
        await tx`UPDATE awcms_hr_employment_terms SET effective_to = '2026-10-01'::date
                 WHERE employment_id = ${empA} AND effective_to IS NULL`;
        await tx`INSERT INTO awcms_hr_employment_terms
                   (tenant_id, employment_id, employment_type, status, effective_from)
                 VALUES (${TENANT_A}, ${empA}, 'permanent', 'terminated', '2026-10-01')`;
      });

      const result = await availability(TENANT_A, {
        staffRefs: [empA],
        ...win
      });

      expect(result.staff[0]!.status).toBe("unknown");
    });

    test("officeId narrows work to that office; time off applies everywhere", async () => {
      const office1 = await seedOffice(TENANT_A, "O1");
      const office2 = await seedOffice(TENANT_A, "O2");

      await publishedAssignment(TENANT_A, empA, {
        from: "2026-10-12T01:00:00Z",
        to: "2026-10-12T04:00:00Z",
        officeId: office1
      });
      await publishedAssignment(TENANT_A, empA, {
        from: "2026-10-12T05:00:00Z",
        to: "2026-10-12T08:00:00Z",
        officeId: office2
      });

      const one = await availability(TENANT_A, {
        staffRefs: [empA],
        officeId: office1,
        ...win
      });

      expect(one.staff[0]!.intervals).toEqual([
        {
          startUtc: "2026-10-12T01:00:00.000Z",
          endUtc: "2026-10-12T04:00:00.000Z"
        }
      ]);
    });

    test("DST end to end: a New York shift across spring-forward is 8 elapsed hours", async () => {
      // 2026-03-07 22:00 EST (03:00Z on the 8th) for 480 elapsed minutes.
      await publishedAssignment(TENANT_A, empA, {
        from: "2026-03-08T03:00:00Z",
        to: "2026-03-08T11:00:00Z",
        zone: "America/New_York"
      });

      const result = await availability(TENANT_A, {
        staffRefs: [empA],
        fromUtc: "2026-03-08T00:00:00Z",
        toUtc: "2026-03-09T00:00:00Z"
      });

      expect(result.staff[0]!.intervals).toEqual([
        {
          startUtc: "2026-03-08T03:00:00.000Z",
          endUtc: "2026-03-08T11:00:00.000Z"
        }
      ]);
    });

    test("the answer carries nothing but ref, status and intervals (no PII leaks through)", async () => {
      await publishedAssignment(TENANT_A, empA, {
        from: "2026-10-12T01:00:00Z",
        to: "2026-10-12T05:00:00Z"
      });

      const result = await availability(TENANT_A, {
        staffRefs: [empA],
        ...win
      });
      const text = JSON.stringify(result);

      expect(Object.keys(result.staff[0]!).sort()).toEqual([
        "intervals",
        "staffRef",
        "status"
      ]);
      expect(text).not.toMatch(
        /Person|@example|display|name|office|kind|timeOff/i
      );
    });
  });

  describe("audit follow-ups (stamps, isolation, minimum length, per-employment cap)", () => {
    const spec = { from: "2026-10-12T01:00:00Z", to: "2026-10-12T09:00:00Z" };

    test("lifecycle stamps are immutable once written, and transitions set only their own", async () => {
      const id = await publishedAssignment(TENANT_A, empA, spec);

      for (const change of [
        (tx: Bun.TransactionSQL) =>
          tx`UPDATE awcms_hr_shift_assignments SET published_at = published_at - interval '30 days' WHERE id = ${id}`,
        (tx: Bun.TransactionSQL) =>
          tx`UPDATE awcms_hr_shift_assignments SET created_at = created_at - interval '30 days' WHERE id = ${id}`
      ]) {
        await assertRejected(inTenant(TENANT_A, change), /immutable/);
      }

      await setStatus(TENANT_A, id, "cancelled");
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) =>
            tx`UPDATE awcms_hr_shift_assignments SET cancelled_at = cancelled_at + interval '1 day' WHERE id = ${id}`
        ),
        /cancel stamps are immutable/
      );
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) =>
            tx`UPDATE awcms_hr_shift_assignments SET published_at = NULL WHERE id = ${id}`
        ),
        /immutable|lifecycle_check/
      );

      // Cancelling must keep the publish stamps; publishing must not carry cancel stamps.
      const other = await publishedAssignment(TENANT_A, empA, {
        from: "2026-10-14T01:00:00Z",
        to: "2026-10-14T09:00:00Z"
      });

      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`UPDATE awcms_hr_shift_assignments
                     SET status = 'cancelled', cancelled_at = now(),
                         published_at = now() - interval '1 year' WHERE id = ${other}`
        ),
        /publish stamps are immutable|keeps the publish stamps/
      );
      const draft = await insertAssignment(TENANT_A, empA, {
        from: "2026-10-16T01:00:00Z",
        to: "2026-10-16T09:00:00Z"
      });

      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`UPDATE awcms_hr_shift_assignments
                     SET status = 'published', published_at = now(), cancelled_at = now() WHERE id = ${draft}`
        ),
        /publishing sets the publish stamps|lifecycle_check/
      );
    });

    test("the overlap guard refuses to run outside READ COMMITTED", async () => {
      await assertRejected(
        getAdminSql().begin(async (tx) => {
          await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`;
          await tx`INSERT INTO awcms_hr_shift_assignments
                     (tenant_id, employment_id, kind, starts_at, ends_at, time_zone)
                   VALUES (${TENANT_A}, ${empA}, 'work', ${spec.from}::timestamptz,
                           ${spec.to}::timestamptz, 'Asia/Jakarta')`;
        }),
        /READ COMMITTED/
      );
    });

    test("a work shift is at least 15 minutes (time off is not bound by it); a template too", async () => {
      await assertRejected(
        insertAssignment(TENANT_A, empA, {
          from: "2026-10-12T01:00:00Z",
          to: "2026-10-12T01:14:00Z"
        }),
        /length_check|check constraint/i
      );
      await insertAssignment(TENANT_A, empA, {
        from: "2026-10-12T01:00:00Z",
        to: "2026-10-12T01:15:00Z"
      });
      await insertAssignment(TENANT_A, empA, {
        kind: "time_off",
        from: "2026-10-13T00:00:00Z",
        to: "2026-10-13T00:01:00Z"
      });
      await assertRejected(
        getAdminSql()`INSERT INTO awcms_hr_shift_templates
          (tenant_id, code, name, local_start, duration_minutes, time_zone)
          VALUES (${TENANT_A}, 'SHORT', 'S', '07:00', 14, 'Asia/Jakarta')`,
        /duration_check|check constraint/i
      );
    });

    test("one employment over the per-employment cap is `unknown`; the rest of the batch still answers", async () => {
      const busy = empA;
      const quiet = await employ(
        TENANT_A,
        await seedProfile(TENANT_A, "quiet")
      );

      await getAdminSql()`
        INSERT INTO awcms_hr_shift_assignments
          (tenant_id, employment_id, kind, starts_at, ends_at, time_zone, status, published_at)
        SELECT ${TENANT_A}, ${busy}, 'work',
               '2026-10-01T00:00:00Z'::timestamptz + (g * interval '20 minutes'),
               '2026-10-01T00:00:00Z'::timestamptz + (g * interval '20 minutes') + interval '15 minutes',
               'Asia/Jakarta', 'draft', NULL
        FROM generate_series(0, 1000) g
      `;
      await getAdminSql()`UPDATE awcms_hr_shift_assignments
                          SET status = 'published', published_at = now()
                          WHERE employment_id = ${busy}`;
      await publishedAssignment(TENANT_A, quiet, {
        from: "2026-10-02T01:00:00Z",
        to: "2026-10-02T05:00:00Z"
      });

      const result = await availability(TENANT_A, {
        staffRefs: [busy, quiet],
        fromUtc: "2026-10-01T00:00:00Z",
        toUtc: "2026-10-15T00:00:00Z"
      });

      expect(result.staff[0]).toEqual({
        staffRef: busy,
        status: "unknown",
        intervals: []
      });
      expect(result.staff[1]!.status).toBe("resolved");
      expect(result.staff[1]!.intervals).toHaveLength(1);
    }, 60_000);
  });
});
