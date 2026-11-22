/**
 * The process's wake-up hint plumbing for the realtime progress streams
 * (Issue #1171, ADR-0154 section 2 and 7): one shared hub, and ONE lazily
 * started `LISTEN` connection feeding it.
 *
 * This is an optimisation of freshness across instances, never a requirement:
 * with the listener off, refused, or down, every stream keeps reading
 * PostgreSQL on its own tick and is correct. Nothing here reads or writes a
 * domain table, and a hint carries only a tenant id and a topic name.
 *
 * ## OFF BY DEFAULT
 *
 * A commit that carries a NOTIFY is serialised on PostgreSQL's notification
 * queue (measured: 2 000 to 3 000 commits/s against 5 400 to 13 000 without),
 * so the hint ships disabled on BOTH sides: this process needs
 * `REALTIME_WAKE_HINT_ENABLED=true` and the writers need
 * `awcms.realtime_wake = 'on'` (`sql/418`). Turn both on only after measuring in
 * the target environment (`docs/awcms/realtime-progress-streams.md`).
 *
 * ## When the listener does NOT start
 *
 * - `REALTIME_WAKE_HINT_ENABLED` is not `true`;
 * - `DATABASE_PGBOUNCER=true` and no `REALTIME_LISTEN_DATABASE_URL`: a
 *   session-level `LISTEN` does not survive transaction pooling, so the hint is
 *   not attempted rather than silently broken. Streams poll. The listener has
 *   its own optional direct connection string for exactly this deployment.
 * - the login is SUPERUSER or BYPASSRLS (`wake-listener.ts`): refused for good.
 */
import { readConfiguredUrl, isPgBouncerMode } from "../../lib/database/client";
import { log } from "../../lib/logging/logger";
import {
  recordCounter,
  recordGauge
} from "../../lib/observability/metrics-port";
import { createWakeHub, type WakeHub } from "../../lib/realtime/wake-hub";
import {
  startWakeListener,
  type WakeListenerHandle,
  type WakeListenerState
} from "../../lib/realtime/wake-listener";
import { REALTIME_TOPICS } from "./realtime-topics";

export const realtimeWakeHub: WakeHub = createWakeHub({
  knownTopics: new Set(REALTIME_TOPICS.map((entry) => entry.topic))
});

/** `true` only when the operator switched the hint ON (default OFF). */
export function isWakeHintEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return (env.REALTIME_WAKE_HINT_ENABLED ?? "").trim().toLowerCase() === "true";
}

/**
 * The NOTIFY queue fraction above which an operator is told. PostgreSQL's queue
 * is 8 GB of pages; a FULL queue makes the WRITERS' commits fail, so the alarm
 * is early (audit M2).
 */
export const NOTIFY_QUEUE_WARN_FRACTION = 0.1;
const QUEUE_WARN_EVERY_MS = 60_000;

let listener: WakeListenerHandle | null = null;
let lastQueueWarnAt = 0;

/** Records the queue gauge and, at most once a minute, warns above the threshold. */
export function observeNotifyQueueUsage(
  usage: number,
  now: number = Date.now()
): void {
  recordGauge("realtime_wake_queue_usage", usage);

  if (
    usage >= NOTIFY_QUEUE_WARN_FRACTION &&
    now - lastQueueWarnAt >= QUEUE_WARN_EVERY_MS
  ) {
    lastQueueWarnAt = now;
    log("warning", "realtime.wake.notify_queue_high", {
      moduleKey: "realtime",
      usage,
      threshold: NOTIFY_QUEUE_WARN_FRACTION
    });
  }
}

/**
 * Starts the process's listener once. Safe to call on every stream open: it is
 * a no-op after the first call and never throws (a failure here must not fail
 * a request; the stream polls).
 */
export function ensureRealtimeWakeListener(
  env: Record<string, string | undefined> = process.env
): void {
  if (listener || !isWakeHintEnabled(env)) return;

  // A dedicated direct connection wins (the PgBouncer deployment's way in);
  // otherwise the application role's own string, unless it sits behind a pooler.
  const direct = readConfiguredUrl("REALTIME_LISTEN_DATABASE_URL");

  if (!direct && isPgBouncerMode(env)) return;

  const url = direct ?? readConfiguredUrl("DATABASE_URL");

  if (!url) return;

  try {
    listener = startWakeListener({
      url,
      onPayload: (raw) => {
        recordCounter("realtime_wake_hints_total", {
          result: realtimeWakeHub.dispatch(raw)
        });
      },
      onReconnected: () => realtimeWakeHub.wakeAll(),
      onQueueUsage: (usage) => observeNotifyQueueUsage(usage),
      onStateChange: (state: WakeListenerState, detail?: string) => {
        recordGauge("realtime_wake_listener_up", state === "listening" ? 1 : 0);

        if (state === "listening") return;

        recordCounter("realtime_wake_listener_events_total", { state });
        log(
          state === "refused" ? "error" : "warning",
          "realtime.wake.listener",
          {
            moduleKey: "realtime",
            state,
            ...(detail ? { detail } : {})
          }
        );
      }
    });
  } catch {
    listener = null;
  }
}

/** Test seam: stops and forgets the process listener. */
export async function stopRealtimeWakeListenerForTests(): Promise<void> {
  const current = listener;

  listener = null;
  await current?.stop();
}
