/**
 * `channel-accounts:oauth-state:sweep` (Issue #1215 N2).
 *
 * The sweep of abandoned OAuth authorisations (`sweepExpiredOAuthStates`) used
 * to run only on the write path of `startOAuthGrant`: a tenant that started a
 * flow, abandoned it and never started another kept the PKCE verifier and the
 * hand-off code ciphertext until the next start, which for a tenant that
 * connected once may be never. This job runs the SAME function on a timer.
 *
 * Bounded: every tenant gets at most `OAUTH_SWEEP_MAX_PASSES` passes of
 * `OAUTH_SWEEP_BATCH` rows, each pass its own transaction (a long backlog is
 * drained over several runs, and never holds one unbounded transaction).
 * Isolated: a failure in one tenant is logged (error NAME only) and counted,
 * and the loop goes on to the next tenant. Cooperative cancellation: the
 * signal is checked before every tenant and every pass.
 *
 * It decrypts nothing: it only DELETES ciphertext (`store.remove`), so it is
 * given a store that can do nothing else and never needs the key ring.
 */
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { fetchActiveTenants } from "../../../lib/jobs/batching";
import { log } from "../../../lib/logging/logger";
import type { SecretStorePort } from "./secret-store";
import { sweepExpiredOAuthStates } from "./connection-directory";

export const OAUTH_SWEEP_BATCH = 50;
export const OAUTH_SWEEP_MAX_PASSES = 10;

/** The only secret-store operation the sweep needs; deletes a row, reads nothing. */
export const deleteOnlySecretStore: Pick<SecretStorePort, "remove"> = {
  async remove(tx, tenantId, secretId) {
    await tx`
      DELETE FROM awcms_channel_secrets
      WHERE tenant_id = ${tenantId} AND id = ${secretId}
    `;
  }
};

export type OAuthStateSweepSummary = {
  tenantsChecked: number;
  tenantsErrored: number;
  /** Tenants whose backlog was not drained within the pass bound (more next run). */
  tenantsBacklogged: number;
  aborted: boolean;
  statesDeleted: number;
  connectionsFailed: number;
  /** Dry run only: rows that WOULD be touched. */
  statesDue: number;
  connectionsDue: number;
};

export async function runOAuthStateSweepJob(
  sql: Bun.SQL,
  options: {
    now?: Date;
    dryRun?: boolean;
    signal?: AbortSignal;
    batch?: number;
    maxPasses?: number;
  } = {}
): Promise<OAuthStateSweepSummary> {
  const now = options.now ?? new Date();
  const batch = options.batch ?? OAUTH_SWEEP_BATCH;
  const maxPasses = options.maxPasses ?? OAUTH_SWEEP_MAX_PASSES;
  const summary: OAuthStateSweepSummary = {
    tenantsChecked: 0,
    tenantsErrored: 0,
    tenantsBacklogged: 0,
    aborted: false,
    statesDeleted: 0,
    connectionsFailed: 0,
    statesDue: 0,
    connectionsDue: 0
  };

  for (const tenant of await fetchActiveTenants(sql)) {
    if (options.signal?.aborted) {
      summary.aborted = true;
      break;
    }

    summary.tenantsChecked += 1;

    try {
      if (options.dryRun) {
        const due = await withTenantOrThrow(sql, tenant.id, (tx) =>
          countDue(tx, tenant.id, now)
        );

        summary.statesDue += due.states;
        summary.connectionsDue += due.connections;
        continue;
      }

      let drained = false;

      for (let pass = 0; pass < maxPasses; pass += 1) {
        if (options.signal?.aborted) {
          summary.aborted = true;
          break;
        }

        const result = await withTenantOrThrow(sql, tenant.id, (tx) =>
          sweepExpiredOAuthStates(
            tx,
            deleteOnlySecretStore,
            tenant.id,
            now,
            batch
          )
        );

        summary.statesDeleted += result.statesDeleted;
        summary.connectionsFailed += result.connectionsFailed;

        // A pass that came back short of the batch found everything that was
        // due: nothing is left behind, so the next pass would only re-ask.
        if (result.statesDeleted < batch && result.connectionsFailed < batch) {
          drained = true;
          break;
        }
      }

      if (!drained && !summary.aborted) summary.tenantsBacklogged += 1;
    } catch (error) {
      // tx-swallow-ok: `sql` here is the pooled client, not a transaction: the
      // failing tenant's own transaction was rolled back by withTenantOrThrow,
      // so nothing is left aborted and the next tenant runs.
      summary.tenantsErrored += 1;
      log("error", "channel_accounts.oauth_state_sweep.tenant_error", {
        tenantId: tenant.id,
        errorName: error instanceof Error ? error.name : "unknown"
      });
    }

    if (summary.aborted) break;
  }

  return summary;
}

async function countDue(
  tx: Bun.SQL,
  tenantId: string,
  now: Date
): Promise<{ states: number; connections: number }> {
  const rows = (await tx`
    SELECT
      (SELECT count(*)::int FROM awcms_channel_oauth_states AS o
        WHERE o.tenant_id = ${tenantId} AND o.expires_at < ${now}
          AND NOT EXISTS (
            SELECT 1 FROM awcms_channel_provider_connections AS c
            WHERE c.tenant_id = o.tenant_id AND c.oauth_state_id = o.id)) AS states,
      (SELECT count(*)::int FROM awcms_channel_provider_connections AS c
        WHERE c.tenant_id = ${tenantId} AND c.grant_state = 'pending'
          AND c.created_at < ${new Date(now.getTime() - 24 * 60 * 60 * 1000)}) AS connections
  `) as { states: number; connections: number }[];

  return rows[0]!;
}
