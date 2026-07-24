/**
 * audit-log-purge.ts — `bun run logs:audit:purge`.
 *
 * Issue #146. Scheduled worker entrypoint for `purgeExpiredAuditEvents`
 * (`src/modules/logging/application/audit-purge.ts`) — the missing
 * implementation behind `AUDIT_LOG_RETENTION_DAYS`, which this repo has
 * documented and validated since day one while nothing read it.
 *
 * Not exposed over HTTP, deliberately: `awcms_audit_events` retention is an
 * administrative operation, not something a tenant-scoped role should be
 * able to trigger over the API (doc 04 §Aturan implementasi — purge is an
 * operational decision for "retention/legal hold yang memenuhi syarat", not
 * a user action). Same shape as `scripts/object-sync-dispatch.ts` and the
 * other cron-style workers: run it from cron/systemd timer/k8s CronJob.
 *
 * Uses the shared job runner (`src/lib/jobs/job-runner.ts`), so it gets, for
 * free: a Postgres advisory lock (two concurrent runs cannot purge the same
 * backlog at once — the second skips), a timeout, a correlation id threaded
 * into every purge audit event it writes, structured telemetry, and a
 * meaningful exit code.
 *
 * Retention is resolved per run in this priority order:
 *   1. `--retention-days=<n>` CLI flag
 *   2. `AUDIT_LOG_RETENTION_DAYS` env var (.env.example, doc 18)
 *   3. `AUDIT_EVENT_DEFAULT_RETENTION_DAYS` (730 days / 2 years)
 *
 * `--dry-run` counts what WOULD be purged (read-only `count(*)` per tenant
 * against the same cutoff) without deleting anything or writing any purge
 * audit event — safe to run against production to preview impact before
 * scheduling it for real. Strongly recommended for the first run: on a
 * database that has never been purged, the first real run's backlog is
 * every audit event ever written past the cutoff.
 *
 * A tenant whose backlog was NOT fully drained (hit `batching.ts`'s pass
 * count safety bound) is surfaced in `tenantsHitPassLimit` and makes the job
 * report `status: "partial"` rather than being silently swallowed — schedule
 * more frequently, or run again, until it reports `success`.
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import {
  applyJobExitCode,
  formatJobOutcomeLine,
  isJobResultOk,
  parseJobCliArgs,
  printJobTelemetry,
  runJob,
  writeJobTelemetry,
  type JobContext
} from "../src/lib/jobs/job-runner";
import {
  fetchActiveTenants,
  iterateTenantsInBatches
} from "../src/lib/jobs/batching";
import {
  AUDIT_EVENT_DEFAULT_RETENTION_DAYS,
  countPurgeableAuditEvents,
  purgeExpiredAuditEvents,
  resolveAuditRetentionCutoff
} from "../src/modules/logging/application/audit-purge";
import { legalHoldGuardPortAdapter } from "../src/modules/data-lifecycle/application/legal-hold-guard-port-adapter";

export function resolveRetentionDays(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): number {
  const flag = argv.find((arg) => arg.startsWith("--retention-days="));

  if (flag) {
    const parsed = Number(flag.split("=")[1]);

    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  const envValue = env.AUDIT_LOG_RETENTION_DAYS;

  if (envValue) {
    const parsed = Number(envValue);

    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return AUDIT_EVENT_DEFAULT_RETENTION_DAYS;
}

export type AuditLogPurgeOptions = {
  /** Defaults to `resolveRetentionDays()` (reads CLI flag, then env). */
  retentionDays?: number;
  /** Defaults to `new Date()`. Injectable for deterministic tests. */
  now?: Date;
  /** Forwarded to `purgeExpiredAuditEvents`'s `batchLimit`. Exposed so tests can force a tiny per-pass limit and assert multiple bounded passes — not a CLI flag; the production default is unchanged. */
  batchLimit?: number;
  /** Forwarded to `iterateTenantsInBatches`'s `maxPasses`. Exposed so tests can force `hitPassLimit`/`status: "partial"` with a small seed — not a CLI flag; the production default (50) is unchanged. */
  maxPasses?: number;
};

export type AuditLogPurgeResult = {
  tenantsChecked: number;
  totalPurged: number;
  cutoffIso: string;
  /** Tenant ids whose backlog was NOT fully drained this run. Non-empty makes the job report `status: "partial"`. */
  tenantsHitPassLimit: string[];
};

/**
 * Core logic, extracted from `main()` so tests can exercise it directly
 * against a real database without spawning a subprocess.
 */
export async function runAuditLogPurge(
  sql: Bun.SQL,
  ctx: Pick<JobContext, "dryRun" | "correlationId"> &
    Partial<Pick<JobContext, "signal">>,
  options: AuditLogPurgeOptions = {}
): Promise<AuditLogPurgeResult> {
  const retentionDays = options.retentionDays ?? resolveRetentionDays();
  const now = options.now ?? new Date();
  const cutoff = resolveAuditRetentionCutoff(now, retentionDays);

  if (ctx.dryRun) {
    const tenants = await fetchActiveTenants(sql);
    let totalWouldPurge = 0;

    for (const tenant of tenants) {
      if (ctx.signal?.aborted) {
        break;
      }

      totalWouldPurge += await countPurgeableAuditEvents(
        sql,
        tenant.id,
        cutoff
      );
    }

    return {
      tenantsChecked: tenants.length,
      totalPurged: totalWouldPurge,
      cutoffIso: cutoff.toISOString(),
      tenantsHitPassLimit: []
    };
  }

  const { tenants, totalCount, perTenant } = await iterateTenantsInBatches(
    sql,
    async (tenantId) => {
      const result = await purgeExpiredAuditEvents(
        sql,
        tenantId,
        legalHoldGuardPortAdapter,
        {
          retentionDays,
          now,
          batchLimit: options.batchLimit,
          correlationId: ctx.correlationId
        }
      );

      return { count: result.purgedCount };
    },
    { signal: ctx.signal, maxPasses: options.maxPasses }
  );

  const tenantsHitPassLimit = [...perTenant.entries()]
    .filter(([, outcome]) => outcome.hitPassLimit)
    .map(([tenantId]) => tenantId);

  return {
    tenantsChecked: tenants.length,
    totalPurged: totalCount,
    cutoffIso: cutoff.toISOString(),
    tenantsHitPassLimit
  };
}

async function main() {
  const sql = getWorkerDatabaseClient();
  const cliOptions = parseJobCliArgs(process.argv.slice(2));
  // Resolved here (not left to runAuditLogPurge's own default) only so the
  // completion line below can print the value actually used.
  const retentionDays = resolveRetentionDays();

  try {
    const result = await runJob(
      {
        name: "logs:audit:purge",
        description:
          "Purges awcms_audit_events rows past retention (AUDIT_LOG_RETENTION_DAYS) for every active tenant.",
        handler: async (ctx) => {
          const purgeResult = await runAuditLogPurge(sql, ctx, {
            retentionDays
          });
          const hitPassLimit = purgeResult.tenantsHitPassLimit.length > 0;

          console.log(
            `logs:audit:purge complete — correlationId=${ctx.correlationId} ` +
              `retentionDays=${retentionDays} cutoff=${purgeResult.cutoffIso} ` +
              `tenants=${purgeResult.tenantsChecked} purged=${purgeResult.totalPurged}` +
              (ctx.dryRun ? " (dry-run: nothing was deleted)" : "") +
              (hitPassLimit
                ? ` (WARNING: ${purgeResult.tenantsHitPassLimit.length} tenant(s) still had backlog remaining after the pass-count safety bound)`
                : "")
          );

          return {
            status: hitPassLimit ? "partial" : "success",
            itemCounts: {
              tenantsChecked: purgeResult.tenantsChecked,
              purged: purgeResult.totalPurged,
              tenantsHitPassLimit: purgeResult.tenantsHitPassLimit.length
            },
            detail: hitPassLimit
              ? `Backlog not fully drained for: ${purgeResult.tenantsHitPassLimit.join(", ")}`
              : undefined
          };
        }
      },
      { sql, dryRun: cliOptions.dryRun }
    );

    printJobTelemetry(result);
    await writeJobTelemetry(result, cliOptions.jsonOutputPath);

    if (!isJobResultOk(result)) {
      console.error(formatJobOutcomeLine(result));
    }

    applyJobExitCode(result);
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
