/**
 * Optional Prometheus text-exposition adapter (Issue #698). Worked example
 * of wiring a real observability backend to the `MetricsPort` contract
 * WITHOUT coupling the core runtime to Prometheus, a SaaS, or a new
 * dependency (Bun-only, AGENTS.md rule 14 — this is plain TypeScript, no
 * `prom-client`/Node package). NOT registered anywhere by default; a
 * derived application wires it up itself:
 *
 * ```ts
 * import { setMetricsPort } from "src/lib/observability/metrics-port";
 * import { createPrometheusTextMetricsPort } from "src/lib/observability/adapters/prometheus-text-adapter";
 *
 * const prometheus = createPrometheusTextMetricsPort();
 * setMetricsPort(prometheus);
 *
 * // Expose to a Prometheus scraper (e.g. a new admin-only or network-
 * // restricted route, deliberately NOT added by this base — scraping
 * // exposure policy is a deployment decision):
 * // return new Response(prometheus.renderPrometheusText(), {
 * //   headers: { "content-type": "text/plain; version=0.0.4" }
 * // });
 * ```
 *
 * An OpenTelemetry adapter would follow the identical shape — implement the
 * three `MetricsPort` methods against `@opentelemetry/api`'s
 * Counter/Histogram/Gauge instruments instead of the in-memory maps below —
 * intentionally not included here to avoid adding an unused dependency to
 * this repo; this file is the pattern to copy.
 */
import {
  DEFAULT_HISTOGRAM_BUCKETS_MS,
  METRIC_DEFINITIONS,
  type MetricLabels,
  type MetricsPort
} from "../metrics-port";

type CounterOrGaugeSeries = { labels: MetricLabels; value: number };

type HistogramSeries = {
  labels: MetricLabels;
  /** Cumulative count at-or-below each `buckets[i]` boundary — standard Prometheus histogram semantics. */
  bucketCounts: number[];
  sum: number;
  count: number;
};

export type PrometheusTextMetricsPort = MetricsPort & {
  /** Renders every recorded series in Prometheus text exposition format (https://prometheus.io/docs/instrumenting/exposition_formats/). */
  renderPrometheusText(): string;
  reset(): void;
};

function seriesKey(labels: MetricLabels): string {
  return Object.keys(labels)
    .sort()
    .map((key) => `${key}=${JSON.stringify(labels[key])}`)
    .join(",");
}

function renderLabels(labels: MetricLabels): string {
  const keys = Object.keys(labels);

  if (keys.length === 0) {
    return "";
  }

  return `{${keys.map((key) => `${key}="${labels[key]}"`).join(",")}}`;
}

function metricHelp(name: string): string {
  return (
    (METRIC_DEFINITIONS as Record<string, { description: string }>)[name]
      ?.description ?? ""
  );
}

/**
 * @param buckets Histogram bucket boundaries in milliseconds. Defaults to
 * `DEFAULT_HISTOGRAM_BUCKETS_MS` (the same convention every histogram metric
 * in this codebase is documented against) so a deployment doesn't need to
 * change its dashboards/alerts unless it deliberately overrides this.
 */
export function createPrometheusTextMetricsPort(
  buckets: readonly number[] = DEFAULT_HISTOGRAM_BUCKETS_MS
): PrometheusTextMetricsPort {
  const counters = new Map<string, Map<string, CounterOrGaugeSeries>>();
  const gauges = new Map<string, Map<string, CounterOrGaugeSeries>>();
  const histograms = new Map<string, Map<string, HistogramSeries>>();

  function seriesMapFor<T>(
    store: Map<string, Map<string, T>>,
    name: string
  ): Map<string, T> {
    let seriesMap = store.get(name);

    if (!seriesMap) {
      seriesMap = new Map();
      store.set(name, seriesMap);
    }

    return seriesMap;
  }

  return {
    incrementCounter(name, labels, value) {
      const seriesMap = seriesMapFor(counters, name);
      const key = seriesKey(labels);
      const existing = seriesMap.get(key);

      if (existing) {
        existing.value += value;
      } else {
        seriesMap.set(key, { labels, value });
      }
    },
    setGauge(name, value, labels) {
      seriesMapFor(gauges, name).set(seriesKey(labels), { labels, value });
    },
    observeHistogram(name, valueMs, labels) {
      const seriesMap = seriesMapFor(histograms, name);
      const key = seriesKey(labels);
      const existing = seriesMap.get(key);
      const series: HistogramSeries = existing ?? {
        labels,
        bucketCounts: new Array(buckets.length).fill(0) as number[],
        sum: 0,
        count: 0
      };

      series.sum += valueMs;
      series.count += 1;

      for (let i = 0; i < buckets.length; i++) {
        if (valueMs <= buckets[i]!) {
          series.bucketCounts[i]! += 1;
        }
      }

      seriesMap.set(key, series);
    },
    renderPrometheusText(): string {
      const lines: string[] = [];

      for (const [name, seriesMap] of counters) {
        lines.push(`# HELP ${name} ${metricHelp(name)}`);
        lines.push(`# TYPE ${name} counter`);
        for (const { labels, value } of seriesMap.values()) {
          lines.push(`${name}${renderLabels(labels)} ${value}`);
        }
      }

      for (const [name, seriesMap] of gauges) {
        lines.push(`# HELP ${name} ${metricHelp(name)}`);
        lines.push(`# TYPE ${name} gauge`);
        for (const { labels, value } of seriesMap.values()) {
          lines.push(`${name}${renderLabels(labels)} ${value}`);
        }
      }

      for (const [name, seriesMap] of histograms) {
        lines.push(`# HELP ${name} ${metricHelp(name)}`);
        lines.push(`# TYPE ${name} histogram`);
        for (const { labels, bucketCounts, sum, count } of seriesMap.values()) {
          for (let i = 0; i < buckets.length; i++) {
            lines.push(
              `${name}_bucket${renderLabels({ ...labels, le: String(buckets[i]) })} ${bucketCounts[i]}`
            );
          }
          lines.push(
            `${name}_bucket${renderLabels({ ...labels, le: "+Inf" })} ${count}`
          );
          lines.push(`${name}_sum${renderLabels(labels)} ${sum}`);
          lines.push(`${name}_count${renderLabels(labels)} ${count}`);
        }
      }

      return lines.length > 0 ? `${lines.join("\n")}\n` : "";
    },
    reset() {
      counters.clear();
      gauges.clear();
      histograms.clear();
    }
  };
}
