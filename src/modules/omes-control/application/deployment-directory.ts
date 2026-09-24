/**
 * Read-side queries for `GET /api/v1/omes/deployments` (list + detail),
 * Issue ahliweb/omes#198. Desired and observed state are rendered as
 * SEPARATE fields (never merged) per the issue's explicit requirement, and
 * every jsonb evidence field is passed through `redactSensitiveAttributes`
 * as defense-in-depth against an accidentally-embedded secret-shaped value.
 */
import {
  keysetCursorCreatedAtSql,
  encodeKeysetCursor,
  type KeysetCursor
} from "../../_shared/keyset-pagination";
import { redactSensitiveAttributes } from "../../_shared/redaction";

export type DeploymentSummary = {
  id: string;
  deploymentId: string;
  serverId: string;
  desiredState: unknown;
  observedState: unknown;
  reconciliationStatus: string;
  errorEvidence: unknown;
  lastReconciledAt: string | null;
  stale: boolean;
  createdAt: string;
  updatedAt: string;
};

type DeploymentRow = {
  id: string;
  deployment_id: string;
  server_id: string;
  desired_state: Record<string, unknown>;
  observed_state: Record<string, unknown>;
  reconciliation_status: string;
  error_evidence: Record<string, unknown> | null;
  last_reconciled_at: Date | null;
  created_at: Date;
  updated_at: Date;
  created_at_cursor: string;
};

export type DeploymentListPage = {
  deployments: DeploymentSummary[];
  nextCursor: string | null;
};

export const DEPLOYMENT_LIST_LIMIT = 100;

/** A converged deployment whose last reconciliation is older than this is flagged stale (independent of `reconciliation_status`, which reflects the last run's own outcome, not its age). */
const STALE_RECONCILIATION_THRESHOLD_MS = 30 * 60 * 1000;

function isReconciliationStale(
  status: string,
  lastReconciledAt: Date | null,
  now: Date
): boolean {
  if (status === "failed" || status === "drifted") {
    return true;
  }

  if (!lastReconciledAt) {
    return true;
  }

  return (
    now.getTime() - lastReconciledAt.getTime() >
    STALE_RECONCILIATION_THRESHOLD_MS
  );
}

function toSummary(row: DeploymentRow, now: Date): DeploymentSummary {
  return {
    id: row.id,
    deploymentId: row.deployment_id,
    serverId: row.server_id,
    desiredState: redactSensitiveAttributes(row.desired_state) ?? {},
    observedState: redactSensitiveAttributes(row.observed_state) ?? {},
    reconciliationStatus: row.reconciliation_status,
    errorEvidence: row.error_evidence
      ? (redactSensitiveAttributes(row.error_evidence) ?? null)
      : null,
    lastReconciledAt: row.last_reconciled_at?.toISOString() ?? null,
    stale: isReconciliationStale(
      row.reconciliation_status,
      row.last_reconciled_at,
      now
    ),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

export async function fetchDeployments(
  tx: Bun.SQL,
  tenantId: string,
  now: Date,
  options: {
    serverId?: string;
    reconciliationStatus?: string;
    cursor?: KeysetCursor;
  } = {}
): Promise<DeploymentListPage> {
  const cursorCreatedAt = options.cursor?.createdAt ?? null;
  const cursorId = options.cursor?.id ?? null;
  const serverIdFilter = options.serverId ?? null;
  const statusFilter = options.reconciliationStatus ?? null;

  const rows = (await tx`
    SELECT id, deployment_id, server_id, desired_state, observed_state,
           reconciliation_status, error_evidence, last_reconciled_at,
           created_at, updated_at,
           ${tx.unsafe(keysetCursorCreatedAtSql())} AS created_at_cursor
    FROM awcms_omes_deployments
    WHERE tenant_id = ${tenantId}
      AND (${serverIdFilter}::text IS NULL OR server_id = ${serverIdFilter})
      AND (${statusFilter}::text IS NULL OR reconciliation_status = ${statusFilter})
      AND (
        ${cursorCreatedAt}::timestamptz IS NULL
        OR (created_at, id) < (${cursorCreatedAt}, ${cursorId})
      )
    ORDER BY created_at DESC, id DESC
    LIMIT ${DEPLOYMENT_LIST_LIMIT}
  `) as DeploymentRow[];

  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === DEPLOYMENT_LIST_LIMIT && last
      ? encodeKeysetCursor(last.created_at_cursor, last.id)
      : null;

  return {
    deployments: rows.map((row) => toSummary(row, now)),
    nextCursor
  };
}

export async function fetchDeploymentDetail(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  now: Date
): Promise<DeploymentSummary | null> {
  const rows = (await tx`
    SELECT id, deployment_id, server_id, desired_state, observed_state,
           reconciliation_status, error_evidence, last_reconciled_at,
           created_at, updated_at, '' AS created_at_cursor
    FROM awcms_omes_deployments
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `) as DeploymentRow[];
  const row = rows[0];

  return row ? toSummary(row, now) : null;
}
