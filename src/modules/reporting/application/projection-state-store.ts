/**
 * Per (tenant, projection) freshness bookkeeping store (Issue #753) —
 * `awcms_reporting_projection_state`. Raw facts only; the actual
 * freshness STATUS is always computed live from these at read time
 * (`reporting/domain/freshness.ts`'s `computeProjectionFreshness`) — see
 * that file's own header comment for why this table never stores a cached
 * status enum.
 */
import type { ProjectionFreshnessFacts } from "../domain/freshness";

export type ProjectionStateRow = Omit<
  ProjectionFreshnessFacts,
  "rebuildInProgress"
>;

type StateDbRow = {
  last_attempt_at: Date | null;
  last_success_at: Date | null;
  consecutive_failures: number;
  last_error_message: string | null;
};

const EMPTY_STATE: ProjectionStateRow = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  consecutiveFailures: 0,
  lastErrorMessage: null
};

export async function getProjectionState(
  tx: Bun.SQL,
  tenantId: string,
  projectionKey: string
): Promise<ProjectionStateRow> {
  const rows = (await tx`
    SELECT last_attempt_at, last_success_at, consecutive_failures, last_error_message
    FROM awcms_reporting_projection_state
    WHERE tenant_id = ${tenantId} AND projection_key = ${projectionKey}
  `) as StateDbRow[];

  const row = rows[0];
  if (!row) {
    return EMPTY_STATE;
  }

  return {
    lastAttemptAt: row.last_attempt_at,
    lastSuccessAt: row.last_success_at,
    consecutiveFailures: row.consecutive_failures,
    lastErrorMessage: row.last_error_message
  };
}

/** Records a successful update pass — advances BOTH `last_attempt_at` and `last_success_at` to `now`, resets `consecutive_failures` to 0. */
export async function recordProjectionSuccess(
  tx: Bun.SQL,
  tenantId: string,
  projectionKey: string
): Promise<void> {
  await tx`
    INSERT INTO awcms_reporting_projection_state
      (tenant_id, projection_key, last_attempt_at, last_success_at, consecutive_failures, last_error_message)
    VALUES (${tenantId}, ${projectionKey}, now(), now(), 0, NULL)
    ON CONFLICT (tenant_id, projection_key) DO UPDATE SET
      last_attempt_at = now(),
      last_success_at = now(),
      consecutive_failures = 0,
      last_error_message = NULL,
      updated_at = now()
  `;
}

/**
 * Records a FAILED update pass — advances `last_attempt_at` only
 * (`last_success_at` deliberately untouched, so age-since-last-success
 * keeps growing and the freshness read path naturally ages this
 * projection's status toward `"stale"`/`"failed"`), increments
 * `consecutive_failures`, and stores a redacted-safe error message.
 */
export async function recordProjectionFailure(
  tx: Bun.SQL,
  tenantId: string,
  projectionKey: string,
  errorMessage: string
): Promise<void> {
  await tx`
    INSERT INTO awcms_reporting_projection_state
      (tenant_id, projection_key, last_attempt_at, consecutive_failures, last_error_message)
    VALUES (${tenantId}, ${projectionKey}, now(), 1, ${errorMessage})
    ON CONFLICT (tenant_id, projection_key) DO UPDATE SET
      last_attempt_at = now(),
      consecutive_failures = awcms_reporting_projection_state.consecutive_failures + 1,
      last_error_message = ${errorMessage},
      updated_at = now()
  `;
}
