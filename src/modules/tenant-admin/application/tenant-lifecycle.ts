/**
 * Suspend and restore a tenant — Issue #429, ADR-0073.
 *
 * `awcms_tenants.status` has admitted `'suspended'` since `sql/002`, and until
 * this landed nothing but the login path read it. The enforcement half lives in
 * `identity-access`'s chokepoint; this file is the surface that flips the bit
 * and records who did it, when, and why.
 *
 * ## Why `awcms_tenants` is written from here and not from `identity_access`
 *
 * `tenant_admin` owns that table (`modules:table-writes:check` enforces it).
 * The module that ENFORCES a state and the module that OWNS it are deliberately
 * different — the same split `module_management` and the chokepoint already
 * have for module enablement.
 */
import { recordAuditEvent } from "../../logging/application/audit-log";

/** Statuses a tenant can be moved between by this surface. */
const SUSPENDED = "suspended";
const ACTIVE = "active";

export type TenantLifecycleOutcome =
  | { outcome: "changed"; fromStatus: string; toStatus: string }
  | { outcome: "unchanged"; status: string }
  | { outcome: "not_found" };

/**
 * Suspension can additionally refuse. `restore` cannot produce this, and the
 * TYPE says so rather than a comment: the platform guard lives in
 * `suspendTenant`, not in the shared transition, so the restore route has no
 * unreachable branch to write and no reviewer has to verify a claim by reading.
 */
export type TenantSuspendOutcome =
  TenantLifecycleOutcome | { outcome: "platform_blocked" };

export type TenantLifecycleActor = {
  tenantUserId: string;
  /** The tenant the ACTOR belongs to — the platform tenant, not the target. */
  tenantId: string;
  correlationId?: string;
};

/**
 * Reads the target's current status. `awcms_tenants` is the RLS-free root
 * table (ADR-0003), so this is readable while acting as the platform tenant —
 * which is the only way a cross-tenant lifecycle action can work at all.
 */
async function fetchStatus(
  tx: Bun.SQL,
  targetTenantId: string
): Promise<string | null> {
  const rows = (await tx`
    SELECT status FROM awcms_tenants WHERE id = ${targetTenantId}
  `) as { status: string }[];

  return rows[0]?.status ?? null;
}

async function transition(
  tx: Bun.SQL,
  targetTenantId: string,
  toStatus: string,
  reason: string | null,
  actor: TenantLifecycleActor,
  auditAction: string
): Promise<TenantLifecycleOutcome> {
  const fromStatus = await fetchStatus(tx, targetTenantId);

  if (fromStatus === null) {
    return { outcome: "not_found" };
  }

  if (fromStatus === toStatus) {
    // Not an error: re-suspending an already-suspended tenant is the caller
    // getting what they asked for. Reported distinctly so the endpoint can skip
    // the audit row rather than writing a transition that did not happen —
    // `awcms_tenant_status_transitions` has a CHECK forbidding from = to.
    return { outcome: "unchanged", status: fromStatus };
  }

  await tx`
    UPDATE awcms_tenants
    SET status = ${toStatus},
        suspended_at = ${toStatus === SUSPENDED ? new Date() : null},
        suspension_reason = ${toStatus === SUSPENDED ? reason : null},
        updated_at = now()
    WHERE id = ${targetTenantId}
  `;

  await tx`
    INSERT INTO awcms_tenant_status_transitions
      (tenant_id, from_status, to_status, reason, actor_tenant_user_id, actor_tenant_id)
    VALUES (${targetTenantId}, ${fromStatus}, ${toStatus}, ${reason},
            ${actor.tenantUserId}, ${actor.tenantId})
  `;

  // Audited in the TARGET tenant's trail: a customer is entitled to see that
  // their service was stopped, by whom, and why. `actor_tenant_user_id` names
  // someone who is not their member — that asymmetry is the record, not a bug.
  await recordAuditEvent(tx, {
    tenantId: targetTenantId,
    actorTenantUserId: actor.tenantUserId,
    moduleKey: "tenant_admin",
    action: auditAction,
    resourceType: "tenant",
    resourceId: targetTenantId,
    severity: "critical",
    message: `Tenant status ${fromStatus} -> ${toStatus}`,
    attributes: { fromStatus, toStatus, reason },
    correlationId: actor.correlationId
  });

  return { outcome: "changed", fromStatus, toStatus };
}

/**
 * Stop serving a tenant. Live sessions and machine credentials are refused at
 * the chokepoint from the next request — no revocation sweep is needed, because
 * the check is on the tenant, not on the credential.
 */
export async function suspendTenant(
  tx: Bun.SQL,
  targetTenantId: string,
  reason: string | null,
  actor: TenantLifecycleActor,
  platformTenantId: string | null
): Promise<TenantSuspendOutcome> {
  // The platform tenant may never be suspended. Suspending it would refuse the
  // operator at the chokepoint for EVERY action, including the one that lifts
  // the suspension — there is no in-band recovery. The chokepoint exempts it as
  // a second belt (`isSuspensionExemptTenant`); this is the braces, and it is
  // the one that produces a comprehensible error instead of a locked door.
  if (platformTenantId !== null && targetTenantId === platformTenantId) {
    return { outcome: "platform_blocked" };
  }

  return transition(
    tx,
    targetTenantId,
    SUSPENDED,
    reason,
    actor,
    "tenant_admin.tenant.suspended"
  );
}

/** Lift a suspension and resume service. */
export async function restoreTenant(
  tx: Bun.SQL,
  targetTenantId: string,
  reason: string | null,
  actor: TenantLifecycleActor
): Promise<TenantLifecycleOutcome> {
  return transition(
    tx,
    targetTenantId,
    ACTIVE,
    reason,
    actor,
    "tenant_admin.tenant.restored"
  );
}
