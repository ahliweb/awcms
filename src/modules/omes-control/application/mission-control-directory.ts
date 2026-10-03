/**
 * Server-side composition of the 3D Mission Control scene for ONE viewer
 * (Issue ahliweb/omes#265, epic ahliweb/omes#263; ADR-0031). Backs
 * `GET /api/v1/omes/mission-control/scene` and the SSR snapshot of
 * `/admin/omes/mission-control`.
 *
 * ## No new authority, no new SQL surface (ADR-0031 rules 1 and 3)
 *
 * This file gathers inputs by REUSING the read functions the canonical
 * screens already use — `server-directory`, `deployment-directory`,
 * `job-directory`, `health-directory`, `backup-directory`,
 * `hermes-orchestration-directory`, `architecture-directory`,
 * `repository-progress-directory`, `ai-privacy-directory` — and hands the
 * projected records to the pure `composeScene` (`domain/mission-control.ts`).
 * The single query written here is the pending-approval read, because no
 * existing workflow read function exposes the instance `updated_at` and the
 * `facts.deploymentId` link that `awaits_decision_for` needs (the inbox
 * reader is task-shaped and carries neither); it is read-only, tenant-scoped
 * (and RLS-scoped), bounded, and uses an explicit column list. It follows the
 * documented `omes_control -> workflow` cross-module exception
 * (`tests/module-boundary.test.ts`): `operation-submission.ts` already reads
 * `awcms_workflow_definitions` the same way.
 *
 * ## Authorization is per source, and a denied source is `unavailable`
 *
 * The route's own guard (`omes_control.servers.read`) only admits the
 * viewer to the workspace. Each source is then included ONLY if
 * `can(<the source map's read_permission>)` allows it; otherwise the source
 * is reported `unavailable` and none of its nodes are read, composed, or
 * even queried. A permission-limited viewer therefore sees a smaller scene
 * that SAYS it is smaller — never a scene that silently looks healthy
 * because a zone is empty. Sequential on purpose: `tx` is one reserved
 * connection (never `Promise.all` on it).
 *
 * ## Bounds (documented, enforced by the reused readers)
 *
 * Servers, deployments and backups: the newest 500 (up to 5 keyset pages of
 * 100). Jobs: every NON-terminal job (up to 100 per non-terminal state) plus
 * the {@link MISSION_CONTROL_RECENT_JOB_LIMIT} most recent terminal ones —
 * a job that finished long ago is not scene state, and a failed one is still
 * visible on `/admin/omes/jobs`. Health: latest snapshot per server.
 * Hermes: the reader's newest 100 trees. Approvals:
 * {@link MISSION_CONTROL_PENDING_APPROVAL_LIMIT} pending. `composeScene`
 * then applies the scene's own 500-node / 1000-relation caps and reports
 * what it dropped in `truncated`.
 *
 * ## Fail closed
 *
 * The composed object is validated against the vendored scene-view schema
 * before it leaves this function; an invalid composition throws
 * `MissionControlSceneInvalidError` (paths only, never values). A database
 * error propagates (a poisoned transaction cannot be partially trusted) —
 * only the DB-free architecture snapshot read degrades to `unavailable`.
 * Label/summary contents are never logged.
 */
import { log } from "../../../lib/logging/logger";
import { sanitizeErrorForLog } from "../../../lib/logging/error-sanitizer";
import { authorizeInTransaction } from "../../identity-access/application/access-guard";
import { createAuthorizationReadCache } from "../../identity-access/application/authorization-read-cache";
import type { AccessRequest } from "../../identity-access/domain/access-control";
import {
  decodeKeysetCursor,
  type KeysetCursor
} from "../../_shared/keyset-pagination";
import { STALE_HEARTBEAT_THRESHOLD_MS } from "../domain/staleness";
import { OMES_DESTRUCTIVE_WORKFLOW_KEY } from "../domain/operations";
import { OMES_GUARDS } from "../domain/permissions";
import {
  assertMissionControlSceneValid,
  composeScene,
  freshnessFromAge,
  sourceFreshnessBudgetSeconds,
  TERMINAL_JOB_STATES,
  toSceneTimestamp,
  type MissionControlDecisionTarget,
  type MissionControlRecordInput,
  type MissionControlSourceInput
} from "../domain/mission-control";
import type {
  MissionControlFreshness,
  MissionControlSceneView,
  MissionControlSourceKind
} from "../domain/mission-control-types";
import { fetchServers } from "./server-directory";
import {
  fetchDeployments,
  STALE_RECONCILIATION_THRESHOLD_MS
} from "./deployment-directory";
import { fetchJobs, type JobSummary } from "./job-directory";
import { fetchLatestHealthPerServer } from "./health-directory";
import {
  BACKUP_FRESHNESS_THRESHOLD_MS,
  fetchBackups,
  type BackupSnapshotSummary
} from "./backup-directory";
import { fetchOrchestrationTrees } from "./hermes-orchestration-directory";
import { fetchArchitectureSnapshot } from "./architecture-directory";
import { fetchRepositoryProgress } from "./repository-progress-directory";
import { fetchAiPrivacyPosture } from "./ai-privacy-directory";

/**
 * The AWCMS workflow-approval read permission (source map
 * `awcms_workflow_approval.read_permission` = `workflow.approval.read`) —
 * the same guard `/admin/approvals` is gated on.
 */
export const MISSION_CONTROL_WORKFLOW_APPROVAL_READ_GUARD = {
  moduleKey: "workflow",
  activityCode: "approval",
  action: "read"
} as const satisfies AccessRequest;

/** Most recent TERMINAL jobs included (non-terminal jobs are always included, bounded by the reader's page size). */
export const MISSION_CONTROL_RECENT_JOB_LIMIT = 100;
/** Pending destructive-operation approvals included. */
export const MISSION_CONTROL_PENDING_APPROVAL_LIMIT = 100;
/** Keyset pages read for servers / deployments / backups (100 rows each). */
const MAX_PAGES = 5;

/** Non-terminal states read with an explicit state filter so an old stuck job is never crowded out by newer terminal ones. */
const NON_TERMINAL_JOB_STATES = ["queued", "leased", "running"] as const;

async function collectPages<TItem>(
  fetchPage: (
    cursor: KeysetCursor | undefined
  ) => Promise<{ items: TItem[]; nextCursor: string | null }>
): Promise<TItem[]> {
  const items: TItem[] = [];
  let cursor: KeysetCursor | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await fetchPage(cursor);
    items.push(...result.items);
    if (!result.nextCursor) break;
    const decoded = decodeKeysetCursor(result.nextCursor);
    if (!decoded) break;
    cursor = decoded;
  }
  return items;
}

function secondsOf(thresholdMs: number): number {
  return thresholdMs / 1000;
}

type PendingApprovalRow = {
  instance_id: string;
  operation_request_id: string;
  operation: string;
  backup_row_id: string | null;
  deployment_id: string | null;
  updated_at: Date;
};

/**
 * Pending `omes_control.destructive_operation` workflow instances, linked to
 * their operation request via `awcms_omes_operation_requests.
 * workflow_instance_id` (the link `operation-submission.ts` /
 * `backup-restore.ts` write). READ-ONLY; decisions are made only in the
 * canonical `/admin/approvals` inbox.
 */
async function fetchPendingDestructiveApprovals(
  tx: Bun.SQL,
  tenantId: string
): Promise<PendingApprovalRow[]> {
  return (await tx`
    SELECT i.id AS instance_id,
           r.id AS operation_request_id,
           r.operation,
           r.parameters ->> 'backupId' AS backup_row_id,
           i.facts ->> 'deploymentId' AS deployment_id,
           i.updated_at
    FROM awcms_workflow_instances i
    JOIN awcms_workflow_definitions d
      ON d.id = i.workflow_definition_id AND d.tenant_id = i.tenant_id
    JOIN awcms_omes_operation_requests r
      ON r.workflow_instance_id = i.id AND r.tenant_id = i.tenant_id
    WHERE i.tenant_id = ${tenantId}
      AND i.status = 'pending'
      AND d.workflow_key = ${OMES_DESTRUCTIVE_WORKFLOW_KEY}
    ORDER BY i.created_at DESC, i.id DESC
    LIMIT ${MISSION_CONTROL_PENDING_APPROVAL_LIMIT}
  `) as PendingApprovalRow[];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function repositoryFreshness(
  freshness: "fresh" | "stale" | "unknown"
): MissionControlFreshness {
  return freshness === "fresh" ? "live" : freshness;
}

/**
 * The per-source read check both Mission Control routes (scene and replay) use:
 * `authorizeInTransaction` over the caller's own session — the same chokepoint
 * every guarded route uses — so a source the viewer may not read is reported
 * `unavailable` and never queried. One read cache is shared across the
 * evaluations of a request (the memo `loadAdminScreen` uses for the same
 * reason), and `clientIp` is forwarded so a machine credential's IP
 * restriction is enforced for them too. Historical replay is never more
 * permissive than the live view: it asks the SAME guards.
 */
export function createMissionControlCan(params: {
  tx: Bun.SQL;
  tenantId: string;
  tokenHash: string;
  now: Date;
  clientIp?: string;
}): (guard: AccessRequest) => Promise<boolean> {
  const options = {
    clientIp: params.clientIp,
    readCache: createAuthorizationReadCache()
  };
  return async (guard) => {
    const result = await authorizeInTransaction(
      params.tx,
      params.tenantId,
      params.tokenHash,
      params.now,
      guard,
      options
    );
    return result.allowed;
  };
}

/**
 * The mutable accumulator the per-source collectors write into: which sources
 * were consulted (and whether the viewer could read them) and the projected
 * records. Shared by the live composition below and by the historical scene
 * (`mission-control-replay-directory.ts`), which reuses the `current_only`
 * collectors for its present-day anchors instead of duplicating their reads.
 */
export type MissionControlCollector = {
  tx: Bun.SQL;
  tenantId: string;
  now: Date;
  sources: MissionControlSourceInput[];
  records: MissionControlRecordInput[];
  /** Server heartbeat freshness by server id (a non-terminal job inherits it). */
  serverFreshness: Map<string, MissionControlFreshness>;
  /** Records the source as consulted and returns whether the viewer may read it. */
  consult: (
    sourceKind: MissionControlSourceKind,
    guard: AccessRequest
  ) => Promise<boolean>;
};

export function createMissionControlCollector(params: {
  tx: Bun.SQL;
  tenantId: string;
  now: Date;
  can: (request: AccessRequest) => Promise<boolean>;
}): MissionControlCollector {
  const sources: MissionControlSourceInput[] = [];
  return {
    tx: params.tx,
    tenantId: params.tenantId,
    now: params.now,
    sources,
    records: [],
    serverFreshness: new Map(),
    consult: async (sourceKind, guard) => {
      const allowed = await params.can(guard);
      sources.push({ sourceKind, available: allowed });
      return allowed;
    }
  };
}

/** Servers (`omes_control.servers.read`). `current_only`. */
export async function collectServerRecords(
  c: MissionControlCollector
): Promise<void> {
  const { tx, tenantId, now, records, consult } = c;
  // --- Servers (omes_control.servers.read) --------------------------------
  const { serverFreshness } = c;
  if (await consult("omes_server_inventory", OMES_GUARDS.servers.read)) {
    const servers = await collectPages(async (cursor) => {
      const page = await fetchServers(tx, tenantId, now, { cursor });
      return { items: page.servers, nextCursor: page.nextCursor };
    });
    for (const server of servers) {
      const freshness = freshnessFromAge(
        server.lastHeartbeatAt,
        now,
        secondsOf(STALE_HEARTBEAT_THRESHOLD_MS)
      );
      serverFreshness.set(server.serverId, freshness);
      records.push({
        kind: "server",
        sourceId: server.serverId,
        label: server.hostname,
        sourceState: server.status,
        freshness,
        observedAt: server.lastHeartbeatAt
      });
    }
  }
}

/** Deployments (`omes_control.deployments.read`). `current_only`. */
export async function collectDeploymentRecords(
  c: MissionControlCollector
): Promise<void> {
  const { tx, tenantId, now, records, consult } = c;
  // --- Deployments (omes_control.deployments.read) ------------------------
  if (await consult("omes_deployment_view", OMES_GUARDS.deployments.read)) {
    const deployments = await collectPages(async (cursor) => {
      const page = await fetchDeployments(tx, tenantId, now, { cursor });
      return { items: page.deployments, nextCursor: page.nextCursor };
    });
    for (const deployment of deployments) {
      records.push({
        kind: "deployment",
        sourceId: deployment.deploymentId,
        label: deployment.deploymentId,
        sourceState: deployment.reconciliationStatus,
        freshness: freshnessFromAge(
          deployment.lastReconciledAt,
          now,
          secondsOf(STALE_RECONCILIATION_THRESHOLD_MS)
        ),
        observedAt: deployment.lastReconciledAt,
        evidence: { serverId: deployment.serverId }
      });
    }
  }
}

/** Architecture planes and capabilities (`omes_control.architecture.read`). `current_only`. */
export async function collectArchitectureRecords(
  c: MissionControlCollector
): Promise<void> {
  const { sources, records, consult } = c;
  // --- Architecture snapshot (omes_control.architecture.read) -------------
  if (
    await consult(
      "omes_architecture_capabilities_view",
      OMES_GUARDS.architecture.read
    )
  ) {
    try {
      const snapshot = await fetchArchitectureSnapshot();
      // A pinned RELEASE snapshot, not live host evidence: observed_at is
      // the real vendoring time (`PIN.json`), never the fixture's
      // placeholder `generated_at`.
      const observedAt = snapshot.provenance.vendoredAt;
      for (const lane of snapshot.lanes) {
        records.push({
          kind: "architecture_plane",
          sourceId: lane.plane.id,
          label: lane.plane.name,
          sourceState: lane.plane.executionSemantics,
          freshness: "live",
          observedAt
        });
        for (const capability of lane.capabilities) {
          records.push({
            kind: "capability",
            sourceId: capability.id,
            label: capability.name,
            sourceState: capability.implementationStatus,
            freshness: "live",
            observedAt,
            evidence: { planeId: capability.plane }
          });
        }
      }
    } catch (error) {
      // No database involved, so the transaction is unharmed: degrade this
      // ONE source to `unavailable` rather than fail the whole scene.
      sources[sources.length - 1] = {
        sourceKind: "omes_architecture_capabilities_view",
        available: false
      };
      log("error", "omes.mission_control.architecture_unavailable", {
        error: sanitizeErrorForLog(error) as unknown as Record<string, unknown>
      });
    }
  }
}

/** Repository milestones (`omes_control.hermes_orchestration.read`). `current_only`. */
export async function collectRepositoryProgressRecords(
  c: MissionControlCollector
): Promise<void> {
  const { tx, tenantId, now, sources, records, consult } = c;
  // --- Repository progress (omes_control.hermes_orchestration.read) -------
  if (
    await consult(
      "github_repository_progress_view",
      OMES_GUARDS.hermesOrchestration.read
    )
  ) {
    const progress = await fetchRepositoryProgress(tx, tenantId, now);
    if (progress.state === "unconfigured") {
      // Not configured is not "healthy and empty": report it unavailable.
      sources[sources.length - 1] = {
        sourceKind: "github_repository_progress_view",
        available: false
      };
    } else {
      for (const milestone of progress.milestones) {
        records.push({
          kind: "repository_milestone",
          sourceId: String(milestone.number),
          label: milestone.title,
          sourceState: milestone.state,
          freshness: repositoryFreshness(progress.freshness),
          observedAt: progress.observedAt
        });
      }
    }
  }
}

/** AI privacy posture (`omes_control.ai_privacy.read`). `current_only`. */
export async function collectAiPrivacyRecords(
  c: MissionControlCollector
): Promise<void> {
  const { tx, tenantId, now, records, consult } = c;
  // --- AI privacy posture (omes_control.ai_privacy.read) ------------------
  if (
    await consult("omes_ai_privacy_posture_view", OMES_GUARDS.aiPrivacy.read)
  ) {
    const posture = await fetchAiPrivacyPosture(tx, tenantId, now);
    for (const row of posture.posture) {
      records.push({
        kind: "ai_privacy_posture",
        sourceId: row.serverId,
        label: row.serverId,
        // The EFFECTIVE status (stale/unknown evidence already downgraded
        // from PASS) — the field the AI Privacy screen itself displays.
        sourceState: row.effectiveStatus,
        freshness: repositoryFreshness(row.evidenceFreshness),
        observedAt: row.lastVerifiedAt,
        evidence: { serverId: row.serverId }
      });
    }
  }
}

export async function composeMissionControlSceneForViewer(params: {
  tx: Bun.SQL;
  tenantId: string;
  now: Date;
  can: (request: AccessRequest) => Promise<boolean>;
}): Promise<MissionControlSceneView> {
  const { tx, tenantId, now, can } = params;
  const collector = createMissionControlCollector({ tx, tenantId, now, can });
  const { sources, records, serverFreshness, consult } = collector;

  // --- Servers + Deployments (current_only; shared collectors) ------------
  await collectServerRecords(collector);
  await collectDeploymentRecords(collector);

  // --- Jobs (omes_control.jobs.read) --------------------------------------
  const jobIdByOperationRequest = new Map<string, string>();
  if (await consult("omes_job_status", OMES_GUARDS.jobs.read)) {
    const byJobId = new Map<string, JobSummary>();
    for (const state of NON_TERMINAL_JOB_STATES) {
      const page = await fetchJobs(tx, tenantId, { state });
      for (const job of page.jobs) byJobId.set(job.jobId, job);
    }
    const recent = await fetchJobs(tx, tenantId, {});
    let terminalTaken = 0;
    for (const job of recent.jobs) {
      if (!TERMINAL_JOB_STATES.has(job.state)) {
        byJobId.set(job.jobId, job);
        continue;
      }
      if (terminalTaken < MISSION_CONTROL_RECENT_JOB_LIMIT) {
        byJobId.set(job.jobId, job);
        terminalTaken += 1;
      }
    }

    for (const job of byJobId.values()) {
      if (job.operationRequestId) {
        jobIdByOperationRequest.set(job.operationRequestId, job.jobId);
      }
      const target =
        typeof job.target === "object" && job.target !== null
          ? (job.target as Record<string, unknown>)
          : {};
      records.push({
        kind: "job",
        sourceId: job.jobId,
        label: job.operation,
        sourceState: job.state,
        // A non-terminal job inherits its target server's heartbeat
        // freshness; a terminal job is final evidence and never goes stale.
        freshness: TERMINAL_JOB_STATES.has(job.state)
          ? "live"
          : (serverFreshness.get(job.serverId) ?? "unknown"),
        observedAt: job.updatedAt,
        evidence: {
          serverId: job.serverId,
          deploymentId: stringOrNull(target.deployment_id)
        }
      });
    }
  }

  // --- Health (omes_control.servers.read) ---------------------------------
  if (await consult("omes_health_readiness", OMES_GUARDS.servers.read)) {
    const budget = sourceFreshnessBudgetSeconds("omes_health_readiness");
    for (const snapshot of await fetchLatestHealthPerServer(
      tx,
      tenantId,
      now
    )) {
      records.push({
        kind: "health_report",
        sourceId: snapshot.serverId,
        label: snapshot.serverId,
        sourceState: snapshot.overallStatus,
        freshness: freshnessFromAge(snapshot.capturedAt, now, budget),
        observedAt: snapshot.capturedAt,
        evidence: { serverId: snapshot.serverId }
      });
    }
  }

  // --- Backups (omes_control.backups.read) --------------------------------
  const backupsByRowId = new Map<string, BackupSnapshotSummary>();
  if (await consult("omes_backup_status", OMES_GUARDS.backups.read)) {
    const backups = await collectPages(async (cursor) => {
      const page = await fetchBackups(tx, tenantId, now, { cursor });
      return { items: page.backups, nextCursor: page.nextCursor };
    });
    for (const backup of backups) {
      backupsByRowId.set(backup.id, backup);
      records.push({
        kind: "backup",
        sourceId: backup.backupId,
        label: backup.backupId,
        sourceState: backup.status,
        freshness: freshnessFromAge(
          backup.capturedAt,
          now,
          secondsOf(BACKUP_FRESHNESS_THRESHOLD_MS)
        ),
        observedAt: backup.capturedAt,
        evidence: { serverId: backup.serverId }
      });
    }
  }

  // --- Hermes orchestration (omes_control.hermes_orchestration.read) ------
  if (
    await consult(
      "hermes_orchestration_tree",
      OMES_GUARDS.hermesOrchestration.read
    )
  ) {
    for (const tree of await fetchOrchestrationTrees(tx, tenantId, now)) {
      for (const node of tree.nodes) {
        if (node.subagentId === "") continue;
        records.push({
          kind: "hermes_subagent",
          sourceId: node.subagentId,
          label: node.role ?? node.subagentId,
          // The reader's recognised state: an unrecognised stored value is
          // already `UNKNOWN` here, never something healthier.
          sourceState: node.effectiveState,
          freshness: tree.freshness,
          observedAt: tree.generatedAt,
          summary: node.summary,
          evidence: {
            serverId: tree.serverId,
            parentSourceId: node.parentSubagentId
          }
        });
      }
    }
  }

  // --- Architecture, repository progress, AI privacy (current_only) ------
  await collectArchitectureRecords(collector);
  await collectRepositoryProgressRecords(collector);
  await collectAiPrivacyRecords(collector);

  // --- Pending destructive-operation approvals (workflow.approval.read) ---
  if (
    await consult(
      "awcms_workflow_approval",
      MISSION_CONTROL_WORKFLOW_APPROVAL_READ_GUARD
    )
  ) {
    for (const row of await fetchPendingDestructiveApprovals(tx, tenantId)) {
      const decisionFor: MissionControlDecisionTarget[] = [];
      const jobId = jobIdByOperationRequest.get(row.operation_request_id);
      if (jobId) decisionFor.push({ kind: "job", sourceId: jobId });
      if (row.deployment_id) {
        decisionFor.push({ kind: "deployment", sourceId: row.deployment_id });
      }
      const backup = row.backup_row_id
        ? backupsByRowId.get(row.backup_row_id)
        : undefined;
      if (backup)
        decisionFor.push({ kind: "backup", sourceId: backup.backupId });

      records.push({
        kind: "approval_item",
        sourceId: row.instance_id,
        label: row.operation,
        // Only `pending` instances are read; the map classifies it `pending`.
        sourceState: "pending",
        freshness: "live",
        observedAt: toSceneTimestamp(row.updated_at),
        evidence: { decisionFor }
      });
    }
  }

  const scene = composeScene({ sources, records }, { tenantId, now });
  await assertMissionControlSceneValid(scene);
  return scene;
}
