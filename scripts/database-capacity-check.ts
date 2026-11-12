/**
 * database-capacity-check.ts — `bun run database:capacity:check`.
 *
 * Issue #1286 (ADR-0161 stage S2). Thin CLI over
 * `src/lib/database/capacity-config.ts`: it reads the same
 * `DATABASE_POOL_MAX*` and `DATABASE_CAPACITY_*` variables the runtime reads,
 * evaluates `instances x pool max + reserved headroom` against the approved
 * budget (PostgreSQL `max_connections`, or the PgBouncer limits when
 * `DATABASE_PGBOUNCER=true`), prints the arithmetic, and exits non-zero when
 * the budget does not hold at the configured MAX instance counts.
 *
 * Default mode is OFFLINE: pure arithmetic, no database, no network. It never
 * changes configuration.
 *
 * Flags:
 *   --live   also read `max_connections` and the reserved connections from a
 *            running PostgreSQL and cap the approved budget at what the server
 *            can accept. Uses `DATABASE_CAPACITY_LIVE_URL`, else `DATABASE_URL`.
 *            Point it at PostgreSQL (not the PgBouncer admin console); behind
 *            PgBouncer a normal query still reaches PostgreSQL.
 *   --json   print the report as JSON instead of text.
 *   --help   usage.
 *
 * Exit codes: 0 pass (warnings allowed), 1 budget fails, 2 usage or live-read
 * error. A failed `--live` read is never a silent pass.
 */
import {
  evaluateCapacityBudget,
  loadCapacityConfigFromEnv
} from "../src/lib/database/capacity-config";
import {
  applyLiveLimits,
  formatCapacityReport,
  readLiveLimits,
  type LiveLimits
} from "../src/lib/database/capacity-report";
import { readConfiguredUrl } from "../src/lib/database/client";
import { safeErrorDetail } from "../src/lib/logging/error-sanitizer";

const USAGE =
  "Usage: bun run database:capacity:check [--live] [--json]\n" +
  "  --live  also read max_connections from a running PostgreSQL (DATABASE_CAPACITY_LIVE_URL or DATABASE_URL)\n" +
  "  --json  machine-readable output";

async function main(argv: string[]): Promise<number> {
  const flags = new Set(argv);
  const known = new Set(["--live", "--json", "--help"]);
  const unknown = argv.filter((arg) => !known.has(arg));

  if (flags.has("--help") || unknown.length > 0) {
    console.log(USAGE);
    return unknown.length > 0 ? 2 : 0;
  }

  let config = loadCapacityConfigFromEnv();
  let live: LiveLimits | undefined;
  let liveCeiling: number | undefined;

  if (flags.has("--live")) {
    const url =
      readConfiguredUrl("DATABASE_CAPACITY_LIVE_URL") ??
      readConfiguredUrl("DATABASE_URL");

    if (!url) {
      console.error(
        "database:capacity:check --live needs DATABASE_CAPACITY_LIVE_URL or DATABASE_URL."
      );
      return 2;
    }

    const sql = new Bun.SQL(url, { max: 1, prepare: false });

    try {
      live = await readLiveLimits(
        (query) => sql.unsafe(query) as Promise<Array<Record<string, unknown>>>
      );
    } catch (error) {
      console.error(
        `database:capacity:check --live could not read PostgreSQL limits: ${safeErrorDetail(error)}`
      );
      return 2;
    } finally {
      await sql.close();
    }

    ({ config, liveCeiling } = applyLiveLimits(config, live));
  }

  const report = evaluateCapacityBudget(config);

  if (flags.has("--json")) {
    console.log(JSON.stringify({ ...report, live, liveCeiling }, null, 2));
  } else {
    for (const line of formatCapacityReport(report, { live, liveCeiling })) {
      console.log(line);
    }
  }

  return report.ok ? 0 : 1;
}

process.exit(await main(process.argv.slice(2)));
