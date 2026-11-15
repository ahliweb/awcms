/**
 * Issue #1341 / `sql/408` — `awcms_audit_events` is append-only to the runtime
 * role, and the retention purge still works as the worker role.
 *
 * Everything here runs as a REAL login (`awcms_app`, `awcms_worker`), not
 * `SET ROLE` from a superuser: the property is a privilege, and a source test
 * cannot see a GRANT. The ONE legitimate DELETE is the retention purge
 * (`purgeExpiredAuditEvents`, `bun run logs:audit:purge`), which production runs
 * as `awcms_worker`; that is asserted to keep working, so the revoke cannot
 * have broken the job it is not meant to touch.
 *
 * Gated on `DATABASE_URL` (harness §Gating); assertions that need a role skip
 * when the role is absent.
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
import { purgeExpiredAuditEvents } from "../../src/modules/logging/application/audit-purge";
import type { LegalHoldGuardPort } from "../../src/modules/_shared/ports/legal-hold-guard-port";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = new Date("2026-11-01T00:00:00.000Z");
const OLD = new Date("2023-01-01T00:00:00.000Z");

const describeOrSkip = integrationEnabled ? describe : describe.skip;

/**
 * A test that returns early when its role cannot be activated passes with zero
 * assertions, which reads as proof it never gave (audit L3). Under CI the roles
 * are always activatable, so a missing one is an environment fault and fails
 * loudly; elsewhere it is reported and skipped.
 */
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

describeOrSkip(
  "awcms_audit_events is append-only for awcms_app (#1341)",
  () => {
    beforeAll(async () => {
      await setupIntegrationDatabase();
    });

    afterAll(async () => {
      await teardownIntegrationDatabase();
    });

    async function seedTenants(): Promise<void> {
      await resetDatabase();
      await getAdminSql()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${TENANT_A}, 'audit-a', 'Audit A'), (${TENANT_B}, 'audit-b', 'Audit B')
    `;
    }

    test("catalogue: the app role holds SELECT and INSERT only; the worker keeps its DELETE", async () => {
      if (
        !roleAvailable(appRoleActivated, "awcms_app") ||
        !roleAvailable(workerRoleActivated, "awcms_worker")
      )
        return;
      await seedTenants();

      const rows = (await getAdminSql()`
      SELECT
        has_table_privilege(${APP_ROLE_NAME}, 'awcms_audit_events', 'SELECT') AS app_sel,
        has_table_privilege(${APP_ROLE_NAME}, 'awcms_audit_events', 'INSERT') AS app_ins,
        has_table_privilege(${APP_ROLE_NAME}, 'awcms_audit_events', 'UPDATE') AS app_upd,
        has_table_privilege(${APP_ROLE_NAME}, 'awcms_audit_events', 'DELETE') AS app_del,
        has_table_privilege(${APP_ROLE_NAME}, 'awcms_audit_events', 'TRUNCATE') AS app_trunc,
        has_table_privilege('awcms_worker', 'awcms_audit_events', 'DELETE') AS worker_del,
        has_table_privilege('awcms_worker', 'awcms_audit_events', 'UPDATE') AS worker_upd
    `) as Record<string, boolean>[];

      expect(rows[0]).toEqual({
        app_sel: true,
        app_ins: true,
        app_upd: false,
        app_del: false,
        app_trunc: false,
        worker_del: true,
        worker_upd: false
      });
    });

    test("as awcms_app: INSERT and SELECT work; UPDATE, DELETE and TRUNCATE are refused with 42501", async () => {
      if (!roleAvailable(appRoleActivated, "awcms_app")) return;
      await seedTenants();
      const app = getAppRoleSql();

      await withTenantOrThrow(
        app,
        TENANT_A,
        (tx) =>
          tx`
          INSERT INTO awcms_audit_events
            (tenant_id, module_key, action, resource_type, severity, message)
          VALUES (${TENANT_A}, 'test', 'create', 'thing', 'info', 'kept')
        ` as unknown as Promise<unknown>
      );
      const seen = await withTenantOrThrow(app, TENANT_A, async (tx) => {
        const r = (await tx`
        SELECT message FROM awcms_audit_events WHERE tenant_id = ${TENANT_A}
      `) as { message: string }[];
        return r.map((x) => x.message);
      });
      expect(seen).toEqual(["kept"]);

      const statements: [
        string,
        (tx: Bun.TransactionSQL) => Promise<unknown>
      ][] = [
        [
          "UPDATE",
          (tx) =>
            tx`UPDATE awcms_audit_events SET message = 'rewritten' WHERE tenant_id = ${TENANT_A}` as unknown as Promise<unknown>
        ],
        [
          "DELETE",
          (tx) =>
            tx`DELETE FROM awcms_audit_events WHERE tenant_id = ${TENANT_A}` as unknown as Promise<unknown>
        ],
        [
          "TRUNCATE",
          (tx) =>
            tx.unsafe(
              "TRUNCATE awcms_audit_events"
            ) as unknown as Promise<unknown>
        ]
      ];

      for (const [verb, run] of statements) {
        const error = (await assertRejected(
          withTenantOrThrow(app, TENANT_A, run),
          `${verb} of awcms_audit_events by awcms_app`
        )) as Error & { errno?: string };
        expect(String(error.errno ?? "") + " " + error.message).toMatch(
          /42501|permission denied/i
        );
      }

      // The refusals removed the ability to destroy the record, not to read it.
      const after = (await getAdminSql()`
      SELECT message FROM awcms_audit_events WHERE tenant_id = ${TENANT_A}
    `) as { message: string }[];
      expect(after.map((x) => x.message)).toEqual(["kept"]);
    });

    test("as awcms_worker: the retention purge still deletes aged rows, only for the tenant it runs for", async () => {
      if (!roleAvailable(workerRoleActivated, "awcms_worker")) return;
      await seedTenants();
      const admin = getAdminSql();

      await admin`
      INSERT INTO awcms_audit_events
        (tenant_id, module_key, action, resource_type, severity, message, created_at)
      VALUES
        (${TENANT_A}, 'test', 'create', 'thing', 'info', 'old-a', ${OLD}),
        (${TENANT_A}, 'test', 'create', 'thing', 'info', 'fresh-a', ${NOW}),
        (${TENANT_B}, 'test', 'create', 'thing', 'info', 'old-b', ${OLD})
    `;

      const notHeld: LegalHoldGuardPort = {
        isDescriptorHeld: async () => false
      } as unknown as LegalHoldGuardPort;

      const result = await purgeExpiredAuditEvents(
        getWorkerRoleSql(),
        TENANT_A,
        notHeld,
        { now: NOW }
      );
      expect(result.purgedCount).toBe(1);

      // The purge also writes its own audit row; what matters is that A's old row
      // is gone and neither A's fresh row nor B's old row was touched.
      const messages = (
        (await admin`SELECT message FROM awcms_audit_events`) as {
          message: string;
        }[]
      ).map((x) => x.message);
      expect(messages).not.toContain("old-a");
      expect(messages).toContain("fresh-a");
      expect(messages).toContain("old-b");
    });
  }
);
