/**
 * Issue #1346 / `sql/409` — the remaining append-only ledgers are append-only to
 * the runtime role, and the one retention DELETE among them still works as the
 * worker role.
 *
 * Follows `audit-events-append-only.integration.test.ts` (`sql/408`). Everything
 * runs as a REAL login (`awcms_app`, `awcms_worker`), not `SET ROLE` from a
 * superuser: the property is a privilege, and a source test cannot see a GRANT.
 *
 * Parent rows the foreign keys need (policies, assignments) are written by the
 * ADMIN connection with `session_replication_role = replica`, which is how a
 * fixture skips the unrelated role/user/group chain. The runtime INSERT under
 * test then runs as `awcms_app` with foreign keys enforced.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  APP_ROLE_NAME,
  appRoleActivated,
  assertRejected,
  getAdminSql,
  getAppRoleSql,
  getWorkerRoleSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
  workerRoleActivated
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
/** Parent rows are per tenant: the id is a primary key, the FK is composite. */
const POLICY_IDS: Record<string, string> = {
  [TENANT_A]: "11111111-1111-4111-8111-111111111111",
  [TENANT_B]: "11111111-1111-4111-8111-222222222222"
};
const ASSIGNMENT_IDS: Record<string, string> = {
  [TENANT_A]: "22222222-2222-4222-8222-111111111111",
  [TENANT_B]: "22222222-2222-4222-8222-222222222222"
};
const ROLE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";
const AGGREGATE_ID = "55555555-5555-4555-8555-555555555555";

const describeOrSkip = integrationEnabled ? describe : describe.skip;

/** Fails loudly under CI when a role is missing; reports and skips elsewhere. */
function roleAvailable(active: boolean, role: string): boolean {
  if (active) return true;
  if (process.env.CI) {
    throw new Error(
      `${role} could not be activated; this suite would assert nothing.`
    );
  }
  console.warn(`[skip] ${role} is not activated; no assertions were made.`);
  return false;
}

type Ledger = {
  table: string;
  /** A statement inserting one row for `tenant`, bound through `tx`. */
  insert: (tx: Bun.TransactionSQL, tenant: string) => Promise<unknown>;
  /** A column an UPDATE can target. */
  column: string;
  /** Whether the worker role legitimately DELETEs here (retention). */
  workerDeletes: boolean;
  workerInserts: boolean;
};

const LEDGERS: Ledger[] = [
  {
    table: "awcms_abac_decision_logs",
    column: "reason",
    workerDeletes: true,
    workerInserts: false,
    insert: (tx, tenant) =>
      tx`
        INSERT INTO awcms_abac_decision_logs
          (tenant_id, module_key, activity_code, action, decision, reason)
        VALUES (${tenant}, 'test', 'test.read', 'read', 'allow', 'ledger-probe')
      ` as unknown as Promise<unknown>
  },
  {
    table: "awcms_access_policy_events",
    column: "reason",
    workerDeletes: false,
    workerInserts: false,
    insert: (tx, tenant) =>
      tx`
        INSERT INTO awcms_access_policy_events
          (tenant_id, policy_id, event_type, reason)
        VALUES (${tenant}, ${POLICY_IDS[tenant]}, 'granted', 'ledger-probe')
      ` as unknown as Promise<unknown>
  },
  {
    table: "awcms_business_scope_assignment_events",
    column: "reason",
    workerDeletes: false,
    workerInserts: true,
    insert: (tx, tenant) =>
      tx`
        INSERT INTO awcms_business_scope_assignment_events
          (tenant_id, assignment_id, event_type, reason)
        VALUES (${tenant}, ${ASSIGNMENT_IDS[tenant]}, 'granted', 'ledger-probe')
      ` as unknown as Promise<unknown>
  },
  {
    table: "awcms_domain_events",
    column: "producer_module",
    workerDeletes: false,
    workerInserts: true,
    insert: (tx, tenant) =>
      tx`
        INSERT INTO awcms_domain_events
          (tenant_id, event_type, event_version, aggregate_type, aggregate_id,
           order_key, producer_module)
        VALUES (${tenant}, 'awcms.test.ledger.recorded', '1.0', 'ledger',
                ${AGGREGATE_ID}, 'k', 'test')
      ` as unknown as Promise<unknown>
  }
];

describeOrSkip(
  "the remaining append-only ledgers are append-only for awcms_app (#1346)",
  () => {
    beforeAll(async () => {
      await setupIntegrationDatabase();
    });

    afterAll(async () => {
      await teardownIntegrationDatabase();
    });

    async function seed(): Promise<void> {
      await resetDatabase();
      const admin = getAdminSql();
      await admin`
        INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
        VALUES (${TENANT_A}, 'ledger-a', 'Ledger A'), (${TENANT_B}, 'ledger-b', 'Ledger B')
      `;
      await admin.begin(async (tx) => {
        await tx`SET LOCAL session_replication_role = replica`;
        for (const tenant of [TENANT_A, TENANT_B]) {
          await tx`
            INSERT INTO awcms_access_policies
              (id, tenant_id, tenant_user_id, role_id, scope_id, subject_type)
            VALUES (${POLICY_IDS[tenant]}, ${tenant}, ${USER_ID}, ${ROLE_ID}, ${tenant}, 'tenant_user')
          `;
          await tx`
            INSERT INTO awcms_business_scope_assignments
              (id, tenant_id, tenant_user_id, scope_type, scope_id, granted_by_tenant_user_id)
            VALUES (${ASSIGNMENT_IDS[tenant]}, ${tenant}, ${USER_ID}, 'office', ${tenant}, ${USER_ID})
          `;
        }
      });
    }

    test("catalogue: the app role holds SELECT and INSERT only; worker grants are unchanged", async () => {
      if (
        !roleAvailable(appRoleActivated, "awcms_app") ||
        !roleAvailable(workerRoleActivated, "awcms_worker")
      )
        return;
      await resetDatabase();

      for (const ledger of LEDGERS) {
        const rows = (await getAdminSql()`
          SELECT
            has_table_privilege(${APP_ROLE_NAME}, ${ledger.table}, 'SELECT') AS app_sel,
            has_table_privilege(${APP_ROLE_NAME}, ${ledger.table}, 'INSERT') AS app_ins,
            has_table_privilege(${APP_ROLE_NAME}, ${ledger.table}, 'UPDATE') AS app_upd,
            has_table_privilege(${APP_ROLE_NAME}, ${ledger.table}, 'DELETE') AS app_del,
            has_table_privilege(${APP_ROLE_NAME}, ${ledger.table}, 'TRUNCATE') AS app_trunc,
            has_table_privilege('awcms_worker', ${ledger.table}, 'DELETE') AS worker_del,
            has_table_privilege('awcms_worker', ${ledger.table}, 'UPDATE') AS worker_upd,
            has_table_privilege('awcms_worker', ${ledger.table}, 'INSERT') AS worker_ins
        `) as Record<string, boolean>[];

        expect({ table: ledger.table, ...rows[0] } as Record<
          string,
          unknown
        >).toEqual({
          table: ledger.table,
          app_sel: true,
          app_ins: true,
          app_upd: false,
          app_del: false,
          app_trunc: false,
          worker_del: ledger.workerDeletes,
          worker_upd: false,
          worker_ins: ledger.workerInserts
        });
      }
    });

    for (const ledger of LEDGERS) {
      test(`${ledger.table} as awcms_app: INSERT and SELECT work; UPDATE, DELETE and TRUNCATE are refused with 42501`, async () => {
        if (!roleAvailable(appRoleActivated, "awcms_app")) return;
        await seed();
        const app = getAppRoleSql();

        await withTenantOrThrow(app, TENANT_A, (tx) =>
          ledger.insert(tx, TENANT_A)
        );
        const count = await withTenantOrThrow(app, TENANT_A, async (tx) => {
          const r = (await tx.unsafe(
            `SELECT count(*)::int AS n FROM ${ledger.table}`
          )) as { n: number }[];
          return r[0]!.n;
        });
        expect(count).toBeGreaterThanOrEqual(1);

        const statements: [
          string,
          (tx: Bun.TransactionSQL) => Promise<unknown>
        ][] = [
          [
            "UPDATE",
            (tx) =>
              tx.unsafe(
                `UPDATE ${ledger.table} SET ${ledger.column} = ${ledger.column}`
              ) as unknown as Promise<unknown>
          ],
          [
            "DELETE",
            (tx) =>
              tx.unsafe(
                `DELETE FROM ${ledger.table}`
              ) as unknown as Promise<unknown>
          ],
          [
            "TRUNCATE",
            (tx) =>
              tx.unsafe(
                `TRUNCATE ${ledger.table}`
              ) as unknown as Promise<unknown>
          ]
        ];

        for (const [verb, run] of statements) {
          const error = (await assertRejected(
            withTenantOrThrow(app, TENANT_A, run),
            `${verb} of ${ledger.table} by awcms_app`
          )) as Error & { errno?: string };
          expect(String(error.errno ?? "") + " " + error.message).toMatch(
            /42501|permission denied/i
          );
        }

        // The refusals removed the ability to destroy the record, not to read it.
        const after = (await getAdminSql().unsafe(
          `SELECT count(*)::int AS n FROM ${ledger.table}`
        )) as { n: number }[];
        expect(after[0]!.n).toBeGreaterThanOrEqual(1);
      });

      test(`${ledger.table} as awcms_worker: UPDATE and TRUNCATE are refused; DELETE is ${
        ledger.workerDeletes ? "kept (retention)" : "refused"
      }`, async () => {
        if (!roleAvailable(workerRoleActivated, "awcms_worker")) return;
        await seed();
        await withTenantOrThrow(getAppRoleSql(), TENANT_A, (tx) =>
          ledger.insert(tx, TENANT_A)
        );
        await withTenantOrThrow(getAppRoleSql(), TENANT_B, (tx) =>
          ledger.insert(tx, TENANT_B)
        );
        const worker = getWorkerRoleSql();

        for (const verb of ["UPDATE", "TRUNCATE"] as const) {
          const error = (await assertRejected(
            withTenantOrThrow(
              worker,
              TENANT_A,
              (tx) =>
                tx.unsafe(
                  verb === "UPDATE"
                    ? `UPDATE ${ledger.table} SET ${ledger.column} = ${ledger.column}`
                    : `TRUNCATE ${ledger.table}`
                ) as unknown as Promise<unknown>
            ),
            `${verb} of ${ledger.table} by awcms_worker`
          )) as Error & { errno?: string };
          expect(String(error.errno ?? "") + " " + error.message).toMatch(
            /42501|permission denied/i
          );
        }

        if (ledger.workerDeletes) {
          // Retention keeps working, and stays tenant-scoped by RLS: tenant B's
          // row is not reachable from tenant A's context.
          await withTenantOrThrow(
            worker,
            TENANT_A,
            (tx) =>
              tx.unsafe(
                `DELETE FROM ${ledger.table}`
              ) as unknown as Promise<unknown>
          );
          const left = (await getAdminSql().unsafe(
            `SELECT tenant_id FROM ${ledger.table}`
          )) as { tenant_id: string }[];
          expect(left.map((r) => r.tenant_id)).toEqual([TENANT_B]);
        } else {
          const error = (await assertRejected(
            withTenantOrThrow(
              worker,
              TENANT_A,
              (tx) =>
                tx.unsafe(
                  `DELETE FROM ${ledger.table}`
                ) as unknown as Promise<unknown>
            ),
            `DELETE of ${ledger.table} by awcms_worker`
          )) as Error & { errno?: string };
          expect(String(error.errno ?? "") + " " + error.message).toMatch(
            /42501|permission denied/i
          );
        }
      });
    }
  }
);
