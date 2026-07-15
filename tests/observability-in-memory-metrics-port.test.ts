import { describe, expect, test } from "bun:test";

import { createInMemoryMetricsPort } from "../src/lib/observability/in-memory-metrics-port";

describe("createInMemoryMetricsPort (Issue #698)", () => {
  test("accumulates counter increments per distinct label combination", () => {
    const port = createInMemoryMetricsPort();

    port.incrementCounter(
      "job_run_total",
      { jobName: "a", status: "success" },
      1
    );
    port.incrementCounter(
      "job_run_total",
      { jobName: "a", status: "success" },
      1
    );
    port.incrementCounter(
      "job_run_total",
      { jobName: "a", status: "failed" },
      1
    );

    const snapshot = port.getSnapshot();
    const entries = Object.entries(snapshot.counters);

    expect(entries).toHaveLength(2);
    expect(snapshot.counters["job_run_total{jobName=a,status=success}"]).toBe(
      2
    );
    expect(snapshot.counters["job_run_total{jobName=a,status=failed}"]).toBe(1);
  });

  test("label key order does not create separate series", () => {
    const port = createInMemoryMetricsPort();

    port.incrementCounter(
      "job_run_total",
      { jobName: "a", status: "success" },
      1
    );
    port.incrementCounter(
      "job_run_total",
      { status: "success", jobName: "a" },
      1
    );

    expect(Object.keys(port.getSnapshot().counters)).toHaveLength(1);
  });

  test("observeHistogram aggregates count/sum/min/max", () => {
    const port = createInMemoryMetricsPort();

    port.observeHistogram("job_run_duration_ms", 10, { jobName: "a" });
    port.observeHistogram("job_run_duration_ms", 30, { jobName: "a" });
    port.observeHistogram("job_run_duration_ms", 20, { jobName: "a" });

    const snapshot = port.getSnapshot();
    const histogram = snapshot.histograms["job_run_duration_ms{jobName=a}"];

    expect(histogram).toEqual({ count: 3, sum: 60, min: 10, max: 30 });
  });

  test("setGauge overwrites (not accumulates) the current value", () => {
    const port = createInMemoryMetricsPort();

    port.setGauge("db_pool_work_class_active", 3, { workClass: "interactive" });
    port.setGauge("db_pool_work_class_active", 5, { workClass: "interactive" });

    expect(
      port.getSnapshot().gauges[
        "db_pool_work_class_active{workClass=interactive}"
      ]
    ).toBe(5);
  });

  test("reset() clears every series", () => {
    const port = createInMemoryMetricsPort();

    port.incrementCounter(
      "job_run_total",
      { jobName: "a", status: "success" },
      1
    );
    port.setGauge("db_pool_work_class_active", 1, { workClass: "interactive" });
    port.observeHistogram("job_run_duration_ms", 5, { jobName: "a" });

    port.reset();

    const snapshot = port.getSnapshot();
    expect(snapshot.counters).toEqual({});
    expect(snapshot.gauges).toEqual({});
    expect(snapshot.histograms).toEqual({});
  });
});
