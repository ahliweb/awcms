/**
 * Read-side queries for `/admin/omes/orkestrasi-langsung`,
 * `/admin/omes/hermes`, and `GET /api/v1/omes/hermes-orchestration/{tree,
 * events}` (Issue ahliweb/omes#246, OMES issue #183).
 *
 * Every tree row's `freshness`/state rollups are RECOMPUTED here, at read
 * time, via `domain/hermes-orchestration.ts`'s `projectOrchestrationTree` —
 * never read directly off the stored `generated_at`/`active_count`
 * columns. This is the same "second independent backstop" discipline
 * `ai-privacy-directory.ts` documents: a snapshot that has gone stale, or
 * whose stored counts have drifted from its actual node states, must never
 * render as live/healthy.
 */
import {
  classifyOrchestrationFreshness,
  projectOrchestrationEvent,
  projectOrchestrationTree,
  type OrchestrationFreshness,
  type ProjectedOrchestrationEvent,
  type ProjectedOrchestrationTree,
  type StoredOrchestrationNode
} from "../domain/hermes-orchestration";

type TreeRow = {
  id: string;
  server_id: string;
  session_id: string;
  root_subagent_id: string;
  generated_at: Date;
  active_count: number;
  completed_count: number;
  failed_count: number;
  nodes: Record<string, unknown>[];
  correlation_id: string;
  received_at: Date;
};

function toStoredNode(raw: Record<string, unknown>): StoredOrchestrationNode {
  return {
    subagentId: String(raw.subagent_id ?? ""),
    parentSubagentId:
      typeof raw.parent_subagent_id === "string"
        ? raw.parent_subagent_id
        : null,
    role: typeof raw.role === "string" ? raw.role : null,
    goal: typeof raw.goal === "string" ? raw.goal : null,
    state: String(raw.state ?? "UNKNOWN"),
    startedAt: typeof raw.started_at === "string" ? raw.started_at : null,
    completedAt: typeof raw.completed_at === "string" ? raw.completed_at : null,
    durationSeconds:
      typeof raw.duration_seconds === "number" ? raw.duration_seconds : null,
    activeTool: typeof raw.active_tool === "string" ? raw.active_tool : null,
    stepCount: typeof raw.step_count === "number" ? raw.step_count : null,
    summary: typeof raw.summary === "string" ? raw.summary : null,
    children: Array.isArray(raw.children)
      ? (raw.children as unknown[]).filter(
          (child): child is string => typeof child === "string"
        )
      : []
  };
}

export type OrchestrationTreeSummary = ProjectedOrchestrationTree & {
  id: string;
};

export const HERMES_ORCHESTRATION_TREE_LIST_LIMIT = 100;

function toTreeSummary(row: TreeRow, now: Date): OrchestrationTreeSummary {
  const projected = projectOrchestrationTree(
    {
      serverId: row.server_id,
      sessionId: row.session_id,
      rootSubagentId: row.root_subagent_id,
      generatedAt: row.generated_at.toISOString(),
      activeCount: row.active_count,
      completedCount: row.completed_count,
      failedCount: row.failed_count,
      nodes: (row.nodes ?? []).map(toStoredNode),
      correlationId: row.correlation_id,
      receivedAt: row.received_at.toISOString()
    },
    now
  );

  return { ...projected, id: row.id };
}

/** Every current orchestration-tree snapshot for the tenant's fleet, most recently generated first. */
export async function fetchOrchestrationTrees(
  tx: Bun.SQL,
  tenantId: string,
  now: Date
): Promise<OrchestrationTreeSummary[]> {
  const rows = (await tx`
    SELECT id, server_id, session_id, root_subagent_id, generated_at,
           active_count, completed_count, failed_count, nodes,
           correlation_id, received_at
    FROM awcms_omes_hermes_orchestration_trees
    WHERE tenant_id = ${tenantId}
    ORDER BY generated_at DESC, id DESC
    LIMIT ${HERMES_ORCHESTRATION_TREE_LIST_LIMIT}
  `) as TreeRow[];

  return rows.map((row) => toTreeSummary(row, now));
}

/** One current orchestration-tree snapshot by session id, scoped to the tenant. */
export async function fetchOrchestrationTreeBySession(
  tx: Bun.SQL,
  tenantId: string,
  sessionId: string,
  now: Date
): Promise<OrchestrationTreeSummary | null> {
  const rows = (await tx`
    SELECT id, server_id, session_id, root_subagent_id, generated_at,
           active_count, completed_count, failed_count, nodes,
           correlation_id, received_at
    FROM awcms_omes_hermes_orchestration_trees
    WHERE tenant_id = ${tenantId} AND session_id = ${sessionId}
    LIMIT 1
  `) as TreeRow[];

  return rows.length > 0 ? toTreeSummary(rows[0]!, now) : null;
}

type EventRow = {
  id: string;
  event_type: string;
  server_id: string;
  session_id: string;
  turn_id: string | null;
  subagent_id: string;
  parent_subagent_id: string | null;
  role: string | null;
  goal: string | null;
  state: string;
  step_number: number | null;
  active_tool: string | null;
  summary: string | null;
  hermes_version: string;
  event_timestamp: Date;
  correlation_id: string;
  received_at: Date;
};

function toEventSummary(
  row: EventRow,
  sessionFreshness: OrchestrationFreshness
): ProjectedOrchestrationEvent {
  return projectOrchestrationEvent(
    {
      id: row.id,
      eventType: row.event_type,
      serverId: row.server_id,
      sessionId: row.session_id,
      turnId: row.turn_id,
      subagentId: row.subagent_id,
      parentSubagentId: row.parent_subagent_id,
      role: row.role,
      goal: row.goal,
      state: row.state,
      stepNumber: row.step_number,
      activeTool: row.active_tool,
      summary: row.summary,
      hermesVersion: row.hermes_version,
      eventTimestamp: row.event_timestamp.toISOString(),
      correlationId: row.correlation_id,
      receivedAt: row.received_at.toISOString()
    },
    sessionFreshness
  );
}

export const HERMES_ORCHESTRATION_EVENT_LIST_LIMIT = 200;

/**
 * The tenant's most recent orchestration activity-stream events, optionally
 * scoped to one session, newest first.
 *
 * Each row is stamped with `sessionFreshness`/`isHistorical`, RECOMPUTED
 * here from that event's own session's current tree snapshot (a LEFT JOIN —
 * an event can outlive its tree row, or arrive before one exists) — never
 * merely echoed from a stored flag, and never defaulted to "live" by
 * omission: a session with no matching tree snapshot at all classifies as
 * "unknown" (via `classifyOrchestrationFreshness(null, ...)`), the same
 * fail-closed default `projectOrchestrationEvent` uses. This is what keeps
 * a stale/unknown session's activity rows from rendering with live-state
 * coloring even though every event is, correctly, still shown (timestamped
 * history, never hidden).
 */
export async function fetchOrchestrationEvents(
  tx: Bun.SQL,
  tenantId: string,
  sessionId?: string,
  now: Date = new Date()
): Promise<ProjectedOrchestrationEvent[]> {
  const rows = sessionId
    ? ((await tx`
          SELECT e.id, e.event_type, e.server_id, e.session_id, e.turn_id,
                 e.subagent_id, e.parent_subagent_id, e.role, e.goal,
                 e.state, e.step_number, e.active_tool, e.summary,
                 e.hermes_version, e.event_timestamp, e.correlation_id,
                 e.received_at, t.generated_at AS session_generated_at
          FROM awcms_omes_hermes_orchestration_events e
          LEFT JOIN awcms_omes_hermes_orchestration_trees t
            ON t.tenant_id = e.tenant_id AND t.session_id = e.session_id
          WHERE e.tenant_id = ${tenantId} AND e.session_id = ${sessionId}
          ORDER BY e.event_timestamp DESC, e.id DESC
          LIMIT ${HERMES_ORCHESTRATION_EVENT_LIST_LIMIT}
        `) as (EventRow & { session_generated_at: Date | null })[])
    : ((await tx`
          SELECT e.id, e.event_type, e.server_id, e.session_id, e.turn_id,
                 e.subagent_id, e.parent_subagent_id, e.role, e.goal,
                 e.state, e.step_number, e.active_tool, e.summary,
                 e.hermes_version, e.event_timestamp, e.correlation_id,
                 e.received_at, t.generated_at AS session_generated_at
          FROM awcms_omes_hermes_orchestration_events e
          LEFT JOIN awcms_omes_hermes_orchestration_trees t
            ON t.tenant_id = e.tenant_id AND t.session_id = e.session_id
          WHERE e.tenant_id = ${tenantId}
          ORDER BY e.event_timestamp DESC, e.id DESC
          LIMIT ${HERMES_ORCHESTRATION_EVENT_LIST_LIMIT}
        `) as (EventRow & { session_generated_at: Date | null })[]);

  return rows.map((row) =>
    toEventSummary(
      row,
      classifyOrchestrationFreshness(
        row.session_generated_at?.toISOString() ?? null,
        now
      )
    )
  );
}
