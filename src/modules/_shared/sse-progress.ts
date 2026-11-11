/**
 * The progress-stream loop, its envelope, its caps and its Origin rule
 * (Issue #1171, ADR-0154). Pure: no database, no network, no timers of its own.
 *
 * `sse-stream.ts` is the ADR-0075 loop: authorize, read, write, every tick. This
 * file is its sibling for streams that are a PROJECTION OF DURABLE STATE with a
 * cursor, which ADR-0154 adds on top:
 *
 * - every data frame carries `id: <cursor>`, a database value, so
 *   `EventSource` sends it back as `Last-Event-ID` on reconnect;
 * - a cursor the server cannot honour, or a change set too large for one frame,
 *   becomes a `snapshot-required` event, never a guess and never a bigger frame;
 * - a tick with nothing new writes a heartbeat comment instead of a frame
 *   (counters are coalesced to the latest value per tick);
 * - the writer looks at how much the socket has not taken yet, skips frames
 *   while the client is behind, and evicts it with `slow-consumer` if it stays
 *   behind past a grace period;
 * - the connection lifetime ends with `stream-expired`, which tells the client
 *   to reconnect with its cursor (it is the one terminal event that invites a
 *   reconnect).
 *
 * The tick itself (one transaction: authorize, re-check the resource, read) is
 * an injected effect, exactly as in `sse-stream.ts`, so the properties ADR-0154
 * binds #1171 to are provable by calling a function.
 */
import { formatSseEvent, SSE_OPENING_COMMENT } from "./sse-stream";

export {
  SSE_ERROR_EVENT,
  SSE_OPENING_COMMENT,
  SSE_REVOKED_EVENT
} from "./sse-stream";

import { SSE_ERROR_EVENT, SSE_REVOKED_EVENT } from "./sse-stream";

/** Envelope version. Bumped only by a change a v1 client could misread. */
export const PROGRESS_ENVELOPE_VERSION = 1 as const;

export const SSE_PROGRESS_EVENT = "progress";
export const SSE_SNAPSHOT_REQUIRED_EVENT = "snapshot-required";
export const SSE_SLOW_CONSUMER_EVENT = "slow-consumer";
export const SSE_STREAM_EXPIRED_EVENT = "stream-expired";

/** A comment frame: keeps proxies from closing a quiet stream, carries no data. */
export const SSE_HEARTBEAT_COMMENT = ": hb\n\n";

/** Why a stream ended. Also the `reason` label of the close metric: a fixed enum. */
export type StreamCloseReason =
  "revoked" | "expired" | "slow_consumer" | "error" | "client";

/** Why the server asked the client to re-fetch the REST snapshot. */
export type SnapshotRequiredReason = "cursor_unknown" | "too_many_changes";

/**
 * The data frame. Identifiers, counts, enum states and timestamps ONLY
 * (ADR-0154 section 8, R7): never a recipient, a body, a provider response or a
 * secret. `TCounts` and `TChange` are defined by each topic and reviewed there.
 */
export type ProgressEnvelope<TCounts, TChange> = {
  v: typeof PROGRESS_ENVELOPE_VERSION;
  topic: string;
  resourceId: string;
  cursor: string;
  at: string;
  counts: TCounts;
  changes: TChange[];
};

export type SnapshotRequiredEnvelope = {
  v: typeof PROGRESS_ENVELOPE_VERSION;
  topic: string;
  resourceId: string;
  cursor: string;
  reason: SnapshotRequiredReason;
};

/** One event to write: `id` is the cursor the client resumes from. */
export type ProgressOutEvent = {
  event: string;
  id?: string;
  data: unknown;
};

export type ProgressTickOutcome =
  | { state: "ok"; events: ProgressOutEvent[] }
  | { state: "denied"; status: number }
  | { state: "error" };

export type ProgressLoopLimits = {
  /** A serialized frame above this is replaced by `snapshot-required`. */
  maxFrameBytes: number;
  /** Unflushed bytes above which the client counts as behind. */
  slowConsumerBytes: number;
  /** How long a client may stay behind before it is evicted. */
  slowConsumerGraceMs: number;
  /** Longest gap without a byte; a quiet tick past it writes a heartbeat. */
  heartbeatMs: number;
};

export type ProgressLoopEffects = {
  /** Events from the opening read, already authorized; written before the first tick. */
  initialEvents: ProgressOutEvent[];
  /** Fallback event for a frame that is too large (built by the caller, which knows the cursor). */
  oversizeReplacement: () => ProgressOutEvent;
  tick: () => Promise<ProgressTickOutcome>;
  write: (chunk: string) => void;
  /** Resolves after the tick interval, or early when the connection ends. */
  waitForNextTick: () => Promise<void>;
  /** `client` once the client has gone, `expired` at the lifetime ceiling, else `null`. */
  finished: () => "client" | "expired" | null;
  /** Unflushed bytes, or `null` when the transport cannot measure it. */
  bufferedBytes: () => number | null;
  now: () => number;
  limits: ProgressLoopLimits;
  /** Reconnect delay hint for `EventSource` (the SSE `retry:` field). */
  retryMs: number;
};

export type ProgressLoopResult = {
  endedBy: StreamCloseReason;
  framesWritten: number;
  heartbeatsWritten: number;
  framesSkippedForPressure: number;
  /** HTTP-ish status of the denial when `endedBy` is `revoked`. */
  deniedStatus?: number;
};

const encoder = new TextEncoder();

/** One SSE event with an optional `id:` line. The cursor never contains a newline (each topic validates it). */
export function formatSseEventWithId(event: ProgressOutEvent): string {
  const data = JSON.stringify(event.data);

  if (event.id === undefined) return formatSseEvent(event.event, data);

  if (/[\r\n]/.test(event.id)) {
    throw new Error("SSE event id must not contain a line break.");
  }

  return `id: ${event.id}\n${formatSseEvent(event.event, data)}`;
}

/**
 * Runs until the client leaves, the lifetime ends, authorization stops being
 * true, the database refuses, or the client is evicted as a slow consumer.
 * Returns rather than throws; the caller closes the stream the same way for
 * every ending.
 */
export async function runProgressSseLoop(
  effects: ProgressLoopEffects
): Promise<ProgressLoopResult> {
  const { limits } = effects;
  let framesWritten = 0;
  let heartbeatsWritten = 0;
  let framesSkippedForPressure = 0;
  let lastWriteAt = effects.now();
  let behindSince: number | null = null;

  const writeChunk = (chunk: string) => {
    effects.write(chunk);
    lastWriteAt = effects.now();
  };

  const writeEvents = (events: readonly ProgressOutEvent[]) => {
    for (const event of events) {
      let chunk = formatSseEventWithId(event);

      if (encoder.encode(chunk).byteLength > limits.maxFrameBytes) {
        chunk = formatSseEventWithId(effects.oversizeReplacement());
      }

      writeChunk(chunk);
      framesWritten += 1;
    }
  };

  const result = (
    endedBy: StreamCloseReason,
    deniedStatus?: number
  ): ProgressLoopResult => ({
    endedBy,
    framesWritten,
    heartbeatsWritten,
    framesSkippedForPressure,
    ...(deniedStatus === undefined ? {} : { deniedStatus })
  });

  // First byte immediately (ADR-0075 consequence 1): headers are held until it.
  writeChunk(
    `${SSE_OPENING_COMMENT}retry: ${Math.max(0, Math.floor(effects.retryMs))}\n\n`
  );
  writeEvents(effects.initialEvents);

  for (;;) {
    const ended = effects.finished();

    if (ended === "client") return result("client");

    if (ended === "expired") {
      writeChunk(
        formatSseEventWithId({
          event: SSE_STREAM_EXPIRED_EVENT,
          data: { reconnect: true }
        })
      );

      return result("expired");
    }

    await effects.waitForNextTick();

    if (effects.finished() !== null) continue;

    // Backpressure BEFORE the tick: a client that is behind gets no new frame
    // (the next one supersedes it anyway), and the read is skipped so a slow
    // client costs no database work either. Nothing is written while skipped,
    // so skipping a tick cannot leak an unauthorized frame.
    const buffered = effects.bufferedBytes();

    if (buffered !== null && buffered > limits.slowConsumerBytes) {
      behindSince ??= effects.now();

      if (effects.now() - behindSince >= limits.slowConsumerGraceMs) {
        writeChunk(
          formatSseEventWithId({
            event: SSE_SLOW_CONSUMER_EVENT,
            data: { reconnect: true }
          })
        );

        return result("slow_consumer");
      }

      framesSkippedForPressure += 1;
      continue;
    }

    behindSince = null;

    const outcome = await effects.tick();

    if (outcome.state === "denied") {
      // Terminal, named, and the client must not reconnect.
      writeChunk(
        formatSseEventWithId({
          event: SSE_REVOKED_EVENT,
          data: { status: outcome.status }
        })
      );

      return result("revoked", outcome.status);
    }

    if (outcome.state === "error") {
      writeChunk(
        formatSseEventWithId({
          event: SSE_ERROR_EVENT,
          data: { retryable: true }
        })
      );

      return result("error");
    }

    if (outcome.events.length > 0) {
      writeEvents(outcome.events);
    } else if (effects.now() - lastWriteAt >= limits.heartbeatMs) {
      writeChunk(SSE_HEARTBEAT_COMMENT);
      heartbeatsWritten += 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Connection caps (ADR-0154 section 5, R8)
// ---------------------------------------------------------------------------

export type SseConnectionLimits = {
  perActor: number;
  perTenant: number;
  perInstance: number;
};

export type SseCapRefusal = "actor" | "tenant" | "instance";

export type SseConnectionLease = { release: () => void };

export type SseConnectionRegistry = {
  tryAcquire(
    tenantId: string,
    actorKey: string,
    limits: SseConnectionLimits
  ):
    | { ok: true; lease: SseConnectionLease }
    | { ok: false; refusedBy: SseCapRefusal };
  openCount(): number;
};

/**
 * In-process counting, and that is a statement about scope, not durability:
 * these numbers are PER INSTANCE. With N replicas a tenant can hold up to N x
 * `perTenant` streams. Nothing reads them as a fact about another process, and
 * nothing in a frame depends on them. Keys are taken only AFTER authentication,
 * so an unauthenticated caller cannot spend another tenant's quota.
 */
export function createSseConnectionRegistry(): SseConnectionRegistry {
  const perTenant = new Map<string, number>();
  const perActor = new Map<string, number>();
  let total = 0;

  const bump = (map: Map<string, number>, key: string, delta: number) => {
    const next = (map.get(key) ?? 0) + delta;

    if (next <= 0) map.delete(key);
    else map.set(key, next);
  };

  return {
    tryAcquire(tenantId, actorKey, limits) {
      const actor = `${tenantId}:${actorKey}`;

      if (total >= limits.perInstance)
        return { ok: false, refusedBy: "instance" };
      if ((perTenant.get(tenantId) ?? 0) >= limits.perTenant) {
        return { ok: false, refusedBy: "tenant" };
      }
      if ((perActor.get(actor) ?? 0) >= limits.perActor) {
        return { ok: false, refusedBy: "actor" };
      }

      total += 1;
      bump(perTenant, tenantId, 1);
      bump(perActor, actor, 1);

      let released = false;

      return {
        ok: true,
        lease: {
          release: () => {
            // Idempotent: the loop's `finally` and the stream's `cancel` may
            // both reach it, and a double release would hand out a phantom slot.
            if (released) return;
            released = true;
            total -= 1;
            bump(perTenant, tenantId, -1);
            bump(perActor, actor, -1);
          }
        }
      };
    },
    openCount: () => total
  };
}

/** The process-wide registry every progress stream shares. */
export const progressStreamConnections = createSseConnectionRegistry();

/** Defaults, chosen conservatively for one instance (ADR-0154 section 5). */
export const DEFAULT_SSE_CONNECTION_LIMITS: SseConnectionLimits = {
  perActor: 4,
  perTenant: 100,
  perInstance: 500
};

export const DEFAULT_SSE_SLOW_CONSUMER_BYTES = 262_144;
export const DEFAULT_SSE_SLOW_CONSUMER_GRACE_MS = 15_000;

function positiveInt(raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim() ?? "";

  if (!/^[1-9][0-9]{0,8}$/.test(trimmed)) return fallback;

  return Number(trimmed);
}

/**
 * Limits from the environment. An unset or malformed value falls back to the
 * default rather than to "unlimited" (`config:validate` refuses the malformed
 * ones before a deploy; this is the request-path floor).
 */
export function resolveSseRuntimeLimits(env: NodeJS.ProcessEnv = process.env): {
  connections: SseConnectionLimits;
  slowConsumerBytes: number;
  slowConsumerGraceMs: number;
} {
  return {
    connections: {
      perActor: positiveInt(
        env.REALTIME_SSE_MAX_CONNECTIONS_PER_ACTOR,
        DEFAULT_SSE_CONNECTION_LIMITS.perActor
      ),
      perTenant: positiveInt(
        env.REALTIME_SSE_MAX_CONNECTIONS_PER_TENANT,
        DEFAULT_SSE_CONNECTION_LIMITS.perTenant
      ),
      perInstance: positiveInt(
        env.REALTIME_SSE_MAX_CONNECTIONS_PER_INSTANCE,
        DEFAULT_SSE_CONNECTION_LIMITS.perInstance
      )
    },
    slowConsumerBytes: positiveInt(
      env.REALTIME_SSE_SLOW_CONSUMER_BYTES,
      DEFAULT_SSE_SLOW_CONSUMER_BYTES
    ),
    slowConsumerGraceMs: positiveInt(
      env.REALTIME_SSE_SLOW_CONSUMER_GRACE_MS,
      DEFAULT_SSE_SLOW_CONSUMER_GRACE_MS
    )
  };
}

// ---------------------------------------------------------------------------
// Origin (ADR-0154 section 3)
// ---------------------------------------------------------------------------

/**
 * A stream request whose `Origin` is PRESENT and not one of the site's own
 * origins is refused before any work. An absent `Origin` is allowed: a
 * same-origin `EventSource` `GET` need not send one, and the cookie that
 * authenticates it is same-site anyway. `EventSource` is a `GET`, so nothing
 * can change state through it; this is the read-side equivalent of the CSWSH
 * check a WebSocket upgrade would need.
 *
 * `allowedOrigins` is the request's own origin as the site reaches it
 * (`resolveRequestOrigin`) and `APP_URL`'s origin. The literal `null` origin
 * (sandboxed iframe, `file:`) is never allowed.
 */
export function isStreamOriginAllowed(
  originHeader: string | null,
  allowedOrigins: readonly string[]
): boolean {
  if (originHeader === null) return true;

  const origin = originHeader.trim().toLowerCase();

  if (origin === "" || origin === "null") return false;

  return allowedOrigins.some(
    (allowed) => allowed.trim().toLowerCase().replace(/\/+$/, "") === origin
  );
}

/** `APP_URL`'s origin, or `null` when unset/unparseable. */
export function declaredAppOrigin(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const raw = env.APP_URL?.trim();

  if (!raw) return null;

  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}
