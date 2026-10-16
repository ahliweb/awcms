/**
 * The one place a role grant is written (ADR-0078, Gelombang 3 PR 3.2 of #423).
 *
 * Every path that used to `INSERT INTO awcms_access_assignments` calls
 * `grantRolePolicy`, and every path that removed a grant calls
 * `revokeRoleGrants`.
 *
 * ## NOT a dual write
 *
 * ADR-0078 chose a third table precisely so expand/migrate/contract needs no
 * dual write. A grant lands in ONE table: `awcms_access_policies`. Writing both
 * would reintroduce the failure this design avoids — two writes that can succeed
 * apart, leaving a subject holding a role according to one table and not the
 * other, with no way to tell which is right.
 *
 * ## Why removal stopped looking in two places (ADR-0079)
 *
 * Until `sql/103` it had to: a grant could live in either table, and a remover
 * that knew only about the new one would report success while the role survived.
 * The backfill ended that — every legacy row is now ALSO a policy row (same
 * `id`), `awcms_access_assignments` is read-only history that no reader consults,
 * and `awcms_app` no longer holds `DELETE` on it. Keeping the legacy `DELETE`
 * here would now fail the whole revocation with `42501` on a statement that can
 * only ever match rows nothing reads.
 */

import { recordAuditEvent } from "../../logging/application/audit-log";

const AUDIT_MODULE_KEY = "identity_access";

/** `scope_type` for a grant that is not confined to any business scope. */
const TENANT_WIDE_SCOPE_TYPE = "tenant";

export type GrantRolePolicyInput = {
  tenantUserId: string;
  roleId: string;
  /** `null` for bootstrap, where no session exists yet to attribute it to. */
  grantedByTenantUserId: string | null;
  reason?: string;
  /**
   * An END DATE for the grant, for the callers that have one — today only the
   * delegated-access redemption, whose grant carries `expires_at` (ADR-0090).
   * Omitted means open-ended, which is what every other grant is.
   *
   * ## Pass BOTH or NEITHER
   *
   * `sql/102` constrains `effective_to > effective_from`, and `effective_from`
   * DEFAULTs to `now()` — the TRANSACTION START instant, not the application's
   * clock. Supplying only `effectiveTo` would compare a `Date` this process
   * produced against an instant PostgreSQL produced, so a grant whose end date
   * is genuinely in the future can still trip the CHECK whenever the two clocks
   * disagree by more than the remaining life of the grant. Supplying both makes
   * the constraint compare two values from the SAME clock — the one the caller
   * already validated the pair against.
   */
  effectiveFrom?: Date;
  effectiveTo?: Date;
};

export type GrantGroupRolePolicyInput = {
  userGroupId: string;
  roleId: string;
  grantedByTenantUserId: string | null;
  reason?: string;
};

/**
 * Grants a role, tenant-wide, and records the `granted` lifecycle event.
 *
 * `scope_id` carries the tenant id, the convention `access-control.ts` documents
 * for `TENANT_WIDE_SCOPE_TYPE` ("conventionally the tenant id, but coverage does
 * not depend on it"). Every grant written today is tenant-wide: narrower scopes
 * become writable when PR 3.4 teaches evaluation to qualify them, and shipping a
 * writer for a scope the evaluator still ignores would hand out grants that look
 * narrow and are not.
 *
 * Lets a unique violation propagate rather than translating it. The caller knows
 * whether "already granted" is a `409` or an idempotent success, and — because
 * the violation has already aborted the transaction — it must not write anything
 * further before returning.
 */
export async function grantRolePolicy(
  tx: Bun.SQL,
  tenantId: string,
  input: GrantRolePolicyInput
): Promise<{ id: string }> {
  await lapseElapsedGrants(
    tx,
    tenantId,
    { kind: "tenant_user", tenantUserId: input.tenantUserId },
    input.roleId,
    input.grantedByTenantUserId
  );

  const rows = (await tx`
    INSERT INTO awcms_access_policies
      (tenant_id, subject_type, tenant_user_id, role_id, scope_type, scope_id,
       granted_by_tenant_user_id, reason, effective_from, effective_to)
    VALUES
      (${tenantId}, 'tenant_user', ${input.tenantUserId}, ${input.roleId},
       ${TENANT_WIDE_SCOPE_TYPE}, ${tenantId},
       ${input.grantedByTenantUserId}, ${input.reason ?? null},
       COALESCE(${input.effectiveFrom ?? null}::timestamptz, now()),
       ${input.effectiveTo ?? null}::timestamptz)
    RETURNING id
  `) as { id: string }[];

  const policyId = rows[0]!.id;

  await tx`
    INSERT INTO awcms_access_policy_events
      (tenant_id, policy_id, event_type, actor_tenant_user_id, reason)
    VALUES (${tenantId}, ${policyId}, 'granted', ${input.grantedByTenantUserId}, ${input.reason ?? null})
  `;

  return { id: policyId };
}

/**
 * Grants a role to a GROUP, tenant-wide (ADR-0081).
 *
 * The same shape as `grantRolePolicy`, one row in the same table, differing only
 * in which subject column is populated — which is the whole design: a group is a
 * subject, so it is granted through the mechanism that already exists rather
 * than a parallel one that could answer differently. Every reader picks it up
 * through `activeRoleGrants`, so this function has no downstream wiring at all.
 *
 * The lifecycle event names the GROUP as the resource, not its members: at grant
 * time the members are whoever happens to be in it, and the row would go stale
 * the moment somebody joined. Who was affected is a question membership answers,
 * and membership is separately audited.
 *
 * Lets a unique violation propagate, for the reason `grantRolePolicy` records.
 */
export async function grantGroupRolePolicy(
  tx: Bun.SQL,
  tenantId: string,
  input: GrantGroupRolePolicyInput
): Promise<{ id: string }> {
  await lapseElapsedGrants(
    tx,
    tenantId,
    { kind: "user_group", userGroupId: input.userGroupId },
    input.roleId,
    input.grantedByTenantUserId
  );

  const rows = (await tx`
    INSERT INTO awcms_access_policies
      (tenant_id, subject_type, user_group_id, role_id, scope_type, scope_id,
       granted_by_tenant_user_id, reason)
    VALUES
      (${tenantId}, 'user_group', ${input.userGroupId}, ${input.roleId},
       ${TENANT_WIDE_SCOPE_TYPE}, ${tenantId},
       ${input.grantedByTenantUserId}, ${input.reason ?? null})
    RETURNING id
  `) as { id: string }[];

  const policyId = rows[0]!.id;

  await tx`
    INSERT INTO awcms_access_policy_events
      (tenant_id, policy_id, event_type, actor_tenant_user_id, reason)
    VALUES (${tenantId}, ${policyId}, 'granted', ${input.grantedByTenantUserId}, ${input.reason ?? null})
  `;

  return { id: policyId };
}

/**
 * Revokes every live grant of `roleId` to a GROUP.
 *
 * Separate from `revokeRoleGrants` rather than a parameter on it, because the
 * two answer questions that must not be conflated: revoking a person's role must
 * not touch a grant they hold through a group they are still in, and revoking a
 * group's role must not look like it removed anybody's personal grant.
 */
export async function revokeGroupRoleGrants(
  tx: Bun.SQL,
  tenantId: string,
  userGroupId: string,
  roleId: string,
  actorTenantUserId: string | null,
  now: Date,
  reason?: string
): Promise<boolean> {
  const revoked = (await tx`
    UPDATE awcms_access_policies
    SET status = 'revoked',
        revoked_at = ${now},
        revoked_by_tenant_user_id = ${actorTenantUserId},
        revoke_reason = ${reason ?? null},
        updated_at = ${now}
    WHERE tenant_id = ${tenantId}
      AND user_group_id = ${userGroupId}
      AND role_id = ${roleId}
      AND status = 'active'
    RETURNING id
  `) as { id: string }[];

  for (const policy of revoked) {
    await tx`
      INSERT INTO awcms_access_policy_events
        (tenant_id, policy_id, event_type, actor_tenant_user_id, reason)
      VALUES (${tenantId}, ${policy.id}, 'revoked', ${actorTenantUserId}, ${reason ?? null})
    `;
  }

  return revoked.length > 0;
}

/**
 * Whether the GROUP already holds this role through a live grant. A grant past
 * its `effective_to` is not live, so it does not count (issue #1056) — the
 * writer lapses it before inserting.
 */
export async function groupHoldsRole(
  tx: Bun.SQL,
  tenantId: string,
  userGroupId: string,
  roleId: string
): Promise<boolean> {
  const rows = (await tx`
    SELECT 1
    FROM awcms_access_policies
    WHERE tenant_id = ${tenantId}
      AND user_group_id = ${userGroupId}
      AND role_id = ${roleId}
      AND status = 'active'
      AND (effective_to IS NULL OR effective_to > now())
    LIMIT 1
  `) as unknown[];

  return rows.length > 0;
}

/**
 * Whether the subject already holds this role through a LIVE grant.
 *
 * The pre-check `assignRole` used to get for free from `awcms_access_assignments`'s
 * unique index, which the partial index on active policies now provides — but
 * only for the exact `(scope_type, scope_id)` being written, so the explicit
 * check stays as the thing that answers "already holds this role" rather than
 * "already holds it here".
 *
 * Reads only ACTIVE, not-yet-elapsed rows (issue #1056: an elapsed row is lapsed
 * by the writer, so it must not answer "held"), which is what makes re-granting a revoked role work at
 * all: history must not answer a question about the present. That is also why
 * the retired `awcms_access_assignments` rows are not consulted — a legacy row
 * that outlived its revocation would otherwise block the re-grant permanently
 * with a `409` no admin could clear.
 */
export async function subjectHoldsRole(
  tx: Bun.SQL,
  tenantId: string,
  tenantUserId: string,
  roleId: string
): Promise<boolean> {
  const rows = (await tx`
    SELECT 1
    FROM awcms_access_policies
    WHERE tenant_id = ${tenantId}
      AND tenant_user_id = ${tenantUserId}
      AND role_id = ${roleId}
      AND status = 'active'
      AND (effective_to IS NULL OR effective_to > now())
    LIMIT 1
  `) as unknown[];

  return rows.length > 0;
}

/**
 * Revokes every live grant of `roleId` to this subject, and reports whether
 * anything was actually revoked.
 *
 * A policy is transitioned to `revoked` with its timestamp rather than deleted —
 * the partial unique index covers active rows only, so a revoked policy does not
 * block re-granting the same role later, which is the ordinary case rather than
 * an edge one, and the row is the only record that the access ever existed.
 *
 * The plural is load-bearing: once grants carry scope, one role held at three
 * scopes is three rows, and "remove this role from this person" must mean all of
 * them. `RETURNING id` drives one lifecycle event per revoked row.
 */
export async function revokeRoleGrants(
  tx: Bun.SQL,
  tenantId: string,
  tenantUserId: string,
  roleId: string,
  actorTenantUserId: string | null,
  now: Date,
  reason?: string
): Promise<boolean> {
  const revoked = (await tx`
    UPDATE awcms_access_policies
    SET status = 'revoked',
        revoked_at = ${now},
        revoked_by_tenant_user_id = ${actorTenantUserId},
        revoke_reason = ${reason ?? null},
        updated_at = ${now}
    WHERE tenant_id = ${tenantId}
      AND tenant_user_id = ${tenantUserId}
      AND role_id = ${roleId}
      AND status = 'active'
    RETURNING id
  `) as { id: string }[];

  for (const policy of revoked) {
    await tx`
      INSERT INTO awcms_access_policy_events
        (tenant_id, policy_id, event_type, actor_tenant_user_id, reason)
      VALUES (${tenantId}, ${policy.id}, 'revoked', ${actorTenantUserId}, ${reason ?? null})
    `;
  }

  return revoked.length > 0;
}

type LapseSubject =
  | { kind: "tenant_user"; tenantUserId: string }
  | { kind: "user_group"; userGroupId: string };

/**
 * Transitions the subject's grants of `roleId` whose `effective_to` has passed
 * from `active` to `expired`, and records that it did (issue #1056).
 *
 * ## Why this exists: the unique index is keyed on `status`, not on time
 *
 * `awcms_access_policies_active_key` / `_group_active_key` (`sql/102`/`sql/104`)
 * are partial on `status = 'active'`, and a partial index cannot mention
 * `now()`. A grant whose end date has passed therefore keeps occupying the
 * (subject, role, scope) slot until something flips its status — and nothing
 * did. Every reader already ignores it (`effective_to > now()`), so the person
 * does NOT hold the role, yet re-granting it raised `23505` -> `409` for as long
 * as the dead row lived. Making only the pre-check time-aware (the first attempt
 * at this, #1055/g07) moves the failure to the INSERT without removing it.
 *
 * ## Why it is a state transition and not a delete or an index change
 *
 * The row is history — it is the only record that the access once existed and
 * until when. It becomes `expired` (a status `sql/102` already defines, with its
 * own `expired` lifecycle event type) and is never deleted, so the audit trail
 * survives intact. A time-aware index would need an exclusion constraint over a
 * range, a migration on the authorization table's hottest unique key, and would
 * still leave `status` lying to every reader that filters on it.
 *
 * ## Why in the write path
 *
 * Every grant goes through `grantRolePolicy` / `grantGroupRolePolicy`, so doing
 * it there covers admin assignment, invitation acceptance, self-registration,
 * membership materialization and delegated redemption with one change, and it is
 * the only point at which a lapsed row can actually hurt anybody. It touches
 * ONLY the exact subject and role being granted — ALL of that subject's elapsed
 * grants of that role, at ANY scope (the key is tenant, subject, role; scope is
 * deliberately not part of it, since an elapsed row is inert wherever it was
 * scoped, and each lapsed row's scope is recorded in the audit attributes) —
 * only rows that have already elapsed, and can only move `active -> expired`: it cannot widen access.
 *
 * `now()` is the database clock and the same one the readers compare against, so
 * a row is never lapsed while a reader still counts it. The lifecycle event has
 * no actor — the passage of time did it, not a person — and the audit row names
 * the actor whose grant triggered the tidy-up.
 */
async function lapseElapsedGrants(
  tx: Bun.SQL,
  tenantId: string,
  subject: LapseSubject,
  roleId: string,
  triggeredByTenantUserId: string | null
): Promise<number> {
  const lapsed = (await (subject.kind === "tenant_user"
    ? tx`
        UPDATE awcms_access_policies
        SET status = 'expired', updated_at = now()
        WHERE tenant_id = ${tenantId}
          AND tenant_user_id = ${subject.tenantUserId}
          AND role_id = ${roleId}
          AND status = 'active'
          AND effective_to IS NOT NULL
          AND effective_to <= now()
        RETURNING id, scope_type, scope_id
      `
    : tx`
        UPDATE awcms_access_policies
        SET status = 'expired', updated_at = now()
        WHERE tenant_id = ${tenantId}
          AND user_group_id = ${subject.userGroupId}
          AND role_id = ${roleId}
          AND status = 'active'
          AND effective_to IS NOT NULL
          AND effective_to <= now()
        RETURNING id, scope_type, scope_id
      `)) as { id: string; scope_type: string; scope_id: string }[];

  if (lapsed.length === 0) return 0;

  await tx`
    INSERT INTO awcms_access_policy_events
      (tenant_id, policy_id, event_type, actor_tenant_user_id, reason)
    SELECT ${tenantId}, unnest(${tx.array(
      lapsed.map((row) => row.id),
      "uuid"
    )}::uuid[]), 'expired', NULL,
      'Lapsed (effective_to elapsed) while the same role was being granted again'
  `;

  await recordAuditEvent(tx, {
    tenantId,
    ...(triggeredByTenantUserId
      ? { actorTenantUserId: triggeredByTenantUserId }
      : {}),
    moduleKey: AUDIT_MODULE_KEY,
    action: "expire",
    resourceType: "access_policy",
    resourceId: lapsed[0]!.id,
    severity: "warning",
    message: "Lapsed role grant marked expired ahead of a re-grant.",
    attributes: {
      roleId,
      subjectType: subject.kind,
      policyIds: lapsed.map((row) => row.id),
      policies: lapsed.map((row) => ({
        id: row.id,
        scopeType: row.scope_type,
        scopeId: row.scope_id
      }))
    }
  });

  return lapsed.length;
}
