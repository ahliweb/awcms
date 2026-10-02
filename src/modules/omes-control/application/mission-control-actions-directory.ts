/**
 * Server-side, ADVISORY action availability for ONE selected Mission Control
 * object (Issue ahliweb/omes#267, epic ahliweb/omes#263, ADR-0031 rule 3).
 * Backs `GET /api/v1/omes/mission-control/actions?kind=&id=`.
 *
 * ## Advisory only — the mutation endpoints are the authority
 *
 * This answers "what could this viewer do to this object right now?" so the
 * UI can enable, disable and explain buttons. It authorizes NOTHING: every
 * mutation is a call to an existing endpoint (`POST /api/v1/omes/operations`,
 * `POST /jobs/{id}/cancel|approve`, `POST /backups/{id}/restore`) that
 * re-authorizes, rate-limits, applies the destructive-workflow gate, audits
 * and enforces idempotency on its own. The pure rules (which actions a kind
 * has, which existing endpoint rules make one unavailable, which warnings are
 * non-blocking advisories) live in `domain/mission-control-actions.ts`; this
 * file only loads the ONE target record and the viewer's permissions.
 *
 * ## One tenant-scoped record, never an existence oracle
 *
 * The record is read by `(kind, source_id)` with an explicit column list and a
 * tenant filter (RLS applies on top). A record that does not exist, belongs to
 * another tenant, or sits in a source the viewer may not read (the source
 * map's `read_permission`, the same guard the scene applies per source) all
 * produce the SAME answer — a `null` record, so every action is `not_found`.
 * A viewer therefore cannot tell "no such object" from "an object I may not
 * see". `permission_denied` is only ever reported for an object the viewer can
 * already see in the scene.
 *
 * Read-only kinds (health, Hermes, architecture, repository, AI privacy) reuse
 * the #265 collectors / existing readers so "exists" means exactly "the scene
 * would show it".
 */
import type { AccessRequest } from "../../identity-access/domain/access-control";
import { STALE_HEARTBEAT_THRESHOLD_MS } from "../domain/staleness";
import { OMES_DESTRUCTIVE_WORKFLOW_KEY } from "../domain/operations";
import {
  freshnessFromAge,
  TERMINAL_JOB_STATES
} from "../domain/mission-control";
import {
  actionPermissionGuard,
  candidateActionsForKind,
  evaluateMissionControlActions,
  type MissionControlActionEvaluation,
  type MissionControlActionRecord
} from "../domain/mission-control-actions";
import type { MissionControlKind } from "../domain/mission-control-types";
import {
  collectAiPrivacyRecords,
  collectArchitectureRecords,
  collectRepositoryProgressRecords,
  createMissionControlCollector
} from "./mission-control-directory";
import { STALE_RECONCILIATION_THRESHOLD_MS } from "./deployment-directory";
import { BACKUP_FRESHNESS_THRESHOLD_MS } from "./backup-directory";
import { fetchLatestHealthPerServer } from "./health-directory";
import { fetchOrchestrationTrees } from "./hermes-orchestration-directory";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The exact body `POST /api/v1/omes/operations` takes (what operations.astro sends). */
export type MissionControlOperationBody = {
  serverId: string;
  operation: string;
  deploymentId?: string;
};

export type MissionControlActionView = MissionControlActionEvaluation & {
  /** Present for `operation.*` on a found target only. */
  body?: MissionControlOperationBody;
};

export type MissionControlActionsView = {
  kind: MissionControlKind;
  sourceId: string;
  /** Always true: the mutation endpoints re-authorize. */
  advisory: true;
  actions: MissionControlActionView[];
};

type LoadedTarget = {
  record: MissionControlActionRecord;
  /** Business server id the operation body addresses, when the kind has one. */
  serverId: string | null;
  deploymentId: string | null;
};

const EXISTS: MissionControlActionRecord = {
  state: null,
  freshness: "live"
};

function found(
  record: MissionControlActionRecord,
  serverId: string | null = null,
  deploymentId: string | null = null
): LoadedTarget {
  return { record, serverId, deploymentId };
}

async function loadTarget(params: {
  tx: Bun.SQL;
  tenantId: string;
  now: Date;
  can: (request: AccessRequest) => Promise<boolean>;
  kind: MissionControlKind;
  sourceId: string;
}): Promise<LoadedTarget | null> {
  const { tx, tenantId, now, can, kind, sourceId } = params;

  // The scene shows a source's objects only to a viewer who may read that
  // source; an object in an unreadable source is indistinguishable from none.
  if (!(await can(actionPermissionGuard("open_details", kind)))) return null;

  switch (kind) {
    case "server": {
      const rows = (await tx`
        SELECT server_id, status, last_heartbeat_at
        FROM awcms_omes_servers
        WHERE tenant_id = ${tenantId} AND server_id = ${sourceId}
      `) as {
        server_id: string;
        status: string;
        last_heartbeat_at: Date | null;
      }[];
      const row = rows[0];
      if (!row) return null;
      return found(
        {
          state: row.status,
          freshness: freshnessFromAge(
            row.last_heartbeat_at,
            now,
            STALE_HEARTBEAT_THRESHOLD_MS / 1000
          )
        },
        row.server_id
      );
    }
    case "deployment": {
      const rows = (await tx`
        SELECT d.deployment_id, d.server_id, d.reconciliation_status,
               d.last_reconciled_at, s.status AS server_status
        FROM awcms_omes_deployments d
        LEFT JOIN awcms_omes_servers s
          ON s.tenant_id = d.tenant_id AND s.server_id = d.server_id
        WHERE d.tenant_id = ${tenantId} AND d.deployment_id = ${sourceId}
      `) as {
        deployment_id: string;
        server_id: string;
        reconciliation_status: string;
        last_reconciled_at: Date | null;
        server_status: string | null;
      }[];
      const row = rows[0];
      if (!row) return null;
      return found(
        {
          state: row.reconciliation_status,
          freshness: freshnessFromAge(
            row.last_reconciled_at,
            now,
            STALE_RECONCILIATION_THRESHOLD_MS / 1000
          ),
          serverId: row.server_id,
          serverStatus: row.server_status,
          deploymentId: row.deployment_id
        },
        row.server_id,
        row.deployment_id
      );
    }
    case "job": {
      const rows = (await tx`
        SELECT id, job_id, server_id, state
        FROM awcms_omes_jobs
        WHERE tenant_id = ${tenantId} AND job_id = ${sourceId}
      `) as { id: string; job_id: string; server_id: string; state: string }[];
      const row = rows[0];
      if (!row) return null;
      return found({
        state: row.state,
        // Only operation.* / backup.restore advisories read freshness, and a
        // job has neither; a terminal job is final evidence, anything else is
        // reported unknown rather than guessed.
        freshness: TERMINAL_JOB_STATES.has(row.state) ? "live" : "unknown",
        serverId: row.server_id,
        // The cancel / approve endpoints address the row's primary key.
        pathId: row.id
      });
    }
    case "backup": {
      const rows = (await tx`
        SELECT id, backup_id, server_id, status, captured_at
        FROM awcms_omes_backup_snapshots
        WHERE tenant_id = ${tenantId} AND backup_id = ${sourceId}
      `) as {
        id: string;
        backup_id: string;
        server_id: string;
        status: string;
        captured_at: Date;
      }[];
      const row = rows[0];
      if (!row) return null;
      return found({
        state: row.status,
        freshness: freshnessFromAge(
          row.captured_at,
          now,
          BACKUP_FRESHNESS_THRESHOLD_MS / 1000
        ),
        serverId: row.server_id,
        // The restore endpoint addresses the row's primary key.
        pathId: row.id
      });
    }
    case "approval_item": {
      // A non-UUID can never be an instance id; also keeps the `uuid` column
      // comparison from raising on arbitrary text and poisoning the tx.
      if (!UUID_PATTERN.test(sourceId)) return null;
      const rows = (await tx`
        SELECT i.id AS instance_id
        FROM awcms_workflow_instances i
        JOIN awcms_workflow_definitions d
          ON d.id = i.workflow_definition_id AND d.tenant_id = i.tenant_id
        JOIN awcms_omes_operation_requests r
          ON r.workflow_instance_id = i.id AND r.tenant_id = i.tenant_id
        WHERE i.tenant_id = ${tenantId}
          AND i.id = ${sourceId}
          AND i.status = 'pending'
          AND d.workflow_key = ${OMES_DESTRUCTIVE_WORKFLOW_KEY}
        LIMIT 1
      `) as { instance_id: string }[];
      if (!rows[0]) return null;
      return found({
        state: "pending",
        freshness: "live",
        workflowInstanceId: rows[0].instance_id
      });
    }
    case "health_report": {
      const snapshots = await fetchLatestHealthPerServer(tx, tenantId, now);
      return snapshots.some((s) => s.serverId === sourceId)
        ? found(EXISTS)
        : null;
    }
    case "hermes_subagent": {
      for (const tree of await fetchOrchestrationTrees(tx, tenantId, now)) {
        if (tree.nodes.some((n) => n.subagentId === sourceId)) {
          return found(EXISTS);
        }
      }
      return null;
    }
    case "architecture_plane":
    case "capability":
    case "repository_milestone":
    case "ai_privacy_posture": {
      const collector = createMissionControlCollector({
        tx,
        tenantId,
        now,
        can
      });
      if (kind === "architecture_plane" || kind === "capability") {
        await collectArchitectureRecords(collector);
      } else if (kind === "repository_milestone") {
        await collectRepositoryProgressRecords(collector);
      } else {
        await collectAiPrivacyRecords(collector);
      }
      return collector.records.some(
        (r) => r.kind === kind && r.sourceId === sourceId
      )
        ? found(EXISTS)
        : null;
    }
  }
}

/** The operation body for an `operation.*` action, exactly what operations.astro sends. */
function operationBody(
  action: string,
  target: LoadedTarget
): MissionControlOperationBody | undefined {
  if (!action.startsWith("operation.") || !target.serverId) return undefined;
  const body: MissionControlOperationBody = {
    serverId: target.serverId,
    operation: action.slice("operation.".length)
  };
  if (target.deploymentId) body.deploymentId = target.deploymentId;
  return body;
}

export async function fetchMissionControlActions(params: {
  tx: Bun.SQL;
  tenantId: string;
  now: Date;
  can: (request: AccessRequest) => Promise<boolean>;
  kind: MissionControlKind;
  sourceId: string;
}): Promise<MissionControlActionsView> {
  const { can, kind, sourceId } = params;
  const target = await loadTarget(params);

  const permissions: Record<string, boolean> = {};
  if (target) {
    // Sequential on purpose: `tx` is one reserved connection.
    for (const action of candidateActionsForKind(kind)) {
      permissions[action] = await can(actionPermissionGuard(action, kind));
    }
  }

  const evaluations = evaluateMissionControlActions({
    kind,
    sourceId,
    record: target?.record ?? null,
    permissions,
    mode: "live"
  });

  return {
    kind,
    sourceId,
    advisory: true,
    actions: evaluations.map((evaluation) => {
      const body = target
        ? operationBody(evaluation.action, target)
        : undefined;
      return body ? { ...evaluation, body } : evaluation;
    })
  };
}

/** Wire shape (snake_case, like the scene); `sourceId` is echoed as `source_id`. */
export function toMissionControlActionsWire(view: MissionControlActionsView): {
  kind: MissionControlKind;
  source_id: string;
  advisory: true;
  actions: Array<{
    action: string;
    available: boolean;
    reason: string;
    requires_approval: boolean;
    mutating: boolean;
    method: "GET" | "POST";
    path: string;
    advisories: string[];
    body?: MissionControlOperationBody;
  }>;
} {
  return {
    kind: view.kind,
    source_id: view.sourceId,
    advisory: true,
    actions: view.actions.map((a) => ({
      action: a.action,
      available: a.available,
      reason: a.reason,
      requires_approval: a.requiresApproval,
      mutating: a.mutating,
      method: a.method,
      path: a.path,
      advisories: [...a.advisories],
      ...(a.body ? { body: a.body } : {})
    }))
  };
}
