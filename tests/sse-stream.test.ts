/**
 * The SSE tick loop (Issue #467, ADR-0075).
 *
 * The property #467 asked for — *"a test that proves the stream STOPS when the
 * grant is revoked"* — is the reason `runSseLoop` is a function over injected
 * effects rather than code inside the route factory. Proving it against a real
 * route would need a database, a session, and wall-clock seconds; proving it
 * here needs a fake that answers `denied` on the third call.
 *
 * Pure: no database, no network, no timers.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  formatSseEvent,
  runSseLoop,
  SSE_ERROR_EVENT,
  SSE_OPENING_COMMENT,
  SSE_REVOKED_EVENT,
  type SseTickOutcome
} from "../src/modules/_shared/sse-stream";

type Recorder = { chunks: string[]; write: (chunk: string) => void };

function recorder(): Recorder {
  const chunks: string[] = [];

  return { chunks, write: (chunk) => chunks.push(chunk) };
}

/**
 * A loop whose authorization answers `ok` for `allowedTicks` calls and then
 * whatever `then` says — the shape of a grant revoked mid-connection.
 */
function loopWith(
  allowedTicks: number,
  then: SseTickOutcome<{ n: number }>,
  maxTicks = 10
) {
  const sink = recorder();
  let calls = 0;
  let waits = 0;

  return {
    sink,
    stats: () => ({ calls, waits }),
    run: () =>
      runSseLoop<{ n: number }>({
        authorizeAndRead: async () => {
          calls += 1;

          return calls <= allowedTicks
            ? { state: "ok", snapshot: { n: calls } }
            : then;
        },
        write: sink.write,
        waitForNextTick: async () => {
          waits += 1;
        },
        isFinished: () => waits >= maxTicks,
        serialize: (snapshot) => JSON.stringify(snapshot),
        eventName: "tick"
      })
  };
}

describe("the stream stops when the grant is revoked", () => {
  test("a deny ends the loop and writes a named terminal event", async () => {
    const loop = loopWith(2, { state: "denied", status: 403 });
    const result = await loop.run();

    expect(result.endedBy).toBe("revoked");
    expect(result.ticksWritten).toBe(2);

    const last = loop.sink.chunks.at(-1)!;

    expect(last).toContain(`event: ${SSE_REVOKED_EVENT}`);
    expect(last).toContain('"status":403');
  });

  test("nothing is written after the deny", async () => {
    // The assertion that makes the one above worth having: a loop that wrote
    // the terminal event and then kept going would still report `revoked`.
    const loop = loopWith(2, { state: "denied", status: 403 });

    await loop.run();

    const tickFrames = loop.sink.chunks.filter((chunk) =>
      chunk.startsWith("event: tick")
    );

    expect(tickFrames).toHaveLength(2);
    // Opening comment + 2 snapshots + 1 terminal event, and nothing else.
    expect(loop.sink.chunks).toHaveLength(4);
  });

  test("the deny is not retried — authorization is asked exactly once more", async () => {
    // A loop that treated a deny as transient would keep calling. The count is
    // the proof that the first "no" is final, which is the whole of ADR-0075.
    const loop = loopWith(2, { state: "denied", status: 403 });

    await loop.run();

    expect(loop.stats().calls).toBe(3);
  });

  test("a 401 ends it exactly like a 403 — the status travels, the behaviour does not branch", async () => {
    const loop = loopWith(1, { state: "denied", status: 401 });
    const result = await loop.run();

    expect(result.endedBy).toBe("revoked");
    expect(loop.sink.chunks.at(-1)!).toContain('"status":401');
  });
});

describe("a database refusal is not a revocation", () => {
  test("it ends the stream with a DIFFERENT event name", async () => {
    // Telling a client its authorization was revoked when the database was
    // merely busy is a lie in the direction that gets investigated as a
    // permissions bug — and it also tells a well-behaved client never to
    // reconnect, permanently, over a transient outage.
    const loop = loopWith(1, { state: "error" });
    const result = await loop.run();

    expect(result.endedBy).toBe("error");
    expect(loop.sink.chunks.at(-1)!).toContain(`event: ${SSE_ERROR_EVENT}`);
    expect(loop.sink.chunks.at(-1)!).not.toContain(SSE_REVOKED_EVENT);
  });

  test("the two terminal event names are distinct", () => {
    // A client reconnects on `stream-error` and must NOT on
    // `authorization-revoked`; collapsing them would make one of the two
    // behaviours impossible to express.
    expect(SSE_REVOKED_EVENT).not.toBe(SSE_ERROR_EVENT);
  });
});

describe("the first byte goes out before anything is decided", () => {
  test("the opening comment is written before the first authorization call", async () => {
    const sink = recorder();
    let firstCallSawChunks = -1;

    await runSseLoop<{ n: number }>({
      authorizeAndRead: async () => {
        if (firstCallSawChunks === -1) firstCallSawChunks = sink.chunks.length;

        return { state: "denied", status: 403 };
      },
      write: sink.write,
      waitForNextTick: async () => {},
      isFinished: () => false,
      serialize: () => "{}",
      eventName: "tick"
    });

    // Astro's `writeResponse` calls `writeHead()` without `flushHeaders()`, and
    // Bun holds the headers until the first `write()`. Measured on a real
    // `Bun.serve`: +3013 ms with a delayed first byte, +1 ms without. Until
    // then `EventSource.onopen` never fires and the client sees a hang.
    expect(firstCallSawChunks).toBe(1);
    expect(sink.chunks[0]).toBe(SSE_OPENING_COMMENT);
  });

  test("the opening frame is a comment, so no client parses it as an event", () => {
    expect(SSE_OPENING_COMMENT.startsWith(":")).toBe(true);
    expect(SSE_OPENING_COMMENT.endsWith("\n\n")).toBe(true);
  });
});

describe("frame format", () => {
  test("every frame ends with a blank line", () => {
    // Without it the client buffers the frame forever, which looks exactly like
    // a stream that produced nothing.
    expect(formatSseEvent("x", "{}")).toBe("event: x\ndata: {}\n\n");
  });

  test("the loop stops when the connection is finished, with no terminal event", async () => {
    // An abandoned tab or an expired deadline is not an error and not a
    // revocation; there is nobody to tell.
    const sink = recorder();
    const result = await runSseLoop<{ n: number }>({
      authorizeAndRead: async () => ({ state: "ok", snapshot: { n: 1 } }),
      write: sink.write,
      waitForNextTick: async () => {},
      isFinished: () => true,
      serialize: () => "{}",
      eventName: "tick"
    });

    expect(result.endedBy).toBe("finished");
    expect(result.ticksWritten).toBe(0);
    expect(sink.chunks).toEqual([SSE_OPENING_COMMENT]);
  });
});

describe("the route factory keeps the repo's rules", () => {
  const factory = readFileSync("src/modules/_shared/tenant-route.ts", "utf8");
  const route = readFileSync("src/pages/api/v1/push/stream.ts", "utf8");

  test("the stream route opens no transaction of its own", () => {
    // `api:tenant-route:check` enforces this for every route; asserted here too
    // because a stream is the one shape where somebody would be tempted to
    // reach for `withTenant` directly to keep a connection open.
    expect(route).not.toContain("withTenant");
    expect(route).toContain("defineSseTenantRoute");
  });

  test("the factory authorizes INSIDE each tick's transaction, before reading", () => {
    const tick = factory.slice(
      factory.indexOf("const authorizeAndRead"),
      factory.indexOf("const encoder = new TextEncoder()")
    );

    expect(tick.indexOf("authorizeInTransaction(")).toBeLessThan(
      tick.indexOf("config.read(")
    );
    expect(tick).toContain("withTenant<SseTickOutcome<TSnapshot>>(");
  });

  test("a `withTenant` refusal Response is mapped to `error`, not treated as a snapshot", () => {
    // `withTenant` RETURNS a Response when the pool or circuit breaker refuses
    // rather than throwing, so the `catch` alone would have missed the main
    // refusal path. The compiler caught it; this keeps it caught.
    expect(factory).toContain(
      'outcome instanceof Response ? { state: "error" } : outcome'
    );
  });

  test("the tick interval and the connection ceiling are both required", () => {
    // Neither has a default, on purpose: the interval sets both the cost of not
    // having a standing permission and the staleness of a revocation, and a
    // stream with no ceiling is a connection slot that never returns.
    expect(factory).toContain("tickIntervalMs: number;");
    expect(factory).toContain("maxConnectionMs: number;");
    expect(route).toContain("tickIntervalMs: 5_000");
    expect(route).toContain("maxConnectionMs: 600_000");
  });

  test("the response is uncacheable and unbuffered", () => {
    expect(factory).toContain('"private, no-store, no-transform"');
    expect(factory).toContain('"x-accel-buffering": "no"');
  });
});
