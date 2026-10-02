/**
 * Pure evidence-based historical replay for the 3D Mission Control workspace
 * (Issue ahliweb/omes#266, epic ahliweb/omes#263; contract ahliweb/omes#264,
 * OMES ADR-0031 rule 4).
 *
 * ## Replay is a bounded READ over evidence that already exists
 *
 * Nothing here stores, derives or invents history. The application layer
 * (`application/mission-control-replay-directory.ts`) hands this module rows
 * that existing tables ALREADY retain — Hermes orchestration events, health
 * and backup snapshots, job and worker-result records, workflow decisions —
 * and the functions below only normalise, order, dedupe and label them:
 *
 *  - {@link buildReplayWindow}: one keyset page of the vendored
 *    `mission-control-replay-window` shape. Duplicates (same
 *    `(evidence_kind, evidence_id)`) are removed; order is deterministic by
 *    `(at, evidence_kind, evidence_id)`; evidence recorded out of order is
 *    LABELLED `late_arrival`, never silently re-ordered into history; at most
 *    500 events per page with an opaque, validated cursor.
 *  - {@link computeEvidenceGaps}: where a source retained nothing. A
 *    `current_only` source is `not_retained` over the whole window; a window
 *    that starts before a source's data-lifecycle retention horizon is
 *    `retention_expired`; one that starts before the source's earliest row is
 *    `before_first_observation`; an unreadable source is `source_unavailable`.
 *    A gap is shown as a gap — it is NEVER interpolated into a state.
 *  - {@link composeHistoricalScene}: the scene at `as_of`, built through the
 *    SAME `composeScene` the live view uses (so the state rule, bounds,
 *    secret scan and relation vocabulary cannot drift). Each event-backed
 *    object is in the state its LATEST retained evidence at or before `as_of`
 *    proves; an object with no such evidence is OMITTED (it did not provably
 *    exist yet). `current_only` objects are never back-dated: they appear with
 *    freshness `unknown` and source_state `not_reported` (visual `unknown`).
 *
 * ## Ordering precision
 *
 * The wire `at` carries whole seconds (the schema pattern forbids fractions),
 * but ordering and the keyset cursor use the stored timestamp at MICROSECOND
 * precision (`YYYY-MM-DDTHH:MM:SS.ffffffZ`) so the SQL `ORDER BY at, id` of the
 * per-source range queries and this module's sort are the SAME total order —
 * a page boundary can never skip or repeat an event. Wire timestamps are a
 * non-decreasing truncation of that order.
 *
 * ## What `late_arrival` can and cannot say
 *
 * A row is `late_arrival` when it was recorded (received/created) AFTER a row
 * for the same `(kind, source_id)` whose `at` is LATER — i.e. it arrived out of
 * order and revises history with a label instead of silently. The comparison
 * sees only the rows handed to {@link buildReplayWindow} (one page's worth of
 * evidence per request), so an out-of-order pair that straddles a page
 * boundary is judged `observed`. The label is therefore a floor, never a
 * ceiling; it is documented as such in the module README.
 *
 * Label and summary text is never carried by a replay event (the schema has no
 * such field), and nothing here logs row contents.
 */
import {
  assertOmesContract,
  ContractValidationError,
  type JsonValue
} from "./contracts";
import {
  composeScene,
  contractViolationPaths,
  freshnessFromAge,
  loadMissionControlSourceMap,
  sourceFreshnessBudgetSeconds,
  TERMINAL_JOB_STATES,
  toSceneTimestamp,
  deriveVisualState,
  type MissionControlRecordInput,
  type MissionControlSourceInput
} from "./mission-control";
import {
  MISSION_CONTROL_KINDS,
  MISSION_CONTROL_MAX_REPLAY_EVENTS,
  MISSION_CONTROL_SOURCE_KINDS,
  type MissionControlEvidenceGap,
  type MissionControlFreshness,
  type MissionControlKind,
  type MissionControlReplayEvent,
  type MissionControlReplayWindow,
  type MissionControlSceneView,
  type MissionControlSourceKind
} from "./mission-control-types";

/** Vendored schema name — resolves to `mission-control-replay-window.schema.json`. */
export const MISSION_CONTROL_REPLAY_SCHEMA = "mission-control-replay-window";

/** The widest replay window (and historical-scene lookback) the API serves: 24 h. */
export const MISSION_CONTROL_REPLAY_MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Hermes orchestration and health evidence older than this before `as_of` is not read for a historical scene. */
export const MISSION_CONTROL_SCENE_LOOKBACK_MS =
  MISSION_CONTROL_REPLAY_MAX_WINDOW_MS;

export const MISSION_CONTROL_EVIDENCE_KINDS = [
  "hermes_event",
  "health_snapshot",
  "backup_snapshot",
  "job_record",
  "worker_result",
  "audit_projection",
  "workflow_decision"
] as const;
export type MissionControlEvidenceKind =
  (typeof MISSION_CONTROL_EVIDENCE_KINDS)[number];

const EVIDENCE_GAP_REASON_ORDER: ReadonlyArray<
  MissionControlEvidenceGap["reason"]
> = [
  "source_unavailable",
  "not_retained",
  "retention_expired",
  "before_first_observation"
];

const WIRE_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const EXACT_TS_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/;
const ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const STATE_RE = /^[A-Za-z_]{1,32}$/;
const NOT_REPORTED = "not_reported";
const CURSOR_RE = /^[A-Za-z0-9_-]{1,256}$/;

// ---------------------------------------------------------------------------
// Instants
// ---------------------------------------------------------------------------

/**
 * `YYYY-MM-DDTHH:MM:SS.ffffffZ` (always six fractional digits, UTC) for a
 * `Date` or an ISO string with up to six fractional digits; `null` when absent
 * or not a real calendar instant. Fixed width, so plain string comparison is
 * chronological order.
 */
export function toExactInstant(
  value: Date | string | null | undefined
): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const iso = value.toISOString();
    const match = EXACT_TS_RE.exec(iso);
    return match ? `${match[1]}.${(match[2] ?? "").padEnd(6, "0")}Z` : null;
  }
  const match = EXACT_TS_RE.exec(value);
  if (!match) return null;
  const base = new Date(`${match[1]}Z`);
  if (
    Number.isNaN(base.getTime()) ||
    base.toISOString().slice(0, 19) !== match[1]
  ) {
    return null;
  }
  return `${match[1]}.${(match[2] ?? "").padEnd(6, "0")}Z`;
}

/** The wire form (whole seconds) of an exact instant. */
export function exactToWire(exact: string): string {
  return `${exact.slice(0, 19)}Z`;
}

/** Parses a wire instant (`YYYY-MM-DDTHH:MM:SSZ`, a real calendar instant) or returns `null`. */
export function parseWireInstant(value: unknown): Date | null {
  if (typeof value !== "string" || !WIRE_TS_RE.test(value)) return null;
  const date = new Date(value);
  if (
    Number.isNaN(date.getTime()) ||
    `${date.toISOString().slice(0, 19)}Z` !== value
  ) {
    return null;
  }
  return date;
}

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

export type ReplayCursor = {
  /** Exact (microsecond) instant of the last event of the previous page. */
  at: string;
  evidenceKind: MissionControlEvidenceKind;
  evidenceId: string;
};

function isEvidenceKind(value: string): value is MissionControlEvidenceKind {
  return (MISSION_CONTROL_EVIDENCE_KINDS as readonly string[]).includes(value);
}

/** Opaque keyset cursor: base64url of `${at}|${evidence_kind}|${evidence_id}`. */
export function encodeReplayCursor(cursor: ReplayCursor): string {
  return Buffer.from(
    `${cursor.at}|${cursor.evidenceKind}|${cursor.evidenceId}`,
    "utf8"
  ).toString("base64url");
}

/**
 * Validates and decodes a cursor. Anything that is not EXACTLY the canonical
 * encoding of a well-formed `(at, evidence_kind, evidence_id)` triple —
 * wrong alphabet, oversized, not base64url, wrong arity, unknown kind,
 * identifier outside the schema pattern, unreal instant, or a non-canonical
 * re-encoding — returns `null` (the route answers 400). The cursor carries no
 * secret and no raw data, and is never trusted beyond being a position.
 */
export function decodeReplayCursor(raw: unknown): ReplayCursor | null {
  if (typeof raw !== "string" || !CURSOR_RE.test(raw)) return null;
  let text: string;
  try {
    text = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const parts = text.split("|");
  if (parts.length !== 3) return null;
  const [at, evidenceKind, evidenceId] = parts as [string, string, string];
  if (!isEvidenceKind(evidenceKind) || !ID_RE.test(evidenceId)) return null;
  const exact = toExactInstant(at);
  if (exact === null || exact !== at) return null;
  const cursor: ReplayCursor = { at: exact, evidenceKind, evidenceId };
  return encodeReplayCursor(cursor) === raw ? cursor : null;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

type OrderKey = { at: string; evidenceKind: string; evidenceId: string };

/** The one total order: `(at, evidence_kind, evidence_id)`, plain code-unit comparison. */
export function compareReplayKeys(a: OrderKey, b: OrderKey): number {
  return (
    compareText(a.at, b.at) ||
    compareText(a.evidenceKind, b.evidenceKind) ||
    compareText(a.evidenceId, b.evidenceId)
  );
}

// ---------------------------------------------------------------------------
// Request parsing (strict; no free-form fields)
// ---------------------------------------------------------------------------

export type ReplayParse<T> =
  { ok: true; value: T } | { ok: false; message: string };

function allowOnly(
  params: URLSearchParams,
  allowed: readonly string[]
): string | null {
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (!allowed.includes(key)) return `Unknown query parameter '${key}'.`;
    if (seen.has(key)) return `Query parameter '${key}' may appear only once.`;
    seen.add(key);
  }
  return null;
}

export type ReplayQuery = {
  from: Date;
  to: Date;
  cursor: ReplayCursor | null;
};

/**
 * Validates `GET .../replay?from=&to=&cursor=`. All three keys are the ONLY
 * accepted parameters (an unknown one is rejected, not ignored); `from` and
 * `to` are required wire instants with `from < to`, a span of at most 24 h and
 * `to` not in the future; `cursor` is optional, must decode, and must lie
 * inside the window it is replayed against.
 */
export function parseReplayQuery(
  params: URLSearchParams,
  now: Date
): ReplayParse<ReplayQuery> {
  const unknown = allowOnly(params, ["from", "to", "cursor"]);
  if (unknown) return { ok: false, message: unknown };

  const from = parseWireInstant(params.get("from"));
  const to = parseWireInstant(params.get("to"));
  if (!from) {
    return {
      ok: false,
      message: "from must be a UTC instant like 2026-10-02T08:00:00Z."
    };
  }
  if (!to) {
    return {
      ok: false,
      message: "to must be a UTC instant like 2026-10-02T08:00:00Z."
    };
  }
  if (from.getTime() >= to.getTime()) {
    return { ok: false, message: "from must be earlier than to." };
  }
  if (to.getTime() - from.getTime() > MISSION_CONTROL_REPLAY_MAX_WINDOW_MS) {
    return {
      ok: false,
      message: "The replay window may span at most 24 hours."
    };
  }
  if (to.getTime() > now.getTime()) {
    return { ok: false, message: "to must not be in the future." };
  }

  const rawCursor = params.get("cursor");
  let cursor: ReplayCursor | null = null;
  if (rawCursor !== null) {
    cursor = decodeReplayCursor(rawCursor);
    if (!cursor) return { ok: false, message: "cursor is not a valid cursor." };
    const cursorAt = Date.parse(cursor.at);
    if (cursorAt < from.getTime() || cursorAt >= to.getTime() + 1000) {
      return { ok: false, message: "cursor does not belong to this window." };
    }
  }
  return { ok: true, value: { from, to, cursor } };
}

/**
 * Validates `GET .../scene?as_of=`. `as_of` is the ONLY accepted parameter;
 * when present it must be a wire instant that is not in the future and not
 * older than the retention horizon. Absent = live.
 */
export function parseSceneQuery(
  params: URLSearchParams,
  now: Date,
  horizonMs: number
): ReplayParse<{ asOf: Date | null }> {
  const unknown = allowOnly(params, ["as_of"]);
  if (unknown) return { ok: false, message: unknown };
  const raw = params.get("as_of");
  if (raw === null) return { ok: true, value: { asOf: null } };
  const asOf = parseWireInstant(raw);
  if (!asOf) {
    return {
      ok: false,
      message: "as_of must be a UTC instant like 2026-10-02T08:00:00Z."
    };
  }
  if (asOf.getTime() > now.getTime()) {
    return { ok: false, message: "as_of must not be in the future." };
  }
  if (asOf.getTime() < now.getTime() - horizonMs) {
    return {
      ok: false,
      message: "as_of is older than the retention horizon."
    };
  }
  return { ok: true, value: { asOf } };
}

// ---------------------------------------------------------------------------
// Replay window
// ---------------------------------------------------------------------------

/** One already-authorized, already-projected evidence row. */
export type ReplayEvidenceRow = {
  /** When the source says the transition happened. */
  at: Date | string;
  /** When the row was received/created; `null` = unknown (never judged late). */
  recordedAt?: Date | string | null;
  evidenceKind: MissionControlEvidenceKind;
  /** Opaque identifier of the evidence row; with `evidenceKind` it is the dedupe key. */
  evidenceId: string;
  kind: MissionControlKind;
  sourceId: string;
  /** hermes_subagent only: the parent id the evidence itself carries. */
  parentSourceId?: string | null;
  /** The source's own state value; `null`/malformed -> `not_reported`. */
  sourceState: string | null;
  correlationId?: string | null;
};

type NormalizedEvidence = {
  at: string;
  recordedAt: string | null;
  evidenceKind: MissionControlEvidenceKind;
  evidenceId: string;
  kind: MissionControlKind;
  sourceId: string;
  parentSourceId: string | null;
  sourceState: string;
  correlationId: string | null;
};

function normalizeEvidence(row: ReplayEvidenceRow): NormalizedEvidence | null {
  const at = toExactInstant(row.at);
  if (at === null) return null;
  if (!isEvidenceKind(row.evidenceKind) || !ID_RE.test(row.evidenceId)) {
    return null;
  }
  if (
    !(MISSION_CONTROL_KINDS as readonly string[]).includes(row.kind) ||
    !ID_RE.test(row.sourceId)
  ) {
    return null;
  }
  return {
    at,
    recordedAt: toExactInstant(row.recordedAt ?? null),
    evidenceKind: row.evidenceKind,
    evidenceId: row.evidenceId,
    kind: row.kind,
    sourceId: row.sourceId,
    parentSourceId:
      row.kind === "hermes_subagent" &&
      typeof row.parentSourceId === "string" &&
      ID_RE.test(row.parentSourceId)
        ? row.parentSourceId
        : null,
    sourceState:
      row.sourceState !== null && STATE_RE.test(row.sourceState)
        ? row.sourceState
        : NOT_REPORTED,
    correlationId:
      typeof row.correlationId === "string" && ID_RE.test(row.correlationId)
        ? row.correlationId
        : null
  };
}

/** Deterministic winner among duplicates of one `(evidence_kind, evidence_id)`. */
function preferDuplicate(
  a: NormalizedEvidence,
  b: NormalizedEvidence
): boolean {
  if (a.at !== b.at) return a.at < b.at;
  const aRec = a.recordedAt ?? "";
  const bRec = b.recordedAt ?? "";
  if (aRec !== bRec) return aRec < bRec;
  return (
    JSON.stringify([a.kind, a.sourceId, a.sourceState, a.parentSourceId]) <=
    JSON.stringify([b.kind, b.sourceId, b.sourceState, b.parentSourceId])
  );
}

/**
 * Rows recorded AFTER a row of the same `(kind, source_id)` whose `at` is
 * later. Per group, walk from the latest `at` backwards keeping the earliest
 * `recordedAt` seen among strictly-later rows; a row recorded after that
 * instant arrived out of order. Ties on `at` are never "later". Rows without a
 * recorded time can neither be late nor prove another late.
 */
function lateArrivalKeys(rows: readonly NormalizedEvidence[]): Set<string> {
  const groups = new Map<string, NormalizedEvidence[]>();
  for (const row of rows) {
    const key = `${row.kind}\u0000${row.sourceId}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  const late = new Set<string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => compareText(b.at, a.at));
    let earliestLaterRecorded: string | null = null;
    let index = 0;
    while (index < group.length) {
      let end = index;
      while (end < group.length && group[end]!.at === group[index]!.at)
        end += 1;
      const batch = group.slice(index, end);
      for (const row of batch) {
        if (
          row.recordedAt !== null &&
          earliestLaterRecorded !== null &&
          row.recordedAt > earliestLaterRecorded
        ) {
          late.add(`${row.evidenceKind}\u0000${row.evidenceId}`);
        }
      }
      for (const row of batch) {
        if (
          row.recordedAt !== null &&
          (earliestLaterRecorded === null ||
            row.recordedAt < earliestLaterRecorded)
        ) {
          earliestLaterRecorded = row.recordedAt;
        }
      }
      index = end;
    }
  }
  return late;
}

export type ReplayWindowOptions = {
  tenantId: string;
  now: Date;
  /** The requested range, wire instants; events outside it are dropped. */
  window: { from: string; to: string };
  /** Page size; clamped to `1..500`. */
  limit?: number;
  cursor?: ReplayCursor | null;
  /** Gaps computed by {@link computeEvidenceGaps}; carried verbatim. */
  evidenceGaps?: readonly MissionControlEvidenceGap[];
};

export type ReplayPage = {
  window: MissionControlReplayWindow;
  /** Rows that could not be represented under the contract (omitted, never rewritten). */
  omitted: number;
};

/**
 * One page of replay. `rows` may be in ANY order and contain duplicates and
 * rows outside the window or at/before the cursor; the result depends only on
 * the set of rows, never on their input order.
 */
export function buildReplayPage(
  rows: readonly ReplayEvidenceRow[],
  options: ReplayWindowOptions
): ReplayPage {
  const limit = Math.max(
    1,
    Math.min(
      options.limit ?? MISSION_CONTROL_MAX_REPLAY_EVENTS,
      MISSION_CONTROL_MAX_REPLAY_EVENTS
    )
  );

  let omitted = 0;
  const deduped = new Map<string, NormalizedEvidence>();
  for (const row of rows) {
    const normalized = normalizeEvidence(row);
    if (!normalized) {
      omitted += 1;
      continue;
    }
    const key = `${normalized.evidenceKind}\u0000${normalized.evidenceId}`;
    const existing = deduped.get(key);
    if (!existing || preferDuplicate(normalized, existing)) {
      deduped.set(key, normalized);
    }
  }

  const inWindow = [...deduped.values()].filter((row) => {
    const wire = exactToWire(row.at);
    return wire >= options.window.from && wire <= options.window.to;
  });
  const late = lateArrivalKeys(inWindow);

  const cursor = options.cursor ?? null;
  const ordered = inWindow
    .filter(
      (row) =>
        cursor === null ||
        compareReplayKeys(
          {
            at: row.at,
            evidenceKind: row.evidenceKind,
            evidenceId: row.evidenceId
          },
          {
            at: cursor.at,
            evidenceKind: cursor.evidenceKind,
            evidenceId: cursor.evidenceId
          }
        ) > 0
    )
    .sort(compareReplayKeys);

  const page = ordered.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    ordered.length > limit && last
      ? encodeReplayCursor({
          at: last.at,
          evidenceKind: last.evidenceKind,
          evidenceId: last.evidenceId
        })
      : null;

  const events: MissionControlReplayEvent[] = page.map((row) => {
    const event: MissionControlReplayEvent = {
      at: exactToWire(row.at),
      evidence_kind: row.evidenceKind,
      evidence_id: row.evidenceId,
      kind: row.kind,
      source_id: row.sourceId,
      source_state: row.sourceState,
      // The replay is evidence of a recorded transition, never a freshness
      // judgement about "now": the state rule is applied as for a live source.
      visual_state: deriveVisualState(row.kind, row.sourceState, "live"),
      provenance: late.has(`${row.evidenceKind}\u0000${row.evidenceId}`)
        ? "late_arrival"
        : "observed"
    };
    if (row.kind === "hermes_subagent") {
      event.parent_source_id = row.parentSourceId;
    }
    if (row.correlationId !== null) event.correlation_id = row.correlationId;
    return event;
  });

  return {
    window: {
      schema_version: "1.0.0",
      source_map_version: "1.0.0",
      tenant_id: options.tenantId,
      generated_at: toSceneTimestamp(options.now)!,
      window: { from: options.window.from, to: options.window.to },
      events,
      evidence_gaps: [...(options.evidenceGaps ?? [])],
      next_cursor: nextCursor
    },
    omitted
  };
}

/** {@link buildReplayPage}, returning only the contract object. */
export function buildReplayWindow(
  rows: readonly ReplayEvidenceRow[],
  options: ReplayWindowOptions
): MissionControlReplayWindow {
  return buildReplayPage(rows, options).window;
}

// ---------------------------------------------------------------------------
// Evidence gaps
// ---------------------------------------------------------------------------

export type ReplayRetainedRange = {
  /** Earliest retained row of the source for this tenant; `null` = the tenant has none at all. */
  earliest: Date | string | null;
  /**
   * Rows older than this instant are purged by the source table's
   * data-lifecycle policy (`omesControlModule.dataLifecycle`); `null` = no
   * policy purges this source.
   */
  horizon: Date | string | null;
};

export type ReplayConsultedSource = {
  sourceKind: MissionControlSourceKind;
  /** false = not permitted / could not be read. */
  available: boolean;
};

function instantMs(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Evidence gaps for `window` (wire instants). One entry per `(source, reason,
 * span)`, ordered by the source map's source order, then reason, then start.
 *
 * Per source (basis = the source map's `replay_basis` of its kinds):
 *  - unreadable            -> `source_unavailable` over the whole window;
 *  - `current_only`        -> `not_retained` over the whole window (no history
 *                             exists; objects are never back-dated);
 *  - `terminal_transitions`-> `not_retained` over the whole window (only
 *                             creation and terminal transitions are retained;
 *                             intermediate steps are an explicit gap) plus the
 *                             retention checks below;
 *  - `event_log` / `snapshot_series` and `terminal_transitions` retention checks:
 *      window earlier than the retention `horizon`  -> `retention_expired`,
 *      window earlier than the earliest retained row -> `before_first_observation`.
 * `retained` has no entry for a source -> no retention claim is made for it.
 */
export function computeEvidenceGaps(
  window: { from: string; to: string },
  retained: Partial<Record<MissionControlSourceKind, ReplayRetainedRange>>,
  consulted: readonly ReplayConsultedSource[]
): MissionControlEvidenceGap[] {
  const map = loadMissionControlSourceMap();
  const fromMs = Date.parse(window.from);
  const toMs = Date.parse(window.to);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs <= fromMs) return [];

  const basisBySource = new Map<MissionControlSourceKind, string>();
  for (const kind of MISSION_CONTROL_KINDS) {
    const entry = map.kinds[kind];
    if (entry && !basisBySource.has(entry.source)) {
      basisBySource.set(entry.source, entry.replay_basis);
    }
  }

  const gaps: MissionControlEvidenceGap[] = [];
  const push = (
    sourceKind: MissionControlSourceKind,
    fromAt: number,
    toAt: number,
    reason: MissionControlEvidenceGap["reason"]
  ): void => {
    if (toAt - fromAt < 1000) return;
    gaps.push({
      source_kind: sourceKind,
      from: toSceneTimestamp(new Date(fromAt))!,
      to: toSceneTimestamp(new Date(toAt))!,
      reason
    });
  };

  const seen = new Set<MissionControlSourceKind>();
  for (const source of consulted) {
    if (
      !(MISSION_CONTROL_SOURCE_KINDS as readonly string[]).includes(
        source.sourceKind
      ) ||
      seen.has(source.sourceKind)
    ) {
      continue;
    }
    seen.add(source.sourceKind);
    const sourceKind = source.sourceKind;

    if (!source.available) {
      push(sourceKind, fromMs, toMs, "source_unavailable");
      continue;
    }
    const basis = basisBySource.get(sourceKind) ?? "current_only";
    if (basis === "current_only" || basis === "terminal_transitions") {
      push(sourceKind, fromMs, toMs, "not_retained");
    }
    if (basis === "current_only") continue;

    const range = retained[sourceKind];
    if (!range) continue;
    const horizon = instantMs(range.horizon);
    if (horizon !== null && fromMs < horizon) {
      push(sourceKind, fromMs, Math.min(toMs, horizon), "retention_expired");
    }
    const lower = Math.max(fromMs, horizon ?? Number.NEGATIVE_INFINITY);
    const earliest = instantMs(range.earliest);
    if (range.earliest === null) {
      push(sourceKind, lower, toMs, "before_first_observation");
    } else if (earliest !== null && earliest > lower) {
      push(
        sourceKind,
        lower,
        Math.min(toMs, earliest),
        "before_first_observation"
      );
    }
  }

  const sourceOrder = new Map<string, number>(
    (Object.keys(map.sources) as MissionControlSourceKind[]).map(
      (key, index) => [key, index]
    )
  );
  const reasonOrder = new Map(
    EVIDENCE_GAP_REASON_ORDER.map((reason, index) => [reason, index] as const)
  );
  return gaps
    .sort(
      (a, b) =>
        (sourceOrder.get(a.source_kind) ?? 99) -
          (sourceOrder.get(b.source_kind) ?? 99) ||
        (reasonOrder.get(a.reason) ?? 99) - (reasonOrder.get(b.reason) ?? 99) ||
        compareText(a.from, b.from)
    )
    .slice(0, 64);
}

// ---------------------------------------------------------------------------
// Historical scene
// ---------------------------------------------------------------------------

/** Evidence the historical scene reads: a replay row plus the bounded label/server link the row itself carries. */
export type HistoricalEvidenceRow = ReplayEvidenceRow & {
  /** UNTRUSTED display text (a Hermes `role`, a job `operation`); `null` -> the source id. */
  label?: string | null;
  /** The `server_id` the evidence row itself carries (relation evidence). */
  serverId?: string | null;
};

export type HistoricalSceneInput = {
  /** One entry per consulted source (all ten); `available: false` = not permitted / unreadable / purged. */
  sources: readonly MissionControlSourceInput[];
  evidence: readonly HistoricalEvidenceRow[];
  /**
   * PRESENT-DAY records of the `current_only` kinds (server, deployment,
   * architecture plane, capability, repository milestone, AI privacy posture).
   * They only anchor the layout: every one is shown with freshness `unknown`
   * and source_state `not_reported`, never with its present-day state.
   * Records of any other kind are ignored.
   */
  anchors: readonly MissionControlRecordInput[];
  gaps: readonly MissionControlEvidenceGap[];
  /** Evidence-bearing objects the directory's bounded reads left out (added to `truncated.nodes`). */
  extraTruncatedNodes?: number;
};

export type HistoricalSceneOptions = {
  tenantId: string;
  /** When the composition ran. */
  now: Date;
  /** The instant described; must not be after `now`. */
  asOf: Date;
};

function freshnessAt(
  kind: MissionControlKind,
  sourceState: string,
  at: string,
  asOf: Date
): MissionControlFreshness {
  const map = loadMissionControlSourceMap();
  const source = map.kinds[kind].source;
  // A terminal job state is final evidence and never goes stale; a
  // non-terminal one is only as fresh as its last retained evidence.
  if (
    kind === "job" &&
    (TERMINAL_JOB_STATES.has(sourceState) || sourceState === "rejected")
  ) {
    return "live";
  }
  return freshnessFromAge(at, asOf, sourceFreshnessBudgetSeconds(source));
}

/**
 * The scene as of `asOf`, composed through the live `composeScene` so the
 * state rule, node/relation bounds, secret scan and relation vocabulary are
 * the live view's own.
 *
 * Event-backed kinds (`event_log`, `snapshot_series`, `terminal_transitions`):
 * the state is that of the LATEST evidence at or before `asOf` (evidence after
 * it is ignored); freshness is the age of that evidence at `asOf` against the
 * source's own budget, so a Hermes subagent last heard from ten minutes before
 * `as_of` is `stale`, never `live`. An object with no evidence at or before
 * `asOf` is absent — it did not provably exist yet.
 *
 * `current_only` kinds are never back-dated (see {@link HistoricalSceneInput.anchors}).
 *
 * Relations come only from the evidence rows' own fields (a Hermes
 * `parent_subagent_id`, a row's `server_id`) and from the present-day anchors'
 * own links between `current_only` objects; `awaits_decision_for` is not
 * reconstructed (it needs a present-day join). The returned scene is
 * `mode: "historical"`; the caller validates it against the vendored schema.
 */
export function composeHistoricalScene(
  input: HistoricalSceneInput,
  options: HistoricalSceneOptions
): MissionControlSceneView {
  const map = loadMissionControlSourceMap();
  const asOfWire = toSceneTimestamp(options.asOf)!;
  // Wire seconds are the resolution of `as_of`: evidence within the same
  // second is part of it.
  const asOfBound = `${asOfWire.slice(0, 19)}.999999Z`;

  const latest = new Map<
    string,
    { row: NormalizedEvidence; source: HistoricalEvidenceRow }
  >();
  for (const row of input.evidence) {
    const normalized = normalizeEvidence(row);
    if (!normalized || normalized.at > asOfBound) continue;
    const entry = Object.hasOwn(map.kinds, normalized.kind)
      ? map.kinds[normalized.kind]
      : undefined;
    if (!entry || entry.replay_basis === "current_only") continue;
    const key = `${normalized.kind}\u0000${normalized.sourceId}`;
    const existing = latest.get(key);
    if (
      !existing ||
      compareReplayKeys(normalized, existing.row) > 0 ||
      (compareReplayKeys(normalized, existing.row) === 0 &&
        (row.label ?? "") > (existing.source.label ?? ""))
    ) {
      latest.set(key, { row: normalized, source: row });
    }
  }

  const records: MissionControlRecordInput[] = [];
  for (const { row, source } of latest.values()) {
    const label =
      typeof source.label === "string" && source.label.trim() !== ""
        ? source.label
        : row.sourceId;
    records.push({
      kind: row.kind,
      sourceId: row.sourceId,
      label,
      sourceState: row.sourceState,
      freshness: freshnessAt(row.kind, row.sourceState, row.at, options.asOf),
      observedAt: exactToWire(row.at),
      evidence: {
        serverId:
          typeof source.serverId === "string" && ID_RE.test(source.serverId)
            ? source.serverId
            : null,
        parentSourceId: row.parentSourceId
      }
    });
  }

  for (const anchor of input.anchors) {
    const entry = Object.hasOwn(map.kinds, anchor.kind)
      ? map.kinds[anchor.kind]
      : undefined;
    if (!entry || entry.replay_basis !== "current_only") continue;
    records.push({
      kind: anchor.kind,
      sourceId: anchor.sourceId,
      label: anchor.label,
      // Never back-dated: no state, no observation instant, freshness unknown.
      sourceState: null,
      freshness: "unknown",
      observedAt: null,
      evidence: anchor.evidence
    });
  }

  const scene = composeScene(
    { sources: input.sources, records },
    { tenantId: options.tenantId, now: options.now }
  );
  return {
    ...scene,
    mode: "historical",
    as_of: asOfWire,
    truncated: {
      nodes:
        scene.truncated.nodes + Math.max(0, input.extraTruncatedNodes ?? 0),
      relations: scene.truncated.relations
    },
    evidence_gaps: [...input.gaps]
  };
}

// ---------------------------------------------------------------------------
// Fail-closed validation
// ---------------------------------------------------------------------------

/** Raised when a composed replay window fails the vendored schema (paths only — no values). */
export class MissionControlReplayInvalidError extends Error {
  readonly invalidPaths: readonly string[];
  constructor(invalidPaths: readonly string[]) {
    super(
      `mission control replay window failed schema validation (${invalidPaths.length} issue(s))`
    );
    this.name = "MissionControlReplayInvalidError";
    this.invalidPaths = invalidPaths;
  }
}

/**
 * Validates `window` against the vendored `mission-control-replay-window`
 * schema; an invalid page is never returned (the route answers a generic 500).
 */
export async function assertMissionControlReplayWindowValid(
  window: MissionControlReplayWindow
): Promise<void> {
  try {
    await assertOmesContract(
      MISSION_CONTROL_REPLAY_SCHEMA,
      window as unknown as JsonValue
    );
  } catch (error) {
    if (error instanceof ContractValidationError) {
      throw new MissionControlReplayInvalidError(contractViolationPaths(error));
    }
    throw error;
  }
}
