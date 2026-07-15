/**
 * Issue #743 (epic #738, platform-evolution) — unit tests for the pure
 * capacity calculator/validator (`src/lib/database/capacity-config.ts`).
 * No database, no network, no process.env mutation leaking between tests
 * (every test builds its own `env` object and passes it explicitly rather
 * than mutating `process.env`).
 */
import { describe, expect, test } from "bun:test";

import {
  computeCapacityUsage,
  evaluateCapacityBudget,
  loadCapacityConfigFromEnv,
  validateCapacityConfig,
  type CapacityConfig
} from "../src/lib/database/capacity-config";
import { resolvePoolMaxForKind } from "../src/lib/database/client";

function baseConfig(overrides: Partial<CapacityConfig> = {}): CapacityConfig {
  return {
    instanceCounts: {
      app: { min: 1, expected: 1, max: 1 },
      worker: { min: 0, expected: 1, max: 1 },
      setup: { min: 0, expected: 0, max: 1 }
    },
    poolMax: { app: 20, worker: 20, setup: 20 },
    pgBouncer: {
      enabled: false,
      maxClientConnections: 200,
      defaultPoolSize: 20
    },
    approvedConnections: 100,
    reservedAdminHeadroom: 5,
    ...overrides
  };
}

describe("loadCapacityConfigFromEnv", () => {
  test("returns the single-instance offline/LAN defaults when no env var is set", () => {
    const config = loadCapacityConfigFromEnv({});

    expect(config.instanceCounts.app).toEqual({ min: 1, expected: 1, max: 1 });
    expect(config.instanceCounts.worker).toEqual({
      min: 0,
      expected: 1,
      max: 1
    });
    expect(config.instanceCounts.setup).toEqual({
      min: 0,
      expected: 0,
      max: 1
    });
    expect(config.poolMax).toEqual({ app: 20, worker: 20, setup: 20 });
    expect(config.pgBouncer.enabled).toBe(false);
    expect(config.approvedConnections).toBe(100);
    expect(config.reservedAdminHeadroom).toBe(5);
  });

  test("reads explicit instance-count overrides", () => {
    const config = loadCapacityConfigFromEnv({
      DATABASE_CAPACITY_APP_INSTANCES_MIN: "2",
      DATABASE_CAPACITY_APP_INSTANCES_EXPECTED: "4",
      DATABASE_CAPACITY_APP_INSTANCES_MAX: "10"
    });

    expect(config.instanceCounts.app).toEqual({ min: 2, expected: 4, max: 10 });
  });

  test("falls back to the default on a malformed integer (never throws)", () => {
    const config = loadCapacityConfigFromEnv({
      DATABASE_CAPACITY_APP_INSTANCES_MAX: "not-a-number"
    });

    expect(config.instanceCounts.app.max).toBe(1);
  });

  test("falls back to the default on a non-integer decimal", () => {
    const config = loadCapacityConfigFromEnv({
      DATABASE_CAPACITY_APPROVED_CONNECTIONS: "12.5"
    });

    expect(config.approvedConnections).toBe(100);
  });

  test("falls back to the default when out of the sane bound range", () => {
    const config = loadCapacityConfigFromEnv({
      DATABASE_CAPACITY_APP_INSTANCES_MAX: "-1"
    });

    expect(config.instanceCounts.app.max).toBe(1);
  });

  test("reads PgBouncer capacity only meaningfully alongside DATABASE_PGBOUNCER=true", () => {
    const config = loadCapacityConfigFromEnv({
      DATABASE_PGBOUNCER: "true",
      DATABASE_CAPACITY_PGBOUNCER_MAX_CLIENT_CONN: "500",
      DATABASE_CAPACITY_PGBOUNCER_DEFAULT_POOL_SIZE: "30"
    });

    expect(config.pgBouncer).toEqual({
      enabled: true,
      maxClientConnections: 500,
      defaultPoolSize: 30
    });
  });

  test("worker/setup pool max fall back to DATABASE_POOL_MAX (same as the pre-#743 client.ts behavior)", () => {
    const config = loadCapacityConfigFromEnv({ DATABASE_POOL_MAX: "12" });

    expect(config.poolMax).toEqual({ app: 12, worker: 12, setup: 12 });
  });

  test("DATABASE_POOL_MAX_WORKER/_SETUP override independently of DATABASE_POOL_MAX", () => {
    const config = loadCapacityConfigFromEnv({
      DATABASE_POOL_MAX: "20",
      DATABASE_POOL_MAX_WORKER: "5",
      DATABASE_POOL_MAX_SETUP: "3"
    });

    expect(config.poolMax).toEqual({ app: 20, worker: 5, setup: 3 });
  });
});

describe("resolvePoolMaxForKind (client.ts, exercised via capacity-config's single source of truth)", () => {
  test("an invalid per-kind override falls through to a valid DATABASE_POOL_MAX, not straight to the hardcoded default", () => {
    const resolved = resolvePoolMaxForKind("worker", {
      DATABASE_POOL_MAX_WORKER: "not-a-number",
      DATABASE_POOL_MAX: "30"
    });

    expect(resolved).toBe(30);
  });

  test("falls all the way back to the hardcoded default when both the override and DATABASE_POOL_MAX are invalid", () => {
    const resolved = resolvePoolMaxForKind("setup", {
      DATABASE_POOL_MAX_SETUP: "0",
      DATABASE_POOL_MAX: "-5"
    });

    expect(resolved).toBe(20);
  });

  test("the app kind has no override var — always reads DATABASE_POOL_MAX directly", () => {
    expect(resolvePoolMaxForKind("app", { DATABASE_POOL_MAX: "7" })).toBe(7);
  });
});

describe("computeCapacityUsage", () => {
  test("computes sum(instance_count x pool_max) per class and in total", () => {
    const config = baseConfig({
      instanceCounts: {
        app: { min: 1, expected: 2, max: 10 },
        worker: { min: 0, expected: 1, max: 1 },
        setup: { min: 0, expected: 0, max: 1 }
      },
      poolMax: { app: 20, worker: 15, setup: 5 }
    });

    const worstCase = computeCapacityUsage(config, "max");

    expect(worstCase.perClass).toEqual([
      { processClass: "app", instanceCount: 10, poolMax: 20, connections: 200 },
      {
        processClass: "worker",
        instanceCount: 1,
        poolMax: 15,
        connections: 15
      },
      { processClass: "setup", instanceCount: 1, poolMax: 5, connections: 5 }
    ]);
    expect(worstCase.totalConnections).toBe(220);
  });

  test("the 'expected' scenario uses each class's expected instance count, not max", () => {
    const config = baseConfig({
      instanceCounts: {
        app: { min: 1, expected: 2, max: 10 },
        worker: { min: 0, expected: 1, max: 1 },
        setup: { min: 0, expected: 0, max: 1 }
      }
    });

    const expected = computeCapacityUsage(config, "expected");

    expect(expected.totalConnections).toBe(2 * 20 + 1 * 20 + 0 * 20);
  });
});

describe("validateCapacityConfig — invalid/inconsistent config", () => {
  test("passes cleanly on the single-instance default (one WARNING about work-class oversubscription, no FAIL)", () => {
    const findings = validateCapacityConfig(baseConfig());

    expect(findings.filter((f) => f.severity === "fail")).toEqual([]);
    expect(
      findings.some((f) => f.code === "work_class_oversubscribes_app_pool")
    ).toBe(true);
  });

  test("fails when min > expected", () => {
    const config = baseConfig({
      instanceCounts: {
        app: { min: 5, expected: 2, max: 10 },
        worker: { min: 0, expected: 1, max: 1 },
        setup: { min: 0, expected: 0, max: 1 }
      }
    });

    const findings = validateCapacityConfig(config);

    expect(
      findings.some(
        (f) => f.severity === "fail" && f.code === "instance_count_order:app"
      )
    ).toBe(true);
  });

  test("fails when expected > max", () => {
    const config = baseConfig({
      instanceCounts: {
        app: { min: 1, expected: 20, max: 10 },
        worker: { min: 0, expected: 1, max: 1 },
        setup: { min: 0, expected: 0, max: 1 }
      }
    });

    const findings = validateCapacityConfig(config);

    expect(
      findings.some(
        (f) => f.severity === "fail" && f.code === "instance_count_order:app"
      )
    ).toBe(true);
  });

  test("fails when a pool max is zero or negative", () => {
    const config = baseConfig({ poolMax: { app: 0, worker: 20, setup: 20 } });

    const findings = validateCapacityConfig(config);

    expect(
      findings.some(
        (f) => f.severity === "fail" && f.code === "pool_max_invalid:app"
      )
    ).toBe(true);
  });

  test("fails when reserved admin headroom consumes the entire approved budget", () => {
    const config = baseConfig({
      approvedConnections: 10,
      reservedAdminHeadroom: 10
    });

    const findings = validateCapacityConfig(config);

    expect(
      findings.some(
        (f) =>
          f.severity === "fail" && f.code === "reserved_headroom_exceeds_budget"
      )
    ).toBe(true);
  });

  test("fails when reserved admin headroom exceeds the approved budget", () => {
    const config = baseConfig({
      approvedConnections: 10,
      reservedAdminHeadroom: 11
    });

    const findings = validateCapacityConfig(config);

    expect(
      findings.some(
        (f) =>
          f.severity === "fail" && f.code === "reserved_headroom_exceeds_budget"
      )
    ).toBe(true);
  });

  test("fails when PgBouncer default_pool_size exceeds max_client_conn (internally inconsistent PgBouncer profile)", () => {
    const config = baseConfig({
      pgBouncer: {
        enabled: true,
        maxClientConnections: 50,
        defaultPoolSize: 100
      }
    });

    const findings = validateCapacityConfig(config);

    expect(
      findings.some(
        (f) =>
          f.severity === "fail" &&
          f.code === "pgbouncer_pool_exceeds_client_conn"
      )
    ).toBe(true);
  });

  test("an inconsistent PgBouncer profile does NOT fail when PgBouncer is disabled (profile is simply unused)", () => {
    const config = baseConfig({
      pgBouncer: {
        enabled: false,
        maxClientConnections: 50,
        defaultPoolSize: 100
      }
    });

    const findings = validateCapacityConfig(config);

    expect(
      findings.some((f) => f.code === "pgbouncer_pool_exceeds_client_conn")
    ).toBe(false);
  });
});

describe("evaluateCapacityBudget — the issue's own connection-storm example", () => {
  test("10 instances x pool_max 20 vs. an approved budget of 80 FAILS (matches the issue body's example)", () => {
    const config = baseConfig({
      instanceCounts: {
        app: { min: 1, expected: 10, max: 10 },
        worker: { min: 0, expected: 0, max: 0 },
        setup: { min: 0, expected: 0, max: 0 }
      },
      poolMax: { app: 20, worker: 20, setup: 20 },
      approvedConnections: 80,
      reservedAdminHeadroom: 0
    });

    const report = evaluateCapacityBudget(config);

    expect(report.worstCase.totalConnections).toBe(200);
    expect(report.exceedsAtMax).toBe(true);
    expect(report.ok).toBe(false);
    expect(
      report.findings.some((f) => f.code === "capacity_exceeds_budget_at_max")
    ).toBe(true);
  });

  test("boundary: exactly at budget (sum + reserved == approved) PASSES", () => {
    const config = baseConfig({
      instanceCounts: {
        app: { min: 1, expected: 1, max: 1 },
        worker: { min: 0, expected: 0, max: 0 },
        setup: { min: 0, expected: 0, max: 0 }
      },
      poolMax: { app: 95, worker: 20, setup: 20 },
      approvedConnections: 100,
      reservedAdminHeadroom: 5
    });

    const report = evaluateCapacityBudget(config);

    expect(report.worstCase.totalConnections).toBe(95);
    expect(report.availableForRuntime).toBe(95);
    expect(report.exceedsAtMax).toBe(false);
    expect(report.ok).toBe(true);
  });

  test("boundary: one connection over budget FAILS", () => {
    const config = baseConfig({
      instanceCounts: {
        app: { min: 1, expected: 1, max: 1 },
        worker: { min: 0, expected: 0, max: 0 },
        setup: { min: 0, expected: 0, max: 0 }
      },
      poolMax: { app: 96, worker: 20, setup: 20 },
      approvedConnections: 100,
      reservedAdminHeadroom: 5
    });

    const report = evaluateCapacityBudget(config);

    expect(report.exceedsAtMax).toBe(true);
    expect(report.ok).toBe(false);
  });

  test("exceeding only at 'max' (not 'expected') still fails ok — the gate uses the worst case", () => {
    const config = baseConfig({
      instanceCounts: {
        app: { min: 1, expected: 1, max: 10 },
        worker: { min: 0, expected: 0, max: 0 },
        setup: { min: 0, expected: 0, max: 0 }
      },
      poolMax: { app: 20, worker: 20, setup: 20 },
      approvedConnections: 50,
      reservedAdminHeadroom: 0
    });

    const report = evaluateCapacityBudget(config);

    expect(report.exceedsAtExpected).toBe(false); // 1 x 20 = 20 <= 50
    expect(report.exceedsAtMax).toBe(true); // 10 x 20 = 200 > 50
    expect(report.ok).toBe(false);
  });

  describe("PgBouncer-aware profile", () => {
    test("app-side check: instance x pool_max must fit max_client_conn even when the PostgreSQL-side budget is generous", () => {
      const config = baseConfig({
        instanceCounts: {
          app: { min: 1, expected: 1, max: 20 },
          worker: { min: 0, expected: 0, max: 0 },
          setup: { min: 0, expected: 0, max: 0 }
        },
        poolMax: { app: 20, worker: 20, setup: 20 },
        pgBouncer: {
          enabled: true,
          maxClientConnections: 100,
          defaultPoolSize: 20
        },
        approvedConnections: 1000,
        reservedAdminHeadroom: 5
      });

      const report = evaluateCapacityBudget(config);

      // 20 instances x 20 pool_max = 400 app-side connections > max_client_conn (100).
      expect(report.worstCase.totalConnections).toBe(400);
      expect(report.exceedsAtMax).toBe(true);
      expect(report.ok).toBe(false);
    });

    test("server-side check: PgBouncer's own backend pool + reserved headroom must fit the approved PostgreSQL budget, independent of app-side instance count", () => {
      const config = baseConfig({
        instanceCounts: {
          app: { min: 1, expected: 1, max: 5 },
          worker: { min: 0, expected: 0, max: 0 },
          setup: { min: 0, expected: 0, max: 0 }
        },
        poolMax: { app: 20, worker: 20, setup: 20 },
        // Plenty of app-side headroom (max_client_conn is huge)...
        pgBouncer: {
          enabled: true,
          maxClientConnections: 10_000,
          defaultPoolSize: 90
        },
        // ...but PgBouncer's OWN backend pool (90) + reserved (15) exceeds the
        // approved PostgreSQL budget (100).
        approvedConnections: 100,
        reservedAdminHeadroom: 15
      });

      const report = evaluateCapacityBudget(config);

      expect(report.exceedsAtMax).toBe(true);
      expect(report.ok).toBe(false);
    });

    test("a well-sized PgBouncer profile passes both checks", () => {
      const config = baseConfig({
        instanceCounts: {
          app: { min: 1, expected: 1, max: 5 },
          worker: { min: 0, expected: 0, max: 0 },
          setup: { min: 0, expected: 0, max: 0 }
        },
        poolMax: { app: 20, worker: 20, setup: 20 },
        pgBouncer: {
          enabled: true,
          maxClientConnections: 200,
          defaultPoolSize: 20
        },
        approvedConnections: 100,
        reservedAdminHeadroom: 5
      });

      const report = evaluateCapacityBudget(config);

      // App-side: 5 x 20 = 100 <= 200 (max_client_conn). OK.
      // Server-side: 20 + 5 = 25 <= 100 (approved). OK.
      expect(report.exceedsAtMax).toBe(false);
      expect(report.ok).toBe(true);
    });
  });
});

describe("evaluateCapacityBudget — default env (no vars set) reproduces the pre-#743 single-instance offline/LAN topology", () => {
  test("passes with zero DATABASE_CAPACITY_* env vars set", () => {
    const report = evaluateCapacityBudget(loadCapacityConfigFromEnv({}));

    expect(report.ok).toBe(true);
    expect(report.exceedsAtMax).toBe(false);
  });
});
