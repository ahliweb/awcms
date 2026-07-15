/**
 * Retry classification (Issue #697, epic #679, platform-hardening — shared
 * worker runner). Standardizes which caught errors are safe to retry — on
 * the next scheduled run, since this runner does not implement its own
 * in-process retry/backoff loop (that would start turning this "small
 * shared runner" into a job-queue system, which the issue explicitly rules
 * out) — versus which represent a caller/data problem that will fail again
 * identically no matter how many times it runs.
 *
 * Reuses, rather than re-derives, the exact SQLSTATE-class split
 * `src/lib/database/tenant-context.ts`'s `isPostgresClientInputError`
 * already established for the same underlying question ("is this a
 * database/infra failure, or bad caller input?"):
 *
 * - Class `22` (data exception) and `23` (integrity constraint violation)
 *   are NOT_RETRYABLE here too — a unique-violation or an invalid-input
 *   value will fail the exact same way on a retry.
 *
 * Adds the two SQLSTATE codes PostgreSQL's own documentation names as
 * expected-and-safe-to-retry ("Serialization Failure Handling",
 * postgresql.org/docs/current/mvcc-serialization-failure-handling.html):
 * `40001` (serialization_failure, under `SERIALIZABLE`) and `40P01`
 * (deadlock_detected) — both are the database asking the client to just
 * try the whole transaction again. Also treats connection-level exceptions
 * (class `08`), insufficient-resources (class `53`), and operator
 * intervention (class `57`, e.g. `57P03` cannot_connect_now during a
 * restart) as retryable — transient infra conditions, not data problems.
 */
export type RetryClassification = "retryable" | "not_retryable" | "unknown";

/** Specific SQLSTATEs known to be safe/expected to retry, regardless of class. */
const RETRYABLE_SQLSTATES = new Set(["40001", "40P01"]);

/** SQLSTATE classes that are always transient/infra, never a data problem. */
const RETRYABLE_SQLSTATE_CLASSES = ["08", "53", "57"];

/**
 * Mirrors `isPostgresClientInputError` in `src/lib/database/tenant-context.ts`
 * exactly — kept as a literal duplicate of that constant (not an import)
 * because that module's array is private to its own circuit-breaker
 * exclusion concern; duplicating two short string literals here is lower
 * coupling than exporting an internal implementation detail across an
 * unrelated module boundary for it.
 */
const NOT_RETRYABLE_SQLSTATE_CLASSES = ["22", "23"];

/** Transient network error message fragments — for provider HTTP calls (ADR-0006: always outside the DB transaction) that reject with a plain `Error`/`TypeError`, not a `Bun.SQL.PostgresError`. */
const RETRYABLE_NETWORK_ERROR_PATTERN =
  /timed?\s*out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EPIPE|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH/i;

/**
 * Classifies a caught error for job telemetry — never throws, regardless of
 * what `error` actually is. `"unknown"` is a deliberate third outcome (not
 * bucketed into either side): an error this classifier has no specific rule
 * for is reported as such rather than guessed at, so an operator reading
 * job telemetry can tell "we know this is safe/unsafe to retry" apart from
 * "we don't have a rule for this yet".
 */
export function classifyError(error: unknown): RetryClassification {
  if (error instanceof Bun.SQL.PostgresError) {
    const sqlstate = String(error.errno ?? error.code ?? "");

    if (RETRYABLE_SQLSTATES.has(sqlstate)) {
      return "retryable";
    }

    if (
      NOT_RETRYABLE_SQLSTATE_CLASSES.some((sqlstateClass) =>
        sqlstate.startsWith(sqlstateClass)
      )
    ) {
      return "not_retryable";
    }

    if (
      RETRYABLE_SQLSTATE_CLASSES.some((sqlstateClass) =>
        sqlstate.startsWith(sqlstateClass)
      )
    ) {
      return "retryable";
    }

    return "unknown";
  }

  if (
    error instanceof Error &&
    RETRYABLE_NETWORK_ERROR_PATTERN.test(error.message)
  ) {
    return "retryable";
  }

  return "unknown";
}
