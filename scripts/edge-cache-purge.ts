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
 * says that, and `failed` rows are deliberately never pruned.
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
  pruneCompletedEdgeCachePurges
} from "../src/lib/edge-cache/purge-queue";
import { sendEdgeCachePurge } from "../src/lib/edge-cache/varnish-client";

/** Safety bound mirroring the other purge jobs — never loop unboundedly. */
const MAX_PASSES_PER_TENANT = 50;

/** Completed rows older than this are pruned. `failed` rows are kept forever. */
const COMPLETED_RETENTION_DAYS = 7;

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
  const pruneBefore = new Date(
    now.getTime() - COMPLETED_RETENTION_DAYS * 24 * 60 * 60 * 1_000
  );

  let sent = 0;
  let failed = 0;
  let pruned = 0;

  try {
    const tenants = (await sql`
      SELECT id FROM awcms_tenants WHERE status = 'active'
    `) as TenantRow[];

    for (const tenant of tenants) {
      for (let pass = 0; pass < MAX_PASSES_PER_TENANT; pass += 1) {
        const claimed = await withTenantOrThrow(sql, tenant.id, (tx) =>
          claimEdgeCachePurges(tx, tenant.id, config.purgeBatchSize, new Date())
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
          await withTenantOrThrow(sql, tenant.id, (tx) =>
            outcome.ok
              ? markEdgeCachePurgeDone(tx, row.id, new Date())
              : markEdgeCachePurgeFailed(
                  tx,
                  row.id,
                  outcome.detail,
                  new Date(),
                  !outcome.retryable
                )
          );

          if (outcome.ok) {
            sent += 1;
          } else {
            failed += 1;
          }
        }
      }

      pruned += await withTenantOrThrow(sql, tenant.id, (tx) =>
        pruneCompletedEdgeCachePurges(
          tx,
          tenant.id,
          pruneBefore,
          config.purgeBatchSize
        )
      );
    }

    console.log(
      `edge-cache:purge complete — correlationId=${correlationId} ` +
        `mode=${config.mode} tenants=${tenants.length} ` +
        `sent=${sent} failed=${failed} prunedCompleted=${pruned}`
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
