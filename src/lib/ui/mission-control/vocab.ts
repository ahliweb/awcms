/**
 * Shared, presentation-only vocabulary for the 3D Mission Control workspace
 * (Issue ahliweb/omes#265, ADR-0031): which zone a kind is drawn in, which
 * source feeds it, and which existing `.admin-status-pill` tone a visual state
 * borrows. Imported by BOTH the SSR page and the browser modules so the
 * server-rendered list and the client re-render can never drift apart.
 *
 * `tests/mission-control-layout.test.ts` pins `KIND_ZONE`/`KIND_SOURCE` against
 * the vendored source map — this file is a presentation lookup, never an
 * authority.
 */
import type {
  MissionControlKind,
  MissionControlSceneView,
  MissionControlSourceKind,
  MissionControlVisualState,
  MissionControlZone
} from "../../../modules/omes-control/domain/mission-control-types";

export const KIND_ZONE: Readonly<
  Record<MissionControlKind, MissionControlZone>
> = {
  server: "infrastructure",
  deployment: "infrastructure",
  health_report: "infrastructure",
  backup: "infrastructure",
  job: "operations",
  hermes_subagent: "agents",
  approval_item: "governance",
  architecture_plane: "architecture",
  capability: "architecture",
  repository_milestone: "repository",
  ai_privacy_posture: "ai_privacy"
};

export const KIND_SOURCE: Readonly<
  Record<MissionControlKind, MissionControlSourceKind>
> = {
  server: "omes_server_inventory",
  deployment: "omes_deployment_view",
  job: "omes_job_status",
  health_report: "omes_health_readiness",
  backup: "omes_backup_status",
  hermes_subagent: "hermes_orchestration_tree",
  architecture_plane: "omes_architecture_capabilities_view",
  capability: "omes_architecture_capabilities_view",
  repository_milestone: "github_repository_progress_view",
  ai_privacy_posture: "omes_ai_privacy_posture_view",
  approval_item: "awcms_workflow_approval"
};

/**
 * Stale and unknown are deliberately neutral — never `success` — and the pill
 * text always names the state, so colour is never the only signal (WCAG 1.4.1).
 */
export const VISUAL_STATE_TONE: Readonly<
  Record<MissionControlVisualState, string>
> = {
  ok: "success",
  in_progress: "primary",
  pending: "info",
  warning: "warning",
  failed: "danger",
  cancelled: "neutral",
  informational: "neutral",
  stale: "neutral",
  unknown: "neutral"
};

/** A detail route is an app-relative path; anything else gets no link. */
export function isSafeDetailRoute(route: unknown): route is string {
  return (
    typeof route === "string" &&
    route.startsWith("/") &&
    !route.startsWith("//") &&
    !route.includes("\\")
  );
}

/** Stable identity of a scene object across refreshes (`node_id` is not). */
export function nodeKey(kind: string, sourceId: string): string {
  return `${kind}\u0000${sourceId}`;
}

/**
 * The client-side "refresh failed" downgrade (ahliweb/omes#265: "failure to
 * refresh retains last-known data as stale"). Once the browser has missed a
 * refresh window it can no longer vouch that anything is current, so the
 * retained scene is re-labelled with the SAME rule the source map applies to
 * a stale source (OMES ADR-0031): `failed`/`warning` are kept — a last-known
 * problem never disappears — `unknown` stays unknown, and everything else
 * (including `ok`) becomes `stale`. Sources that were `available` become
 * `stale`. Pure: returns a new scene and never touches the input.
 */
export function ageOutScene(
  scene: MissionControlSceneView
): MissionControlSceneView {
  return {
    ...scene,
    sources: scene.sources.map((source) =>
      source.status === "available"
        ? { ...source, status: "stale" as const }
        : source
    ),
    nodes: scene.nodes.map((node) => {
      if (node.freshness === "unknown") return node;
      const kept =
        node.visual_state === "failed" ||
        node.visual_state === "warning" ||
        node.visual_state === "unknown";
      return {
        ...node,
        freshness: "stale" as const,
        visual_state: kept ? node.visual_state : "stale"
      };
    })
  };
}

/** `<tag class>` with optional `textContent` — shared by the controller, replay and actions chunks. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Fills `{placeholder}`s of a translated template; values are plain strings. */
export function fill(
  template: string | undefined,
  values: Record<string, string>
): string {
  return Object.entries(values).reduce(
    (text, [k, v]) => text.replace(`{${k}}`, v),
    template ?? ""
  );
}
