/**
 * Object-storage uploader against a REAL S3-protocol round trip (Issue #154,
 * ported from awcms-mini's `tests/object-storage-uploader.test.ts`).
 *
 * `src/modules/sync-storage/infrastructure/object-storage-uploader.ts` is the
 * ONLY place in this codebase that talks to an external object-storage
 * provider, and it is the concrete implementation of ADR-0006's three
 * promises: the provider is optional, it is never called inside a DB
 * transaction, and a wedged/failing provider must degrade rather than take
 * the app down. None of those are checkable by reading the code — they are
 * properties of what `Bun.S3Client` actually does over a socket. So this
 * suite stands up a real HTTP server on loopback, points the real
 * `Bun.S3Client` at it via the `endpoint` seam the module already exposes for
 * exactly this purpose, and asserts on observed behavior: how many requests
 * were made, with what method and path, and what came back.
 *
 * WHY IT LIVES IN `tests/integration/` DESPITE NEEDING NO DATABASE. It is not
 * a unit test: it binds a socket, speaks HTTP, and exercises a third-party
 * client's real timeout/retry behavior. It is deliberately NOT gated on
 * `DATABASE_URL` — there is no database in it, so gating it would only stop it
 * from running in `ci.yml`, where it is perfectly capable of running and
 * where the ADR-0006 path currently has zero coverage.
 *
 * THE BREAKER IS PROCESS-WIDE STATE, and this suite is the only place that
 * trips it on purpose. `resetProviderCircuitBreakersForTests()` runs in BOTH
 * `beforeEach` and `afterEach` so a tripped breaker can never leak into a
 * neighbouring test file (`bun test` shares one process across files) — the
 * same class of cross-file pollution that made CI red while local was green
 * in PR #157.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { resetProviderCircuitBreakersForTests } from "../../src/lib/database/circuit-breaker";
import {
  createNoopObjectUploader,
  createR2ObjectUploader
} from "../../src/modules/sync-storage/infrastructure/object-storage-uploader";

async function sha256Hex(content: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}

describe("createNoopObjectUploader (ADR-0006: provider off must never fail a row)", () => {
  test("succeeds without touching the filesystem or the network, even for a path that does not exist", async () => {
    const uploader = createNoopObjectUploader();

    // A deliberately bogus local path: this is the `requires_upload = false`
    // row, whose bytes are already durable locally. If this implementation
    // ever grew a stat/read, an offline/LAN deployment would start failing
    // rows it is supposed to no-op — hence asserting on a path that would
    // make any file access blow up.
    const result = await uploader({
      objectKey: "does/not/matter",
      localPath: "/path/does/not/exist",
      checksumSha256: "a".repeat(64)
    });

    expect(result).toEqual({ ok: true });
  });
});

describe("createR2ObjectUploader (real PUT over loopback)", () => {
  let tmpDir: string;
  let requestCount = 0;
  let lastRequest: { method: string; pathname: string } | undefined;
  let serverBehavior: "ok" | "fail" | "slow" = "ok";
  let server: ReturnType<typeof Bun.serve>;

  beforeEach(async () => {
    resetProviderCircuitBreakersForTests();
    tmpDir = await mkdtemp(path.join(tmpdir(), "awcms-object-upload-"));
    requestCount = 0;
    lastRequest = undefined;
    serverBehavior = "ok";

    // A stand-in for R2, not a mock of our own code: the module under test
    // still constructs a real `Bun.S3Client` and really signs and sends the
    // request. `mock.module` is deliberately not used anywhere here — it
    // mutates the live module namespace for every test file that runs after
    // this one in the same process.
    server = Bun.serve({
      port: 0,
      async fetch(request) {
        requestCount += 1;
        lastRequest = {
          method: request.method,
          pathname: new URL(request.url).pathname
        };

        if (serverBehavior === "fail") {
          return new Response("boom", { status: 500 });
        }

        if (serverBehavior === "slow") {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }

        return new Response("", { status: 200 });
      }
    });
  });

  afterEach(async () => {
    server.stop(true);
    await rm(tmpDir, { recursive: true, force: true });
    resetProviderCircuitBreakersForTests();
  });

  function makeUploader(timeoutMs = 5000) {
    return createR2ObjectUploader({
      accountId: "test-account",
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      bucket: "test-bucket",
      endpoint: `http://127.0.0.1:${server.port}`,
      timeoutMs
    });
  }

  async function writeFixture(name: string, content: string): Promise<string> {
    const localPath = path.join(tmpDir, name);
    await writeFile(localPath, content);
    return localPath;
  }

  test("uploads a file whose checksum matches, via a real PUT round trip to the right bucket/key", async () => {
    const content = "hello world";
    const localPath = await writeFixture("receipt.pdf", content);

    const result = await makeUploader()({
      objectKey: "receipts/1.pdf",
      localPath,
      checksumSha256: await sha256Hex(content)
    });

    expect(result).toEqual({ ok: true });
    expect(requestCount).toBe(1);
    expect(lastRequest?.method).toBe("PUT");
    expect(lastRequest?.pathname).toBe("/test-bucket/receipts/1.pdf");
  });

  test("checksum mismatch fails WITHOUT ever calling the network (local corruption must not burn an upload attempt)", async () => {
    const localPath = await writeFixture("receipt.pdf", "hello world");

    const result = await makeUploader()({
      objectKey: "receipts/1.pdf",
      localPath,
      // Deliberately not the checksum of the bytes on disk — i.e. the file
      // drifted from what was recorded at enqueue time.
      checksumSha256: "f".repeat(64)
    });

    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/checksum/i);
    // The load-bearing assertion: verification happens BEFORE the PUT.
    expect(requestCount).toBe(0);
  });

  test("a missing local file fails cleanly, also without a network call", async () => {
    const result = await makeUploader()({
      objectKey: "receipts/missing.pdf",
      localPath: path.join(tmpDir, "does-not-exist.pdf"),
      checksumSha256: "a".repeat(64)
    });

    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/not found/i);
    expect(requestCount).toBe(0);
  });

  test("a provider 5xx becomes a failed RESULT, never a thrown exception (one bad row must not crash a dispatch batch)", async () => {
    serverBehavior = "fail";
    const content = "hello world";
    const localPath = await writeFixture("receipt.pdf", content);

    const result = await makeUploader()({
      objectKey: "receipts/1.pdf",
      localPath,
      checksumSha256: await sha256Hex(content)
    });

    expect(result.ok).toBe(false);
    expect(requestCount).toBe(1);
  });

  test("a wedged provider is timed out instead of hanging forever", async () => {
    serverBehavior = "slow"; // 200ms
    const content = "hello world";
    const localPath = await writeFixture("receipt.pdf", content);

    // 20ms budget against a 200ms server: the deadline is crossed by an order
    // of magnitude, so this cannot flake on a slow machine in the direction
    // that matters (a false PASS would need the server to answer in <20ms,
    // which it cannot — it sleeps 200ms unconditionally).
    const result = await makeUploader(20)({
      objectKey: "receipts/1.pdf",
      localPath,
      checksumSha256: await sha256Hex(content)
    });

    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/timed out/i);
  });

  test("the circuit breaker opens after consecutive failures and then short-circuits WITHOUT calling the network", async () => {
    serverBehavior = "fail";
    const content = "hello world";
    const localPath = await writeFixture("receipt.pdf", content);
    const uploader = makeUploader();
    const checksum = await sha256Hex(content);

    const upload = () =>
      uploader({
        objectKey: "receipts/1.pdf",
        localPath,
        checksumSha256: checksum
      });

    // Default threshold is 5 consecutive failures (circuit-breaker.ts).
    for (let i = 0; i < 5; i += 1) {
      const result = await upload();
      expect(result.ok).toBe(false);
    }
    expect(requestCount).toBe(5);

    const sixth = await upload();

    expect(sixth.ok).toBe(false);
    expect((sixth as { error: string }).error).toMatch(/circuit breaker/i);
    // The whole point of a breaker: request 6 never reached the socket. If
    // this stayed 6, the breaker would be reporting an opinion nobody acts on.
    expect(requestCount).toBe(5);
  });

  test("a failure does NOT trip the breaker for an unrelated provider family (blast radius is one provider, not all of them)", async () => {
    serverBehavior = "fail";
    const content = "hello world";
    const localPath = await writeFixture("receipt.pdf", content);
    const uploader = makeUploader();

    for (let i = 0; i < 5; i += 1) {
      await uploader({
        objectKey: "receipts/1.pdf",
        localPath,
        checksumSha256: await sha256Hex(content)
      });
    }

    // The object-storage breaker is now open (proved by the test above). The
    // noop uploader shares the same process but not the same provider key, and
    // must be entirely unaffected.
    expect(
      await createNoopObjectUploader()({
        objectKey: "unrelated",
        localPath: "/nope",
        checksumSha256: "a".repeat(64)
      })
    ).toEqual({ ok: true });
  });
});
