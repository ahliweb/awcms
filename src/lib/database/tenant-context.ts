import { fail, jsonResponse } from "../../modules/_shared/api-response";
import { IdempotencyRaceLostError } from "../../modules/_shared/idempotency";
import { log } from "../logging/logger";
import { getDatabaseCircuitBreaker } from "./circuit-breaker";
import {
  acquireWorkClassSlot,
  getWorkClassSaturation,
  WorkClassQueueFullError,
  WorkClassTimeoutError,
  type WorkClass
} from "./work-class";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_QUEUE_TIMEOUT_MS = 2000;

/**
 * Issue #743 — `Retry-After` (seconds) attached to every `503 DATABASE_BUSY`
 * this function returns, so a well-behaved client backs off instead of
 * hammering an already-saturated/failing database ("controlled 503 instead
 * of cascading timeouts", the issue's own graceful-saturation requirement).
 * Two fixed, conservative constants rather than an exact remaining-time
 * computation: `circuit-breaker.ts` is a small, generic, shared abstraction
 * (also used by non-database providers) and deliberately does not expose
 * "ms until half-open" on its public `CircuitBreaker` interface — adding
 * that would widen a shared, already-reused contract for one caller's
 * cosmetic benefit. A fixed value is a normal, well-established pattern for
 * `Retry-After` on a `503`.
 */
const CIRCUIT_OPEN_RETRY_AFTER_SECONDS = 30;
const WORK_CLASS_BUSY_RETRY_AFTER_SECONDS = 2;

/** Postgres SQLSTATE classes that reflect bad/malformed CALLER INPUT, not a
 * database/infra failure, so they must not count against the shared circuit
 * breaker (Issue #599, extended by Issue #601):
 * - `22` — data exception (22P02 invalid_text_representation, 22003
 *   numeric_value_out_of_range, 22007 invalid_datetime_format, ...) — e.g. a
 *   non-UUID-shaped string compared/cast against a `uuid` column.
 * - `23` — integrity constraint violation (23503 foreign_key_violation,
 *   23505 unique_violation, 23514 check_violation, ...) — e.g. a
 *   caller-supplied reference doesn't exist, or a concurrent request won a
 *   uniqueness race.
 * Every other class (08 connection exception, 53 insufficient resources, 57
 * operator intervention, ...) still trips the breaker exactly as before —
 * only these two classes are excluded. */
const POSTGRES_CLIENT_INPUT_ERROR_CLASSES = ["22", "23"];

function isPostgresClientInputError(error: unknown): boolean {
  if (!(error instanceof Bun.SQL.PostgresError)) {
    return false;
  }

  const sqlstate = String(error.errno);

  return POSTGRES_CLIENT_INPUT_ERROR_CLASSES.some((sqlstateClass) =>
    sqlstate.startsWith(sqlstateClass)
  );
}

export function assertUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`Expected a UUID, received: ${value}`);
  }

  return value;
}

export type WithTenantOptions = {
  /** Defaults to "interactive" (doc 16 §Connection pooling dan backpressure). */
  workClass?: WorkClass;
  /** Defaults to 2000ms. */
  queueTimeoutMs?: number;
};

/**
 * Runs `fn` inside a tenant-scoped transaction, protected by the Issue 10.2
 * pool gate + circuit breaker (doc 16). This is the single highest-leverage
 * integration point: every existing endpoint already calls `withTenant`, so
 * extending it here protects all of them without touching ~25 route files.
 *
 * `T` is generic for backward compatibility, but in practice every real call
 * site uses `T = Response` (every existing endpoint returns the result of
 * `withTenant` directly from its handler, matching how Issue 8.1/9.1's
 * endpoints already implicitly assume this). The `fail(...)` calls below are
 * therefore cast to `T` — this is type-safe in practice, even though the
 * generic signature doesn't statically enforce `T = Response`.
 */
export async function withTenant<T>(
  sql: Bun.SQL,
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>,
  options?: WithTenantOptions
): Promise<T> {
  const safeTenantId = assertUuid(tenantId);
  const workClass = options?.workClass ?? "interactive";
  const queueTimeoutMs = options?.queueTimeoutMs ?? DEFAULT_QUEUE_TIMEOUT_MS;
  const breaker = getDatabaseCircuitBreaker();
  const now = new Date();

  if (!breaker.canAttempt(now)) {
    return fail(
      503,
      "DATABASE_BUSY",
      "Database circuit breaker is open.",
      {},
      undefined,
      { "Retry-After": String(CIRCUIT_OPEN_RETRY_AFTER_SECONDS) }
    ) as T;
  }

  let slot;

  try {
    slot = await acquireWorkClassSlot(workClass, queueTimeoutMs);
  } catch (error) {
    if (error instanceof WorkClassQueueFullError) {
      // Issue #743 — rejected immediately (queue was already at its bounded
      // cap), never actually waited. Distinct log event from the
      // timeout-after-waiting case below, so operators/dashboards can tell
      // "instant reject" apart from "waited the full timeout".
      log("warning", "database.pool.rejected", {
        moduleKey: "database-connectivity",
        workClass,
        queueDepth: error.queueDepth,
        saturation: getWorkClassSaturation()
      });

      return fail(
        503,
        "DATABASE_BUSY",
        `Database work-class "${workClass}" queue is full; rejected immediately.`,
        {},
        undefined,
        { "Retry-After": String(WORK_CLASS_BUSY_RETRY_AFTER_SECONDS) }
      ) as T;
    }

    if (error instanceof WorkClassTimeoutError) {
      log("warning", "database.pool.saturated", {
        moduleKey: "database-connectivity",
        workClass,
        queueTimeoutMs,
        saturation: getWorkClassSaturation()
      });

      return fail(
        503,
        "DATABASE_BUSY",
        `Database work-class "${workClass}" is saturated.`,
        {},
        undefined,
        { "Retry-After": String(WORK_CLASS_BUSY_RETRY_AFTER_SECONDS) }
      ) as T;
    }

    throw error;
  }

  try {
    const result = await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL app.current_tenant_id = '${safeTenantId}'`);

      return fn(tx);
    });

    breaker.recordSuccess(new Date());

    return result;
  } catch (error) {
    if (error instanceof IdempotencyRaceLostError) {
      // Benign concurrency outcome, not a database/infra failure — skip the
      // circuit breaker so bursty duplicate-submit traffic can't false-trip it.
      log("info", "idempotency.race_lost", {
        moduleKey: "database-connectivity",
        tenantId: safeTenantId,
        requestScope: error.requestScope,
        idempotencyKeyHash: error.idempotencyKeyHash,
        replayed: error.replay !== null
      });

      if (error.replay) {
        // Same key + same request hash as the winner — honor the ordinary
        // "hash sama -> replay" rule even under the race, instead of forcing
        // a same-payload retry into a 409 it wouldn't have gotten had it lost
        // the race by a few milliseconds less.
        return jsonResponse(error.replay.responseBody, {
          status: error.replay.responseStatus
        }) as T;
      }

      return fail(
        409,
        "IDEMPOTENCY_CONFLICT",
        "Idempotency-Key was already used with a different request."
      ) as T;
    }

    if (isPostgresClientInputError(error)) {
      log("info", "database.client_input_error_excluded", {
        moduleKey: "database-connectivity",
        tenantId: safeTenantId,
        sqlstate: (error as InstanceType<typeof Bun.SQL.PostgresError>).errno
      });
    } else {
      breaker.recordFailure(new Date());
    }

    throw error;
  } finally {
    slot.release();
  }
}
