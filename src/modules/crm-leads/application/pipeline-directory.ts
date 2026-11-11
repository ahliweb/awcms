/**
 * Pipelines and their immutable revisions (Issue #1166, ADR-0153 section 3).
 *
 * A revision is written ONCE, with its stages and edges, in the transaction
 * that publishes it; the database refuses any later change (sql/344).
 * Publishing a revision that removes a stage some lead is in is refused unless
 * the request names, for every such stage, the stage of the new revision those
 * leads move to: an explicit, audited, idempotent migration, never a silent
 * one. Every lead so moved gets a `stage_migrated` transition row.
 *
 * Lock order (every writer in this module): PIPELINE row, then LEAD rows by id.
 */
import type {
  PipelineDefinition,
  PublishRevisionInput,
  CreatePipelineInput,
  StageDefinition,
  TransitionDefinition
} from "../domain/crm-leads-validation";
import { definitionHash } from "../domain/pipeline-rules";
import type {
  StageCategory,
  TransitionGuard
} from "../domain/crm-leads-constants";
import { appendLeadTransition, type EmitContext } from "./lead-events";

type Sql = Bun.SQL;

export type RevisionView = {
  id: string;
  revisionNumber: number;
  initialStageKey: string;
  definitionHash: string;
  publishedAt: string;
  publishedBy: string;
  stages: (StageDefinition & { position: number })[];
  transitions: TransitionDefinition[];
};

export type PipelineView = {
  id: string;
  code: string;
  name: string;
  scope: { type: string; id: string } | null;
  timeZone: string;
  status: "active" | "archived";
  version: number;
  currentRevisionNumber: number;
  createdAt: string;
  updatedAt: string;
};

type PipelineRow = {
  id: string;
  code: string;
  name: string;
  scope_type: string | null;
  scope_id: string | null;
  time_zone: string;
  status: "active" | "archived";
  version: number;
  current_revision_number: number;
  created_at: Date;
  updated_at: Date;
};

function toPipeline(row: PipelineRow): PipelineView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    scope:
      row.scope_type && row.scope_id
        ? { type: row.scope_type, id: row.scope_id }
        : null,
    timeZone: row.time_zone,
    status: row.status,
    version: Number(row.version),
    currentRevisionNumber: Number(row.current_revision_number),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

export async function listPipelines(
  tx: Sql,
  tenantId: string
): Promise<PipelineView[]> {
  const rows = (await tx`
    SELECT id, code, name, scope_type, scope_id, time_zone, status, version,
           current_revision_number, created_at, updated_at
    FROM awcms_crm_pipelines
    WHERE tenant_id = ${tenantId}
    ORDER BY code
    LIMIT 200
  `) as PipelineRow[];

  return rows.map(toPipeline);
}

export async function fetchRevision(
  tx: Sql,
  tenantId: string,
  pipelineId: string,
  revisionNumber: number
): Promise<RevisionView | null> {
  const revisions = (await tx`
    SELECT id, revision_number, initial_stage_key, definition_hash,
           published_at, published_by
    FROM awcms_crm_pipeline_revisions
    WHERE tenant_id = ${tenantId}
      AND pipeline_id = ${pipelineId}
      AND revision_number = ${revisionNumber}
  `) as {
    id: string;
    revision_number: number;
    initial_stage_key: string;
    definition_hash: string;
    published_at: Date;
    published_by: string;
  }[];
  const revision = revisions[0];

  if (!revision) return null;

  const stages = (await tx`
    SELECT stage_key, name, position, category
    FROM awcms_crm_pipeline_stages
    WHERE tenant_id = ${tenantId} AND revision_id = ${revision.id}
    ORDER BY position
  `) as {
    stage_key: string;
    name: string;
    position: number;
    category: StageCategory;
  }[];
  const transitions = (await tx`
    SELECT from_stage_key, to_stage_key, guards
    FROM awcms_crm_pipeline_transitions
    WHERE tenant_id = ${tenantId} AND revision_id = ${revision.id}
    ORDER BY from_stage_key, to_stage_key
  `) as {
    from_stage_key: string;
    to_stage_key: string;
    guards: TransitionGuard[];
  }[];

  return {
    id: revision.id,
    revisionNumber: Number(revision.revision_number),
    initialStageKey: revision.initial_stage_key,
    definitionHash: revision.definition_hash,
    publishedAt: revision.published_at.toISOString(),
    publishedBy: revision.published_by,
    stages: stages.map((stage) => ({
      key: stage.stage_key,
      name: stage.name,
      position: Number(stage.position),
      category: stage.category
    })),
    transitions: transitions.map((edge) => ({
      from: edge.from_stage_key,
      to: edge.to_stage_key,
      guards: [...edge.guards]
    }))
  };
}

export async function fetchPipeline(
  tx: Sql,
  tenantId: string,
  pipelineId: string,
  lock: "none" | "share" | "update" = "none"
): Promise<(PipelineView & { currentRevision: RevisionView }) | null> {
  const rows = (
    lock === "update"
      ? await tx`
          SELECT id, code, name, scope_type, scope_id, time_zone, status, version,
                 current_revision_number, created_at, updated_at
          FROM awcms_crm_pipelines
          WHERE tenant_id = ${tenantId} AND id = ${pipelineId}
          FOR UPDATE`
      : lock === "share"
        ? await tx`
          SELECT id, code, name, scope_type, scope_id, time_zone, status, version,
                 current_revision_number, created_at, updated_at
          FROM awcms_crm_pipelines
          WHERE tenant_id = ${tenantId} AND id = ${pipelineId}
          FOR SHARE`
        : await tx`
          SELECT id, code, name, scope_type, scope_id, time_zone, status, version,
                 current_revision_number, created_at, updated_at
          FROM awcms_crm_pipelines
          WHERE tenant_id = ${tenantId} AND id = ${pipelineId}`
  ) as PipelineRow[];
  const row = rows[0];

  if (!row) return null;

  const currentRevision = await fetchRevision(
    tx,
    tenantId,
    pipelineId,
    Number(row.current_revision_number)
  );

  if (!currentRevision) return null;

  return { ...toPipeline(row), currentRevision };
}

async function insertRevision(
  tx: Sql,
  tenantId: string,
  pipelineId: string,
  revisionNumber: number,
  definition: PipelineDefinition,
  actor: string
): Promise<string> {
  const rows = (await tx`
    INSERT INTO awcms_crm_pipeline_revisions
      (tenant_id, pipeline_id, revision_number, initial_stage_key,
       definition_hash, published_by)
    VALUES (${tenantId}, ${pipelineId}, ${revisionNumber},
            ${definition.initialStageKey}, ${definitionHash(definition)}, ${actor})
    RETURNING id
  `) as { id: string }[];
  const revisionId = rows[0]!.id;

  for (const [index, stage] of definition.stages.entries()) {
    await tx`
      INSERT INTO awcms_crm_pipeline_stages
        (tenant_id, revision_id, stage_key, name, position, category)
      VALUES (${tenantId}, ${revisionId}, ${stage.key}, ${stage.name},
              ${index + 1}, ${stage.category})
    `;
  }

  for (const edge of definition.transitions) {
    await tx`
      INSERT INTO awcms_crm_pipeline_transitions
        (tenant_id, revision_id, from_stage_key, to_stage_key, guards)
      VALUES (${tenantId}, ${revisionId}, ${edge.from}, ${edge.to},
              ${tx.array(edge.guards, "text")})
    `;
  }

  return revisionId;
}

export type CreatePipelineResult =
  | {
      outcome: "created";
      pipeline: PipelineView & { currentRevision: RevisionView };
    }
  | { outcome: "code_taken" };

export async function createPipeline(
  tx: Sql,
  tenantId: string,
  actor: string,
  input: CreatePipelineInput
): Promise<CreatePipelineResult> {
  const inserted = (await tx`
    INSERT INTO awcms_crm_pipelines
      (tenant_id, code, name, scope_type, scope_id, time_zone,
       current_revision_number, created_by, updated_by)
    VALUES (${tenantId}, ${input.code}, ${input.name},
            ${input.scope?.type ?? null}, ${input.scope?.id ?? null},
            ${input.timeZone}, 1, ${actor}, ${actor})
    ON CONFLICT (tenant_id, code) DO NOTHING
    RETURNING id
  `) as { id: string }[];

  if (inserted.length === 0) return { outcome: "code_taken" };

  const pipelineId = inserted[0]!.id;

  await insertRevision(tx, tenantId, pipelineId, 1, input.definition, actor);

  const pipeline = await fetchPipeline(tx, tenantId, pipelineId);

  return { outcome: "created", pipeline: pipeline! };
}

export type PublishRevisionResult =
  | {
      outcome: "published";
      pipeline: PipelineView & { currentRevision: RevisionView };
      migratedLeadCount: number;
      removedStageKeys: string[];
    }
  | { outcome: "not_found" }
  | { outcome: "version_conflict"; currentVersion: number }
  | { outcome: "unchanged" }
  | { outcome: "stages_in_use"; stageKeys: string[] }
  | { outcome: "unknown_migration_source"; stageKeys: string[] };

export async function publishRevision(
  tx: Sql,
  tenantId: string,
  actor: string,
  pipelineId: string,
  input: PublishRevisionInput,
  emit: EmitContext
): Promise<PublishRevisionResult> {
  const pipeline = await fetchPipeline(tx, tenantId, pipelineId, "update");

  if (!pipeline) return { outcome: "not_found" };

  if (pipeline.version !== input.expectedVersion) {
    return { outcome: "version_conflict", currentVersion: pipeline.version };
  }

  if (
    definitionHash(input.definition) === pipeline.currentRevision.definitionHash
  ) {
    return { outcome: "unchanged" };
  }

  const newKeys = new Set(input.definition.stages.map((stage) => stage.key));
  const oldKeys = new Set(pipeline.currentRevision.stages.map((s) => s.key));
  const removed = [...oldKeys].filter((key) => !newKeys.has(key));
  const unknownSources = Object.keys(input.stageMigrations).filter(
    (key) => !oldKeys.has(key)
  );

  if (unknownSources.length > 0) {
    return { outcome: "unknown_migration_source", stageKeys: unknownSources };
  }

  // Every lead whose CURRENT stage key is removed must be named. A lead keeps
  // the revision it entered its stage under, so the stage key alone decides.
  const occupied =
    removed.length === 0
      ? []
      : ((await tx`
          SELECT DISTINCT stage_key
          FROM awcms_crm_leads
          WHERE tenant_id = ${tenantId}
            AND pipeline_id = ${pipelineId}
            AND stage_key = ANY(${tx.array(removed, "text")})
        `) as { stage_key: string }[]);
  const unmigrated = occupied
    .map((row) => row.stage_key)
    .filter((key) => input.stageMigrations[key] === undefined)
    .sort();

  if (unmigrated.length > 0) {
    return { outcome: "stages_in_use", stageKeys: unmigrated };
  }

  // Every refusal is above this line: nothing has been written yet.
  const revisionNumber = pipeline.currentRevisionNumber + 1;
  const revisionId = await insertRevision(
    tx,
    tenantId,
    pipelineId,
    revisionNumber,
    input.definition,
    actor
  );

  await tx`
    UPDATE awcms_crm_pipelines
    SET current_revision_number = ${revisionNumber},
        version = version + 1,
        updated_at = now(),
        updated_by = ${actor}
    WHERE tenant_id = ${tenantId} AND id = ${pipelineId}
  `;

  const categories = new Map(
    input.definition.stages.map((stage) => [stage.key, stage.category])
  );
  let migratedLeadCount = 0;

  if (occupied.length > 0) {
    const leads = (await tx`
      SELECT id, stage_key, stage_category
      FROM awcms_crm_leads
      WHERE tenant_id = ${tenantId}
        AND pipeline_id = ${pipelineId}
        AND stage_key = ANY(${tx.array(removed, "text")})
      ORDER BY id
      FOR UPDATE
    `) as { id: string; stage_key: string; stage_category: StageCategory }[];

    for (const lead of leads) {
      const toStageKey = input.stageMigrations[lead.stage_key]!;
      const toCategory = categories.get(toStageKey)!;

      await tx`
        UPDATE awcms_crm_leads
        SET revision_id = ${revisionId},
            stage_key = ${toStageKey},
            stage_category = ${toCategory},
            stage_entered_at = now(),
            version = version + 1,
            updated_at = now(),
            updated_by = ${actor}
        WHERE tenant_id = ${tenantId} AND id = ${lead.id}
      `;

      await appendLeadTransition(tx, tenantId, emit, {
        leadId: lead.id,
        kind: "stage_migrated",
        pipelineId,
        revisionId,
        fromStageKey: lead.stage_key,
        fromCategory: lead.stage_category,
        toStageKey,
        toCategory,
        reason: input.reason,
        actor,
        occurredAt: new Date(),
        idempotencyKey: emit.idempotencyKey ?? null
      });
      migratedLeadCount += 1;
    }
  }

  const updated = await fetchPipeline(tx, tenantId, pipelineId);

  return {
    outcome: "published",
    pipeline: updated!,
    migratedLeadCount,
    removedStageKeys: removed.sort()
  };
}
