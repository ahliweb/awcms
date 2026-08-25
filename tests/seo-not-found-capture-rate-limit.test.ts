/**
 * The public 404-observation write is fronted by a per-IP rate limit (#722).
 *
 * ## What was wrong
 *
 * `recordPublicNotFound` runs after ANY public request that resolved to a tenant
 * and 404'd — unauthenticated, one `INSERT … ON CONFLICT` per request, in its own
 * transaction. Its aggregation key is
 * `(tenant, normalized_path, referrer_domain, locale, domain_host)`, and a caller
 * controls two of those five freely: the path is whatever they request, and
 * `referrer_domain` is the hostname of whatever `Referer` they send, with no
 * allow-list. So `/a1 … /aN` is N rows, each multipliable again by varying
 * `Referer`.
 *
 * Two documents said this was bounded. `not-found-directory.ts` claimed "bounded
 * cardinality", and `module.ts` claimed cardinality is "bounded by distinct 404
 * paths, not by traffic" — which is the stated justification for
 * `partition.eligible: false`. The upsert collapses REPEATS of one key and does
 * nothing about distinct keys, and distinct keys are produced by traffic.
 *
 * `POST /api/v1/analytics/collect` is the same kind of endpoint and has had this
 * exact backstop since it shipped (`visitor-analytics-collect-rate-limit.test.ts`),
 * for a threat its own comment states in terms that transfer word for word. This
 * path had no equivalent.
 *
 * ## How this proves it WITHOUT a database
 *
 * With `DATABASE_URL` unset, `getDatabaseClient()` throws, and
 * `recordPublicNotFound` catches it and logs
 * `seo_distribution.not_found.capture_failed`. That gives a clean differential
 * on one observable:
 *
 * - budget available → the warning IS logged, so the call reached the DB step;
 * - budget exhausted → NO warning, so it returned BEFORE the DB step.
 *
 * A test that only asserted "it does not throw" would pass either way, since the
 * function swallows everything by contract. The log line is what distinguishes
 * "refused early" from "tried and failed".
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { recordPublicNotFound } from "../src/modules/seo-distribution/presentation/redirect-middleware";
import {
  checkRateLimit,
  resetRateLimitForTests
} from "../src/lib/security/rate-limit";

// Must mirror redirect-middleware.ts's DEFAULT config exactly (120 req / 60 s).
// If those defaults change, update this pair — the whole test hinges on the
// pre-fill config matching the one the function will use.
const CAPTURE_LIMIT = { maxAttempts: 120, windowMs: 60_000 };
const CLIENT_IP = "203.0.113.91";
const KEY = `seo-not-found:${CLIENT_IP}`;

const CAPTURE = {
  tenantId: "f1111111-1111-4111-8111-111111111111",
  normalizedPath: "/a-missing-page",
  locale: null,
  domainHost: "example.test"
};

function requestWithReferrer(referrer: string | null): Request {
  return new Request("http://example.test/a-missing-page", {
    headers: referrer ? { referer: referrer } : {}
  });
}

async function captureLogs(run: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args: unknown[]) => void lines.push(args.join(" "));
  console.error = () => {};

  try {
    await run();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  return lines;
}

const failedCaptureLines = (lines: string[]): string[] =>
  lines.filter((line) =>
    line.includes("seo_distribution.not_found.capture_failed")
  );

describe("public 404 observation write is rate-limited per IP (#722)", () => {
  const savedDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    // Unset so `getDatabaseClient()` throws — the marker for "reached the DB
    // step". This test asserts the BOUNDARY, never the write itself.
    delete process.env.DATABASE_URL;
    resetRateLimitForTests();
  });

  afterEach(() => {
    resetRateLimitForTests();
    if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedDatabaseUrl;
  });

  test("within budget it REACHES the database step", async () => {
    const lines = await captureLogs(async () => {
      await recordPublicNotFound(
        requestWithReferrer("https://referrer.example/page"),
        CAPTURE,
        CLIENT_IP
      );
    });

    // The control case. Without it, the assertion below could pass because the
    // function never does anything at all, rather than because the limiter
    // stopped it.
    expect(failedCaptureLines(lines)).toHaveLength(1);
  });

  test("over budget it returns BEFORE the database step, and logs nothing", async () => {
    let guard = 0;
    while (checkRateLimit(KEY, CAPTURE_LIMIT).allowed) {
      guard += 1;
      if (guard > 1000) throw new Error("bucket never tripped");
    }

    const lines = await captureLogs(async () => {
      await recordPublicNotFound(
        requestWithReferrer("https://referrer.example/page"),
        CAPTURE,
        CLIENT_IP
      );
    });

    expect(failedCaptureLines(lines)).toHaveLength(0);
    // And silent, not merely un-attempted: logging per refused write would hand
    // the same flood a second amplifier.
    expect(lines).toHaveLength(0);
  });

  test("a flood cannot be laundered through the Referer header", async () => {
    // The referrer is part of the aggregation key and fully caller-supplied, so
    // varying it is how one path becomes many rows. The limiter is keyed on IP
    // ONLY, so the multiplier buys nothing: same source, same bucket.
    let guard = 0;
    while (checkRateLimit(KEY, CAPTURE_LIMIT).allowed) {
      guard += 1;
      if (guard > 1000) throw new Error("bucket never tripped");
    }

    const lines = await captureLogs(async () => {
      for (let n = 0; n < 5; n += 1) {
        await recordPublicNotFound(
          requestWithReferrer(`https://spoof-${n}.example/`),
          { ...CAPTURE, normalizedPath: `/missing-${n}` },
          CLIENT_IP
        );
      }
    });

    expect(failedCaptureLines(lines)).toHaveLength(0);
  });

  test("the bucket is per IP: another source is unaffected", async () => {
    let guard = 0;
    while (checkRateLimit(KEY, CAPTURE_LIMIT).allowed) {
      guard += 1;
      if (guard > 1000) throw new Error("bucket never tripped");
    }

    const lines = await captureLogs(async () => {
      await recordPublicNotFound(
        requestWithReferrer(null),
        CAPTURE,
        "198.51.100.4"
      );
    });

    // One abusive source must not silence 404 telemetry for every visitor —
    // that would trade a storage bound for a blindfold.
    expect(failedCaptureLines(lines)).toHaveLength(1);
  });

  test("the key carries no tenant, so a 429 cannot answer 'does this tenant exist'", async () => {
    // The beacon's no-oracle contract, kept here. Two DIFFERENT tenants from one
    // IP share one bucket; if the tenant were in the key they would not, and the
    // difference would be observable.
    let guard = 0;
    while (checkRateLimit(KEY, CAPTURE_LIMIT).allowed) {
      guard += 1;
      if (guard > 1000) throw new Error("bucket never tripped");
    }

    const lines = await captureLogs(async () => {
      await recordPublicNotFound(
        requestWithReferrer(null),
        { ...CAPTURE, tenantId: "f2222222-2222-4222-8222-222222222222" },
        CLIENT_IP
      );
    });

    expect(failedCaptureLines(lines)).toHaveLength(0);
  });
});
