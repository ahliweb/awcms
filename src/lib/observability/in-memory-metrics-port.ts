/**
 * In-memory `MetricsPort` adapter (Issue #698). Two uses:
 *
 * 1. Test double — every unit test in this repo that asserts "a metric was
 *    recorded" registers this via `setMetricsPort` and reads `getSnapshot()`
 *    back, instead of mocking the port's three methods individually.
 * 2. The simplest possible "real" adapter — proof that `MetricsPort` is
 *    implementable outside the no-op default without needing a network
 *    call, a dependency, or Node.js (Bun-only, AGENTS.md rule 14).
 *
 * Not meant for production use as-is (state only ever grows within a single
 * process's lifetime, never exported) — see
 * `./adapters/prometheus-text-adapter.ts` for the adapter meant to actually
 * be wired up in a deployment.
 */
import type { MetricLabels, MetricsPort } from "./metrics-port";

export type InMemoryHistogramSnapshot = {
  count: number;
  sum: number;
  min: number;
  max: number;
};

export type InMemoryMetricsSnapshot = {
  /** Keyed by `"<name>{<sorted label=value pairs>}"`. */
  counters: Record<string, number>;
  histograms: Record<string, InMemoryHistogramSnapshot>;
  gauges: Record<string, number>;
};

export type InMemoryMetricsPort = MetricsPort & {
  getSnapshot(): InMemoryMetricsSnapshot;
  reset(): void;
};

/** Stable series key so the same name+labels combination always accumulates into the same entry, regardless of the order labels were passed in. */
function seriesKey(name: string, labels: MetricLabels): string {
  const sortedPairs = Object.keys(labels)
    .sort()
    .map((key) => `${key}=${labels[key]}`);

  return `${name}{${sortedPairs.join(",")}}`;
}

export function createInMemoryMetricsPort(): InMemoryMetricsPort {
  const counters = new Map<string, number>();
  const histograms = new Map<string, InMemoryHistogramSnapshot>();
  const gauges = new Map<string, number>();

  return {
    incrementCounter(name, labels, value) {
      const key = seriesKey(name, labels);
      counters.set(key, (counters.get(key) ?? 0) + value);
    },
    observeHistogram(name, valueMs, labels) {
      const key = seriesKey(name, labels);
      const existing = histograms.get(key);

      histograms.set(key, {
        count: (existing?.count ?? 0) + 1,
        sum: (existing?.sum ?? 0) + valueMs,
        min: Math.min(existing?.min ?? Number.POSITIVE_INFINITY, valueMs),
        max: Math.max(existing?.max ?? Number.NEGATIVE_INFINITY, valueMs)
      });
    },
    setGauge(name, value, labels) {
      gauges.set(seriesKey(name, labels), value);
    },
    getSnapshot(): InMemoryMetricsSnapshot {
      return {
        counters: Object.fromEntries(counters),
        histograms: Object.fromEntries(histograms),
        gauges: Object.fromEntries(gauges)
      };
    },
    reset() {
      counters.clear();
      histograms.clear();
      gauges.clear();
    }
  };
}
