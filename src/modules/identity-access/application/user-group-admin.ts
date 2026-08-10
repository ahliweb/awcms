/**
 * User-group administration (ADR-0081, Gelombang 3 PR 3.5 of #423) — the read
 * model and the three mutations behind `/admin/user-groups`.
 *
 * A group is a SUBJECT, not a bundle of permissions: it holds role grants in
 * `awcms_access_policies` exactly the way a person does, and membership is what
 * makes those grants reach someone. Nothing here writes a grant — that stays at
 * `/api/v1/access/assignments` under `access_control.assign`, so "who may decide
 * what a group can do" is the same authority it has always been, and this file's
 * `user_groups.assign` only decides who is affected by it.
 *
 * ## Externally-managed groups
 *
 * A `source = 'scim'` group refuses rename and membership mutation with
 * `GroupExternallyManagedError` (→ 409). SCIM is not built; what is built is the
 * refusal, because a local edit to a directory-managed group is a change the next
 * sync silently reverts — and an admin who cannot tell that happened will make it
 * again.
 *
 * Every mutation runs inside `withTenant` (RLS FORCE is the real boundary), is
 * additionally tenant-filtered as defence in depth, and audits.
 */
import { recordAuditEvent } from "../../logging/application/audit-log";

const AUDIT_MODULE_KEY = "identity_access";
const POSTGRES_UNIQUE_VIOLATION = "23505";

const LIST_LIMIT = 200;
const MEMBER_LIST_LIMIT = 500;

const GROUP_CODE_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ValidationError = { field: string; message: string };
type ValidationResult<T> =
  { valid: true; value: T } | { valid: false; errors: ValidationError[] };

/** The group already exists in this tenant under that code (unique-index 23505). */
export class DuplicateGroupCodeError extends Error {
  constructor() {
    super("A live group with this code already exists in this tenant.");
    this.name = "DuplicateGroupCodeError";
  }
}

/**
 * The group is directory-managed and may not be edited locally.
 *
 * One error for rename AND membership on purpose: both are things the next sync
 * would overwrite, and distinguishing them would suggest one of them sticks.
 */
export class GroupExternallyManagedError extends Error {
  constructor() {
    super(
      "This group is managed by an external directory; change it there instead."
    );
    this.name = "GroupExternallyManagedError";
  }
}

/**
 * The group or the tenant user does not exist in this tenant.
 *
 * Deliberately ONE error for both, so the response cannot be used as an
 * existence oracle for ids belonging to another tenant — the same posture
 * `AssignmentTargetNotFoundError` takes.
 */
export class GroupMembershipTargetNotFoundError extends Error {
  constructor() {
    super(
      "userGroupId or tenantUserId does not reference a live record in this tenant."
    );
    this.name = "GroupMembershipTargetNotFoundError";
  }
}

export type UserGroupView = {
  id: string;
  groupCode: string;
  groupName: string;
  description: string | null;
  source: string;
  externalId: string | null;
  memberCount: number;
  roleCount: number;
};

type UserGroupRow = {
  id: string;
  group_code: string;
  group_name: string;
  description: string | null;
  source: string;
  external_id: string | null;
  member_count: number;
  role_count: number;
};

/**
 * The tenant's live groups, with the two counts that make the list decidable.
 *
 * `roleCount` is what turns "a group" into "an authority": a group holding three
 * role grants is three grants an administrator can no longer see by looking at
 * the people. Showing membership without it would present the least dangerous
 * half of the picture.
 */
export async function listUserGroups(
  tx: Bun.SQL,
  tenantId: string
): Promise<UserGroupView[]> {
  const rows = (await tx`
    SELECT
      g.id, g.group_code, g.group_name, g.description, g.source, g.external_id,
      (
        SELECT count(*) FROM awcms_user_group_members m
        WHERE m.tenant_id = g.tenant_id AND m.user_group_id = g.id
      )::int AS member_count,
      (
        SELECT count(*) FROM awcms_access_policies ap
        WHERE ap.tenant_id = g.tenant_id AND ap.user_group_id = g.id
          AND ap.status = 'active'
      )::int AS role_count
    FROM awcms_user_groups g
    WHERE g.tenant_id = ${tenantId} AND g.deleted_at IS NULL
    ORDER BY g.group_code
    LIMIT ${LIST_LIMIT}
  `) as UserGroupRow[];

  return rows.map((row) => ({
    id: row.id,
    groupCode: row.group_code,
    groupName: row.group_name,
    description: row.description,
    source: row.source,
    externalId: row.external_id,
    memberCount: row.member_count,
    roleCount: row.role_count
  }));
}

export type UserGroupMemberView = { tenantUserId: string };

/** The members of one group. Ids only — the identifier is PII and the caller already has a user list. */
export async function listUserGroupMembers(
  tx: Bun.SQL,
  tenantId: string,
  userGroupId: string
): Promise<UserGroupMemberView[]> {
  const rows = (await tx`
    SELECT m.tenant_user_id
    FROM awcms_user_group_members m
    JOIN awcms_user_groups g
      ON g.id = m.user_group_id AND g.tenant_id = m.tenant_id AND g.deleted_at IS NULL
    WHERE m.tenant_id = ${tenantId} AND m.user_group_id = ${userGroupId}
    ORDER BY m.created_at, m.tenant_user_id
    LIMIT ${MEMBER_LIST_LIMIT}
  `) as { tenant_user_id: string }[];

  return rows.map((row) => ({ tenantUserId: row.tenant_user_id }));
}

export type CreateUserGroupInput = {
  groupCode: string;
  groupName: string;
  description: string | null;
};

export function validateCreateUserGroupInput(
  body: unknown
): ValidationResult<CreateUserGroupInput> {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];

  if (
    typeof record.groupCode !== "string" ||
    !GROUP_CODE_PATTERN.test(record.groupCode)
  ) {
    errors.push({
      field: "groupCode",
      message:
        "groupCode must be lower-case, start with a letter, and use only letters, digits, '_' or '-' (2-64 characters)."
    });
  }

  if (
    typeof record.groupName !== "string" ||
    record.groupName.trim().length === 0 ||
    record.groupName.length > 200
  ) {
    errors.push({
      field: "groupName",
      message: "groupName is required and must be at most 200 characters."
    });
  }

  if (
    record.description !== undefined &&
    record.description !== null &&
    (typeof record.description !== "string" || record.description.length > 1000)
  ) {
    errors.push({
      field: "description",
      message: "description must be a string of at most 1000 characters."
    });
  }

  // `source` is NOT accepted from the request. A caller who could declare a
  // group `scim` would be declaring it un-editable through the only surface
  // that exists — and there is no directory behind it to edit it instead.
  if (record.source !== undefined) {
    errors.push({
      field: "source",
      message:
        "source cannot be set through this API; groups created here are always local."
    });
  }

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    value: {
      groupCode: record.groupCode as string,
      groupName: (record.groupName as string).trim(),
      description:
        typeof record.description === "string" ? record.description : null
    }
  };
}

export type UserGroupRecord = {
  id: string;
  groupCode: string;
  groupName: string;
  description: string | null;
  source: string;
};

/**
 * Creates a LOCAL group. Lets the unique violation propagate to the caller,
 * which maps it — the transaction is already aborted at that point, so nothing
 * further may be written to `tx`.
 */
export async function createUserGroup(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  input: CreateUserGroupInput,
  correlationId?: string
): Promise<UserGroupRecord> {
  let rows: { id: string }[];

  try {
    rows = (await tx`
      INSERT INTO awcms_user_groups
        (tenant_id, group_code, group_name, description, source, created_by_tenant_user_id)
      VALUES
        (${tenantId}, ${input.groupCode}, ${input.groupName}, ${input.description},
         'local', ${actorTenantUserId})
      RETURNING id
    `) as { id: string }[];
  } catch (error) {
    // SQLSTATE lives on `errno` in Bun, never on `code` — `code` carries Bun's
    // own constant for every server error.
    if ((error as { errno?: string }).errno === POSTGRES_UNIQUE_VIOLATION) {
      throw new DuplicateGroupCodeError();
    }
    throw error;
  }

  const id = rows[0]!.id;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "create",
    resourceType: "user_group",
    resourceId: id,
    severity: "warning",
    message: `User group ${input.groupCode} created.`,
    attributes: { groupCode: input.groupCode, source: "local" },
    correlationId
  });

  return {
    id,
    groupCode: input.groupCode,
    groupName: input.groupName,
    description: input.description,
    source: "local"
  };
}

export type UpdateUserGroupInput = {
  groupName: string;
  description: string | null;
};

export function validateUpdateUserGroupInput(
  body: unknown
): ValidationResult<UpdateUserGroupInput> {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];

  if (
    typeof record.groupName !== "string" ||
    record.groupName.trim().length === 0 ||
    record.groupName.length > 200
  ) {
    errors.push({
      field: "groupName",
      message: "groupName is required and must be at most 200 characters."
    });
  }

  if (
    record.description !== undefined &&
    record.description !== null &&
    (typeof record.description !== "string" || record.description.length > 1000)
  ) {
    errors.push({
      field: "description",
      message: "description must be a string of at most 1000 characters."
    });
  }

  // `groupCode` is not editable. It is the tenant-facing identity of the group
  // and the thing a tenant's own runbooks name; renaming it silently would make
  // those wrong. The DISPLAY name is what changes.
  if (record.groupCode !== undefined) {
    errors.push({
      field: "groupCode",
      message: "groupCode cannot be changed; create a new group instead."
    });
  }

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    value: {
      groupName: (record.groupName as string).trim(),
      description:
        typeof record.description === "string" ? record.description : null
    }
  };
}

export type UpdateUserGroupResult =
  { outcome: "updated"; record: UserGroupRecord } | { outcome: "not_found" };

/**
 * Renames a group's display name / description.
 *
 * The `source = 'local'` predicate is in the UPDATE itself rather than in a
 * pre-read: a pre-read would be an existence oracle AND a TOCTOU window. The
 * distinction between "not found" and "externally managed" is then recovered
 * with ONE follow-up existence check, which cannot leak anything the caller was
 * not already told by the 404.
 */
export async function updateUserGroup(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  userGroupId: string,
  input: UpdateUserGroupInput,
  correlationId?: string
): Promise<UpdateUserGroupResult> {
  const rows = (await tx`
    UPDATE awcms_user_groups
    SET group_name = ${input.groupName},
        description = ${input.description},
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${userGroupId}
      AND deleted_at IS NULL AND source = 'local'
    RETURNING id, group_code, group_name, description, source
  `) as {
    id: string;
    group_code: string;
    group_name: string;
    description: string | null;
    source: string;
  }[];

  const updated = rows[0];

  if (!updated) {
    const managed = (await tx`
      SELECT 1 FROM awcms_user_groups
      WHERE tenant_id = ${tenantId} AND id = ${userGroupId}
        AND deleted_at IS NULL AND source <> 'local'
    `) as unknown[];

    if (managed.length > 0) throw new GroupExternallyManagedError();

    return { outcome: "not_found" };
  }

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "update",
    resourceType: "user_group",
    resourceId: userGroupId,
    severity: "warning",
    message: `User group ${updated.group_code} updated.`,
    attributes: { groupCode: updated.group_code },
    correlationId
  });

  return {
    outcome: "updated",
    record: {
      id: updated.id,
      groupCode: updated.group_code,
      groupName: updated.group_name,
      description: updated.description,
      source: updated.source
    }
  };
}

export type MembershipInput = { userGroupId: string; tenantUserId: string };

export function validateMembershipInput(
  body: unknown
): ValidationResult<MembershipInput> {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];

  if (
    typeof record.userGroupId !== "string" ||
    !UUID_PATTERN.test(record.userGroupId)
  ) {
    errors.push({
      field: "userGroupId",
      message: "userGroupId must be a valid UUID."
    });
  }

  if (
    typeof record.tenantUserId !== "string" ||
    !UUID_PATTERN.test(record.tenantUserId)
  ) {
    errors.push({
      field: "tenantUserId",
      message: "tenantUserId must be a valid UUID."
    });
  }

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    value: {
      userGroupId: record.userGroupId as string,
      tenantUserId: record.tenantUserId as string
    }
  };
}

/**
 * Adds a tenant user to a LOCAL group.
 *
 * Idempotent by intent, not by accident: `ON CONFLICT DO NOTHING` on the
 * membership key, so re-adding somebody is a success rather than a 409. Adding a
 * person to a group they are already in changes nothing about their access, and
 * a 409 there is an error message about a state the caller wanted.
 *
 * The existence check runs as an INSERT ... SELECT with both joins, so an
 * unknown group and an unknown user produce the same "affected nothing" — no
 * pre-read, no oracle.
 */
export async function addUserGroupMember(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  input: MembershipInput,
  correlationId?: string
): Promise<{ added: boolean }> {
  await assertGroupIsLocal(tx, tenantId, input.userGroupId);

  const rows = (await tx`
    INSERT INTO awcms_user_group_members
      (tenant_id, user_group_id, tenant_user_id, added_by_tenant_user_id)
    SELECT ${tenantId}, g.id, tu.id, ${actorTenantUserId}
    FROM awcms_user_groups g
    JOIN awcms_tenant_users tu
      ON tu.tenant_id = g.tenant_id AND tu.id = ${input.tenantUserId}
    WHERE g.tenant_id = ${tenantId} AND g.id = ${input.userGroupId}
      AND g.deleted_at IS NULL
    ON CONFLICT (tenant_id, user_group_id, tenant_user_id) DO NOTHING
    RETURNING id
  `) as { id: string }[];

  if (rows.length === 0) {
    // Either the pair does not resolve, or the member was already there. One
    // more existence check tells them apart without widening what a caller can
    // learn: they already know the group exists (they were not 404'd above).
    const existing = (await tx`
      SELECT 1 FROM awcms_user_group_members
      WHERE tenant_id = ${tenantId} AND user_group_id = ${input.userGroupId}
        AND tenant_user_id = ${input.tenantUserId}
    `) as unknown[];

    if (existing.length === 0) throw new GroupMembershipTargetNotFoundError();

    return { added: false };
  }

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "assign",
    resourceType: "user_group",
    resourceId: input.userGroupId,
    severity: "warning",
    // The member is named by `tenant_user_id`, never by their identifier: the
    // login identifier is PII and never reaches the audit trail.
    message: "Tenant user added to user group.",
    attributes: { tenantUserId: input.tenantUserId },
    correlationId
  });

  return { added: true };
}

/** Removes a tenant user from a LOCAL group. `false` when they were not a member. */
export async function removeUserGroupMember(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  input: MembershipInput,
  correlationId?: string
): Promise<{ removed: boolean }> {
  await assertGroupIsLocal(tx, tenantId, input.userGroupId);

  const rows = (await tx`
    DELETE FROM awcms_user_group_members
    WHERE tenant_id = ${tenantId}
      AND user_group_id = ${input.userGroupId}
      AND tenant_user_id = ${input.tenantUserId}
    RETURNING id
  `) as { id: string }[];

  if (rows.length === 0) return { removed: false };

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "assign",
    resourceType: "user_group",
    resourceId: input.userGroupId,
    severity: "warning",
    message: "Tenant user removed from user group.",
    attributes: { tenantUserId: input.tenantUserId, removed: true },
    correlationId
  });

  return { removed: true };
}

/**
 * Throws when the group is directory-managed; says nothing when it does not
 * exist.
 *
 * Silence for the unknown group is deliberate: the caller learns that from the
 * mutation affecting nothing, and answering here would make this a membership
 * oracle over group ids the caller may not be entitled to know about.
 */
async function assertGroupIsLocal(
  tx: Bun.SQL,
  tenantId: string,
  userGroupId: string
): Promise<void> {
  const rows = (await tx`
    SELECT 1 FROM awcms_user_groups
    WHERE tenant_id = ${tenantId} AND id = ${userGroupId}
      AND deleted_at IS NULL AND source <> 'local'
  `) as unknown[];

  if (rows.length > 0) throw new GroupExternallyManagedError();
}
