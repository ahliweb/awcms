/**
 * Issue #1056 — a grant whose `effective_to` has passed must not block granting
 * the same role again. Against a real PostgreSQL (WORLD 1), because the cause is
 * a partial UNIQUE index keyed on `status` (`sql/102`, `sql/104`) that a fake
 * transaction cannot see: the bundle fix from #1055/g07 made only the pre-check
 * time-aware and left the INSERT to raise 23505 -> 409 all the same.
 *
 * What is pinned:
 *
 *   1. LAPSED + ACTIVE -> RE-GRANT SUCCEEDS, through the real admin entry point
 *      (`assignRole` / `assignRoleToGroup`), for a person and for a group.
 *   2. THE LAPSED ROW IS KEPT, as history: transitioned to `expired` (never
 *      deleted), with an `expired` lifecycle event and an audit row.
 *   3. NOTHING THAT IS STILL IN FORCE OR PENDING IS LAPSED — a live open-ended
 *      grant, a live grant with a future end, and a future-dated grant all keep
 *      their 409, and keep `status = 'active'`.
 *   4. THE LAPSE IS SCOPED to the (subject, role) being granted; another role of
 *      the same subject, and the same role of another subject, are untouched.
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
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { listUserGroups } from "../../src/modules/identity-access/application/user-group-admin";
import {
  assignRole,
  assignRoleToGroup,
  DuplicateAssignmentError
} from "../../src/modules/identity-access/application/user-admin";

const TENANT = "1056aaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ADMIN_USER = "10560000-0000-4000-8000-000000000001";
const SUBJECT = "10560000-0000-4000-8000-000000000002";
const OTHER_SUBJECT = "10560000-0000-4000-8000-000000000003";
const ROLE = "10560000-0000-4000-8000-0000000000a1";
const OTHER_ROLE = "10560000-0000-4000-8000-0000000000a2";
const GROUP = "10560000-0000-4000-8000-0000000000c1";

const HOUR = 3_600_000;

async function seed(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT}, 'lapsed-regrant', 'Lapsed Regrant')
  `;

  for (const [id, label] of [
    [ADMIN_USER, "admin"],
    [SUBJECT, "subject"],
    [OTHER_SUBJECT, "other"]
  ] as const) {
    const profile = (await admin`
      INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
      VALUES (${TENANT}, 'person', ${`Profile ${label}`})
      RETURNING id
    `) as { id: string }[];
    const identity = (await admin`
      INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
      VALUES (${TENANT}, ${profile[0]!.id}, ${`${label}@example.test`}, 'x')
      RETURNING id
    `) as { id: string }[];
    await admin`
      INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
      VALUES (${id}, ${TENANT}, ${identity[0]!.id})
    `;
  }

  await admin`
    INSERT INTO awcms_roles (id, tenant_id, role_code, role_name)
    VALUES (${ROLE}, ${TENANT}, 'lapsed-role', 'Lapsed role'),
           (${OTHER_ROLE}, ${TENANT}, 'other-role', 'Other role')
  `;

  await admin`
    INSERT INTO awcms_user_groups (id, tenant_id, group_code, group_name)
    VALUES (${GROUP}, ${TENANT}, 'lapsed-group', 'Lapsed group')
  `;
}

/** An `active` policy row, window given relative to now (ms). */
async function insertPolicy(input: {
  tenantUserId?: string;
  userGroupId?: string;
  roleId?: string;
  fromMs: number;
  toMs: number | null;
}): Promise<string> {
  const now = Date.now();
  const rows = (await getAdminSql()`
    INSERT INTO awcms_access_policies
      (tenant_id, subject_type, tenant_user_id, user_group_id, role_id,
       scope_type, scope_id, status, effective_from, effective_to)
    VALUES
      (${TENANT}, ${input.userGroupId ? "user_group" : "tenant_user"},
       ${input.userGroupId ? null : (input.tenantUserId ?? SUBJECT)},
       ${input.userGroupId ?? null}, ${input.roleId ?? ROLE},
       'tenant', ${TENANT}, 'active',
       ${new Date(now + input.fromMs)},
       ${input.toMs === null ? null : new Date(now + input.toMs)})
    RETURNING id
  `) as { id: string }[];
  return rows[0]!.id;
}

async function statusOf(id: string): Promise<string | undefined> {
  const rows = (await getAdminSql()`
    SELECT status FROM awcms_access_policies WHERE id = ${id}
  `) as { status: string }[];
  return rows[0]?.status;
}

function grant(
  subject: string = SUBJECT,
  role: string = ROLE
): Promise<{ id: string }> {
  return withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
    assignRole(tx, TENANT, ADMIN_USER, subject, role)
  );
}

function grantToGroup(): Promise<{ id: string }> {
  return withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
    assignRoleToGroup(tx, TENANT, ADMIN_USER, GROUP, ROLE)
  );
}

const suite = integrationEnabled ? describe : describe.skip;

suite("re-granting a role whose earlier grant lapsed (#1056)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seed();
  });

  test("a lapsed but still-active grant does not block a re-grant (person)", async () => {
    const lapsedId = await insertPolicy({ fromMs: -2 * HOUR, toMs: -HOUR });
    expect(await statusOf(lapsedId)).toBe("active");

    const result = await grant();

    expect(result.id).toBeTruthy();
    expect(await statusOf(lapsedId)).toBe("expired");

    const live = (await getAdminSql()`
      SELECT id FROM awcms_access_policies
      WHERE tenant_id = ${TENANT} AND tenant_user_id = ${SUBJECT}
        AND role_id = ${ROLE} AND status = 'active'
    `) as { id: string }[];
    expect(live.map((row) => row.id)).toEqual([result.id]);
  });

  test("the lapsed row is kept as history with an expired event and an audit row", async () => {
    const lapsedId = await insertPolicy({ fromMs: -2 * HOUR, toMs: -HOUR });

    await grant();

    const row = (await getAdminSql()`
      SELECT effective_to, revoked_at FROM awcms_access_policies WHERE id = ${lapsedId}
    `) as { effective_to: Date | null; revoked_at: Date | null }[];
    expect(row).toHaveLength(1);
    expect(row[0]!.effective_to).not.toBeNull();
    expect(row[0]!.revoked_at).toBeNull();

    const events = (await getAdminSql()`
      SELECT event_type, actor_tenant_user_id FROM awcms_access_policy_events
      WHERE policy_id = ${lapsedId} ORDER BY occurred_at
    `) as { event_type: string; actor_tenant_user_id: string | null }[];
    expect(events).toEqual([
      { event_type: "expired", actor_tenant_user_id: null }
    ]);

    const audit = (await getAdminSql()`
      SELECT action, resource_type, actor_tenant_user_id, attributes
      FROM awcms_audit_events
      WHERE tenant_id = ${TENANT} AND action = 'expire'
        AND resource_type = 'access_policy'
    `) as {
      action: string;
      actor_tenant_user_id: string | null;
      attributes: {
        policyIds: string[];
        roleId: string;
        policies: { id: string; scopeType: string; scopeId: string }[];
      };
    }[];
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor_tenant_user_id).toBe(ADMIN_USER);
    expect(audit[0]!.attributes.policyIds).toEqual([lapsedId]);
    expect(audit[0]!.attributes.roleId).toBe(ROLE);
    expect(audit[0]!.attributes.policies).toEqual([
      { id: lapsedId, scopeType: "tenant", scopeId: TENANT }
    ]);
  });

  test("a lapsed grant does not block a re-grant (group)", async () => {
    const lapsedId = await insertPolicy({
      userGroupId: GROUP,
      fromMs: -2 * HOUR,
      toMs: -HOUR
    });

    const result = await grantToGroup();

    expect(result.id).toBeTruthy();
    expect(await statusOf(lapsedId)).toBe("expired");
  });

  test("a grant still in force keeps its 409 and its status", async () => {
    const openEnded = await insertPolicy({ fromMs: -HOUR, toMs: null });
    await expect(grant()).rejects.toBeInstanceOf(DuplicateAssignmentError);
    expect(await statusOf(openEnded)).toBe("active");
  });

  test("a grant that ends in the future keeps its 409 and its status", async () => {
    const endsLater = await insertPolicy({ fromMs: -HOUR, toMs: HOUR });
    await expect(grant()).rejects.toBeInstanceOf(DuplicateAssignmentError);
    expect(await statusOf(endsLater)).toBe("active");
  });

  test("a future-dated grant is pending, not lapsed: 409 and still active", async () => {
    const pending = await insertPolicy({ fromMs: HOUR, toMs: 2 * HOUR });
    await expect(grant()).rejects.toBeInstanceOf(DuplicateAssignmentError);
    expect(await statusOf(pending)).toBe("active");
  });

  test("the lapse touches only the subject and role being granted", async () => {
    const otherRole = await insertPolicy({
      roleId: OTHER_ROLE,
      fromMs: -2 * HOUR,
      toMs: -HOUR
    });
    const otherSubject = await insertPolicy({
      tenantUserId: OTHER_SUBJECT,
      fromMs: -2 * HOUR,
      toMs: -HOUR
    });
    const target = await insertPolicy({ fromMs: -2 * HOUR, toMs: -HOUR });

    await grant();

    expect(await statusOf(target)).toBe("expired");
    expect(await statusOf(otherRole)).toBe("active");
    expect(await statusOf(otherSubject)).toBe("active");
  });

  test("the group role_count ignores an elapsed grant but counts a live one", async () => {
    await insertPolicy({
      userGroupId: GROUP,
      fromMs: -2 * HOUR,
      toMs: -HOUR
    });
    const count = async () =>
      (
        await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
          listUserGroups(tx, TENANT)
        )
      ).find((group) => group.id === GROUP)!.roleCount;

    expect(await count()).toBe(0);

    await insertPolicy({
      userGroupId: GROUP,
      roleId: OTHER_ROLE,
      fromMs: -HOUR,
      toMs: HOUR
    });
    expect(await count()).toBe(1);
  });
});
