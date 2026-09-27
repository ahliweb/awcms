/**
 * `POST /api/v1/omes/worker/hermes-orchestration-tree` and
 * `POST /api/v1/omes/worker/hermes-orchestration-event` ingestion (Issue
 * ahliweb/omes#246, OMES issue #183, ADR-0028).
 *
 * Worker-identity-authenticated (same envelope-guard shape as
 * `ai-privacy-ingestion.ts`) delivery of OMES-produced
 * `hermes-orchestration-tree`/`hermes-orchestration-event` projections. The
 * route handlers validate the raw request body against the vendored JSON
 * Schemas BEFORE either function here is ever called —
 * `additionalProperties: false` throughout both schemas makes a
 * prompt/transcript/chain-of-thought/raw-tool-argument field structurally
 * impossible to pass validation. `findDisallowedEvidenceKeys` (reused as-is
 * from `domain/ai-privacy.ts` via `domain/hermes-orchestration.ts`) is a
 * second, independent runtime check on top of that.
 *
 * `ingestOrchestrationTree` upserts one row per (tenant, server, session) —
 * a new snapshot for the same session REPLACES the prior one, matching the
 * wire contract's own framing as a live, current-state projection.
 * `ingestOrchestrationEvent` inserts into the append-only activity log,
 * `ON CONFLICT DO NOTHING` on the natural dedupe key — a redelivered event
 * (the pull worker's outbox is at-least-once) is a no-op, never a duplicate
 * row, and never an error either.
 */
import { findDisallowedEvidenceKeys } from "../domain/hermes-orchestration";

export type OrchestrationNodeIngestInput = {
  subagentId: string;
  parentSubagentId?: string | null;
  role?: string;
  goal?: string;
  state: string;
  startedAt: string;
  completedAt?: string | null;
  durationSeconds?: number;
  activeTool?: string;
  stepCount?: number;
  summary?: string;
  children: string[];
};

export type OrchestrationTreeIngestInput = {
  tenantId: string;
  correlationId: string;
  serverId: string;
  sessionId: string;
  rootSubagentId: string;
  generatedAt: string;
  activeCount: number;
  completedCount: number;
  failedCount: number;
  nodes: OrchestrationNodeIngestInput[];
};

export type IngestOrchestrationTreeOutcome =
  | { outcome: "ingested"; id: string }
  | { outcome: "rejected_disallowed_field"; fields: string[] };

export async function ingestOrchestrationTree(
  tx: Bun.SQL,
  input: OrchestrationTreeIngestInput
): Promise<IngestOrchestrationTreeOutcome> {
  const disallowed = findDisallowedEvidenceKeys(input.nodes);

  if (disallowed.length > 0) {
    return { outcome: "rejected_disallowed_field", fields: disallowed };
  }

  const nodesJson = input.nodes.map((node) => ({
    subagent_id: node.subagentId,
    parent_subagent_id: node.parentSubagentId ?? null,
    role: node.role ?? null,
    goal: node.goal ?? null,
    state: node.state,
    started_at: node.startedAt,
    completed_at: node.completedAt ?? null,
    duration_seconds: node.durationSeconds ?? null,
    active_tool: node.activeTool ?? null,
    step_count: node.stepCount ?? null,
    summary: node.summary ?? null,
    children: node.children
  }));

  const rows = (await tx`
    INSERT INTO awcms_omes_hermes_orchestration_trees (
      tenant_id, server_id, session_id, root_subagent_id, generated_at,
      active_count, completed_count, failed_count, nodes, correlation_id,
      received_at
    ) VALUES (
      ${input.tenantId}, ${input.serverId}, ${input.sessionId},
      ${input.rootSubagentId}, ${input.generatedAt}, ${input.activeCount},
      ${input.completedCount}, ${input.failedCount}, ${nodesJson}::jsonb,
      ${input.correlationId}, now()
    )
    ON CONFLICT (tenant_id, server_id, session_id)
    DO UPDATE SET
      root_subagent_id = EXCLUDED.root_subagent_id,
      generated_at = EXCLUDED.generated_at,
      active_count = EXCLUDED.active_count,
      completed_count = EXCLUDED.completed_count,
      failed_count = EXCLUDED.failed_count,
      nodes = EXCLUDED.nodes,
      correlation_id = EXCLUDED.correlation_id,
      received_at = now(),
      updated_at = now()
    RETURNING id
  `) as { id: string }[];

  return { outcome: "ingested", id: rows[0]!.id };
}

export type OrchestrationEventIngestInput = {
  tenantId: string;
  correlationId: string;
  eventType: string;
  serverId: string;
  sessionId: string;
  turnId?: string;
  subagentId: string;
  parentSubagentId?: string | null;
  role?: string;
  goal?: string;
  state: string;
  stepNumber?: number;
  activeTool?: string;
  summary?: string;
  hermesVersion: string;
  eventTimestamp: string;
};

export type IngestOrchestrationEventOutcome =
  | { outcome: "ingested"; id: string }
  | { outcome: "duplicate" }
  | { outcome: "rejected_disallowed_field"; fields: string[] };

export async function ingestOrchestrationEvent(
  tx: Bun.SQL,
  input: OrchestrationEventIngestInput
): Promise<IngestOrchestrationEventOutcome> {
  const disallowed = findDisallowedEvidenceKeys({
    goal: input.goal,
    summary: input.summary
  });

  if (disallowed.length > 0) {
    return { outcome: "rejected_disallowed_field", fields: disallowed };
  }

  const rows = (await tx`
    INSERT INTO awcms_omes_hermes_orchestration_events (
      tenant_id, server_id, session_id, turn_id, subagent_id,
      parent_subagent_id, event_type, role, goal, state, step_number,
      active_tool, summary, hermes_version, event_timestamp, correlation_id,
      received_at
    ) VALUES (
      ${input.tenantId}, ${input.serverId}, ${input.sessionId},
      ${input.turnId ?? null}, ${input.subagentId},
      ${input.parentSubagentId ?? null}, ${input.eventType},
      ${input.role ?? null}, ${input.goal ?? null}, ${input.state},
      ${input.stepNumber ?? null}, ${input.activeTool ?? null},
      ${input.summary ?? null}, ${input.hermesVersion},
      ${input.eventTimestamp}, ${input.correlationId}, now()
    )
    ON CONFLICT (tenant_id, server_id, session_id, subagent_id, event_type, COALESCE(step_number, -1))
    DO NOTHING
    RETURNING id
  `) as { id: string }[];

  if (rows.length === 0) {
    return { outcome: "duplicate" };
  }

  return { outcome: "ingested", id: rows[0]!.id };
}
