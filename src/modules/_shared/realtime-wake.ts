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
 * ## When the listener does NOT start
 *
 * - `REALTIME_WAKE_HINT_ENABLED=false` (the operator's switch);
 * - `DATABASE_PGBOUNCER=true`: a session-level `LISTEN` does not survive
 *   transaction pooling, so the hint is not attempted rather than silently
 *   broken. Streams poll.
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

/** `true` unless the operator switched the hint off. */
export function isWakeHintEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return (
    (env.REALTIME_WAKE_HINT_ENABLED ?? "true").trim().toLowerCase() !== "false"
  );
}

let listener: WakeListenerHandle | null = null;

/**
 * Starts the process's listener once. Safe to call on every stream open: it is
 * a no-op after the first call and never throws (a failure here must not fail
 * a request; the stream polls).
 */
export function ensureRealtimeWakeListener(
  env: Record<string, string | undefined> = process.env
): void {
  if (listener || !isWakeHintEnabled(env) || isPgBouncerMode(env)) return;

  const url = readConfiguredUrl("DATABASE_URL");

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
