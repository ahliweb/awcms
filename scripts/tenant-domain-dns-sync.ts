/**
 * tenant-domain-dns-sync.ts — `bun run tenant-domain:dns:sync`.
 *
 * Reconciles active platform subdomains in `awcms_tenant_domains` to serving DNS
 * records in the managed Cloudflare zone. This is what makes "add a row, get a
 * working subdomain" true.
 *
 * Internal worker entrypoint, never exposed over HTTP; run on a schedule (every
 * minute or two is reasonable — a pass over unchanged domains is one list call
 * each and returns `unchanged`).
 *
 * Runs as the least-privilege `awcms_worker` role with SELECT-only access
 * (sql/069). RLS is FORCE'd for that role, so the read is wrapped in
 * `withTenant`.
 *
 * ## No-ops loudly rather than guessing
 *
 * Exits immediately, without touching the database, when the DNS provider is not
 * `cloudflare` or `TENANT_DOMAIN_SERVING_TARGET` is unset. There is no default
 * target: pointing every tenant subdomain at a guessed address is a
 * platform-wide outage, so "not configured" must mean "do nothing".
 *
 * ## Exit behaviour
 *
 * A per-domain failure is recorded and the pass continues; the job only reports
 * failure for a fault that stops it running at all. A green exit therefore does
 * NOT mean every record landed — the `failed=` count in the summary line is what
 * says that. `--dry-run` reports what would change without writing.
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import { withTenantOrThrow } from "../src/lib/database/tenant-context";
import { logScriptFailure } from "../src/lib/logging/error-log";
import {
  reconcileServingRecords,
  resolveServingTarget,
  type ServingDomainRow
} from "../src/modules/tenant-domain/application/dns-serving-reconciler";
import { resolveTenantDomainDnsProvider } from "../src/modules/tenant-domain/infrastructure/cloudflare-dns-adapter";

type TenantRow = { id: string };

async function main(): Promise<void> {
  const correlationId = crypto.randomUUID();
  const dryRun = process.argv.includes("--dry-run");
  const target = resolveServingTarget();
  const providerKind = process.env.TENANT_DOMAIN_DNS_PROVIDER ?? "manual";

  if (providerKind !== "cloudflare" || !target) {
    console.log(
      `tenant-domain:dns:sync skipped — correlationId=${correlationId} ` +
        `provider=${providerKind} targetConfigured=${Boolean(target)}`
    );

    return;
  }

  const sql = getWorkerDatabaseClient();
  const provider = resolveTenantDomainDnsProvider();

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  let considered = 0;

  try {
    const tenants = (await sql`
      SELECT id FROM awcms_tenants WHERE status = 'active'
    `) as TenantRow[];

    for (const tenant of tenants) {
      const rows = await withTenantOrThrow(
        sql,
        tenant.id,
        (tx) =>
          tx`
            SELECT id, tenant_id, normalized_hostname
            FROM awcms_tenant_domains
            WHERE tenant_id = ${tenant.id}
              AND domain_type = 'subdomain'
              AND status = 'active'
              AND deleted_at IS NULL
            ORDER BY normalized_hostname
          ` as Promise<ServingDomainRow[]>,
        { workClass: "background_sync" }
      );

      considered += rows.length;

      if (rows.length === 0) {
        continue;
      }

      if (dryRun) {
        for (const row of rows) {
          console.log(
            `[dry-run] would ensure ${target.recordType} ${row.normalized_hostname} -> ${target.value} (proxied=${target.proxied})`
          );
        }

        continue;
      }

      const summary = await reconcileServingRecords(rows, provider, target);

      created += summary.created;
      updated += summary.updated;
      unchanged += summary.unchanged;
      failed += summary.failed;

      for (const outcome of summary.outcomes) {
        if (outcome.status === "failed") {
          console.error(
            `tenant-domain:dns:sync FAILED ${outcome.hostname} — retryable=${outcome.retryable} ${outcome.detail}`
          );
        }
      }
    }

    console.log(
      `tenant-domain:dns:sync complete — correlationId=${correlationId} ` +
        `dryRun=${dryRun} tenants=${tenants.length} subdomains=${considered} ` +
        `created=${created} updated=${updated} unchanged=${unchanged} failed=${failed}`
    );
  } catch (error) {
    logScriptFailure("tenant-domain:dns:sync FAILED", error);
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
