import { describe, expect, test } from "bun:test";

import {
  evaluateSaturation,
  mergeResults,
  DEFAULT_LIMITS,
  type GeneratorResult,
  type Saturation
} from "../loadtest/lib/merge";
import { assertLoopback, tenantCodeFor } from "../loadtest/ephemeral/seed";

function gen(
  id: string,
  overrides: Partial<{
    reqs: number;
    p95: number;
    err: number;
    ok: number;
    dropped: number;
    iterations: number;
    thresholdOk: boolean;
  }> = {}
): GeneratorResult {
  const o = {
    reqs: 1000,
    p95: 200,
    err: 0,
    ok: 1000,
    dropped: 0,
    iterations: 1000,
    thresholdOk: true,
    ...overrides
  };
  return {
    runId: "run-1234",
    generatorId: id,
    totalGenerators: 3,
    scenario: "public-page",
    profile: "baseline",
    targetRpsAggregate: 300,
    summary: {
      state: { testRunDurationMs: 10_000 },
      metrics: {
        http_reqs: { values: { count: o.reqs } },
        iterations: { values: { count: o.iterations } },
        dropped_iterations: { values: { count: o.dropped } },
        http_req_duration: {
          values: {
            med: 50,
            "p(90)": 150,
            "p(95)": o.p95,
            "p(99)": 400,
            max: 900
          },
          thresholds: { "p(95)<500": { ok: o.thresholdOk } }
        },
        awcms_server_error_rate: { values: { passes: o.err, fails: o.ok } }
      }
    }
  };
}

const sat = (
  id: string,
  cpu = 30,
  net = 100,
  link: number | null = 1000
): Saturation => ({
  generatorId: id,
  host: "h",
  samples: 10,
  cpuAvgPct: cpu / 2,
  cpuPeakPct: cpu,
  netPeakMbps: net,
  linkMbps: link
});

describe("mergeResults", () => {
  const three = [gen("g1"), gen("g2"), gen("g3")];

  test("aggregates three generators and accepts an unsaturated run", () => {
    const r = mergeResults(three, [sat("g1"), sat("g2"), sat("g3")], 3);
    expect(r.requests).toBe(3000);
    expect(r.meanRps).toBe(300);
    expect(r.accepted).toBe(true);
    expect(r.latencyMs["p(95)"]?.worstGenerator).toBe(200);
  });

  test("worst generator drives the percentile, weighted mean is separate", () => {
    const r = mergeResults(
      [
        gen("g1", { p95: 100 }),
        gen("g2", { p95: 300 }),
        gen("g3", { p95: 200 })
      ],
      [sat("g1"), sat("g2"), sat("g3")],
      3
    );
    expect(r.latencyMs["p(95)"]?.worstGenerator).toBe(300);
    expect(r.latencyMs["p(95)"]?.weightedMean).toBeCloseTo(200, 5);
  });

  test("a saturated generator makes the result not accepted", () => {
    const r = mergeResults(three, [sat("g1", 95), sat("g2"), sat("g3")], 3);
    expect(r.saturation.ok).toBe(false);
    expect(r.accepted).toBe(false);
  });

  test("unknown NIC speed is never treated as safe", () => {
    const v = evaluateSaturation(sat("g1", 10, 10, null), 0, DEFAULT_LIMITS);
    expect(v.ok).toBe(false);
  });

  test("dropped iterations mean the client could not keep the rate", () => {
    const r = mergeResults(
      [gen("g1", { dropped: 500 }), gen("g2"), gen("g3")],
      [sat("g1"), sat("g2"), sat("g3")],
      3
    );
    expect(r.accepted).toBe(false);
  });

  test("a smoke run is never accepted as a baseline", () => {
    const smoke = three.map((g) => ({ ...g, profile: "smoke" }));
    const r = mergeResults(smoke, [sat("g1"), sat("g2"), sat("g3")], 3);
    expect(r.accepted).toBe(false);
  });

  test("a missing generator is reported", () => {
    const r = mergeResults(three.slice(0, 2), [sat("g1"), sat("g2")], 3);
    expect(r.accepted).toBe(false);
    expect(r.problems[0]).toContain("expected 3");
  });

  test("5xx rate is aggregated across generators", () => {
    const r = mergeResults(
      [gen("g1", { err: 30, ok: 970 }), gen("g2"), gen("g3")],
      [sat("g1"), sat("g2"), sat("g3")],
      3
    );
    expect(r.serverErrorRate).toBeCloseTo(0.01, 5);
  });

  test("runs from different run ids are never merged", () => {
    const other = { ...gen("g2"), runId: "other-run" };
    expect(() => mergeResults([gen("g1"), other], [], 2)).toThrow();
  });
});

describe("ephemeral seed guard", () => {
  test("refuses any non-loopback target", () => {
    expect(() => assertLoopback("https://example.com")).toThrow();
    expect(() => assertLoopback("http://10.0.0.5:4321")).toThrow();
    expect(() => assertLoopback("http://127.0.0.1:4321")).not.toThrow();
  });

  test("the seeded tenant code carries the run id", () => {
    expect(tenantCodeFor("abc123")).toBe("lt-abc123");
  });
});
