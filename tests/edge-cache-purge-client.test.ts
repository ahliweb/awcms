/**
 * ADR-0042 §10 — the purge client, tested against a real HTTP server.
 *
 * ## Why a real server and not an injected `fetchImpl`
 *
 * This file exists because the client shipped with a defect that a mock cannot
 * express. It sent `method: "BAN"`, the conventional Varnish idiom. **Bun does
 * not transmit non-standard HTTP methods**: both `fetch` and `node:http` deliver
 * that request as `GET` (Bun 1.3.14). Every purge fell through the VCL's ban
 * branch to the origin, 404'd, and the queue recorded a rejection — while the
 * code, read on its own, looked exactly right.
 *
 * An injected fake would have asserted `init.method === "BAN"` and passed
 * forever, because it observes the *argument* rather than the wire. So the tests
 * below stand up a `Bun.serve` and assert `request.method` as **received**. That
 * is the only formulation that can fail for the reason this bug failed.
 *
 * The same reasoning applies to the URL: the reserved path has to arrive intact
 * for the VCL to intercept it, and only the server can say whether it did.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { EdgeCacheConfig } from "../src/lib/edge-cache/config";
import {
  PURGE_KEY_HEADER,
  PURGE_PATH,
  PURGE_TOKEN_HEADER,
  sendEdgeCachePurge
} from "../src/lib/edge-cache/varnish-client";

type Received = {
  method: string;
  path: string;
  token: string | null;
  key: string | null;
};

let server: ReturnType<typeof Bun.serve>;
let received: Received[] = [];
/** Status the fake edge answers with; per-test. */
let respondWith = 200;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);

      received.push({
        method: request.method,
        path: url.pathname,
        token: request.headers.get(PURGE_TOKEN_HEADER),
        key: request.headers.get(PURGE_KEY_HEADER)
      });

      return new Response("", { status: respondWith });
    }
  });
});

afterAll(() => {
  server.stop(true);
});

function configFor(endpoint: string): EdgeCacheConfig {
  return {
    mode: "on",
    maxTtlSeconds: 300,
    staleWhileRevalidateSeconds: 600,
    purgeEndpoint: endpoint,
    purgeToken: "test-token",
    purgeBatchSize: 200,
    autoRequestRateThreshold: 5,
    autoLatencyThresholdMs: 250,
    autoWindowSeconds: 60
  };
}

function endpoint(): string {
  return `http://127.0.0.1:${server.port}`;
}

describe("sendEdgeCachePurge on the wire", () => {
  test("the method that ARRIVES is one Bun actually transmits", async () => {
    received = [];
    respondWith = 200;

    const outcome = await sendEdgeCachePurge("t:abc", {
      config: configFor(endpoint())
    });

    expect(outcome).toEqual({ ok: true });
    expect(received).toHaveLength(1);

    // The assertion the old code would have failed. `BAN` would arrive as `GET`.
    expect(received[0]?.method).not.toBe("GET");
    expect(received[0]?.method).toBe("POST");
  });

  test("the reserved path arrives intact so the VCL can intercept it", async () => {
    received = [];
    respondWith = 200;

    await sendEdgeCachePurge("t:abc", { config: configFor(endpoint()) });

    expect(received[0]?.path).toBe(PURGE_PATH);
  });

  test("a trailing slash on the configured endpoint does not double up", async () => {
    received = [];
    respondWith = 200;

    await sendEdgeCachePurge("t:abc", {
      config: configFor(`${endpoint()}/`)
    });

    expect(received[0]?.path).toBe(PURGE_PATH);
  });

  test("token and key travel as headers, key raw and unescaped", async () => {
    received = [];
    respondWith = 200;

    await sendEdgeCachePurge("t:abc:m:blog_content", {
      config: configFor(endpoint())
    });

    expect(received[0]?.token).toBe("test-token");
    // Raw on purpose: the edge assembles the regex, so the app never hands a
    // remote party a compiled pattern.
    expect(received[0]?.key).toBe("t:abc:m:blog_content");
  });

  test("4xx is not retryable, 5xx is", async () => {
    received = [];
    respondWith = 403;

    const rejected = await sendEdgeCachePurge("t:abc", {
      config: configFor(endpoint())
    });

    expect(rejected).toMatchObject({ ok: false, retryable: false });

    respondWith = 503;

    const unavailable = await sendEdgeCachePurge("t:abc", {
      config: configFor(endpoint())
    });

    expect(unavailable).toMatchObject({ ok: false, retryable: true });
  });

  test("an unsafe key is refused before anything is sent", async () => {
    received = [];
    respondWith = 200;

    const outcome = await sendEdgeCachePurge(".*", {
      config: configFor(endpoint())
    });

    expect(outcome).toMatchObject({ ok: false, retryable: false });
    // Nothing on the wire at all: a regex must never reach the edge.
    expect(received).toHaveLength(0);
  });

  test("an unconfigured endpoint fails without retrying", async () => {
    const outcome = await sendEdgeCachePurge("t:abc", {
      config: { ...configFor(endpoint()), purgeEndpoint: null }
    });

    expect(outcome).toMatchObject({ ok: false, retryable: false });
  });
});

describe("the VCL accepts what the client sends", () => {
  test("default.vcl intercepts the reserved POST path", async () => {
    // File-level, for the same reason as the ban-expression gate: the two halves
    // of this protocol live in different languages and nothing else compares
    // them. A client/VCL mismatch is a silent no-op, not an error.
    const vcl = await Bun.file("infra/varnish/default.vcl").text();

    expect(vcl).toContain(PURGE_PATH);
    expect(vcl).toMatch(/req\.method\s*==\s*"POST"/);
    // The operator escape hatch stays.
    expect(vcl).toMatch(/req\.method\s*==\s*"BAN"/);
  });
});
