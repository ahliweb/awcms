/**
 * Delegation/substitute-assignment CRUD (Issue #747). A delegation only
 * ever lets `delegateTenantUserId` act on `delegatorTenantUserId`'s
 * behalf for THEIR OWN standing (never a permission grant) — see
 * `domain/workflow-delegation.ts`'s doc comment. `delegatorTenantUserId`
 * is always the AUTHENTICATED caller creating the delegation (a tenant
 * user can only ever delegate their OWN standing, never someone else's —
 * this is what "never broadens the delegator's own verified authority"
 * means in practice: nobody, not even an admin, can create a delegation
 * FROM a third party via this function; an admin-initiated substitution
 * would be a distinct, out-of-scope administrative primitive, not this
 * one).
 */
import { assertUuid } from "../../../lib/database/tenant-context";
import { appendDomainEvent } from "../../domain-event-runtime/application/append-domain-event";
import {
  WORKFLOW_DELEGATION_CREATED_EVENT_TYPE,
  WORKFLOW_DELEGATION_REVOKED_EVENT_TYPE,
  WORKFLOW_EVENT_VERSION
} from "../../domain-event-runtime/domain/event-type-registry";

export type WorkflowDelegationRow = {
  id: string;
  tenant_id: string;
  delegator_tenant_user_id: string;
  delegate_tenant_user_id: string;
  workflow_key: string | null;
  resource_type: string | null;
  effective_from: Date;
  effective_to: Date | null;
  reason: string;
  status: "active" | "revoked";
  created_by_tenant_user_id: string;
  created_at: Date;
  revoked_at: Date | null;
  revoked_by_tenant_user_id: string | null;
  revoke_reason: string | null;
};

export type CreateWorkflowDelegationParams = {
  tenantId: string;
  delegatorTenantUserId: string;
  delegateTenantUserId: string;
  workflowKey?: string;
  resourceType?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  reason: string;
  correlationId?: string;
};

export async function createWorkflowDelegation(
  tx: Bun.SQL,
  params: CreateWorkflowDelegationParams
): Promise<WorkflowDelegationRow> {
  const tenantId = assertUuid(params.tenantId);
  const rows = (await tx`
    INSERT INTO awcms_workflow_delegations
      (tenant_id, delegator_tenant_user_id, delegate_tenant_user_id,
       workflow_key, resource_type, effective_from, effective_to,
       reason, status, created_by_tenant_user_id)
    VALUES (
      ${tenantId}, ${params.delegatorTenantUserId}, ${params.delegateTenantUserId},
      ${params.workflowKey ?? null}, ${params.resourceType ?? null},
      ${params.effectiveFrom ? new Date(params.effectiveFrom) : new Date()},
      ${params.effectiveTo ? new Date(params.effectiveTo) : null},
      ${params.reason}, 'active', ${params.delegatorTenantUserId}
    )
    RETURNING *
  `) as WorkflowDelegationRow[];
  const delegation = rows[0]!;

  await appendDomainEvent(tx, tenantId, {
    eventType: WORKFLOW_DELEGATION_CREATED_EVENT_TYPE,
    eventVersion: WORKFLOW_EVENT_VERSION,
    aggregateType: "workflow_delegation",
    aggregateId: delegation.id,
    producerModule: "workflow",
    correlationId: params.correlationId,
    actorTenantUserId: params.delegatorTenantUserId,
    payload: {
      delegateTenantUserId: params.delegateTenantUserId,
      workflowKey: params.workflowKey ?? null,
      resourceType: params.resourceType ?? null
    }
  });

  return delegation;
}

const DELEGATION_LIST_LIMIT = 100;

export async function listWorkflowDelegations(
  tx: Bun.SQL,
  tenantId: string,
  delegatorTenantUserId?: string
): Promise<WorkflowDelegationRow[]> {
  const safeTenantId = assertUuid(tenantId);

  return (await tx`
    SELECT * FROM awcms_workflow_delegations
    WHERE tenant_id = ${safeTenantId}
      AND (${delegatorTenantUserId ?? null}::uuid IS NULL OR delegator_tenant_user_id = ${delegatorTenantUserId ?? null})
    ORDER BY created_at DESC
    LIMIT ${DELEGATION_LIST_LIMIT}
  `) as WorkflowDelegationRow[];
}

export class WorkflowDelegationNotFoundError extends Error {
  constructor() {
    super("Workflow delegation not found.");
    this.name = "WorkflowDelegationNotFoundError";
  }
}

export class WorkflowDelegationForbiddenError extends Error {
  constructor() {
    super(
      "Only the delegator (or an administrative recovery permission) may revoke this delegation."
    );
    this.name = "WorkflowDelegationForbiddenError";
  }
}

export type RevokeWorkflowDelegationParams = {
  tenantId: string;
  delegationId: string;
  /** The caller's own tenant user id — must match the delegation's `delegator_tenant_user_id` UNLESS `allowAdministrativeOverride` is true (an operator holding `workflow.recovery.*`-style authority; the route decides which permission gates that). */
  revokedByTenantUserId: string;
  allowAdministrativeOverride?: boolean;
  revokeReason?: string;
  correlationId?: string;
};

export async function revokeWorkflowDelegation(
  tx: Bun.SQL,
  params: RevokeWorkflowDelegationParams
): Promise<WorkflowDelegationRow> {
  const tenantId = assertUuid(params.tenantId);
  const delegationId = assertUuid(params.delegationId);

  const existingRows = (await tx`
    SELECT * FROM awcms_workflow_delegations
    WHERE tenant_id = ${tenantId} AND id = ${delegationId}
  `) as WorkflowDelegationRow[];
  const existing = existingRows[0];

  if (!existing) {
    throw new WorkflowDelegationNotFoundError();
  }

  if (
    existing.delegator_tenant_user_id !== params.revokedByTenantUserId &&
    !params.allowAdministrativeOverride
  ) {
    throw new WorkflowDelegationForbiddenError();
  }

  const rows = (await tx`
    UPDATE awcms_workflow_delegations
    SET status = 'revoked', revoked_at = now(),
        revoked_by_tenant_user_id = ${params.revokedByTenantUserId},
        revoke_reason = ${params.revokeReason ?? null}
    WHERE tenant_id = ${tenantId} AND id = ${delegationId} AND status = 'active'
    RETURNING *
  `) as WorkflowDelegationRow[];

  if (!rows[0]) {
    throw new WorkflowDelegationNotFoundError();
  }

  const revoked = rows[0];

  await appendDomainEvent(tx, tenantId, {
    eventType: WORKFLOW_DELEGATION_REVOKED_EVENT_TYPE,
    eventVersion: WORKFLOW_EVENT_VERSION,
    aggregateType: "workflow_delegation",
    aggregateId: revoked.id,
    producerModule: "workflow",
    correlationId: params.correlationId,
    actorTenantUserId: params.revokedByTenantUserId,
    payload: { delegatorTenantUserId: revoked.delegator_tenant_user_id }
  });

  return revoked;
}
