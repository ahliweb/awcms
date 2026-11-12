/**
 * Pure helpers behind `bun run database:capacity:check` (Issue #1286,
 * ADR-0161 stage S2 entry criterion "PgBouncer plus the cross-instance budget
 * check"). `scripts/database-capacity-check.ts` is the thin CLI around them
 * and `capacity-config.ts` holds the budget math itself.
 *
 * No I/O here except `readLiveLimits`, which runs only when the operator asks
 * for `--live` and which only READS two settings and one count. The report
 * contains integers and fixed words, never a DSN.
 */
import {
  pgBouncerBackendCeiling,
  type CapacityBudgetReport,
  type CapacityConfig
} from "./capacity-config";

export type LiveLimits = {
  /** `SHOW max_connections`. */
  maxConnections: number;
  /** `superuser_reserved_connections` (plus `reserved_connections` on PostgreSQL 16+). */
  reservedConnections: number;
  /** `count(*)` of `pg_stat_activity` at the moment of the check. */
  currentConnections: number;
};

/** The minimal query surface `readLiveLimits` needs, so a test can pass a stub instead of a `Bun.SQL`. */
export type LiveQueryRunner = (
  query: string
) => Promise<Array<Record<string, unknown>>>;

export async function readLiveLimits(
  run: LiveQueryRunner
): Promise<LiveLimits> {
  const settings = await run(
    "SELECT name, setting FROM pg_settings WHERE name IN ('max_connections', 'superuser_reserved_connections', 'reserved_connections')"
  );
  const byName = new Map(
    settings.map((row) => [String(row.name), Number(row.setting)])
  );
  const maxConnections = byName.get("max_connections");

  if (maxConnections === undefined || !Number.isInteger(maxConnections)) {
    throw new Error("max_connections could not be read from pg_settings.");
  }

  const activity = await run("SELECT count(*)::int AS n FROM pg_stat_activity");

  return {
    maxConnections,
    reservedConnections:
      (byName.get("superuser_reserved_connections") ?? 0) +
      (byName.get("reserved_connections") ?? 0),
    currentConnections: Number(activity[0]?.n ?? 0)
  };
}

/**
 * The live server is a hard ceiling: the approved budget becomes the smaller of
 * the configured value and `max_connections` minus the connections PostgreSQL
 * keeps for itself. A configured value above what the server can accept is
 * therefore caught, and a configured value below it is still honoured (an
 * operator may share the server with other applications).
 */
export function applyLiveLimits(
  config: CapacityConfig,
  live: LiveLimits
): { config: CapacityConfig; liveCeiling: number } {
  const liveCeiling = Math.max(
    1,
    live.maxConnections - live.reservedConnections
  );

  return {
    liveCeiling,
    config: {
      ...config,
      approvedConnections: Math.min(config.approvedConnections, liveCeiling)
    }
  };
}

const MARK = { fail: "[FAIL]", warning: "[WARNING]" } as const;

export function formatCapacityReport(
  report: CapacityBudgetReport,
  extra: { live?: LiveLimits; liveCeiling?: number } = {}
): string[] {
  const lines: string[] = [];
  const profile = report.pgBouncer.enabled
    ? "PgBouncer transaction pooling"
    : "direct PostgreSQL";

  lines.push(`database:capacity:check — profile: ${profile}`);

  for (const [label, usage] of [
    ["expected", report.expected],
    ["max     ", report.worstCase]
  ] as const) {
    const parts = usage.perClass
      .map(
        (entry) =>
          `${entry.processClass} ${entry.instanceCount}x${entry.poolMax}=${entry.connections}`
      )
      .join(", ");

    lines.push(
      `  ${label}: ${parts} -> app-side total ${usage.totalConnections}`
    );
  }

  if (report.pgBouncer.enabled) {
    const poolCount = Math.max(1, report.pgBouncer.poolCount ?? 1);

    lines.push(
      `  PgBouncer: max_client_conn ${report.pgBouncer.maxClientConnections}; ` +
        `backend ceiling ${report.pgBouncer.defaultPoolSize} x ${poolCount} pool(s) = ${pgBouncerBackendCeiling(report.pgBouncer)}`
    );
    lines.push(
      `  PostgreSQL side: ${pgBouncerBackendCeiling(report.pgBouncer)} + ${report.reservedAdminHeadroom} reserved <= approved ${report.approvedConnections}`
    );
  } else {
    lines.push(
      `  budget: ${report.worstCase.totalConnections} (max) <= ${report.availableForRuntime} ` +
        `(approved ${report.approvedConnections} - ${report.reservedAdminHeadroom} reserved)`
    );
  }

  if (extra.live) {
    lines.push(
      `  live: max_connections ${extra.live.maxConnections}, reserved ${extra.live.reservedConnections}, ` +
        `open now ${extra.live.currentConnections}, ceiling ${extra.liveCeiling}`
    );
  }

  for (const finding of report.findings) {
    lines.push(`${MARK[finding.severity]} ${finding.code}: ${finding.message}`);
  }

  lines.push(
    report.ok
      ? "database:capacity:check OK — the budget holds at the configured max instance counts."
      : "database:capacity:check FAIL — the connection budget is exceeded or inconsistent; do not scale out until it is fixed."
  );

  return lines;
}
