/**
 * Issue #698 (epic #679, "operational proof" wave) — proves
 * `getDatabaseCircuitBreaker`/`getProviderCircuitBreaker` emit
 * `provider_call_total`/`provider_call_duration_ms`/`provider_circuit_state`
 * metrics via their shared `decorateWithMetrics` wrapper, and that
 * `deriveProviderFamilyLabel`/`getProviderCircuitBreakerFamilyStates` keep
 * a tenant-scoped registry key (Issue #610 shape) from ever reaching a
 * label.
 */
import { afterEach, describe, expect, test } from "bun:test";

import {
  deriveProviderFamilyLabel,
  getDatabaseCircuitBreaker,
  getProviderCircuitBreaker,
  getProviderCircuitBreakerFamilyStates,
  resetDatabaseCircuitBreakerForTests,
  resetProviderCircuitBreakersForTests
} from "../src/lib/database/circuit-breaker";
import { createInMemoryMetricsPort } from "../src/lib/observability/in-memory-metrics-port";
import {
  resetMetricsPortForTests,
  setMetricsPort
} from "../src/lib/observability/metrics-port";

describe("deriveProviderFamilyLabel (Issue #698)", () => {
  test("keeps only the literal prefix before the first ':'", () => {
    expect(
      deriveProviderFamilyLabel(
        "sso-oidc-discovery:11111111-1111-1111-1111-111111111111:okta"
      )
    ).toBe("sso-oidc-discovery");
  });

  test("returns the whole key unchanged when there is no ':'", () => {
    expect(deriveProviderFamilyLabel("object-storage")).toBe("object-storage");
  });
});

describe("circuit breaker metrics decorator (Issue #698)", () => {
  afterEach(() => {
    resetMetricsPortForTests();
    resetDatabaseCircuitBreakerForTests();
    resetProviderCircuitBreakersForTests();
  });

  test("getDatabaseCircuitBreaker emits provider_call_total{provider=database} on success", () => {
    const port = createInMemoryMetricsPort();
    setMetricsPort(port);

    getDatabaseCircuitBreaker().recordSuccess(new Date());

    const snapshot = port.getSnapshot();
    expect(
      snapshot.counters[
        "provider_call_total{outcome=success,provider=database}"
      ]
    ).toBe(1);
    expect(snapshot.gauges["provider_circuit_state{provider=database}"]).toBe(
      0
    );
  });

  test("a raw tenant-scoped provider key is reduced to its bounded family label in every metric, never the raw key", () => {
    const port = createInMemoryMetricsPort();
    setMetricsPort(port);

    const rawKey =
      "sso-oidc-discovery:22222222-2222-2222-2222-222222222222:okta";
    getProviderCircuitBreaker(rawKey).recordFailure(new Date());

    const snapshot = port.getSnapshot();
    const counterKeys = Object.keys(snapshot.counters);

    expect(counterKeys).toHaveLength(1);
    expect(counterKeys[0]).toContain("provider=sso-oidc-discovery");
    expect(counterKeys[0]).not.toContain(
      "22222222-2222-2222-2222-222222222222"
    );
    expect(counterKeys[0]).not.toContain(rawKey);
  });

  test("recordSuccess/recordFailure's optional durationMs observes provider_call_duration_ms", () => {
    const port = createInMemoryMetricsPort();
    setMetricsPort(port);

    getProviderCircuitBreaker("object-storage").recordSuccess(new Date(), 42);

    const snapshot = port.getSnapshot();
    expect(
      snapshot.histograms["provider_call_duration_ms{provider=object-storage}"]
    ).toEqual({ count: 1, sum: 42, min: 42, max: 42 });
  });

  test("omitting durationMs (existing call sites) records the outcome without a histogram observation", () => {
    const port = createInMemoryMetricsPort();
    setMetricsPort(port);

    getProviderCircuitBreaker("turnstile").recordSuccess(new Date());

    const snapshot = port.getSnapshot();
    expect(
      snapshot.counters[
        "provider_call_total{outcome=success,provider=turnstile}"
      ]
    ).toBe(1);
    expect(
      snapshot.histograms["provider_call_duration_ms{provider=turnstile}"]
    ).toBeUndefined();
  });

  test("provider_circuit_state reflects the breaker opening after failureThreshold consecutive failures", () => {
    const port = createInMemoryMetricsPort();
    setMetricsPort(port);
    const now = new Date();
    const breaker = getProviderCircuitBreaker("email");

    for (let i = 0; i < 5; i++) {
      breaker.recordFailure(now);
    }

    expect(breaker.canAttempt(now)).toBe(false);
    expect(
      port.getSnapshot().gauges["provider_circuit_state{provider=email}"]
    ).toBe(2);
  });
});

describe("getProviderCircuitBreakerFamilyStates (Issue #698)", () => {
  afterEach(() => {
    resetProviderCircuitBreakersForTests();
  });

  test("aggregates multiple registered breakers sharing a family to the WORST state", () => {
    const now = new Date();
    const tenantABreaker = getProviderCircuitBreaker(
      "sso-oidc-discovery:tenant-a:okta"
    );
    getProviderCircuitBreaker("sso-oidc-discovery:tenant-b:okta");

    for (let i = 0; i < 5; i++) {
      tenantABreaker.recordFailure(now);
    }

    const states = getProviderCircuitBreakerFamilyStates(now);
    const family = states.find(
      (entry) => entry.family === "sso-oidc-discovery"
    );

    expect(family?.state).toBe("open");
  });

  test("a provider never called yet has no entry", () => {
    const states = getProviderCircuitBreakerFamilyStates(new Date());
    expect(
      states.find((entry) => entry.family === "never-used-provider")
    ).toBeUndefined();
  });
});
