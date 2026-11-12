/**
 * Issue #1282 (revisit of C14) — the CDN purge, tested against a real local HTTP
 * server for the same reason `edge-cache-purge-client.test.ts` is: assert the
 * method, path, body and auth header as RECEIVED, not as passed to a fake fetch.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  CDN_MAX_TAGS_PER_REQUEST,
  chunkCdnTags,
  purgeCdnForRows,
  sendCdnTagPurge
} from "../src/lib/edge-cache/cdn-client";
import {
  isCdnPurgeEnabled,
  listMissingCdnPurgeSettings,
  loadCdnPurgeConfig,
  type CdnPurgeConfig
} from "../src/lib/edge-cache/cdn-purge-config";
import { loadEdgeCacheConfig } from "../src/lib/edge-cache/config";
import type { CacheDecision } from "../src/lib/edge-cache/cacheability";
import { applyEdgeCacheHeaders } from "../src/lib/edge-cache/response-headers";

type Received = {
  method: string;
  path: string;
  body: unknown;
  authorization: string | null;
  contentType: string | null;
};

let server: ReturnType<typeof Bun.serve>;
let received: Received[] = [];
/** Per-test scripted answers; the last one repeats. */
type Answer = { status: number; body?: unknown; retryAfter?: string };
let answers: Answer[] = [];

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      received.push({
        method: request.method,
        path: new URL(request.url).pathname,
        body: await request.json().catch(() => null),
        authorization: request.headers.get("authorization"),
        contentType: request.headers.get("content-type")
      });

      const answer: Answer = answers[
        Math.min(received.length - 1, answers.length - 1)
      ] ?? { status: 200, body: { success: true } };

      return new Response(JSON.stringify(answer.body ?? { success: true }), {
        status: answer.status,
        headers: answer.retryAfter ? { "retry-after": answer.retryAfter } : {}
      });
    }
  });
});

afterAll(() => {
  server.stop(true);
});

const ZONE = "zone0example0id";
const CRED = "credential-under-test";

function cdnConfig(): CdnPurgeConfig {
  return {
    enabled: true,
    apiBase: `http://127.0.0.1:${server.port}/client/v4`,
    zoneId: ZONE,
    apiToken: CRED
  };
}

const noSleep = async () => {};

function reset(...scripted: Answer[]) {
  received = [];
  answers = scripted.length > 0 ? scripted : [{ status: 200 }];
}

function rows(count: number, keyOf = (i: number) => `t:tenant-${i}:m:blog`) {
  return Array.from({ length: count }, (_, i) => ({
    id: `row-${i}`,
    surrogate_key: keyOf(i)
  }));
}

describe("the flag and the configuration (default off, fail closed)", () => {
  test("off unless the value is exactly on", () => {
    expect(isCdnPurgeEnabled({})).toBe(false);
    expect(isCdnPurgeEnabled({ EDGE_CACHE_CDN_PURGE: "true" })).toBe(false);
    expect(isCdnPurgeEnabled({ EDGE_CACHE_CDN_PURGE: "ON" })).toBe(true);
    expect(loadCdnPurgeConfig({}).enabled).toBe(false);
  });

  test("flag off reports nothing missing even with no credentials", () => {
    expect(listMissingCdnPurgeSettings(loadCdnPurgeConfig({}))).toEqual([]);
  });

  test("flag on lists the missing settings by NAME only", () => {
    const missing = listMissingCdnPurgeSettings(
      loadCdnPurgeConfig({ EDGE_CACHE_CDN_PURGE: "on" })
    );

    expect(missing).toEqual([
      "EDGE_CACHE_CDN_ZONE_ID",
      "EDGE_CACHE_CDN_API_TOKEN"
    ]);
  });

  test("a complete configuration is usable", () => {
    const config = loadCdnPurgeConfig({
      EDGE_CACHE_CDN_PURGE: "on",
      EDGE_CACHE_CDN_ZONE_ID: ZONE,
      EDGE_CACHE_CDN_API_TOKEN: CRED
    });

    expect(listMissingCdnPurgeSettings(config)).toEqual([]);
    expect(config.apiBase).toBe("https://api.cloudflare.com/client/v4");
  });

  test("a zone id that could rewrite the path and a clear-text remote base are refused", () => {
    const config = loadCdnPurgeConfig({
      EDGE_CACHE_CDN_PURGE: "on",
      EDGE_CACHE_CDN_ZONE_ID: "../other",
      EDGE_CACHE_CDN_API_TOKEN: CRED,
      EDGE_CACHE_CDN_API_BASE: "http://cdn.example.com/client/v4"
    });

    expect(listMissingCdnPurgeSettings(config)).toEqual([
      "EDGE_CACHE_CDN_API_BASE",
      "EDGE_CACHE_CDN_ZONE_ID"
    ]);
  });

  test("the main edge-cache config does not carry the CDN token", () => {
    const config = loadEdgeCacheConfig({
      EDGE_CACHE_MODE: "on",
      EDGE_CACHE_CDN_API_TOKEN: CRED
    });

    expect(JSON.stringify(config)).not.toContain(CRED);
  });
});

describe("sendCdnTagPurge on the wire", () => {
  test("sends POST /zones/<zone>/purge_cache with the tags and the bearer credential", async () => {
    reset({ status: 200 });

    const outcome = await sendCdnTagPurge(["t:abc:m:blog", "t:abc:s:feed"], {
      config: cdnConfig(),
      sleep: noSleep
    });

    expect(outcome).toEqual({ ok: true });
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      method: "POST",
      path: `/client/v4/zones/${ZONE}/purge_cache`,
      body: { tags: ["t:abc:m:blog", "t:abc:s:feed"] },
      authorization: `Bearer ${CRED}`,
      contentType: "application/json"
    });
  });

  test("refuses an unsafe tag, an empty list and an oversized list without a request", async () => {
    reset();

    for (const tags of [
      ["has space"],
      ["x".repeat(600)],
      [],
      Array.from({ length: CDN_MAX_TAGS_PER_REQUEST + 1 }, (_, i) => `t:${i}`)
    ]) {
      const outcome = await sendCdnTagPurge(tags, {
        config: cdnConfig(),
        sleep: noSleep
      });

      expect(outcome.ok).toBe(false);
      expect(!outcome.ok && outcome.kind).toBe("rejected");
    }

    expect(received).toHaveLength(0);
  });

  test("without credentials nothing is sent", async () => {
    reset();

    const outcome = await sendCdnTagPurge(["t:a"], {
      config: { ...cdnConfig(), apiToken: null },
      sleep: noSleep
    });

    expect(!outcome.ok && outcome.kind).toBe("auth");
    expect(received).toHaveLength(0);
  });

  test("429 is back-pressure with its Retry-After, and is not retried inline", async () => {
    reset({ status: 429, retryAfter: "30" });

    const outcome = await sendCdnTagPurge(["t:a"], {
      config: cdnConfig(),
      sleep: noSleep
    });

    expect(outcome).toEqual({
      ok: false,
      kind: "rate_limited",
      retryAfterSeconds: 30
    });
    expect(received).toHaveLength(1);
  });

  test("401 and 403 are configuration faults, not retried", async () => {
    for (const status of [401, 403]) {
      reset({ status });

      const outcome = await sendCdnTagPurge(["t:a"], {
        config: cdnConfig(),
        sleep: noSleep
      });

      expect(!outcome.ok && outcome.kind).toBe("auth");
      expect(received).toHaveLength(1);
    }
  });

  test("a transient 5xx is retried with growing backoff and then succeeds", async () => {
    reset({ status: 503 }, { status: 502 }, { status: 200 });
    const waits: number[] = [];

    const outcome = await sendCdnTagPurge(["t:a"], {
      config: cdnConfig(),
      sleep: async (ms) => {
        waits.push(ms);
      }
    });

    expect(outcome).toEqual({ ok: true });
    expect(received).toHaveLength(3);
    expect(waits).toEqual([250, 1000]);
  });

  test("a persistent 5xx ends as transient after the inline attempts", async () => {
    reset({ status: 500 });

    const outcome = await sendCdnTagPurge(["t:a"], {
      config: cdnConfig(),
      sleep: noSleep
    });

    expect(!outcome.ok && outcome.kind).toBe("transient");
    expect(received).toHaveLength(3);
  });

  test("a 200 without success=true is not accepted", async () => {
    reset({ status: 200, body: { success: false } });

    const outcome = await sendCdnTagPurge(["t:a"], {
      config: cdnConfig(),
      sleep: noSleep
    });

    expect(!outcome.ok && outcome.kind).toBe("transient");
  });

  test("another 4xx is rejected and not retried; the detail carries no credential", async () => {
    reset({ status: 400, body: { errors: [{ message: CRED }] } });

    const outcome = await sendCdnTagPurge(["t:a"], {
      config: cdnConfig(),
      sleep: noSleep
    });

    expect(!outcome.ok && outcome.kind).toBe("rejected");
    expect(JSON.stringify(outcome)).not.toContain(CRED);
    expect(received).toHaveLength(1);
  });
});

describe("purgeCdnForRows: no row is ever lost", () => {
  test("chunks tags 100 per request", () => {
    const chunks = chunkCdnTags(rows(250).map((row) => row.surrogate_key));

    expect(chunks.map((chunk) => chunk.length)).toEqual([100, 100, 50]);
  });

  test("a publish row reaches the CDN: one request, every row done", async () => {
    reset({ status: 200 });

    const decisions = await purgeCdnForRows(rows(3), {
      config: cdnConfig(),
      sleep: noSleep
    });

    expect(received).toHaveLength(1);
    expect(received[0]?.body).toEqual({
      tags: ["t:tenant-0:m:blog", "t:tenant-1:m:blog", "t:tenant-2:m:blog"]
    });
    expect(decisions.done).toEqual(["row-0", "row-1", "row-2"]);
    expect(decisions.halt).toBeNull();
  });

  test("duplicate keys are sent once and complete every row that carried them", async () => {
    reset({ status: 200 });

    const decisions = await purgeCdnForRows(
      rows(4, (i) => (i % 2 === 0 ? "t:a:m:blog" : "t:b:m:blog")),
      { config: cdnConfig(), sleep: noSleep }
    );

    expect(received[0]?.body).toEqual({ tags: ["t:a:m:blog", "t:b:m:blog"] });
    expect(decisions.done.sort()).toEqual(["row-0", "row-1", "row-2", "row-3"]);
  });

  test("rate limit mid-run: finished chunks stay done, the rest is RELEASED, nothing lost", async () => {
    reset({ status: 200 }, { status: 429, retryAfter: "10" });

    const input = rows(250);
    const decisions = await purgeCdnForRows(input, {
      config: cdnConfig(),
      sleep: noSleep
    });

    expect(received).toHaveLength(2);
    expect(decisions.halt).toBe("rate_limited");
    expect(decisions.done).toHaveLength(100);
    expect(decisions.release).toHaveLength(150);
    expect(decisions.retry).toHaveLength(0);
    expect(decisions.deadLetter).toHaveLength(0);

    const accounted = [
      ...decisions.done,
      ...decisions.release.map((item) => item.id)
    ].sort();

    expect(accounted).toEqual(input.map((row) => row.id).sort());
  });

  test("a rejected credential releases everything and halts", async () => {
    reset({ status: 403 });

    const decisions = await purgeCdnForRows(rows(5), {
      config: cdnConfig(),
      sleep: noSleep
    });

    expect(decisions.halt).toBe("auth");
    expect(decisions.release).toHaveLength(5);
    expect(decisions.done).toHaveLength(0);
  });

  test("an outage retries the chunk, halts, and releases the untried remainder", async () => {
    reset({ status: 503 });

    const decisions = await purgeCdnForRows(rows(150), {
      config: cdnConfig(),
      sleep: noSleep
    });

    expect(decisions.halt).toBe("unavailable");
    expect(decisions.retry).toHaveLength(100);
    expect(decisions.release).toHaveLength(50);
    expect(received).toHaveLength(3);
  });

  test("a request the CDN rejects dead-letters those rows with the reason", async () => {
    reset({ status: 400 });

    const decisions = await purgeCdnForRows(rows(2), {
      config: cdnConfig(),
      sleep: noSleep
    });

    expect(decisions.deadLetter.map((item) => item.id)).toEqual([
      "row-0",
      "row-1"
    ]);
    expect(decisions.deadLetter[0]?.detail).toContain("400");
    expect(decisions.halt).toBeNull();
  });
});

describe("Cache-Tag emission follows the flag", () => {
  const decision: CacheDecision = {
    cacheable: true,
    ttlSeconds: 60,
    staleWhileRevalidateSeconds: 0,
    sharedMaxAgeSeconds: null,
    surrogateKeys: [
      { kind: "tenant", tenantId: "tenant-a" },
      { kind: "module", tenantId: "tenant-a", moduleKey: "blog_content" }
    ]
  } as unknown as CacheDecision;

  test("absent by default, present and comma-separated when the flag is on", () => {
    const previous = process.env.EDGE_CACHE_CDN_PURGE;

    try {
      delete process.env.EDGE_CACHE_CDN_PURGE;
      const off = applyEdgeCacheHeaders(new Response("x"), decision);

      expect(off.headers.get("Surrogate-Key")).not.toBeNull();
      expect(off.headers.get("Cache-Tag")).toBeNull();

      process.env.EDGE_CACHE_CDN_PURGE = "on";
      const on = applyEdgeCacheHeaders(new Response("x"), decision);

      expect(on.headers.get("Cache-Tag")).toBe(
        "t:tenant-a,t:tenant-a:m:blog_content"
      );
    } finally {
      if (previous === undefined) delete process.env.EDGE_CACHE_CDN_PURGE;
      else process.env.EDGE_CACHE_CDN_PURGE = previous;
    }
  });
});
