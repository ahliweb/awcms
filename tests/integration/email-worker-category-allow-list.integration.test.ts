/**
 * The worker's e-mail category allow-list is DATA (sql/410, ADR-0164, Issue
 * #1277). Run as the REAL `awcms_worker` role against the real guard trigger:
 * a declared category (a row) is accepted, an undeclared one is refused, an
 * empty table refuses everything (fail-closed), and neither runtime role can
 * write the table, so a runtime path cannot widen its own repertoire.
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
  getRuntimeSql,
  getWorkerRoleSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
  workerRoleActivated
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";

const TENANT = "a9990000-0000-4000-8000-0000000000e1";
const REFUSED = "EMAIL_WORKER_CATEGORY_NOT_ALLOWED|42501";
const suite = integrationEnabled ? describe : describe.skip;

const PROFILE = "a9990000-0000-4000-8000-0000000000e3";
const IDENTITY = "a9990000-0000-4000-8000-0000000000e2";
/** The categories the guard allowed for awcms_worker immediately before sql/410 (sql/371 body). */
const PRE_410_CATEGORIES = [
  "crm.follow_up_assigned",
  "crm.follow_up_due",
  "crm.follow_up_escalated",
  "hr.attendance_correction_applied",
  "hr.attendance_correction_cancelled",
  "hr.attendance_correction_rejected"
];

function workerInsert(
  category: string,
  to = "a@b.test",
  variables: Record<string, string> | null = null
) {
  return withTenantOrThrow(
    getWorkerRoleSql(),
    TENANT,
    (tx) => tx`
      INSERT INTO awcms_email_messages
        (tenant_id, category, template_key, to_address, to_address_hash,
         to_address_masked, subject, variables)
      VALUES (${TENANT}, ${category}, ${category}, ${to}, 'h', 'm', 's',
              ${variables === null ? null : tx.json(variables)})`
  );
}

suite("worker e-mail category allow-list is data (#1277)", () => {
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
      VALUES (${TENANT}, 'wc-allow', 'Allow list')
    `;
    await getAdminSql()`
      DELETE FROM awcms_email_worker_categories WHERE category LIKE 'derived.%'
    `;
  });

  test("migration seeds exactly the six categories the sql/371 guard allowed", async () => {
    const rows = (await getAdminSql()`
      SELECT category FROM awcms_email_worker_categories ORDER BY category
    `) as { category: string }[];

    expect(rows.map((row) => row.category)).toEqual(PRE_410_CATEGORIES);
  });

  test("every category the pre-410 guard allowed is still accepted for a worker insert, and unlisted ones are refused", async () => {
    if (!workerRoleActivated) return;

    // The hr categories carry no extra condition; the crm ones also need an
    // ACTIVE staff recipient and allow-listed variable keys, tested below.
    for (const category of PRE_410_CATEGORIES.filter((c) =>
      c.startsWith("hr.")
    )) {
      await workerInsert(category);
    }

    await getAdminSql()`
      INSERT INTO awcms_profiles (id, tenant_id, profile_type, display_name)
      VALUES (${PROFILE}, ${TENANT}, 'person', 'Staff')
    `;
    await getAdminSql()`
      INSERT INTO awcms_identities (id, tenant_id, profile_id, login_identifier, password_hash)
      VALUES (${IDENTITY}, ${TENANT}, ${PROFILE}, 'staff@wc.test', 'x')
    `;
    await getAdminSql()`
      INSERT INTO awcms_tenant_users (tenant_id, identity_id)
      VALUES (${TENANT}, ${IDENTITY})
    `;

    for (const category of PRE_410_CATEGORIES.filter((c) =>
      c.startsWith("crm.")
    )) {
      await workerInsert(category, "staff@wc.test", { userName: "A" });
      // sql/371 conditions survive: outside address, foreign key in variables.
      await assertRejected(
        workerInsert(category, "outsider@wc.test"),
        "EMAIL_WORKER_RECIPIENT_NOT_STAFF|42501"
      );
      await assertRejected(
        workerInsert(category, "staff@wc.test", { leadName: "L" }),
        "EMAIL_WORKER_VARIABLE_NOT_ALLOWED|42501"
      );
    }

    for (const category of [
      "auth.password_reset",
      "system.announcement",
      "crm.follow_up_other"
    ]) {
      await assertRejected(workerInsert(category), REFUSED);
    }
  });

  test("a category added as a ROW is accepted, an undeclared one refused, and removing the row refuses it again", async () => {
    if (!workerRoleActivated) return;

    await assertRejected(workerInsert("derived.otp_mail"), REFUSED);

    // What a downstream module's migration does: one row, no function re-issued.
    await getAdminSql()`
      INSERT INTO awcms_email_worker_categories (category)
      VALUES ('derived.otp_mail') ON CONFLICT DO NOTHING
    `;

    await workerInsert("derived.otp_mail");
    await assertRejected(workerInsert("derived.other_mail"), REFUSED);
    await assertRejected(workerInsert("system.announcement"), REFUSED);

    await getAdminSql()`
      DELETE FROM awcms_email_worker_categories WHERE category = 'derived.otp_mail'
    `;
    await assertRejected(workerInsert("derived.otp_mail"), REFUSED);
  });

  test("an EMPTY allow-list refuses every worker insert (fail-closed)", async () => {
    if (!workerRoleActivated) return;

    await getAdminSql()`DELETE FROM awcms_email_worker_categories`;

    await assertRejected(
      workerInsert("hr.attendance_correction_applied"),
      REFUSED
    );

    await getAdminSql()`
      INSERT INTO awcms_email_worker_categories (category)
      VALUES ('hr.attendance_correction_applied')
    `;
    await workerInsert("hr.attendance_correction_applied");
  });

  test("neither runtime role can write the allow-list, only read it", async () => {
    if (!workerRoleActivated) return;

    const worker = getWorkerRoleSql();
    const app = getRuntimeSql();

    for (const sql of [worker, app]) {
      await assertRejected(
        sql`INSERT INTO awcms_email_worker_categories (category) VALUES ('derived.self_grant')`,
        "permission denied"
      );
      await assertRejected(
        sql`UPDATE awcms_email_worker_categories SET category = 'derived.x'`,
        "permission denied"
      );
      await assertRejected(
        sql`DELETE FROM awcms_email_worker_categories`,
        "permission denied"
      );
    }

    expect(
      ((await worker`SELECT 1 FROM awcms_email_worker_categories`) as unknown[])
        .length
    ).toBeGreaterThan(0);
  });

  test("the request path (awcms_app) is not subject to the worker allow-list", async () => {
    await withTenantOrThrow(
      getRuntimeSql(),
      TENANT,
      (tx) => tx`
        INSERT INTO awcms_email_messages
          (tenant_id, category, template_key, to_address, to_address_hash,
           to_address_masked, subject)
        VALUES (${TENANT}, 'system.announcement', 'system.announcement',
                'a@b.test', 'h', 'm', 's')`
    );
  });
});
