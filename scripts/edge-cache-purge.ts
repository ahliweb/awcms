/**
 * edge-cache-purge.ts — `bun run edge-cache:purge`.
 *
 * ADR-0042. Drains the durable invalidation queue (`sql/068`) and sends one
 * Varnish `BAN` per surrogate key. Internal worker entrypoint, never exposed
 * over HTTP; run on a short schedule (every 10–30s) so an editor's publish shows
 * up at the edge promptly.
 *
 * Runs as the least-privilege `awcms_worker` role. RLS is FORCE'd for that role
 * too, so every statement is wrapped in `withTenant` — without it the queries
 * would see nothing rather than crossing tenants.
 *
 * ## Exit behaviour
 *
 * A send failure is recorded on the row and the pass continues: one unreachable
 * key must not strand the rest of the batch. The job only reports failure for a
 * fault that prevents it running at all. That means a green exit does NOT imply
 * every invalidation landed — the `failed` count in the summary line is what
 * says that.
 *
 * ## Retention (ADR-0076)
 *
 * `done` rows are pruned after seven days, `failed` rows after 180 — two
 * windows because they answer to two different readers, and both declared in
 * `data-lifecycle/domain/infrastructure-lifecycle-registry.ts` rather than
 * here, so the numbers this job enforces are the ones the lifecycle registry
 * publishes. A tenant under an active legal hold over `edge_cache.purges` is
 * skipped for retention while its sends continue.
 *
 * ## No-op when disabled
 *
 * With `EDGE_CACHE_MODE` off or no purge endpoint configured, the job exits
 * immediately without touching the database, so it is safe to schedule
 * unconditionally across deployments that have not adopted the edge cache.
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import { withTenantOrThrow } from "../src/lib/database/tenant-context";
import { logScriptFailure } from "../src/lib/logging/error-log";
import { loadEdgeCacheConfig } from "../src/lib/edge-cache/config";
import {
  claimEdgeCachePurges,
  markEdgeCachePurgeDone,
  markEdgeCachePurgeFailed,
  pruneTerminalEdgeCachePurges
} from "../src/lib/edge-cache/purge-queue";
import { legalHoldGuardPortAdapter } from "../src/modules/data-lifecycle/application/legal-hold-guard-port-adapter";
import { sendEdgeCachePurge } from "../src/lib/edge-cache/varnish-client";

/** Safety bound mirroring the other purge jobs — never loop unboundedly. */
const MAX_PASSES_PER_TENANT = 50;

type TenantRow = { id: string };

async function main(): Promise<void> {
  const correlationId = crypto.randomUUID();
  const config = loadEdgeCacheConfig();

  if (config.mode === "off" || !config.purgeEndpoint) {
    console.log(
      `edge-cache:purge skipped — correlationId=${correlationId} ` +
        `mode=${config.mode} endpointConfigured=${Boolean(config.purgeEndpoint)}`
    );

    return;
  }

  const sql = getWorkerDatabaseClient();
  const now = new Date();

  let sent = 0;
  let failed = 0;
  let prunedCompleted = 0;
  let prunedFailed = 0;
  let heldTenants = 0;

  try {
    const tenants = (await sql`
      SELECT id FROM awcms_tenants WHERE status = 'active'
    `) as TenantRow[];

    for (const tenant of tenants) {
      for (let pass = 0; pass < MAX_PASSES_PER_TENANT; pass += 1) {
        const claimed = await withTenantOrThrow(
          sql,
          tenant.id,
          (tx) =>
            claimEdgeCachePurges(
              tx,
              tenant.id,
              config.purgeBatchSize,
              new Date()
            ),
          { workClass: "background_sync" }
        );

        if (claimed.length === 0) {
          break;
        }

        for (const row of claimed) {
          const outcome = await sendEdgeCachePurge(row.surrogate_key, {
            config
          });

          // Each outcome is committed on its own so a crash mid-batch loses at
          // most one row's status, not the whole pass's progress.
          await withTenantOrThrow(
            sql,
            tenant.id,
            (tx) =>
              outcome.ok
                ? markEdgeCachePurgeDone(tx, row.id, new Date())
                : markEdgeCachePurgeFailed(
                    tx,
                    row.id,
                    outcome.detail,
                    new Date(),
                    !outcome.retryable
                  ),
            { workClass: "background_sync" }
          );

          if (outcome.ok) {
            sent += 1;
          } else {
            failed += 1;
          }
        }
      }

      const retention = await withTenantOrThrow(
        sql,
        tenant.id,
        (tx) =>
          pruneTerminalEdgeCachePurges(
            tx,
            tenant.id,
            legalHoldGuardPortAdapter,
            { now, limit: config.purgeBatchSize }
          ),
        { workClass: "background_sync" }
      );

      prunedCompleted += retention.prunedCompleted;
      prunedFailed += retention.prunedFailed;
      if (retention.heldByLegalHold) heldTenants += 1;
    }

    console.log(
      `edge-cache:purge complete — correlationId=${correlationId} ` +
        `mode=${config.mode} tenants=${tenants.length} ` +
        `sent=${sent} failed=${failed} prunedCompleted=${prunedCompleted} ` +
        `prunedFailed=${prunedFailed} legalHoldTenants=${heldTenants}`
    );
  } catch (error) {
    logScriptFailure("edge-cache:purge FAILED", error);
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
