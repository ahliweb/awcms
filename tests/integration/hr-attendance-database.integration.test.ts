/**
 * The hr_workforce ATTENDANCE schema against a real PostgreSQL, as the
 * least-privilege runtime role, with FORCE RLS in force (Issue #947, ADR-0132).
 *
 * Attacks the invariants that live in the DATABASE and must hold even if the
 * application code were bypassed: RLS and composite foreign keys; the events are
 * append-only (UPDATE and DELETE refused for the runtime role by privilege and for
 * the owner by trigger); the server clock overwrites `recorded_at`; the skew bound
 * refuses a future claim; a self/supervisor event cannot be back-dated while a
 * kiosk/import replay is accepted and flagged `late` (and refused past seven
 * days); a replay of a client event key is a unique violation; a correction never
 * edits an event and an event is superseded once, only by an approved correction;
 * the correction status follows the workflow verdict, the requester can never be
 * the approver (directly, as a delegator, or by CHECK), approval without its
 * event cannot commit; and the manager-chain read below an employee.
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

const TENANT_A = "a9470000-0000-4000-8000-00000000000a";
const TENANT_B = "a9470000-0000-4000-8000-00000000000b";

function inTenant<T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return withTenantOrThrow(getRuntimeSql(), tenantId, fn);
}

let counter = 0;

async function seedProfile(tenantId: string, tag: string): Promise<string> {
  const rows = (await getAdminSql()`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`Person ${tag}`})
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

/** A login (tenant user): the requester, approver or recorder of an event. */
async function seedUser(tenantId: string, tag: string): Promise<string> {
  counter += 1;
  const sql = getAdminSql();
  const profile = await seedProfile(tenantId, `user-${tag}-${counter}`);
  const identity = (await sql`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile}, ${`u${counter}-${tag}@example.com`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const user = (await sql`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id})
    RETURNING id
  `) as { id: string }[];

  return user[0]!.id;
}

/** An employment header + its first term, written as the RUNTIME role. */
async function employ(
  tenantId: string,
  extra: { managerId?: string | null } = {}
): Promise<string> {
  counter += 1;
  const profileId = await seedProfile(tenantId, `emp-${counter}`);

  return inTenant(tenantId, async (tx) => {
    const header = (await tx`
      INSERT INTO awcms_hr_employments (tenant_id, profile_id, employee_no, hired_on)
      VALUES (${tenantId}, ${profileId}, ${`N-${counter}`}, '2026-01-01')
      RETURNING id
    `) as { id: string }[];

    await tx`
      INSERT INTO awcms_hr_employment_terms
        (tenant_id, employment_id, manager_employment_id, employment_type,
         status, effective_from)
      VALUES (${tenantId}, ${header[0]!.id}, ${extra.managerId ?? null},
              'permanent', 'active', '2026-01-01')
    `;

    return header[0]!.id;
  });
}

type EventSpec = {
  kind?: string;
  /** Seconds relative to the database clock; negative = in the past. */
  offsetSeconds?: number;
  source?: string;
  key?: string;
  supersedes?: string | null;
  correctionId?: string | null;
  recordedAt?: string | null;
  recordedBy?: string | null;
};

function insertEvent(
  tenantId: string,
  employmentId: string,
  spec: EventSpec = {}
) {
  counter += 1;

  return inTenant(tenantId, async (tx) => {
    const rows = (await tx`
      INSERT INTO awcms_hr_attendance_events
        (tenant_id, employment_id, kind, occurred_at, source, client_event_key,
         supersedes_event_id, correction_id, recorded_at, recorded_by)
      VALUES (${tenantId}, ${employmentId}, ${spec.kind ?? "clock_in"},
              clock_timestamp() + (${spec.offsetSeconds ?? 0} * interval '1 second'),
              ${spec.source ?? "self"}, ${spec.key ?? `k-${counter}`},
              ${spec.supersedes ?? null}, ${spec.correctionId ?? null},
              COALESCE(${spec.recordedAt ?? null}::timestamptz, clock_timestamp()),
              ${spec.recordedBy ?? null})
      RETURNING id
    `) as { id: string }[];

    return rows[0]!.id;
  });
}

type InstanceSpec = {
  status?: string;
  requestedBy: string;
  resourceId: string;
};

/**
 * HR's guard triggers are exercised with workflow rows the ENGINE would never
 * produce (an approval with no decision, a decision by an arbitrary user). The
 * workflow engine's own bindings (`sql/252`, `sql/301`) refuse those writes, so
 * these fixtures step outside them the way a superuser maintenance session
 * does: `session_replication_role = replica`, for the fixture statements only.
 */
async function asMaintenance<T>(
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return getAdminSql().begin(async (tx) => {
    await tx.unsafe("SET LOCAL session_replication_role = replica");

    return fn(tx);
  }) as Promise<T>;
}

/** A workflow definition + instance (+ task) for a correction, written by the admin. */
async function seedInstance(
  tenantId: string,
  spec: InstanceSpec
): Promise<{ instanceId: string; taskId: string }> {
  return asMaintenance(async (sql) => {
    const definition = (await sql`
    INSERT INTO awcms_workflow_definitions
      (tenant_id, workflow_key, name, version, lifecycle_status, graph)
    VALUES (${tenantId}, ${`hr.attendance_correction.${crypto.randomUUID()}`},
            'Correction', 1, 'active',
            ${{ startNodeId: "e", nodes: [{ id: "e", type: "end", outcome: "approved" }] }}::jsonb)
    RETURNING id
  `) as { id: string }[];
    const instance = (await sql`
    INSERT INTO awcms_workflow_instances
      (tenant_id, workflow_definition_id, resource_type, resource_id, status,
       requested_by_tenant_user_id)
    VALUES (${tenantId}, ${definition[0]!.id}, 'hr_attendance_correction',
            ${spec.resourceId}, ${spec.status ?? "pending"}, ${spec.requestedBy})
    RETURNING id
  `) as { id: string }[];
    const task = (await sql`
    INSERT INTO awcms_workflow_tasks (tenant_id, workflow_instance_id, node_id)
    VALUES (${tenantId}, ${instance[0]!.id}, 'approval')
    RETURNING id
  `) as { id: string }[];

    return { instanceId: instance[0]!.id, taskId: task[0]!.id };
  });
}

async function decide(
  tenantId: string,
  taskId: string,
  by: string,
  decision = "approve",
  onBehalfOf: string | null = null
) {
  await asMaintenance(
    (tx) => tx`
    INSERT INTO awcms_workflow_decisions
      (tenant_id, workflow_task_id, decision, decided_by_tenant_user_id,
       on_behalf_of_tenant_user_id)
    VALUES (${tenantId}, ${taskId}, ${decision}, ${by}, ${onBehalfOf})
  `
  );
}

async function setInstanceStatus(instanceId: string, status: string) {
  await asMaintenance(
    (tx) => tx`
    UPDATE awcms_workflow_instances SET status = ${status} WHERE id = ${instanceId}
  `
  );
}

type CorrectionSpec = {
  id?: string;
  kind?: "add" | "replace";
  target?: string | null;
  proposedKind?: string;
  /** Seconds relative to the database clock. */
  proposedOffset?: number;
  reason?: string;
  instanceId: string;
  requestedBy: string;
};

function insertCorrection(
  tenantId: string,
  employmentId: string,
  spec: CorrectionSpec
) {
  const id = spec.id ?? crypto.randomUUID();

  return inTenant(tenantId, async (tx) => {
    await tx`
      INSERT INTO awcms_hr_attendance_corrections
        (id, tenant_id, employment_id, kind, target_event_id, proposed_kind,
         proposed_occurred_at, reason, workflow_instance_id, requested_by)
      VALUES (${id}, ${tenantId}, ${employmentId}, ${spec.kind ?? "add"},
              ${spec.target ?? null}, ${spec.proposedKind ?? "clock_out"},
              now() - (${-(spec.proposedOffset ?? -3600)} * interval '1 second'),
              ${spec.reason ?? "forgot to clock"}, ${spec.instanceId},
              ${spec.requestedBy})
    `;

    return id;
  });
}

/** A pending correction with its instance, ready for a verdict. */
async function pendingCorrection(
  tenantId: string,
  employmentId: string,
  requester: string,
  extra: Partial<CorrectionSpec> = {}
) {
  const id = crypto.randomUUID();
  const { instanceId, taskId } = await seedInstance(tenantId, {
    requestedBy: requester,
    resourceId: id
  });

  await insertCorrection(tenantId, employmentId, {
    ...extra,
    id,
    instanceId,
    requestedBy: requester
  });

  return { id, instanceId, taskId };
}

/** Approves + applies in ONE transaction, as the application does. */
function approveAndApply(
  tenantId: string,
  c: {
    id: string;
    employmentId: string;
    approver: string;
    kind?: string;
    occurredOffset?: number;
    supersedes?: string | null;
    skipEvent?: boolean;
  }
) {
  return inTenant(tenantId, async (tx) => {
    await tx`
      UPDATE awcms_hr_attendance_corrections
      SET status = 'approved', decided_by = ${c.approver}, decided_at = now(),
          updated_at = now()
      WHERE id = ${c.id}
    `;

    if (!c.skipEvent) {
      await tx`
        INSERT INTO awcms_hr_attendance_events
          (tenant_id, employment_id, kind, occurred_at, source,
           client_event_key, supersedes_event_id, correction_id)
        SELECT tenant_id, employment_id, proposed_kind, proposed_occurred_at,
               'correction', ${`correction:${c.id}`}, target_event_id, id
        FROM awcms_hr_attendance_corrections WHERE id = ${c.id}
      `;
    }
  });
}

const suite = integrationEnabled ? describe : describe.skip;

suite("hr_workforce attendance database invariants (Issue #947)", () => {
  let empA = "";
  let empB = "";
  let userA = "";
  let approverA = "";

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
      VALUES (${TENANT_A}, 'at-a', 'Attendance A'), (${TENANT_B}, 'at-b', 'Attendance B')
    `;
    empA = await employ(TENANT_A);
    empB = await employ(TENANT_B);
    userA = await seedUser(TENANT_A, "requester");
    approverA = await seedUser(TENANT_A, "approver");
  });

  describe("tenant isolation and structure", () => {
    test("RLS is ENABLED and FORCED on both tables, with USING and WITH CHECK", async () => {
      const rows = (await getAdminSql()`
        SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
               count(p.polname)::int AS policies,
               bool_and(p.polqual IS NOT NULL AND p.polwithcheck IS NOT NULL) AS both
        FROM pg_class c
        LEFT JOIN pg_policy p ON p.polrelid = c.oid
        WHERE c.relname IN ('awcms_hr_attendance_events', 'awcms_hr_attendance_corrections')
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

    test("a tenant cannot see or write another tenant's events, nor reference its employment", async () => {
      const id = await insertEvent(TENANT_A, empA);

      const seen = await inTenant(
        TENANT_B,
        (tx) => tx`SELECT id FROM awcms_hr_attendance_events WHERE id = ${id}`
      );

      expect(seen).toHaveLength(0);
      await assertRejected(
        insertEvent(TENANT_B, empA),
        /foreign key|violates/i
      );
      // A tenant-B row cannot be written under tenant A's id either (RLS).
      await assertRejected(
        inTenant(
          TENANT_B,
          (tx) => tx`
            INSERT INTO awcms_hr_attendance_events
              (tenant_id, employment_id, kind, occurred_at, source, client_event_key)
            VALUES (${TENANT_A}, ${empA}, 'clock_in', now(), 'self', 'x-rls')`
        ),
        /row-level security|policy/i
      );
    });

    test("composite foreign keys: a supersedes link and a correction target cannot cross tenants", async () => {
      const foreignEvent = await insertEvent(TENANT_B, empB);

      // RLS hides the foreign event from the guard (SUPERSEDE_MISMATCH) and the
      // composite foreign key is the second wall.
      await assertRejected(
        insertEvent(TENANT_A, empA, { supersedes: foreignEvent }),
        /foreign key|violates|HR_ATTENDANCE_SUPERSEDE_MISMATCH/i
      );

      const { instanceId } = await seedInstance(TENANT_A, {
        requestedBy: userA,
        resourceId: crypto.randomUUID()
      });

      await assertRejected(
        insertCorrection(TENANT_A, empA, {
          kind: "replace",
          target: foreignEvent,
          instanceId,
          requestedBy: userA
        }),
        /foreign key|violates|HR_CORRECTION_TARGET_MISMATCH/i
      );
    });

    test("no column holds a location, a coordinate, a photo, a device or a network value", async () => {
      const rows = (await getAdminSql()`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_name IN ('awcms_hr_attendance_events', 'awcms_hr_attendance_corrections')
          AND (column_name ~* '(lat|lng|lon|coord|geo|location|gps|photo|image|biometric|face|finger|device|ip_|_ip|mac|ssid|network|address|display_name|first_name|last_name)')
      `) as { table_name: string; column_name: string }[];

      // `lat` also matches "late" and "created_at"-style names; the allow-list is
      // the one genuine column that contains it.
      expect(
        rows.filter(
          (r) =>
            !(
              r.table_name === "awcms_hr_attendance_events" &&
              r.column_name === "late"
            ) &&
            !(
              r.table_name === "awcms_hr_attendance_corrections" &&
              ["created_at", "updated_at", "decided_at"].includes(r.column_name)
            ) &&
            !(
              r.table_name === "awcms_hr_attendance_events" &&
              ["recorded_at", "occurred_at"].includes(r.column_name)
            )
        )
      ).toEqual([]);
    });
  });

  describe("append-only events", () => {
    test("UPDATE and DELETE are refused for the runtime role (privilege) and for the owner (trigger)", async () => {
      const id = await insertEvent(TENANT_A, empA);

      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) =>
            tx`UPDATE awcms_hr_attendance_events SET kind = 'clock_out' WHERE id = ${id}`
        ),
        /permission denied/i
      );
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`DELETE FROM awcms_hr_attendance_events WHERE id = ${id}`
        ),
        /permission denied/i
      );
      await assertRejected(
        getAdminSql()`UPDATE awcms_hr_attendance_events SET occurred_at = now() WHERE id = ${id}`,
        /append-only|not allowed/i
      );
      await assertRejected(
        getAdminSql()`DELETE FROM awcms_hr_attendance_events WHERE id = ${id}`,
        /append-only|not allowed/i
      );
    });

    test("TRUNCATE is denied for the runtime role", async () => {
      await assertRejected(
        inTenant(TENANT_A, (tx) => tx`TRUNCATE awcms_hr_attendance_events`),
        /permission denied/i
      );
    });

    test("the runtime role holds exactly SELECT and INSERT on events", async () => {
      const rows = (await getAdminSql()`
        SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_name = 'awcms_hr_attendance_events' AND grantee = 'awcms_app'
        ORDER BY privilege_type
      `) as { privilege_type: string }[];

      expect(rows.map((r) => r.privilege_type)).toEqual(["INSERT", "SELECT"]);
    });
  });

  describe("the server clock and the claimed time", () => {
    test("recorded_at is the database clock: a supplied value is discarded", async () => {
      const id = await insertEvent(TENANT_A, empA, {
        recordedAt: "2001-01-01T00:00:00Z"
      });
      const rows = (await getAdminSql()`
        SELECT abs(extract(epoch FROM (clock_timestamp() - recorded_at)))::float AS age
        FROM awcms_hr_attendance_events WHERE id = ${id}
      `) as { age: number }[];

      expect(rows[0]!.age).toBeLessThan(30);
    });

    test("a claimed time further in the future than the skew bound is refused for every source", async () => {
      for (const source of ["self", "supervisor", "kiosk", "import"]) {
        await assertRejected(
          insertEvent(TENANT_A, empA, { source, offsetSeconds: 900 }),
          /HR_ATTENDANCE_FUTURE/
        );
      }

      // Inside the default 300 s skew it is accepted.
      await insertEvent(TENANT_A, empA, { offsetSeconds: 120 });
    });

    test("the bound is the tenant's setting: a stricter skew refuses what the default accepted", async () => {
      await getAdminSql()`
        INSERT INTO awcms_hr_workforce_settings (tenant_id, clock_skew_seconds)
        VALUES (${TENANT_A}, 10)
      `;

      await assertRejected(
        insertEvent(TENANT_A, empA, { offsetSeconds: 120 }),
        /HR_ATTENDANCE_FUTURE/
      );
      await assertRejected(
        insertEvent(TENANT_A, empA, { offsetSeconds: -120 }),
        /HR_ATTENDANCE_BACKDATED/
      );
      // Another tenant keeps the default.
      await insertEvent(TENANT_B, empB, { offsetSeconds: 120 });
    });

    test("a self or supervisor event cannot be back-dated beyond the skew", async () => {
      for (const source of ["self", "supervisor"]) {
        await assertRejected(
          insertEvent(TENANT_A, empA, { source, offsetSeconds: -900 }),
          /HR_ATTENDANCE_BACKDATED/
        );
        // Inside the skew is the ordinary slack of a slow request.
        await insertEvent(TENANT_A, empA, { source, offsetSeconds: -60 });
      }
    });

    test("a kiosk or import replay is accepted when stale, flagged late past fifteen minutes, refused past seven days", async () => {
      const fresh = await insertEvent(TENANT_A, empA, {
        source: "kiosk",
        offsetSeconds: -600
      });
      const stale = await insertEvent(TENANT_A, empA, {
        source: "import",
        offsetSeconds: -3600
      });
      const flags = (await getAdminSql()`
        SELECT id, late FROM awcms_hr_attendance_events
        WHERE id IN (${fresh}, ${stale})
      `) as { id: string; late: boolean }[];

      expect(flags.find((f) => f.id === fresh)!.late).toBe(false);
      expect(flags.find((f) => f.id === stale)!.late).toBe(true);

      await assertRejected(
        insertEvent(TENANT_A, empA, {
          source: "kiosk",
          offsetSeconds: -(8 * 24 * 3600)
        }),
        /HR_ATTENDANCE_TOO_OLD/
      );
    });

    test("`late` is the server's to set: a client cannot assert it", async () => {
      const id = await inTenant(TENANT_A, async (tx) => {
        const rows = (await tx`
          INSERT INTO awcms_hr_attendance_events
            (tenant_id, employment_id, kind, occurred_at, source, client_event_key, late)
          VALUES (${TENANT_A}, ${empA}, 'clock_in', clock_timestamp(), 'self', 'late-lie', true)
          RETURNING id
        `) as { id: string }[];

        return rows[0]!.id;
      });
      const rows = (await getAdminSql()`
        SELECT late FROM awcms_hr_attendance_events WHERE id = ${id}
      `) as { late: boolean }[];

      expect(rows[0]!.late).toBe(false);
    });
  });

  describe("replay and shape", () => {
    test("the same client event key for one employment is a unique violation; another employment may reuse it", async () => {
      const other = await employ(TENANT_A);

      await insertEvent(TENANT_A, empA, { key: "queue-1" });
      await assertRejected(
        insertEvent(TENANT_A, empA, { key: "queue-1" }),
        /awcms_hr_attendance_events_client_key|duplicate key/i
      );
      await insertEvent(TENANT_A, other, { key: "queue-1" });
    });

    test("kind, source and key shape are enforced", async () => {
      await assertRejected(
        insertEvent(TENANT_A, empA, { kind: "teleport" }),
        /kind_check|check constraint/i
      );
      await assertRejected(
        insertEvent(TENANT_A, empA, { source: "magic" }),
        /source_check|check constraint/i
      );
      await assertRejected(
        insertEvent(TENANT_A, empA, { key: " bad key" }),
        /client_key_check|check constraint/i
      );
    });

    test("no clocking on a deleted or a terminated employment; an approved correction may still touch a terminated one", async () => {
      const deleted = await employ(TENANT_A);
      const terminated = await employ(TENANT_A);

      await getAdminSql()`
        UPDATE awcms_hr_employments SET deleted_at = now() WHERE id = ${deleted}
      `;
      // Close the open term and append the terminal one (the sql/176 protocol).
      await inTenant(TENANT_A, async (tx) => {
        await tx`
          UPDATE awcms_hr_employment_terms SET effective_to = '2026-06-01'
          WHERE employment_id = ${terminated} AND effective_to IS NULL
        `;
        await tx`
          INSERT INTO awcms_hr_employment_terms
            (tenant_id, employment_id, employment_type, status, effective_from)
          VALUES (${TENANT_A}, ${terminated}, 'permanent', 'terminated', '2026-06-01')
        `;
      });

      await assertRejected(
        insertEvent(TENANT_A, deleted),
        /HR_EMPLOYMENT_DELETED/
      );

      const header = (await getAdminSql()`
        SELECT terminated_on FROM awcms_hr_employments WHERE id = ${terminated}
      `) as { terminated_on: string | null }[];

      expect(header[0]!.terminated_on).not.toBeNull();
      await assertRejected(
        insertEvent(TENANT_A, terminated),
        /HR_EMPLOYMENT_TERMINATED/
      );

      // An approved correction can still fix that history.
      const c = await pendingCorrection(TENANT_A, terminated, userA);
      await setInstanceStatus(c.instanceId, "approved");
      await decide(TENANT_A, c.taskId, approverA);
      await approveAndApply(TENANT_A, {
        id: c.id,
        employmentId: terminated,
        approver: approverA
      });
    });
  });

  describe("races with the employment", () => {
    test("an insert racing an uncommitted soft-delete of the employment waits for it and is then refused (FOR SHARE on the parent row)", async () => {
      const victim = await employ(TENANT_A);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const deleter = getAdminSql().begin(async (sql) => {
        await sql`UPDATE awcms_hr_employments SET deleted_at = now() WHERE id = ${victim}`;
        await gate;
      });

      await Bun.sleep(200);
      const attempt = insertEvent(TENANT_A, victim).then(
        () => "inserted",
        (error: unknown) => String(error)
      );

      // Without the parent-row lock the insert would already have finished.
      await Bun.sleep(400);
      release();
      await deleter;

      expect(await attempt).toMatch(/HR_EMPLOYMENT_DELETED/);
      resetDatabaseCircuitBreakerForTests();
    });
  });

  describe("corrections never edit the original", () => {
    test("only an approved correction may supersede; a plain event cannot", async () => {
      const original = await insertEvent(TENANT_A, empA, {
        offsetSeconds: -60
      });

      await assertRejected(
        insertEvent(TENANT_A, empA, { supersedes: original }),
        /HR_ATTENDANCE_SUPERSEDE_FORBIDDEN/
      );
      // And a correction-sourced event needs the correction link at all.
      await assertRejected(
        insertEvent(TENANT_A, empA, { source: "correction" }),
        /HR_ATTENDANCE_CORRECTION_NOT_APPROVED|correction_check/i
      );
    });

    test("a correction-sourced event needs an APPROVED correction with exactly the approved content", async () => {
      const original = await insertEvent(TENANT_A, empA, {
        offsetSeconds: -60
      });
      const c = await pendingCorrection(TENANT_A, empA, userA, {
        kind: "replace",
        target: original
      });

      // Still pending: refused.
      await assertRejected(
        insertEvent(TENANT_A, empA, {
          source: "correction",
          correctionId: c.id,
          supersedes: original,
          kind: "clock_out",
          offsetSeconds: -3600
        }),
        /HR_ATTENDANCE_CORRECTION_NOT_APPROVED/
      );
    });

    test("the superseding event must match the proposal; the original row never changes", async () => {
      const original = await insertEvent(TENANT_A, empA, {
        offsetSeconds: -60
      });
      const before = (await getAdminSql()`
        SELECT * FROM awcms_hr_attendance_events WHERE id = ${original}
      `) as Record<string, unknown>[];
      const c = await pendingCorrection(TENANT_A, empA, userA, {
        kind: "replace",
        target: original,
        proposedKind: "clock_out"
      });
      await setInstanceStatus(c.instanceId, "approved");
      await decide(TENANT_A, c.taskId, approverA);

      // A different kind than approved: refused, and the approval rolls back with it.
      await assertRejected(
        inTenant(TENANT_A, async (tx) => {
          await tx`
            UPDATE awcms_hr_attendance_corrections
            SET status = 'approved', decided_by = ${approverA}, decided_at = now()
            WHERE id = ${c.id}`;
          await tx`
            INSERT INTO awcms_hr_attendance_events
              (tenant_id, employment_id, kind, occurred_at, source,
               client_event_key, supersedes_event_id, correction_id)
            SELECT tenant_id, employment_id, 'clock_in', proposed_occurred_at,
                   'correction', ${`correction:${c.id}`}, target_event_id, id
            FROM awcms_hr_attendance_corrections WHERE id = ${c.id}`;
        }),
        /HR_ATTENDANCE_CORRECTION_NOT_APPROVED/
      );

      await approveAndApply(TENANT_A, {
        id: c.id,
        employmentId: empA,
        approver: approverA
      });

      const after = (await getAdminSql()`
        SELECT * FROM awcms_hr_attendance_events WHERE id = ${original}
      `) as Record<string, unknown>[];

      expect(after).toEqual(before);

      const effective = (await getAdminSql()`
        SELECT e.id FROM awcms_hr_attendance_events e
        WHERE e.employment_id = ${empA}
          AND NOT EXISTS (SELECT 1 FROM awcms_hr_attendance_events s
                           WHERE s.supersedes_event_id = e.id)
      `) as { id: string }[];

      expect(effective).toHaveLength(1);
      expect(effective[0]!.id).not.toBe(original);
    });

    test("an event is superseded at most once, and a correction writes at most one event", async () => {
      const original = await insertEvent(TENANT_A, empA, {
        offsetSeconds: -60
      });
      const first = await pendingCorrection(TENANT_A, empA, userA, {
        kind: "replace",
        target: original
      });
      await setInstanceStatus(first.instanceId, "approved");
      await decide(TENANT_A, first.taskId, approverA);
      await approveAndApply(TENANT_A, {
        id: first.id,
        employmentId: empA,
        approver: approverA
      });

      // The pending-target index no longer covers an approved row, so a second
      // correction on the same target can be filed; its APPLICATION is what the
      // one-superseder index refuses.
      const second = await pendingCorrection(TENANT_A, empA, userA, {
        kind: "replace",
        target: original
      });
      await setInstanceStatus(second.instanceId, "approved");
      await decide(TENANT_A, second.taskId, approverA);

      await assertRejected(
        approveAndApply(TENANT_A, {
          id: second.id,
          employmentId: empA,
          approver: approverA
        }),
        /one_superseder|duplicate key/i
      );

      // One event per correction.
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            INSERT INTO awcms_hr_attendance_events
              (tenant_id, employment_id, kind, occurred_at, source,
               client_event_key, correction_id)
            SELECT tenant_id, employment_id, proposed_kind, proposed_occurred_at,
                   'correction', 'again', NULL, id
            FROM awcms_hr_attendance_corrections WHERE id = ${first.id}`
        ),
        /./
      );
    });

    test("a correction cannot target another employment's event", async () => {
      const other = await employ(TENANT_A);
      const theirs = await insertEvent(TENANT_A, other);

      await assertRejected(
        pendingCorrection(TENANT_A, empA, userA, {
          kind: "replace",
          target: theirs
        }),
        /HR_CORRECTION_TARGET_MISMATCH/
      );
    });

    test("one PENDING correction per target event, even for two concurrent requests", async () => {
      const original = await insertEvent(TENANT_A, empA, {
        offsetSeconds: -60
      });
      const attempts = await Promise.allSettled(
        Array.from({ length: 4 }, () =>
          pendingCorrection(TENANT_A, empA, userA, {
            kind: "replace",
            target: original
          })
        )
      );
      resetDatabaseCircuitBreakerForTests();

      expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
      expect(
        attempts.filter(
          (a) =>
            a.status === "rejected" &&
            /one_pending_target|duplicate key/i.test(String(a.reason))
        )
      ).toHaveLength(3);
    });

    test("concurrent writers of one client event key record it once", async () => {
      const attempts = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          inTenant(
            TENANT_A,
            (tx) => tx`
              INSERT INTO awcms_hr_attendance_events
                (tenant_id, employment_id, kind, occurred_at, source, client_event_key)
              VALUES (${TENANT_A}, ${empA}, 'clock_in', clock_timestamp(), 'self', 'race-1')
              ON CONFLICT (tenant_id, employment_id, client_event_key) DO NOTHING
              RETURNING id`
          )
        )
      );
      resetDatabaseCircuitBreakerForTests();
      const rows = (await getAdminSql()`
        SELECT count(*)::int AS n FROM awcms_hr_attendance_events
        WHERE client_event_key = 'race-1'
      `) as { n: number }[];

      expect(rows[0]!.n).toBe(1);
      expect(attempts.every((a) => a.status === "fulfilled")).toBe(true);
    });
  });

  describe("the correction status follows the workflow verdict", () => {
    test("a correction is created pending, bound to a workflow instance of the same tenant, resource and requester", async () => {
      const id = crypto.randomUUID();
      const good = await seedInstance(TENANT_A, {
        requestedBy: userA,
        resourceId: id
      });

      // Wrong requester on the instance.
      const wrongRequester = await seedInstance(TENANT_A, {
        requestedBy: approverA,
        resourceId: id
      });
      await assertRejected(
        insertCorrection(TENANT_A, empA, {
          id,
          instanceId: wrongRequester.instanceId,
          requestedBy: userA
        }),
        /HR_CORRECTION_BAD_WORKFLOW/
      );

      // Wrong resource.
      const wrongResource = await seedInstance(TENANT_A, {
        requestedBy: userA,
        resourceId: crypto.randomUUID()
      });
      await assertRejected(
        insertCorrection(TENANT_A, empA, {
          id,
          instanceId: wrongResource.instanceId,
          requestedBy: userA
        }),
        /HR_CORRECTION_BAD_WORKFLOW/
      );

      // Another tenant's instance is invisible (RLS) and so cannot be bound.
      const userB = await seedUser(TENANT_B, "b");
      const foreign = await seedInstance(TENANT_B, {
        requestedBy: userB,
        resourceId: id
      });
      await assertRejected(
        insertCorrection(TENANT_A, empA, {
          id,
          instanceId: foreign.instanceId,
          requestedBy: userA
        }),
        /HR_CORRECTION_BAD_WORKFLOW/
      );

      await insertCorrection(TENANT_A, empA, {
        id,
        instanceId: good.instanceId,
        requestedBy: userA
      });
    });

    test("add vs replace shape, and a mandatory non-blank reason", async () => {
      const original = await insertEvent(TENANT_A, empA);
      const mk = async (extra: Partial<CorrectionSpec>): Promise<unknown> => {
        const id = crypto.randomUUID();
        const { instanceId } = await seedInstance(TENANT_A, {
          requestedBy: userA,
          resourceId: id
        });

        return insertCorrection(TENANT_A, empA, {
          id,
          instanceId,
          requestedBy: userA,
          ...extra
        });
      };

      await assertRejected(
        mk({ kind: "replace", target: null }),
        /target_check|check constraint/i
      );
      await assertRejected(
        mk({ kind: "add", target: original }),
        /target_check|check constraint/i
      );
      await assertRejected(
        mk({ reason: "   " }),
        /reason_check|check constraint/i
      );
      await assertRejected(
        mk({ reason: "x".repeat(501) }),
        /reason_check|check constraint/i
      );
    });

    test("approving needs the workflow's approved verdict and a real approving decision", async () => {
      const c = await pendingCorrection(TENANT_A, empA, userA);

      // Instance still pending.
      await assertRejected(
        approveAndApply(TENANT_A, {
          id: c.id,
          employmentId: empA,
          approver: approverA
        }),
        /HR_CORRECTION_VERDICT_MISMATCH/
      );

      // Instance approved, but the named approver never decided.
      await setInstanceStatus(c.instanceId, "approved");
      await assertRejected(
        approveAndApply(TENANT_A, {
          id: c.id,
          employmentId: empA,
          approver: approverA
        }),
        /HR_CORRECTION_NO_APPROVER/
      );

      await decide(TENANT_A, c.taskId, approverA);
      await approveAndApply(TENANT_A, {
        id: c.id,
        employmentId: empA,
        approver: approverA
      });
    });

    test("rejected needs a rejected instance; withdrawn needs a cancelled one", async () => {
      const r = await pendingCorrection(TENANT_A, empA, userA);

      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            UPDATE awcms_hr_attendance_corrections
            SET status = 'rejected', decided_by = ${approverA}, decided_at = now()
            WHERE id = ${r.id}`
        ),
        /HR_CORRECTION_VERDICT_MISMATCH/
      );
      await setInstanceStatus(r.instanceId, "rejected");
      await inTenant(
        TENANT_A,
        (tx) => tx`
          UPDATE awcms_hr_attendance_corrections
          SET status = 'rejected', decided_by = ${approverA}, decided_at = now()
          WHERE id = ${r.id}`
      );

      const w = await pendingCorrection(TENANT_A, empA, userA);

      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            UPDATE awcms_hr_attendance_corrections
            SET status = 'withdrawn', decided_by = ${userA}, decided_at = now()
            WHERE id = ${w.id}`
        ),
        /HR_CORRECTION_VERDICT_MISMATCH/
      );
      await setInstanceStatus(w.instanceId, "cancelled");
      await inTenant(
        TENANT_A,
        (tx) => tx`
          UPDATE awcms_hr_attendance_corrections
          SET status = 'withdrawn', decided_by = ${userA}, decided_at = now()
          WHERE id = ${w.id}`
      );
    });

    test("only the status moves: the proposal, the reason, the requester and the instance are immutable", async () => {
      const c = await pendingCorrection(TENANT_A, empA, userA);

      for (const set of [
        "reason = 'rewritten'",
        "proposed_kind = 'clock_in'",
        "proposed_occurred_at = now()",
        "requested_by = '" + approverA + "'",
        "workflow_instance_id = gen_random_uuid()"
      ]) {
        await assertRejected(
          inTenant(
            TENANT_A,
            (tx) =>
              tx`UPDATE awcms_hr_attendance_corrections SET ${tx.unsafe(set)} WHERE id = ${c.id}`
          ),
          /immutable|only its status|status must move|requested_by/i
        );
      }

      // A no-op status "move" is refused too.
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) =>
            tx`UPDATE awcms_hr_attendance_corrections SET updated_at = now() WHERE id = ${c.id}`
        ),
        /must move its status/
      );
    });

    test("a settled correction is terminal and nothing is ever deleted", async () => {
      const c = await pendingCorrection(TENANT_A, empA, userA);
      await setInstanceStatus(c.instanceId, "rejected");
      await inTenant(
        TENANT_A,
        (tx) => tx`
          UPDATE awcms_hr_attendance_corrections
          SET status = 'rejected', decided_by = ${approverA}, decided_at = now()
          WHERE id = ${c.id}`
      );

      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            UPDATE awcms_hr_attendance_corrections
            SET status = 'withdrawn', decided_by = ${userA}, decided_at = now()
            WHERE id = ${c.id}`
        ),
        /HR_CORRECTION_NOT_PENDING/
      );
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) =>
            tx`DELETE FROM awcms_hr_attendance_corrections WHERE id = ${c.id}`
        ),
        /permission denied/i
      );
      await assertRejected(
        getAdminSql()`DELETE FROM awcms_hr_attendance_corrections WHERE id = ${c.id}`,
        /append-only|not allowed/i
      );
    });

    test("approval without its superseding event cannot commit (deferred constraint trigger)", async () => {
      const c = await pendingCorrection(TENANT_A, empA, userA);
      await setInstanceStatus(c.instanceId, "approved");
      await decide(TENANT_A, c.taskId, approverA);

      await assertRejected(
        approveAndApply(TENANT_A, {
          id: c.id,
          employmentId: empA,
          approver: approverA,
          skipEvent: true
        }),
        /HR_CORRECTION_NOT_APPLIED/
      );

      const rows = (await getAdminSql()`
        SELECT status FROM awcms_hr_attendance_corrections WHERE id = ${c.id}
      `) as { status: string }[];

      expect(rows[0]!.status).toBe("pending");
    });
  });

  describe("segregation of duties: the requester is never the approver", () => {
    test("CHECK: decided_by cannot equal requested_by on an approved row, even without the workflow rows", async () => {
      const c = await pendingCorrection(TENANT_A, empA, userA);

      // The admin bypasses the guard trigger for the CHECK-only probe by
      // disabling it for this statement.
      await getAdminSql().begin(async (sql) => {
        await sql`ALTER TABLE awcms_hr_attendance_corrections DISABLE TRIGGER awcms_hr_attendance_corrections_guard`;
        await sql`ALTER TABLE awcms_hr_attendance_corrections DISABLE TRIGGER awcms_hr_attendance_corrections_applied`;
        let refused: unknown = null;

        try {
          await sql.savepoint(async (sp) => {
            await sp`
              UPDATE awcms_hr_attendance_corrections
              SET status = 'approved', decided_by = ${userA}, decided_at = now()
              WHERE id = ${c.id}`;
          });
        } catch (error) {
          refused = error;
        }

        expect(String(refused)).toMatch(/sod_check|check constraint/i);
        await sql`ALTER TABLE awcms_hr_attendance_corrections ENABLE TRIGGER awcms_hr_attendance_corrections_guard`;
        await sql`ALTER TABLE awcms_hr_attendance_corrections ENABLE TRIGGER awcms_hr_attendance_corrections_applied`;
      });
    });

    test("TRIGGER: an approving decision by the requester refuses the approval, even when another approver also approved", async () => {
      const c = await pendingCorrection(TENANT_A, empA, userA);
      await setInstanceStatus(c.instanceId, "approved");
      await decide(TENANT_A, c.taskId, approverA);
      await decide(TENANT_A, c.taskId, userA);

      await assertRejected(
        approveAndApply(TENANT_A, {
          id: c.id,
          employmentId: empA,
          approver: approverA
        }),
        /HR_CORRECTION_SELF_APPROVAL/
      );
    });

    test("TRIGGER: a delegate acting on behalf of the requester counts as the requester approving", async () => {
      const delegate = await seedUser(TENANT_A, "delegate");
      const c = await pendingCorrection(TENANT_A, empA, userA);
      await setInstanceStatus(c.instanceId, "approved");
      await decide(TENANT_A, c.taskId, delegate, "approve", userA);

      await assertRejected(
        approveAndApply(TENANT_A, {
          id: c.id,
          employmentId: empA,
          approver: delegate
        }),
        /HR_CORRECTION_SELF_APPROVAL/
      );
    });

    test("TRIGGER: a force-approval by the requester is the same refusal", async () => {
      const c = await pendingCorrection(TENANT_A, empA, userA);
      await setInstanceStatus(c.instanceId, "approved");
      await decide(TENANT_A, c.taskId, approverA, "force_approve");
      await decide(TENANT_A, c.taskId, userA, "force_approve");

      await assertRejected(
        approveAndApply(TENANT_A, {
          id: c.id,
          employmentId: empA,
          approver: approverA
        }),
        /HR_CORRECTION_SELF_APPROVAL/
      );
    });
  });

  describe("segregation of duties: the employee the correction is about is never the approver either", () => {
    // These tests are about the SoD triggers, not the link rules, and use
    // arbitrary logins: take the PS-14 link guard (#979, covered by the
    // hr_workforce database tests) out of the way for the write.
    async function linkLogin(employmentId: string, login: string | null) {
      const admin = getAdminSql();
      await admin`ALTER TABLE awcms_hr_employments DISABLE TRIGGER awcms_hr_employments_link_guard`;

      try {
        await admin`
          UPDATE awcms_hr_employments SET tenant_user_id = ${login}
          WHERE id = ${employmentId}
        `;
      } finally {
        await admin`ALTER TABLE awcms_hr_employments ENABLE TRIGGER awcms_hr_employments_link_guard`;
      }
    }

    async function subjectOf(correctionId: string) {
      const rows = (await getAdminSql()`
        SELECT subject_tenant_user_id FROM awcms_hr_attendance_corrections
        WHERE id = ${correctionId}
      `) as { subject_tenant_user_id: string | null }[];

      return rows[0]!.subject_tenant_user_id;
    }

    test("the subject login is stamped by the trigger at request time; a writer-supplied value is discarded; no login means NULL", async () => {
      const subject = await seedUser(TENANT_A, "subject");
      await linkLogin(empA, subject);
      const c = await pendingCorrection(TENANT_A, empA, userA);

      expect(await subjectOf(c.id)).toBe(subject);

      const forged = crypto.randomUUID();
      const { instanceId } = await seedInstance(TENANT_A, {
        requestedBy: userA,
        resourceId: forged
      });
      await inTenant(TENANT_A, async (tx) => {
        await tx`
          INSERT INTO awcms_hr_attendance_corrections
            (id, tenant_id, employment_id, kind, proposed_kind,
             proposed_occurred_at, reason, workflow_instance_id, requested_by,
             subject_tenant_user_id)
          VALUES (${forged}, ${TENANT_A}, ${empA}, 'add', 'clock_out',
                  now() - interval '1 hour', 'forgot', ${instanceId}, ${userA},
                  ${approverA})
        `;
      });

      expect(await subjectOf(forged)).toBe(subject);

      await linkLogin(empA, null);
      const unlinked = await pendingCorrection(TENANT_A, empA, userA);

      expect(await subjectOf(unlinked.id)).toBeNull();
    });

    test("TRIGGER: the subject approving directly refuses the approval, even beside another approver", async () => {
      const subject = await seedUser(TENANT_A, "subject");
      await linkLogin(empA, subject);
      const c = await pendingCorrection(TENANT_A, empA, userA);
      await setInstanceStatus(c.instanceId, "approved");
      await decide(TENANT_A, c.taskId, approverA);
      await decide(TENANT_A, c.taskId, subject);

      await assertRejected(
        approveAndApply(TENANT_A, {
          id: c.id,
          employmentId: empA,
          approver: approverA
        }),
        /HR_CORRECTION_SELF_APPROVAL/
      );
    });

    test("TRIGGER: the subject as the recorded approver, and a delegate acting on the subject's behalf, are the same refusal", async () => {
      const subject = await seedUser(TENANT_A, "subject");
      const delegate = await seedUser(TENANT_A, "delegate");
      await linkLogin(empA, subject);

      const direct = await pendingCorrection(TENANT_A, empA, userA);
      await setInstanceStatus(direct.instanceId, "approved");
      await decide(TENANT_A, direct.taskId, subject);
      await assertRejected(
        approveAndApply(TENANT_A, {
          id: direct.id,
          employmentId: empA,
          approver: subject
        }),
        /HR_CORRECTION_SELF_APPROVAL|sod_check/
      );

      const delegated = await pendingCorrection(TENANT_A, empA, userA);
      await setInstanceStatus(delegated.instanceId, "approved");
      await decide(TENANT_A, delegated.taskId, delegate, "approve", subject);
      await assertRejected(
        approveAndApply(TENANT_A, {
          id: delegated.id,
          employmentId: empA,
          approver: delegate
        }),
        /HR_CORRECTION_SELF_APPROVAL/
      );
    });

    test("TRIGGER: a re-link between the request and the settle sheds nothing: the snapshot and the login linked now are both excluded", async () => {
      const subject = await seedUser(TENANT_A, "subject");
      const successor = await seedUser(TENANT_A, "successor");
      await linkLogin(empA, subject);
      const c = await pendingCorrection(TENANT_A, empA, userA);
      await setInstanceStatus(c.instanceId, "approved");

      // The employment is re-linked to another login before the settle.
      await linkLogin(empA, successor);
      await decide(TENANT_A, c.taskId, approverA);
      await decide(TENANT_A, c.taskId, subject);
      await assertRejected(
        approveAndApply(TENANT_A, {
          id: c.id,
          employmentId: empA,
          approver: approverA
        }),
        /HR_CORRECTION_SELF_APPROVAL/
      );

      // ... and the login linked NOW is excluded too (the request had none).
      await linkLogin(empA, null);
      const later = await pendingCorrection(TENANT_A, empA, userA);
      await setInstanceStatus(later.instanceId, "approved");
      await linkLogin(empA, successor);
      await decide(TENANT_A, later.taskId, approverA);
      await decide(TENANT_A, later.taskId, successor);
      await assertRejected(
        approveAndApply(TENANT_A, {
          id: later.id,
          employmentId: empA,
          approver: approverA
        }),
        /HR_CORRECTION_SELF_APPROVAL/
      );
    });

    test("CHECK: decided_by cannot equal the subject on an approved row, even without the workflow rows", async () => {
      const subject = await seedUser(TENANT_A, "subject");
      await linkLogin(empA, subject);
      const c = await pendingCorrection(TENANT_A, empA, userA);

      await getAdminSql().begin(async (sql) => {
        await sql`ALTER TABLE awcms_hr_attendance_corrections DISABLE TRIGGER awcms_hr_attendance_corrections_guard`;
        await sql`ALTER TABLE awcms_hr_attendance_corrections DISABLE TRIGGER awcms_hr_attendance_corrections_applied`;
        let refused: unknown = null;

        try {
          await sql.savepoint(async (sp) => {
            await sp`
              UPDATE awcms_hr_attendance_corrections
              SET status = 'approved', decided_by = ${subject}, decided_at = now()
              WHERE id = ${c.id}`;
          });
        } catch (error) {
          refused = error;
        }

        expect(String(refused)).toMatch(/sod_check|check constraint/i);
        await sql`ALTER TABLE awcms_hr_attendance_corrections ENABLE TRIGGER awcms_hr_attendance_corrections_guard`;
        await sql`ALTER TABLE awcms_hr_attendance_corrections ENABLE TRIGGER awcms_hr_attendance_corrections_applied`;
      });
    });

    test("an unrelated approver is not excluded (no transitive manager-chain exclusion)", async () => {
      const subject = await seedUser(TENANT_A, "subject");
      await linkLogin(empA, subject);
      const c = await pendingCorrection(TENANT_A, empA, userA);
      await setInstanceStatus(c.instanceId, "approved");
      await decide(TENANT_A, c.taskId, approverA);

      await approveAndApply(TENANT_A, {
        id: c.id,
        employmentId: empA,
        approver: approverA
      });

      const rows = (await getAdminSql()`
        SELECT status FROM awcms_hr_attendance_corrections WHERE id = ${c.id}
      `) as { status: string }[];

      expect(rows[0]!.status).toBe("approved");
    });
  });

  describe("the manager chain, downwards", () => {
    function reports(tenantId: string, manager: string) {
      return inTenant(tenantId, async (tx) => {
        const rows = (await tx`
          SELECT employment_id FROM awcms_hr_report_ids(${tenantId}::uuid, ${manager}::uuid)
        `) as { employment_id: string }[];

        return rows.map((r) => r.employment_id).sort();
      });
    }

    test("direct and transitive reports are returned; peers, managers and other tenants are not", async () => {
      const boss = await employ(TENANT_A);
      const lead = await employ(TENANT_A, { managerId: boss });
      const worker = await employ(TENANT_A, { managerId: lead });
      const peer = await employ(TENANT_A, { managerId: boss });
      const outsider = await employ(TENANT_A);

      expect(await reports(TENANT_A, boss)).toEqual(
        [lead, worker, peer].sort()
      );
      expect(await reports(TENANT_A, lead)).toEqual([worker]);
      expect(await reports(TENANT_A, worker)).toEqual([]);
      expect(await reports(TENANT_A, outsider)).toEqual([]);
      // Another tenant's id space cannot be walked.
      expect(await reports(TENANT_B, boss)).toEqual([]);
    });

    test("a soft-deleted employment is neither listed nor walked through (fail closed)", async () => {
      const boss = await employ(TENANT_A);
      const lead = await employ(TENANT_A, { managerId: boss });
      const worker = await employ(TENANT_A, { managerId: lead });

      await getAdminSql()`
        UPDATE awcms_hr_employments SET deleted_at = now() WHERE id = ${lead}
      `;

      expect(await reports(TENANT_A, boss)).toEqual([]);
      // The deleted manager's own reports are still reachable from HIM, but he is
      // deleted, so nothing keys off his login in the application.
      expect(await reports(TENANT_A, lead)).toEqual([worker]);
    });

    test("the walk is bounded: a ten-edge chain is fully reachable and the function terminates", async () => {
      let top = await employ(TENANT_A);
      const root = top;

      for (let i = 0; i < 10; i += 1) {
        top = await employ(TENANT_A, { managerId: top });
      }

      const found = await reports(TENANT_A, root);

      expect(found).toHaveLength(10);
      expect(found).toContain(top);
    });
  });
});
