/**
 * Standard 3-state circuit breaker (Issue 10.2, doc 16 §Connection pooling
 * dan backpressure). Pure logic, no timers/`Date.now()` calls of its own —
 * every method takes `now: Date` explicitly so tests can drive it
 * deterministically without real waits.
 *
 * States:
 * - `closed` — normal operation. `failureThreshold` consecutive failures
 *   (no intervening success) transitions to `open`.
 * - `open` — fails fast (`tryAcquire` returns null) until `openDurationMs`
 *   has elapsed since the breaker opened, at which point exactly one trial
 *   call is allowed through (`half_open`).
 * - `half_open` — a single trial call is in flight. `tryAcquire` RESERVES that
 *   one probe synchronously: while it is outstanding every other `tryAcquire`
 *   returns null. Success closes the breaker and resets the failure count;
 *   failure reopens it and resets the "open since" timestamp (a fresh
 *   `openDurationMs` window starts). A probe that never reports (caller
 *   crashed, timed out without recording, outcome that feeds nothing) is
 *   released by `permit.release()` or, at the latest, expires after
 *   `probeTimeoutMs` so the breaker cannot stick in `half_open` forever.
 *
 * Scope of the guarantee (Issue #1409): single-flight is PER PROCESS. The
 * state lives in this module's memory; it is atomic because JavaScript runs a
 * synchronous `tryAcquire` to completion, not because anything is locked.
 * With N replicas each one lets its own probe through. `canAttempt` was
 * removed: it only read the state, so it implied single-flight it could not
 * give — callers either reserve (`tryAcquire`) or peek (`wouldAllowAttempt`).
 *
 * Metrics decorator import note: this file imports
 * `recordCounter`/`recordHistogram`/`recordGauge` from
 * `../observability/metrics-port` for Issue #698's provider/database
 * outcome, latency, and circuit-state instrumentation — see
 * `decorateWithMetrics` below.
 *
 * Issue #698 (epic #679, "operational proof" wave) note: `recordSuccess`/
 * `recordFailure`'s optional `durationMs` second argument is purely
 * additive — every one of this repo's ~10 existing call sites keeps
 * compiling and behaving identically without passing it. `getDatabaseCircuitBreaker`/
 * `getProviderCircuitBreaker` below wrap the pure breaker this factory
 * returns with a metrics-emitting decorator; `createCircuitBreaker` itself
 * stays exactly as pure/timer-free as this doc comment already promises —
 * metrics side effects live only in the decorator, never here.
 */
import {
  recordCounter,
  recordGauge,
  recordHistogram
} from "../observability/metrics-port";

export type CircuitState = "closed" | "open" | "half_open";

/**
 * Permission to make ONE call through the breaker. `probe` is true when this
 * permit is the single half-open trial. Report the outcome with
 * `recordSuccess`/`recordFailure`; call `release()` (idempotent, safe in a
 * `finally`) when the call produced no verdict for the breaker, so a probe is
 * not held until it expires.
 */
export type CircuitPermit = {
  readonly probe: boolean;
  release(): void;
};

export type CircuitBreaker = {
  recordSuccess(now: Date, durationMs?: number): void;
  recordFailure(now: Date, durationMs?: number): void;
  /**
   * Atomically asks to make a call. Returns null while open, or while the
   * half-open probe is held by someone else. Reserves the probe on success.
   */
  tryAcquire(now: Date): CircuitPermit | null;
  /**
   * READ-ONLY: would `tryAcquire` succeed right now? Reserves nothing and
   * guarantees nothing — another caller may take the probe right after.
   * For gates that only decide whether to start a pass or report health.
   */
  wouldAllowAttempt(now: Date): boolean;
  getState(now: Date): CircuitState;
};

export type CircuitBreakerOptions = {
  /** Consecutive failures (while closed) before the breaker opens. */
  failureThreshold: number;
  /** How long the breaker stays open before allowing one trial call. */
  openDurationMs: number;
  /**
   * How long a reserved half-open probe may stay outstanding without a
   * verdict before another caller may take over. Defaults to
   * `openDurationMs`.
   */
  probeTimeoutMs?: number;
};

type InternalState =
  | { kind: "closed"; consecutiveFailures: number }
  | { kind: "open"; openedAt: number }
  | {
      kind: "half_open";
      probe: { token: number; startedAt: number } | null;
    };

export function createCircuitBreaker(
  options: CircuitBreakerOptions
): CircuitBreaker {
  let state: InternalState = { kind: "closed", consecutiveFailures: 0 };
  let nextProbeToken = 0;
  const probeTimeoutMs = options.probeTimeoutMs ?? options.openDurationMs;

  function probeHeld(now: Date): boolean {
    return (
      state.kind === "half_open" &&
      state.probe !== null &&
      now.getTime() - state.probe.startedAt < probeTimeoutMs
    );
  }

  function transitionIfOpenElapsed(now: Date): void {
    if (
      state.kind === "open" &&
      now.getTime() - state.openedAt >= options.openDurationMs
    ) {
      state = { kind: "half_open", probe: null };
    }
  }

  return {
    tryAcquire(now: Date): CircuitPermit | null {
      transitionIfOpenElapsed(now);

      if (state.kind === "open") {
        return null;
      }

      if (state.kind === "closed") {
        return { probe: false, release: () => {} };
      }

      if (probeHeld(now)) {
        return null;
      }

      const token = ++nextProbeToken;

      state = { kind: "half_open", probe: { token, startedAt: now.getTime() } };

      return {
        probe: true,
        release: () => {
          // Only the permit that still owns the reservation may free it: a
          // stale permit whose probe expired must not free a newer probe.
          if (
            state.kind === "half_open" &&
            state.probe !== null &&
            state.probe.token === token
          ) {
            state = { kind: "half_open", probe: null };
          }
        }
      };
    },

    wouldAllowAttempt(now: Date): boolean {
      transitionIfOpenElapsed(now);

      return (
        state.kind === "closed" ||
        (state.kind === "half_open" && !probeHeld(now))
      );
    },

    recordSuccess(now: Date): void {
      transitionIfOpenElapsed(now);
      state = { kind: "closed", consecutiveFailures: 0 };
    },

    recordFailure(now: Date): void {
      transitionIfOpenElapsed(now);

      if (state.kind === "half_open") {
        state = { kind: "open", openedAt: now.getTime() };
        return;
      }

      if (state.kind === "open") {
        // Already open; a failure here just keeps it open (shouldn't
        // normally happen since canAttempt() would have returned false).
        return;
      }

      const consecutiveFailures = state.consecutiveFailures + 1;

      if (consecutiveFailures >= options.failureThreshold) {
        state = { kind: "open", openedAt: now.getTime() };
        return;
      }

      state = { kind: "closed", consecutiveFailures };
    },

    getState(now: Date): CircuitState {
      transitionIfOpenElapsed(now);

      return state.kind;
    }
  };
}

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_OPEN_DURATION_MS = 30_000;

/**
 * Issue #698 — keeps only the literal, code-hardcoded prefix of a breaker's
 * registry key, discarding anything after the first `:`. Several call sites
 * (Issue #610's tenant-scoped SSO fix) build keys like
 * `sso-oidc-discovery:<tenantId>:<providerKey>` — the tenant id and
 * per-tenant provider slug must NEVER reach a metric label (unbounded
 * cardinality, and a tenant identifier is exactly what the Issue #698
 * guardrail forbids in a label). Every current call site follows the same
 * "literal-category-prefix, optional dynamic `:`-separated suffix"
 * convention, so this one generic split is sufficient — it does not need to
 * know each provider's name ahead of time.
 */
export function deriveProviderFamilyLabel(providerKey: string): string {
  const separatorIndex = providerKey.indexOf(":");

  return separatorIndex === -1
    ? providerKey
    : providerKey.slice(0, separatorIndex);
}

/** Encodes `CircuitState` as the numeric gauge value `provider_circuit_state` uses, and doubles as a "worse than" ranking for `getProviderCircuitBreakerFamilyStates`. */
function circuitStateRank(state: CircuitState): number {
  return state === "open" ? 2 : state === "half_open" ? 1 : 0;
}

/**
 * Wraps a pure `CircuitBreaker` (from `createCircuitBreaker`) with
 * `provider_call_total`/`provider_call_duration_ms`/`provider_circuit_state`
 * metrics emission (Issue #698) — the ONLY place this codebase touches
 * `MetricsPort` for circuit breakers, so `getDatabaseCircuitBreaker`/
 * `getProviderCircuitBreaker` (the two functions every one of this repo's
 * ~10 provider call sites already goes through) get metrics for free,
 * without duplicating breaker logic or touching any call site.
 * `createCircuitBreaker` itself is left untouched and stays pure/timer-free.
 */
function decorateWithMetrics(
  breaker: CircuitBreaker,
  providerKey: string
): CircuitBreaker {
  const provider = deriveProviderFamilyLabel(providerKey);

  function emitOutcome(
    now: Date,
    outcome: "success" | "failure",
    durationMs?: number
  ): void {
    recordCounter("provider_call_total", { provider, outcome });

    if (typeof durationMs === "number") {
      recordHistogram("provider_call_duration_ms", durationMs, { provider });
    }

    recordGauge(
      "provider_circuit_state",
      circuitStateRank(breaker.getState(now)),
      { provider }
    );
  }

  return {
    tryAcquire: (now) => breaker.tryAcquire(now),
    wouldAllowAttempt: (now) => breaker.wouldAllowAttempt(now),
    getState: (now) => breaker.getState(now),
    recordSuccess: (now, durationMs) => {
      breaker.recordSuccess(now);
      emitOutcome(now, "success", durationMs);
    },
    recordFailure: (now, durationMs) => {
      breaker.recordFailure(now);
      emitOutcome(now, "failure", durationMs);
    }
  };
}

let sharedDatabaseCircuitBreaker: CircuitBreaker | undefined;

/**
 * Module-level singleton shared across the whole app (not per-request), so
 * that consecutive failures across different requests/tenants accumulate
 * against the same breaker. Used by `withTenant` (tenant-context.ts) and by
 * the `/database/pool/health` endpoint. Metrics-decorated with provider
 * family label `"database"` (Issue #698) — reuses the exact same
 * `provider_*` metric family as external providers below rather than a
 * separate database-only metric name, since "which finite family this call
 * belongs to" is the only distinction that matters for a low-cardinality
 * label.
 */
export function getDatabaseCircuitBreaker(): CircuitBreaker {
  if (!sharedDatabaseCircuitBreaker) {
    sharedDatabaseCircuitBreaker = decorateWithMetrics(
      createCircuitBreaker({
        failureThreshold: DEFAULT_FAILURE_THRESHOLD,
        openDurationMs: DEFAULT_OPEN_DURATION_MS
      }),
      "database"
    );
  }

  return sharedDatabaseCircuitBreaker;
}

/** Test-only reset so breaker state doesn't leak between test cases. */
export function resetDatabaseCircuitBreakerForTests(): void {
  sharedDatabaseCircuitBreaker = undefined;
}

// -----------------------------------------------------------------------
// Provider circuit breakers (Issue #436 — extend this same generic breaker
// to outbound calls to external providers, not just the database). One
// breaker per provider key (e.g. "object-storage") so an outage in one
// provider doesn't trip the breaker for an unrelated one — a registry
// instead of a single singleton like `getDatabaseCircuitBreaker` above,
// since (unlike the DB) this app can have more than one external provider.
// -----------------------------------------------------------------------

const DEFAULT_PROVIDER_FAILURE_THRESHOLD = 5;
const DEFAULT_PROVIDER_OPEN_DURATION_MS = 30_000;

const providerCircuitBreakers = new Map<string, CircuitBreaker>();

/**
 * Module-level singleton per `providerKey`, shared across the whole app (not
 * per-request/per-tenant), so consecutive failures calling the same
 * provider accumulate against the same breaker regardless of which tenant's
 * request triggered them. `options` only applies the first time a given
 * `providerKey` is requested; later calls return the existing breaker.
 */
export function getProviderCircuitBreaker(
  providerKey: string,
  options: CircuitBreakerOptions = {
    failureThreshold: DEFAULT_PROVIDER_FAILURE_THRESHOLD,
    openDurationMs: DEFAULT_PROVIDER_OPEN_DURATION_MS
  }
): CircuitBreaker {
  let breaker = providerCircuitBreakers.get(providerKey);

  if (!breaker) {
    breaker = decorateWithMetrics(createCircuitBreaker(options), providerKey);
    providerCircuitBreakers.set(providerKey, breaker);
  }

  return breaker;
}

/** Test-only reset so breaker state doesn't leak between test cases. */
export function resetProviderCircuitBreakersForTests(): void {
  providerCircuitBreakers.clear();
}

export type ProviderCircuitFamilyState = {
  family: string;
  state: CircuitState;
};

/**
 * Issue #698 — snapshot used by the authorized dependency-health endpoint
 * (`GET /api/v1/logs/observability/dependency-health`) to report optional
 * external providers' circuit state WITHOUT ever exposing a raw registry
 * key (which, per `deriveProviderFamilyLabel`'s doc comment, can embed a
 * tenant id for tenant-scoped SSO providers). Only ever-instantiated
 * breakers appear here (a provider never called yet simply has no entry —
 * not a bug, there is no state to report); when more than one registered
 * breaker maps to the same family (e.g. two tenants' SSO discovery
 * breakers), the WORST state (open > half_open > closed) is reported for
 * that family, since a single aggregate boolean-ish signal is all an
 * admin-facing dependency health check needs — never a per-tenant
 * breakdown.
 */
export function getProviderCircuitBreakerFamilyStates(
  now: Date
): ProviderCircuitFamilyState[] {
  const worstByFamily = new Map<string, CircuitState>();

  for (const [providerKey, breaker] of providerCircuitBreakers) {
    const family = deriveProviderFamilyLabel(providerKey);
    const state = breaker.getState(now);
    const existing = worstByFamily.get(family);

    if (!existing || circuitStateRank(state) > circuitStateRank(existing)) {
      worstByFamily.set(family, state);
    }
  }

  return Array.from(worstByFamily.entries()).map(([family, state]) => ({
    family,
    state
  }));
}
