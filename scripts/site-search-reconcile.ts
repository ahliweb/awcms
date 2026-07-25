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
import { withTenant } from "../src/lib/database/tenant-context";
import { logScriptFailure } from "../src/lib/logging/error-log";
import { getRegisteredSearchSources } from "../src/lib/search/search-sources";
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

    for (const tenant of tenants) {
      const result = await withTenant(
        sql,
        tenant.id,
        (tx) =>
          (rebuild ? rebuildTenantSearchIndex : reconcileTenantSearchIndex)(
            tx,
            tenant.id,
            descriptors,
            { trigger: "scheduled" }
          ),
        { workClass: "maintenance" }
      );
      totalIndexed += result.totalIndexed;
      totalRemoved += result.totalRemoved;
      totalFailures += result.failureCount;
    }

    console.log(
      `site-search:reconcile complete — correlationId=${correlationId} ` +
        `mode=${rebuild ? "rebuild" : "reconcile"} tenants=${tenants.length} ` +
        `indexed=${totalIndexed} removed=${totalRemoved} failures=${totalFailures}`
    );
  } catch (error) {
    logScriptFailure("site-search:reconcile FAILED", error);
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
