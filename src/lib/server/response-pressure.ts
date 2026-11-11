/**
 * How many bytes the server has accepted for a response but the socket has not
 * yet taken (Issue #1171, ADR-0154 section 5).
 *
 * ## Why this exists, measured rather than assumed
 *
 * ADR-0154 asks a stream writer to "observe the stream's desired size". Under
 * the production entry that number is useless, and this was measured on Bun
 * 1.4.4 with `@astrojs/node`'s own `writeResponse`, not read from docs:
 *
 * - `writeResponse` (`astro/dist/core/app/node.js`) reads the route's
 *   `ReadableStream` in a tight `await reader.read()` loop and calls
 *   `destination.write()` WITHOUT looking at its return value. The web stream's
 *   `desiredSize` therefore stays at `1` forever, whatever the client does.
 * - With a client that stops reading (a paused socket), the kernel buffers
 *   absorb about 1 MB and then `ServerResponse.writableLength` grows without
 *   bound: 1.2 MB, 2.5 MB, 3.8 MB, 5.1 MB, 6.4 MB over four seconds of 256 KB
 *   frames, `writableNeedDrain` true throughout.
 *
 * So the only honest signal is on the Node-compatible `ServerResponse`, which a
 * route never sees. The production entry (`standalone-entry.ts`) owns that
 * object, so it runs the adapter's handler inside an `AsyncLocalStorage` scope
 * that carries a small probe over it; the route reads the probe from the async
 * context it was called in.
 *
 * ## Why the storage lives on `globalThis`
 *
 * `dist/standalone-entry.mjs` and `dist/server/entry.mjs` are TWO bundles. Each
 * would get its own copy of a module-level `AsyncLocalStorage`, and the route
 * would read an empty one. A `Symbol.for` key is the one name both copies share.
 *
 * ## Where there is no probe
 *
 * `astro dev`, `bun test` and any host that does not run through the standalone
 * entry: `currentResponsePressure()` returns `null` and the caller must treat
 * the buffer as unmeasured (it still bounds what it writes by frame size, tick
 * and connection lifetime). It never answers "zero" for "unknown".
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type ResponsePressureProbe = {
  /** Bytes queued on the response that the socket has not accepted yet. */
  bufferedBytes(): number;
  /**
   * Drop the connection now, releasing what is buffered. Used when a slow
   * consumer is evicted: ending the stream politely would leave the buffer in
   * memory until the socket finally drains or times out.
   */
  destroy(): void;
};

type PressureCapable = {
  readonly writableLength: number;
  destroy(error?: Error): unknown;
};

const STORAGE_KEY = Symbol.for("awcms.server.responsePressure");

type GlobalWithStorage = typeof globalThis & {
  [STORAGE_KEY]?: AsyncLocalStorage<ResponsePressureProbe>;
};

function storage(): AsyncLocalStorage<ResponsePressureProbe> {
  const holder = globalThis as GlobalWithStorage;

  holder[STORAGE_KEY] ??= new AsyncLocalStorage<ResponsePressureProbe>();

  return holder[STORAGE_KEY];
}

export function probeFor(response: PressureCapable): ResponsePressureProbe {
  return {
    bufferedBytes: () => {
      const value = response.writableLength;

      return Number.isFinite(value) && value > 0 ? value : 0;
    },
    destroy: () => {
      response.destroy();
    }
  };
}

/** Runs `fn` (the adapter's handler) with a probe over `response` in scope. */
export function runWithResponsePressure<T>(
  response: PressureCapable,
  fn: () => T
): T {
  return storage().run(probeFor(response), fn);
}

/** The probe for the response being produced in this async context, or `null` when unmeasured. */
export function currentResponsePressure(): ResponsePressureProbe | null {
  return storage().getStore() ?? null;
}
