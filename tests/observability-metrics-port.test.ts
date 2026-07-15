import { afterEach, describe, expect, test } from "bun:test";

import {
  getMetricsPort,
  recordCounter,
  recordGauge,
  recordHistogram,
  resetMetricsPortForTests,
  setMetricsPort,
  type MetricsPort
} from "../src/lib/observability/metrics-port";
import { createInMemoryMetricsPort } from "../src/lib/observability/in-memory-metrics-port";

describe("metrics-port no-op default (Issue #698)", () => {
  afterEach(() => {
    resetMetricsPortForTests();
  });

  test("recordCounter/recordHistogram/recordGauge never throw with the default no-op adapter", () => {
    expect(() => {
      recordCounter("http_requests_total", {
        method: "GET",
        routePattern: "/api/v1/health",
        statusCode: "200"
      });
      recordHistogram("http_request_duration_ms", 12.3, {
        method: "GET",
        routePattern: "/api/v1/health"
      });
      recordGauge("db_pool_work_class_active", 1, {
        workClass: "interactive"
      });
    }).not.toThrow();
  });

  test("setMetricsPort(null) restores the no-op adapter", () => {
    const inMemory = createInMemoryMetricsPort();
    setMetricsPort(inMemory);
    expect(getMetricsPort()).toBe(inMemory);

    setMetricsPort(null);
    expect(getMetricsPort()).not.toBe(inMemory);

    // The restored default must still be a fully-functional no-op — never throw.
    expect(() =>
      recordCounter("job_run_total", { jobName: "x", status: "success" })
    ).not.toThrow();
  });
});

describe("metrics-port label filtering (Issue #698 cardinality/privacy guardrail)", () => {
  afterEach(() => {
    resetMetricsPortForTests();
  });

  test("drops any label key not declared in that metric's allowedLabelKeys before it reaches the adapter", () => {
    const inMemory = createInMemoryMetricsPort();
    setMetricsPort(inMemory);

    recordCounter("http_requests_total", {
      method: "GET",
      routePattern: "/api/v1/health",
      statusCode: "200",
      // Not declared for http_requests_total — must never reach the adapter.
      tenantId: "11111111-1111-1111-1111-111111111111",
      rawPath: "/api/v1/tenants/11111111-1111-1111-1111-111111111111"
    } as Record<string, string>);

    const snapshot = inMemory.getSnapshot();
    const keys = Object.keys(snapshot.counters);

    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain("tenantId");
    expect(keys[0]).not.toContain("rawPath");
    expect(keys[0]).toContain("method=GET");
    expect(keys[0]).toContain("routePattern=/api/v1/health");
    expect(keys[0]).toContain("statusCode=200");
  });
});

describe("metrics-port adapter error containment (Issue #698)", () => {
  afterEach(() => {
    resetMetricsPortForTests();
  });

  function throwingPort(): MetricsPort {
    return {
      incrementCounter: () => {
        throw new Error("adapter incrementCounter boom");
      },
      observeHistogram: () => {
        throw new Error("adapter observeHistogram boom");
      },
      setGauge: () => {
        throw new Error("adapter setGauge boom");
      }
    };
  }

  test("a throwing adapter never breaks the caller — errors are swallowed", () => {
    setMetricsPort(throwingPort());

    const originalConsoleError = console.error;
    const capturedErrors: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      capturedErrors.push(args);
    };

    try {
      expect(() =>
        recordCounter("job_run_total", { jobName: "x", status: "success" })
      ).not.toThrow();
      expect(() =>
        recordHistogram("job_run_duration_ms", 5, { jobName: "x" })
      ).not.toThrow();
      expect(() =>
        recordGauge("db_pool_work_class_active", 1, {
          workClass: "interactive"
        })
      ).not.toThrow();
    } finally {
      console.error = originalConsoleError;
    }

    expect(capturedErrors.length).toBe(3);
  });
});
