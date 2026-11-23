/**
 * Issue #1454 — the per-tenant tag-link candidate cache and the busy-aware
 * public error responses. Pure (no database).
 */
import { beforeEach, describe, expect, test } from "bun:test";

import {
  getCachedTagLinkCandidates,
  invalidateTagLinkCandidates,
  resetTagLinkCandidateCacheForTests,
  resolveTagLinkCandidateCacheTtlMs,
  tagLinkCandidateCacheSizeForTests
} from "../src/modules/blog-content/application/tag-link-candidate-cache";
import {
  readDatabaseBusyRetryAfter,
  serverErrorHtmlResponse,
  serverErrorXmlResponse
} from "../src/lib/html/error-responses";

const row = (name: string) => ({
  id: `id-${name}`,
  name,
  slug: name.toLowerCase(),
  usageCount: 1
});

describe("tag-link candidate cache", () => {
  beforeEach(() => resetTagLinkCandidateCacheForTests());

  test("a second read inside the TTL does not run the loader", async () => {
    let calls = 0;
    const load = async () => (calls++, [row("A")]);

    await getCachedTagLinkCandidates("t1", load, { nowMs: 1000, ttlMs: 60000 });
    await getCachedTagLinkCandidates("t1", load, { nowMs: 2000, ttlMs: 60000 });

    expect(calls).toBe(1);
  });

  test("an expired entry is reloaded", async () => {
    let calls = 0;
    const load = async () => (calls++, [row("A")]);

    await getCachedTagLinkCandidates("t1", load, { nowMs: 0, ttlMs: 1000 });
    await getCachedTagLinkCandidates("t1", load, { nowMs: 1001, ttlMs: 1000 });

    expect(calls).toBe(2);
  });

  test("tenants never share an entry", async () => {
    const a = await getCachedTagLinkCandidates(
      "tenant-a",
      async () => [row("A")],
      {
        ttlMs: 60000
      }
    );
    const b = await getCachedTagLinkCandidates(
      "tenant-b",
      async () => [row("B")],
      {
        ttlMs: 60000
      }
    );

    expect(a[0]!.name).toBe("A");
    expect(b[0]!.name).toBe("B");
  });

  test("concurrent misses share one load (single flight)", async () => {
    let calls = 0;
    const load = async () => {
      calls++;
      await Bun.sleep(5);
      return [row("A")];
    };

    await Promise.all(
      Array.from({ length: 20 }, () =>
        getCachedTagLinkCandidates("t1", load, { ttlMs: 60000 })
      )
    );

    expect(calls).toBe(1);
  });

  test("a failed load is not cached and the next caller retries", async () => {
    let calls = 0;

    await expect(
      getCachedTagLinkCandidates(
        "t1",
        async () => {
          calls++;
          throw new Error("boom");
        },
        { ttlMs: 60000 }
      )
    ).rejects.toThrow("boom");

    await getCachedTagLinkCandidates("t1", async () => (calls++, [row("A")]), {
      ttlMs: 60000
    });

    expect(calls).toBe(2);
  });

  test("invalidation drops the entry, and a fill that began before it is not stored", async () => {
    let calls = 0;
    await getCachedTagLinkCandidates("t1", async () => (calls++, [row("A")]), {
      ttlMs: 60000
    });
    invalidateTagLinkCandidates("t1");
    await getCachedTagLinkCandidates("t1", async () => (calls++, [row("B")]), {
      ttlMs: 60000
    });
    expect(calls).toBe(2);

    resetTagLinkCandidateCacheForTests();
    const slow = getCachedTagLinkCandidates(
      "t2",
      async () => {
        await Bun.sleep(10);
        return [row("OLD")];
      },
      { ttlMs: 60000 }
    );
    invalidateTagLinkCandidates("t2");
    await slow;

    const fresh = await getCachedTagLinkCandidates(
      "t2",
      async () => [row("NEW")],
      {
        ttlMs: 60000
      }
    );
    expect(fresh[0]!.name).toBe("NEW");
  });

  test("TTL 0 disables the cache", async () => {
    let calls = 0;
    const load = async () => (calls++, [row("A")]);

    await getCachedTagLinkCandidates("t1", load, { ttlMs: 0 });
    await getCachedTagLinkCandidates("t1", load, { ttlMs: 0 });

    expect(calls).toBe(2);
    expect(tagLinkCandidateCacheSizeForTests()).toBe(0);
  });

  test("the cache is bounded (LRU)", async () => {
    for (let i = 0; i < 400; i++) {
      await getCachedTagLinkCandidates(`t${i}`, async () => [row("A")], {
        ttlMs: 60000
      });
    }

    expect(tagLinkCandidateCacheSizeForTests()).toBeLessThanOrEqual(256);
  });

  test("TTL resolution falls back on malformed input and clamps", () => {
    expect(resolveTagLinkCandidateCacheTtlMs({})).toBe(60000);
    expect(
      resolveTagLinkCandidateCacheTtlMs({
        BLOG_TAG_LINK_CANDIDATE_CACHE_TTL_SECONDS: "abc"
      })
    ).toBe(60000);
    expect(
      resolveTagLinkCandidateCacheTtlMs({
        BLOG_TAG_LINK_CANDIDATE_CACHE_TTL_SECONDS: "-5"
      })
    ).toBe(60000);
    expect(
      resolveTagLinkCandidateCacheTtlMs({
        BLOG_TAG_LINK_CANDIDATE_CACHE_TTL_SECONDS: "999999"
      })
    ).toBe(3600000);
    expect(
      resolveTagLinkCandidateCacheTtlMs({
        BLOG_TAG_LINK_CANDIDATE_CACHE_TTL_SECONDS: "0"
      })
    ).toBe(0);
  });
});

describe("public error responses under database refusal", () => {
  const busy = Object.assign(new Error("queue full"), {
    code: "DATABASE_BUSY",
    retryAfterSeconds: 2
  });

  test("a DatabaseBusyError-shaped error answers 503 with Retry-After, not 500", async () => {
    const html = serverErrorHtmlResponse(busy);
    const xml = serverErrorXmlResponse(busy);

    expect(html.status).toBe(503);
    expect(html.headers.get("retry-after")).toBe("2");
    expect(html.headers.get("cache-control")).toBe("no-store");
    expect(xml.status).toBe(503);
    expect(xml.headers.get("retry-after")).toBe("2");
    // Fixed generic text; never the error's own message.
    expect(await html.text()).not.toContain("queue full");
  });

  test("any other error, and no error at all, stays a 500", () => {
    expect(serverErrorHtmlResponse(new Error("x")).status).toBe(500);
    expect(serverErrorHtmlResponse().status).toBe(500);
    expect(serverErrorXmlResponse(new Error("x")).status).toBe(500);
    expect(readDatabaseBusyRetryAfter("DATABASE_BUSY")).toBeNull();
  });

  test("a bad retryAfter falls back to 1 and is capped", () => {
    expect(
      readDatabaseBusyRetryAfter(
        Object.assign(new Error("x"), { code: "DATABASE_BUSY" })
      )
    ).toBe(1);
    expect(
      readDatabaseBusyRetryAfter(
        Object.assign(new Error("x"), {
          code: "DATABASE_BUSY",
          retryAfterSeconds: 9999
        })
      )
    ).toBe(300);
  });
});
