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
 * ## CDN purge (Issue #1282, revisit of C14) — off by default
 *
 * With `EDGE_CACHE_CDN_PURGE=on` a row is done only after the Varnish BAN AND a
 * CDN purge-by-tag succeed. Tags are deduplicated and sent 100 per request. A
 * rate limit or a rejected credential stops the CDN calls for the rest of the
 * run and RELEASES the rows without spending an attempt (nothing is dropped, and
 * nothing walks toward the dead-letter for a fault that is not the row's). With
 * the flag on and credentials missing, the job refuses to start a pass at all
 * (exit code 1) so the queue keeps every row. See
 * `src/lib/edge-cache/cdn-client.ts`.
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
import { purgeCdnForRows } from "../src/lib/edge-cache/cdn-client";
import {
  listMissingCdnPurgeSettings,
  loadCdnPurgeConfig
} from "../src/lib/edge-cache/cdn-purge-config";
import { loadEdgeCacheConfig } from "../src/lib/edge-cache/config";
import { recordGauge } from "../src/lib/observability/metrics-port";
import {
  claimEdgeCachePurges,
  markEdgeCachePurgeDone,
  markEdgeCachePurgeFailed,
  pruneTerminalEdgeCachePurges,
  releaseEdgeCachePurge
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

  const cdn = loadCdnPurgeConfig();
  const missingCdn = listMissingCdnPurgeSettings(cdn);

  if (missingCdn.length > 0) {
    // Fail closed: do not ban in Varnish and leave the CDN behind. The queue
    // keeps every row; fix the settings and the next run drains it.
    console.error(
      `edge-cache:purge REFUSED — correlationId=${correlationId} ` +
        `EDGE_CACHE_CDN_PURGE=on but unusable settings: ${missingCdn.join(", ")}`
    );
    process.exitCode = 1;

    return;
  }

  const sql = getWorkerDatabaseClient();
  const now = new Date();
  let cdnPurged = 0;
  let cdnFailed = 0;
  let cdnReleased = 0;
  let cdnMaxLagSeconds = 0;
  let cdnHalt: "rate_limited" | "auth" | "unavailable" | null = null;

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
        if (cdnHalt !== null) {
          break;
        }

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

        const varnishOk: typeof claimed = [];

        for (const row of claimed) {
          const outcome = await sendEdgeCachePurge(row.surrogate_key, {
            config
          });

          if (outcome.ok && cdn.enabled) {
            // Not done yet: the CDN step below decides.
            varnishOk.push(row);
            continue;
          }

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

        if (cdn.enabled && varnishOk.length > 0) {
          const decisions = await purgeCdnForRows(varnishOk, { config: cdn });
          const createdAt = new Map(
            varnishOk.map((row) => [row.id, new Date(row.created_at)])
          );

          if (decisions.halt !== null) cdnHalt = decisions.halt;

          await withTenantOrThrow(
            sql,
            tenant.id,
            async (tx) => {
              const stamp = new Date();

              for (const id of decisions.done) {
                await markEdgeCachePurgeDone(tx, id, stamp);
                const created = createdAt.get(id);

                if (created) {
                  cdnMaxLagSeconds = Math.max(
                    cdnMaxLagSeconds,
                    Math.round((stamp.getTime() - created.getTime()) / 1_000)
                  );
                }
              }
              for (const item of decisions.retry) {
                await markEdgeCachePurgeFailed(tx, item.id, item.detail, stamp);
              }
              for (const item of decisions.deadLetter) {
                await markEdgeCachePurgeFailed(
                  tx,
                  item.id,
                  item.detail,
                  stamp,
                  true
                );
              }
              for (const item of decisions.release) {
                await releaseEdgeCachePurge(tx, item.id, item.detail, stamp);
              }
            },
            { workClass: "background_sync" }
          );

          cdnPurged += decisions.done.length;
          sent += decisions.done.length;
          cdnFailed += decisions.retry.length + decisions.deadLetter.length;
          failed += decisions.retry.length + decisions.deadLetter.length;
          cdnReleased += decisions.release.length;
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
        `prunedFailed=${prunedFailed} legalHoldTenants=${heldTenants} ` +
        `cdn=${cdn.enabled ? "on" : "off"} cdnPurged=${cdnPurged} ` +
        `cdnFailed=${cdnFailed} cdnReleased=${cdnReleased} ` +
        `cdnMaxLagSeconds=${cdnMaxLagSeconds} cdnHalt=${cdnHalt ?? "none"}`
    );

    if (cdn.enabled) {
      for (const [itemName, value] of Object.entries({
        cdnPurged,
        cdnFailed,
        cdnReleased,
        cdnMaxLagSeconds
      })) {
        recordGauge("job_run_item_count", value, {
          jobName: "edge-cache:purge",
          itemName
        });
      }
    }

    if (cdnHalt === "auth") {
      process.exitCode = 1;
    }
  } catch (error) {
    logScriptFailure("edge-cache:purge FAILED", error);
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
