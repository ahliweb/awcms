/**
 * site-search-reconcile.ts — `bun run site-search:reconcile`.
 *
 * ADR-0040 §4 (ported from awcms-micro Issue #270) — internal worker entrypoint
 * for the deterministic, idempotent per-tenant search index reconciliation
 * (`reconcileTenantSearchIndex` / `rebuildTenantSearchIndex`,
 * `src/modules/site-search/application/search-index-engine.ts`). Intended to run
 * on a schedule (cron/systemd timer/k8s CronJob), same pattern as
 * `scripts/form-draft-purge.ts` — not exposed over HTTP.
 *
 * For every `active` tenant: opens a tenant-scoped transaction (RLS FORCE in
 * effect via `withTenant`) and reconciles (default) or fully rebuilds
 * (`--rebuild`) that tenant's index from every registered search source. Running
 * it repeatedly is always safe: reconcile skips unchanged documents (checksum),
 * upserts changed ones, and removes stale ones — so archive/delete/unpublish
 * never leaks. `--tenant=<uuid>` limits the run to a single tenant.
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import { withTenantOrThrow } from "../src/lib/database/tenant-context";
import { logScriptFailure } from "../src/lib/logging/error-log";
import { getRegisteredSearchSources } from "../src/modules/site-search/presentation/search-sources";
import {
  rebuildTenantSearchIndex,
  reconcileTenantSearchIndex
} from "../src/modules/site-search/application/search-index-engine";

type TenantRow = { id: string };

function readFlag(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const flag = argv.find((arg) => arg.startsWith(prefix));
  return flag ? flag.slice(prefix.length) : undefined;
}

async function main(): Promise<void> {
  // `awcms_worker` least-privilege role — grants in migration 064.
  const sql = getWorkerDatabaseClient();
  const argv = process.argv.slice(2);
  const rebuild = argv.includes("--rebuild");
  const onlyTenant = readFlag(argv, "tenant");
  const descriptors = getRegisteredSearchSources();
  const correlationId = crypto.randomUUID();

  try {
    const tenants = onlyTenant
      ? ((await sql`
          SELECT id FROM awcms_tenants
          WHERE id = ${onlyTenant} AND status = 'active'
        `) as TenantRow[])
      : ((await sql`
          SELECT id FROM awcms_tenants WHERE status = 'active'
        `) as TenantRow[]);

    let totalIndexed = 0;
    let totalRemoved = 0;
    let totalFailures = 0;
    // Finding D5 — this script summed `result.failureCount` and printed it, and
    // never looked at `result.status`. `failureCount` counts DOCUMENTS that
    // failed to map or upsert; a source whose reconcile threw contributes zero
    // to it. So a run where a whole source stopped indexing printed
    // `failures=0` and exited 0, while public search quietly stopped updating.
    const failedTenants: string[] = [];
    const failedSources = new Set<string>();
    const unattemptedSources = new Set<string>();
    let lastError: string | null = null;

    for (const tenant of tenants) {
      // The other half of the same failure, and the one D4 names in
      // `visitor-analytics-rollup.ts`: a source failing on a DATABASE error
      // aborts the transaction, so `finalizeRun` cannot even write the run row
      // and the whole call REJECTS. That was loud — it reached
      // `logScriptFailure` and exited 1 — but it also abandoned every tenant
      // after this one, on one tenant's bad row. Each tenant is an independent
      // unit of work; one is now recorded and the loop continues.
      let result;

      try {
        result = await withTenantOrThrow(
          sql,
          tenant.id,
          (tx) =>
            (rebuild ? rebuildTenantSearchIndex : reconcileTenantSearchIndex)(
              tx,
              tenant.id,
              descriptors,
              { trigger: "scheduled" }
            ),
          // `background_sync`, matching the job registry's argued entry:
          // this drives user-visible public search freshness, so it is a
          // recurring dispatcher rather than a delay-tolerant sweep. The script
          // used to pass `maintenance` with no reason given, and the drift ran
          // in both directions (finding D11).
          { workClass: "background_sync" }
        );
      } catch (error) {
        failedTenants.push(tenant.id);
        lastError = error instanceof Error ? error.message : String(error);
        continue;
      }

      totalIndexed += result.totalIndexed;
      totalRemoved += result.totalRemoved;
      totalFailures += result.failureCount;

      if (result.status === "failed") {
        failedTenants.push(tenant.id);
        for (const key of result.failedSources) failedSources.add(key);
        for (const key of result.unattemptedSources)
          unattemptedSources.add(key);
        lastError = result.lastError ?? lastError;
      }
    }

    console.log(
      `site-search:reconcile complete — correlationId=${correlationId} ` +
        `mode=${rebuild ? "rebuild" : "reconcile"} tenants=${tenants.length} ` +
        `indexed=${totalIndexed} removed=${totalRemoved} failures=${totalFailures} ` +
        `tenantsFailed=${failedTenants.length}`
    );

    if (failedTenants.length > 0) {
      // Non-zero exit, because the whole point is that this used to be
      // indistinguishable from success. `logScriptFailure` sets
      // `process.exitCode = 1` only for an error that escapes the loop, and
      // the loop no longer lets one escape — so it has to be said here.
      console.error(
        `site-search:reconcile INCOMPLETE — ${failedTenants.length} tenant(s) failed: ` +
          `${failedTenants.join(", ")}\n` +
          `  sources that failed:      ${[...failedSources].join(", ") || "(none named)"}\n` +
          `  sources never attempted:  ${[...unattemptedSources].join(", ") || "(none)"}\n` +
          `  last error:               ${lastError ?? "(none recorded)"}\n` +
          "  Public search stops updating for the sources above until this is fixed."
      );
      process.exitCode = 1;
    }
  } catch (error) {
    logScriptFailure("site-search:reconcile FAILED", error);
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
