/**
 * The worker's UPDATE on the e-mail queue is COLUMN-scoped (sql/415, Issue
 * #1364). Run as the REAL `awcms_worker` role: the dispatcher's own state
 * transitions still work, and a rewrite of who a queued message goes to, what
 * it says or which category it is filed under is refused by the grant.
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
  assertRejected,
  getAdminSql,
  getWorkerRoleSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
  workerRoleActivated
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";

const TENANT = "a9990000-0000-4000-8000-0000000000f1";
const MESSAGE = "a9990000-0000-4000-8000-0000000000f2";
const DENIED = "permission denied";
const suite = integrationEnabled ? describe : describe.skip;

suite("worker UPDATE on awcms_email_messages is column-scoped (#1364)", () => {
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
      VALUES (${TENANT}, 'wc-upd', 'Update columns')
    `;
    await getAdminSql()`
      INSERT INTO awcms_email_messages
        (id, tenant_id, category, template_key, to_address, to_address_hash,
         to_address_masked, subject, variables)
      VALUES (${MESSAGE}, ${TENANT}, 'hr.attendance_correction_applied',
              'hr.attendance_correction_applied', 'a@b.test', 'h', 'm', 's',
              '{"employeeName":"A"}'::jsonb)
    `;
  });

  test("the dispatcher's state transitions still work", async () => {
    if (!workerRoleActivated) return;

    const worker = getWorkerRoleSql();

    // claim (with RETURNING of columns the worker may read but not write)
    await withTenantOrThrow(
      worker,
      TENANT,
      (tx) => tx`
        UPDATE awcms_email_messages AS t
        SET status = 'sending', next_attempt_at = now() + interval '5 minutes'
        WHERE t.tenant_id = ${TENANT} AND t.id = ${MESSAGE}
        RETURNING t.id, t.category, t.to_address, t.variables`
    );
    // retry
    await withTenantOrThrow(
      worker,
      TENANT,
      (tx) => tx`
        UPDATE awcms_email_messages
        SET status = 'retry_wait', retry_count = 1, next_attempt_at = now(),
            last_error = 'boom'
        WHERE tenant_id = ${TENANT} AND id = ${MESSAGE} AND status = 'sending'`
    );
    await withTenantOrThrow(
      worker,
      TENANT,
      (tx) => tx`
        UPDATE awcms_email_messages
        SET status = 'sending' WHERE tenant_id = ${TENANT} AND id = ${MESSAGE}`
    );
    // finalize sent
    await withTenantOrThrow(
      worker,
      TENANT,
      (tx) => tx`
        UPDATE awcms_email_messages
        SET status = 'sent', sent_at = now(), next_attempt_at = null,
            provider_name = 'mailketing', provider_message_id = 'p-1',
            last_error = COALESCE(${null}, last_error)
        WHERE tenant_id = ${TENANT} AND id = ${MESSAGE} AND status = 'sending'`
    );

    const rows = (await getAdminSql()`
      SELECT status, provider_message_id FROM awcms_email_messages
      WHERE id = ${MESSAGE}
    `) as { status: string; provider_message_id: string }[];
    expect(rows[0]).toEqual({ status: "sent", provider_message_id: "p-1" });
  });

  test("a rewrite of recipient, category, template, subject or variables is refused", async () => {
    if (!workerRoleActivated) return;

    const worker = getWorkerRoleSql();

    await assertRejected(
      withTenantOrThrow(
        worker,
        TENANT,
        (tx) => tx`UPDATE awcms_email_messages SET to_address = 'x@evil.test'
                   WHERE tenant_id = ${TENANT} AND id = ${MESSAGE}`
      ),
      DENIED
    );
    await assertRejected(
      withTenantOrThrow(
        worker,
        TENANT,
        (tx) => tx`UPDATE awcms_email_messages SET to_address_hash = 'z'
                   WHERE tenant_id = ${TENANT} AND id = ${MESSAGE}`
      ),
      DENIED
    );
    await assertRejected(
      withTenantOrThrow(
        worker,
        TENANT,
        (tx) => tx`UPDATE awcms_email_messages
                   SET category = 'auth.password_reset'
                   WHERE tenant_id = ${TENANT} AND id = ${MESSAGE}`
      ),
      DENIED
    );
    await assertRejected(
      withTenantOrThrow(
        worker,
        TENANT,
        (tx) => tx`UPDATE awcms_email_messages SET template_key = 'other'
                   WHERE tenant_id = ${TENANT} AND id = ${MESSAGE}`
      ),
      DENIED
    );
    await assertRejected(
      withTenantOrThrow(
        worker,
        TENANT,
        (tx) => tx`UPDATE awcms_email_messages SET subject = 'phish'
                   WHERE tenant_id = ${TENANT} AND id = ${MESSAGE}`
      ),
      DENIED
    );
    await assertRejected(
      withTenantOrThrow(
        worker,
        TENANT,
        (tx) => tx`UPDATE awcms_email_messages
                   SET variables = '{"a":"b"}'::jsonb
                   WHERE tenant_id = ${TENANT} AND id = ${MESSAGE}`
      ),
      DENIED
    );

    const rows = (await getAdminSql()`
      SELECT category, to_address, subject FROM awcms_email_messages
      WHERE id = ${MESSAGE}
    `) as { category: string; to_address: string; subject: string }[];
    expect(rows[0]).toEqual({
      category: "hr.attendance_correction_applied",
      to_address: "a@b.test",
      subject: "s"
    });
  });

  test("the worker keeps SELECT and DELETE, and holds UPDATE only on column level", async () => {
    if (!workerRoleActivated) return;

    const rows = (await getAdminSql()`
      SELECT has_table_privilege('awcms_worker', 'awcms_email_messages', 'UPDATE') AS tbl_upd,
             has_table_privilege('awcms_worker', 'awcms_email_messages', 'SELECT') AS sel,
             has_table_privilege('awcms_worker', 'awcms_email_messages', 'DELETE') AS del
    `) as { tbl_upd: boolean; sel: boolean; del: boolean }[];
    expect(rows[0]).toEqual({ tbl_upd: false, sel: true, del: true });
  });
});
