import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  getDatabaseCircuitBreaker,
  resetDatabaseCircuitBreakerForTests
} from "../src/lib/database/circuit-breaker";
import {
  acquireWorkClassSlot,
  resetWorkClassGatesForTests
} from "../src/lib/database/work-class";
import { withTenant } from "../src/lib/database/tenant-context";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";

/**
 * `withTenant` only ever calls `sql.begin(fn)` and, inside it,
 * `tx.unsafe(...)` to set the tenant GUC — a fake that implements just
 * those two calls is enough to exercise the catch-block logic without a
 * real Postgres connection (Issue #599: business-logic errors thrown by
 * `fn` must not trip the shared circuit breaker).
 */
function fakeSql(): Bun.SQL {
  const fakeTx = { unsafe: async () => [] } as unknown as Bun.TransactionSQL;

  return {
    begin: async (callback: (tx: Bun.TransactionSQL) => Promise<unknown>) =>
      callback(fakeTx)
  } as unknown as Bun.SQL;
}

describe("withTenant circuit breaker (Issue #599, extended by Issue #601)", () => {
  beforeEach(() => {
    resetDatabaseCircuitBreakerForTests();
    resetWorkClassGatesForTests();
  });

  afterEach(() => {
    resetDatabaseCircuitBreakerForTests();
    resetWorkClassGatesForTests();
  });

  test("a Postgres integrity constraint violation (23xxx) does not trip the breaker", async () => {
    const sql = fakeSql();
    const violation = new Bun.SQL.PostgresError("duplicate key value", {
      code: "23505",
      errno: "23505"
    });

    for (let i = 0; i < 10; i++) {
      await expect(
        withTenant(sql, TENANT_ID, async () => {
          throw violation;
        })
      ).rejects.toBe(violation);
    }

    const breaker = getDatabaseCircuitBreaker();

    expect(breaker.canAttempt(new Date())).toBe(true);
  });

  test("a foreign-key violation (23503) does not trip the breaker", async () => {
    const sql = fakeSql();
    const violation = new Bun.SQL.PostgresError(
      "violates foreign key constraint",
      {
        code: "23503",
        errno: "23503"
      }
    );

    for (let i = 0; i < 10; i++) {
      await expect(
        withTenant(sql, TENANT_ID, async () => {
          throw violation;
        })
      ).rejects.toBe(violation);
    }

    expect(getDatabaseCircuitBreaker().canAttempt(new Date())).toBe(true);
  });

  test("a data exception (22P02 invalid_text_representation) does not trip the breaker", async () => {
    const sql = fakeSql();
    const violation = new Bun.SQL.PostgresError(
      "invalid input syntax for type uuid",
      {
        code: "22P02",
        errno: "22P02"
      }
    );

    for (let i = 0; i < 10; i++) {
      await expect(
        withTenant(sql, TENANT_ID, async () => {
          throw violation;
        })
      ).rejects.toBe(violation);
    }

    expect(getDatabaseCircuitBreaker().canAttempt(new Date())).toBe(true);
  });

  test("a numeric data exception (22003 numeric_value_out_of_range) does not trip the breaker", async () => {
    const sql = fakeSql();
    const violation = new Bun.SQL.PostgresError("numeric field overflow", {
      code: "22003",
      errno: "22003"
    });

    for (let i = 0; i < 10; i++) {
      await expect(
        withTenant(sql, TENANT_ID, async () => {
          throw violation;
        })
      ).rejects.toBe(violation);
    }

    expect(getDatabaseCircuitBreaker().canAttempt(new Date())).toBe(true);
  });

  test("a genuine Postgres infra error (e.g. connection failure, 08xxx) still trips the breaker", async () => {
    const sql = fakeSql();
    const connectionError = new Bun.SQL.PostgresError("connection failure", {
      code: "08006",
      errno: "08006"
    });

    // Default failure threshold is 5 consecutive failures (circuit-breaker.ts).
    for (let i = 0; i < 5; i++) {
      await expect(
        withTenant(sql, TENANT_ID, async () => {
          throw connectionError;
        })
      ).rejects.toBe(connectionError);
    }

    expect(getDatabaseCircuitBreaker().canAttempt(new Date())).toBe(false);
  });

  test("a non-Postgres error still trips the breaker (existing behavior preserved)", async () => {
    const sql = fakeSql();
    const genericError = new Error("unexpected failure");

    for (let i = 0; i < 5; i++) {
      await expect(
        withTenant(sql, TENANT_ID, async () => {
          throw genericError;
        })
      ).rejects.toBe(genericError);
    }

    expect(getDatabaseCircuitBreaker().canAttempt(new Date())).toBe(false);
  });

  test("a success still resets recorded state (no regression)", async () => {
    const sql = fakeSql();

    const result = await withTenant(sql, TENANT_ID, async () => "ok");

    expect(result).toBe("ok");
    expect(getDatabaseCircuitBreaker().canAttempt(new Date())).toBe(true);
  });

  test("an excluded integrity violation logs the SQLSTATE for observability, without recording a breaker failure", async () => {
    const sql = fakeSql();
    const violation = new Bun.SQL.PostgresError("duplicate key value", {
      code: "23505",
      errno: "23505"
    });

    const originalConsoleLog = console.log;
    const logLines: string[] = [];
    console.log = (line: string) => {
      logLines.push(line);
    };

    try {
      await expect(
        withTenant(sql, TENANT_ID, async () => {
          throw violation;
        })
      ).rejects.toBe(violation);
    } finally {
      console.log = originalConsoleLog;
    }

    const entry = logLines
      .map((line) => JSON.parse(line))
      .find(
        (parsed) => parsed.message === "database.client_input_error_excluded"
      );

    expect(entry).toBeDefined();
    expect(entry.sqlstate).toBe("23505");
    expect(entry.tenantId).toBe(TENANT_ID);
  });
});

// Issue #743 — every 503 DATABASE_BUSY withTenant can return now carries a
// Retry-After header ("controlled 503 instead of cascading timeouts").
describe("withTenant graceful saturation and Retry-After (Issue #743)", () => {
  beforeEach(() => {
    resetDatabaseCircuitBreakerForTests();
    resetWorkClassGatesForTests();
  });

  afterEach(() => {
    resetDatabaseCircuitBreakerForTests();
    resetWorkClassGatesForTests();
  });

  test("circuit-open early return is 503 DATABASE_BUSY with Retry-After: 30", async () => {
    const sql = fakeSql();
    const genericError = new Error("boom");

    for (let i = 0; i < 5; i++) {
      await expect(
        withTenant(sql, TENANT_ID, async () => {
          throw genericError;
        })
      ).rejects.toBe(genericError);
    }

    expect(getDatabaseCircuitBreaker().canAttempt(new Date())).toBe(false);

    const response = await withTenant<Response>(
      sql,
      TENANT_ID,
      async () => new Response("should never run")
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");

    const body = (await response.json()) as {
      error: { code: string };
    };
    expect(body.error.code).toBe("DATABASE_BUSY");
  });

  test("a bounded-queue rejection (WorkClassQueueFullError) is 503 DATABASE_BUSY with Retry-After: 2 and logs database.pool.rejected", async () => {
    const sql = fakeSql();
    // "maintenance": max 1, default maxQueueDepth 4 — fill active (1) + queue (4).
    const active = await acquireWorkClassSlot("maintenance", 5_000);
    const queued = [
      acquireWorkClassSlot("maintenance", 5_000),
      acquireWorkClassSlot("maintenance", 5_000),
      acquireWorkClassSlot("maintenance", 5_000),
      acquireWorkClassSlot("maintenance", 5_000)
    ];
    await Promise.resolve();

    const originalConsoleLog = console.log;
    const logLines: string[] = [];
    console.log = (line: string) => {
      logLines.push(line);
    };

    let response: Response;
    try {
      response = await withTenant<Response>(
        sql,
        TENANT_ID,
        async () => new Response("should never run"),
        { workClass: "maintenance" }
      );
    } finally {
      console.log = originalConsoleLog;
    }

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("2");

    const entry = logLines
      .map((line) => JSON.parse(line))
      .find((parsed) => parsed.message === "database.pool.rejected");
    expect(entry).toBeDefined();
    expect(entry.workClass).toBe("maintenance");

    active.release();
    for (const promise of queued) {
      (await promise).release();
    }
  });

  test("a work-class timeout (WorkClassTimeoutError) is 503 DATABASE_BUSY with Retry-After: 2 and logs database.pool.saturated", async () => {
    const sql = fakeSql();
    const active = await acquireWorkClassSlot("maintenance", 5_000);

    const response = await withTenant<Response>(
      sql,
      TENANT_ID,
      async () => new Response("should never run"),
      { workClass: "maintenance", queueTimeoutMs: 20 }
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("2");

    active.release();
  });
});
