/**
 * Managed workflow-definition CRUD (Issue #747): draft -> publish/activate
 * -> retire, with version history. Published/active and retired versions
 * are IMMUTABLE — `updateDraftWorkflowDefinition` throws if the target
 * row is not `draft`; editing a non-draft always goes through
 * `createNewDraftVersion` instead, which forks a NEW row.
 */
import { assertUuid } from "../../../lib/database/tenant-context";
import {
  validateWorkflowGraph,
  type WorkflowGraph
} from "../domain/workflow-graph";
import {
  canEditInPlace,
  canPublish,
  canRetire,
  canSoftDelete,
  type DefinitionLifecycleStatus
} from "../domain/workflow-definition-lifecycle";
import { getWorkflowConditionResolverNames } from "../infrastructure/condition-action-registry";

export type WorkflowDefinitionRow = {
  id: string;
  tenant_id: string;
  workflow_key: string;
  name: string;
  description: string | null;
  version: number;
  lifecycle_status: DefinitionLifecycleStatus;
  graph: unknown;
  facts_schema: unknown;
  created_by_tenant_user_id: string | null;
  published_at: Date | null;
  published_by_tenant_user_id: string | null;
  retired_at: Date | null;
  retired_by_tenant_user_id: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
};

export class InvalidWorkflowGraphError extends Error {
  errors: { field: string; message: string }[];
  constructor(errors: { field: string; message: string }[]) {
    super(`Invalid workflow graph: ${errors.map((e) => e.message).join("; ")}`);
    this.name = "InvalidWorkflowGraphError";
    this.errors = errors;
  }
}

export class WorkflowDefinitionLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowDefinitionLifecycleError";
  }
}

function validateGraphOrThrow(
  graph: unknown,
  factsSchema: unknown
): WorkflowGraph {
  const result = validateWorkflowGraph(
    graph,
    factsSchema,
    getWorkflowConditionResolverNames()
  );

  if (!result.valid) {
    throw new InvalidWorkflowGraphError(result.errors);
  }

  return result.value;
}

export type CreateWorkflowDefinitionParams = {
  tenantId: string;
  workflowKey: string;
  name: string;
  description?: string;
  graph: unknown;
  factsSchema?: unknown;
  createdByTenantUserId: string;
};

/** Creates a new workflow (version 1, `draft`) OR — if `workflowKey` already has version history — a new draft version (see `createNewDraftVersion` for editing an EXISTING definition by id instead). */
export async function createWorkflowDefinition(
  tx: Bun.SQL,
  params: CreateWorkflowDefinitionParams
): Promise<WorkflowDefinitionRow> {
  const tenantId = assertUuid(params.tenantId);
  validateGraphOrThrow(params.graph, params.factsSchema ?? []);

  const existingVersionRows = (await tx`
    SELECT COALESCE(MAX(version), 0) AS max_version
    FROM awcms_workflow_definitions
    WHERE tenant_id = ${tenantId} AND workflow_key = ${params.workflowKey} AND deleted_at IS NULL
  `) as { max_version: number | string }[];
  const nextVersion = Number(existingVersionRows[0]?.max_version ?? 0) + 1;

  const rows = (await tx`
    INSERT INTO awcms_workflow_definitions
      (tenant_id, workflow_key, name, description, version, lifecycle_status,
       graph, facts_schema, created_by_tenant_user_id)
    VALUES (
      ${tenantId}, ${params.workflowKey}, ${params.name}, ${params.description ?? null},
      ${nextVersion}, 'draft', ${params.graph}::jsonb,
      ${params.factsSchema ?? []}::jsonb, ${params.createdByTenantUserId}
    )
    RETURNING *
  `) as WorkflowDefinitionRow[];

  return rows[0]!;
}

async function fetchDefinitionForUpdate(
  tx: Bun.SQL,
  tenantId: string,
  definitionId: string
): Promise<WorkflowDefinitionRow | undefined> {
  const rows = (await tx`
    SELECT * FROM awcms_workflow_definitions
    WHERE tenant_id = ${tenantId} AND id = ${definitionId} AND deleted_at IS NULL
  `) as WorkflowDefinitionRow[];

  return rows[0];
}

export type UpdateDraftWorkflowDefinitionParams = {
  tenantId: string;
  definitionId: string;
  name?: string;
  description?: string;
  graph?: unknown;
  factsSchema?: unknown;
};

export async function updateDraftWorkflowDefinition(
  tx: Bun.SQL,
  params: UpdateDraftWorkflowDefinitionParams
): Promise<WorkflowDefinitionRow> {
  const tenantId = assertUuid(params.tenantId);
  const definitionId = assertUuid(params.definitionId);
  const existing = await fetchDefinitionForUpdate(tx, tenantId, definitionId);

  if (!existing) {
    throw new WorkflowDefinitionLifecycleError(
      "Workflow definition not found."
    );
  }

  if (!canEditInPlace(existing.lifecycle_status)) {
    throw new WorkflowDefinitionLifecycleError(
      `Cannot edit a "${existing.lifecycle_status}" definition in place — create a new draft version instead.`
    );
  }

  const nextGraph = params.graph ?? existing.graph;
  const nextFactsSchema = params.factsSchema ?? existing.facts_schema;

  validateGraphOrThrow(nextGraph, nextFactsSchema);

  const rows = (await tx`
    UPDATE awcms_workflow_definitions
    SET name = ${params.name ?? existing.name},
        description = ${params.description ?? existing.description},
        graph = ${nextGraph}::jsonb,
        facts_schema = ${nextFactsSchema}::jsonb,
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${definitionId}
    RETURNING *
  `) as WorkflowDefinitionRow[];

  return rows[0]!;
}

/** Forks `sourceDefinitionId`'s current graph/facts into a NEW draft row (`version` = current max for the workflow_key + 1) — the only way to change a published/active or retired definition. */
export async function createNewDraftVersion(
  tx: Bun.SQL,
  tenantId: string,
  sourceDefinitionId: string,
  createdByTenantUserId: string
): Promise<WorkflowDefinitionRow> {
  const safeTenantId = assertUuid(tenantId);
  const source = await fetchDefinitionForUpdate(
    tx,
    safeTenantId,
    assertUuid(sourceDefinitionId)
  );

  if (!source) {
    throw new WorkflowDefinitionLifecycleError(
      "Workflow definition not found."
    );
  }

  return createWorkflowDefinition(tx, {
    tenantId: safeTenantId,
    workflowKey: source.workflow_key,
    name: source.name,
    description: source.description ?? undefined,
    graph: source.graph,
    factsSchema: source.facts_schema,
    createdByTenantUserId
  });
}

export type PublishWorkflowDefinitionParams = {
  tenantId: string;
  definitionId: string;
  publishedByTenantUserId: string;
};

/**
 * Transitions `draft` -> `active`. Re-validates the graph (defense in
 * depth) and, IN THE SAME TRANSACTION, retires any previously-`active`
 * version of the same `workflow_key` — the mechanism (not just the
 * partial unique index backstop, migration 060) that keeps "at most one
 * active version per workflow_key" true.
 */
export async function publishWorkflowDefinition(
  tx: Bun.SQL,
  params: PublishWorkflowDefinitionParams
): Promise<WorkflowDefinitionRow> {
  const tenantId = assertUuid(params.tenantId);
  const definitionId = assertUuid(params.definitionId);
  const existing = await fetchDefinitionForUpdate(tx, tenantId, definitionId);

  if (!existing) {
    throw new WorkflowDefinitionLifecycleError(
      "Workflow definition not found."
    );
  }

  if (!canPublish(existing.lifecycle_status)) {
    throw new WorkflowDefinitionLifecycleError(
      `Only a "draft" definition can be published (current status: "${existing.lifecycle_status}").`
    );
  }

  validateGraphOrThrow(existing.graph, existing.facts_schema);

  await tx`
    UPDATE awcms_workflow_definitions
    SET lifecycle_status = 'retired', retired_at = now(),
        retired_by_tenant_user_id = ${params.publishedByTenantUserId}
    WHERE tenant_id = ${tenantId} AND workflow_key = ${existing.workflow_key}
      AND lifecycle_status = 'active' AND deleted_at IS NULL
  `;

  const rows = (await tx`
    UPDATE awcms_workflow_definitions
    SET lifecycle_status = 'active', published_at = now(),
        published_by_tenant_user_id = ${params.publishedByTenantUserId}
    WHERE tenant_id = ${tenantId} AND id = ${definitionId}
    RETURNING *
  `) as WorkflowDefinitionRow[];

  return rows[0]!;
}

export type RetireWorkflowDefinitionParams = {
  tenantId: string;
  definitionId: string;
  retiredByTenantUserId: string;
};

export async function retireWorkflowDefinition(
  tx: Bun.SQL,
  params: RetireWorkflowDefinitionParams
): Promise<WorkflowDefinitionRow> {
  const tenantId = assertUuid(params.tenantId);
  const definitionId = assertUuid(params.definitionId);
  const existing = await fetchDefinitionForUpdate(tx, tenantId, definitionId);

  if (!existing) {
    throw new WorkflowDefinitionLifecycleError(
      "Workflow definition not found."
    );
  }

  if (!canRetire(existing.lifecycle_status)) {
    throw new WorkflowDefinitionLifecycleError(
      `Only an "active" definition can be retired (current status: "${existing.lifecycle_status}").`
    );
  }

  const rows = (await tx`
    UPDATE awcms_workflow_definitions
    SET lifecycle_status = 'retired', retired_at = now(),
        retired_by_tenant_user_id = ${params.retiredByTenantUserId}
    WHERE tenant_id = ${tenantId} AND id = ${definitionId}
    RETURNING *
  `) as WorkflowDefinitionRow[];

  return rows[0]!;
}

export type SoftDeleteWorkflowDefinitionParams = {
  tenantId: string;
  definitionId: string;
  deletedByTenantUserId: string;
  deleteReason?: string;
};

export async function softDeleteDraftWorkflowDefinition(
  tx: Bun.SQL,
  params: SoftDeleteWorkflowDefinitionParams
): Promise<void> {
  const tenantId = assertUuid(params.tenantId);
  const definitionId = assertUuid(params.definitionId);
  const existing = await fetchDefinitionForUpdate(tx, tenantId, definitionId);

  if (!existing) {
    throw new WorkflowDefinitionLifecycleError(
      "Workflow definition not found."
    );
  }

  if (!canSoftDelete(existing.lifecycle_status)) {
    throw new WorkflowDefinitionLifecycleError(
      `Only a "draft" definition can be deleted (current status: "${existing.lifecycle_status}") — retire an active one instead.`
    );
  }

  await tx`
    UPDATE awcms_workflow_definitions
    SET deleted_at = now(), deleted_by = ${params.deletedByTenantUserId},
        delete_reason = ${params.deleteReason ?? null}
    WHERE tenant_id = ${tenantId} AND id = ${definitionId}
  `;
}

export async function getWorkflowDefinitionById(
  tx: Bun.SQL,
  tenantId: string,
  definitionId: string
): Promise<WorkflowDefinitionRow | undefined> {
  return fetchDefinitionForUpdate(
    tx,
    assertUuid(tenantId),
    assertUuid(definitionId)
  );
}

export async function listWorkflowDefinitionVersions(
  tx: Bun.SQL,
  tenantId: string,
  workflowKey: string
): Promise<WorkflowDefinitionRow[]> {
  return (await tx`
    SELECT * FROM awcms_workflow_definitions
    WHERE tenant_id = ${assertUuid(tenantId)} AND workflow_key = ${workflowKey}
      AND deleted_at IS NULL
    ORDER BY version DESC
  `) as WorkflowDefinitionRow[];
}

export type ListWorkflowDefinitionsFilters = {
  lifecycleStatus?: DefinitionLifecycleStatus;
};

const DEFINITION_LIST_LIMIT = 100;

/** One row per DISTINCT `workflow_key`, the latest version matching the filter (or the latest overall when no `lifecycleStatus` filter is given) — the definitions list view, not full version history (see `listWorkflowDefinitionVersions` for that). */
export async function listWorkflowDefinitions(
  tx: Bun.SQL,
  tenantId: string,
  filters: ListWorkflowDefinitionsFilters = {}
): Promise<WorkflowDefinitionRow[]> {
  const safeTenantId = assertUuid(tenantId);

  return (await tx`
    SELECT DISTINCT ON (workflow_key) *
    FROM awcms_workflow_definitions
    WHERE tenant_id = ${safeTenantId} AND deleted_at IS NULL
      AND (${filters.lifecycleStatus ?? null}::text IS NULL OR lifecycle_status = ${filters.lifecycleStatus ?? null})
    ORDER BY workflow_key, version DESC
    LIMIT ${DEFINITION_LIST_LIMIT}
  `) as WorkflowDefinitionRow[];
}
