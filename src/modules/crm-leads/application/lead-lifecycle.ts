/**
 * Stage moves, conversions and merges (Issue #1166, ADR-0153 sections 3, 5, 6).
 *
 * ## A move is decided under the lock (T-S1)
 *
 * The lead row is locked `FOR UPDATE` (after its pipeline row, the module's
 * lock order), then its `version` is compared with the caller's, then the edge
 * and its guards are evaluated against facts read IN THIS transaction. Two
 * concurrent moves therefore serialise: the second sees the first one's new
 * version and answers `version_conflict`, never a lost update.
 *
 * ## Conversion is recorded, never assumed (L7, N1)
 *
 * A move into a `converted` stage is refused: the only way in is a conversion
 * record, from the customer authority (`authority_confirmed`, with its opaque
 * customer reference) or a flagged manual one (`authority_unconfirmed`). A
 * replayed confirmation (same evidence reference) is a no-op. A reversal is a
 * new fact stamped once on the record plus a new transition row, never an edit
 * of what was recorded.
 *
 * ## Merge is human-verified and undoable (L5)
 *
 * Both leads must be open, live, in the SAME pipeline (so the same tenant and
 * business scope) and at the versions the reviewer saw. The absorbed lead is
 * marked `merged` and points at the survivor; nothing is moved or deleted, so a
 * rollback within the undo window restores it exactly. A merge never crosses a
 * tenant: both ids are read under the caller's RLS context.
 */
import {
  CRM_LEAD_CONVERSION_REVERSED_EVENT_TYPE,
  CRM_LEAD_CONVERTED_EVENT_TYPE,
  CRM_LEAD_MERGE_REVERTED_EVENT_TYPE,
  CRM_LEAD_MERGED_EVENT_TYPE,
  type StageCategory,
  type TransitionGuard
} from "../domain/crm-leads-constants";
import {
  buildConversionReversedPayload,
  buildLeadConvertedPayload,
  buildLeadMergeRevertedPayload,
  buildLeadMergedPayload
} from "../domain/crm-leads-events";
import type {
  ConversionInput,
  MergeInput,
  MoveLeadInput,
  ReverseConversionInput
} from "../domain/crm-leads-validation";
import { unmetGuards } from "../domain/pipeline-rules";
import {
  appendLeadTransition,
  emitLeadEvent,
  type EmitContext
} from "./lead-events";
import {
  fetchLeadView,
  lockLead,
  readLead,
  writeRefusal,
  type LeadRecord,
  type LeadView,
  type LeadWriteRefusal
} from "./lead-directory";
import { fetchPipeline, type RevisionView } from "./pipeline-directory";

type Sql = Bun.SQL;

/** SQLSTATE 23505. Bun.SQL carries it on `errno`, not `code`. */
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Bun.SQL.PostgresError && String(error.errno) === "23505"
  );
}

async function liveContactPointCount(
  tx: Sql,
  tenantId: string,
  leadId: string
): Promise<number> {
  const rows = (await tx`
    SELECT count(*)::int AS n FROM awcms_crm_lead_contact_points
    WHERE tenant_id = ${tenantId} AND lead_id = ${leadId}
      AND revoked_at IS NULL AND erased_at IS NULL
  `) as { n: number }[];

  return Number(rows[0]?.n ?? 0);
}

type EdgeDecision =
  | { ok: true; toCategory: StageCategory }
  | { ok: false; outcome: "stage_not_found" }
  | { ok: false; outcome: "transition_not_allowed" }
  | { ok: false; outcome: "guard_not_met"; guards: TransitionGuard[] };

async function decideEdge(
  tx: Sql,
  tenantId: string,
  lead: LeadRecord,
  revision: RevisionView,
  toStageKey: string,
  reasonGiven: boolean
): Promise<EdgeDecision> {
  const target = revision.stages.find((stage) => stage.key === toStageKey);

  if (!target) return { ok: false, outcome: "stage_not_found" };

  const edge = revision.transitions.find(
    (candidate) =>
      candidate.from === lead.stageKey && candidate.to === toStageKey
  );

  if (!edge) return { ok: false, outcome: "transition_not_allowed" };

  const unmet = unmetGuards(edge.guards, {
    ownerAssigned: lead.ownerTenantUserId !== null,
    liveContactPoints: edge.guards.includes("contact_point_present")
      ? await liveContactPointCount(tx, tenantId, lead.id)
      : 0,
    reasonGiven
  });

  return unmet.length > 0
    ? { ok: false, outcome: "guard_not_met", guards: unmet }
    : { ok: true, toCategory: target.category };
}

export type MoveLeadResult =
  | { outcome: "moved"; lead: LeadView; transitionId: string }
  | LeadWriteRefusal
  | { outcome: "stage_not_found" }
  | { outcome: "transition_not_allowed" }
  | { outcome: "guard_not_met"; guards: TransitionGuard[] }
  | { outcome: "conversion_required" }
  | { outcome: "reversal_required" };

export async function moveLead(
  tx: Sql,
  tenantId: string,
  actor: string,
  leadId: string,
  input: MoveLeadInput,
  emit: EmitContext
): Promise<MoveLeadResult> {
  const lead = await lockLead(tx, tenantId, leadId);
  const refused = writeRefusal(lead, input.expectedVersion);

  if (refused) return refused;

  // A converted lead leaves `converted` only through a reversal by the authority.
  if (lead!.stageCategory === "converted")
    return { outcome: "reversal_required" };

  const pipeline = (await fetchPipeline(tx, tenantId, lead!.pipelineId))!;
  const revision = pipeline.currentRevision;
  const target = revision.stages.find(
    (stage) => stage.key === input.toStageKey
  );

  if (target?.category === "converted")
    return { outcome: "conversion_required" };

  const decision = await decideEdge(
    tx,
    tenantId,
    lead!,
    revision,
    input.toStageKey,
    input.reason !== null
  );

  if (!decision.ok) {
    return decision.outcome === "guard_not_met"
      ? { outcome: "guard_not_met", guards: decision.guards }
      : { outcome: decision.outcome };
  }

  await tx`
    UPDATE awcms_crm_leads
    SET revision_id = ${revision.id},
        stage_key = ${input.toStageKey},
        stage_category = ${decision.toCategory},
        stage_entered_at = now(),
        version = version + 1, updated_at = now(), updated_by = ${actor}
    WHERE tenant_id = ${tenantId} AND id = ${leadId}
  `;

  const transition = await appendLeadTransition(tx, tenantId, emit, {
    leadId,
    kind: "moved",
    pipelineId: lead!.pipelineId,
    revisionId: revision.id,
    fromStageKey: lead!.stageKey,
    fromCategory: lead!.stageCategory,
    toStageKey: input.toStageKey,
    toCategory: decision.toCategory,
    reason: input.reason,
    actor,
    occurredAt: input.occurredAt,
    idempotencyKey: emit.idempotencyKey ?? null
  });

  return {
    outcome: "moved",
    lead: (await fetchLeadView(tx, tenantId, leadId))!,
    transitionId: transition.transitionId
  };
}

type ConversionRow = {
  id: string;
  lead_id: string;
  mode: string;
  external_customer_ref: string | null;
  reversed_at: Date | null;
  reversal_evidence_ref: string | null;
};

export type ConversionResult =
  | { outcome: "converted"; lead: LeadView; conversionId: string }
  | { outcome: "replayed"; lead: LeadView; conversionId: string }
  | { outcome: "evidence_reused" }
  | { outcome: "already_converted" }
  | { outcome: "no_converted_stage" }
  | LeadWriteRefusal
  | { outcome: "stage_not_found" }
  | { outcome: "transition_not_allowed" }
  | { outcome: "guard_not_met"; guards: TransitionGuard[] };

export async function recordConversion(
  tx: Sql,
  tenantId: string,
  actor: string,
  leadId: string,
  input: ConversionInput,
  emit: EmitContext
): Promise<ConversionResult> {
  const lead = await lockLead(tx, tenantId, leadId);

  if (!lead) return { outcome: "not_found" };

  // A replayed confirmation is a no-op, whatever has happened since: the
  // evidence reference is the replay key (ADR-0153 section 6).
  const prior = (await tx`
    SELECT id, lead_id, mode, external_customer_ref, reversed_at,
           reversal_evidence_ref
    FROM awcms_crm_lead_conversions
    WHERE tenant_id = ${tenantId} AND evidence_ref = ${input.evidenceRef}
  `) as ConversionRow[];

  if (prior[0]) {
    const same =
      prior[0].lead_id === leadId &&
      prior[0].mode === input.mode &&
      prior[0].external_customer_ref === input.externalCustomerRef;

    return same
      ? {
          outcome: "replayed",
          lead: (await fetchLeadView(tx, tenantId, leadId))!,
          conversionId: prior[0].id
        }
      : { outcome: "evidence_reused" };
  }

  const refused = writeRefusal(lead, input.expectedVersion);

  if (refused) return refused;

  if (lead.stageCategory === "converted")
    return { outcome: "already_converted" };

  const pipeline = (await fetchPipeline(tx, tenantId, lead.pipelineId))!;
  const revision = pipeline.currentRevision;
  const toStageKey =
    input.toStageKey ??
    revision.stages.find((stage) => stage.category === "converted")?.key ??
    null;

  if (!toStageKey) return { outcome: "no_converted_stage" };

  const target = revision.stages.find((stage) => stage.key === toStageKey);

  if (target && target.category !== "converted") {
    return { outcome: "stage_not_found" };
  }

  const decision = await decideEdge(
    tx,
    tenantId,
    lead,
    revision,
    toStageKey,
    input.note !== null
  );

  if (!decision.ok) {
    return decision.outcome === "guard_not_met"
      ? { outcome: "guard_not_met", guards: decision.guards }
      : { outcome: decision.outcome };
  }

  // The replay probe above cannot see a CONCURRENT conversion of another lead
  // with the same evidence reference that has not committed yet: the unique
  // index is the decision. Inside a savepoint, so the refusal leaves the
  // transaction usable and answers `evidence_reused` instead of a 500.
  let inserted: { id: string; recorded_at: Date }[];
  // Every caller passes its open transaction (the route's `tx`, the port's
  // composition root); the narrower type is what exposes `savepoint`.
  const txn = tx as Bun.TransactionSQL;

  try {
    inserted = (await txn.savepoint(
      (sp) => sp`
        INSERT INTO awcms_crm_lead_conversions
          (tenant_id, lead_id, mode, external_customer_ref, evidence_ref, note,
           occurred_at, recorded_by)
        VALUES (${tenantId}, ${leadId}, ${input.mode}, ${input.externalCustomerRef},
                ${input.evidenceRef}, ${input.note}, ${input.occurredAt}, ${actor})
        RETURNING id, recorded_at
      `
    )) as { id: string; recorded_at: Date }[];
  } catch (error) {
    if (isUniqueViolation(error)) return { outcome: "evidence_reused" };
    throw error;
  }

  const conversion = inserted[0]!;

  await tx`
    UPDATE awcms_crm_leads
    SET revision_id = ${revision.id},
        stage_key = ${toStageKey},
        stage_category = 'converted',
        stage_entered_at = now(),
        external_customer_ref = ${input.externalCustomerRef},
        version = version + 1, updated_at = now(), updated_by = ${actor}
    WHERE tenant_id = ${tenantId} AND id = ${leadId}
  `;

  await appendLeadTransition(tx, tenantId, emit, {
    leadId,
    kind: "converted",
    pipelineId: lead.pipelineId,
    revisionId: revision.id,
    fromStageKey: lead.stageKey,
    fromCategory: lead.stageCategory,
    toStageKey,
    toCategory: "converted",
    reason: null,
    actor,
    occurredAt: input.occurredAt,
    idempotencyKey: emit.idempotencyKey ?? null
  });

  await emitLeadEvent(tx, tenantId, emit, {
    eventType: CRM_LEAD_CONVERTED_EVENT_TYPE,
    aggregateId: leadId,
    payload: buildLeadConvertedPayload({
      leadId,
      conversionId: conversion.id,
      mode: input.mode,
      externalCustomerRef: input.externalCustomerRef,
      evidenceRef: input.evidenceRef,
      toStageKey,
      occurredAt: input.occurredAt,
      recordedAt: conversion.recorded_at
    })
  });

  return {
    outcome: "converted",
    lead: (await fetchLeadView(tx, tenantId, leadId))!,
    conversionId: conversion.id
  };
}

export type ReverseConversionResult =
  | { outcome: "reversed"; lead: LeadView; conversionId: string }
  | { outcome: "replayed"; lead: LeadView; conversionId: string }
  | { outcome: "not_found" }
  | { outcome: "already_reversed" }
  | { outcome: "evidence_reused" };

export async function reverseConversion(
  tx: Sql,
  tenantId: string,
  actor: string,
  conversionId: string,
  input: ReverseConversionInput,
  emit: EmitContext
): Promise<ReverseConversionResult> {
  const probe = (await tx`
    SELECT lead_id FROM awcms_crm_lead_conversions
    WHERE tenant_id = ${tenantId} AND id = ${conversionId}
  `) as { lead_id: string }[];

  if (!probe[0]) return { outcome: "not_found" };

  const leadId = probe[0].lead_id;
  const lead = (await lockLead(tx, tenantId, leadId))!;
  const rows = (await tx`
    SELECT id, lead_id, mode, external_customer_ref, reversed_at,
           reversal_evidence_ref
    FROM awcms_crm_lead_conversions
    WHERE tenant_id = ${tenantId} AND id = ${conversionId}
  `) as ConversionRow[];
  const conversion = rows[0]!;

  if (conversion.reversed_at) {
    return conversion.reversal_evidence_ref === input.evidenceRef
      ? {
          outcome: "replayed",
          lead: (await fetchLeadView(tx, tenantId, leadId))!,
          conversionId
        }
      : { outcome: "already_reversed" };
  }

  const reused = (await tx`
    SELECT 1 AS present FROM awcms_crm_lead_conversions
    WHERE tenant_id = ${tenantId}
      AND (reversal_evidence_ref = ${input.evidenceRef}
           OR evidence_ref = ${input.evidenceRef})
  `) as { present: number }[];

  if (reused.length > 0) return { outcome: "evidence_reused" };

  // Back to the stage the lead converted FROM when the current revision still
  // has it (and it is not itself a converted stage); otherwise the initial stage.
  const pipeline = (await fetchPipeline(tx, tenantId, lead.pipelineId))!;
  const revision = pipeline.currentRevision;
  const from = (await tx`
    SELECT from_stage_key FROM awcms_crm_lead_transitions
    WHERE tenant_id = ${tenantId} AND lead_id = ${leadId} AND kind = 'converted'
    ORDER BY sequence DESC
    LIMIT 1
  `) as { from_stage_key: string | null }[];
  const previous = revision.stages.find(
    (stage) =>
      stage.key === from[0]?.from_stage_key && stage.category !== "converted"
  );
  const back =
    previous ??
    revision.stages.find((stage) => stage.key === revision.initialStageKey)!;
  const now = new Date();

  // Two reversals of DIFFERENT conversions racing on one evidence reference meet
  // at the unique index; the loser answers `evidence_reused`, never a 500.
  const txn = tx as Bun.TransactionSQL;

  try {
    await txn.savepoint(
      (sp) => sp`
        UPDATE awcms_crm_lead_conversions
        SET reversed_at = ${now},
            reversal_evidence_ref = ${input.evidenceRef},
            reversal_occurred_at = ${input.occurredAt},
            reversed_by = ${actor}
        WHERE tenant_id = ${tenantId} AND id = ${conversionId}
      `
    );
  } catch (error) {
    if (isUniqueViolation(error)) return { outcome: "evidence_reused" };
    throw error;
  }

  // Only a lead that is still IN its converted stage moves back. An absorbed
  // or anonymised lead keeps its stage facts; the reversal is recorded either way.
  const moveBack = lead.stageCategory === "converted";

  await tx`
    UPDATE awcms_crm_leads
    SET external_customer_ref = NULL,
        revision_id = CASE WHEN ${moveBack}::boolean THEN ${revision.id}::uuid ELSE revision_id END,
        stage_key = CASE WHEN ${moveBack}::boolean THEN ${back.key}::text ELSE stage_key END,
        stage_category = CASE WHEN ${moveBack}::boolean THEN ${back.category}::text ELSE stage_category END,
        stage_entered_at = CASE WHEN ${moveBack}::boolean THEN now() ELSE stage_entered_at END,
        version = version + 1, updated_at = now(), updated_by = ${actor}
    WHERE tenant_id = ${tenantId} AND id = ${leadId}
  `;

  if (moveBack) {
    await appendLeadTransition(tx, tenantId, emit, {
      leadId,
      kind: "conversion_reversed",
      pipelineId: lead.pipelineId,
      revisionId: revision.id,
      fromStageKey: lead.stageKey,
      fromCategory: lead.stageCategory,
      toStageKey: back.key,
      toCategory: back.category,
      reason: input.reason,
      actor,
      occurredAt: input.occurredAt,
      idempotencyKey: emit.idempotencyKey ?? null
    });
  }

  await emitLeadEvent(tx, tenantId, emit, {
    eventType: CRM_LEAD_CONVERSION_REVERSED_EVENT_TYPE,
    aggregateId: leadId,
    payload: buildConversionReversedPayload({
      leadId,
      conversionId,
      reversalEvidenceRef: input.evidenceRef,
      toStageKey: moveBack ? back.key : lead.stageKey,
      occurredAt: input.occurredAt,
      recordedAt: now
    })
  });

  return {
    outcome: "reversed",
    lead: (await fetchLeadView(tx, tenantId, leadId))!,
    conversionId
  };
}

export type MergeResult =
  | { outcome: "merged"; mergeId: string; undoUntil: string }
  | { outcome: "not_found" }
  | { outcome: "pipeline_mismatch" }
  | { outcome: "not_open"; leadId: string }
  | { outcome: "version_conflict"; leadId: string; currentVersion: number }
  | { outcome: "absorbed_converted" }
  | { outcome: "absorbed_is_survivor" };

export async function mergeLeads(
  tx: Sql,
  tenantId: string,
  actor: string,
  input: MergeInput,
  undoHours: number,
  emit: EmitContext
): Promise<MergeResult> {
  const survivorProbe = await readLead(tx, tenantId, input.survivorLeadId);
  const absorbedProbe = await readLead(tx, tenantId, input.absorbedLeadId);

  // Another tenant's lead is invisible under RLS: it answers exactly like an
  // id that does not exist, so a cross-tenant merge is refused (T-I1).
  if (!survivorProbe || !absorbedProbe) return { outcome: "not_found" };

  if (survivorProbe.pipelineId !== absorbedProbe.pipelineId) {
    return { outcome: "pipeline_mismatch" };
  }

  await tx`
    SELECT 1 FROM awcms_crm_pipelines
    WHERE tenant_id = ${tenantId} AND id = ${survivorProbe.pipelineId}
    FOR SHARE
  `;

  const [firstId, secondId] = [
    input.survivorLeadId,
    input.absorbedLeadId
  ].sort();
  const first = await readLead(tx, tenantId, firstId!, "update");
  const second = await readLead(tx, tenantId, secondId!, "update");
  const survivor = first!.id === input.survivorLeadId ? first! : second!;
  const absorbed = first!.id === input.absorbedLeadId ? first! : second!;

  for (const [lead, expected] of [
    [survivor, input.survivorVersion],
    [absorbed, input.absorbedVersion]
  ] as const) {
    if (lead.deletedAt || lead.status !== "open") {
      return { outcome: "not_open", leadId: lead.id };
    }

    if (lead.version !== expected) {
      return {
        outcome: "version_conflict",
        leadId: lead.id,
        currentVersion: lead.version
      };
    }
  }

  if (absorbed.stageCategory === "converted") {
    return { outcome: "absorbed_converted" };
  }

  const absorbedIsSurvivor = (await tx`
    SELECT 1 AS present FROM awcms_crm_lead_merges
    WHERE tenant_id = ${tenantId} AND survivor_lead_id = ${absorbed.id}
      AND reverted_at IS NULL
    LIMIT 1
  `) as { present: number }[];

  if (absorbedIsSurvivor.length > 0) return { outcome: "absorbed_is_survivor" };

  const contactPoints = (await tx`
    SELECT id FROM awcms_crm_lead_contact_points
    WHERE tenant_id = ${tenantId} AND lead_id = ${absorbed.id}
    ORDER BY id
  `) as { id: string }[];
  const touches = (await tx`
    SELECT id FROM awcms_crm_lead_source_touches
    WHERE tenant_id = ${tenantId} AND lead_id = ${absorbed.id}
    ORDER BY touch_number
  `) as { id: string }[];
  // Ids, stage and version only: never a name or a contact value.
  const snapshot = {
    absorbedVersion: absorbed.version,
    revisionId: absorbed.revisionId,
    stageKey: absorbed.stageKey,
    stageCategory: absorbed.stageCategory,
    ownerTenantUserId: absorbed.ownerTenantUserId,
    contactPointIds: contactPoints.map((row) => row.id),
    touchIds: touches.map((row) => row.id)
  };
  const rows = (await tx`
    INSERT INTO awcms_crm_lead_merges
      (tenant_id, survivor_lead_id, absorbed_lead_id, snapshot, note,
       merged_by, undo_until)
    VALUES (${tenantId}, ${survivor.id}, ${absorbed.id}, ${snapshot},
            ${input.note}, ${actor}, now() + make_interval(hours => ${undoHours}))
    RETURNING id, merged_at, undo_until
  `) as { id: string; merged_at: Date; undo_until: Date }[];
  const merge = rows[0]!;

  await tx`
    UPDATE awcms_crm_leads
    SET status = 'merged', merged_into_lead_id = ${survivor.id},
        version = version + 1, updated_at = now(), updated_by = ${actor}
    WHERE tenant_id = ${tenantId} AND id = ${absorbed.id}
  `;
  await tx`
    UPDATE awcms_crm_leads
    SET version = version + 1, updated_at = now(), updated_by = ${actor}
    WHERE tenant_id = ${tenantId} AND id = ${survivor.id}
  `;
  await appendLeadTransition(tx, tenantId, emit, {
    leadId: absorbed.id,
    kind: "merged_away",
    pipelineId: absorbed.pipelineId,
    revisionId: absorbed.revisionId,
    fromStageKey: absorbed.stageKey,
    fromCategory: absorbed.stageCategory,
    toStageKey: absorbed.stageKey,
    toCategory: absorbed.stageCategory,
    reason: null,
    actor,
    occurredAt: merge.merged_at,
    idempotencyKey: emit.idempotencyKey ?? null
  });
  await emitLeadEvent(tx, tenantId, emit, {
    eventType: CRM_LEAD_MERGED_EVENT_TYPE,
    aggregateId: survivor.id,
    payload: buildLeadMergedPayload({
      mergeId: merge.id,
      survivorLeadId: survivor.id,
      absorbedLeadId: absorbed.id,
      mergedAt: merge.merged_at,
      undoUntil: merge.undo_until
    })
  });

  return {
    outcome: "merged",
    mergeId: merge.id,
    undoUntil: merge.undo_until.toISOString()
  };
}

export type RevertMergeResult =
  | { outcome: "reverted"; survivorLeadId: string; absorbedLeadId: string }
  | { outcome: "not_found" }
  | { outcome: "already_reverted" }
  | { outcome: "undo_window_closed" }
  | { outcome: "absorbed_changed" };

export async function revertMerge(
  tx: Sql,
  tenantId: string,
  actor: string,
  mergeId: string,
  emit: EmitContext
): Promise<RevertMergeResult> {
  const probe = (await tx`
    SELECT survivor_lead_id, absorbed_lead_id
    FROM awcms_crm_lead_merges
    WHERE tenant_id = ${tenantId} AND id = ${mergeId}
  `) as { survivor_lead_id: string; absorbed_lead_id: string }[];

  if (!probe[0]) return { outcome: "not_found" };

  const absorbedProbe = await readLead(tx, tenantId, probe[0].absorbed_lead_id);

  await tx`
    SELECT 1 FROM awcms_crm_pipelines
    WHERE tenant_id = ${tenantId} AND id = ${absorbedProbe!.pipelineId}
    FOR SHARE
  `;

  const [firstId, secondId] = [
    probe[0].survivor_lead_id,
    probe[0].absorbed_lead_id
  ].sort();

  await readLead(tx, tenantId, firstId!, "update");
  await readLead(tx, tenantId, secondId!, "update");

  const rows = (await tx`
    SELECT survivor_lead_id, absorbed_lead_id, reverted_at,
           (undo_until > now()) AS within_window
    FROM awcms_crm_lead_merges
    WHERE tenant_id = ${tenantId} AND id = ${mergeId}
    FOR UPDATE
  `) as {
    survivor_lead_id: string;
    absorbed_lead_id: string;
    reverted_at: Date | null;
    within_window: boolean;
  }[];
  const merge = rows[0]!;

  if (merge.reverted_at) return { outcome: "already_reverted" };
  if (!merge.within_window) return { outcome: "undo_window_closed" };

  const absorbed = (await readLead(tx, tenantId, merge.absorbed_lead_id))!;

  if (
    absorbed.status !== "merged" ||
    absorbed.mergedIntoLeadId !== merge.survivor_lead_id
  ) {
    return { outcome: "absorbed_changed" };
  }

  await tx`
    UPDATE awcms_crm_lead_merges
    SET reverted_at = now(), reverted_by = ${actor}
    WHERE tenant_id = ${tenantId} AND id = ${mergeId}
  `;
  await tx`
    UPDATE awcms_crm_leads
    SET status = 'open', merged_into_lead_id = NULL,
        version = version + 1, updated_at = now(), updated_by = ${actor}
    WHERE tenant_id = ${tenantId} AND id = ${absorbed.id}
  `;
  await tx`
    UPDATE awcms_crm_leads
    SET version = version + 1, updated_at = now(), updated_by = ${actor}
    WHERE tenant_id = ${tenantId} AND id = ${merge.survivor_lead_id}
  `;
  await appendLeadTransition(tx, tenantId, emit, {
    leadId: absorbed.id,
    kind: "merge_reverted",
    pipelineId: absorbed.pipelineId,
    revisionId: absorbed.revisionId,
    fromStageKey: absorbed.stageKey,
    fromCategory: absorbed.stageCategory,
    toStageKey: absorbed.stageKey,
    toCategory: absorbed.stageCategory,
    reason: null,
    actor,
    occurredAt: new Date(),
    idempotencyKey: emit.idempotencyKey ?? null
  });
  await emitLeadEvent(tx, tenantId, emit, {
    eventType: CRM_LEAD_MERGE_REVERTED_EVENT_TYPE,
    aggregateId: merge.survivor_lead_id,
    payload: buildLeadMergeRevertedPayload({
      mergeId,
      survivorLeadId: merge.survivor_lead_id,
      absorbedLeadId: absorbed.id,
      revertedAt: new Date()
    })
  });

  return {
    outcome: "reverted",
    survivorLeadId: merge.survivor_lead_id,
    absorbedLeadId: absorbed.id
  };
}
