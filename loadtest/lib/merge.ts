/**
 * Pure aggregation of per-generator k6 results (Issue #1283).
 *
 * k6 reports percentiles per process and they cannot be merged exactly. This
 * module therefore reports, per percentile, BOTH a request-weighted mean across
 * generators (an approximation, labelled as such) and the worst generator's
 * value; the verdict uses the worst generator, which is the conservative bound.
 */

export type TrendValues = Record<string, number>;

export type K6Summary = {
  metrics: Record<
    string,
    {
      type?: string;
      values?: Record<string, number>;
      thresholds?: Record<string, { ok: boolean }>;
    }
  >;
  state?: { testRunDurationMs?: number };
};

export type GeneratorResult = {
  runId: string;
  generatorId: string;
  totalGenerators: number;
  scenario: string;
  profile: string;
  targetRpsAggregate: number;
  summary: K6Summary;
};

export type Saturation = {
  generatorId: string;
  host: string;
  samples: number;
  cpuAvgPct: number;
  cpuPeakPct: number;
  netPeakMbps: number;
  /** NIC speed in Mbit/s when the kernel reports it, else null. */
  linkMbps: number | null;
};

export type SaturationLimits = {
  maxCpuPct: number;
  maxNetPct: number;
  maxDroppedRatio: number;
};

export const DEFAULT_LIMITS: SaturationLimits = {
  maxCpuPct: 70,
  maxNetPct: 70,
  maxDroppedRatio: 0.01
};

export const PERCENTILES = ["med", "p(90)", "p(95)", "p(99)", "max"] as const;

export type MergedReport = {
  runId: string;
  scenario: string;
  profile: string;
  generators: number;
  expectedGenerators: number;
  targetRpsAggregate: number;
  requests: number;
  durationSec: number;
  meanRps: number;
  serverErrorRate: number;
  rateLimitedResponses: number;
  droppedIterations: number;
  droppedRatio: number;
  latencyMs: Record<string, { weightedMean: number; worstGenerator: number }>;
  thresholdsOk: boolean;
  saturation: {
    ok: boolean;
    perGenerator: Array<{
      generatorId: string;
      ok: boolean;
      reasons: string[];
    }>;
  };
  /** True only when the limit demonstrably came from the system under test. */
  accepted: boolean;
  problems: string[];
};

const value = (s: K6Summary, metric: string, key: string): number =>
  s.metrics[metric]?.values?.[key] ?? 0;

export function evaluateSaturation(
  sat: Saturation,
  droppedRatio: number,
  limits: SaturationLimits
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (sat.cpuPeakPct > limits.maxCpuPct) {
    reasons.push(
      `generator CPU peak ${sat.cpuPeakPct.toFixed(0)}% > ${limits.maxCpuPct}%`
    );
  }
  if (sat.linkMbps === null) {
    reasons.push("NIC speed unknown: network saturation cannot be judged");
  } else if (sat.netPeakMbps > (sat.linkMbps * limits.maxNetPct) / 100) {
    reasons.push(
      `generator network peak ${sat.netPeakMbps.toFixed(0)} Mbit/s > ${limits.maxNetPct}% of ${sat.linkMbps} Mbit/s`
    );
  }
  if (droppedRatio > limits.maxDroppedRatio) {
    reasons.push(
      `k6 dropped ${(droppedRatio * 100).toFixed(1)}% of intended iterations (client could not keep the arrival rate)`
    );
  }
  return { ok: reasons.length === 0, reasons };
}

export function mergeResults(
  results: GeneratorResult[],
  saturations: Saturation[],
  expectedGenerators: number,
  limits: SaturationLimits = DEFAULT_LIMITS
): MergedReport {
  if (results.length === 0) throw new Error("no generator results to merge");
  const first = results[0]!;
  const problems: string[] = [];

  for (const r of results) {
    if (
      r.runId !== first.runId ||
      r.scenario !== first.scenario ||
      r.profile !== first.profile
    ) {
      throw new Error(
        `generator ${r.generatorId} belongs to a different run, scenario or profile`
      );
    }
  }
  const ids = new Set(results.map((r) => r.generatorId));
  if (ids.size !== results.length) {
    throw new Error("duplicate generator id among results");
  }
  if (results.length !== expectedGenerators) {
    problems.push(
      `expected ${expectedGenerators} generators, found ${results.length}`
    );
  }

  const requests = results.reduce(
    (n, r) => n + value(r.summary, "http_reqs", "count"),
    0
  );
  const durationSec =
    Math.max(...results.map((r) => r.summary.state?.testRunDurationMs ?? 0)) /
    1000;
  const passes = results.reduce(
    (n, r) => n + value(r.summary, "awcms_server_error_rate", "passes"),
    0
  );
  const fails = results.reduce(
    (n, r) => n + value(r.summary, "awcms_server_error_rate", "fails"),
    0
  );
  const dropped = results.reduce(
    (n, r) => n + value(r.summary, "dropped_iterations", "count"),
    0
  );
  const iterations = results.reduce(
    (n, r) => n + value(r.summary, "iterations", "count"),
    0
  );

  const latencyMs: MergedReport["latencyMs"] = {};
  for (const p of PERCENTILES) {
    let weighted = 0;
    let weight = 0;
    let worst = 0;
    for (const r of results) {
      const v = value(r.summary, "http_req_duration", p);
      const w = value(r.summary, "http_reqs", "count");
      weighted += v * w;
      weight += w;
      worst = Math.max(worst, v);
    }
    latencyMs[p] = {
      weightedMean: weight === 0 ? 0 : weighted / weight,
      worstGenerator: worst
    };
  }

  const thresholdsOk = results.every((r) =>
    Object.values(r.summary.metrics).every((m) =>
      Object.values(m.thresholds ?? {}).every((t) => t.ok)
    )
  );

  const droppedRatio =
    dropped + iterations === 0 ? 0 : dropped / (dropped + iterations);
  const perGenerator = results.map((r) => {
    const sat = saturations.find((s) => s.generatorId === r.generatorId);
    if (!sat) {
      return {
        generatorId: r.generatorId,
        ok: false,
        reasons: ["no saturation record for this generator"]
      };
    }
    const own = value(r.summary, "dropped_iterations", "count");
    const ownIter = value(r.summary, "iterations", "count");
    const ownRatio = own + ownIter === 0 ? 0 : own / (own + ownIter);
    return {
      generatorId: r.generatorId,
      ...evaluateSaturation(sat, ownRatio, limits)
    };
  });
  const saturationOk = perGenerator.every((g) => g.ok);

  const serverErrorRate = passes + fails === 0 ? 0 : passes / (passes + fails);
  if (first.profile === "smoke") {
    problems.push("smoke profile only checks wiring; it is never a baseline");
  }
  const rateLimitedResponses = results.reduce(
    (n, r) => n + value(r.summary, "awcms_rate_limited_responses", "count"),
    0
  );
  if (rateLimitedResponses > 0) {
    problems.push(
      `${rateLimitedResponses} responses were HTTP 429: a rate limiter, not capacity, shaped this run`
    );
  }

  const accepted =
    problems.length === 0 &&
    saturationOk &&
    results.length === expectedGenerators;

  return {
    runId: first.runId,
    scenario: first.scenario,
    profile: first.profile,
    generators: results.length,
    expectedGenerators,
    targetRpsAggregate: first.targetRpsAggregate,
    requests,
    durationSec,
    meanRps: durationSec === 0 ? 0 : requests / durationSec,
    serverErrorRate,
    rateLimitedResponses,
    droppedIterations: dropped,
    droppedRatio,
    latencyMs,
    thresholdsOk,
    saturation: { ok: saturationOk, perGenerator },
    accepted,
    problems
  };
}

export function renderReport(report: MergedReport): string {
  const lines = [
    `run ${report.runId}  scenario ${report.scenario}  profile ${report.profile}`,
    `generators ${report.generators}/${report.expectedGenerators}  target ${report.targetRpsAggregate} rps (aggregate)`,
    `requests ${report.requests}  duration ${report.durationSec.toFixed(0)} s  mean ${report.meanRps.toFixed(1)} rps`,
    `5xx rate ${(report.serverErrorRate * 100).toFixed(2)}%  HTTP 429 ${report.rateLimitedResponses}  dropped iterations ${report.droppedIterations} (${(report.droppedRatio * 100).toFixed(2)}%)`,
    "latency ms (weighted mean of generators / worst generator):"
  ];
  for (const [p, v] of Object.entries(report.latencyMs)) {
    lines.push(
      `  ${p.padEnd(6)} ${v.weightedMean.toFixed(1).padStart(8)} / ${v.worstGenerator.toFixed(1).padStart(8)}`
    );
  }
  lines.push(
    `k6 thresholds (p95, 5xx): ${report.thresholdsOk ? "PASS" : "FAIL"}`,
    `client saturation: ${report.saturation.ok ? "OK" : "SATURATED"}`
  );
  for (const g of report.saturation.perGenerator) {
    lines.push(`  ${g.generatorId}: ${g.ok ? "ok" : g.reasons.join("; ")}`);
  }
  for (const p of report.problems) lines.push(`problem: ${p}`);
  lines.push(
    report.accepted
      ? "RESULT ACCEPTED: the limit came from the system under test."
      : "RESULT NOT ACCEPTED: do not record these numbers as a baseline."
  );
  return lines.join("\n");
}
