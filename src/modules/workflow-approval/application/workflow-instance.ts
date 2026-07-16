/**
 * Instance start (Issue #747, evolves Issue 11.1's linear
 * `startWorkflowInstance`). Internal-only application function — no
 * public HTTP route accepts arbitrary `graph`/`facts` input here; a
 * derived app's real business action (or a test fixture) calls this
 * directly, matching the existing module's own precedent (see README).
 *
 * VERSION PINNING (Issue #747 acceptance criterion): resolves the
 * CURRENTLY `active` definition row for `workflowKey` at the moment this
 * is called, and stores `workflow_definition_id`
 * (`awcms_workflow_instances`'s FK — a specific, immutable version
 * row, never mutated in place once published) plus a denormalized
 * `workflow_definition_version` column. Because published/active/retired
 * definition rows are never edited (`workflow-definition-directory.ts`),
 * every later read/advance of this instance re-fetches the SAME pinned
 * row regardless of what newer versions get published afterward.
 */
import { assertUuid } from "../../../lib/database/tenant-context";
import {
  validateWorkflowGraph,
  type FactDeclaration,
  type WorkflowGraph
} from "../domain/workflow-graph";
import {
  validateFactsAgainstSchema,
  type FactsSnapshot
} from "../domain/workflow-condition";
import { getWorkflowConditionResolverNames } from "../infrastructure/condition-action-registry";
import { activateNode, type ActivateNodeDeps } from "./workflow-graph-engine";
import { appendDomainEvent } from "../../domain-event-runtime/application/append-domain-event";
import {
  WORKFLOW_INSTANCE_APPROVED_EVENT_TYPE,
  WORKFLOW_INSTANCE_REJECTED_EVENT_TYPE,
  WORKFLOW_INSTANCE_STARTED_EVENT_TYPE,
  WORKFLOW_EVENT_VERSION
} from "../../domain-event-runtime/domain/event-type-registry";

export class WorkflowDefinitionNotActiveError extends Error {
  constructor(workflowKey: string) {
    super(
      `No active workflow definition found for workflowKey "${workflowKey}".`
    );
    this.name = "WorkflowDefinitionNotActiveError";
  }
}

export class InvalidWorkflowFactsError extends Error {
  errors: { field: string; message: string }[];
  constructor(errors: { field: string; message: string }[]) {
    super(`Invalid workflow facts: ${errors.map((e) => e.message).join("; ")}`);
    this.name = "InvalidWorkflowFactsError";
    this.errors = errors;
  }
}

export type StartWorkflowInstanceParams = {
  tenantId: string;
  workflowKey: string;
  resourceType: string;
  resourceId: string;
  requestedByTenantUserId: string;
  facts?: unknown;
  now?: Date;
  correlationId?: string;
} & ActivateNodeDeps;

export type StartWorkflowInstanceResult = {
  instanceId: string;
  workflowDefinitionId: string;
  workflowDefinitionVersion: number;
  finished: boolean;
  status: "pending" | "approved" | "rejected";
};

type ActiveDefinitionRow = {
  id: string;
  version: number;
  graph: unknown;
  facts_schema: unknown;
};

export async function startWorkflowInstance(
  tx: Bun.SQL,
  params: StartWorkflowInstanceParams
): Promise<StartWorkflowInstanceResult> {
  const tenantId = assertUuid(params.tenantId);
  const now = params.now ?? new Date();

  const definitionRows = (await tx`
    SELECT id, version, graph, facts_schema
    FROM awcms_workflow_definitions
    WHERE tenant_id = ${tenantId} AND workflow_key = ${params.workflowKey}
      AND lifecycle_status = 'active' AND deleted_at IS NULL
  `) as ActiveDefinitionRow[];
  const definition = definitionRows[0];

  if (!definition) {
    throw new WorkflowDefinitionNotActiveError(params.workflowKey);
  }

  const graphResult = validateWorkflowGraph(
    definition.graph,
    definition.facts_schema,
    getWorkflowConditionResolverNames()
  );

  if (!graphResult.valid) {
    // Defensive only — publish() already validated this graph; a
    // published row can never legitimately fail here.
    throw new Error(
      `Pinned workflow definition ${definition.id} has an invalid graph: ` +
        graphResult.errors.map((e) => e.message).join("; ")
    );
  }

  const factsSchema = (definition.facts_schema ?? []) as FactDeclaration[];
  const factsValidation = validateFactsAgainstSchema(
    params.facts ?? {},
    factsSchema
  );

  if (!factsValidation.valid) {
    throw new InvalidWorkflowFactsError(factsValidation.errors);
  }

  const instanceRows = (await tx`
    INSERT INTO awcms_workflow_instances
      (tenant_id, workflow_definition_id, workflow_definition_version,
       resource_type, resource_id, status, requested_by_tenant_user_id, facts)
    VALUES (
      ${tenantId}, ${definition.id}, ${definition.version},
      ${params.resourceType}, ${params.resourceId}, 'pending',
      ${params.requestedByTenantUserId}, ${factsValidation.value}::jsonb
    )
    RETURNING id
  `) as { id: string }[];
  const instanceId = instanceRows[0]!.id;

  await appendDomainEvent(tx, tenantId, {
    eventType: WORKFLOW_INSTANCE_STARTED_EVENT_TYPE,
    eventVersion: WORKFLOW_EVENT_VERSION,
    aggregateType: "workflow_instance",
    aggregateId: instanceId,
    producerModule: "workflow",
    correlationId: params.correlationId,
    actorTenantUserId: params.requestedByTenantUserId,
    payload: {
      workflowKey: params.workflowKey,
      workflowDefinitionVersion: definition.version,
      resourceType: params.resourceType,
      resourceId: params.resourceId
    }
  });

  const outcome = await activateNode(
    tx,
    tenantId,
    instanceId,
    graphResult.value as WorkflowGraph,
    factsValidation.value as FactsSnapshot,
    graphResult.value.startNodeId,
    null,
    now,
    {
      notificationPort: params.notificationPort,
      correlationId: params.correlationId
    }
  );

  if (outcome.finished) {
    await appendDomainEvent(tx, tenantId, {
      eventType:
        outcome.status === "approved"
          ? WORKFLOW_INSTANCE_APPROVED_EVENT_TYPE
          : WORKFLOW_INSTANCE_REJECTED_EVENT_TYPE,
      eventVersion: WORKFLOW_EVENT_VERSION,
      aggregateType: "workflow_instance",
      aggregateId: instanceId,
      producerModule: "workflow",
      correlationId: params.correlationId,
      payload: { workflowKey: params.workflowKey }
    });
  }

  return {
    instanceId,
    workflowDefinitionId: definition.id,
    workflowDefinitionVersion: definition.version,
    finished: outcome.finished,
    status: outcome.finished ? outcome.status! : "pending"
  };
}
