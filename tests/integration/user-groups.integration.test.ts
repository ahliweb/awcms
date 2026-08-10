/**
 * A group is a subject (ADR-0081, Gelombang 3 PR 3.5 of #423), against a real
 * PostgreSQL.
 *
 * ## The failure this file is written against
 *
 * A group could have been built to confer permission KEYS. It would have looked
 * identical from the outside and it would have been wrong in a way nothing
 * observes: the subject would hold the keys while `subject.roles` stayed empty,
 * so a tenant's own `subject.roles in ["editor"]` policy would quietly stop
 * matching. An ALLOW policy that stops matching narrows (safe, someone notices);
 * a DENY policy that stops matching is INERT, which is a widening. SoD would go
 * the same way — its facts are keyed off the role grant.
 *
 * So the assertions below are not "membership works". They are: **the same
 * readers that see a direct grant see a group-derived one**, including the two
 * whose silence would be dangerous — `subject.roles` and the SoD resolver.
 *
 * That this holds at all is the payoff of ADR-0079: the group branch was added
 * to ONE fragment, so every reader gained it in one commit. This file is what
 * proves the claim rather than asserting the architecture.
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
import { listTenantUsers } from "../../src/modules/identity-access/application/access-directory";
import {
  fetchGrantedPermissionKeys,
  resolveTenantPrincipalForTenantUser
} from "../../src/modules/identity-access/application/auth-context";
import { resolveSoDAssignmentFacts } from "../../src/modules/identity-access/application/business-scope-facts";
import {
  assignRoleToGroup,
  unassignRoleFromGroup
} from "../../src/modules/identity-access/application/user-admin";
import {
  addUserGroupMember,
  createUserGroup,
  GroupExternallyManagedError,
  listUserGroups,
  removeUserGroupMember,
  updateUserGroup
} from "../../src/modules/identity-access/application/user-group-admin";

const TENANT = "f6666666-6666-4666-8666-666666666666";
const ADMIN_USER = "f6000000-0000-4000-8000-000000000001";
const MEMBER_USER = "f6000000-0000-4000-8000-000000000002";
const OUTSIDER = "f6000000-0000-4000-8000-000000000003";
const EDITOR_ROLE = "f6000000-0000-4000-8000-0000000000a1";

const GRANTED_KEY = "blog_content.posts.read";

async function seedTenantUser(id: string, label: string): Promise<void> {
  const admin = getAdminSql();

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT}, 'person', ${`Display ${label}`})
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

async function seedFixtures(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT}, 'group-tenant', 'Group Tenant')
  `;

  await seedTenantUser(ADMIN_USER, "admin");
  await seedTenantUser(MEMBER_USER, "member");
  await seedTenantUser(OUTSIDER, "outsider");

  await admin`
    INSERT INTO awcms_roles (id, tenant_id, role_code, role_name)
    VALUES (${EDITOR_ROLE}, ${TENANT}, 'editor', 'Editor')
  `;

  const permission = (await admin`
    SELECT id FROM awcms_permissions
    WHERE module_key = 'blog_content' AND activity_code = 'posts' AND action = 'read'
  `) as { id: string }[];

  await admin`
    INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
    VALUES (${TENANT}, ${EDITOR_ROLE}, ${permission[0]!.id})
  `;
}

/** Creates a group holding `editor`, with MEMBER_USER in it. Everything through the real writers. */
async function seedGroupGrant(): Promise<string> {
  return withTenantOrThrow(getRuntimeSql(), TENANT, async (tx) => {
    const group = await createUserGroup(tx, TENANT, ADMIN_USER, {
      groupCode: "editors",
      groupName: "Editors",
      description: null
    });

    await assignRoleToGroup(tx, TENANT, ADMIN_USER, group.id, EDITOR_ROLE);
    await addUserGroupMember(tx, TENANT, ADMIN_USER, {
      userGroupId: group.id,
      tenantUserId: MEMBER_USER
    });

    return group.id;
  });
}

const suite = integrationEnabled ? describe : describe.skip;

suite("a user group is a subject (ADR-0081)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedFixtures();
  });

  test("a group-derived role reaches EVERY reader, including subject.roles", async () => {
    await seedGroupGrant();

    const runtime = getRuntimeSql();
    const [principal, keys, facts, users] = await withTenantOrThrow(
      runtime,
      TENANT,
      async (tx) => [
        await resolveTenantPrincipalForTenantUser(tx, TENANT, MEMBER_USER),
        await fetchGrantedPermissionKeys(tx, TENANT, MEMBER_USER),
        await resolveSoDAssignmentFacts(tx, TENANT, MEMBER_USER, new Date()),
        await listTenantUsers(tx, TENANT)
      ]
    );

    // `subject.roles` — the one whose emptiness makes a DENY policy inert.
    expect(principal?.context.roles).toEqual(["editor"]);
    // RBAC.
    expect([...keys]).toContain(GRANTED_KEY);
    // SoD — blind here means it stops reporting conflicts and says so.
    expect(facts.map((fact) => fact.permissionKey)).toContain(GRANTED_KEY);
    // The admin listing.
    expect(users.find((user) => user.id === MEMBER_USER)?.roles).toEqual([
      "editor"
    ]);
  });

  test("a non-member of the same tenant gets nothing", async () => {
    await seedGroupGrant();

    const runtime = getRuntimeSql();
    const [principal, keys] = await withTenantOrThrow(
      runtime,
      TENANT,
      async (tx) => [
        await resolveTenantPrincipalForTenantUser(tx, TENANT, OUTSIDER),
        await fetchGrantedPermissionKeys(tx, TENANT, OUTSIDER)
      ]
    );

    expect(principal?.context.roles).toEqual([]);
    expect([...keys]).toEqual([]);
  });

  test("removing the member takes the role away immediately", async () => {
    const groupId = await seedGroupGrant();

    const runtime = getRuntimeSql();

    await withTenantOrThrow(runtime, TENANT, (tx) =>
      removeUserGroupMember(tx, TENANT, ADMIN_USER, {
        userGroupId: groupId,
        tenantUserId: MEMBER_USER
      })
    );

    const principal = await withTenantOrThrow(runtime, TENANT, (tx) =>
      resolveTenantPrincipalForTenantUser(tx, TENANT, MEMBER_USER)
    );

    expect(principal?.context.roles).toEqual([]);
  });

  test("revoking the GROUP's role takes it from every member at once", async () => {
    const groupId = await seedGroupGrant();

    const runtime = getRuntimeSql();

    const removed = await withTenantOrThrow(runtime, TENANT, (tx) =>
      unassignRoleFromGroup(tx, TENANT, ADMIN_USER, groupId, EDITOR_ROLE)
    );
    expect(removed).toBe(true);

    const keys = await withTenantOrThrow(runtime, TENANT, (tx) =>
      fetchGrantedPermissionKeys(tx, TENANT, MEMBER_USER)
    );

    expect([...keys]).toEqual([]);
  });

  test("a soft-deleted group grants nothing", async () => {
    // Soft-delete is the only lifecycle a group has today, and it has to be a
    // REVOCATION rather than a rename with side effects — otherwise a group
    // removed from the screen would keep conferring its roles.
    const groupId = await seedGroupGrant();

    await getAdminSql()`
      UPDATE awcms_user_groups SET deleted_at = now()
      WHERE tenant_id = ${TENANT} AND id = ${groupId}
    `;

    const keys = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      fetchGrantedPermissionKeys(tx, TENANT, MEMBER_USER)
    );

    expect([...keys]).toEqual([]);
  });

  test("a direct grant survives losing the group-derived one", async () => {
    // The two paths must not be able to cancel each other. Revoking a group's
    // role calls a DIFFERENT writer from revoking a person's, and this is what
    // says so against a database rather than by reading both.
    const groupId = await seedGroupGrant();
    const runtime = getRuntimeSql();

    await withTenantOrThrow(runtime, TENANT, async (tx) => {
      await tx`
        INSERT INTO awcms_access_policies
          (tenant_id, subject_type, tenant_user_id, role_id, scope_type, scope_id)
        VALUES (${TENANT}, 'tenant_user', ${MEMBER_USER}, ${EDITOR_ROLE}, 'tenant', ${TENANT})
      `;
    });

    await withTenantOrThrow(runtime, TENANT, (tx) =>
      unassignRoleFromGroup(tx, TENANT, ADMIN_USER, groupId, EDITOR_ROLE)
    );

    const principal = await withTenantOrThrow(runtime, TENANT, (tx) =>
      resolveTenantPrincipalForTenantUser(tx, TENANT, MEMBER_USER)
    );

    // Held once, through the surviving direct grant — not twice, and not zero.
    expect(principal?.context.roles).toEqual(["editor"]);
  });

  test("the listing shows the role count, which is what makes a group visible as an authority", async () => {
    const groupId = await seedGroupGrant();

    const groups = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      listUserGroups(tx, TENANT)
    );

    const group = groups.find((row) => row.id === groupId);

    expect(group?.memberCount).toBe(1);
    expect(group?.roleCount).toBe(1);
  });

  test("a directory-managed group refuses rename and membership", async () => {
    const groupId = await seedGroupGrant();

    await getAdminSql()`
      UPDATE awcms_user_groups
      SET source = 'scim', external_id = 'idp-editors'
      WHERE tenant_id = ${TENANT} AND id = ${groupId}
    `;

    const runtime = getRuntimeSql();

    await expect(
      withTenantOrThrow(runtime, TENANT, (tx) =>
        updateUserGroup(tx, TENANT, ADMIN_USER, groupId, {
          groupName: "Renamed",
          description: null
        })
      )
    ).rejects.toBeInstanceOf(GroupExternallyManagedError);

    await expect(
      withTenantOrThrow(runtime, TENANT, (tx) =>
        addUserGroupMember(tx, TENANT, ADMIN_USER, {
          userGroupId: groupId,
          tenantUserId: OUTSIDER
        })
      )
    ).rejects.toBeInstanceOf(GroupExternallyManagedError);

    // And the refusal is not a silent no-op: the existing grant still works.
    const keys = await withTenantOrThrow(runtime, TENANT, (tx) =>
      fetchGrantedPermissionKeys(tx, TENANT, MEMBER_USER)
    );
    expect([...keys]).toContain(GRANTED_KEY);
  });

  test("the XOR is enforced by the database, not only by validation", async () => {
    // A row naming both subjects, or neither, must be impossible even for a
    // caller that bypasses the API — the constraint is what replaced the NOT
    // NULL that used to make it unrepresentable.
    const admin = getAdminSql();
    let bothRejected = false;
    let neitherRejected = false;

    try {
      await admin`
        INSERT INTO awcms_access_policies
          (tenant_id, subject_type, tenant_user_id, user_group_id, role_id, scope_type, scope_id)
        VALUES (${TENANT}, 'tenant_user', ${MEMBER_USER},
                ${await seedGroupGrant()}, ${EDITOR_ROLE}, 'tenant', ${TENANT})
      `;
    } catch {
      bothRejected = true;
    }

    try {
      await admin`
        INSERT INTO awcms_access_policies
          (tenant_id, subject_type, role_id, scope_type, scope_id)
        VALUES (${TENANT}, 'user_group', ${EDITOR_ROLE}, 'tenant', ${TENANT})
      `;
    } catch {
      neitherRejected = true;
    }

    expect(bothRejected).toBe(true);
    expect(neitherRejected).toBe(true);
  });
});
