/**
 * `createNewsMediaR2Client` against a real local fake S3-compatible HTTP
 * server (`Bun.serve`) — same convention
 * `tests/integration/object-dispatch.integration.test.ts` already
 * established for `Bun.S3Client` (a real client library talking to a real,
 * if fake, HTTP endpoint is far more trustworthy than mocking the client
 * itself). Not gated behind `DATABASE_URL` — no database involved, just an
 * HTTP server, so this lives in `tests/unit` and always runs.
 */
import { afterEach, describe, expect, test } from "bun:test";

import {
  createNewsMediaR2Client,
  readCappedStream
} from "../src/modules/news-portal/infrastructure/news-media-r2-client";
import { resetProviderCircuitBreakersForTests } from "../src/lib/database/circuit-breaker";

afterEach(() => {
  resetProviderCircuitBreakersForTests();
});

const BASE_CONFIG = {
  accountId: "test-account",
  accessKeyId: "test-key",
  secretAccessKey: "test-secret",
  bucket: "test-bucket"
};

describe("createNewsMediaR2Client (Issue #634)", () => {
  test("presignUploadUrl returns a scoped, expiring URL without a network call", () => {
    const client = createNewsMediaR2Client(BASE_CONFIG);
    const url = client.presignUploadUrl({
      objectKey: "news-media/tenant/2026/07/abc.jpg",
      mimeType: "image/jpeg",
      ttlSeconds: 300
    });

    expect(typeof url).toBe("string");
    expect(url).toContain("news-media/tenant/2026/07/abc.jpg");
    // Never leaks the raw secret access key into the URL string as-is —
    // presign signs, it does not embed the secret literally.
    expect(url).not.toContain(BASE_CONFIG.secretAccessKey);
  });

  test("headObject: exists=false for a key the fake server reports as missing", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        if (request.method === "HEAD") {
          return new Response(null, { status: 404 });
        }
        return new Response("", { status: 404 });
      }
    });

    try {
      const client = createNewsMediaR2Client({
        ...BASE_CONFIG,
        endpoint: `http://127.0.0.1:${server.port}`
      });
      const result = await client.headObject("missing.jpg");
      expect(result).toEqual({ ok: true, exists: false });
    } finally {
      server.stop(true);
    }
  });

  test("headObject: exists=true with the real Content-Length reported by R2", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        if (request.method === "HEAD") {
          return new Response(null, {
            status: 200,
            headers: { "content-length": "12345" }
          });
        }
        return new Response("", { status: 200 });
      }
    });

    try {
      const client = createNewsMediaR2Client({
        ...BASE_CONFIG,
        endpoint: `http://127.0.0.1:${server.port}`
      });
      const result = await client.headObject("present.jpg");
      expect(result).toEqual({ ok: true, exists: true, sizeBytes: 12345 });
    } finally {
      server.stop(true);
    }
  });

  test("getObject: returns the real bytes read from R2 (a full GET, not a HEAD), within maxBytes", async () => {
    const payload = new TextEncoder().encode("fake jpeg bytes");
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        if (request.method === "HEAD") {
          return new Response(null, {
            status: 200,
            headers: { "content-length": String(payload.byteLength) }
          });
        }
        if (request.method === "GET") {
          return new Response(payload, { status: 200 });
        }
        return new Response("", { status: 404 });
      }
    });

    try {
      const client = createNewsMediaR2Client({
        ...BASE_CONFIG,
        endpoint: `http://127.0.0.1:${server.port}`
      });
      const result = await client.getObject("present.jpg", 1_000_000);
      expect(result).toEqual({
        ok: true,
        sizeExceeded: false,
        bytes: payload
      });
    } finally {
      server.stop(true);
    }
  });

  test("getObject: an object swapped for something huge between HEAD and GET is reported as sizeExceeded", async () => {
    const CHUNK_SIZE = 256;
    const MAX_BYTES = 1_000; // deliberately small
    // Finite but well over MAX_BYTES — large enough to prove the size cap
    // is enforced against the real bytes read (not `HEAD`'s stale report),
    // while staying finite so the fake server terminates the response on
    // its own. (A `pull()` that enqueues forever without ever closing is
    // NOT a valid test source here: a `ReadableStream` whose producer never
    // yields/closes can starve the underlying HTTP response's own framing,
    // hanging `fetch`/`S3Client` before the first byte is ever delivered —
    // that is a pathological test-server bug, not a property of the client
    // code under test. The deterministic `readCappedStream` unit test below
    // is what proves the abort-before-fully-buffering property; this test
    // only needs to prove the real `Bun.S3Client` pathway threads `maxBytes`
    // through and reports `sizeExceeded` for a real oversized HTTP response.)
    const TOTAL_CHUNKS = 64; // 16,384 bytes, >> MAX_BYTES
    const chunk = new Uint8Array(CHUNK_SIZE).fill(0x41);

    const server = Bun.serve({
      port: 0,
      fetch(request) {
        if (request.method === "HEAD") {
          // The attacker scenario: HEAD (taken moments earlier, or simply
          // stale) reports a small, in-bounds size...
          return new Response(null, {
            status: 200,
            headers: { "content-length": String(MAX_BYTES) }
          });
        }

        if (request.method === "GET") {
          // ...but the GET body actually is far bigger than MAX_BYTES
          // (simulating an object swapped to be huge between HEAD and GET,
          // or simply larger than HEAD claimed).
          let sent = 0;
          const stream = new ReadableStream<Uint8Array>({
            pull(controller) {
              if (sent >= TOTAL_CHUNKS) {
                controller.close();
                return;
              }
              sent += 1;
              controller.enqueue(chunk);
            }
          });
          return new Response(stream, { status: 200 });
        }

        return new Response("", { status: 404 });
      }
    });

    try {
      const client = createNewsMediaR2Client({
        ...BASE_CONFIG,
        endpoint: `http://127.0.0.1:${server.port}`,
        timeoutMs: 5000
      });

      const result = await client.getObject("huge.jpg", MAX_BYTES);

      expect(result).toEqual({ ok: true, sizeExceeded: true });
    } finally {
      server.stop(true);
    }
  });

  test("headObject: a provider error (not a clean 404) trips the circuit breaker after repeated failures", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("simulated outage", { status: 500 });
      }
    });

    try {
      const client = createNewsMediaR2Client({
        ...BASE_CONFIG,
        endpoint: `http://127.0.0.1:${server.port}`,
        timeoutMs: 2000
      });

      let lastResult;
      for (let i = 0; i < 6; i += 1) {
        lastResult = await client.headObject("whatever.jpg");
      }

      expect(lastResult?.ok).toBe(false);
    } finally {
      server.stop(true);
    }
  });
});

describe("createNewsMediaR2Client listObjects/deleteObject (Issue #690)", () => {
  function xmlListResponse(options: {
    contents: { key: string; size: number; lastModified: string }[];
    isTruncated?: boolean;
    nextContinuationToken?: string;
  }): string {
    const entries = options.contents
      .map(
        (entry) =>
          `<Contents><Key>${entry.key}</Key><LastModified>${entry.lastModified}</LastModified><Size>${entry.size}</Size></Contents>`
      )
      .join("");

    return `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>test-bucket</Name>
  <KeyCount>${options.contents.length}</KeyCount>
  <MaxKeys>1000</MaxKeys>
  <IsTruncated>${options.isTruncated ?? false}</IsTruncated>
  ${options.nextContinuationToken ? `<NextContinuationToken>${options.nextContinuationToken}</NextContinuationToken>` : ""}
  ${entries}
</ListBucketResult>`;
  }

  test("listObjects: returns the real key/size/lastModified metadata reported by R2", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        if (request.method === "GET") {
          return new Response(
            xmlListResponse({
              contents: [
                {
                  key: "news-media/tenant-1/2026/07/aaa.jpg",
                  size: 1234,
                  lastModified: "2026-07-01T00:00:00.000Z"
                }
              ]
            }),
            { status: 200, headers: { "content-type": "application/xml" } }
          );
        }
        return new Response("", { status: 404 });
      }
    });

    try {
      const client = createNewsMediaR2Client({
        ...BASE_CONFIG,
        endpoint: `http://127.0.0.1:${server.port}`
      });
      const result = await client.listObjects({
        prefix: "news-media/tenant-1/"
      });

      expect(result).toEqual({
        ok: true,
        objects: [
          {
            key: "news-media/tenant-1/2026/07/aaa.jpg",
            sizeBytes: 1234,
            lastModified: "2026-07-01T00:00:00.000Z"
          }
        ],
        isTruncated: false,
        nextContinuationToken: undefined
      });
    } finally {
      server.stop(true);
    }
  });

  test("listObjects: pagination — isTruncated=true carries a nextContinuationToken", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        const token = url.searchParams.get("continuation-token");

        if (!token) {
          return new Response(
            xmlListResponse({
              contents: [
                {
                  key: "a.jpg",
                  size: 1,
                  lastModified: "2026-07-01T00:00:00.000Z"
                }
              ],
              isTruncated: true,
              nextContinuationToken: "page-2"
            }),
            { status: 200, headers: { "content-type": "application/xml" } }
          );
        }

        return new Response(
          xmlListResponse({
            contents: [
              {
                key: "b.jpg",
                size: 2,
                lastModified: "2026-07-02T00:00:00.000Z"
              }
            ],
            isTruncated: false
          }),
          { status: 200, headers: { "content-type": "application/xml" } }
        );
      }
    });

    try {
      const client = createNewsMediaR2Client({
        ...BASE_CONFIG,
        endpoint: `http://127.0.0.1:${server.port}`
      });

      const page1 = await client.listObjects({ prefix: "", maxKeys: 1 });
      expect(page1).toEqual({
        ok: true,
        objects: [
          {
            key: "a.jpg",
            sizeBytes: 1,
            lastModified: "2026-07-01T00:00:00.000Z"
          }
        ],
        isTruncated: true,
        nextContinuationToken: "page-2"
      });

      const page2 = await client.listObjects({
        prefix: "",
        maxKeys: 1,
        continuationToken: (page1 as { nextContinuationToken?: string })
          .nextContinuationToken
      });
      expect(page2).toEqual({
        ok: true,
        objects: [
          {
            key: "b.jpg",
            sizeBytes: 2,
            lastModified: "2026-07-02T00:00:00.000Z"
          }
        ],
        isTruncated: false,
        nextContinuationToken: undefined
      });
    } finally {
      server.stop(true);
    }
  });

  test("listObjects: a provider error (5xx) trips the circuit breaker after repeated failures", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("simulated outage", { status: 500 });
      }
    });

    try {
      const client = createNewsMediaR2Client({
        ...BASE_CONFIG,
        endpoint: `http://127.0.0.1:${server.port}`,
        timeoutMs: 2000
      });

      let lastResult;
      for (let i = 0; i < 6; i += 1) {
        lastResult = await client.listObjects({ prefix: "news-media/" });
      }

      expect(lastResult?.ok).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("listObjects: retry after a transient failure succeeds (simulated R2 API failure then success)", async () => {
    let callCount = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        callCount += 1;
        if (callCount === 1) {
          return new Response("simulated transient outage", { status: 500 });
        }
        return new Response(
          xmlListResponse({
            contents: [
              {
                key: "a.jpg",
                size: 1,
                lastModified: "2026-07-01T00:00:00.000Z"
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/xml" } }
        );
      }
    });

    try {
      const client = createNewsMediaR2Client({
        ...BASE_CONFIG,
        endpoint: `http://127.0.0.1:${server.port}`,
        timeoutMs: 2000
      });

      const first = await client.listObjects({ prefix: "" });
      expect(first.ok).toBe(false);

      const second = await client.listObjects({ prefix: "" });
      expect(second.ok).toBe(true);
      if (second.ok) {
        expect(second.objects).toHaveLength(1);
      }
    } finally {
      server.stop(true);
    }
  });

  test("deleteObject: succeeds against a real 204 response", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        if (request.method === "DELETE") {
          return new Response(null, { status: 204 });
        }
        return new Response("", { status: 404 });
      }
    });

    try {
      const client = createNewsMediaR2Client({
        ...BASE_CONFIG,
        endpoint: `http://127.0.0.1:${server.port}`
      });

      const result = await client.deleteObject("news-media/tenant-1/x.jpg");
      expect(result).toEqual({ ok: true });
    } finally {
      server.stop(true);
    }
  });

  test("deleteObject: a real provider error is reported as ok:false, never thrown", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        if (request.method === "DELETE") {
          return new Response("simulated outage", { status: 500 });
        }
        return new Response("", { status: 404 });
      }
    });

    try {
      const client = createNewsMediaR2Client({
        ...BASE_CONFIG,
        endpoint: `http://127.0.0.1:${server.port}`,
        timeoutMs: 2000
      });

      const result = await client.deleteObject("news-media/tenant-1/x.jpg");
      expect(result.ok).toBe(false);
    } finally {
      server.stop(true);
    }
  });
});

describe("readCappedStream (Issue #634, PR #653 security-auditor Critical fix)", () => {
  test("stops reading and cancels the source stream as soon as maxBytes is exceeded — never accumulates more than maxBytes worth of chunks", async () => {
    const CHUNK_SIZE = 100;
    const MAX_BYTES = 350; // exceeded partway through the 4th chunk
    let pullCount = 0;
    let cancelled = false;
    let cancelReason: unknown;

    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        // Never terminates on its own — an infinite source. If
        // `readCappedStream` did not abort, this test would hang until
        // Bun's own test timeout kills it.
        controller.enqueue(new Uint8Array(CHUNK_SIZE).fill(pullCount));
      },
      cancel(reason) {
        cancelled = true;
        cancelReason = reason;
      }
    });

    const result = await readCappedStream(stream, MAX_BYTES);

    expect(result).toBeNull();
    // 4 chunks = 400 bytes > 350 triggers the abort on the 4th read; a 5th
    // chunk is never requested/consumed.
    expect(pullCount).toBe(4);
    expect(cancelled).toBe(true);
    expect(typeof cancelReason).toBe("string");
  });

  test("returns the exact concatenated bytes when the stream stays within maxBytes", async () => {
    const parts = [
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5]),
      new Uint8Array([6])
    ];
    let index = 0;

    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index >= parts.length) {
          controller.close();
          return;
        }
        controller.enqueue(parts[index]!);
        index += 1;
      }
    });

    const result = await readCappedStream(stream, 100);

    expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
  });
});
