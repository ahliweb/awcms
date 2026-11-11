import type { APIRoute } from "astro";

import { hashSessionToken } from "../../lib/auth/session-token";
import { getDatabaseClient } from "../../lib/database/client";
import { withTenant } from "../../lib/database/tenant-context";
import type { WorkClass } from "../../lib/database/work-class";
import { resolveRequestOrigin } from "../../lib/http/site-origin";
import {
  recordCounter,
  recordGauge,
  recordHistogram
} from "../../lib/observability/metrics-port";
import { resolveClientIp } from "../../lib/security/rate-limit";
import { currentResponsePressure } from "../../lib/server/response-pressure";
import {
  authorizeInTransaction,
  resolveAuthInputs,
  type AuthorizeResult
} from "../identity-access/application/access-guard";
import type { AccessRequest } from "../identity-access/domain/access-control";
import { recordAuditEvent } from "../logging/application/audit-log";
import { fail } from "./api-response";
import {
  declaredAppOrigin,
  isStreamOriginAllowed,
  progressStreamConnections,
  PROGRESS_ENVELOPE_VERSION,
  resolveSseRuntimeLimits,
  runProgressSseLoop,
  SSE_PROGRESS_EVENT,
  SSE_SNAPSHOT_REQUIRED_EVENT,
  type ProgressOutEvent,
  type ProgressTickOutcome,
  type SnapshotRequiredReason,
  type SseConnectionRegistry
} from "./sse-progress";

/**
 * `defineProgressSseRoute` (Issue #1171, ADR-0154) — the sibling of
 * `defineSseTenantRoute` for streams that project durable rows with a cursor.
 *
 * ## The opening, before any byte is streamed
 *
 * ```
 * Origin present and foreign?           -> 403 ORIGIN_REFUSED (no work at all)
 * tenant / bearer missing?              -> 400 / 401
 * resource id malformed?                -> 404 (same as unknown)
 * ONE tenant transaction:
 *   authorizeInTransaction(topic perm)  -> its own 401/403
 *   resolveResource (same scope as REST)-> 404 when not visible: an unknown,
 *                                          cross-tenant and hidden id are one answer
 *   validate Last-Event-ID, first read
 * per-actor / per-tenant / per-instance cap -> 429 + Retry-After, never queued
 * ```
 *
 * The cap is taken only after authentication, so an anonymous caller cannot
 * spend another tenant's quota. Opening with a real HTTP status (rather than a
 * stream that immediately ends) is what makes "opens no stream" literally true
 * for an id the caller may not see.
 *
 * ## Every tick
 *
 * One fresh transaction: the chokepoint again, the resource visibility again
 * (an assignment or business scope removed mid-stream ends it), then the read.
 * A deny writes `authorization-revoked`, records an audit row in that same
 * transaction, and ends the stream. `tx` never leaves the tick.
 *
 * ## No standing in-memory state is authoritative
 *
 * The connection keeps two things between ticks: the cursor it last sent (a
 * database value the client also holds) and the serialized counters it last
 * sent (only to decide whether a frame is worth writing). Losing both — a
 * restart, a reconnect to another instance — costs one full frame, nothing
 * else.
 */

/** What a topic's reads receive; `tx` is the tick's transaction. */
export type ProgressTopicContext = {
  tx: Bun.TransactionSQL;
  tenantId: string;
  auth: Extract<AuthorizeResult, { allowed: true }>;
  tokenHash: string;
  request: Request;
  clientAddress: string | undefined;
  now: Date;
};

export type ProgressChangesPage<TChange> = {
  /** In cursor order; each item's `cursor` is the position just after it. */
  items: { cursor: string; change: TChange }[];
  /** More changes exist past `limit`: the caller sends `snapshot-required`. */
  more: boolean;
};

/**
 * One topic. Every function runs inside an already-authorized tick
 * transaction and must apply the SAME scope filter as the topic's REST
 * snapshot (ADR-0154 R6).
 */
export type ProgressTopic<TResource, TCounts, TChange> = {
  /** Code-defined name, from `realtime-topics.ts`. */
  topic: string;
  /** The module whose audit trail records a revoked stream. */
  moduleKey: string;
  authorize: AccessRequest;
  /** Parses the path id. `null` means "not found", indistinguishable from an unknown id. */
  parseResourceId: (raw: string | undefined) => string | null;
  /** The resource if THIS actor may see it in this tenant, else `null`. */
  resolveResource: (
    context: ProgressTopicContext,
    resourceId: string
  ) => Promise<TResource | null>;
  /** The newest cursor for the resource (a database value). */
  readHead: (
    context: ProgressTopicContext,
    resource: TResource
  ) => Promise<string>;
  /** Whether a client-supplied cursor is well formed, belongs to this resource and still exists. */
  isCursorHonourable: (
    context: ProgressTopicContext,
    resource: TResource,
    cursor: string
  ) => Promise<boolean>;
  readChangesSince: (
    context: ProgressTopicContext,
    resource: TResource,
    cursor: string,
    limit: number
  ) => Promise<ProgressChangesPage<TChange>>;
  readCounts: (
    context: ProgressTopicContext,
    resource: TResource
  ) => Promise<TCounts>;
  /** The commit-time of the newest change a cursor names, in ms, for the lag metric; `null` when it names none. */
  cursorTimestampMs?: (cursor: string) => number | null;
};

export type ProgressSseRouteConfig<TResource, TCounts, TChange> = {
  topic: ProgressTopic<TResource, TCounts, TChange>;
  workClass: WorkClass;
  queueTimeoutMs?: number;
  /** Re-authorization AND read interval; also the revocation latency. Chosen per call site (ADR-0075). */
  tickIntervalMs: number;
  /** Hard ceiling on one connection; it ends with `stream-expired`. */
  maxConnectionMs: number;
  /** Longest silence before a heartbeat comment. Keep it below every proxy idle timeout. */
  heartbeatMs: number;
  /** Change items per frame; more becomes `snapshot-required`. */
  maxChangesPerFrame: number;
  /** Serialized frame ceiling in bytes. */
  maxFrameBytes: number;
  /** `retry:` hint for `EventSource` reconnects. */
  retryMs: number;
  /** Injection seams for tests. */
  connections?: SseConnectionRegistry;
  env?: NodeJS.ProcessEnv;
};

/** The longest a client-supplied `Last-Event-ID` may be before it is not even parsed. */
const MAX_LAST_EVENT_ID_LENGTH = 256;

type FrameState = {
  cursor: string;
  countsKey: string | null;
};

function snapshotRequired(
  topic: string,
  resourceId: string,
  cursor: string,
  reason: SnapshotRequiredReason
): ProgressOutEvent {
  return {
    event: SSE_SNAPSHOT_REQUIRED_EVENT,
    id: cursor,
    data: { v: PROGRESS_ENVELOPE_VERSION, topic, resourceId, cursor, reason }
  };
}

function progressFrame<TCounts, TChange>(
  topic: string,
  resourceId: string,
  cursor: string,
  counts: TCounts,
  changes: TChange[],
  now: Date
): ProgressOutEvent {
  return {
    event: SSE_PROGRESS_EVENT,
    id: cursor,
    data: {
      v: PROGRESS_ENVELOPE_VERSION,
      topic,
      resourceId,
      cursor,
      at: now.toISOString(),
      counts,
      changes
    }
  };
}

/**
 * Builds the events for one read, given the cursor the client holds.
 * `force` writes a frame even when nothing changed (the opening frame).
 * Exported for the DB integration tests, which drive it without HTTP.
 */
export async function readProgressEvents<TResource, TCounts, TChange>(
  topic: ProgressTopic<TResource, TCounts, TChange>,
  context: ProgressTopicContext,
  resource: TResource,
  resourceId: string,
  state: FrameState,
  options: { maxChanges: number; force: boolean; validateCursor: boolean }
): Promise<{ events: ProgressOutEvent[]; state: FrameState }> {
  const name = topic.topic;

  if (
    options.validateCursor &&
    !(await topic.isCursorHonourable(context, resource, state.cursor))
  ) {
    const head = await topic.readHead(context, resource);
    const counts = await topic.readCounts(context, resource);

    return {
      events: [
        snapshotRequired(name, resourceId, head, "cursor_unknown"),
        progressFrame(name, resourceId, head, counts, [], context.now)
      ],
      state: { cursor: head, countsKey: JSON.stringify(counts) }
    };
  }

  const page = await topic.readChangesSince(
    context,
    resource,
    state.cursor,
    options.maxChanges
  );
  const counts = await topic.readCounts(context, resource);
  const countsKey = JSON.stringify(counts);

  if (page.more) {
    const head = await topic.readHead(context, resource);

    return {
      events: [
        snapshotRequired(name, resourceId, head, "too_many_changes"),
        progressFrame(name, resourceId, head, counts, [], context.now)
      ],
      state: { cursor: head, countsKey }
    };
  }

  const cursor = page.items.at(-1)?.cursor ?? state.cursor;

  if (
    !options.force &&
    page.items.length === 0 &&
    countsKey === state.countsKey
  ) {
    return { events: [], state: { cursor, countsKey } };
  }

  return {
    events: [
      progressFrame(
        name,
        resourceId,
        cursor,
        counts,
        page.items.map((item) => item.change),
        context.now
      )
    ],
    state: { cursor, countsKey }
  };
}

/** The opening read for a client with no cursor: current counters at the head. */
export async function readOpeningEvents<TResource, TCounts, TChange>(
  topic: ProgressTopic<TResource, TCounts, TChange>,
  context: ProgressTopicContext,
  resource: TResource,
  resourceId: string,
  lastEventId: string | null,
  maxChanges: number
): Promise<{ events: ProgressOutEvent[]; state: FrameState }> {
  if (lastEventId === null) {
    const head = await topic.readHead(context, resource);
    const counts = await topic.readCounts(context, resource);

    return {
      events: [
        progressFrame(topic.topic, resourceId, head, counts, [], context.now)
      ],
      state: { cursor: head, countsKey: JSON.stringify(counts) }
    };
  }

  return readProgressEvents(
    topic,
    context,
    resource,
    resourceId,
    { cursor: lastEventId, countsKey: null },
    { maxChanges, force: true, validateCursor: true }
  );
}

/**
 * A fresh `Request` identity for one tick, carrying the same URL and headers.
 *
 * NOT cosmetic, and found by the brand-removed-mid-stream test failing: helpers
 * a topic calls (e.g. `channel_accounts`' `scopeCoveredFor`) memoise their
 * decisions and their authorization read cache in a `WeakMap` keyed by
 * `context.request` — correct for a request, which lives milliseconds. A stream
 * keeps ONE `Request` for ten minutes, so the first tick's "this brand is
 * yours" would have been replayed by every later tick, and a business scope
 * removed mid-stream would never have ended it. A per-tick identity makes every
 * tick decide from scratch, which is what ADR-0075 requires.
 */
function perTickRequest(request: Request): Request {
  return new Request(request.url, {
    method: request.method,
    headers: request.headers
  });
}

function refuse(topic: string, reason: string, response: Response): Response {
  recordCounter("realtime_stream_refused_total", { topic, reason });

  return response;
}

export function defineProgressSseRoute<TResource, TCounts, TChange>(
  config: ProgressSseRouteConfig<TResource, TCounts, TChange>
): APIRoute {
  const { topic } = config;
  const connections = config.connections ?? progressStreamConnections;

  return async ({ request, cookies, clientAddress, params, url }) => {
    const env = config.env ?? process.env;

    // 1. Origin, before any work (ADR-0154 section 3).
    const allowedOrigins = [resolveRequestOrigin(url, request, env)];
    const appOrigin = declaredAppOrigin(env);

    if (appOrigin) allowedOrigins.push(appOrigin);

    if (!isStreamOriginAllowed(request.headers.get("origin"), allowedOrigins)) {
      return refuse(
        topic.topic,
        "origin",
        fail(403, "ORIGIN_REFUSED", "Stream origin is not allowed.")
      );
    }

    const { tenantId, token } = resolveAuthInputs(request, cookies);

    if (!tenantId) {
      return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
    }
    if (!token) {
      return fail(401, "AUTH_REQUIRED", "Authentication required.");
    }

    const resourceId = topic.parseResourceId(params.id);

    if (resourceId === null) {
      return refuse(
        topic.topic,
        "not_found",
        fail(404, "NOT_FOUND", "Resource not found.")
      );
    }

    const rawLastEventId = request.headers.get("last-event-id");
    const lastEventId =
      rawLastEventId !== null &&
      rawLastEventId.trim() !== "" &&
      rawLastEventId.length <= MAX_LAST_EVENT_ID_LENGTH
        ? rawLastEventId.trim()
        : rawLastEventId === null || rawLastEventId.trim() === ""
          ? null
          : // Over-long: present but unparseable, which is "unknown cursor".
            "!";

    const sql = getDatabaseClient();
    const tokenHash = hashSessionToken(token);
    const clientIp = resolveClientIp(request, clientAddress);
    const limits = resolveSseRuntimeLimits(env);
    const maxChanges = config.maxChangesPerFrame;

    const openTick = async <T>(
      body: (context: ProgressTopicContext) => Promise<T>
    ): Promise<T | { refused: Response } | Response> => {
      // The 503 `Response` a refusing pool returns is part of the result type
      // and is turned into a refusal by the caller, never dropped.
      const opened = await withTenant<T | { refused: Response }>(
        sql,
        tenantId,
        async (tx) => {
          const now = new Date();
          const auth = await authorizeInTransaction(
            tx,
            tenantId,
            tokenHash,
            now,
            topic.authorize,
            { clientIp }
          );

          if (!auth.allowed) return { refused: auth.denied };

          return body({
            tx,
            tenantId,
            auth,
            tokenHash,
            request,
            clientAddress,
            now
          });
        },
        { workClass: config.workClass, queueTimeoutMs: config.queueTimeoutMs }
      );

      return opened;
    };

    // 2. The opening transaction: decide, resolve the resource, first read.
    type Opening =
      | { kind: "not_found" }
      | {
          kind: "ok";
          actorKey: string;
          events: ProgressOutEvent[];
          state: FrameState;
        };

    let opening: Opening | { refused: Response } | Response;

    try {
      opening = await openTick<Opening>(async (context) => {
        const resource = await topic.resolveResource(context, resourceId);

        if (resource === null) return { kind: "not_found" };

        const first = await readOpeningEvents(
          topic,
          context,
          resource,
          resourceId,
          lastEventId,
          maxChanges
        );

        return {
          kind: "ok",
          actorKey: context.auth.context.tenantUserId,
          ...first
        };
      });
    } catch {
      return refuse(
        topic.topic,
        "unavailable",
        fail(503, "STREAM_UNAVAILABLE", "The stream could not be opened.")
      );
    }

    if (opening instanceof Response) {
      return refuse(topic.topic, "unavailable", opening);
    }
    if ("refused" in opening) {
      return refuse(topic.topic, "auth_denied", opening.refused);
    }
    if (opening.kind === "not_found") {
      return refuse(
        topic.topic,
        "not_found",
        fail(404, "NOT_FOUND", "Resource not found.")
      );
    }

    // 3. Caps, keyed on the AUTHENTICATED actor and tenant.
    const acquired = connections.tryAcquire(
      tenantId,
      opening.actorKey,
      limits.connections
    );

    if (!acquired.ok) {
      return refuse(
        topic.topic,
        `capped_${acquired.refusedBy}`,
        fail(
          429,
          "STREAM_CAPACITY_REACHED",
          "Too many open streams. Use the snapshot or retry later.",
          {},
          { scope: acquired.refusedBy },
          { "retry-after": "30" }
        )
      );
    }

    const lease = acquired.lease;
    const actorKey = opening.actorKey;
    const initialEvents = opening.events;
    let state = opening.state;
    const deadline = Date.now() + config.maxConnectionMs;
    const pressure = currentResponsePressure();

    recordCounter("realtime_stream_opened_total", { topic: topic.topic });
    recordGauge("realtime_stream_open", connections.openCount());

    const tick = async (): Promise<ProgressTickOutcome> => {
      const startedAt = performance.now();

      try {
        const outcome = await withTenant<ProgressTickOutcome>(
          sql,
          tenantId,
          async (tx) => {
            const now = new Date();
            const auth = await authorizeInTransaction(
              tx,
              tenantId,
              tokenHash,
              now,
              topic.authorize,
              { clientIp }
            );
            const context: ProgressTopicContext | null = auth.allowed
              ? {
                  tx,
                  tenantId,
                  auth,
                  tokenHash,
                  request: perTickRequest(request),
                  clientAddress,
                  now
                }
              : null;
            const resource = context
              ? await topic.resolveResource(context, resourceId)
              : null;

            if (!context || resource === null) {
              const status = auth.allowed ? 403 : auth.denied.status;

              // ADR-0154 section 8: a denial by revocation is security-relevant,
              // so it is audited (an ordinary open is not). Same transaction:
              // the audit row and the decision it records commit together.
              await recordAuditEvent(tx, {
                tenantId,
                actorTenantUserId: actorKey,
                moduleKey: topic.moduleKey,
                action: "realtime_stream.revoked",
                resourceType: "realtime_stream",
                resourceId,
                severity: "warning",
                message: "Realtime progress stream ended: access revoked.",
                attributes: { topic: topic.topic, status }
              });

              return { state: "denied", status };
            }

            const next = await readProgressEvents(
              topic,
              context,
              resource,
              resourceId,
              state,
              { maxChanges, force: false, validateCursor: false }
            );

            state = next.state;

            return { state: "ok", events: next.events };
          },
          { workClass: config.workClass, queueTimeoutMs: config.queueTimeoutMs }
        );

        // `withTenant` RETURNS the 503 `Response` when the pool or breaker
        // refuses: load shedding ends the stream, no per-connection retry.
        return outcome instanceof Response ? { state: "error" } : outcome;
      } catch {
        return { state: "error" };
      } finally {
        recordHistogram(
          "realtime_stream_tick_duration_ms",
          performance.now() - startedAt,
          { topic: topic.topic }
        );
      }
    };

    const encoder = new TextEncoder();
    let clientGone = false;
    let wake: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const stopWaiting = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      const resolve = wake;
      wake = null;
      resolve?.();
    };

    const onAbort = () => {
      clientGone = true;
      stopWaiting();
    };

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;

        request.signal.addEventListener("abort", onAbort, { once: true });

        try {
          const result = await runProgressSseLoop({
            initialEvents,
            oversizeReplacement: () =>
              snapshotRequired(
                topic.topic,
                resourceId,
                state.cursor,
                "too_many_changes"
              ),
            tick,
            write: (chunk) => {
              if (closed || clientGone) return;

              try {
                controller.enqueue(encoder.encode(chunk));
              } catch {
                // The consumer cancelled between the check and the write.
                clientGone = true;
                return;
              }

              if (chunk.startsWith("id: ")) {
                recordCounter("realtime_stream_frames_total", {
                  topic: topic.topic,
                  kind: chunk.includes(
                    `\nevent: ${SSE_SNAPSHOT_REQUIRED_EVENT}\n`
                  )
                    ? "snapshot_required"
                    : "progress"
                });

                const cursorMs =
                  topic.cursorTimestampMs?.(state.cursor) ?? null;

                if (cursorMs !== null) {
                  recordHistogram(
                    "realtime_stream_frame_lag_ms",
                    Math.max(0, Date.now() - cursorMs),
                    { topic: topic.topic }
                  );
                }
              }
            },
            waitForNextTick: () =>
              new Promise<void>((resolve) => {
                if (clientGone) {
                  resolve();
                  return;
                }

                wake = resolve;
                timer = setTimeout(stopWaiting, config.tickIntervalMs);
              }),
            finished: () =>
              clientGone || request.signal.aborted
                ? "client"
                : Date.now() >= deadline
                  ? "expired"
                  : null,
            bufferedBytes: () => (pressure ? pressure.bufferedBytes() : null),
            now: () => Date.now(),
            limits: {
              maxFrameBytes: config.maxFrameBytes,
              slowConsumerBytes: limits.slowConsumerBytes,
              slowConsumerGraceMs: limits.slowConsumerGraceMs,
              heartbeatMs: config.heartbeatMs
            },
            retryMs: config.retryMs
          });

          recordCounter("realtime_stream_closed_total", {
            topic: topic.topic,
            reason: result.endedBy
          });
          recordCounter(
            "realtime_stream_frames_total",
            { topic: topic.topic, kind: "heartbeat" },
            result.heartbeatsWritten
          );
          recordCounter(
            "realtime_stream_frames_total",
            { topic: topic.topic, kind: "skipped_pressure" },
            result.framesSkippedForPressure
          );

          if (result.endedBy === "slow_consumer") {
            // Ending politely would keep the unflushed buffer in memory until
            // the socket drains or times out; dropping it releases it now.
            pressure?.destroy();
          }
        } finally {
          stopWaiting();
          request.signal.removeEventListener("abort", onAbort);
          lease.release();
          recordGauge("realtime_stream_open", connections.openCount());

          closed = true;

          // Always closed, including when the client left: a consumer that
          // never cancels (a test, a buffering intermediary) must still see the
          // stream end rather than hold an open body forever.
          try {
            controller.close();
          } catch {
            // Already cancelled by the consumer.
          }
        }
      },
      cancel() {
        // The adapter cancels the reader when the socket closes; wake the loop
        // so it observes `client` now instead of after the next tick.
        onAbort();
      }
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "private, no-store, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      }
    });
  };
}
