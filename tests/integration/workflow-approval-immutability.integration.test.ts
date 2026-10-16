/**
 * `awcms_workflow_decisions` is append-only and a terminal
 * `awcms_workflow_instances` row is final, against a real PostgreSQL as the
 * least-privilege runtime role with FORCE RLS in force (Issue #999, `sql/252`,
 * security audit finding F2 of #990).
 *
 * Both layers are attacked separately, because either alone is a convention
 * waiting for a GRANT: the runtime role is refused by PRIVILEGE, and the
 * table owner (who holds every privilege) is refused by TRIGGER. The legitimate
 * writes the workflow engine performs are proven to keep working, including the
 * `... AND status = 'pending'` guarded UPDATE that must simply match nothing on
 * an instance that has already finished.
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
  appRoleActivated,
  getAdminSql,
  getOwnerSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { resetDatabaseCircuitBreakerForTests } from "../../src/lib/database/circuit-breaker";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";

const suite = integrationEnabled ? describe : describe.skip;

/** Pins WHY the database refused, so a test cannot pass on an unrelated failure. */
async function assertRejected(
  promise: Promise<unknown>,
  expected: RegExp
): Promise<void> {
  const error = await assertRejectedByDatabase(promise, String(expected));
  resetDatabaseCircuitBreakerForTests();
  expect(error.message).toMatch(expected);
}

const TENANT = "a9990000-0000-4000-8000-00000000000a";
const REQUESTER = "a9990000-0000-4000-8000-0000000000a1";
const APPROVER = "a9990000-0000-4000-8000-0000000000a2";

function inTenant<T>(fn: (tx: Bun.TransactionSQL) => Promise<T>): Promise<T> {
  return withTenantOrThrow(getRuntimeSql(), TENANT, fn);
}

/** The table OWNER (holds every privilege, subject to FORCE RLS): the trigger layer. */
function asOwner<T>(fn: (tx: Bun.TransactionSQL) => Promise<T>): Promise<T> {
  return withTenantOrThrow(getOwnerSql(), TENANT, fn);
}

/** One approval node (any-quorum) leading to an approved end or a rejected end. */
const APPROVAL_GRAPH = {
  startNodeId: "approval",
  nodes: [
    {
      id: "approval",
      type: "approval",
      name: "Approval",
      assigneeTenantUserIds: [APPROVER],
      quorumRule: "any",
      onApprove: "end_ok",
      onReject: "end_no"
    },
    { id: "end_ok", type: "end", outcome: "approved" },
    { id: "end_no", type: "end", outcome: "rejected" }
  ]
};

async function seedDefinition(): Promise<string> {
  const rows = (await getAdminSql()`
    INSERT INTO awcms_workflow_definitions
      (tenant_id, workflow_key, name, version, lifecycle_status, graph)
    VALUES (${TENANT}, ${`wf.${crypto.randomUUID()}`}, 'Immutability', 1, 'active',
            ${APPROVAL_GRAPH}::jsonb)
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

/** A pending instance and one task, written by the RUNTIME role like the engine does. */
async function startInstance(
  definitionId: string
): Promise<{ instanceId: string; taskId: string }> {
  return inTenant(async (tx) => {
    const instance = (await tx`
      INSERT INTO awcms_workflow_instances
        (tenant_id, workflow_definition_id, resource_type, resource_id,
         requested_by_tenant_user_id, facts)
      VALUES (${TENANT}, ${definitionId}, 'doc', ${crypto.randomUUID()},
              ${REQUESTER}, ${{ amount: 10 }}::jsonb)
      RETURNING id
    `) as { id: string }[];
    const task = (await tx`
      INSERT INTO awcms_workflow_tasks (tenant_id, workflow_instance_id, node_id)
      VALUES (${TENANT}, ${instance[0]!.id}, 'approval')
      RETURNING id
    `) as { id: string }[];
    await tx`
      INSERT INTO awcms_workflow_task_assignments
        (tenant_id, workflow_task_id, tenant_user_id, status)
      VALUES (${TENANT}, ${task[0]!.id}, ${APPROVER}, 'pending')
    `;

    return { instanceId: instance[0]!.id, taskId: task[0]!.id };
  });
}

function recordDecision(
  taskId: string,
  decision: "approve" | "reject" = "approve"
): Promise<string> {
  return inTenant(async (tx) => {
    const rows = (await tx`
      INSERT INTO awcms_workflow_decisions
        (tenant_id, workflow_task_id, decision, decided_by_tenant_user_id)
      VALUES (${TENANT}, ${taskId}, ${decision}, ${APPROVER})
      RETURNING id
    `) as { id: string }[];

    return rows[0]!.id;
  });
}

/** The engine's path to a verdict: decision, task completed, instance moved. */
async function settle(
  instance: { instanceId: string; taskId: string },
  status: "approved" | "rejected"
): Promise<void> {
  await recordDecision(
    instance.taskId,
    status === "approved" ? "approve" : "reject"
  );
  await inTenant(async (tx) => {
    await tx`UPDATE awcms_workflow_tasks SET status = 'completed' WHERE id = ${instance.taskId}`;
    await tx`UPDATE awcms_workflow_instances SET status = ${status}, updated_at = now() WHERE id = ${instance.instanceId} AND status = 'pending'`;
  });
}

suite("workflow_approval immutability (Issue #999)", () => {
  let definitionId = "";

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
      VALUES (${TENANT}, 'wf-imm', 'Workflow immutability')
    `;
    // The approver is a real, active user of the tenant (a seat requires one).
    const sql = getAdminSql();
    const profile = (await sql`
      INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
      VALUES (${TENANT}, 'person', 'approver') RETURNING id
    `) as { id: string }[];
    const identity = (await sql`
      INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
      VALUES (${TENANT}, ${profile[0]!.id}, 'approver@example.test', 'x') RETURNING id
    `) as { id: string }[];

    await sql`
      INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
      VALUES (${APPROVER}, ${TENANT}, ${identity[0]!.id})
    `;
    definitionId = await seedDefinition();
  });

  describe("privileges of the runtime role", () => {
    test("holds exactly SELECT+INSERT on decisions and SELECT+INSERT+UPDATE on instances", async () => {
      const grants = async (table: string) =>
        (
          (await getAdminSql()`
            SELECT privilege_type FROM information_schema.role_table_grants
            WHERE table_name = ${table} AND grantee = 'awcms_app'
            ORDER BY privilege_type
          `) as { privilege_type: string }[]
        ).map((r) => r.privilege_type);

      expect(await grants("awcms_workflow_decisions")).toEqual([
        "INSERT",
        "SELECT"
      ]);
      expect(await grants("awcms_workflow_instances")).toEqual([
        "INSERT",
        "SELECT",
        "UPDATE"
      ]);
    });

    test("TRUNCATE of either table is denied", async () => {
      if (!appRoleActivated) return;
      await assertRejected(
        inTenant((tx) => tx`TRUNCATE awcms_workflow_decisions`),
        /permission denied/i
      );
      await assertRejected(
        inTenant((tx) => tx`TRUNCATE awcms_workflow_instances`),
        /permission denied/i
      );
    });
  });

  describe("decisions are append-only", () => {
    test("the runtime role can record and read a decision", async () => {
      const { taskId } = await startInstance(definitionId);
      const id = await recordDecision(taskId);
      const rows = await inTenant(
        (tx) =>
          tx`SELECT decided_by_tenant_user_id FROM awcms_workflow_decisions WHERE id = ${id}`
      );

      expect(rows).toHaveLength(1);
    });

    test("UPDATE is refused for the runtime role (privilege) and for the owner (trigger)", async () => {
      if (!appRoleActivated) return;
      const { taskId } = await startInstance(definitionId);
      const id = await recordDecision(taskId);

      // The audit's proof of concept: rewrite who decided.
      await assertRejected(
        inTenant(
          (tx) =>
            tx`UPDATE awcms_workflow_decisions SET decided_by_tenant_user_id = ${REQUESTER} WHERE id = ${id}`
        ),
        /permission denied/i
      );
      await assertRejected(
        inTenant(
          (tx) =>
            tx`UPDATE awcms_workflow_decisions SET on_behalf_of_tenant_user_id = ${REQUESTER} WHERE id = ${id}`
        ),
        /permission denied/i
      );
      await assertRejected(
        asOwner(
          (tx) =>
            tx`UPDATE awcms_workflow_decisions SET decision = 'reject' WHERE id = ${id}`
        ),
        /append-only/i
      );

      const rows = (await getAdminSql()`
        SELECT decision, decided_by_tenant_user_id, on_behalf_of_tenant_user_id
        FROM awcms_workflow_decisions WHERE id = ${id}
      `) as {
        decision: string;
        decided_by_tenant_user_id: string;
        on_behalf_of_tenant_user_id: string | null;
      }[];

      expect(rows[0]).toEqual({
        decision: "approve",
        decided_by_tenant_user_id: APPROVER,
        on_behalf_of_tenant_user_id: null
      });
    });

    test("DELETE is refused for the runtime role (privilege) and for the owner (trigger)", async () => {
      if (!appRoleActivated) return;
      const { taskId } = await startInstance(definitionId);
      const id = await recordDecision(taskId);

      await assertRejected(
        inTenant(
          (tx) => tx`DELETE FROM awcms_workflow_decisions WHERE id = ${id}`
        ),
        /permission denied/i
      );
      await assertRejected(
        asOwner(
          (tx) => tx`DELETE FROM awcms_workflow_decisions WHERE id = ${id}`
        ),
        /append-only/i
      );
    });
  });

  describe("instances: terminal is final", () => {
    test("the engine's legitimate moves keep working: pending -> approved | rejected | cancelled", async () => {
      for (const status of ["approved", "rejected", "cancelled"]) {
        const started = await startInstance(definitionId);

        if (status !== "cancelled") {
          await settle(started, status as "approved" | "rejected");
        } else {
          await inTenant(
            (tx) => tx`
              UPDATE awcms_workflow_instances
              SET status = 'cancelled', updated_at = now()
              WHERE tenant_id = ${TENANT} AND id = ${started.instanceId} AND status = 'pending'
            `
          );
        }

        const rows = (await getAdminSql()`
          SELECT status FROM awcms_workflow_instances WHERE id = ${started.instanceId}
        `) as { status: string }[];

        expect(rows[0]!.status).toBe(status);
      }
    });

    test("a pending instance may still change its due date, but not move back to pending", async () => {
      const started = await startInstance(definitionId);
      const { instanceId } = started;

      await inTenant(
        (tx) =>
          tx`UPDATE awcms_workflow_instances SET due_at = now(), updated_at = now() WHERE id = ${instanceId}`
      );
      await settle(started, "approved");
      await assertRejected(
        inTenant(
          (tx) =>
            tx`UPDATE awcms_workflow_instances SET status = 'pending' WHERE id = ${instanceId}`
        ),
        /WORKFLOW_INSTANCE_TERMINAL/
      );
    });

    test("every terminal status refuses any UPDATE, for the runtime role and for the owner", async () => {
      for (const status of ["approved", "rejected", "cancelled"]) {
        const started = await startInstance(definitionId);
        const { instanceId } = started;

        if (status === "cancelled") {
          await inTenant(
            (tx) =>
              tx`UPDATE awcms_workflow_instances SET status = 'cancelled' WHERE id = ${instanceId}`
          );
        } else {
          await settle(started, status as "approved" | "rejected");
        }

        // Flip the verdict (rejected -> approved is the abuse that matters).
        await assertRejected(
          inTenant(
            (tx) =>
              tx`UPDATE awcms_workflow_instances SET status = 'approved' WHERE id = ${instanceId}`
          ),
          /WORKFLOW_INSTANCE_TERMINAL/
        );
        // Even a no-op touch of a column outside the frozen identity set.
        await assertRejected(
          inTenant(
            (tx) =>
              tx`UPDATE awcms_workflow_instances SET updated_at = now() WHERE id = ${instanceId}`
          ),
          /WORKFLOW_INSTANCE_TERMINAL/
        );
        // Erase the cancellation stamps.
        await assertRejected(
          asOwner(
            (tx) =>
              tx`UPDATE awcms_workflow_instances SET cancelled_at = NULL, cancel_reason = NULL WHERE id = ${instanceId}`
          ),
          /WORKFLOW_INSTANCE_TERMINAL/
        );
        expect(
          (
            (await getAdminSql()`SELECT status FROM awcms_workflow_instances WHERE id = ${instanceId}`) as {
              status: string;
            }[]
          )[0]!.status
        ).toBe(status);
      }
    });

    test("the engine's status-guarded UPDATE simply matches nothing on a finished instance", async () => {
      const { instanceId } = await startInstance(definitionId);

      await inTenant(
        (tx) =>
          tx`UPDATE awcms_workflow_instances SET status = 'cancelled' WHERE id = ${instanceId}`
      );

      // `workflow-graph-engine.ts` / `workflow-recovery.ts`: zero rows, no error,
      // so their own "no longer pending" handling stays the thing that reports it.
      const rows = (await inTenant(
        (tx) => tx`
          UPDATE awcms_workflow_instances
          SET status = 'approved', updated_at = now()
          WHERE tenant_id = ${TENANT} AND id = ${instanceId} AND status = 'pending'
          RETURNING id
        `
      )) as { id: string }[];

      expect(rows).toHaveLength(0);
    });

    test("a pending instance's identity, requester, resource and facts are frozen", async () => {
      const { instanceId } = await startInstance(definitionId);

      for (const change of [
        "requested_by_tenant_user_id = '" + APPROVER + "'",
        "resource_id = 'other'",
        "resource_type = 'other'",
        `facts = '{"amount": 1}'::jsonb`,
        "workflow_definition_version = 9",
        "created_at = now() - interval '1 day'"
      ]) {
        await assertRejected(
          inTenant(
            (tx) =>
              tx.unsafe(
                `UPDATE awcms_workflow_instances SET ${change} WHERE id = '${instanceId}'`
              ) as Promise<unknown>
          ),
          /immutable/i
        );
      }
    });

    test("DELETE is refused for the runtime role (privilege) and for the owner (trigger), pending or not", async () => {
      if (!appRoleActivated) return;
      const pending = await startInstance(definitionId);
      const done = await startInstance(definitionId);

      await settle(done, "approved");

      for (const id of [pending.instanceId, done.instanceId]) {
        await assertRejected(
          inTenant(
            (tx) => tx`DELETE FROM awcms_workflow_instances WHERE id = ${id}`
          ),
          /permission denied/i
        );
        await assertRejected(
          asOwner(
            (tx) => tx`DELETE FROM awcms_workflow_instances WHERE id = ${id}`
          ),
          /never deleted/i
        );
      }
    });
  });

  describe("tasks: the separation-of-duties lookup path", () => {
    test("re-pointing a self-approved task to another instance is refused (runtime role and owner)", async () => {
      const mine = await startInstance(definitionId);
      const other = await startInstance(definitionId);

      await assertRejected(
        inTenant(
          (tx) =>
            tx`UPDATE awcms_workflow_tasks SET workflow_instance_id = ${other.instanceId} WHERE id = ${mine.taskId}`
        ),
        /immutable/i
      );
      await assertRejected(
        asOwner(
          (tx) =>
            tx`UPDATE awcms_workflow_tasks SET workflow_instance_id = ${other.instanceId} WHERE id = ${mine.taskId}`
        ),
        /immutable/i
      );
      await assertRejected(
        inTenant(
          (tx) =>
            tx`UPDATE awcms_workflow_tasks SET node_id = 'x', quorum_rule = 'any' WHERE id = ${mine.taskId}`
        ),
        /immutable/i
      );
    });

    test("a final task accepts no UPDATE, even after it completed or was cancelled", async () => {
      for (const status of ["completed", "cancelled"]) {
        const { instanceId, taskId } = await startInstance(definitionId);

        if (status === "completed") {
          await recordDecision(taskId);
        } else {
          // A task is cancelled only once its instance is (sql/301).
          await inTenant(
            (tx) =>
              tx`UPDATE awcms_workflow_instances SET status = 'cancelled' WHERE id = ${instanceId}`
          );
        }
        await inTenant(
          (tx) =>
            tx`UPDATE awcms_workflow_tasks SET status = ${status} WHERE id = ${taskId}`
        );
        await assertRejected(
          inTenant(
            (tx) =>
              tx`UPDATE awcms_workflow_tasks SET workflow_instance_id = ${instanceId} WHERE id = ${taskId}`
          ),
          /WORKFLOW_TASK_FINAL/
        );
        await assertRejected(
          asOwner(
            (tx) =>
              tx`UPDATE awcms_workflow_tasks SET status = 'pending' WHERE id = ${taskId}`
          ),
          /WORKFLOW_TASK_FINAL/
        );
      }
    });

    test("the engine's task writes keep working: escalation on a pending task, completion", async () => {
      const { taskId } = await startInstance(definitionId);

      await inTenant(
        (tx) =>
          tx`UPDATE awcms_workflow_tasks
             SET escalation_step = 1, escalated_at = now(), due_at = now()
             WHERE id = ${taskId} AND status = 'pending'`
      );
      await recordDecision(taskId);
      await inTenant(
        (tx) =>
          tx`UPDATE awcms_workflow_tasks SET status = 'completed' WHERE id = ${taskId}`
      );
    });
  });

  describe("instances: cancel stamps", () => {
    test("stamps are refused unless the same UPDATE moves the instance to cancelled", async () => {
      const { instanceId } = await startInstance(definitionId);

      for (const change of [
        "cancelled_by_tenant_user_id = '" + APPROVER + "'",
        "cancel_reason = 'forged'",
        "cancelled_at = now()",
        "status = 'approved', cancel_reason = 'forged'"
      ]) {
        await assertRejected(
          inTenant(
            (tx) =>
              tx.unsafe(
                `UPDATE awcms_workflow_instances SET ${change} WHERE id = '${instanceId}'`
              ) as Promise<unknown>
          ),
          /cancel stamps/i
        );
      }

      await inTenant(
        (tx) =>
          tx`UPDATE awcms_workflow_instances
             SET status = 'cancelled', cancelled_at = now(),
                 cancelled_by_tenant_user_id = ${APPROVER}, cancel_reason = 'ok'
             WHERE id = ${instanceId}`
      );
    });
  });
});
