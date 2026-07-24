/**
 * Bounded-job pause/resume cursor store (ported from awcms-micro Issue #745,
 * ADR-0037) — `awcms_data_lifecycle_cursors`, one row per (tenant, descriptor,
 * phase). `archive-purge-job.ts` reads the cursor before starting a pass
 * (resume strictly after `cursorValue`) and writes it back after each bounded
 * pass — required by the acceptance criterion "Batch jobs are bounded,
 * resumable, lock-timeout aware, and safe after interruption/retry."
 */
export type LifecycleCursorPhase = "archive" | "purge";
export type LifecycleCursorStatus =
  "idle" | "in_progress" | "completed" | "error";

export type LifecycleCursorRow = {
  descriptorKey: string;
  phase: LifecycleCursorPhase;
  cursorValue: Date | null;
  status: LifecycleCursorStatus;
  lastRunId: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  updatedAt: Date;
};

type CursorDbRow = {
  descriptor_key: string;
  phase: LifecycleCursorPhase;
  cursor_value: Date | null;
  status: LifecycleCursorStatus;
  last_run_id: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  updated_at: Date;
};

function toRow(row: CursorDbRow): LifecycleCursorRow {
  return {
    descriptorKey: row.descriptor_key,
    phase: row.phase,
    cursorValue: row.cursor_value,
    status: row.status,
    lastRunId: row.last_run_id,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    updatedAt: row.updated_at
  };
}

export async function getCursor(
  tx: Bun.SQL,
  tenantId: string,
  descriptorKey: string,
  phase: LifecycleCursorPhase
): Promise<LifecycleCursorRow | null> {
  const rows = (await tx`
    SELECT descriptor_key, phase, cursor_value, status, last_run_id,
      last_error_code, last_error_message, updated_at
    FROM awcms_data_lifecycle_cursors
    WHERE tenant_id = ${tenantId} AND descriptor_key = ${descriptorKey} AND phase = ${phase}
  `) as CursorDbRow[];

  return rows[0] ? toRow(rows[0]) : null;
}

export type UpsertCursorInput = {
  cursorValue: Date | null;
  status: LifecycleCursorStatus;
  lastRunId?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
};

/** Idempotent upsert — safe to call repeatedly with the same values (a retried pass after a crash writes the same cursor state again, never duplicating a row). */
export async function upsertCursor(
  tx: Bun.SQL,
  tenantId: string,
  descriptorKey: string,
  phase: LifecycleCursorPhase,
  input: UpsertCursorInput
): Promise<void> {
  await tx`
    INSERT INTO awcms_data_lifecycle_cursors
      (tenant_id, descriptor_key, phase, cursor_value, status, last_run_id,
       last_error_code, last_error_message)
    VALUES (
      ${tenantId}, ${descriptorKey}, ${phase}, ${input.cursorValue}, ${input.status},
      ${input.lastRunId ?? null}, ${input.lastErrorCode ?? null}, ${input.lastErrorMessage ?? null}
    )
    ON CONFLICT (tenant_id, descriptor_key, phase) DO UPDATE SET
      cursor_value = EXCLUDED.cursor_value,
      status = EXCLUDED.status,
      last_run_id = EXCLUDED.last_run_id,
      last_error_code = EXCLUDED.last_error_code,
      last_error_message = EXCLUDED.last_error_message,
      updated_at = now()
  `;
}

/** Resets a cursor back to `idle` with no position — used by tests and by an operator-triggered "restart this descriptor's backlog from the beginning" action (not exposed over HTTP; direct DB/CLI operator action only, same operational-only posture as purge itself). */
export async function resetCursor(
  tx: Bun.SQL,
  tenantId: string,
  descriptorKey: string,
  phase: LifecycleCursorPhase
): Promise<void> {
  await upsertCursor(tx, tenantId, descriptorKey, phase, {
    cursorValue: null,
    status: "idle",
    lastRunId: null,
    lastErrorCode: null,
    lastErrorMessage: null
  });
}
