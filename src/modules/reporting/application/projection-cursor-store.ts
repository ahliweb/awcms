/**
 * Per (tenant, projection, stream) bounded-scan resume position store
 * (Issue #753) — `awcms_reporting_projection_cursors`. Shared by the
 * steady-state incremental worker (`projection-incremental-worker.ts`) and
 * a rebuild-in-progress (`projection-rebuild.ts`) — mutual exclusion
 * between the two is enforced by the caller (both check
 * `isRebuildRunning` from `rebuild-run-store.ts` before touching this
 * table for a given (tenant, projection)), never by this store itself.
 */

export async function getStreamCursor(
  tx: Bun.SQL,
  tenantId: string,
  projectionKey: string,
  streamKey: string
): Promise<Date | null> {
  const rows = (await tx`
    SELECT cursor_value
    FROM awcms_reporting_projection_cursors
    WHERE tenant_id = ${tenantId} AND projection_key = ${projectionKey} AND stream_key = ${streamKey}
  `) as { cursor_value: Date | null }[];

  return rows[0]?.cursor_value ?? null;
}

/** Idempotent upsert — safe to call repeatedly with the same value (a retried pass after a crash writes the same cursor state again, never duplicating a row). */
export async function upsertStreamCursor(
  tx: Bun.SQL,
  tenantId: string,
  projectionKey: string,
  streamKey: string,
  cursorValue: Date | null
): Promise<void> {
  await tx`
    INSERT INTO awcms_reporting_projection_cursors
      (tenant_id, projection_key, stream_key, cursor_value)
    VALUES (${tenantId}, ${projectionKey}, ${streamKey}, ${cursorValue})
    ON CONFLICT (tenant_id, projection_key, stream_key) DO UPDATE SET
      cursor_value = EXCLUDED.cursor_value,
      updated_at = now()
  `;
}

/** Resets every stream cursor for a (tenant, projection) back to NULL (start of the source table) — used ONLY by `projection-rebuild.ts`'s reset step, in the SAME transaction that creates the new rebuild run row. */
export async function resetProjectionCursors(
  tx: Bun.SQL,
  tenantId: string,
  projectionKey: string,
  streamKeys: readonly string[]
): Promise<void> {
  for (const streamKey of streamKeys) {
    await upsertStreamCursor(tx, tenantId, projectionKey, streamKey, null);
  }
}
