/**
 * A pool refusal is not a value. This file pins the split between the two
 * forms, and then reproduces the defect that made the split necessary.
 *
 * ## The defect, in the smallest form that still shows it
 *
 * `purgeExpiredAuditEvents` is declared `Promise<PurgeAuditEventsResult>` with
 * a numeric `purgedCount`. Under the old `withTenant<T>(...): Promise<T>` the
 * `maintenance` class — which has exactly ONE slot — could return a `503`
 * `Response`, cast to `number` by an `as T` the compiler was instructed not to
 * question.
 *
 * `runBoundedBatches` then loops "until a pass returns `count: 0`". A
 * `Response` is never `=== 0`, so the loop ran its full `maxPasses` (50) per
 * tenant against a database that had just refused — a job whose entire purpose
 * is to back off amplifying load instead — and `totalCount += result.count`
 * turned the total into the STRING `"0[object Response]…"`, because `number +
 * Response` is concatenation. The run then reported success.
 *
 * The two tests at the bottom assert the numbers that make that concrete: ONE
 * attempt, not fifty, and a thrown `DatabaseBusyError` rather than a result
 * object. Both fail if `purgeExpiredAuditEvents` is moved back to `withTenant`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  getDatabaseCircuitBreaker,
  resetDatabaseCircuitBreakerForTests
} from "../src/lib/database/circuit-breaker";
import { resetWorkClassGatesForTests } from "../src/lib/database/work-class";
import {
  DatabaseBusyError,
  withTenant,
  withTenantOrThrow
} from "../src/lib/database/tenant-context";
import { runBoundedBatches } from "../src/lib/jobs/batching";
import { classifyError } from "../src/lib/jobs/retry-classification";
import { purgeExpiredAuditEvents } from "../src/modules/logging/application/audit-purge";
import type { LegalHoldGuardPort } from "../src/modules/_shared/ports/legal-hold-guard-port";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";

/** Same shape as `tenant-context-circuit-breaker.test.ts` — `begin` + `unsafe` is all the primitive touches. */
function fakeSql(): Bun.SQL {
  const fakeTx = { unsafe: async () => [] } as unknown as Bun.TransactionSQL;

  return {
    begin: async (callback: (tx: Bun.TransactionSQL) => Promise<unknown>) =>
      callback(fakeTx)
  } as unknown as Bun.SQL;
}

/** Drives the breaker to open without touching a database. */
async function openTheBreaker(sql: Bun.SQL): Promise<void> {
  const boom = new Error("boom");

  for (let i = 0; i < 5; i += 1) {
    await withTenantOrThrow(sql, TENANT_ID, async () => {
      throw boom;
    }).catch(() => undefined);
  }

  expect(getDatabaseCircuitBreaker().canAttempt(new Date())).toBe(false);
}

const neverHeld: LegalHoldGuardPort = {
  isDescriptorHeld: async () => false
};

describe("the two forms of a refusal", () => {
  beforeEach(() => {
    resetDatabaseCircuitBreakerForTests();
    resetWorkClassGatesForTests();
  });

  afterEach(() => {
    resetDatabaseCircuitBreakerForTests();
    resetWorkClassGatesForTests();
  });

  test("withTenantOrThrow throws DatabaseBusyError instead of returning one", async () => {
    const sql = fakeSql();
    await openTheBreaker(sql);

    let ran = false;
    const error = await withTenantOrThrow(sql, TENANT_ID, async () => {
      ran = true;
      return 42;
    }).catch((caught: unknown) => caught);

    // The callback must not have run — this is a refusal, not a failed attempt.
    expect(ran).toBe(false);
    expect(error).toBeInstanceOf(DatabaseBusyError);
    expect((error as DatabaseBusyError).code).toBe("DATABASE_BUSY");
    expect((error as DatabaseBusyError).retryAfterSeconds).toBe(30);
  });

  test("withTenant still answers with the 503 — the request path is unchanged", async () => {
    const sql = fakeSql();
    await openTheBreaker(sql);

    const response = await withTenant(
      sql,
      TENANT_ID,
      async () => new Response("should never run")
    );

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(503);
    expect((response as Response).headers.get("Retry-After")).toBe("30");
  });

  test("the thrown error carries the SAME response, so the two cannot drift", async () => {
    const sql = fakeSql();
    await openTheBreaker(sql);

    const error = (await withTenantOrThrow(sql, TENANT_ID, async () => 1).catch(
      (caught: unknown) => caught
    )) as DatabaseBusyError;
    const direct = (await withTenant(
      sql,
      TENANT_ID,
      async () => new Response("x")
    )) as Response;

    expect(error.response.status).toBe(direct.status);
    expect(error.response.headers.get("Retry-After")).toBe(
      direct.headers.get("Retry-After")
    );
    expect(await error.response.json()).toEqual(await direct.json());
  });

  test("a job runner classifies it as retryable, not `unknown`", () => {
    // `unknown` is what an operator reads as "we have no rule for this yet".
    // A database that named its own `Retry-After` is the clearest retryable
    // condition there is.
    expect(
      classifyError(
        new DatabaseBusyError("busy", "maintenance", 2, new Response(null))
      )
    ).toBe("retryable");
  });
});

describe("the purge job that the cast broke", () => {
  beforeEach(() => {
    resetDatabaseCircuitBreakerForTests();
    resetWorkClassGatesForTests();
  });

  afterEach(() => {
    resetDatabaseCircuitBreakerForTests();
    resetWorkClassGatesForTests();
  });

  test("purgeExpiredAuditEvents fails loudly instead of returning a Response as purgedCount", async () => {
    const sql = fakeSql();
    await openTheBreaker(sql);

    const outcome = await purgeExpiredAuditEvents(
      sql,
      TENANT_ID,
      neverHeld
    ).catch((caught: unknown) => caught);

    expect(outcome).toBeInstanceOf(DatabaseBusyError);
    // The old shape, spelled out so the regression is unmistakable: a result
    // object whose `purgedCount` was neither a number nor zero.
    expect(outcome).not.toHaveProperty("purgedCount");
  });

  test("a refused pass stops the batch loop at ONE attempt, not fifty", async () => {
    const sql = fakeSql();
    await openTheBreaker(sql);

    let attempts = 0;
    const outcome = await runBoundedBatches(async () => {
      attempts += 1;
      const result = await purgeExpiredAuditEvents(sql, TENANT_ID, neverHeld);
      return { count: result.purgedCount };
    }).catch((caught: unknown) => caught);

    expect(outcome).toBeInstanceOf(DatabaseBusyError);
    // The number that matters. `maxPasses` defaults to 50, and every one of
    // those passes used to be a fresh queue attempt against a database that
    // had already said no.
    expect(attempts).toBe(1);
  });
});
