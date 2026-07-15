import { log } from "../logging/logger";

export type ClientKind = "app" | "worker" | "setup";

const sharedClients = new Map<ClientKind, Bun.SQL>();

const DEFAULT_POOL_MAX = 20;
const DEFAULT_STATEMENT_TIMEOUT_MS = 15000;

/** Per-kind override env var name — `null` for `"app"`, which keeps using the original, unprefixed `DATABASE_POOL_MAX` for backward compatibility (Issue #683 named the app role's connection string `DATABASE_URL`, not `APP_DATABASE_URL`, for the same reason). */
const POOL_MAX_OVERRIDE_ENV_VAR: Record<ClientKind, string | null> = {
  app: null,
  worker: "DATABASE_POOL_MAX_WORKER",
  setup: "DATABASE_POOL_MAX_SETUP"
};

/**
 * Issue #743 (epic #738, platform-evolution) — resolves the effective pool
 * `max` for one named client kind, so the capacity calculator
 * (`src/lib/database/capacity-config.ts`) can read EXACTLY the number
 * `buildClient` below actually configures, never a shadow copy that could
 * drift from it. `worker`/`setup` each fall back to the shared
 * `DATABASE_POOL_MAX` when their own override var is unset or invalid —
 * this preserves the exact pre-#743 behavior (every kind used the same
 * `DATABASE_POOL_MAX` number) for every deployment that has not opted into
 * per-kind sizing. Tries, in order: the kind's own override var (if
 * defined AND valid) -> `DATABASE_POOL_MAX` (if valid) -> the hardcoded
 * `DEFAULT_POOL_MAX` — an INVALID override (non-finite/non-positive/
 * non-integer) falls through to the next tier rather than jumping straight
 * to the hardcoded default, so a malformed `DATABASE_POOL_MAX_WORKER`
 * doesn't discard an otherwise-valid, deliberately-set `DATABASE_POOL_MAX`.
 * Never throws — a malformed override must never prevent the process from
 * starting; `bun run config:validate`/`database:capacity:check` are where
 * operators are told about a bad value, not the pool constructor.
 */
export function resolvePoolMaxForKind(
  kind: ClientKind,
  env: Record<string, string | undefined> = process.env
): number {
  const overrideVar = POOL_MAX_OVERRIDE_ENV_VAR[kind];
  const candidates = [
    overrideVar ? env[overrideVar] : undefined,
    env.DATABASE_POOL_MAX
  ];

  for (const candidate of candidates) {
    if (candidate === undefined) {
      continue;
    }

    const parsed = Number(candidate);

    if (Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return DEFAULT_POOL_MAX;
}

/**
 * Issue 10.2 pool config. `Bun.SQL` itself only understands a flat
 * connection pool (`max`); it has no notion of "work class" — that
 * concurrency gate lives in `work-class.ts` and sits in front of this
 * client. This module only wires:
 *
 * - `max` — pool size, from `DATABASE_POOL_MAX` (doc 16 §Connection pooling),
 *   optionally overridden per kind (`resolvePoolMaxForKind` above, Issue
 *   #743) via `DATABASE_POOL_MAX_WORKER`/`DATABASE_POOL_MAX_SETUP`.
 * - `prepare` — disabled when `DATABASE_PGBOUNCER=true`, since automatic
 *   prepared statements are unsafe/ineffective behind PgBouncer transaction
 *   mode (doc 16, `docs/awcms/database-pooling.md`).
 * - `connection.statement_timeout` — sets the session-level
 *   `statement_timeout` GUC on every new pooled connection. NOTE: per
 *   `node_modules/bun-types/sql.d.ts`, `onconnect` on `Bun.SQL.Options` is
 *   typed `(err: Error | null) => void` — it only reports connect
 *   success/failure, it does not hand back a client to run SQL against (the
 *   `onconnect: (client) => ...` shown in that same file's own JSDoc example
 *   is inconsistent with the actual signature). The documented, type-correct
 *   way to apply a per-connection session GUC like `statement_timeout` is
 *   the `connection` option ("Postgres client runtime configuration
 *   options", see postgresql.org/docs/current/runtime-config-client.html),
 *   which Bun applies to every pooled connection at connect time. `onconnect`
 *   is still used below, only to log connection failures.
 */
function buildClient(databaseUrl: string, kind: ClientKind): Bun.SQL {
  const poolMax = resolvePoolMaxForKind(kind);
  const statementTimeoutMs = Number(
    process.env.DATABASE_STATEMENT_TIMEOUT_MS ?? DEFAULT_STATEMENT_TIMEOUT_MS
  );
  const usePgBouncer = process.env.DATABASE_PGBOUNCER === "true";

  return new Bun.SQL(databaseUrl, {
    max: poolMax,
    prepare: !usePgBouncer,
    connection: {
      statement_timeout:
        Number.isFinite(statementTimeoutMs) && statementTimeoutMs > 0
          ? statementTimeoutMs
          : DEFAULT_STATEMENT_TIMEOUT_MS
    },
    onconnect: (err) => {
      if (err) {
        log("error", "database.connection.failed", {
          moduleKey: "database-connectivity",
          clientKind: kind,
          error: err.message
        });
      }
    }
  });
}

/**
 * Issue #683 (epic #679, platform-hardening) — each named client kind maps
 * to its own least-privilege Postgres role (`sql/045_awcms_db_role_
 * separation.sql`): `app` -> `awcms_app` (`DATABASE_URL`, unchanged
 * name/var for backward compatibility), `worker` -> `awcms_worker`
 * (`WORKER_DATABASE_URL`), `setup` -> `awcms_setup`
 * (`SETUP_DATABASE_URL`). `worker`/`setup` fall back to `DATABASE_URL` (the
 * `app` connection) when their own env var isn't set — small/offline
 * deployments that don't want to manage 3 connection strings can still run
 * everything through the single narrowed `awcms_app` role; operators
 * who want the extra defense-in-depth isolation set the dedicated vars.
 * Each kind gets its OWN lazily-created, memoized `Bun.SQL` pool — never
 * shared across kinds, even when they resolve to the same URL by fallback
 * (simpler than trying to dedupe pools by URL, and pool-per-kind is cheap:
 * `Bun.SQL` pools are lazy, an unused one opens zero connections).
 */
function getNamedDatabaseClient(kind: ClientKind): Bun.SQL {
  const existing = sharedClients.get(kind);

  if (existing) {
    return existing;
  }

  const envVarName =
    kind === "app"
      ? "DATABASE_URL"
      : kind === "worker"
        ? "WORKER_DATABASE_URL"
        : "SETUP_DATABASE_URL";
  const databaseUrl = process.env[envVarName] ?? process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      `${envVarName} (or DATABASE_URL as a fallback) is required to connect to the database.`
    );
  }

  const client = buildClient(databaseUrl, kind);
  sharedClients.set(kind, client);
  return client;
}

/** The "web runtime" connection (`awcms_app`) — every ordinary HTTP request. */
export function getDatabaseClient(): Bun.SQL {
  return getNamedDatabaseClient("app");
}

/** The "background worker" connection (`awcms_worker`) — the 9 unattended cron-style scripts with no corresponding web endpoint (count corrected by Issue #743, ground truth = `grep -rl getWorkerDatabaseClient scripts/`, see `src/lib/database/work-class-registry.ts`'s `JOB_WORK_CLASS_REGISTRY` for the exact current list; migration 045's header predates that count). Falls back to `DATABASE_URL` if `WORKER_DATABASE_URL` isn't set. */
export function getWorkerDatabaseClient(): Bun.SQL {
  return getNamedDatabaseClient("worker");
}

/** The "bootstrap/setup" connection (`awcms_setup`) — used ONLY by `tenant-admin/application/platform-bootstrap.ts`'s one-time setup wizard. Falls back to `DATABASE_URL` if `SETUP_DATABASE_URL` isn't set. */
export function getSetupDatabaseClient(): Bun.SQL {
  return getNamedDatabaseClient("setup");
}
