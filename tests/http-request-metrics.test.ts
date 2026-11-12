/**
 * Issue #1287 — HTTP count and latency are recorded with bounded labels.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, test } from "bun:test";

import {
  instrumentHttpRequest,
  normalizeMethodLabel,
  normalizeRoutePatternLabel,
  recordHttpRequestMetrics,
  UNMATCHED_ROUTE_PATTERN
} from "../src/lib/observability/http-request-metrics";
import { createInMemoryMetricsPort } from "../src/lib/observability/in-memory-metrics-port";
import {
  resetMetricsPortForTests,
  setMetricsPort
} from "../src/lib/observability/metrics-port";

afterEach(() => {
  resetMetricsPortForTests();
});

function install() {
  const port = createInMemoryMetricsPort();

  setMetricsPort(port);

  return port;
}

type Series<T> = { labels: Record<string, string>; value: T };

/** Parse the in-memory port's `name{k=v,k=v}` series keys back into labels. */
function seriesOf<T>(record: Record<string, T>, name: string): Series<T>[] {
  return Object.entries(record)
    .filter(([key]) => key.startsWith(`${name}{`))
    .map(([key, value]) => {
      const inner = key.slice(name.length + 1, -1);
      const labels: Record<string, string> = {};

      for (const pair of inner.split(",")) {
        const at = pair.indexOf("=");

        labels[pair.slice(0, at)] = pair.slice(at + 1);
      }

      return { labels, value };
    });
}

function counters(port: ReturnType<typeof install>) {
  return seriesOf(port.getSnapshot().counters, "http_requests_total");
}

function histograms(port: ReturnType<typeof install>) {
  return seriesOf(port.getSnapshot().histograms, "http_request_duration_ms");
}

/** Every label value of the two HTTP metrics, flattened, for the bounding assertions. */
function labelValues(port: ReturnType<typeof install>): string[] {
  return [...counters(port), ...histograms(port)].flatMap((entry) =>
    Object.values(entry.labels)
  );
}

describe("instrumentHttpRequest records count and duration", () => {
  test("success, redirect and error responses each get their own status and a duration", async () => {
    const port = install();
    let clock = 0;
    const now = () => (clock += 25);

    for (const status of [200, 307, 404, 503]) {
      await instrumentHttpRequest(
        { method: "get", routePattern: "/blog/[tenantCode]/[slug]" },
        async () => new Response(null, { status }),
        now
      );
    }

    const recorded = counters(port);

    expect(recorded.map((entry) => entry.labels.statusCode).sort()).toEqual([
      "200",
      "307",
      "404",
      "503"
    ]);
    for (const entry of recorded) {
      expect(entry.labels).toEqual({
        method: "GET",
        routePattern: "/blog/[tenantCode]/[slug]",
        statusCode: entry.labels.statusCode ?? ""
      });
      expect(entry.value).toBe(1);
    }

    const histogram = histograms(port).find(
      (entry) => entry.labels.routePattern === "/blog/[tenantCode]/[slug]"
    );

    expect(histogram?.value.count).toBe(4);
    expect(histogram?.value.sum).toBe(100);
  });

  test("a thrown error is recorded as 500 and rethrown unchanged", async () => {
    const port = install();
    const failure = new Error("boom");

    await expect(
      instrumentHttpRequest(
        { method: "POST", routePattern: "/api/v1/things/[id]" },
        async () => {
          throw failure;
        }
      )
    ).rejects.toBe(failure);

    expect(counters(port)[0]?.labels).toEqual({
      method: "POST",
      routePattern: "/api/v1/things/[id]",
      statusCode: "500"
    });
  });

  test("the response returned is the handler's own object", async () => {
    install();
    const response = new Response("x", { status: 201 });

    expect(
      await instrumentHttpRequest(
        { method: "PUT", routePattern: "/a" },
        async () => response
      )
    ).toBe(response);
  });
});

describe("labels stay bounded (no URL, tenant id or user id can enter)", () => {
  const TENANT = "11111111-1111-4111-8111-111111111111";

  test.each([
    `/blog/${TENANT}/hello`,
    "/api/v1/users/1234567890",
    "/blog/acme/hello?utm=1",
    "/blog/acme#frag",
    "/has space",
    "https://example.com/blog/acme",
    "blog/no-leading-slash",
    "",
    undefined,
    null,
    `/${"a".repeat(300)}`
  ])("a non-pattern %p collapses to unmatched", (value) => {
    expect(normalizeRoutePatternLabel(value as string | null | undefined)).toBe(
      UNMATCHED_ROUTE_PATTERN
    );
  });

  test("real Astro patterns pass through unchanged", () => {
    for (const pattern of [
      "/",
      "/api/v1/modules/[moduleKey]/health",
      "/blog/[tenantCode]/[slug]",
      "/admin/[...path]"
    ]) {
      expect(normalizeRoutePatternLabel(pattern)).toBe(pattern);
    }
  });

  test("an unknown method becomes OTHER", () => {
    expect(normalizeMethodLabel("BREW")).toBe("OTHER");
    expect(normalizeMethodLabel("patch")).toBe("PATCH");
  });

  test("after requests with hostile inputs no label value contains an id or a raw path", () => {
    const port = install();

    recordHttpRequestMetrics({
      method: "GET",
      routePattern: `/blog/${TENANT}/post?user=42`,
      status: 200,
      durationMs: 3
    });
    recordHttpRequestMetrics({
      method: "X-CUSTOM",
      routePattern: "/api/v1/accounts/987654321/ledger",
      status: 99999,
      durationMs: 3
    });
    recordHttpRequestMetrics({
      method: "GET",
      routePattern: "/blog/[tenantCode]",
      status: 200,
      durationMs: 3
    });

    const values = labelValues(port);

    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value).not.toContain(TENANT);
      expect(value).not.toContain("987654321");
      expect(value).not.toContain("?");
    }
    expect(new Set(values)).toEqual(
      new Set(["GET", "OTHER", "unmatched", "200", "500", "/blog/[tenantCode]"])
    );
  });

  test("only the declared label keys are ever recorded", () => {
    const port = install();

    recordHttpRequestMetrics({
      method: "GET",
      routePattern: "/x",
      status: 200,
      durationMs: 1
    });

    for (const entry of [...counters(port), ...histograms(port)]) {
      expect(Object.keys(entry.labels)).toEqual(
        expect.arrayContaining(["method", "routePattern"])
      );
      expect(Object.keys(entry.labels).length).toBeLessThanOrEqual(3);
    }
  });
});

describe("zero cost by default and wiring", () => {
  test("with the default no-op port recording never throws and stays cheap", async () => {
    const started = performance.now();

    for (let i = 0; i < 20_000; i += 1) {
      recordHttpRequestMetrics({
        method: "GET",
        routePattern: "/blog/[tenantCode]/[slug]",
        status: 200,
        durationMs: 1
      });
    }

    // Generous ceiling (a no-op call is microseconds): this catches an
    // accidental I/O or serialisation, not scheduling noise.
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  test("middleware.ts routes the whole handler through instrumentHttpRequest", () => {
    const source = readFileSync("src/middleware.ts", "utf8");

    expect(source).toContain("instrumentHttpRequest(");
    expect(source).toContain("context.routePattern");
    expect(source).toMatch(/export const onRequest = defineMiddleware/);
  });
});
