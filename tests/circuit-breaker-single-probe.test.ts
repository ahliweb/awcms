/**
 * Issue #1409 — the half-open state admits exactly ONE probe per process.
 *
 * `canAttempt` used to answer `state.kind !== "open"` without reserving
 * anything, so every caller that asked before the first one reported back got
 * through. These tests drive the clock by hand (no sleeps) and make the
 * "callers in flight at once" shape explicit: acquire first, report later.
 */
import { afterEach, describe, expect, test } from "bun:test";

import {
  createCircuitBreaker,
  getProviderCircuitBreaker,
  getProviderCircuitBreakerFamilyStates,
  resetProviderCircuitBreakersForTests
} from "../src/lib/database/circuit-breaker";
import { createInMemoryMetricsPort } from "../src/lib/observability/in-memory-metrics-port";
import {
  resetMetricsPortForTests,
  setMetricsPort
} from "../src/lib/observability/metrics-port";
import { resolveVerificationTxtRecords } from "../src/modules/tenant-domain/infrastructure/dns-txt-verifier";

const T0 = new Date("2026-11-22T00:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

function openBreaker() {
  const breaker = createCircuitBreaker({
    failureThreshold: 2,
    openDurationMs: 1000
  });

  breaker.recordFailure(T0);
  breaker.recordFailure(T0);

  return breaker;
}

afterEach(() => {
  resetProviderCircuitBreakersForTests();
  resetMetricsPortForTests();
});

describe("half-open single probe (Issue #1409)", () => {
  test("many concurrent callers after the open window: exactly one gets through", () => {
    const breaker = openBreaker();

    expect(breaker.tryAcquire(at(999))).toBeNull();

    const permits = Array.from({ length: 10 }, () =>
      breaker.tryAcquire(at(1000))
    );
    const granted = permits.filter((permit) => permit !== null);

    expect(granted).toHaveLength(1);
    expect(granted[0]?.probe).toBe(true);
    expect(breaker.getState(at(1000))).toBe("half_open");
  });

  test("a successful probe closes the breaker for everyone", () => {
    const breaker = openBreaker();

    expect(breaker.tryAcquire(at(1000))).not.toBeNull();
    expect(breaker.tryAcquire(at(1001))).toBeNull();

    breaker.recordSuccess(at(1002));

    const after = [breaker.tryAcquire(at(1003)), breaker.tryAcquire(at(1003))];

    expect(after.every((permit) => permit !== null && !permit.probe)).toBe(
      true
    );
    expect(breaker.getState(at(1003))).toBe("closed");
  });

  test("a failed probe reopens with a fresh window and admits nobody", () => {
    const breaker = openBreaker();

    breaker.tryAcquire(at(1000));
    breaker.recordFailure(at(1500));

    expect(breaker.tryAcquire(at(1501))).toBeNull();
    expect(breaker.tryAcquire(at(2499))).toBeNull();
    expect(breaker.tryAcquire(at(2500))?.probe).toBe(true);
  });

  test("release() without a verdict hands the probe to the next caller", () => {
    const breaker = openBreaker();
    const first = breaker.tryAcquire(at(1000));

    expect(breaker.tryAcquire(at(1001))).toBeNull();

    first?.release();
    first?.release(); // idempotent

    expect(breaker.getState(at(1002))).toBe("half_open");
    expect(breaker.tryAcquire(at(1002))?.probe).toBe(true);
  });

  test("an abandoned probe expires after probeTimeoutMs (default openDurationMs), so the breaker never sticks", () => {
    const breaker = openBreaker();

    breaker.tryAcquire(at(1000)); // never reports, never releases

    expect(breaker.tryAcquire(at(1999))).toBeNull();
    expect(breaker.tryAcquire(at(2000))?.probe).toBe(true);
  });

  test("probeTimeoutMs is configurable independently of openDurationMs", () => {
    const breaker = createCircuitBreaker({
      failureThreshold: 1,
      openDurationMs: 1000,
      probeTimeoutMs: 50
    });

    breaker.recordFailure(T0);
    breaker.tryAcquire(at(1000));

    expect(breaker.tryAcquire(at(1049))).toBeNull();
    expect(breaker.tryAcquire(at(1050))?.probe).toBe(true);
  });

  test("a stale permit cannot free a newer probe's reservation", () => {
    const breaker = openBreaker();
    const stale = breaker.tryAcquire(at(1000));
    const fresh = breaker.tryAcquire(at(2000)); // first probe expired

    expect(fresh?.probe).toBe(true);

    stale?.release();

    expect(breaker.tryAcquire(at(2001))).toBeNull();
  });

  test("wouldAllowAttempt is read-only: it never reserves the probe", () => {
    const breaker = openBreaker();

    expect(breaker.wouldAllowAttempt(at(999))).toBe(false);
    expect(breaker.wouldAllowAttempt(at(1000))).toBe(true);
    expect(breaker.wouldAllowAttempt(at(1000))).toBe(true);

    expect(breaker.tryAcquire(at(1000))?.probe).toBe(true);
    expect(breaker.wouldAllowAttempt(at(1001))).toBe(false);
  });

  test("closed breaker never reserves: unlimited concurrent permits", () => {
    const breaker = createCircuitBreaker({
      failureThreshold: 3,
      openDurationMs: 1000
    });
    const permits = Array.from({ length: 20 }, () => breaker.tryAcquire(T0));

    expect(permits.every((permit) => permit !== null && !permit.probe)).toBe(
      true
    );
  });
});

describe("provider path and registry (Issue #1409)", () => {
  test("registry breakers are isolated per provider key", () => {
    const options = { failureThreshold: 1, openDurationMs: 1000 };
    const a = getProviderCircuitBreaker("probe-a", options);
    const b = getProviderCircuitBreaker("probe-b", options);

    a.recordFailure(T0);
    b.recordFailure(T0);

    expect(a.tryAcquire(at(1000))?.probe).toBe(true);
    // a's probe does not consume b's.
    expect(b.tryAcquire(at(1000))?.probe).toBe(true);
    expect(a.tryAcquire(at(1001))).toBeNull();
  });

  test("a real provider path (DNS TXT) sends ONE lookup while half-open; the rest are refused", async () => {
    const lookups: string[] = [];
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const resolver = async (name: string): Promise<string[][]> => {
      lookups.push(name);
      await gate;

      return [["ok"]];
    };

    // Open the real shared breaker the verifier uses (5 consecutive failures),
    // then step past its 30 s window with the injected clock.
    const breaker = getProviderCircuitBreaker("tenant-domain-dns-verify");

    for (let i = 0; i < 5; i += 1) {
      breaker.recordFailure(T0);
    }

    const later = at(60_000);
    const calls = Array.from({ length: 8 }, (_, i) =>
      resolveVerificationTxtRecords(`_v${i}.example.test`, {
        resolver,
        now: later
      })
    );

    // The probe is parked on the gate; the other seven were refused at once.
    await Promise.resolve();
    open();

    const results = await Promise.all(calls);

    expect(lookups).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "records")).toHaveLength(1);
    expect(
      results.filter(
        (r) => r.outcome === "unavailable" && r.reason === "circuit_open"
      )
    ).toHaveLength(7);
  });

  test("metrics stay bounded: refused acquisitions add no series, family label only", () => {
    const port = createInMemoryMetricsPort();
    setMetricsPort(port);

    const breaker = getProviderCircuitBreaker(
      "sso-oidc-token:11111111-1111-1111-1111-111111111111:okta",
      { failureThreshold: 1, openDurationMs: 1000 }
    );

    breaker.recordFailure(T0);
    breaker.tryAcquire(at(1000));

    for (let i = 0; i < 25; i += 1) {
      breaker.tryAcquire(at(1001));
    }

    const snapshot = port.getSnapshot();
    const keys = [
      ...Object.keys(snapshot.counters),
      ...Object.keys(snapshot.gauges)
    ];

    expect(keys.every((key) => !key.includes("11111111"))).toBe(true);
    expect(
      snapshot.counters[
        "provider_call_total{outcome=failure,provider=sso-oidc-token}"
      ]
    ).toBe(1);
    expect(getProviderCircuitBreakerFamilyStates(at(1002))).toEqual([
      { family: "sso-oidc-token", state: "half_open" }
    ]);
  });
});
