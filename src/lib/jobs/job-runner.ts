/**
 * Shared worker runner (Issue #697, epic #679, platform-hardening).
 *
 * Every `scripts/*.ts` cron/systemd worker (`bun run logs:audit:purge`,
 * `bun run modules:sync`, ...) re-implements the same handful of concerns
 * slightly differently: iterate tenants, generate a correlation/run id,
 * decide the process exit code, print a completion summary, and log
 * failures safely. `runJob` is the single place that logic now lives —
 * migrating a script to it is OPTIONAL and incremental (see
 * `docs/awcms/deployment-profiles.md` §Shared worker runner); scripts
 * that have not migrated yet remain fully valid.
 *
 * What this module deliberately does NOT do: it is not a job *queue* — it
 * has no persistence, no scheduling, no cross-process work distribution,
 * and no automatic retry-with-backoff loop. Scheduling stays exactly what
 * it already is (an external cron/systemd timer/container scheduler
 * invoking `bun run <script>`); this only makes a single invocation of a
 * single script safer and more observable. Introducing an orchestration
 * platform (BullMQ, Temporal, ...) is explicitly out of scope (issue text:
 * "tanpa memperkenalkan orchestration platform terpisah").
 *
 * Composition, not a god-object: `runJob` composes three independent
 * modules a caller can also use directly —
 * `./advisory-lock.ts` (duplicate-run prevention),
 * `./batching.ts` (bounded tenant/item iteration), and
 * `./retry-classification.ts` (safe-to-retry-next-tick classification) —
 * plus `../logging/error-sanitizer.ts` (Issue #687) for redaction. No new
 * redaction/log-masking mechanism is added here.
 */
import { acquireAdvisoryLock, type AdvisoryLockHandle } from "./advisory-lock";
import {
  classifyError,
  type RetryClassification
} from "./retry-classification";
import {
  sanitizeErrorForLog,
  type SafeErrorDetail
} from "../logging/error-sanitizer";
import {
  recordCounter,
  recordGauge,
  recordHistogram
} from "../observability/metrics-port";

export type JobStatus =
  "success" | "partial" | "failed" | "skipped" | "timeout" | "terminated";

/** What a job handler returns on successful completion (including a "partial" outcome — some items failed, but the run itself did not throw). Every field is optional: a handler that returns nothing (`void`) is treated as a plain success with no counts. */
export type JobHandlerResult = {
  /** Defaults to `"success"`. Set `"partial"` when the handler completed but some individual items failed (surfaced in telemetry, and `applyJobExitCode` treats it as non-zero). */
  status?: "success" | "partial";
  /** Free-form named counters (e.g. `{ tenantsChecked: 5, purged: 120 }`) — printed as-is in JSON telemetry. */
  itemCounts?: Record<string, number>;
  /** Short human-readable summary, mirrors the `detail` field `production-preflight.ts`'s `StageResult` already uses. */
  detail?: string;
};

export type JobContext = {
  runId: string;
  correlationId: string;
  dryRun: boolean;
  /** Aborts when the job's timeout elapses OR the process receives SIGTERM/SIGINT. Well-behaved handlers should check `signal.aborted` in loops (or pass it to abortable I/O) so cancellation is prompt — see the module doc comment on `runJob` for the limits of what an `AbortSignal` can and cannot interrupt. */
  signal: AbortSignal;
};

export type JobDefinition = {
  /** Used as the advisory-lock key (via `hashJobNameToInt32`) and the label in telemetry — should be stable across releases (e.g. the same string as the `bun run <name>` package.json script), since changing it changes the lock key. */
  name: string;
  description: string;
  /** Defaults to `DEFAULT_JOB_TIMEOUT_MS` (15 minutes). */
  timeoutMs?: number;
  /** Defaults to `DEFAULT_LOCK_RELEASE_GRACE_MS` (30s). Only relevant on a timeout/termination: the maximum extra time the advisory lock is kept held AFTER `runJob` has already returned its `"timeout"`/`"terminated"` result, waiting for `handler` to actually stop, before releasing anyway. See `runJob`'s doc comment §Cancellation model. */
  lockReleaseGraceMs?: number;
  handler: (ctx: JobContext) => Promise<JobHandlerResult | void>;
};

export type JobResult = {
  jobName: string;
  runId: string;
  correlationId: string;
  status: JobStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  dryRun: boolean;
  itemCounts?: Record<string, number>;
  detail?: string;
  error?: SafeErrorDetail;
  retryClassification?: RetryClassification;
};

export const DEFAULT_JOB_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * PR #713 security review follow-up (Issue #697, security-auditor High
 * finding). Default bound for how long a timed-out/terminated `runJob` call
 * keeps the advisory lock held IN THE BACKGROUND, after already having
 * returned its `"timeout"`/`"terminated"` `JobResult` to the caller, waiting
 * for `handler` to actually stop before releasing. 30s is generous enough
 * for a well-behaved handler built on `iterateTenantsInBatches` (which
 * checks `signal.aborted` between passes/tenants, see `batching.ts`) to
 * notice the abort and unwind within at most one in-flight
 * pass/statement's duration, while still bounded (never "forever") for a
 * handler that ignores the signal entirely.
 */
export const DEFAULT_LOCK_RELEASE_GRACE_MS = 30_000;

export type RunJobOptions = {
  /** Pool used to reserve the advisory-lock connection (`sql.reserve()`) — typically `getWorkerDatabaseClient()`. The handler receives its OWN `sql`/tenant-scoped clients via closure, not through this option; this `sql` is used for locking only. Needs a pool size of at least 2 (see `./advisory-lock.ts` §Minimum pool size) — the reserved lock connection alone would exhaust a pool of 1, deadlocking the handler's own first query. */
  sql: Bun.SQL;
  correlationId?: string;
  dryRun?: boolean;
  /** Signals that trigger graceful cancellation + lock release. Defaults to `["SIGTERM", "SIGINT"]`. */
  terminationSignals?: NodeJS.Signals[];
};

function nowIso(date: Date): string {
  return date.toISOString();
}

/**
 * Issue #698 (epic #679, "operational proof" wave) — the single choke point
 * for job run metrics. Every `runJob` return path (lock-acquire failure,
 * skip-on-contention, success/partial, timeout/terminated, thrown error)
 * flows through `buildResult`, so hooking metrics HERE instruments every
 * current and future job uniformly without touching any of the ~5 call
 * sites inside `runJob` individually, and without any migrated script
 * needing its own instrumentation. `jobName`/`status`/`itemName` are all
 * code-defined literals (never tenant/request input, see
 * `METRIC_DEFINITIONS` in `metrics-port.ts`), so this is safe to call
 * unconditionally.
 */
/**
 * `itemName` (an `itemCounts` object key, e.g. `"purged"`/`"tenantsChecked"`)
 * is the one label in this file NOT covered by `METRIC_DEFINITIONS`'s
 * compile-time `allowedLabelKeys` enforcement — `JobHandlerResult.itemCounts`
 * is typed `Record<string, number>`, so nothing stops a FUTURE job handler
 * from writing `itemCounts: { [someTenantId]: 1 }` or a raw email as a key.
 * Every job migrated onto `runJob` today only ever uses safe literal keys
 * (verified: `audit-log-purge.ts`, `modules-sync.ts`,
 * `news-media-r2-reconcile.ts`) — this pattern-match is defense-in-depth
 * against a future handler doing otherwise, matching the same spirit as
 * `metrics-port.ts`'s `allowedLabelKeys` filtering (security-auditor
 * finding on PR #721). A short, lowercase-start, alphanumeric+underscore
 * identifier can never be a UUID (which has dashes) or an email (which has
 * `@`/`.`) or a tenant-scoped string like `sso:<tenantId>:okta`.
 */
const SAFE_ITEM_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,40}$/;

function emitJobRunMetrics(result: JobResult): void {
  recordCounter("job_run_total", {
    jobName: result.jobName,
    status: result.status
  });
  recordHistogram("job_run_duration_ms", result.durationMs, {
    jobName: result.jobName
  });

  if (result.itemCounts) {
    for (const [itemName, value] of Object.entries(result.itemCounts)) {
      if (!SAFE_ITEM_NAME_PATTERN.test(itemName)) continue;

      recordGauge("job_run_item_count", value, {
        jobName: result.jobName,
        itemName
      });
    }
  }
}

function buildResult(
  definition: JobDefinition,
  runId: string,
  correlationId: string,
  dryRun: boolean,
  startedAt: Date,
  status: JobStatus,
  extra: Partial<
    Pick<JobResult, "itemCounts" | "detail" | "error" | "retryClassification">
  > = {}
): JobResult {
  const finishedAt = new Date();
  const result: JobResult = {
    jobName: definition.name,
    runId,
    correlationId,
    status,
    startedAt: nowIso(startedAt),
    finishedAt: nowIso(finishedAt),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    dryRun,
    ...extra
  };

  emitJobRunMetrics(result);

  return result;
}

/**
 * Runs `definition.handler` under a per-job-name advisory lock, a timeout,
 * and SIGTERM/SIGINT-aware cancellation, returning structured, already-
 * redacted telemetry (`JobResult`) rather than throwing — `runJob` itself
 * never rejects (a thrown handler error becomes `status: "failed"` with a
 * sanitized `error`), so callers always get a result to log/exit on.
 *
 * Lock release, precisely:
 * - **Success or a thrown handler error** — the handler has, by definition,
 *   already fully stopped running by the time `runJob` observes either
 *   outcome, so the lock is released SYNCHRONOUSLY in the same `finally`
 *   block that returns the result. No gap here at all.
 * - **Timeout or termination signal** — `runJob` returns its
 *   `"timeout"`/`"terminated"` result PROMPTLY (never blocks the caller/cron
 *   tick waiting for the handler), but the lock is deliberately NOT released
 *   in that same moment. PR #713's security review found the earlier
 *   version released the lock immediately here, while `handler` (e.g. a
 *   multi-tenant loop inside `iterateTenantsInBatches`) was often still
 *   actively running in the background on its own connections — letting a
 *   second scheduled tick acquire the now-"free" lock and start a genuinely
 *   overlapping second execution of the SAME job, exactly the failure mode
 *   mutual exclusion exists to prevent. Instead, a detached background
 *   continuation (`scheduleBackgroundLockRelease`, decoupled from this
 *   function's own return) keeps the lock held until EITHER `handler`
 *   actually settles OR `lockReleaseGraceMs` (default
 *   `DEFAULT_LOCK_RELEASE_GRACE_MS`, 30s) elapses, whichever comes first,
 *   then releases it. A handler built on `iterateTenantsInBatches`/
 *   `runBoundedBatches` (which check `ctx.signal` between passes/tenants,
 *   see `batching.ts`) typically stops within about one in-flight
 *   statement's duration of the abort firing — well inside the default
 *   grace window in practice. A handler that never checks the signal at
 *   all is still bounded: the lock is held for at most `lockReleaseGraceMs`
 *   longer than before, not indefinitely (preserving "never block a cron
 *   tick forever" — the CALLER was never blocked either way; only the
 *   lock's OWN release is delayed, in a fire-and-forget task this function
 *   does not await).
 *
 * Cancellation model: `timeoutMs` and the termination signals both call the
 * same `AbortController.abort()` — this only *signals* the handler via
 * `ctx.signal`; it cannot forcibly interrupt a handler that never checks
 * the signal or awaits anything (standard `AbortSignal` cooperative-
 * cancellation limits, not something this runner can work around without a
 * separate OS process per job, which would turn this into the orchestration
 * platform the issue explicitly says not to build). What IS guaranteed
 * regardless of handler cooperation is: (a) `runJob` returns promptly with
 * `status: "timeout"`/`"terminated"` instead of hanging forever, and (b) a
 * SECOND `runJob`/`acquireAdvisoryLock` call for the SAME job name is
 * rejected/skipped for as long as the first handler is genuinely still
 * running (bounded by `lockReleaseGraceMs`), not just until `runJob`'s own
 * promise resolves — see `tests/integration/job-runner.integration.test.ts`
 * for the exact regression scenario this closes.
 */
export async function runJob(
  definition: JobDefinition,
  options: RunJobOptions
): Promise<JobResult> {
  const runId = crypto.randomUUID();
  const correlationId = options.correlationId ?? crypto.randomUUID();
  const dryRun = options.dryRun ?? false;
  const timeoutMs = definition.timeoutMs ?? DEFAULT_JOB_TIMEOUT_MS;
  const graceMs =
    definition.lockReleaseGraceMs ?? DEFAULT_LOCK_RELEASE_GRACE_MS;
  const startedAt = new Date();

  let lockHandle;

  try {
    lockHandle = await acquireAdvisoryLock(options.sql, definition.name);
  } catch (error) {
    return buildResult(
      definition,
      runId,
      correlationId,
      dryRun,
      startedAt,
      "failed",
      {
        error: sanitizeErrorForLog(error),
        retryClassification: classifyError(error),
        detail: "Failed to acquire the job's advisory lock."
      }
    );
  }

  if (!lockHandle) {
    return buildResult(
      definition,
      runId,
      correlationId,
      dryRun,
      startedAt,
      "skipped",
      {
        detail:
          "Another instance of this job already holds the advisory lock; skipped."
      }
    );
  }

  const controller = new AbortController();
  let timedOut = false;
  let terminatedBy: NodeJS.Signals | null = null;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  // Never let this timer alone keep the process alive.
  timer.unref?.();

  const signalNames = options.terminationSignals ?? ["SIGTERM", "SIGINT"];
  const registeredSignalHandlers: Array<[NodeJS.Signals, () => void]> = [];

  for (const signalName of signalNames) {
    const handler = () => {
      terminatedBy = signalName;
      controller.abort();
    };
    process.once(signalName, handler);
    registeredSignalHandlers.push([signalName, handler]);
  }

  // Set to `true` on the timeout/termination path below, once lock release
  // has been handed off to the detached background continuation — the
  // outer `finally` must NOT also release synchronously in that case (the
  // continuation owns the single, idempotent `release()` call instead).
  let releaseScheduledInBackground = false;

  try {
    const abortedPromise = new Promise<"aborted">((resolve) => {
      if (controller.signal.aborted) {
        resolve("aborted");
        return;
      }
      controller.signal.addEventListener("abort", () => resolve("aborted"), {
        once: true
      });
    });

    const handlerPromise = Promise.resolve().then(() =>
      definition.handler({
        runId,
        correlationId,
        dryRun,
        signal: controller.signal
      })
    );
    const settledPromise = handlerPromise.then(
      (value): { kind: "settled"; value: JobHandlerResult | void } => ({
        kind: "settled",
        value
      })
    );

    const race = await Promise.race([settledPromise, abortedPromise]);

    if (race === "aborted") {
      const status: JobStatus = terminatedBy ? "terminated" : "timeout";

      // Do NOT release the lock here — `handler` may still be genuinely
      // running in the background (see this function's doc comment). Hand
      // release off to a detached continuation that waits for `handler` to
      // actually settle, bounded by `graceMs`, WITHOUT making this
      // function's own return wait for it.
      releaseScheduledInBackground = true;
      scheduleBackgroundLockRelease(handlerPromise, lockHandle, graceMs);

      return buildResult(
        definition,
        runId,
        correlationId,
        dryRun,
        startedAt,
        status,
        {
          detail: terminatedBy
            ? `Job terminated by ${terminatedBy}.`
            : `Job exceeded its ${timeoutMs}ms timeout.`
        }
      );
    }

    const handlerResult = race.value ?? {};

    return buildResult(
      definition,
      runId,
      correlationId,
      dryRun,
      startedAt,
      handlerResult.status ?? "success",
      {
        itemCounts: handlerResult.itemCounts,
        detail: handlerResult.detail
      }
    );
  } catch (error) {
    return buildResult(
      definition,
      runId,
      correlationId,
      dryRun,
      startedAt,
      "failed",
      {
        error: sanitizeErrorForLog(error),
        retryClassification: classifyError(error)
      }
    );
  } finally {
    clearTimeout(timer);
    for (const [signalName, handler] of registeredSignalHandlers) {
      process.off(signalName, handler);
    }
    if (!releaseScheduledInBackground) {
      await lockHandle.release();
    }
  }
}

/**
 * PR #713 security review follow-up (Issue #697, security-auditor High
 * finding). Keeps `lockHandle` held until EITHER `handlerPromise` settles
 * (fulfills or rejects — the outcome itself doesn't matter here, `runJob`
 * already captured/returned it, or abandoned it, before this was called)
 * OR `graceMs` elapses, THEN releases — decoupled from (not awaited by)
 * `runJob`'s own return, so the caller/cron tick is never blocked waiting
 * for this. `lockHandle.release()` is idempotent (`./advisory-lock.ts`), so
 * this can never double-release even if something else also called it.
 *
 * The grace timer is `unref()`'d so it can never, by itself, keep an
 * otherwise-idle process alive for the full `graceMs` — if `handler` is
 * genuinely still doing real work (open DB connections, pending I/O), that
 * work's own event-loop references keep the process alive for as long as
 * it actually takes, which is the correct behavior (this bookkeeping timer
 * should never be the ONE thing forcing a longer-than-necessary process
 * lifetime).
 */
function scheduleBackgroundLockRelease(
  handlerPromise: Promise<unknown>,
  lockHandle: AdvisoryLockHandle,
  graceMs: number
): void {
  const handlerSettled = handlerPromise.then(
    () => undefined,
    () => undefined
  );

  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  const graceElapsed = new Promise<void>((resolve) => {
    graceTimer = setTimeout(resolve, graceMs);
    graceTimer.unref?.();
  });

  void Promise.race([handlerSettled, graceElapsed]).finally(() => {
    clearTimeout(graceTimer);
    void lockHandle.release();
  });
}

/** `true` for `"success"`/`"skipped"` — mirrors the exit-code contract every migrated script's `main()` applies via `process.exitCode`. */
export function isJobResultOk(result: JobResult): boolean {
  return result.status === "success" || result.status === "skipped";
}

/**
 * Sets `process.exitCode` per the exit-code contract (0 success/skipped,
 * non-zero for fail/partial/timeout/terminated) — same shape
 * `logScriptFailure` (`src/lib/logging/error-log.ts`, Issue #687) already
 * uses for the failure half; this covers the additional statuses `runJob`
 * introduces.
 */
export function applyJobExitCode(result: JobResult): void {
  if (!isJobResultOk(result)) {
    process.exitCode = 1;
  }
}

/** JSON telemetry to stdout — always, regardless of `--json-output`. */
export function printJobTelemetry(result: JobResult): void {
  console.log(JSON.stringify(result, null, 2));
}

/**
 * A single human-readable operator-facing summary line for `console.log`/
 * `console.error` after `runJob` returns — mirrors the exact shape
 * `logScriptFailure` (`src/lib/logging/error-log.ts`, Issue #687) already
 * prints for failures (`"<label> — <redacted message>"`), WITHOUT
 * re-deriving redaction: `result.error`/`result.detail` here are already
 * sanitized by `runJob` itself (via `sanitizeErrorForLog`), so this only
 * formats already-safe strings, it never touches the original raw error.
 */
export function formatJobOutcomeLine(result: JobResult): string {
  const base = `${result.jobName} (${result.status}, ${result.durationMs}ms)`;

  if (result.error) {
    return `${base} — ${result.error.message}`;
  }
  if (result.detail) {
    return `${base} — ${result.detail}`;
  }
  return base;
}

/** Optional structured output to a file, same `--json-output=<path>` pattern as `scripts/production-preflight.ts` (Issue #684). No-op if `jsonOutputPath` is `null`. */
export async function writeJobTelemetry(
  result: JobResult,
  jsonOutputPath: string | null
): Promise<void> {
  if (!jsonOutputPath) {
    return;
  }
  await Bun.write(jsonOutputPath, JSON.stringify(result, null, 2));
}

export type JobCliOptions = {
  dryRun: boolean;
  jsonOutputPath: string | null;
};

/** Parses the two generic flags every migrated script's CLI accepts — `--dry-run` and `--json-output=<path>` (same flag name/shape as `production-preflight.ts`'s own `parseArgs`). Script-specific flags (e.g. `--retention-days=`) are parsed separately by each script, same as before. */
export function parseJobCliArgs(argv: string[]): JobCliOptions {
  const jsonOutputFlag = argv.find((arg) => arg.startsWith("--json-output="));

  return {
    dryRun: argv.includes("--dry-run"),
    jsonOutputPath: jsonOutputFlag ? jsonOutputFlag.split("=", 2)[1]! : null
  };
}
