/**
 * Hermes delegated-task / subagent orchestration observability domain logic
 * (Issue ahliweb/omes#246, OMES issue #183, ADR-0028, ADR-0017).
 *
 * ADR-0017 boundary: Hermes owns orchestration; this module is a pure,
 * side-effect-free projection of state an enrolled OMES pull worker
 * reports — it never decides anything about delegation, never infers a
 * completion Hermes did not itself report, and treats every identifier
 * (`session_id`, `subagent_id`, `turn_id`, ...) as opaque.
 *
 * Mirrors `domain/ai-privacy.ts`'s "recompute, do not merely echo"
 * discipline: `classifyOrchestrationFreshness`/`projectOrchestrationTree`
 * are this module's own SECOND, INDEPENDENT recomputation of freshness and
 * node-state rollups from the stored tree at READ time — never a simple
 * trust of a `freshness`/`active_count`/... value a producer sent at
 * ingest time. A process restart or missing terminal event must reconcile
 * to stale/unknown, never invented completion (issue #183's own
 * requirement) — this module is the one place that decides that.
 *
 * Both `classifyOrchestrationFreshness` and `projectOrchestrationTree` are
 * pure functions of their inputs — no I/O, no database access — so they can
 * be exercised directly by unit tests without a database.
 */
import { findDisallowedEvidenceKeys } from "./ai-privacy";

export { findDisallowedEvidenceKeys };

export const ORCHESTRATION_STATES = [
  "PENDING",
  "STARTING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "INTERRUPTED",
  "CANCELLED",
  "UNKNOWN"
] as const;
export type OrchestrationState = (typeof ORCHESTRATION_STATES)[number];

export const ORCHESTRATION_EVENT_TYPES = [
  "subagent_start",
  "subagent_stop",
  "subagent_step",
  "batch_start",
  "batch_stop"
] as const;
export type OrchestrationEventType = (typeof ORCHESTRATION_EVENT_TYPES)[number];

export const ORCHESTRATION_FRESHNESS = ["live", "stale", "unknown"] as const;
export type OrchestrationFreshness = (typeof ORCHESTRATION_FRESHNESS)[number];

/**
 * Default staleness window for a live orchestration tree snapshot. Much
 * shorter than `ai-privacy.ts`'s 24-hour evidence window: this is meant to
 * reflect a currently-running delegation, not durable compliance evidence,
 * so a snapshot that has not been refreshed in two minutes is already
 * unreliable for an operator watching it "live" — issue #183 explicitly
 * requires "never show a child as successfully completed solely because a
 * connection closed, timeout occurred, or the UI stopped receiving events."
 */
export const DEFAULT_TREE_FRESHNESS_WINDOW_SECONDS = 120;

function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Bounded live/stale/unknown classification. A missing/unparsable timestamp
 * or a timestamp in the future (clock/producer problem) is always
 * `"unknown"` — NEVER `"live"`. Stale or unknown evidence must never be
 * treated as actively running by any caller.
 */
export function classifyOrchestrationFreshness(
  generatedAt: string | null | undefined,
  now: Date,
  maxAgeSeconds: number = DEFAULT_TREE_FRESHNESS_WINDOW_SECONDS
): OrchestrationFreshness {
  const ts = parseTimestamp(generatedAt);
  if (!ts) return "unknown";
  const ageSeconds = (now.getTime() - ts.getTime()) / 1000;
  if (ageSeconds < 0) return "unknown";
  return ageSeconds > maxAgeSeconds ? "stale" : "live";
}

export type StoredOrchestrationNode = {
  subagentId: string;
  parentSubagentId: string | null;
  role: string | null;
  goal: string | null;
  state: string;
  startedAt: string | null;
  completedAt: string | null;
  durationSeconds: number | null;
  activeTool: string | null;
  stepCount: number | null;
  summary: string | null;
  children: string[];
};

export type ProjectedOrchestrationNode = StoredOrchestrationNode & {
  /** Recomputed here from ORCHESTRATION_STATES — an unrecognized stored state renders as "UNKNOWN", never silently as something healthier. */
  effectiveState: OrchestrationState;
  /** BFS depth from the tree's root node (root = 0). -1 when unreachable from the declared root (orphaned/cyclic — rendered, never hidden, but flagged). */
  depth: number;
  /**
   * True whenever the node's OWN tree snapshot is not `"live"` (i.e. its
   * `freshness` is `"stale"` or `"unknown"`). A renderer must treat this the
   * same way it treats `freshness` itself: never paint `effectiveState` with
   * a live status color when this is true, and prefer a "last reported: X"
   * label over the bare state — the last-reported state is real evidence,
   * but it is NOT a claim that the node is currently in that state (issue
   * #183: a stalled connection or missing terminal event must never render
   * as healthy/live).
   */
  isHistorical: boolean;
};

export type StoredOrchestrationTree = {
  serverId: string;
  sessionId: string;
  rootSubagentId: string;
  generatedAt: string;
  activeCount: number;
  completedCount: number;
  failedCount: number;
  nodes: StoredOrchestrationNode[];
  correlationId: string;
  receivedAt: string;
};

export type ProjectedOrchestrationTree = {
  serverId: string;
  sessionId: string;
  rootSubagentId: string;
  generatedAt: string;
  correlationId: string;
  receivedAt: string;
  /** Recomputed at READ time from `generatedAt` vs. `now` — never merely echoed from storage. */
  freshness: OrchestrationFreshness;
  /**
   * Recomputed from `nodes[].state` at read time — never the stored
   * active/completed/failed counts alone, so a count that has drifted from
   * the actual node states (e.g. a partial/corrupt delivery) is never
   * silently trusted.
   */
  activeCount: number;
  completedCount: number;
  failedCount: number;
  unknownCount: number;
  nodes: ProjectedOrchestrationNode[];
  /** True only when freshness is "live" AND there is at least one node whose effective state is still active (PENDING/STARTING/RUNNING). */
  isActive: boolean;
};

function recognizedState(state: string): OrchestrationState {
  return (ORCHESTRATION_STATES as readonly string[]).includes(state)
    ? (state as OrchestrationState)
    : "UNKNOWN";
}

const ACTIVE_STATES: ReadonlySet<OrchestrationState> = new Set([
  "PENDING",
  "STARTING",
  "RUNNING"
]);
const FAILED_STATES: ReadonlySet<OrchestrationState> = new Set([
  "FAILED",
  "INTERRUPTED",
  "CANCELLED"
]);

/** BFS depth of every node from `rootSubagentId`, keyed by subagentId. Unreachable nodes are omitted (caller defaults them to -1). */
function computeDepths(
  nodes: StoredOrchestrationNode[],
  rootSubagentId: string
): Map<string, number> {
  const byId = new Map(nodes.map((node) => [node.subagentId, node]));
  const depths = new Map<string, number>();

  if (!byId.has(rootSubagentId)) return depths;

  depths.set(rootSubagentId, 0);
  const queue: string[] = [rootSubagentId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const current = byId.get(currentId);
    const currentDepth = depths.get(currentId)!;
    if (!current) continue;

    for (const childId of current.children) {
      if (depths.has(childId)) continue;
      depths.set(childId, currentDepth + 1);
      queue.push(childId);
    }
  }

  return depths;
}

/**
 * Recomputes freshness/state rollups/depths for one stored tree snapshot
 * against `now`. This is the ONE place that decides whether a tree renders
 * as live — never a page template reading the stored `generated_at`/
 * `active_count` columns directly.
 */
export function projectOrchestrationTree(
  stored: StoredOrchestrationTree,
  now: Date,
  maxAgeSeconds: number = DEFAULT_TREE_FRESHNESS_WINDOW_SECONDS
): ProjectedOrchestrationTree {
  const freshness = classifyOrchestrationFreshness(
    stored.generatedAt,
    now,
    maxAgeSeconds
  );
  const depths = computeDepths(stored.nodes, stored.rootSubagentId);

  let activeCount = 0;
  let completedCount = 0;
  let failedCount = 0;
  let unknownCount = 0;

  const nodes: ProjectedOrchestrationNode[] = stored.nodes.map((node) => {
    const effectiveState = recognizedState(node.state);
    if (ACTIVE_STATES.has(effectiveState)) activeCount += 1;
    else if (effectiveState === "SUCCEEDED") completedCount += 1;
    else if (FAILED_STATES.has(effectiveState)) failedCount += 1;
    else unknownCount += 1;

    return {
      ...node,
      effectiveState,
      depth: depths.get(node.subagentId) ?? -1,
      isHistorical: freshness !== "live"
    };
  });

  return {
    serverId: stored.serverId,
    sessionId: stored.sessionId,
    rootSubagentId: stored.rootSubagentId,
    generatedAt: stored.generatedAt,
    correlationId: stored.correlationId,
    receivedAt: stored.receivedAt,
    freshness,
    activeCount,
    completedCount,
    failedCount,
    unknownCount,
    nodes,
    isActive: freshness === "live" && activeCount > 0
  };
}

export type StoredOrchestrationEvent = {
  id: string;
  eventType: string;
  serverId: string;
  sessionId: string;
  turnId: string | null;
  subagentId: string;
  parentSubagentId: string | null;
  role: string | null;
  goal: string | null;
  state: string;
  stepNumber: number | null;
  activeTool: string | null;
  summary: string | null;
  hermesVersion: string;
  eventTimestamp: string;
  correlationId: string;
  receivedAt: string;
};

export type ProjectedOrchestrationEvent = StoredOrchestrationEvent & {
  effectiveState: OrchestrationState;
  effectiveEventType: OrchestrationEventType | "UNKNOWN";
  /**
   * The freshness, at READ time, of the tree snapshot for this event's own
   * `sessionId` — never the event's own (always-present) `eventTimestamp`,
   * which only says the event itself is real history, not whether the
   * session it belongs to is still live. Defaults to `"unknown"` (the safe,
   * never-live default) when the caller has no snapshot freshness to pass —
   * an activity row must never be painted as live by omission.
   */
  sessionFreshness: OrchestrationFreshness;
  /** `true` whenever `sessionFreshness !== "live"` — every event row for a
   * stale/unknown session renders as historical, never with live-state
   * coloring, even though the row's own timestamp never changes. */
  isHistorical: boolean;
};

/**
 * Recomputes the effective (recognized) state/event-type for one
 * activity-stream row, and stamps it with `sessionFreshness` — the freshness
 * of its OWN session's current tree snapshot, recomputed by the caller (see
 * `application/hermes-orchestration-directory.ts`) — so a renderer can tell
 * a live event apart from a historical one without joining anything itself.
 */
export function projectOrchestrationEvent(
  stored: StoredOrchestrationEvent,
  sessionFreshness: OrchestrationFreshness = "unknown"
): ProjectedOrchestrationEvent {
  return {
    ...stored,
    effectiveState: recognizedState(stored.state),
    effectiveEventType: (
      ORCHESTRATION_EVENT_TYPES as readonly string[]
    ).includes(stored.eventType)
      ? (stored.eventType as OrchestrationEventType)
      : "UNKNOWN",
    sessionFreshness,
    isHistorical: sessionFreshness !== "live"
  };
}
