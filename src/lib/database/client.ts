import { log } from "../logging/logger";

export type ClientKind = "app" | "worker" | "setup";

const sharedClients = new Map<ClientKind, Bun.SQL>();

const DEFAULT_POOL_MAX = 20;
const DEFAULT_STATEMENT_TIMEOUT_MS = 15000;

function resolvePoolMax(): number {
  const parsed = Number(process.env.DATABASE_POOL_MAX);

  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_POOL_MAX;
}

function buildClient(databaseUrl: string, kind: ClientKind): Bun.SQL {
  const statementTimeoutMs = Number(
    process.env.DATABASE_STATEMENT_TIMEOUT_MS ?? DEFAULT_STATEMENT_TIMEOUT_MS
  );
  const usePgBouncer = process.env.DATABASE_PGBOUNCER === "true";

  return new Bun.SQL(databaseUrl, {
    max: resolvePoolMax(),
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
 * Each named client kind maps to its own Postgres role once role separation
 * is introduced (`app` -> `DATABASE_URL`, `worker` -> `WORKER_DATABASE_URL`,
 * `setup` -> `SETUP_DATABASE_URL`); `worker`/`setup` fall back to
 * `DATABASE_URL` today, so every deployment can run on one role until it
 * opts into the extra isolation.
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
  const databaseUrl = process.env[envVarName] || process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      `${envVarName} (or DATABASE_URL as a fallback) is required to connect to the database.`
    );
  }

  const client = buildClient(databaseUrl, kind);
  sharedClients.set(kind, client);
  return client;
}

/** The ordinary web-runtime connection — every ordinary HTTP request. */
export function getDatabaseClient(): Bun.SQL {
  return getNamedDatabaseClient("app");
}

/** Background/cron script connection. */
export function getWorkerDatabaseClient(): Bun.SQL {
  return getNamedDatabaseClient("worker");
}

/** Used only by the one-time setup wizard (`tenant-admin/application/platform-bootstrap.ts`). */
export function getSetupDatabaseClient(): Bun.SQL {
  return getNamedDatabaseClient("setup");
}
