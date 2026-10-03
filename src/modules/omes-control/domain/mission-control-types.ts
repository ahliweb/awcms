/**
 * Wire types for the OMES 3D Mission Control workspace (Issue
 * ahliweb/omes#265, epic ahliweb/omes#263; contract ahliweb/omes#264,
 * ADR-0031).
 *
 * These mirror the vendored, SHA-256-pinned OMES contracts
 * `contracts/v1/mission-control-scene-view.schema.json` and
 * `contracts/v1/mission-control-replay-window.schema.json` field for field.
 * They are a TYPE view only — the schemas, validated at composition time,
 * remain the authority on shape. Mission Control is a derived presentation
 * composition, never an authority: every node is a reference
 * (`kind` + opaque `sourceId`) to a record an existing screen already owns.
 *
 * Shared by the server composition (`domain/mission-control.ts`,
 * `application/mission-control-directory.ts`) and the browser renderer
 * (`src/lib/ui/mission-control/*`) — type-only imports, erased at build.
 */

export const MISSION_CONTROL_KINDS = [
  "server",
  "deployment",
  "job",
  "health_report",
  "backup",
  "hermes_subagent",
  "architecture_plane",
  "capability",
  "repository_milestone",
  "ai_privacy_posture",
  "approval_item"
] as const;
export type MissionControlKind = (typeof MISSION_CONTROL_KINDS)[number];

export const MISSION_CONTROL_SOURCE_KINDS = [
  "omes_server_inventory",
  "omes_deployment_view",
  "omes_job_status",
  "omes_health_readiness",
  "omes_backup_status",
  "hermes_orchestration_tree",
  "omes_architecture_capabilities_view",
  "github_repository_progress_view",
  "omes_ai_privacy_posture_view",
  "awcms_workflow_approval"
] as const;
export type MissionControlSourceKind =
  (typeof MISSION_CONTROL_SOURCE_KINDS)[number];

export const MISSION_CONTROL_VISUAL_STATES = [
  "ok",
  "in_progress",
  "pending",
  "warning",
  "failed",
  "cancelled",
  "informational",
  "stale",
  "unknown"
] as const;
export type MissionControlVisualState =
  (typeof MISSION_CONTROL_VISUAL_STATES)[number];

export type MissionControlFreshness = "live" | "stale" | "unknown";

export const MISSION_CONTROL_RELATIONS = [
  "hosts",
  "targets",
  "delegates_to",
  "observed_on",
  "describes",
  "protects",
  "member_of",
  "awaits_decision_for"
] as const;
export type MissionControlRelationType =
  (typeof MISSION_CONTROL_RELATIONS)[number];

export const MISSION_CONTROL_ZONES = [
  "agents",
  "infrastructure",
  "operations",
  "governance",
  "architecture",
  "repository",
  "ai_privacy"
] as const;
export type MissionControlZone = (typeof MISSION_CONTROL_ZONES)[number];

/** Wire shape — snake_case, exactly as the scene-view schema defines it. */
export type MissionControlSceneSource = {
  source_kind: MissionControlSourceKind;
  authority: "omes" | "hermes" | "awcms" | "provider";
  status: "available" | "stale" | "unavailable";
  observed_at: string | null;
};

export type MissionControlSceneNode = {
  /** Opaque, response-local handle (`n1`, `n2`, ...). Never parse it. */
  node_id: string;
  kind: MissionControlKind;
  /** The owning authority's own opaque identifier, echoed verbatim. */
  source_id: string;
  /** UNTRUSTED display text — textContent only, never innerHTML. */
  label: string;
  source_state: string;
  visual_state: MissionControlVisualState;
  freshness: MissionControlFreshness;
  observed_at: string | null;
  detail_route: string;
  /** UNTRUSTED display text — textContent only, never innerHTML. */
  summary?: string;
};

export type MissionControlSceneRelation = {
  from: string;
  to: string;
  relation: MissionControlRelationType;
};

export type MissionControlEvidenceGap = {
  source_kind: string;
  from: string;
  to: string;
  reason:
    | "not_retained"
    | "retention_expired"
    | "source_unavailable"
    | "before_first_observation";
};

export type MissionControlSceneView = {
  schema_version: "1.0.0";
  source_map_version: "1.0.0";
  tenant_id: string;
  generated_at: string;
  mode: "live" | "historical";
  as_of: string;
  sources: MissionControlSceneSource[];
  nodes: MissionControlSceneNode[];
  relations: MissionControlSceneRelation[];
  truncated: { nodes: number; relations: number };
  evidence_gaps?: MissionControlEvidenceGap[];
};

export type MissionControlReplayEvent = {
  at: string;
  evidence_kind:
    | "hermes_event"
    | "health_snapshot"
    | "backup_snapshot"
    | "job_record"
    | "worker_result"
    | "audit_projection"
    | "workflow_decision";
  evidence_id: string;
  kind: MissionControlKind;
  source_id: string;
  parent_source_id?: string | null;
  source_state: string;
  visual_state: MissionControlVisualState;
  provenance: "observed" | "late_arrival";
  correlation_id?: string | null;
};

export type MissionControlReplayWindow = {
  schema_version: "1.0.0";
  source_map_version: "1.0.0";
  tenant_id: string;
  generated_at: string;
  window: { from: string; to: string };
  events: MissionControlReplayEvent[];
  evidence_gaps: MissionControlEvidenceGap[];
  next_cursor: string | null;
};

/** Hard bounds from the scene-view schema (`maxItems`). */
export const MISSION_CONTROL_MAX_NODES = 500;
export const MISSION_CONTROL_MAX_RELATIONS = 1000;
/** Hard bound from the replay-window schema (`events.maxItems`). */
export const MISSION_CONTROL_MAX_REPLAY_EVENTS = 500;

/** The one route this workspace adds (source map `workspace.route`). */
export const MISSION_CONTROL_ROUTE = "/admin/omes/mission-control";
/** The scene API both the SSR page and the browser poll consume. */
export const MISSION_CONTROL_SCENE_API = "/api/v1/omes/mission-control/scene";
/** The bounded, keyset-paginated replay API (Issue ahliweb/omes#266). */
export const MISSION_CONTROL_REPLAY_API = "/api/v1/omes/mission-control/replay";
/** The advisory per-object action availability API (Issue ahliweb/omes#267). */
export const MISSION_CONTROL_ACTIONS_API =
  "/api/v1/omes/mission-control/actions";
