/**
 * Bounded, tenant-scoped READ queries behind Mission Control's historical
 * replay (Issue ahliweb/omes#266, epic ahliweb/omes#263; ADR-0031 rule 4).
 * Backs `GET /api/v1/omes/mission-control/replay` and
 * `GET /api/v1/omes/mission-control/scene?as_of=`.
 *
 * ## No new store, no new authority
 *
 * Every query below reads a table that already exists and already retains the
 * evidence (`awcms_omes_hermes_orchestration_events`,
 * `awcms_omes_health_snapshots`, `awcms_omes_backup_snapshots`,
 * `awcms_omes_jobs` + `awcms_omes_worker_results`, and the workflow instances
 * of `omes_control.destructive_operation`). The pure `domain/
 * mission-control-replay.ts` does the dedupe, ordering, `late_arrival`
 * labelling, gap computation and scene composition; this file only fetches.
 * `sql/168_awcms_omes_mission_control_replay_indexes.sql` adds INDEXES and
 * nothing else — no table, no column, no retention change.
 *
 * ## Authorization is at least the live view's
 *
 * Each source is gated by the SAME read guard the live scene uses (the
 * viewer's `can`, built by `createMissionControlCan`); an unreadable source is
 * never queried and is reported (`source_unavailable` gap / `unavailable`
 * source). Every query filters `tenant_id` explicitly AND runs under the
 * request's `FORCE ROW LEVEL SECURITY` transaction.
 *
 * ## Columns are explicit and never raw
 *
 * No query selects `evidence`, `error`, `checks`, `manifest`, `payload`,
 * `target`, `result`, `facts`, a Hermes `goal`/`summary`/`active_tool`, or any
 * other free-form column. The only free text read is the bounded display label
 * the live scene already shows for the same object (a Hermes `role`, a job or
 * approval `operation`), and only for the HISTORICAL SCENE — replay events
 * carry no text at all.
 *
 * ## Bounds
 *
 *  - replay: at most 24 h per request (the route validates), at most
 *    {@link MISSION_CONTROL_MAX_REPLAY_EVENTS} events per page, each source
 *    asked for `limit + 1` rows after the cursor (so the merged page can tell
 *    whether another exists), every query on a `(tenant_id, <time>)` index;
 *  - historical scene: per source at most 501 rows (the 501st only counts as
 *    omitted). Hermes and health evidence is read from the 24 h before
 *    `as_of`; backups, jobs and approvals read the newest rows at or before
 *    `as_of` (newest-first on the `(tenant_id, created_at/captured_at)` index)
 *    plus anything that reached a terminal state in those 24 h. An object whose
 *    latest evidence is older than that is simply not shown — documented in the
 *    module README, never rendered as healthy.
 *
 * ## Retention
 *
 * Which evidence has been purged comes from the data-lifecycle descriptors the
 * module already declares (`omesControlModule.dataLifecycle`, executed by
 * `bun run data-lifecycle:archive-purge`): health snapshots 30 d, jobs 60 d,
 * backup snapshots 90 d, Hermes events 90 d (`defaultRetentionDays`, the value
 * the purge job uses). Workflow instances are not purged by any lifecycle
 * descriptor. The horizon is read from the descriptor, never copied.
 */
import { utcMicrosecondTextSql } from "../../_shared/keyset-pagination";
import { log } from "../../../lib/logging/logger";
import type { AccessRequest } from "../../identity-access/domain/access-control";
import { omesControlModule } from "../module";
import { OMES_DESTRUCTIVE_WORKFLOW_KEY } from "../domain/operations";
import { OMES_GUARDS } from "../domain/permissions";
import {
  assertMissionControlSceneValid,
  toSceneTimestamp
} from "../domain/mission-control";
import {
  assertMissionControlReplayWindowValid,
  buildReplayPage,
  composeHistoricalScene,
  computeEvidenceGaps,
  toExactInstant,
  type HistoricalEvidenceRow,
  type MissionControlEvidenceKind,
  type ReplayConsultedSource,
  type ReplayCursor,
  type ReplayEvidenceRow,
  type ReplayRetainedRange,
  MISSION_CONTROL_SCENE_LOOKBACK_MS
} from "../domain/mission-control-replay";
import {
  MISSION_CONTROL_MAX_REPLAY_EVENTS,
  MISSION_CONTROL_SOURCE_KINDS,
  type MissionControlKind,
  type MissionControlReplayWindow,
  type MissionControlSceneView,
  type MissionControlSourceKind
} from "../domain/mission-control-types";
import {
  collectAiPrivacyRecords,
  collectArchitectureRecords,
  collectDeploymentRecords,
  collectRepositoryProgressRecords,
  collectServerRecords,
  createMissionControlCollector,
  MISSION_CONTROL_WORKFLOW_APPROVAL_READ_GUARD
} from "./mission-control-directory";

/** The read guard each source is gated by — exactly the live scene's. */
export const MISSION_CONTROL_SOURCE_GUARDS: Readonly<
  Record<MissionControlSourceKind, AccessRequest>
> = {
  omes_server_inventory: OMES_GUARDS.servers.read,
  omes_deployment_view: OMES_GUARDS.deployments.read,
  omes_job_status: OMES_GUARDS.jobs.read,
  omes_health_readiness: OMES_GUARDS.servers.read,
  omes_backup_status: OMES_GUARDS.backups.read,
  hermes_orchestration_tree: OMES_GUARDS.hermesOrchestration.read,
  omes_architecture_capabilities_view: OMES_GUARDS.architecture.read,
  github_repository_progress_view: OMES_GUARDS.hermesOrchestration.read,
  omes_ai_privacy_posture_view: OMES_GUARDS.aiPrivacy.read,
  awcms_workflow_approval: MISSION_CONTROL_WORKFLOW_APPROVAL_READ_GUARD
};

/** The table whose data-lifecycle policy bounds each event-backed source. */
const RETENTION_TABLE: Partial<Record<MissionControlSourceKind, string>> = {
  hermes_orchestration_tree: "awcms_omes_hermes_orchestration_events",
  omes_health_readiness: "awcms_omes_health_snapshots",
  omes_backup_status: "awcms_omes_backup_snapshots",
  omes_job_status: "awcms_omes_jobs"
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** `defaultRetentionDays` of the table's data-lifecycle descriptor — the value the purge job applies; `null` = not purged by any descriptor. */
function retentionDays(tableName: string): number | null {
  return (
    omesControlModule.dataLifecycle?.find(
      (descriptor) => descriptor.tableName === tableName
    )?.defaultRetentionDays ?? null
  );
}

/** Rows older than this instant have been (or are about to be) purged for `sourceKind`; `null` = never purged. */
export function retentionHorizonFor(
  sourceKind: MissionControlSourceKind,
  now: Date
): Date | null {
  const table = RETENTION_TABLE[sourceKind];
  const days = table ? retentionDays(table) : null;
  return days === null ? null : new Date(now.getTime() - days * DAY_MS);
}

/**
 * How far back an `as_of` may reach: the longest retention among the replay
 * sources (90 days with the shipped descriptors). Older than that, no replay
 * source can hold evidence, so the route answers 400 rather than an empty
 * scene that would look like "nothing happened".
 */
export function missionControlReplayHorizonMs(): number {
  let days = 0;
  for (const table of Object.values(RETENTION_TABLE)) {
    days = Math.max(days, table ? (retentionDays(table) ?? 0) : 0);
  }
  return days * DAY_MS;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Full-precision UTC text of a column (`...ffffffZ`) via the shared formatter (finding D13). */
const AT = (column: string): string => utcMicrosecondTextSql(column, "Z");

/**
 * `(at, evidence_id)` keyset over `[$2, $3)` after the cursor in `($4, kind
 * $5/$6, id $7)`. The constant evidence kind of the query is compared in JS
 * (`kindGt`/`kindEq`) so SQL and the pure builder use ONE total order
 * `(at, evidence_kind, evidence_id)`; ids compare under `COLLATE "C"` (byte
 * order = JS code-unit order for the ASCII ids used here). The sargable
 * `>= lower` bound is the cursor instant itself when there is one, so a deep
 * page never rescans the front of the window.
 */
const KEYSET = (atColumn: string, idExpression: string): string =>
  `AND ${atColumn} >= $2::timestamptz AND ${atColumn} < $3::timestamptz
   AND ($4::timestamptz IS NULL
        OR ${atColumn} > $4::timestamptz
        OR (${atColumn} = $4::timestamptz
            AND ($5::boolean
                 OR ($6::boolean
                     AND (${idExpression}) COLLATE "C" > $7::text COLLATE "C"))))`;

type EvidenceQueryRow = {
  evidence_id: string;
  source_id: string;
  source_state: string | null;
  parent_subagent_id?: string | null;
  correlation_id?: string | null;
  at_exact: string;
  recorded_exact: string | null;
};

export type QuerySpec = {
  sourceKind: MissionControlSourceKind;
  evidenceKind: MissionControlEvidenceKind;
  kind: MissionControlKind;
  /** Static SQL; only `$1..$9` placeholders — never interpolated values. */
  sql: string;
  usesWorkflowKey: boolean;
};

export const REPLAY_QUERIES: readonly QuerySpec[] = [
  {
    sourceKind: "hermes_orchestration_tree",
    evidenceKind: "hermes_event",
    kind: "hermes_subagent",
    usesWorkflowKey: false,
    sql: `SELECT id::text AS evidence_id, subagent_id AS source_id,
                 parent_subagent_id, state AS source_state, correlation_id,
                 ${AT("event_timestamp")} AS at_exact,
                 ${AT("received_at")} AS recorded_exact
          FROM awcms_omes_hermes_orchestration_events
          WHERE tenant_id = $1 ${KEYSET("event_timestamp", "id::text")}
          ORDER BY event_timestamp, id
          LIMIT $8`
  },
  {
    sourceKind: "omes_health_readiness",
    evidenceKind: "health_snapshot",
    kind: "health_report",
    usesWorkflowKey: false,
    sql: `SELECT id::text AS evidence_id, server_id AS source_id,
                 overall_status AS source_state,
                 ${AT("captured_at")} AS at_exact,
                 ${AT("created_at")} AS recorded_exact
          FROM awcms_omes_health_snapshots
          WHERE tenant_id = $1 ${KEYSET("captured_at", "id::text")}
          ORDER BY captured_at, id
          LIMIT $8`
  },
  {
    sourceKind: "omes_backup_status",
    evidenceKind: "backup_snapshot",
    kind: "backup",
    usesWorkflowKey: false,
    sql: `SELECT id::text AS evidence_id, backup_id AS source_id,
                 status AS source_state,
                 ${AT("captured_at")} AS at_exact,
                 ${AT("created_at")} AS recorded_exact
          FROM awcms_omes_backup_snapshots
          WHERE tenant_id = $1 ${KEYSET("captured_at", "id::text")}
          ORDER BY captured_at, id
          LIMIT $8`
  },
  {
    // Creation: the only retained fact about a job's start. Every job row is
    // created `queued` (column default; the state check allows nothing else
    // as an initial value the worker could not already have advanced), so the
    // creation event is `queued` and the steps between it and the terminal
    // transition are an explicit `not_retained` gap.
    sourceKind: "omes_job_status",
    evidenceKind: "job_record",
    kind: "job",
    usesWorkflowKey: false,
    sql: `SELECT (id::text || ':created') AS evidence_id, job_id AS source_id,
                 'queued'::text AS source_state,
                 ${AT("created_at")} AS at_exact,
                 ${AT("created_at")} AS recorded_exact
          FROM awcms_omes_jobs
          WHERE tenant_id = $1 ${KEYSET("created_at", "id::text || ':created'")}
          ORDER BY created_at, id
          LIMIT $8`
  },
  {
    // Terminal transition: `updated_at` of a row now in a terminal state. The
    // literal state list matches the partial index of sql/168 exactly.
    sourceKind: "omes_job_status",
    evidenceKind: "job_record",
    kind: "job",
    usesWorkflowKey: false,
    sql: `SELECT (id::text || ':terminal') AS evidence_id, job_id AS source_id,
                 state AS source_state,
                 ${AT("updated_at")} AS at_exact,
                 ${AT("updated_at")} AS recorded_exact
          FROM awcms_omes_jobs
          WHERE tenant_id = $1
            AND state IN ('completed', 'failed', 'cancelled')
            ${KEYSET("updated_at", "id::text || ':terminal'")}
          ORDER BY updated_at, id
          LIMIT $8`
  },
  {
    // Worker-reported results, joined to their job by the one correlation the
    // schema guarantees: (tenant_id, server_id, idempotency_key). `evidence`
    // and `error` are never selected. A result whose job row has been purged
    // has no node to attach to and is not returned.
    sourceKind: "omes_job_status",
    evidenceKind: "worker_result",
    kind: "job",
    usesWorkflowKey: false,
    sql: `SELECT r.id::text AS evidence_id, j.job_id AS source_id,
                 r.reported_state AS source_state, r.correlation_id,
                 ${AT("r.completed_at")} AS at_exact,
                 ${AT("r.created_at")} AS recorded_exact
          FROM awcms_omes_worker_results r
          JOIN awcms_omes_jobs j
            ON j.tenant_id = r.tenant_id
           AND j.server_id = r.server_id
           AND j.idempotency_key = r.idempotency_key
          WHERE r.tenant_id = $1 ${KEYSET("r.completed_at", "r.id::text")}
          ORDER BY r.completed_at, r.id
          LIMIT $8`
  },
  {
    sourceKind: "awcms_workflow_approval",
    evidenceKind: "workflow_decision",
    kind: "approval_item",
    usesWorkflowKey: true,
    sql: `SELECT (i.id::text || ':created') AS evidence_id, i.id::text AS source_id,
                 'pending'::text AS source_state,
                 ${AT("i.created_at")} AS at_exact,
                 ${AT("i.created_at")} AS recorded_exact
          FROM awcms_workflow_instances i
          JOIN awcms_workflow_definitions d
            ON d.id = i.workflow_definition_id AND d.tenant_id = i.tenant_id
          WHERE i.tenant_id = $1 AND d.workflow_key = $9
            ${KEYSET("i.created_at", "i.id::text || ':created'")}
          ORDER BY i.created_at, i.id
          LIMIT $8`
  },
  {
    sourceKind: "awcms_workflow_approval",
    evidenceKind: "workflow_decision",
    kind: "approval_item",
    usesWorkflowKey: true,
    sql: `SELECT (i.id::text || ':terminal') AS evidence_id, i.id::text AS source_id,
                 i.status AS source_state,
                 ${AT("i.updated_at")} AS at_exact,
                 ${AT("i.updated_at")} AS recorded_exact
          FROM awcms_workflow_instances i
          JOIN awcms_workflow_definitions d
            ON d.id = i.workflow_definition_id AND d.tenant_id = i.tenant_id
          WHERE i.tenant_id = $1 AND d.workflow_key = $9
            AND i.status IN ('approved', 'rejected', 'cancelled')
            ${KEYSET("i.updated_at", "i.id::text || ':terminal'")}
          ORDER BY i.updated_at, i.id
          LIMIT $8`
  }
];

/**
 * The positional parameters of a {@link REPLAY_QUERIES} entry: `$1` tenant,
 * `$2`/`$3` the `[lower, upper)` bounds, `$4..$7` the cursor (`at`, kind is
 * greater, kind is equal, id), `$8` the row limit and — only for the workflow
 * queries, because Postgres rejects a parameter the text never references —
 * `$9` the workflow key.
 */
export function replayQueryParams(
  spec: QuerySpec,
  args: {
    tenantId: string;
    lower: string;
    upper: string;
    cursor: ReplayCursor | null;
    limit: number;
  }
): unknown[] {
  const { cursor } = args;
  const params: unknown[] = [
    args.tenantId,
    args.lower,
    args.upper,
    cursor ? cursor.at : null,
    cursor ? spec.evidenceKind > cursor.evidenceKind : false,
    cursor ? spec.evidenceKind === cursor.evidenceKind : false,
    cursor ? cursor.evidenceId : null,
    args.limit
  ];
  if (spec.usesWorkflowKey) params.push(OMES_DESTRUCTIVE_WORKFLOW_KEY);
  return params;
}

/** Earliest retained row per source (tenant-scoped, index-backed `min`). */
async function fetchRetainedRanges(
  tx: Bun.SQL,
  tenantId: string,
  now: Date,
  readable: ReadonlySet<MissionControlSourceKind>
): Promise<Partial<Record<MissionControlSourceKind, ReplayRetainedRange>>> {
  const retained: Partial<
    Record<MissionControlSourceKind, ReplayRetainedRange>
  > = {};
  const earliestOf = async (
    sourceKind: MissionControlSourceKind,
    read: () => Promise<{ earliest: Date | string | null }[]>
  ): Promise<void> => {
    if (!readable.has(sourceKind)) return;
    const rows = await read();
    retained[sourceKind] = {
      earliest: rows[0]?.earliest ?? null,
      horizon: retentionHorizonFor(sourceKind, now)
    };
  };

  await earliestOf(
    "hermes_orchestration_tree",
    async () =>
      (await tx`
        SELECT min(event_timestamp) AS earliest
        FROM awcms_omes_hermes_orchestration_events
        WHERE tenant_id = ${tenantId}
      `) as { earliest: Date | null }[]
  );
  await earliestOf(
    "omes_health_readiness",
    async () =>
      (await tx`
        SELECT min(captured_at) AS earliest
        FROM awcms_omes_health_snapshots
        WHERE tenant_id = ${tenantId}
      `) as { earliest: Date | null }[]
  );
  await earliestOf(
    "omes_backup_status",
    async () =>
      (await tx`
        SELECT min(captured_at) AS earliest
        FROM awcms_omes_backup_snapshots
        WHERE tenant_id = ${tenantId}
      `) as { earliest: Date | null }[]
  );
  await earliestOf(
    "omes_job_status",
    async () =>
      (await tx`
        SELECT min(created_at) AS earliest
        FROM awcms_omes_jobs
        WHERE tenant_id = ${tenantId}
      `) as { earliest: Date | null }[]
  );
  await earliestOf(
    "awcms_workflow_approval",
    async () =>
      (await tx`
        SELECT min(i.created_at) AS earliest
        FROM awcms_workflow_instances i
        JOIN awcms_workflow_definitions d
          ON d.id = i.workflow_definition_id AND d.tenant_id = i.tenant_id
        WHERE i.tenant_id = ${tenantId}
          AND d.workflow_key = ${OMES_DESTRUCTIVE_WORKFLOW_KEY}
      `) as { earliest: Date | null }[]
  );
  return retained;
}

// ---------------------------------------------------------------------------
// Replay window
// ---------------------------------------------------------------------------

/**
 * One page of replay for `[from, to]` (both inclusive, whole seconds), after
 * `cursor`. The caller has validated the window (`parseReplayQuery`) and built
 * `can` (`createMissionControlCan`). The returned page is validated against the
 * vendored schema before it leaves this function.
 */
export async function fetchMissionControlReplayWindow(params: {
  tx: Bun.SQL;
  tenantId: string;
  now: Date;
  can: (request: AccessRequest) => Promise<boolean>;
  from: Date;
  to: Date;
  cursor: ReplayCursor | null;
  limit?: number;
}): Promise<MissionControlReplayWindow> {
  const { tx, tenantId, now, can, from, to, cursor } = params;
  const limit = Math.max(
    1,
    Math.min(
      params.limit ?? MISSION_CONTROL_MAX_REPLAY_EVENTS,
      MISSION_CONTROL_MAX_REPLAY_EVENTS
    )
  );
  const fromWire = toSceneTimestamp(from)!;
  const toWire = toSceneTimestamp(to)!;

  const consulted: ReplayConsultedSource[] = [];
  for (const sourceKind of MISSION_CONTROL_SOURCE_KINDS) {
    consulted.push({
      sourceKind,
      available: await can(MISSION_CONTROL_SOURCE_GUARDS[sourceKind])
    });
  }
  const readable = new Set(
    consulted.filter((source) => source.available).map((s) => s.sourceKind)
  );

  const lower = cursor ? cursor.at : toExactInstant(from)!;
  const upper = toExactInstant(new Date(to.getTime() + 1000))!;
  const rows: ReplayEvidenceRow[] = [];
  for (const spec of REPLAY_QUERIES) {
    if (!readable.has(spec.sourceKind)) continue;
    const queryRows = (await tx.unsafe(
      spec.sql,
      replayQueryParams(spec, {
        tenantId,
        lower,
        upper,
        cursor,
        limit: limit + 1
      })
    )) as EvidenceQueryRow[];
    for (const row of queryRows) {
      rows.push({
        at: row.at_exact,
        recordedAt: row.recorded_exact,
        evidenceKind: spec.evidenceKind,
        evidenceId: row.evidence_id,
        kind: spec.kind,
        sourceId: row.source_id,
        parentSourceId:
          spec.kind === "hermes_subagent"
            ? (row.parent_subagent_id ?? null)
            : null,
        sourceState: row.source_state,
        correlationId: row.correlation_id ?? null
      });
    }
  }

  const retained = await fetchRetainedRanges(tx, tenantId, now, readable);
  const evidenceGaps = computeEvidenceGaps(
    { from: fromWire, to: toWire },
    retained,
    consulted
  );

  const page = buildReplayPage(rows, {
    tenantId,
    now,
    window: { from: fromWire, to: toWire },
    limit,
    cursor,
    evidenceGaps
  });
  if (page.omitted > 0) {
    // Counts only — never row contents.
    log("warning", "omes.mission_control.replay_rows_omitted", {
      omitted: page.omitted
    });
  }
  await assertMissionControlReplayWindowValid(page.window);
  return page.window;
}

// ---------------------------------------------------------------------------
// Historical scene
// ---------------------------------------------------------------------------

const SCENE_ROW_LIMIT = 501;
const SCENE_ROW_KEEP = SCENE_ROW_LIMIT - 1;

type SceneJobRow = {
  row_id: string;
  job_id: string;
  server_id: string;
  operation: string;
  state: string;
  created_exact: string;
  updated_exact: string;
};

type SceneResultRow = {
  evidence_id: string;
  job_id: string;
  server_id: string;
  operation: string;
  reported_state: string;
  correlation_id: string | null;
  at_exact: string;
  recorded_exact: string;
};

type SceneApprovalRow = {
  instance_id: string;
  status: string;
  operation: string | null;
  created_exact: string;
  updated_exact: string;
};

const TERMINAL_JOB_EVIDENCE = new Set(["completed", "failed", "cancelled"]);
const TERMINAL_APPROVAL_EVIDENCE = new Set([
  "approved",
  "rejected",
  "cancelled"
]);

/**
 * The scene as of `asOf` for ONE viewer. Same authorization, tenant scoping
 * and fail-closed validation as the live scene; see the file header for the
 * bounds. `current_only` sources contribute only present-day ANCHORS (their
 * existing collectors are reused), shown unknown and not back-dated.
 */
export async function composeHistoricalMissionControlSceneForViewer(params: {
  tx: Bun.SQL;
  tenantId: string;
  now: Date;
  asOf: Date;
  can: (request: AccessRequest) => Promise<boolean>;
}): Promise<MissionControlSceneView> {
  const { tx, tenantId, now, asOf, can } = params;
  const collector = createMissionControlCollector({ tx, tenantId, now, can });

  // Present-day anchors for the `current_only` kinds (consulted first, in the
  // live scene's own order; their records are neutralised by the composer).
  await collectServerRecords(collector);
  await collectDeploymentRecords(collector);
  await collectArchitectureRecords(collector);
  await collectRepositoryProgressRecords(collector);
  await collectAiPrivacyRecords(collector);
  const anchors = [...collector.records];

  const asOfWire = toSceneTimestamp(asOf)!;
  const upper = toExactInstant(new Date(asOf.getTime() + 1000))!;
  const lookback = toExactInstant(
    new Date(asOf.getTime() - MISSION_CONTROL_SCENE_LOOKBACK_MS)
  )!;

  const evidence: HistoricalEvidenceRow[] = [];
  let extraTruncated = 0;
  const bound = <T>(rows: T[]): T[] => {
    if (rows.length > SCENE_ROW_KEEP) {
      extraTruncated += rows.length - SCENE_ROW_KEEP;
      return rows.slice(0, SCENE_ROW_KEEP);
    }
    return rows;
  };

  // Sources whose own retention policy has already purged `as_of`: reported
  // unavailable (and `retention_expired` below), never read.
  const purged = new Set<MissionControlSourceKind>();
  const consultEvent = async (
    sourceKind: MissionControlSourceKind
  ): Promise<boolean> => {
    const allowed = await collector.consult(
      sourceKind,
      MISSION_CONTROL_SOURCE_GUARDS[sourceKind]
    );
    if (!allowed) return false;
    const horizon = retentionHorizonFor(sourceKind, now);
    if (horizon !== null && asOf.getTime() < horizon.getTime()) {
      purged.add(sourceKind);
      collector.sources[collector.sources.length - 1] = {
        sourceKind,
        available: false
      };
      return false;
    }
    return true;
  };

  // --- Jobs (terminal_transitions) -----------------------------------------
  if (await consultEvent("omes_job_status")) {
    const newest = (await tx`
      SELECT id::text AS row_id, job_id, server_id, operation, state,
             ${tx.unsafe(AT("created_at"))} AS created_exact,
             ${tx.unsafe(AT("updated_at"))} AS updated_exact
      FROM awcms_omes_jobs
      WHERE tenant_id = ${tenantId} AND created_at < ${upper}::timestamptz
      ORDER BY created_at DESC, id DESC
      LIMIT ${SCENE_ROW_LIMIT}
    `) as SceneJobRow[];
    const terminal = (await tx`
      SELECT id::text AS row_id, job_id, server_id, operation, state,
             ${tx.unsafe(AT("created_at"))} AS created_exact,
             ${tx.unsafe(AT("updated_at"))} AS updated_exact
      FROM awcms_omes_jobs
      WHERE tenant_id = ${tenantId}
        AND state IN ('completed', 'failed', 'cancelled')
        AND updated_at >= ${lookback}::timestamptz
        AND updated_at < ${upper}::timestamptz
      ORDER BY updated_at DESC, id DESC
      LIMIT ${SCENE_ROW_LIMIT}
    `) as SceneJobRow[];
    const results = (await tx`
      SELECT DISTINCT ON (j.job_id)
             r.id::text AS evidence_id, j.job_id, j.server_id, j.operation,
             r.reported_state, r.correlation_id,
             ${tx.unsafe(AT("r.completed_at"))} AS at_exact,
             ${tx.unsafe(AT("r.created_at"))} AS recorded_exact
      FROM awcms_omes_worker_results r
      JOIN awcms_omes_jobs j
        ON j.tenant_id = r.tenant_id
       AND j.server_id = r.server_id
       AND j.idempotency_key = r.idempotency_key
      WHERE r.tenant_id = ${tenantId}
        AND r.completed_at >= ${lookback}::timestamptz
        AND r.completed_at < ${upper}::timestamptz
      ORDER BY j.job_id, r.completed_at DESC, r.id DESC
      LIMIT ${SCENE_ROW_LIMIT}
    `) as SceneResultRow[];

    const seenJobRows = new Set<string>();
    for (const row of bound([...newest, ...terminal])) {
      if (seenJobRows.has(row.row_id)) continue;
      seenJobRows.add(row.row_id);
      const base = {
        kind: "job" as const,
        sourceId: row.job_id,
        label: row.operation,
        serverId: row.server_id
      };
      evidence.push({
        ...base,
        at: row.created_exact,
        recordedAt: row.created_exact,
        evidenceKind: "job_record",
        evidenceId: `${row.row_id}:created`,
        sourceState: "queued"
      });
      if (TERMINAL_JOB_EVIDENCE.has(row.state)) {
        evidence.push({
          ...base,
          at: row.updated_exact,
          recordedAt: row.updated_exact,
          evidenceKind: "job_record",
          evidenceId: `${row.row_id}:terminal`,
          sourceState: row.state
        });
      }
    }
    for (const row of bound(results)) {
      evidence.push({
        kind: "job",
        sourceId: row.job_id,
        label: row.operation,
        serverId: row.server_id,
        at: row.at_exact,
        recordedAt: row.recorded_exact,
        evidenceKind: "worker_result",
        evidenceId: row.evidence_id,
        sourceState: row.reported_state,
        correlationId: row.correlation_id
      });
    }
  }

  // --- Health (snapshot_series) --------------------------------------------
  if (await consultEvent("omes_health_readiness")) {
    const snapshots = (await tx`
      SELECT DISTINCT ON (server_id)
             id::text AS evidence_id, server_id, overall_status,
             ${tx.unsafe(AT("captured_at"))} AS at_exact,
             ${tx.unsafe(AT("created_at"))} AS recorded_exact
      FROM awcms_omes_health_snapshots
      WHERE tenant_id = ${tenantId}
        AND captured_at >= ${lookback}::timestamptz
        AND captured_at < ${upper}::timestamptz
      ORDER BY server_id, captured_at DESC, id DESC
      LIMIT ${SCENE_ROW_LIMIT}
    `) as {
      evidence_id: string;
      server_id: string;
      overall_status: string;
      at_exact: string;
      recorded_exact: string;
    }[];
    for (const row of bound(snapshots)) {
      evidence.push({
        kind: "health_report",
        sourceId: row.server_id,
        label: row.server_id,
        serverId: row.server_id,
        at: row.at_exact,
        recordedAt: row.recorded_exact,
        evidenceKind: "health_snapshot",
        evidenceId: row.evidence_id,
        sourceState: row.overall_status
      });
    }
  }

  // --- Backups (snapshot_series) -------------------------------------------
  if (await consultEvent("omes_backup_status")) {
    const backups = (await tx`
      SELECT id::text AS evidence_id, backup_id, server_id, status,
             ${tx.unsafe(AT("captured_at"))} AS at_exact,
             ${tx.unsafe(AT("created_at"))} AS recorded_exact
      FROM awcms_omes_backup_snapshots
      WHERE tenant_id = ${tenantId} AND captured_at < ${upper}::timestamptz
      ORDER BY captured_at DESC, id DESC
      LIMIT ${SCENE_ROW_LIMIT}
    `) as {
      evidence_id: string;
      backup_id: string;
      server_id: string;
      status: string;
      at_exact: string;
      recorded_exact: string;
    }[];
    for (const row of bound(backups)) {
      evidence.push({
        kind: "backup",
        sourceId: row.backup_id,
        label: row.backup_id,
        serverId: row.server_id,
        at: row.at_exact,
        recordedAt: row.recorded_exact,
        evidenceKind: "backup_snapshot",
        evidenceId: row.evidence_id,
        sourceState: row.status
      });
    }
  }

  // --- Hermes orchestration (event_log) ------------------------------------
  if (await consultEvent("hermes_orchestration_tree")) {
    const events = (await tx`
      SELECT DISTINCT ON (subagent_id)
             id::text AS evidence_id, subagent_id, parent_subagent_id,
             server_id, role, state, correlation_id,
             ${tx.unsafe(AT("event_timestamp"))} AS at_exact,
             ${tx.unsafe(AT("received_at"))} AS recorded_exact
      FROM awcms_omes_hermes_orchestration_events
      WHERE tenant_id = ${tenantId}
        AND event_timestamp >= ${lookback}::timestamptz
        AND event_timestamp < ${upper}::timestamptz
      ORDER BY subagent_id, event_timestamp DESC, id DESC
      LIMIT ${SCENE_ROW_LIMIT}
    `) as {
      evidence_id: string;
      subagent_id: string;
      parent_subagent_id: string | null;
      server_id: string;
      role: string | null;
      state: string;
      correlation_id: string | null;
      at_exact: string;
      recorded_exact: string;
    }[];
    for (const row of bound(events)) {
      evidence.push({
        kind: "hermes_subagent",
        sourceId: row.subagent_id,
        parentSourceId: row.parent_subagent_id,
        label: row.role,
        serverId: row.server_id,
        at: row.at_exact,
        recordedAt: row.recorded_exact,
        evidenceKind: "hermes_event",
        evidenceId: row.evidence_id,
        sourceState: row.state,
        correlationId: row.correlation_id
      });
    }
  }

  // --- Workflow approvals (terminal_transitions) ---------------------------
  if (await consultEvent("awcms_workflow_approval")) {
    const newest = (await tx`
      SELECT i.id::text AS instance_id, i.status, r.operation,
             ${tx.unsafe(AT("i.created_at"))} AS created_exact,
             ${tx.unsafe(AT("i.updated_at"))} AS updated_exact
      FROM awcms_workflow_instances i
      JOIN awcms_workflow_definitions d
        ON d.id = i.workflow_definition_id AND d.tenant_id = i.tenant_id
      LEFT JOIN awcms_omes_operation_requests r
        ON r.workflow_instance_id = i.id AND r.tenant_id = i.tenant_id
      WHERE i.tenant_id = ${tenantId}
        AND d.workflow_key = ${OMES_DESTRUCTIVE_WORKFLOW_KEY}
        AND i.created_at < ${upper}::timestamptz
      ORDER BY i.created_at DESC, i.id DESC
      LIMIT ${SCENE_ROW_LIMIT}
    `) as SceneApprovalRow[];
    const terminal = (await tx`
      SELECT i.id::text AS instance_id, i.status, r.operation,
             ${tx.unsafe(AT("i.created_at"))} AS created_exact,
             ${tx.unsafe(AT("i.updated_at"))} AS updated_exact
      FROM awcms_workflow_instances i
      JOIN awcms_workflow_definitions d
        ON d.id = i.workflow_definition_id AND d.tenant_id = i.tenant_id
      LEFT JOIN awcms_omes_operation_requests r
        ON r.workflow_instance_id = i.id AND r.tenant_id = i.tenant_id
      WHERE i.tenant_id = ${tenantId}
        AND d.workflow_key = ${OMES_DESTRUCTIVE_WORKFLOW_KEY}
        AND i.status IN ('approved', 'rejected', 'cancelled')
        AND i.updated_at >= ${lookback}::timestamptz
        AND i.updated_at < ${upper}::timestamptz
      ORDER BY i.updated_at DESC, i.id DESC
      LIMIT ${SCENE_ROW_LIMIT}
    `) as SceneApprovalRow[];
    const seen = new Set<string>();
    for (const row of bound([...newest, ...terminal])) {
      if (seen.has(row.instance_id)) continue;
      seen.add(row.instance_id);
      const base = {
        kind: "approval_item" as const,
        sourceId: row.instance_id,
        label: row.operation
      };
      evidence.push({
        ...base,
        at: row.created_exact,
        recordedAt: row.created_exact,
        evidenceKind: "workflow_decision",
        evidenceId: `${row.instance_id}:created`,
        sourceState: "pending"
      });
      if (TERMINAL_APPROVAL_EVIDENCE.has(row.status)) {
        evidence.push({
          ...base,
          at: row.updated_exact,
          recordedAt: row.updated_exact,
          evidenceKind: "workflow_decision",
          evidenceId: `${row.instance_id}:terminal`,
          sourceState: row.status
        });
      }
    }
  }

  // --- Gaps over the 24 h up to as_of --------------------------------------
  const gapWindow = {
    from: toSceneTimestamp(
      new Date(asOf.getTime() - MISSION_CONTROL_SCENE_LOOKBACK_MS)
    )!,
    to: asOfWire
  };
  const available = new Set(
    collector.sources.filter((s) => s.available).map((s) => s.sourceKind)
  );
  // A purged source is `unavailable` in sources[] but `retention_expired` in
  // the gaps (it WAS readable; its evidence is gone), so it is consulted as
  // available for the gap computation.
  const consulted: ReplayConsultedSource[] = collector.sources.map(
    (source) => ({
      sourceKind: source.sourceKind,
      available: source.available || purged.has(source.sourceKind)
    })
  );
  const retained = await fetchRetainedRanges(
    tx,
    tenantId,
    now,
    new Set([...available, ...purged])
  );
  const gaps = computeEvidenceGaps(gapWindow, retained, consulted);

  const scene = composeHistoricalScene(
    {
      sources: collector.sources,
      evidence,
      anchors,
      gaps,
      extraTruncatedNodes: extraTruncated
    },
    { tenantId, now, asOf }
  );
  await assertMissionControlSceneValid(scene);
  return scene;
}
