/**
 * Route-level test for the public visit-ingest beacon's per-IP rate limit
 * (FIX 1). Drives the ACTUAL `analytics/collect.ts` handler with a fake Astro
 * context and no database: the shared in-process `checkRateLimit` bucket for
 * the beacon's IP is exhausted first, so the handler's own limiter returns 429
 * BEFORE it reaches any DB work — proving the backstop fronts the unauthenticated
 * write. The limiter key is IP-only, so this never depends on tenant existence.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { APIRoute } from "astro";

import { POST as collectPOST } from "../src/pages/api/v1/analytics/collect";
import {
  checkRateLimit,
  resetRateLimitForTests
} from "../src/lib/security/rate-limit";

// Must mirror collect.ts's DEFAULT rate-limit config exactly (120 req / 60 s).
// If those defaults change, update this pair — the whole test hinges on the
// pre-fill config matching the handler's.
const COLLECT_LIMIT = { maxAttempts: 120, windowMs: 60_000 };
const CLIENT_IP = "203.0.113.77";
const KEY = `analytics-collect:${CLIENT_IP}`;

/** Minimal AstroCookies stub — the 429 path only ever reads `.get`. */
function fakeCookies() {
  const store = new Map<string, string>();
  return {
    get(name: string) {
      return store.has(name) ? { value: store.get(name)! } : undefined;
    },
    set(name: string, value: string) {
      store.set(name, value);
    },
    delete(name: string) {
      store.delete(name);
    },
    has(name: string) {
      return store.has(name);
    }
  };
}

async function callCollect(opts: {
  clientAddress: string;
  body: unknown;
}): Promise<Response> {
  const request = new Request("http://localhost/api/v1/analytics/collect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(opts.body)
  });
  return (await (collectPOST as APIRoute)({
    request,
    cookies: fakeCookies(),
    clientAddress: opts.clientAddress,
    locals: { correlationId: "test-corr" }
  } as never)) as Response;
}

describe("public beacon per-IP rate limit (FIX 1)", () => {
  const savedEnabled = process.env.VISITOR_ANALYTICS_ENABLED;

  beforeEach(() => {
    process.env.VISITOR_ANALYTICS_ENABLED = "true";
    resetRateLimitForTests();
  });

  afterEach(() => {
    resetRateLimitForTests();
    if (savedEnabled === undefined)
      delete process.env.VISITOR_ANALYTICS_ENABLED;
    else process.env.VISITOR_ANALYTICS_ENABLED = savedEnabled;
  });

  test("a source over the window gets 429 with Retry-After, before any DB work", async () => {
    // Exhaust the exact per-IP bucket the handler will use so its own
    // checkRateLimit sees the window already over the limit.
    let guard = 0;
    while (checkRateLimit(KEY, COLLECT_LIMIT).allowed) {
      guard += 1;
      if (guard > 1000) throw new Error("bucket never tripped");
    }

    const res = await callCollect({
      clientAddress: CLIENT_IP,
      // A well-formed, trackable public beacon: it passes every free (no-DB)
      // filter and would otherwise reach the tenant lookup + write.
      body: { tenantCode: "any-public-code", path: "/a-public-page" }
    });

    expect(res.status).toBe(429);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe("RATE_LIMITED");
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  test("the limiter only fronts DB-bound writes: a non-public beacon still returns 202 even with a tripped bucket", async () => {
    // Exhaust the CLIENT_IP bucket, then hit the endpoint from the SAME IP with
    // an admin-area path. `determineArea` classifies it non-public, so the
    // handler short-circuits to 202 (fire-and-forget) BEFORE the rate-limit
    // check — proving the limiter guards only the path that reaches the DB, and
    // is not a global kill switch that would 429 requests doing no DB work.
    let guard = 0;
    while (checkRateLimit(KEY, COLLECT_LIMIT).allowed) {
      guard += 1;
      if (guard > 1000) throw new Error("bucket never tripped");
    }

    const res = await callCollect({
      clientAddress: CLIENT_IP,
      body: { tenantCode: "any-public-code", path: "/admin/dashboard" }
    });

    expect(res.status).toBe(202);
  });
});
