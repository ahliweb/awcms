/**
 * Issue #1286 — unit tests for the budget math behind
 * `bun run database:capacity:check` (`capacity-report.ts`, the PgBouncer pool
 * count in `capacity-config.ts`, and the PgBouncer-mode client helpers). No
 * database, no network, no `process.env` mutation: every case passes its own
 * `env`.
 */
import { describe, expect, test } from "bun:test";

import {
  countDistinctPgBouncerPools,
  evaluateCapacityBudget,
  loadCapacityConfigFromEnv,
  pgBouncerBackendCeiling
} from "../src/lib/database/capacity-config";
import {
  applyLiveLimits,
  formatCapacityReport,
  readLiveLimits
} from "../src/lib/database/capacity-report";
import {
  isPgBouncerMode,
  resolveStatementTimeoutMs
} from "../src/lib/database/client";

const URL_APP = "postgres://awcms_app:s3cret@db.internal/awcms";
const URL_WORKER = "postgres://awcms_worker:s3cret@db.internal/awcms";

describe("N-instance worked example (the docs' numbers)", () => {
  const fleet = {
    DATABASE_CAPACITY_APP_INSTANCES_MIN: "10",
    DATABASE_CAPACITY_APP_INSTANCES_EXPECTED: "10",
    DATABASE_CAPACITY_APP_INSTANCES_MAX: "10",
    DATABASE_CAPACITY_WORKER_INSTANCES_EXPECTED: "1",
    DATABASE_CAPACITY_WORKER_INSTANCES_MAX: "1",
    DATABASE_URL: URL_APP,
    WORKER_DATABASE_URL: URL_WORKER
  };

  test("direct PostgreSQL: 10 x 20 + worker 20 + setup 20 exceeds max_connections 100", () => {
    const report = evaluateCapacityBudget(loadCapacityConfigFromEnv(fleet));

    expect(report.worstCase.totalConnections).toBe(240);
    expect(report.exceedsAtMax).toBe(true);
    expect(report.ok).toBe(false);
    expect(
      report.findings.some((f) => f.code === "capacity_exceeds_budget_at_max")
    ).toBe(true);
  });

  test("behind PgBouncer the same fleet fits: 240 clients <= 400, backend 20 x 2 + 5 <= 100", () => {
    const report = evaluateCapacityBudget(
      loadCapacityConfigFromEnv({
        ...fleet,
        DATABASE_PGBOUNCER: "true",
        DATABASE_CAPACITY_PGBOUNCER_MAX_CLIENT_CONN: "400"
      })
    );

    expect(report.pgBouncer.poolCount).toBe(2);
    expect(pgBouncerBackendCeiling(report.pgBouncer)).toBe(40);
    expect(report.ok).toBe(true);
  });

  test("behind PgBouncer it still fails when the clients outgrow max_client_conn", () => {
    const report = evaluateCapacityBudget(
      loadCapacityConfigFromEnv({
        ...fleet,
        DATABASE_PGBOUNCER: "true",
        DATABASE_CAPACITY_PGBOUNCER_MAX_CLIENT_CONN: "200"
      })
    );

    expect(report.exceedsAtMax).toBe(true);
    expect(report.ok).toBe(false);
  });

  test("behind PgBouncer it fails when pools x default_pool_size outgrow PostgreSQL", () => {
    const report = evaluateCapacityBudget(
      loadCapacityConfigFromEnv({
        ...fleet,
        DATABASE_PGBOUNCER: "true",
        DATABASE_CAPACITY_PGBOUNCER_MAX_CLIENT_CONN: "400",
        DATABASE_CAPACITY_PGBOUNCER_DEFAULT_POOL_SIZE: "50",
        DATABASE_CAPACITY_APPROVED_CONNECTIONS: "100"
      })
    );

    // 50 x 2 pools + 5 reserved = 105 > 100: a per-pool reading (50 + 5) would
    // have passed.
    expect(report.ok).toBe(false);
  });
});

describe("countDistinctPgBouncerPools", () => {
  const counts = loadCapacityConfigFromEnv({}).instanceCounts;

  test("one role for every class is one pool", () => {
    expect(countDistinctPgBouncerPools({ DATABASE_URL: URL_APP }, counts)).toBe(
      1
    );
  });

  test("a dedicated worker role is a second pool; no URL at all is still 1", () => {
    expect(
      countDistinctPgBouncerPools(
        { DATABASE_URL: URL_APP, WORKER_DATABASE_URL: URL_WORKER },
        counts
      )
    ).toBe(2);
    expect(countDistinctPgBouncerPools({}, counts)).toBe(1);
  });

  test("a class that cannot run (max 0) adds no pool, and an unparseable URL counts as its own", () => {
    const noWorker = loadCapacityConfigFromEnv({
      DATABASE_CAPACITY_WORKER_INSTANCES_MAX: "0",
      DATABASE_CAPACITY_WORKER_INSTANCES_EXPECTED: "0"
    }).instanceCounts;

    expect(
      countDistinctPgBouncerPools(
        { DATABASE_URL: URL_APP, WORKER_DATABASE_URL: URL_WORKER },
        noWorker
      )
    ).toBe(1);
    expect(
      countDistinctPgBouncerPools(
        { DATABASE_URL: URL_APP, WORKER_DATABASE_URL: "not a url" },
        counts
      )
    ).toBe(2);
  });

  test("DATABASE_CAPACITY_PGBOUNCER_POOL_COUNT overrides the derived value", () => {
    const config = loadCapacityConfigFromEnv({
      DATABASE_URL: URL_APP,
      DATABASE_CAPACITY_PGBOUNCER_POOL_COUNT: "4"
    });

    expect(config.pgBouncer.poolCount).toBe(4);
  });
});

describe("live limits", () => {
  test("readLiveLimits reads max_connections, adds both reserved settings, and counts sessions", async () => {
    const live = await readLiveLimits(async (query) =>
      query.includes("pg_settings")
        ? [
            { name: "max_connections", setting: "100" },
            { name: "superuser_reserved_connections", setting: "3" },
            { name: "reserved_connections", setting: "2" }
          ]
        : [{ n: 11 }]
    );

    expect(live).toEqual({
      maxConnections: 100,
      reservedConnections: 5,
      currentConnections: 11
    });
  });

  test("readLiveLimits throws instead of guessing when max_connections is missing", async () => {
    await expect(readLiveLimits(async () => [])).rejects.toThrow(
      "max_connections"
    );
  });

  test("applyLiveLimits caps the approved budget at the server ceiling, never raises it", () => {
    const config = loadCapacityConfigFromEnv({
      DATABASE_CAPACITY_APPROVED_CONNECTIONS: "150"
    });
    const capped = applyLiveLimits(config, {
      maxConnections: 100,
      reservedConnections: 3,
      currentConnections: 7
    });

    expect(capped.liveCeiling).toBe(97);
    expect(capped.config.approvedConnections).toBe(97);

    const lower = applyLiveLimits(
      loadCapacityConfigFromEnv({
        DATABASE_CAPACITY_APPROVED_CONNECTIONS: "40"
      }),
      { maxConnections: 100, reservedConnections: 3, currentConnections: 0 }
    );

    expect(lower.config.approvedConnections).toBe(40);
  });
});

describe("formatCapacityReport", () => {
  test("states the arithmetic and a clear FAIL line, and never prints a DSN", () => {
    const text = formatCapacityReport(
      evaluateCapacityBudget(
        loadCapacityConfigFromEnv({
          DATABASE_URL: URL_APP,
          DATABASE_CAPACITY_APP_INSTANCES_MAX: "10",
          DATABASE_CAPACITY_APP_INSTANCES_EXPECTED: "10"
        })
      )
    ).join("\n");

    expect(text).toContain("profile: direct PostgreSQL");
    expect(text).toContain("app 10x20=200");
    expect(text).toContain("database:capacity:check FAIL");
    expect(text).not.toContain("s3cret");
    expect(text).not.toContain("db.internal");
  });

  test("the default single-instance profile passes", () => {
    const report = evaluateCapacityBudget(loadCapacityConfigFromEnv({}));

    expect(report.ok).toBe(true);
    expect(formatCapacityReport(report).at(-1)).toContain(
      "database:capacity:check OK"
    );
  });
});

describe("PgBouncer-mode client helpers", () => {
  test("isPgBouncerMode only for the literal string true", () => {
    expect(isPgBouncerMode({ DATABASE_PGBOUNCER: "true" })).toBe(true);
    expect(isPgBouncerMode({ DATABASE_PGBOUNCER: "1" })).toBe(false);
    expect(isPgBouncerMode({})).toBe(false);
  });

  test("resolveStatementTimeoutMs keeps the 15000 default and rejects bad values", () => {
    expect(resolveStatementTimeoutMs({})).toBe(15000);
    expect(
      resolveStatementTimeoutMs({ DATABASE_STATEMENT_TIMEOUT_MS: "30000" })
    ).toBe(30000);
    expect(
      resolveStatementTimeoutMs({ DATABASE_STATEMENT_TIMEOUT_MS: "-1" })
    ).toBe(15000);
    expect(
      resolveStatementTimeoutMs({ DATABASE_STATEMENT_TIMEOUT_MS: "abc" })
    ).toBe(15000);
  });
});
