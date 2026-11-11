/**
 * The response-pressure probe over a REAL `node:http` server under Bun, with
 * Astro's own `writeResponse` (Issue #1171, ADR-0154 section 5).
 *
 * Proves, by running rather than reading:
 *
 * 1. the probe reaches a stream started inside the adapter's handler, through a
 *    timer hop (the `AsyncLocalStorage` context survives the async boundary a
 *    tick loop crosses);
 * 2. with a client that stops reading, the web stream's `desiredSize` never
 *    moves (Astro drains it eagerly) while the probe's buffered bytes grow —
 *    which is why the writer reads the probe, not `desiredSize`;
 * 3. a client that disconnects cancels the stream and aborts the request
 *    signal, so the loop's timer and listener are released;
 * 4. `destroy()` drops a slow client's connection.
 *
 * No database. One ephemeral loopback port per test.
 */
import { describe, expect, test } from "bun:test";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { createRequestFromNodeRequest, writeResponse } from "astro/app/node";

import {
  currentResponsePressure,
  runWithResponsePressure,
  type ResponsePressureProbe
} from "../src/lib/server/response-pressure";
import { createRequestListener } from "../src/lib/server/standalone-entry";

type Observed = {
  probe: ResponsePressureProbe | null;
  maxBuffered: number;
  desiredSizes: Set<number | null>;
  cancelled: boolean;
  aborted: boolean;
  timerCleared: boolean;
};

/** A route-like handler: a stream that writes `chunkBytes` every 20 ms from a timer. */
function streamingServer(chunkBytes: number) {
  const observed: Observed = {
    probe: null,
    maxBuffered: 0,
    desiredSizes: new Set(),
    cancelled: false,
    aborted: false,
    timerCleared: false
  };
  const payload = new TextEncoder().encode(
    `data: ${"x".repeat(chunkBytes)}\n\n`
  );

  const adapterHandler = (
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) => {
    const request = createRequestFromNodeRequest(req);
    let timer: ReturnType<typeof setInterval> | undefined;

    request.signal.addEventListener("abort", () => {
      observed.aborted = true;
    });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(": ok\n\n"));
        timer = setInterval(() => {
          // Read inside a timer callback: the async hop a tick loop makes.
          observed.probe = currentResponsePressure();
          observed.maxBuffered = Math.max(
            observed.maxBuffered,
            observed.probe?.bufferedBytes() ?? -1
          );
          observed.desiredSizes.add(controller.desiredSize);

          try {
            controller.enqueue(payload);
          } catch {
            clearInterval(timer);
          }
        }, 20);
      },
      cancel() {
        observed.cancelled = true;
        clearInterval(timer);
        observed.timerCleared = true;
      }
    });

    void writeResponse(
      new Response(stream, {
        headers: { "content-type": "text/event-stream" }
      }),
      res
    );
  };

  // The production listener: security headers + the pressure scope.
  const server = http.createServer(createRequestListener(adapterHandler));

  return { server, observed };
}

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  return (server.address() as AddressInfo).port;
}

async function until(predicate: () => boolean, timeoutMs: number) {
  const started = Date.now();

  while (!predicate() && Date.now() - started < timeoutMs) {
    await Bun.sleep(20);
  }
}

describe("response pressure under Bun node:http + Astro writeResponse", () => {
  test("outside the standalone listener there is no probe (unmeasured, not zero)", () => {
    expect(currentResponsePressure()).toBeNull();
    expect(
      runWithResponsePressure(
        { writableLength: 7, destroy: () => undefined },
        () => currentResponsePressure()?.bufferedBytes()
      )
    ).toBe(7);
  });

  test("a client that stops reading: desiredSize never moves, buffered bytes grow, destroy() drops it", async () => {
    const { server, observed } = streamingServer(256 * 1024);
    const port = await listen(server);
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write("GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
      socket.pause();
    });
    let socketClosed = false;

    socket.on("close", () => {
      socketClosed = true;
    });
    socket.on("error", () => undefined);

    await until(() => observed.maxBuffered > 1_000_000, 8_000);

    expect(observed.probe).not.toBeNull();
    expect(observed.maxBuffered).toBeGreaterThan(1_000_000);
    // The web stream never reports the client is behind.
    expect(
      [...observed.desiredSizes].every((size) => size !== null && size > 0)
    ).toBe(true);

    observed.probe!.destroy();
    // A paused socket does not surface the peer closing until it reads again.
    socket.resume();
    await until(() => observed.cancelled && socketClosed, 3_000);

    expect(observed.cancelled).toBe(true);
    expect(observed.timerCleared).toBe(true);
    expect(socketClosed).toBe(true);

    server.close();
  }, 15_000);

  test("a client that disconnects cancels the stream and aborts the request signal", async () => {
    const { server, observed } = streamingServer(16);
    const port = await listen(server);
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      signal: controller.signal
    });
    const reader = response.body!.getReader();

    await reader.read();
    await Bun.sleep(100);
    // The production listener set the security headers on a stream too.
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    controller.abort();

    await until(() => observed.cancelled && observed.aborted, 3_000);

    expect(observed.cancelled).toBe(true);
    expect(observed.aborted).toBe(true);
    expect(observed.timerCleared).toBe(true);
    // Never measured as behind: a reading client drains as fast as it is fed.
    expect(observed.maxBuffered).toBeLessThan(1_000_000);

    server.close();
  }, 10_000);
});
