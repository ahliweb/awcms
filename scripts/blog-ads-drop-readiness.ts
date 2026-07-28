/**
 * blog-ads-drop-readiness.ts — `bun run blog:ads:drop-readiness`.
 *
 * ADR-0044 §4 Fase 2, step three: answers "may `awcms_blog_ads` and
 * `awcms_blog_ad_placements` be dropped yet?" from the data, and exits non-zero
 * while the answer is no.
 *
 * The drop migration is irreversible and takes a live site's advertising with
 * it. Every other safeguard in this epic is about not losing rows silently, and
 * they all become decorative if the final step is taken on the strength of
 * someone remembering they ran the ingest. Migration 079's
 * `source_legacy_ad_id` exists so this can be a join instead: run this, read
 * the number, and only then write the drop.
 *
 * A legacy ad is accounted for when a successor row names it, OR when it is
 * soft-deleted — an operator read the residue report and decided it does not
 * come along. Anything else blocks. There is deliberately no override flag: a
 * check that can be told to pass is a check nobody has to satisfy.
 *
 * Read-only. It issues no UPDATE, INSERT or DELETE, so it is safe to run
 * against production at any time, including before the ingest has ever run.
 *
 * Runs as the least-privilege `awcms_worker` role, which holds SELECT on both
 * legacy tables and the successor (`sql/079`) and nothing more. RLS is FORCE'd
 * for that role too, so every pass is wrapped in `withTenantOrThrow`.
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import { withTenantOrThrow } from "../src/lib/database/tenant-context";
import { logScriptFailure } from "../src/lib/logging/error-log";
import {
  MAX_REPORTED_OUTSTANDING,
  assessLegacyAdDropReadiness,
  isReadyToDrop,
  type LegacyAdDropReadiness
} from "../src/modules/blog-content/application/legacy-ad-drop-readiness";

type TenantRow = { id: string };

async function main() {
  const sql = getWorkerDatabaseClient();
  const correlationId = crypto.randomUUID();

  try {
    const tenants = (await sql`
      SELECT id FROM awcms_tenants WHERE status = 'active'
    `) as TenantRow[];

    const reports: LegacyAdDropReadiness[] = [];

    for (const tenant of tenants) {
      reports.push(
        await withTenantOrThrow(sql, tenant.id, (tx) =>
          assessLegacyAdDropReadiness(tx, tenant.id)
        )
      );
    }

    for (const report of reports) {
      if (report.totalLegacyAds === 0 && report.retired === 0) {
        continue;
      }

      console.log(
        `blog:ads:drop-readiness tenant=${report.tenantId} ` +
          `legacyAds=${report.totalLegacyAds} migrated=${report.migrated} ` +
          `outstanding=${report.outstanding} retired=${report.retired}`
      );

      for (const adId of report.outstandingAdIds) {
        console.log(
          `blog:ads:drop-readiness OUTSTANDING — tenant=${report.tenantId} legacyAd=${adId}`
        );
      }

      // Never let a truncated list of blockers read as a complete one.
      if (report.outstanding > report.outstandingAdIds.length) {
        console.log(
          `blog:ads:drop-readiness — ${report.outstanding - report.outstandingAdIds.length} ` +
            `further outstanding ad(s) in tenant ${report.tenantId} not listed ` +
            `(cap ${MAX_REPORTED_OUTSTANDING}). The count above is exact.`
        );
      }
    }

    const totalOutstanding = reports.reduce(
      (sum, report) => sum + report.outstanding,
      0
    );

    if (isReadyToDrop(reports)) {
      console.log(
        `blog:ads:drop-readiness READY — correlationId=${correlationId} ` +
          `tenants=${tenants.length}. Every legacy advertisement has either ` +
          `migrated or been retired. The drop migration may be written.`
      );
      return;
    }

    console.error(
      `blog:ads:drop-readiness NOT READY — correlationId=${correlationId} ` +
        `tenants=${tenants.length} outstanding=${totalOutstanding}. Each ad ` +
        `listed above has no successor row and is not soft-deleted, so ` +
        `dropping the legacy tables now would destroy it with no record. Run ` +
        `\`bun run blog:ads:ingest\`, resolve its residue, and re-run this.`
    );
    process.exitCode = 1;
  } catch (error) {
    logScriptFailure("blog:ads:drop-readiness FAILED", error);
    process.exitCode = 1;
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
