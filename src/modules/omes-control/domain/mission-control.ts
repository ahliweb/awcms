/**
 * Pure composition of the 3D Mission Control scene (Issue
 * ahliweb/omes#265, epic ahliweb/omes#263; contract ahliweb/omes#264,
 * ADR-0031).
 *
 * ## Mission Control is a derived projection, not an authority
 *
 * Every node this module emits is a REFERENCE (`kind` + the owning
 * authority's opaque `source_id`) to a record an existing screen already
 * owns, plus a small bounded label/state/freshness/detail-route envelope. It
 * adds no lifecycle, no store, no layout coordinates, no action availability
 * and no authorization decision (ADR-0031 rule 3). The only mapping logic
 * lives in the vendored, SHA-256-pinned
 * `contracts/v1/mission-control-source-map.json` — this file reads it, it
 * never copies it:
 *
 *  - `deriveVisualState` is the deterministic `(kind, source_state,
 *    freshness) -> visual_state` function the map's `freshness_rule` defines
 *    and OMES guard MC8 re-derives for every checked-in fixture. It mirrors
 *    `derive_visual_state()` in `lib/omes/py/architecture/mission_control.py`
 *    line for line, so the two implementations cannot disagree.
 *  - `composeScene` assembles the `mission-control-scene-view` payload from
 *    ALREADY AUTHORIZED, already tenant-scoped inputs (the application layer,
 *    `application/mission-control-directory.ts`, owns authorization and RLS).
 *    Relations come ONLY from the map's relation vocabulary and ONLY from
 *    evidence fields the inputs actually carry; a relation whose endpoint is
 *    absent is dropped, never invented.
 *
 * ## Untrusted text stays verbatim
 *
 * `label` and `summary` are untrusted display text. This module never
 * strips, escapes or rewrites characters — `<img src=x onerror=alert(1)>` is
 * data, and output encoding is the renderer's job (`textContent` only). The
 * ONLY transformations are length clamps (120 / 280, the schema bounds,
 * counted in UTF-16 units without splitting a surrogate pair) and the
 * `source_id` fallback for an empty label. Nothing here logs label/summary
 * contents.
 *
 * ## Fail closed, never silently shrink
 *
 * A record that cannot be represented (an identifier outside the schema's
 * `source_id` pattern, or text that matches a known secret-value shape) is
 * OMITTED and counted in `truncated.nodes`, so the scene visibly says it is
 * incomplete rather than failing wholesale or leaking the value. The final
 * object is validated against the vendored schema by
 * {@link assertMissionControlSceneValid}; an invalid composition throws
 * {@link MissionControlSceneInvalidError} (generic message — no values).
 */
import {
  assertOmesContract,
  ContractValidationError,
  scanForRawSecrets,
  type JsonValue
} from "./contracts";
import { loadVendoredJsonFileSync } from "./contracts/loader";
import {
  MISSION_CONTROL_KINDS,
  MISSION_CONTROL_MAX_NODES,
  MISSION_CONTROL_MAX_RELATIONS,
  MISSION_CONTROL_RELATIONS,
  MISSION_CONTROL_SOURCE_KINDS,
  type MissionControlFreshness,
  type MissionControlKind,
  type MissionControlRelationType,
  type MissionControlSceneNode,
  type MissionControlSceneRelation,
  type MissionControlSceneSource,
  type MissionControlSceneView,
  type MissionControlSourceKind,
  type MissionControlVisualState
} from "./mission-control-types";

/** Vendored file name — see `contracts/v1/PIN.json`. */
export const MISSION_CONTROL_SOURCE_MAP_FILE =
  "mission-control-source-map.json";
/** Schema name `assertOmesContract` resolves to `mission-control-scene-view.schema.json`. */
export const MISSION_CONTROL_SCENE_SCHEMA = "mission-control-scene-view";
/** The only scene-view / source-map version this module composes (consumers reject any other major). */
export const MISSION_CONTROL_SCHEMA_VERSION = "1.0.0" as const;

/** Schema bounds for `label` / `summary` (`maxLength`). */
export const MISSION_CONTROL_LABEL_MAX = 120;
export const MISSION_CONTROL_SUMMARY_MAX = 280;

/**
 * Job states that are final evidence — they never go stale (source map
 * `omes_job_status.freshness.basis`). Shared by the live composition
 * (`application/mission-control-directory.ts`) and the historical scene
 * (`mission-control-replay.ts`) so the two cannot disagree on what "terminal"
 * means.
 */
export const TERMINAL_JOB_STATES: ReadonlySet<string> = new Set([
  "completed",
  "succeeded",
  "failed",
  "expired",
  "rolled_back",
  "cancelled"
]);

/** Mirrors the schema `source_id` pattern — anything else cannot be represented. */
const SOURCE_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
/** Mirrors the schema `source_state` pattern. */
const SOURCE_STATE_RE = /^[A-Za-z_]{1,32}$/;
const NOT_REPORTED = "not_reported";

// ---------------------------------------------------------------------------
// Source map (typed view of the vendored JSON)
// ---------------------------------------------------------------------------

export type MissionControlReplayBasis =
  "event_log" | "snapshot_series" | "terminal_transitions" | "current_only";

export type MissionControlSourceMapKind = {
  zone: string;
  source: MissionControlSourceKind;
  detail_route: string;
  /** How much history the owning authority retains (source map `replay_bases`; ahliweb/omes#266). */
  replay_basis: MissionControlReplayBasis;
  state_map: Record<string, MissionControlVisualState>;
  projection_state_values: string[];
};

export type MissionControlSourceMapSource = {
  authority: MissionControlSceneSource["authority"];
  freshness: { basis: string; stale_after_seconds: number | null };
  read_permission: string;
};

export type MissionControlSourceMap = {
  source_map_version: typeof MISSION_CONTROL_SCHEMA_VERSION;
  freshness_rule: {
    unknown: MissionControlVisualState;
    stale_keeps: MissionControlVisualState[];
    stale_otherwise: MissionControlVisualState;
    unmapped_state: MissionControlVisualState;
  };
  sources: Record<MissionControlSourceKind, MissionControlSourceMapSource>;
  kinds: Record<MissionControlKind, MissionControlSourceMapKind>;
  relations: Record<
    MissionControlRelationType,
    { from: MissionControlKind[]; to: MissionControlKind[]; evidence: string }
  >;
};

/** Raised when the vendored source map is missing, malformed, or an unknown version. */
export class MissionControlSourceMapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissionControlSourceMapError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

let sourceMapCache: MissionControlSourceMap | undefined;

/**
 * Loads (and caches) the vendored source map, fail closed on an unknown
 * `source_map_version` or a map that does not describe every kind, source
 * and relation this module's types know. The deep consistency checks
 * (state-map completeness against the source contracts, relation endpoints,
 * routes) are OMES guard MC1–MC9's job and run in OMES CI; this is only the
 * minimal shape check that makes the typed view above safe to use.
 */
export function loadMissionControlSourceMap(): MissionControlSourceMap {
  if (sourceMapCache) return sourceMapCache;

  const raw = loadVendoredJsonFileSync(MISSION_CONTROL_SOURCE_MAP_FILE);
  if (!isRecord(raw)) {
    throw new MissionControlSourceMapError("source map is not an object");
  }
  if (raw.source_map_version !== MISSION_CONTROL_SCHEMA_VERSION) {
    throw new MissionControlSourceMapError(
      `unsupported source_map_version (only ${MISSION_CONTROL_SCHEMA_VERSION} is supported)`
    );
  }

  const kinds = raw.kinds;
  const sources = raw.sources;
  const relations = raw.relations;
  const rule = raw.freshness_rule;
  if (
    !isRecord(kinds) ||
    !isRecord(sources) ||
    !isRecord(relations) ||
    !isRecord(rule)
  ) {
    throw new MissionControlSourceMapError("source map is missing a section");
  }
  for (const kind of MISSION_CONTROL_KINDS) {
    if (!isRecord(kinds[kind]) || !isRecord(kinds[kind].state_map)) {
      throw new MissionControlSourceMapError(`kind '${kind}' is not mapped`);
    }
  }
  for (const source of MISSION_CONTROL_SOURCE_KINDS) {
    if (!isRecord(sources[source])) {
      throw new MissionControlSourceMapError(
        `source '${source}' is not mapped`
      );
    }
  }
  for (const relation of MISSION_CONTROL_RELATIONS) {
    if (!isRecord(relations[relation])) {
      throw new MissionControlSourceMapError(
        `relation '${relation}' is not mapped`
      );
    }
  }

  sourceMapCache = raw as unknown as MissionControlSourceMap;
  return sourceMapCache;
}

/** The stale budget (seconds) the map assigns a source; `null` = no time budget. */
export function sourceFreshnessBudgetSeconds(
  sourceKind: MissionControlSourceKind
): number | null {
  return loadMissionControlSourceMap().sources[sourceKind].freshness
    .stale_after_seconds;
}

// ---------------------------------------------------------------------------
// Visual state + freshness
// ---------------------------------------------------------------------------

/**
 * The deterministic `visual_state` for `(kind, sourceState, freshness)`,
 * exactly per the map's `freshness_rule`:
 *
 *  1. `base = state_map[kind][sourceState]`, else `unmapped_state`
 *     (`unknown`) — also for an unknown `kind` (fail closed, never throws).
 *  2. freshness `unknown` -> `unknown`.
 *  3. freshness `stale`   -> `base` when it is `failed`/`warning` (a
 *     last-known problem never disappears), otherwise `stale` (a last-known
 *     success is never shown as current).
 *  4. anything else (`live`)  -> `base`.
 *
 * Own-property lookup only: a hostile `sourceState` such as `constructor`
 * or `__proto__` must not resolve through the prototype chain.
 * Animation never changes the result.
 */
export function deriveVisualState(
  kind: string,
  sourceState: string,
  freshness: MissionControlFreshness | string
): MissionControlVisualState {
  const map = loadMissionControlSourceMap();
  const rule = map.freshness_rule;
  const kindEntry = Object.hasOwn(map.kinds, kind)
    ? map.kinds[kind as MissionControlKind]
    : undefined;
  const base: MissionControlVisualState =
    kindEntry && Object.hasOwn(kindEntry.state_map, sourceState)
      ? kindEntry.state_map[sourceState]!
      : rule.unmapped_state;

  if (freshness === "unknown") return rule.unknown;
  if (freshness === "stale") {
    return rule.stale_keeps.includes(base) ? base : rule.stale_otherwise;
  }
  return base;
}

function parseInstant(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * `live` / `stale` / `unknown` from the age of an observation. A missing or
 * unparsable timestamp, or one in the future (clock/producer problem), is
 * `unknown` — NEVER `live` (the same fail-closed convention
 * `classifyOrchestrationFreshness` and `classifyRepositoryProgressFreshness`
 * use). `staleAfterSeconds === null` means the source has no time budget
 * (an observation always counts as `live`). Strictly older than the budget
 * is stale, matching the existing `>` comparisons.
 */
export function freshnessFromAge(
  observedAt: Date | string | null | undefined,
  now: Date,
  staleAfterSeconds: number | null
): MissionControlFreshness {
  const observed = parseInstant(observedAt);
  if (!observed) return "unknown";
  const ageSeconds = (now.getTime() - observed.getTime()) / 1000;
  if (ageSeconds < 0) return "unknown";
  if (staleAfterSeconds === null) return "live";
  return ageSeconds > staleAfterSeconds ? "stale" : "live";
}

/**
 * The scene wire timestamp: `YYYY-MM-DDTHH:MM:SSZ` (no milliseconds — the
 * schema pattern forbids them), or `null` when absent/unparsable.
 */
export function toSceneTimestamp(
  value: Date | string | null | undefined
): string | null {
  const date = parseInstant(value);
  if (!date) return null;
  return `${date.toISOString().slice(0, 19)}Z`;
}

/**
 * Clamps `value` to `max` UTF-16 units — the unit the vendored validator's
 * `maxLength` counts, and never more code points than Python's `len`
 * (OMES's validator) would — without leaving a dangling high surrogate.
 * Characters are never stripped or rewritten; only the tail is cut.
 */
export function clampText(value: string, max: number): string {
  if (value.length <= max) return value;
  let end = max;
  const last = value.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return value.slice(0, end);
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/** An `awaits_decision_for` target: the job/deployment/backup an approval is pending for. */
export type MissionControlDecisionTarget = {
  kind: "job" | "deployment" | "backup";
  sourceId: string;
};

/** Evidence fields a record may carry; each maps to ONE relation in the map's vocabulary. */
export type MissionControlRecordEvidence = {
  /** hosts (deployment), targets (job), observed_on (hermes/ai-privacy), describes (health), protects (backup). */
  serverId?: string | null;
  /** targets (job -> deployment). */
  deploymentId?: string | null;
  /** delegates_to (Hermes `parent_subagent_id`; the parent delegates to this node). */
  parentSourceId?: string | null;
  /** member_of (capability -> architecture_plane). */
  planeId?: string | null;
  /** awaits_decision_for (approval_item -> job/deployment/backup). */
  decisionFor?: ReadonlyArray<MissionControlDecisionTarget>;
};

/** One already-authorized, already-projected source record. */
export type MissionControlRecordInput = {
  kind: MissionControlKind;
  sourceId: string;
  /** UNTRUSTED. Verbatim except the length clamp. */
  label: string;
  /** The source's own state value; `null` -> `not_reported`. */
  sourceState: string | null;
  freshness: MissionControlFreshness;
  observedAt: Date | string | null;
  /** UNTRUSTED. Verbatim except the length clamp. */
  summary?: string | null;
  evidence?: MissionControlRecordEvidence;
};

export type MissionControlSourceInput = {
  sourceKind: MissionControlSourceKind;
  /** false = could not be read / not permitted / not configured. Its records are ignored. */
  available: boolean;
};

export type MissionControlComposeInput = {
  sources: readonly MissionControlSourceInput[];
  records: readonly MissionControlRecordInput[];
};

export type MissionControlComposeOptions = {
  tenantId: string;
  now: Date;
};

type NormalizedRecord = {
  kind: MissionControlKind;
  sourceId: string;
  label: string;
  sourceState: string;
  freshness: MissionControlFreshness;
  observedAt: string | null;
  summary: string | undefined;
  visualState: MissionControlVisualState;
  evidence: MissionControlRecordEvidence | undefined;
};

/**
 * Truncation priority: problems and unknowns are kept before healthy or
 * purely informational nodes, so a bounded view never hides a failure to
 * make room for a capability tile (a truncated scene must not look
 * healthier than the fleet is).
 */
const TRUNCATION_TIER: Record<MissionControlVisualState, number> = {
  failed: 0,
  warning: 0,
  stale: 0,
  unknown: 0,
  in_progress: 1,
  pending: 1,
  cancelled: 2,
  ok: 3,
  informational: 3
};

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeRecord(
  record: MissionControlRecordInput,
  map: MissionControlSourceMap
): NormalizedRecord | null {
  if (!Object.hasOwn(map.kinds, record.kind)) return null;
  if (!SOURCE_ID_RE.test(record.sourceId)) return null;

  const rawLabel = record.label.trim() === "" ? record.sourceId : record.label;
  const label = clampText(rawLabel, MISSION_CONTROL_LABEL_MAX);
  const summary =
    typeof record.summary === "string" && record.summary.length > 0
      ? clampText(record.summary, MISSION_CONTROL_SUMMARY_MAX)
      : undefined;

  // Defense in depth: never place a secret-shaped string on the wire. The
  // record is omitted (and counted in `truncated.nodes`), never rewritten.
  if (
    scanForRawSecrets(label as JsonValue).length > 0 ||
    (summary !== undefined &&
      scanForRawSecrets(summary as JsonValue).length > 0)
  ) {
    return null;
  }

  const sourceState =
    record.sourceState !== null && SOURCE_STATE_RE.test(record.sourceState)
      ? record.sourceState
      : NOT_REPORTED;

  return {
    kind: record.kind,
    sourceId: record.sourceId,
    label,
    sourceState,
    freshness: record.freshness,
    observedAt: toSceneTimestamp(record.observedAt),
    summary,
    visualState: deriveVisualState(record.kind, sourceState, record.freshness),
    evidence: record.evidence
  };
}

/** Newest observation wins; null is oldest; a total, input-order-independent tiebreak follows. */
function isPreferred(a: NormalizedRecord, b: NormalizedRecord): boolean {
  const aAt = a.observedAt ?? "";
  const bAt = b.observedAt ?? "";
  if (aAt !== bAt) return aAt > bAt;
  const aKey = JSON.stringify([
    a.sourceState,
    a.freshness,
    a.label,
    a.summary ?? null
  ]);
  const bKey = JSON.stringify([
    b.sourceState,
    b.freshness,
    b.label,
    b.summary ?? null
  ]);
  return aKey <= bKey;
}

type LinkCandidate = {
  relation: MissionControlRelationType;
  fromKind: MissionControlKind;
  fromId: string;
  toKind: MissionControlKind;
  toId: string;
};

/**
 * The relation candidates ONE record's own evidence supports. Each is
 * checked against the map's relation vocabulary (`from`/`to` kinds) before
 * it is accepted, so adding evidence for a pairing the map does not allow
 * can never produce an edge.
 */
function linkCandidates(record: NormalizedRecord): LinkCandidate[] {
  const evidence = record.evidence;
  if (!evidence) return [];
  const { kind, sourceId } = record;
  const links: LinkCandidate[] = [];

  const serverId = evidence.serverId ?? null;
  if (serverId) {
    switch (kind) {
      case "deployment":
        links.push({
          relation: "hosts",
          fromKind: "server",
          fromId: serverId,
          toKind: kind,
          toId: sourceId
        });
        break;
      case "job":
        links.push({
          relation: "targets",
          fromKind: kind,
          fromId: sourceId,
          toKind: "server",
          toId: serverId
        });
        break;
      case "hermes_subagent":
      case "ai_privacy_posture":
        links.push({
          relation: "observed_on",
          fromKind: kind,
          fromId: sourceId,
          toKind: "server",
          toId: serverId
        });
        break;
      case "health_report":
        links.push({
          relation: "describes",
          fromKind: kind,
          fromId: sourceId,
          toKind: "server",
          toId: serverId
        });
        break;
      case "backup":
        links.push({
          relation: "protects",
          fromKind: kind,
          fromId: sourceId,
          toKind: "server",
          toId: serverId
        });
        break;
      default:
        break;
    }
  }

  if (kind === "job" && evidence.deploymentId) {
    links.push({
      relation: "targets",
      fromKind: "job",
      fromId: sourceId,
      toKind: "deployment",
      toId: evidence.deploymentId
    });
  }
  if (
    kind === "hermes_subagent" &&
    evidence.parentSourceId &&
    evidence.parentSourceId !== sourceId
  ) {
    links.push({
      relation: "delegates_to",
      fromKind: "hermes_subagent",
      fromId: evidence.parentSourceId,
      toKind: "hermes_subagent",
      toId: sourceId
    });
  }
  if (kind === "capability" && evidence.planeId) {
    links.push({
      relation: "member_of",
      fromKind: "capability",
      fromId: sourceId,
      toKind: "architecture_plane",
      toId: evidence.planeId
    });
  }
  if (kind === "approval_item") {
    for (const target of evidence.decisionFor ?? []) {
      links.push({
        relation: "awaits_decision_for",
        fromKind: "approval_item",
        fromId: sourceId,
        toKind: target.kind,
        toId: target.sourceId
      });
    }
  }
  return links;
}

function nodeKey(kind: MissionControlKind, sourceId: string): string {
  return `${kind}\u0000${sourceId}`;
}

/**
 * Composes the LIVE scene.
 *
 * Deterministic: the same inputs in any order produce the same output.
 * Nodes are ordered by the source map's kind order, then `source_id`; ids
 * are `n1..nN` in that order. Duplicate `(kind, source_id)` inputs keep the
 * newest observation. Bounds are the schema's (500 nodes / 1000 relations);
 * when exceeded, failed/warning/stale/unknown nodes are kept before
 * in-flight ones, before healthy/informational ones, and `truncated` reports
 * exactly how many nodes / relations were omitted.
 *
 * `truncated.nodes` ALSO counts records that could not be represented (an
 * identifier outside the schema pattern, a secret-shaped label/summary) —
 * the scene says it is incomplete rather than silently shrinking.
 * `truncated.relations` counts only relations dropped by the 1000 bound; a
 * relation whose endpoint node is absent is not "truncated", it is simply
 * not evidenced in this view.
 */
export function composeScene(
  input: MissionControlComposeInput,
  options: MissionControlComposeOptions
): MissionControlSceneView {
  const map = loadMissionControlSourceMap();
  const kindOrder = new Map<MissionControlKind, number>(
    (Object.keys(map.kinds) as MissionControlKind[]).map((kind, index) => [
      kind,
      index
    ])
  );

  const available = new Set<MissionControlSourceKind>();
  const consulted: MissionControlSourceKind[] = [];
  for (const source of input.sources) {
    if (
      !Object.hasOwn(map.sources, source.sourceKind) ||
      consulted.includes(source.sourceKind)
    ) {
      continue;
    }
    consulted.push(source.sourceKind);
    if (source.available) available.add(source.sourceKind);
  }

  // 1. Normalize and dedupe by (kind, source_id), newest observation wins.
  let omitted = 0;
  const byKey = new Map<string, NormalizedRecord>();
  for (const record of input.records) {
    const kindEntry = Object.hasOwn(map.kinds, record.kind)
      ? map.kinds[record.kind]
      : undefined;
    // A record from a source that was not consulted/available is ignored,
    // not counted: its absence is already reported by `sources[]`.
    if (!kindEntry || !available.has(kindEntry.source)) continue;

    const normalized = normalizeRecord(record, map);
    if (!normalized) {
      omitted += 1;
      continue;
    }
    const key = nodeKey(normalized.kind, normalized.sourceId);
    const existing = byKey.get(key);
    if (!existing || isPreferred(normalized, existing)) {
      byKey.set(key, normalized);
    }
  }

  const ordered = [...byKey.values()].sort(
    (a, b) =>
      kindOrder.get(a.kind)! - kindOrder.get(b.kind)! ||
      compareText(a.sourceId, b.sourceId)
  );

  // 2. Bound the node set. Problems first, then the stable kind/id order.
  let kept = ordered;
  if (ordered.length > MISSION_CONTROL_MAX_NODES) {
    kept = [...ordered]
      .sort(
        (a, b) =>
          TRUNCATION_TIER[a.visualState] - TRUNCATION_TIER[b.visualState] ||
          kindOrder.get(a.kind)! - kindOrder.get(b.kind)! ||
          compareText(a.sourceId, b.sourceId)
      )
      .slice(0, MISSION_CONTROL_MAX_NODES)
      .sort(
        (a, b) =>
          kindOrder.get(a.kind)! - kindOrder.get(b.kind)! ||
          compareText(a.sourceId, b.sourceId)
      );
  }
  const truncatedNodes = ordered.length - kept.length + omitted;

  // 3. Node ids and nodes.
  const nodeIdByKey = new Map<string, string>();
  const nodes: MissionControlSceneNode[] = kept.map((record, index) => {
    const nodeId = `n${index + 1}`;
    nodeIdByKey.set(nodeKey(record.kind, record.sourceId), nodeId);
    const node: MissionControlSceneNode = {
      node_id: nodeId,
      kind: record.kind,
      source_id: record.sourceId,
      label: record.label,
      source_state: record.sourceState,
      visual_state: record.visualState,
      freshness: record.freshness,
      observed_at: record.observedAt,
      detail_route: map.kinds[record.kind].detail_route
    };
    if (record.summary !== undefined) node.summary = record.summary;
    return node;
  });

  // 4. Relations: vocabulary-checked, endpoint-checked, deduped, bounded.
  const relationOrder = new Map<MissionControlRelationType, number>(
    MISSION_CONTROL_RELATIONS.map((relation, index) => [relation, index])
  );
  const relationByKey = new Map<string, MissionControlSceneRelation>();
  for (const record of kept) {
    for (const link of linkCandidates(record)) {
      const vocabulary = map.relations[link.relation];
      if (
        !vocabulary.from.includes(link.fromKind) ||
        !vocabulary.to.includes(link.toKind)
      ) {
        continue;
      }
      const from = nodeIdByKey.get(nodeKey(link.fromKind, link.fromId));
      const to = nodeIdByKey.get(nodeKey(link.toKind, link.toId));
      if (!from || !to || from === to) continue;
      relationByKey.set(`${from}|${to}|${link.relation}`, {
        from,
        to,
        relation: link.relation
      });
    }
  }
  const nodeIndex = (nodeId: string): number => Number(nodeId.slice(1));
  const allRelations = [...relationByKey.values()].sort(
    (a, b) =>
      nodeIndex(a.from) - nodeIndex(b.from) ||
      nodeIndex(a.to) - nodeIndex(b.to) ||
      relationOrder.get(a.relation)! - relationOrder.get(b.relation)!
  );
  const relations = allRelations.slice(0, MISSION_CONTROL_MAX_RELATIONS);

  // 5. sources[]: one entry per consulted source (map order).
  const newestBySource = new Map<MissionControlSourceKind, string>();
  const liveBySource = new Set<MissionControlSourceKind>();
  const staleBySource = new Set<MissionControlSourceKind>();
  for (const record of byKey.values()) {
    const source = map.kinds[record.kind].source;
    if (record.observedAt) {
      const newest = newestBySource.get(source);
      if (newest === undefined || record.observedAt > newest) {
        newestBySource.set(source, record.observedAt);
      }
    }
    if (record.freshness === "live") liveBySource.add(source);
    if (record.freshness === "stale") staleBySource.add(source);
  }
  const sources: MissionControlSceneSource[] = (
    Object.keys(map.sources) as MissionControlSourceKind[]
  )
    .filter((sourceKind) => consulted.includes(sourceKind))
    .map((sourceKind) => {
      const isAvailable = available.has(sourceKind);
      // stale = read, has records, none of them current, and at least one
      // evidenced as older than its budget. A source with nothing to show
      // is `available` and empty — never `stale`, never silently healthy:
      // the (empty) node set itself is what the viewer sees.
      const status: MissionControlSceneSource["status"] = !isAvailable
        ? "unavailable"
        : !liveBySource.has(sourceKind) && staleBySource.has(sourceKind)
          ? "stale"
          : "available";
      return {
        source_kind: sourceKind,
        authority: map.sources[sourceKind].authority,
        status,
        observed_at: isAvailable
          ? (newestBySource.get(sourceKind) ?? null)
          : null
      };
    });

  const generatedAt = toSceneTimestamp(options.now)!;
  return {
    schema_version: MISSION_CONTROL_SCHEMA_VERSION,
    source_map_version: MISSION_CONTROL_SCHEMA_VERSION,
    tenant_id: options.tenantId,
    generated_at: generatedAt,
    mode: "live",
    as_of: generatedAt,
    sources,
    nodes,
    relations,
    truncated: {
      nodes: truncatedNodes,
      relations: allRelations.length - relations.length
    }
  };
}

// ---------------------------------------------------------------------------
// Fail-closed validation
// ---------------------------------------------------------------------------

/**
 * Raised when a composed scene fails the vendored schema. Deliberately
 * generic: the underlying validator quotes offending VALUES in its messages
 * (which may be untrusted labels), so only the JSON paths and the count are
 * kept — nothing here can leak label/summary contents into a log.
 */
export class MissionControlSceneInvalidError extends Error {
  readonly invalidPaths: readonly string[];
  constructor(invalidPaths: readonly string[]) {
    super(
      `mission control scene failed schema validation (${invalidPaths.length} issue(s))`
    );
    this.name = "MissionControlSceneInvalidError";
    this.invalidPaths = invalidPaths;
  }
}

/** Matches the leading `$.path[0].field` of a validator message (never the quoted value). */
const ERROR_PATH_RE = /^(\$[A-Za-z0-9_.[\]]*)/;

/**
 * The JSON paths (never the quoted values) of a contract violation — shared
 * with the replay window validator (`mission-control-replay.ts`) so both fail
 * closed with the same value-free diagnostics.
 */
export function contractViolationPaths(
  error: ContractValidationError
): string[] {
  return error.errors.map((message) => ERROR_PATH_RE.exec(message)?.[1] ?? "$");
}

/**
 * Validates `scene` against the vendored `mission-control-scene-view`
 * schema (and the validator's independent raw-secret scan). Throws
 * {@link MissionControlSceneInvalidError} on any violation — the caller
 * must return a generic failure, never a partial scene.
 */
export async function assertMissionControlSceneValid(
  scene: MissionControlSceneView
): Promise<void> {
  try {
    await assertOmesContract(
      MISSION_CONTROL_SCENE_SCHEMA,
      scene as unknown as JsonValue
    );
  } catch (error) {
    if (error instanceof ContractValidationError) {
      throw new MissionControlSceneInvalidError(contractViolationPaths(error));
    }
    throw error;
  }
}
