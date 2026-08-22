/**
 * The optimistic-concurrency write behind `POST /api/v1/sync/push` — finding C3
 * of the 17 August 2026 audit round.
 *
 * Extracted from the route so the compare-and-set is one statement with one
 * name, testable against a real PostgreSQL under a real race. It was inline,
 * and the defect it carried is invisible from the shape of the code: the read
 * that decided a conflict and the write that acted on that decision were two
 * statements with nothing holding them together.
 *
 *   Batch A reads current_version = 5. Batch B reads 5. Both pass the check
 *   with baseVersion = 5. Both write the literal 6.
 *
 * Two conflicting events accepted, zero conflict rows, one increment lost —
 * under READ COMMITTED, which re-snapshots per STATEMENT, so being inside one
 * transaction never made the pair atomic.
 */

/**
 * Advances an aggregate to `expectedVersion + 1`, but ONLY if it still holds
 * `expectedVersion`.
 *
 * Returns `false` when another writer moved it in between. The caller treats
 * that as `version_mismatch` — the same verdict the pure evaluator
 * (`domain/sync-conflict.ts`) would reach on a fresh read, so a node sees an
 * outcome it already understands rather than a new failure mode.
 *
 * ## Why `ON CONFLICT … DO UPDATE … WHERE` rather than `SELECT … FOR UPDATE`
 *
 * `FOR UPDATE` locks rows that EXIST. The first event for an aggregate has no
 * row to lock, so two batches creating the same aggregate would both proceed
 * and the loser's `ON CONFLICT` would still overwrite. Here the same predicate
 * covers both paths: on the create race the loser's `DO UPDATE` finds
 * `current_version = 1`, not the `0` it expected, and refuses.
 *
 * It also holds a row lock for the duration of ONE statement rather than for
 * the rest of the transaction, so a batch touching many aggregates does not
 * serialise all of them against every other batch.
 *
 * `awcms_sync_aggregate_versions.` is spelled out in the `WHERE`: inside
 * `ON CONFLICT DO UPDATE`, an unqualified column name means the row being
 * PROPOSED (`EXCLUDED`'s counterpart), so `current_version = ${expectedVersion}`
 * unqualified would compare the new value against itself and be true whenever
 * `expectedVersion + 1 === expectedVersion` — that is, never, silently turning
 * every accepted event into a conflict.
 */
export async function advanceAggregateVersion(
  tx: Bun.SQL,
  tenantId: string,
  aggregateType: string,
  aggregateId: string,
  expectedVersion: number
): Promise<boolean> {
  const advanced = (await tx`
    INSERT INTO awcms_sync_aggregate_versions
      (tenant_id, aggregate_type, aggregate_id, current_version)
    VALUES (${tenantId}, ${aggregateType}, ${aggregateId}, ${expectedVersion + 1})
    ON CONFLICT (tenant_id, aggregate_type, aggregate_id)
    DO UPDATE SET current_version = ${expectedVersion + 1}, updated_at = now()
    WHERE awcms_sync_aggregate_versions.current_version = ${expectedVersion}
    RETURNING current_version
  `) as { current_version: string | number }[];

  return advanced.length > 0;
}
