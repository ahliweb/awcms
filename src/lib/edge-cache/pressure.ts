/**
 * Auto-activation: decide *how long* the edge may cache, from live origin
 * pressure — ADR-0042 §6.
 *
 * This is the "diaktifkan otomatis apabila diperlukan" half of the design. In
 * `auto` mode the origin advertises **no** TTL while it is comfortably keeping
 * up, so visitors get live data and the cache stays cold. When sustained request
 * rate or origin latency crosses a threshold — the signature of the database
 * being asked the same public question over and over — the advertised TTL ramps
 * up, Varnish starts absorbing those repeats, and the database load falls.
 *
 * ## Why this can only ever change the TTL
 *
 * Pressure is a performance signal, never an authorization one. It is
 * structurally impossible for a reading here to make a private response public:
 * `decideCacheability` decides *whether* something may be cached and never
 * consults this module; this module only produces a number that is then clamped
 * into `[0, config.maxTtlSeconds]`. Keeping the two apart is the reason a load
 * spike cannot turn into a disclosure.
 *
 * ## Hysteresis, and why it is not optional
 *
 * A naive "TTL = f(current load)" flaps: pressure crosses the threshold, objects
 * are cached for 300s, load drops because they are cached, the TTL falls to 0,
 * the cache drains, load returns. That oscillation is worse than either steady
 * state. So activation is sticky — once engaged it holds for a cooldown, and the
 * ramp is computed from the sustained window rather than the instantaneous rate.
 *
 * The tracker is deliberately **process-local and clock-injected**: no database,
 * no Redis, no shared state. Each app instance observes its own load and reaches
 * its own conclusion, which is both correct (they each serve their own traffic)
 * and free of a coordination dependency on the hot path.
 */
import type { EdgeCacheConfig } from "./config";

/** One served-request observation. */
type Observation = {
  atMs: number;
  latencyMs: number;
};

export type PressureSample = {
  /** Observations per second across the rolling window. */
  requestRate: number;
  /** Mean origin latency (ms) across the rolling window. */
  meanLatencyMs: number;
  /**
   * How far past the activation thresholds we are. `<= 1` means "keeping up";
   * `2` means "at twice the threshold", where the ramp reaches full TTL.
   */
  pressureRatio: number;
  /** Whether the ramp is currently engaged (including during cooldown). */
  activated: boolean;
};

export type PressureTracker = {
  /** Record one served request. Cheap; called on the hot path. */
  record(latencyMs: number, nowMs: number): void;
  /** Read the current pressure state. */
  sample(nowMs: number): PressureSample;
  /**
   * The TTL to advertise for a surface that declares `surfaceTtlSeconds`,
   * given the current mode and pressure.
   */
  effectiveTtlSeconds(surfaceTtlSeconds: number, nowMs: number): number;
  /** Test seam — drops all observations and the activation latch. */
  reset(): void;
};

/**
 * Once activated, stay activated for this multiple of the observation window.
 * Long enough that the cache actually fills and the load drop is attributable to
 * caching rather than to noise.
 */
const COOLDOWN_WINDOW_MULTIPLIER = 3;

/**
 * Once the ramp engages, never advertise less than this. A 5-second TTL already
 * collapses a stampede on a hot object by orders of magnitude, whereas a
 * 1-second TTL mostly just adds a cache layer without relieving anything.
 */
const MIN_ACTIVATED_TTL_SECONDS = 5;

/**
 * Hard cap on retained observations. Under a flood the window would otherwise
 * grow without bound — the tracker must not become the memory problem it exists
 * to prevent. Dropping the oldest entries only makes the rate estimate
 * conservative (it under-counts), which fails toward *less* caching.
 */
const MAX_OBSERVATIONS = 10_000;

export function createPressureTracker(
  config: EdgeCacheConfig
): PressureTracker {
  let observations: Observation[] = [];
  let activatedUntilMs = 0;

  const windowMs = Math.max(1, config.autoWindowSeconds) * 1_000;

  function prune(nowMs: number): void {
    const cutoff = nowMs - windowMs;

    if (observations.length > 0 && observations[0]!.atMs < cutoff) {
      observations = observations.filter(
        (observation) => observation.atMs >= cutoff
      );
    }

    if (observations.length > MAX_OBSERVATIONS) {
      observations = observations.slice(-MAX_OBSERVATIONS);
    }
  }

  /**
   * Read the current state, and — as a side effect — refresh the activation
   * latch when the ratio is at or above 1.
   *
   * The latch living here rather than in `record()` means activation is only
   * ever established while something is *reading* pressure. That is fine, and
   * intentional: in `auto` mode the serving path calls `effectiveTtlSeconds()`
   * (which calls `sample()`) on every single request, so a load spike is always
   * observed as it happens. Computing the ratio inside `record()` instead would
   * make every request O(window) for a signal nobody had asked for.
   *
   * The consequence to know about: a burst recorded with no intervening sample
   * — which only happens in tests — leaves the latch unset once the
   * observations age out of the window.
   */
  function sample(nowMs: number): PressureSample {
    prune(nowMs);

    const count = observations.length;
    const requestRate = count / Math.max(1, config.autoWindowSeconds);
    const meanLatencyMs =
      count === 0
        ? 0
        : observations.reduce(
            (total, observation) => total + observation.latencyMs,
            0
          ) / count;

    const rateRatio =
      config.autoRequestRateThreshold > 0
        ? requestRate / config.autoRequestRateThreshold
        : 0;
    const latencyRatio =
      config.autoLatencyThresholdMs > 0
        ? meanLatencyMs / config.autoLatencyThresholdMs
        : 0;

    // Either signal alone is enough: a high request rate means repeats worth
    // absorbing, and high latency means the origin is struggling regardless of
    // rate. Requiring both would keep the cache off in exactly the cases that
    // need it most.
    const pressureRatio = Math.max(rateRatio, latencyRatio);

    if (pressureRatio >= 1) {
      activatedUntilMs = nowMs + windowMs * COOLDOWN_WINDOW_MULTIPLIER;
    }

    return {
      requestRate,
      meanLatencyMs,
      pressureRatio,
      activated: nowMs < activatedUntilMs
    };
  }

  return {
    record(latencyMs, nowMs) {
      observations.push({
        atMs: nowMs,
        latencyMs: Number.isFinite(latencyMs) && latencyMs > 0 ? latencyMs : 0
      });
      prune(nowMs);
    },

    sample,

    effectiveTtlSeconds(surfaceTtlSeconds, nowMs) {
      if (config.mode === "off") {
        return 0;
      }

      // `on` means "always advertise the declared TTL" — pressure is not
      // consulted at all, which is what makes the mode predictable.
      if (config.mode === "on") {
        return Math.min(surfaceTtlSeconds, config.maxTtlSeconds);
      }

      const current = sample(nowMs);

      if (!current.activated) {
        return 0;
      }

      // Ratio 1 -> just activated -> minimum useful TTL.
      // Ratio 2 or beyond -> full declared TTL.
      const rampFraction = Math.min(1, Math.max(0, current.pressureRatio - 1));
      const ramped = Math.round(surfaceTtlSeconds * rampFraction);

      return Math.min(
        Math.max(ramped, MIN_ACTIVATED_TTL_SECONDS),
        surfaceTtlSeconds,
        config.maxTtlSeconds
      );
    },

    reset() {
      observations = [];
      activatedUntilMs = 0;
    }
  };
}
