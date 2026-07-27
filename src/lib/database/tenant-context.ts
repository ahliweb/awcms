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
 * Thrown by `withTenantOrThrow` when the transaction was REFUSED before `fn`
 * ever ran — the circuit breaker was open, or the work class's bounded queue
 * rejected/timed out. Carries everything the HTTP shape carries, so a caller
 * that does sit on a request path can still answer `503` + `Retry-After`.
 *
 * The distinction that matters to a worker: this is "the database declined to
 * start the work", never "the work ran and found nothing". Those two are the
 * same value under the old `as T` cast, and that is the bug this type exists
 * to make unrepresentable.
 */
export class DatabaseBusyError extends Error {
  readonly code = "DATABASE_BUSY";
  readonly workClass: WorkClass;
  readonly retryAfterSeconds: number;
  /**
   * The very `503` {@link withTenant} would have returned for this refusal —
   * carried rather than rebuilt, so a caller on a request path that catches
   * this error answers with the identical status, body and `Retry-After` and
   * the two forms cannot drift apart.
   */
  readonly response: Response;

  constructor(
    message: string,
    workClass: WorkClass,
    retryAfterSeconds: number,
    response: Response
  ) {
    super(message);
    this.name = "DatabaseBusyError";
    this.workClass = workClass;
    this.retryAfterSeconds = retryAfterSeconds;
    this.response = response;
  }
}

/**
 * What the shared core produced. `rejected` covers every path that answers the
 * CALLER without running `fn` to completion: the two saturation refusals and
 * the idempotency race. Each carries both the HTTP form (for `withTenant`) and
 * the cause (for `withTenantOrThrow`), so neither wrapper has to reconstruct
 * what the other one knows.
 */
type TenantWorkOutcome<T> =
  | { status: "ok"; value: T }
  | { status: "rejected"; response: Response; cause: RejectionCause };

type RejectionCause =
  | { kind: "busy"; message: string; retryAfterSeconds: number }
  | { kind: "idempotency"; error: IdempotencyRaceLostError };

/**
 * Runs `fn` inside a tenant-scoped transaction, protected by the Issue 10.2
 * pool gate + circuit breaker (doc 16). This is the single highest-leverage
 * integration point: every existing endpoint already calls it, so extending it
 * here protects all of them without touching ~25 route files.
 *
 * Private, because its return type is the honest one and therefore awkward:
 * both public wrappers exist to turn `TenantWorkOutcome` into the shape their
 * own callers can actually handle.
 */
async function runTenantWork<T>(
  sql: Bun.SQL,
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>,
  options?: WithTenantOptions
): Promise<TenantWorkOutcome<T>> {
  const safeTenantId = assertUuid(tenantId);
  const workClass = options?.workClass ?? "interactive";
  const queueTimeoutMs = options?.queueTimeoutMs ?? DEFAULT_QUEUE_TIMEOUT_MS;
  const breaker = getDatabaseCircuitBreaker();
  const now = new Date();

  const busy = (message: string, retryAfterSeconds: number) =>
    ({
      status: "rejected",
      response: fail(503, "DATABASE_BUSY", message, {}, undefined, {
        "Retry-After": String(retryAfterSeconds)
      }),
      cause: { kind: "busy", message, retryAfterSeconds }
    }) satisfies TenantWorkOutcome<T>;

  if (!breaker.canAttempt(now)) {
    return busy(
      "Database circuit breaker is open.",
      CIRCUIT_OPEN_RETRY_AFTER_SECONDS
    );
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

      return busy(
        `Database work-class "${workClass}" queue is full; rejected immediately.`,
        WORK_CLASS_BUSY_RETRY_AFTER_SECONDS
      );
    }

    if (error instanceof WorkClassTimeoutError) {
      log("warning", "database.pool.saturated", {
        moduleKey: "database-connectivity",
        workClass,
        queueTimeoutMs,
        saturation: getWorkClassSaturation()
      });

      return busy(
        `Database work-class "${workClass}" is saturated.`,
        WORK_CLASS_BUSY_RETRY_AFTER_SECONDS
      );
    }

    throw error;
  }

  try {
    const result = await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL app.current_tenant_id = '${safeTenantId}'`);

      return fn(tx);
    });

    breaker.recordSuccess(new Date());

    return { status: "ok", value: result };
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

      return {
        status: "rejected",
        // Same key + same request hash as the winner — honor the ordinary
        // "hash sama -> replay" rule even under the race, instead of forcing
        // a same-payload retry into a 409 it wouldn't have gotten had it lost
        // the race by a few milliseconds less.
        response: error.replay
          ? jsonResponse(error.replay.responseBody, {
              status: error.replay.responseStatus
            })
          : fail(
              409,
              "IDEMPOTENCY_CONFLICT",
              "Idempotency-Key was already used with a different request."
            ),
        cause: { kind: "idempotency", error }
      };
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

/**
 * The request-path form. A refusal comes back AS the `503`/`409` `Response` it
 * should be sent as, so the ~390 handlers whose `fn` already returns a
 * `Response` are unchanged: `Response | Response` is `Response`.
 *
 * ## Why the return type grew a `| Response`
 *
 * The signature used to be `Promise<T>`, and the header said "in practice
 * every real call site uses `T = Response`". That stopped being true long
 * before anyone noticed, and the `as T` casts handed a refusal back as a value
 * of whatever type the caller asked for — invisibly, since a cast is precisely
 * the instruction "stop checking".
 *
 * The damage was not hypothetical. `purgeExpiredAuditEvents` declares
 * `Promise<number>`; under a saturated `maintenance` class (ONE slot) it
 * returned a `Response`. `runBoundedBatches` loops "until a pass returns
 * `count: 0`" — and a `Response` is never `=== 0`, so a job whose entire
 * purpose is to back off ran its full 50 passes per tenant AGAINST AN
 * ALREADY-REFUSING DATABASE, then reported `totalCount` as the string
 * `"0[object Response]…"`, because `number + Response` is concatenation.
 * Backpressure inverted into load, and the run reported success.
 *
 * A handler whose `fn` returns data now has to narrow, and narrowing is also
 * the fix — `if (result instanceof Response) return result;` forwards the
 * `503` with its `Retry-After` intact. Callers that are not serving a request
 * want {@link withTenantOrThrow}: for them a `Response` is not an answer, and
 * discarding an ignored return value would put the hole straight back.
 */
export async function withTenant<T>(
  sql: Bun.SQL,
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>,
  options?: WithTenantOptions
): Promise<T | Response> {
  const outcome = await runTenantWork(sql, tenantId, fn, options);

  return outcome.status === "ok" ? outcome.value : outcome.response;
}

/**
 * The form for everything that is not an HTTP handler — workers, scheduled
 * jobs, SSR page frontmatter, tenant resolvers, test fixtures. `fn`'s value
 * comes back as `T` and nothing else ever does: a refusal throws.
 *
 * Throwing is the correct shape for these callers, not a lesser one. A job
 * runner already classifies a thrown error as a retryable failure with
 * backoff, which is precisely what "the database is shedding load" should
 * mean; the alternative — a value the caller silently mistakes for an empty
 * result — is how a purge that ran zero times reports that it drained the
 * backlog.
 *
 * `IdempotencyRaceLostError` is re-thrown rather than converted. Idempotency
 * keys are a request-scoped concern; a caller that is not serving a request
 * has no use for the `409` and should see the original error.
 */
export async function withTenantOrThrow<T>(
  sql: Bun.SQL,
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>,
  options?: WithTenantOptions
): Promise<T> {
  const outcome = await runTenantWork(sql, tenantId, fn, options);

  if (outcome.status === "ok") {
    return outcome.value;
  }

  if (outcome.cause.kind === "idempotency") {
    throw outcome.cause.error;
  }

  throw new DatabaseBusyError(
    outcome.cause.message,
    options?.workClass ?? "interactive",
    outcome.cause.retryAfterSeconds,
    outcome.response
  );
}
