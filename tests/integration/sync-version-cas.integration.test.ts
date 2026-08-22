/**
 * Findings C3 and C4 of the 17 August 2026 audit round — two writers that could
 * not see each other.
 *
 * Both are properties of PostgreSQL's READ COMMITTED semantics, so neither can
 * be written against a fake `Bun.SQL`: a stubbed driver would let the losing
 * writer "win" and prove nothing. C4's half lives in
 * `tests/reporting-projection-rebuild-lock.test.ts`, beside the incremental
 * worker's other real-database tests; what is here is C3.
 *
 * ## The race is made deterministic, not slept through
 *
 * Two real transactions on two connections, interleaved by ordering their
 * statements rather than by timing:
 *
 *   A: BEGIN, read version 5
 *   B: BEGIN, read version 5, CAS 5→6, COMMIT
 *   A: CAS 5→6  — blocks on B's row lock, then finds 6, matches nothing
 *
 * That is exactly the sequence the audit describes, with no sleep and nothing
 * that can pass by accident on a fast machine.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import {
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { advanceAggregateVersion } from "../../src/modules/sync-storage/application/aggregate-version-store";

const suite = integrationEnabled ? describe : describe.skip;

const TENANT = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
const AGGREGATE_TYPE = "invoice";
const AGGREGATE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

async function currentVersion(): Promise<number | null> {
  const rows = (await getAdminSql()`
    SELECT current_version FROM awcms_sync_aggregate_versions
    WHERE tenant_id = ${TENANT} AND aggregate_id = ${AGGREGATE_ID}
  `) as { current_version: string | number }[];

  return rows[0] ? Number(rows[0].current_version) : null;
}

function advance(expected: number): Promise<boolean> {
  return withTenantOrThrow(
    getRuntimeSql(),
    TENANT,
    (tx) =>
      advanceAggregateVersion(
        tx,
        TENANT,
        AGGREGATE_TYPE,
        AGGREGATE_ID,
        expected
      ),
    { workClass: "background_sync" }
  );
}

suite("sync aggregate version is a compare-and-set (C3)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await getAdminSql()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
      VALUES (${TENANT}, 'c3-sync', 'C3 Sync', 'active')
    `;
  });

  test("the first event creates the row at version 1", async () => {
    // NON-VACUOUS baseline. A CAS that always failed would satisfy every
    // refusal assertion below.
    expect(await advance(0)).toBe(true);
    expect(await currentVersion()).toBe(1);
  });

  test("a sequential advance from the version it just wrote succeeds", async () => {
    await advance(0);

    expect(await advance(1)).toBe(true);
    expect(await currentVersion()).toBe(2);
  });

  test("an advance from a STALE version is refused and changes nothing", async () => {
    await advance(0);
    await advance(1); // now at 2

    // A batch that read 1 before the previous write landed.
    expect(await advance(1)).toBe(false);
    expect(await currentVersion()).toBe(2);
  });

  test("two concurrent batches that both read 5: one wins, one is refused, no increment is lost", async () => {
    // The finding, exactly. Before the CAS both wrote the literal 6 — two
    // conflicting events accepted, zero conflict rows, one increment lost.
    await getAdminSql()`
      INSERT INTO awcms_sync_aggregate_versions
        (tenant_id, aggregate_type, aggregate_id, current_version)
      VALUES (${TENANT}, ${AGGREGATE_TYPE}, ${AGGREGATE_ID}, 5)
    `;

    const sql = getRuntimeSql();

    // TWO handshakes, in both directions, and both are needed. Awaiting only
    // B before releasing A is not enough: `withTenantOrThrow` returns a promise
    // whose first statement has not necessarily run yet, so B could commit
    // before A's read and A would read 6 — which fails this test for the wrong
    // reason, one run in five. Nothing here sleeps.
    let aHasRead: () => void = () => {};
    let releaseA: () => void = () => {};
    const aRead = new Promise<void>((resolve) => {
      aHasRead = resolve;
    });
    const bCommitted = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    let aSaw = -1;

    const a = withTenantOrThrow(
      sql,
      TENANT,
      async (tx) => {
        const rows = (await tx`
          SELECT current_version FROM awcms_sync_aggregate_versions
          WHERE tenant_id = ${TENANT} AND aggregate_id = ${AGGREGATE_ID}
        `) as { current_version: string | number }[];

        aSaw = Number(rows[0]!.current_version);
        aHasRead();

        await bCommitted;

        return advanceAggregateVersion(
          tx,
          TENANT,
          AGGREGATE_TYPE,
          AGGREGATE_ID,
          5
        );
      },
      { workClass: "background_sync" }
    );

    await aRead;
    const bWon = await advance(5);
    releaseA();
    const aWon = await a;

    // A really did decide on 5 — the premise of the race, asserted rather than
    // assumed. Asserted OUT here so a mismatch reports as a failed expectation
    // rather than as a rejected transaction with A's connection still parked.
    expect(aSaw).toBe(5);

    expect(bWon).toBe(true);
    // The whole point: A read 5, decided there was no conflict, and is still
    // refused — because the decision is re-checked by the write that acts on it.
    expect(aWon).toBe(false);

    // ONE increment, not two collapsed into one.
    expect(await currentVersion()).toBe(6);
  });

  test("two concurrent CREATES of the same aggregate: the second is refused, not overwritten", async () => {
    // The case `SELECT … FOR UPDATE` could not have covered: there is no row to
    // lock, so both batches would proceed and the loser's `ON CONFLICT` would
    // overwrite. The CAS predicate covers it because the loser expects 0 and
    // finds 1.
    const first = await advance(0);
    const second = await advance(0);

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(await currentVersion()).toBe(1);
  });

  test("the CAS predicate is qualified, or every accepted event would become a conflict", async () => {
    // Inside `ON CONFLICT DO UPDATE`, an unqualified column name refers to the
    // row being PROPOSED. `current_version = ${expected}` unqualified would
    // compare `expected + 1` against `expected` — false always — so this test
    // exists to catch that specific edit, which is silent and looks harmless.
    const source = await Bun.file(
      "src/modules/sync-storage/application/aggregate-version-store.ts"
    ).text();

    expect(source).toContain(
      "WHERE awcms_sync_aggregate_versions.current_version ="
    );
  });
});
