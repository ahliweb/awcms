/**
 * The SSE tick loop, as a function over injected effects (ADR-0075, Issue
 * #467).
 *
 * Kept separate from `tenant-route.ts`'s factory on purpose. The interesting
 * part of a stream is not "does it open a transaction" — the factory's shape
 * proves that — but **what it does when authorization stops being true**, and
 * that is the one thing a route wrapper cannot be tested for without a
 * database, a session, and thirty seconds of wall clock. Written this way, the
 * property `#467` demanded ("the stream STOPS when the grant is revoked") is
 * provable by calling a function.
 *
 * ## The contract
 *
 * Every tick, in this order:
 *
 *   1. `authorizeAndRead` runs — one fresh transaction, `authorizeInTransaction`
 *      first, snapshot read second, both inside it;
 *   2. on `denied`, a terminal event is written and the loop ENDS;
 *   3. on `ok`, the snapshot is written and the loop waits for the next tick.
 *
 * A deny is never skipped, never retried, and never logged as a transient
 * error. That is the whole point of ADR-0075: an SSE connection holds no
 * standing permission, so the first "no" is final.
 *
 * ## Why a thrown error also ends the stream
 *
 * `withTenantOrThrow` throws when the pool or the circuit breaker refuses.
 * Treating that as "skip this tick and try again" would turn a database outage
 * into an unbounded retry loop, one per open connection, against the thing that
 * is already refusing — and it would leave clients holding a stream that
 * silently stopped updating while still looking connected. So the error is
 * reported as its own terminal event: the client learns the stream ended and
 * why it should not simply reconnect in a tight loop.
 */

/** SSE field prefixes, written out so a stray `data:` in a string cannot be mistaken for one. */
const EVENT_FIELD = "event: ";
const DATA_FIELD = "data: ";

/**
 * Terminal event names. Distinct from each other on purpose: a client that
 * reconnects on network failure must NOT reconnect on `revoked`, or it spends
 * the rest of the session hammering an endpoint that will refuse it.
 */
export const SSE_REVOKED_EVENT = "authorization-revoked";
export const SSE_ERROR_EVENT = "stream-error";

export type SseTickOutcome<TSnapshot> =
  | { state: "ok"; snapshot: TSnapshot }
  | { state: "denied"; status: number }
  | { state: "error" };

export type SseLoopEffects<TSnapshot> = {
  /**
   * ONE fresh transaction: authorize, then read. Returns `denied` rather than
   * throwing so the caller cannot confuse "not allowed" with "database is
   * unavailable" — two outcomes that must end the stream differently.
   */
  authorizeAndRead: () => Promise<SseTickOutcome<TSnapshot>>;
  write: (chunk: string) => void | Promise<void>;
  /** Resolves after the tick interval, or rejects/resolves early on abort. */
  waitForNextTick: () => Promise<void>;
  /** True once the client has gone away or the connection deadline passed. */
  isFinished: () => boolean;
  serialize: (snapshot: TSnapshot) => string;
  eventName: string;
};

export type SseLoopResult = {
  ticksWritten: number;
  endedBy: "revoked" | "error" | "finished";
};

/** One SSE frame. Blank line terminates it; without it the client buffers forever. */
export function formatSseEvent(eventName: string, data: string): string {
  return `${EVENT_FIELD}${eventName}\n${DATA_FIELD}${data}\n\n`;
}

/**
 * The comment frame written before anything else.
 *
 * NOT decoration, and NOT to be tidied away. `writeResponse` in
 * `astro/dist/core/app/node.js` calls `writeHead()` without `flushHeaders()`,
 * and Bun holds the headers until the first `write()`. Measured against a real
 * `Bun.serve`: headers arrived at +3013 ms when the first byte was delayed, and
 * at +1 ms when it was not. Until they arrive, `EventSource.onopen` never fires
 * and the client believes the connection is hanging.
 */
export const SSE_OPENING_COMMENT = ": ok\n\n";

/**
 * Runs the loop until the client leaves, the deadline passes, or authorization
 * stops being true.
 *
 * Returns rather than throws: the caller's job after this is to close the
 * stream, and it is the same job for all three endings.
 */
export async function runSseLoop<TSnapshot>(
  effects: SseLoopEffects<TSnapshot>
): Promise<SseLoopResult> {
  let ticksWritten = 0;

  await effects.write(SSE_OPENING_COMMENT);

  while (!effects.isFinished()) {
    const outcome = await effects.authorizeAndRead();

    if (outcome.state === "denied") {
      // Terminal, and named. The client can tell this apart from a dropped
      // connection and must not reconnect: whatever it held is gone.
      await effects.write(
        formatSseEvent(
          SSE_REVOKED_EVENT,
          JSON.stringify({ status: outcome.status })
        )
      );

      return { ticksWritten, endedBy: "revoked" };
    }

    if (outcome.state === "error") {
      await effects.write(
        formatSseEvent(SSE_ERROR_EVENT, JSON.stringify({ retryable: true }))
      );

      return { ticksWritten, endedBy: "error" };
    }

    await effects.write(
      formatSseEvent(effects.eventName, effects.serialize(outcome.snapshot))
    );
    ticksWritten += 1;

    await effects.waitForNextTick();
  }

  return { ticksWritten, endedBy: "finished" };
}
