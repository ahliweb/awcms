/**
 * `booking` allocation under real concurrency (Issue #939, ADR-0131;
 * docs/awcms/booking.md section 8.3, tests T2, T3, T6, T7 and the DO NOTHING
 * interleaving T3 depends on).
 *
 * The exclusion constraint is the guarantee; this file proves the ALLOCATOR on
 * top of it is correct when transactions genuinely overlap:
 *
 *   * N parallel claims for the last unit: exactly one wins, no double
 *     allocation, every loser is `SLOT_UNAVAILABLE` and wrote nothing;
 *   * capacity N and all-or-none for several units, with no partial claim left
 *     behind;
 *   * `ON CONFLICT DO NOTHING` WAITS for an in-doubt concurrent row, then skips
 *     it (commit) or takes the unit (rollback) -- the behaviour the allocator is
 *     built on, observed through `pg_stat_activity`, not assumed;
 *   * an elapsed hold never blocks a claim, with the reaper stopped (lazy
 *     reclaim), including when many claimers and the reaper race for it;
 *   * the reaper never waits on a locked hold, and expires each hold once;
 *   * the live-hold caps hold under concurrency (a SUM, not a non-overlap);
 *   * T7: the same race against a schema WITHOUT the exclusion constraint DOES
 *     double-allocate, so the assertions above are not vacuous.
 *
 * Runs as the runtime role `awcms_app` (FORCE RLS in effect), each contender on
 * its own pooled connection and its own transaction (`createRuntimePool`; the
 * shared runtime pool holds four connections and would serialise a race of
 * twenty). Time is driven by the database clock: an hold is backdated through
 * SQL, never by sleeping.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
 */
import { NO_OP_STAFF_AVAILABILITY } from "../../src/modules/booking/domain/booking-staff-availability";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  assertRejected as assertRejectedByDatabase,
  createRuntimePool,
  getAdminSql,
  getWorkerRoleSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import {
  countDueHolds,
  expireDueHolds,
  reclaimExpiredHolds,
  type ExpiryOutcome
} from "../../src/modules/booking/application/booking-hold-expiry";
import {
  placeHold,
  type PlaceHoldOutcome
} from "../../src/modules/booking/application/booking-hold-service";
import { runBookingHoldExpiry } from "../../src/modules/booking/application/booking-hold-expiry-job";
import { runReconciliation } from "../../src/modules/booking/application/booking-reconciliation";
import type { PlaceHoldInput } from "../../src/modules/booking/domain/booking-allocation";

const TENANT_A = "b9390000-0000-4000-8000-00000000000a";
const TENANT_B = "b9390000-0000-4000-8000-00000000000b";
const START = Date.parse("2026-11-01T03:00:00Z");
const ACTORS = new Map<string, string>();

let pool: Bun.SQL;
let sequence = 0;

/** The production transaction shape (`withTenant`) without the in-process work-class gate, so the DATABASE sees every contender at once. */
function tenantTx<T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return pool.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
    return fn(tx);
  });
}

/**
 * The scheduled job's transaction shape: the BACKGROUND role `awcms_worker`
 * under a per-tenant context. The reaper runs here, and only here.
 */
function workerTx<T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return getWorkerRoleSql().begin(async (tx) => {
    await tx.unsafe(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
    return fn(tx);
  });
}

function place(
  tenantId: string,
  input: PlaceHoldInput
): Promise<PlaceHoldOutcome> {
  return tenantTx(tenantId, (tx) =>
    placeHold(
      tx,
      {
        tenantId,
        staff: NO_OP_STAFF_AVAILABILITY,
        actorTenantUserId: ACTORS.get(tenantId) ?? null,
        correlationId: crypto.randomUUID()
      },
      input
    )
  );
}

async function seedTenant(tenantId: string, code: string): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${tenantId}, ${code}, ${`Booking ${code}`})
  `;

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`Actor ${code}`})
    RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${code}@example.com`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const user = (await admin`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id})
    RETURNING id
  `) as { id: string }[];

  ACTORS.set(tenantId, user[0]!.id);
}

type Fixture = {
  resourceId: string;
  unitIds: string[];
  offeringId: string;
};

type FixtureOptions = {
  capacity?: number;
  setup?: number;
  cleanup?: number;
  confirmation?: "immediate" | "hold_then_confirm";
  sortOrder?: number;
  poolId?: string | null;
  maxParty?: number;
  mode?: "slot" | "stay";
};

/** A slot resource with `capacity` units and a 60-minute offering. Fresh codes, so tests share a tenant without truncating. */
async function newFixture(
  tenantId: string,
  options: FixtureOptions = {}
): Promise<Fixture> {
  const admin = getAdminSql();
  sequence += 1;
  const code = `f${sequence}`;
  const capacity = options.capacity ?? 1;
  const mode = options.mode ?? "slot";
  const resource = (await admin`
    INSERT INTO awcms_booking_resources
      (tenant_id, code, name, kind, capacity, timezone, sort_order, pool_id,
       booking_mode, stay_check_in_time, stay_check_out_time)
    VALUES (${tenantId}, ${code}, ${`Room ${code}`}, 'room', ${capacity},
            'Asia/Pontianak', ${options.sortOrder ?? 0}, ${options.poolId ?? null},
            ${mode},
            ${mode === "stay" ? "14:00" : null}::time,
            ${mode === "stay" ? "12:00" : null}::time)
    RETURNING id
  `) as { id: string }[];
  const unitIds: string[] = [];

  for (let ordinal = 1; ordinal <= capacity; ordinal += 1) {
    const unit = (await admin`
      INSERT INTO awcms_booking_resource_units (tenant_id, resource_id, ordinal)
      VALUES (${tenantId}, ${resource[0]!.id}, ${ordinal})
      RETURNING id
    `) as { id: string }[];

    unitIds.push(unit[0]!.id);
  }

  const offering = (await admin`
    INSERT INTO awcms_booking_service_offerings
      (tenant_id, code, name, granularity, duration_seconds, setup_seconds,
       cleanup_seconds, slot_step_seconds, max_party, confirmation_mode)
    VALUES (${tenantId}, ${`svc-${code}`}, 'Hour', 'time', 3600,
            ${options.setup ?? 0}, ${options.cleanup ?? 0}, 900,
            ${options.maxParty ?? 4}, ${options.confirmation ?? "hold_then_confirm"})
    RETURNING id
  `) as { id: string }[];

  return {
    resourceId: resource[0]!.id,
    unitIds,
    offeringId: offering[0]!.id
  };
}

function claim(
  fixture: Fixture,
  overrides: Partial<PlaceHoldInput> = {}
): PlaceHoldInput {
  return {
    offeringId: fixture.offeringId,
    resourceId: fixture.resourceId,
    startsAtMs: START,
    partySize: 1,
    quantity: 1,
    ...overrides
  };
}

async function liveAllocations(resourceId: string): Promise<number> {
  const rows = (await getAdminSql()`
    SELECT count(*)::int AS n
    FROM awcms_booking_resource_allocations
    WHERE resource_id = ${resourceId} AND released_at IS NULL
  `) as { n: number }[];

  return rows[0]!.n;
}

/**
 * Post-hoc invariant (Issue #1087): every pair of LIVE `time` allocations that
 * overlap on one unit, with enough per-row evidence (ids, ranges, `xmin`/`xmax`,
 * `created_at`, release state, the owning reservation item/reservation, the
 * txid snapshot at read time) to diagnose a violation of the GiST exclusion
 * constraint from a single CI log. Empty when the invariant holds.
 */
async function overlappingLiveAllocations(
  resourceId: string
): Promise<Record<string, unknown>[]> {
  return (await getAdminSql()`
    SELECT a.resource_unit_id,
           a.id AS a_id, b.id AS b_id,
           a.item_id AS a_item, b.item_id AS b_item,
           ai.reservation_id AS a_reservation, bi.reservation_id AS b_reservation,
           a.granularity AS a_granularity, b.granularity AS b_granularity,
           tstzrange(a.occupied_from, a.occupied_to, '[)')::text AS a_range,
           tstzrange(b.occupied_from, b.occupied_to, '[)')::text AS b_range,
           a.created_at::text AS a_created_at, b.created_at::text AS b_created_at,
           a.xmin::text AS a_xmin, b.xmin::text AS b_xmin,
           a.xmax::text AS a_xmax, b.xmax::text AS b_xmax,
           a.released_at::text AS a_released_at, b.released_at::text AS b_released_at,
           a.released_reason AS a_released_reason,
           b.released_reason AS b_released_reason,
           txid_current_snapshot()::text AS snapshot,
           version() AS server_version
    FROM awcms_booking_resource_allocations a
    JOIN awcms_booking_resource_allocations b
      ON a.resource_unit_id = b.resource_unit_id AND a.id < b.id
    LEFT JOIN awcms_booking_reservation_items ai
      ON ai.tenant_id = a.tenant_id AND ai.id = a.item_id
    LEFT JOIN awcms_booking_reservation_items bi
      ON bi.tenant_id = b.tenant_id AND bi.id = b.item_id
    WHERE a.resource_id = ${resourceId}
      AND a.released_at IS NULL AND b.released_at IS NULL
      AND a.granularity = 'time' AND b.granularity = 'time'
      AND tstzrange(a.occupied_from, a.occupied_to, '[)')
          && tstzrange(b.occupied_from, b.occupied_to, '[)')
    ORDER BY a.resource_unit_id, a.id, b.id
  `) as Record<string, unknown>[];
}

async function reservationCount(tenantId: string): Promise<number> {
  const rows = (await getAdminSql()`
    SELECT count(*)::int AS n FROM awcms_booking_reservations
    WHERE tenant_id = ${tenantId}
  `) as { n: number }[];

  return rows[0]!.n;
}

/** Runs the contenders to completion and fails loudly if ANY threw: a lost race is a refusal VALUE, never an error. */
async function race<T = PlaceHoldOutcome>(
  contenders: ReadonlyArray<() => Promise<T>>
): Promise<T[]> {
  let go!: () => void;
  const start = new Promise<void>((resolve) => {
    go = resolve;
  });
  const running = contenders.map(async (contender) => {
    await start;
    return contender();
  });

  go();

  const settled = await Promise.allSettled(running);
  const errors = settled.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );

  if (errors.length > 0) {
    throw new Error(
      `${errors.length} contender(s) threw instead of returning a refusal: ${errors
        .map((error) => String(error.reason?.message ?? error.reason))
        .join(" | ")}`
    );
  }

  return settled.map((result) => (result as PromiseFulfilledResult<T>).value);
}

function tally(outcomes: readonly PlaceHoldOutcome[]) {
  const codes = new Map<string, number>();
  let ok = 0;

  for (const outcome of outcomes) {
    if (outcome.outcome === "ok") {
      ok += 1;
    } else if (outcome.outcome === "refused") {
      codes.set(outcome.code, (codes.get(outcome.code) ?? 0) + 1);
    } else {
      codes.set("INVALID", (codes.get("INVALID") ?? 0) + 1);
    }
  }

  return { ok, codes };
}

/** Test-only: shorten a hold through SQL (the update guard forbids shortening, the database clock is the only clock). */
async function backdateHold(reservationId: string): Promise<void> {
  const admin = getAdminSql();

  await admin.begin(async (tx) => {
    await tx.unsafe(
      "ALTER TABLE awcms_booking_reservations DISABLE TRIGGER awcms_booking_reservations_update_guard"
    );
    await tx`
      UPDATE awcms_booking_reservations
      SET hold_expires_at = clock_timestamp() - interval '2 seconds'
      WHERE id = ${reservationId}
    `;
    await tx.unsafe(
      "ALTER TABLE awcms_booking_reservations ENABLE TRIGGER awcms_booking_reservations_update_guard"
    );
  });
}

async function placed(
  tenantId: string,
  fixture: Fixture,
  overrides: Partial<PlaceHoldInput> = {}
) {
  const outcome = await place(tenantId, claim(fixture, overrides));

  if (outcome.outcome !== "ok") {
    throw new Error(`expected a placed hold, got ${JSON.stringify(outcome)}`);
  }

  return outcome.reservation;
}

/** Polls until a backend is blocked on a heavyweight lock inside an allocation INSERT. */
async function waitForBlockedAllocationInsert(): Promise<void> {
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    const rows = (await getAdminSql()`
      SELECT count(*)::int AS n
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND query ILIKE '%INSERT INTO awcms_booking_resource_allocations%'
    `) as { n: number }[];

    if (rows[0]!.n > 0) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(
    "the second allocation INSERT never blocked on the first: the interleaving was not proven"
  );
}

class RollbackSentinel extends Error {}

const suite = integrationEnabled ? describe : describe.skip;

suite("booking allocator under real concurrency (Issue #939, ADR-0131)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
    await resetDatabase();
    pool = createRuntimePool(32);
    await seedTenant(TENANT_A, "alloc-a");
    await seedTenant(TENANT_B, "alloc-b");
  });

  afterAll(async () => {
    await pool?.close({ timeout: 1 });
    await teardownIntegrationDatabase();
  });

  describe("ON CONFLICT DO NOTHING waits for an in-doubt row (the allocator's premise)", () => {
    test("the loser BLOCKS on the winner's uncommitted claim, then is refused when it commits", async () => {
      const fixture = await newFixture(TENANT_A);
      let aClaimed!: () => void;
      const claimed = new Promise<void>((resolve) => {
        aClaimed = resolve;
      });
      let commitA!: () => void;
      const gate = new Promise<void>((resolve) => {
        commitA = resolve;
      });
      const first = tenantTx(TENANT_A, async (tx) => {
        const outcome = await placeHold(
          tx,
          {
            tenantId: TENANT_A,
            staff: NO_OP_STAFF_AVAILABILITY,
            actorTenantUserId: ACTORS.get(TENANT_A)!
          },
          claim(fixture, { externalCustomerRef: "cust-a" })
        );

        aClaimed();
        await gate;
        return outcome;
      });

      await claimed;

      // B overlaps A's occupied range (30 minutes in) and starts WITHOUT awaiting.
      const second = place(
        TENANT_A,
        claim(fixture, {
          startsAtMs: START + 30 * 60_000,
          externalCustomerRef: "cust-b"
        })
      );

      await waitForBlockedAllocationInsert();
      commitA();

      const a = await first;
      const b = await second;

      expect(a.outcome).toBe("ok");
      expect(b).toMatchObject({ outcome: "refused", code: "SLOT_UNAVAILABLE" });
      expect(await liveAllocations(fixture.resourceId)).toBe(1);
    });

    test("when the winner ROLLS BACK the blocked loser takes the unit", async () => {
      const fixture = await newFixture(TENANT_A);
      let aClaimed!: () => void;
      const claimed = new Promise<void>((resolve) => {
        aClaimed = resolve;
      });
      let abortA!: () => void;
      const gate = new Promise<void>((resolve) => {
        abortA = resolve;
      });
      const first = tenantTx(TENANT_A, async (tx) => {
        const outcome = await placeHold(
          tx,
          {
            tenantId: TENANT_A,
            staff: NO_OP_STAFF_AVAILABILITY,
            actorTenantUserId: ACTORS.get(TENANT_A)!
          },
          claim(fixture)
        );

        expect(outcome.outcome).toBe("ok");
        aClaimed();
        await gate;
        throw new RollbackSentinel("abort A");
      }).catch((error: unknown) => {
        if (!(error instanceof RollbackSentinel)) {
          throw error;
        }
      });

      await claimed;

      const second = place(
        TENANT_A,
        claim(fixture, { startsAtMs: START + 30 * 60_000 })
      );

      await waitForBlockedAllocationInsert();
      abortA();
      await first;

      const b = await second;

      expect(b.outcome).toBe("ok");
      expect(await liveAllocations(fixture.resourceId)).toBe(1);
    });

    test("adjacent half-open slots both commit; a cleanup buffer makes the next one conflict", async () => {
      const plain = await newFixture(TENANT_A);

      await placed(TENANT_A, plain);
      await placed(TENANT_A, plain, { startsAtMs: START + 3_600_000 });
      expect(await liveAllocations(plain.resourceId)).toBe(2);

      const buffered = await newFixture(TENANT_A, { cleanup: 900 });

      await placed(TENANT_A, buffered);

      const next = await place(
        TENANT_A,
        claim(buffered, { startsAtMs: START + 3_600_000 })
      );

      expect(next).toMatchObject({
        outcome: "refused",
        code: "SLOT_UNAVAILABLE"
      });
    });
  });

  describe("T2 -- the final slot, many contenders", () => {
    test("20 parallel claims for the last unit: exactly one wins, nineteen are SLOT_UNAVAILABLE, one live allocation -- repeated 50 times", async () => {
      for (let round = 0; round < 50; round += 1) {
        const fixture = await newFixture(TENANT_A);
        const outcomes = await race(
          Array.from(
            { length: 20 },
            (_, index) => () =>
              place(
                TENANT_A,
                claim(fixture, {
                  externalCustomerRef: `cust-${round}-${index}`
                })
              )
          )
        );
        const { ok, codes } = tally(outcomes);

        expect({ round, ok }).toEqual({ round, ok: 1 });
        expect({ round, codes: Object.fromEntries(codes) }).toEqual({
          round,
          codes: { SLOT_UNAVAILABLE: 19 }
        });
        expect(await liveAllocations(fixture.resourceId)).toBe(1);
      }
    }, 240_000);

    test("the losers wrote NOTHING: one reservation, one item, one allocation, two history rows", async () => {
      const fixture = await newFixture(TENANT_A);
      const before = await reservationCount(TENANT_A);

      await race(
        Array.from({ length: 12 }, () => () => place(TENANT_A, claim(fixture)))
      );

      expect((await reservationCount(TENANT_A)) - before).toBe(1);

      const rows = (await getAdminSql()`
        SELECT (SELECT count(*) FROM awcms_booking_reservation_items i
                WHERE i.offering_id = ${fixture.offeringId})::int AS items,
               (SELECT count(*) FROM awcms_booking_reservation_events e
                JOIN awcms_booking_reservation_items i
                  ON i.reservation_id = e.reservation_id
                WHERE i.offering_id = ${fixture.offeringId})::int AS events
      `) as { items: number; events: number }[];

      expect(rows[0]).toEqual({ items: 1, events: 2 });
    });

    test("a different slot on the same resource is independent of the race for the first", async () => {
      const fixture = await newFixture(TENANT_A);
      const outcomes = await race([
        ...Array.from(
          { length: 6 },
          () => () => place(TENANT_A, claim(fixture))
        ),
        ...Array.from(
          { length: 6 },
          () => () =>
            place(
              TENANT_A,
              claim(fixture, { startsAtMs: START + 6 * 3_600_000 })
            )
        )
      ]);

      expect(tally(outcomes).ok).toBe(2);
      expect(await liveAllocations(fixture.resourceId)).toBe(2);
    });
  });

  describe("T3 -- capacity N and all-or-none", () => {
    test("3 units, 10 contenders for one unit each: exactly 3 win on 3 distinct units, 7 are refused", async () => {
      const fixture = await newFixture(TENANT_A, { capacity: 3 });
      const outcomes = await race(
        Array.from({ length: 10 }, () => () => place(TENANT_A, claim(fixture)))
      );
      const { ok, codes } = tally(outcomes);

      expect(ok).toBe(3);
      expect(Object.fromEntries(codes)).toEqual({ SLOT_UNAVAILABLE: 7 });

      const units = outcomes.flatMap((outcome) =>
        outcome.outcome === "ok"
          ? outcome.reservation.units.map((unit) => unit.unitId)
          : []
      );

      expect(new Set(units).size).toBe(3);
      expect([...new Set(units)].sort()).toEqual([...fixture.unitIds].sort());
      expect(await liveAllocations(fixture.resourceId)).toBe(3);
    });

    test("a claim for 2 units when 1 remains is refused and leaves NO partial allocation", async () => {
      const fixture = await newFixture(TENANT_A, { capacity: 3 });

      await placed(TENANT_A, fixture, { quantity: 2 });

      const before = await reservationCount(TENANT_A);
      const refused = await place(TENANT_A, claim(fixture, { quantity: 2 }));

      expect(refused).toMatchObject({
        outcome: "refused",
        code: "SLOT_UNAVAILABLE"
      });
      expect(await liveAllocations(fixture.resourceId)).toBe(2);
      expect(await reservationCount(TENANT_A)).toBe(before);

      // The one unit that remained is still claimable by a single-unit request.
      await placed(TENANT_A, fixture);
      expect(await liveAllocations(fixture.resourceId)).toBe(3);
    });

    test("4 units, 6 contenders for 2 units each: exactly 2 win, no unit is double-held and nobody holds half", async () => {
      const fixture = await newFixture(TENANT_A, { capacity: 4 });
      const outcomes = await race(
        Array.from(
          { length: 6 },
          () => () => place(TENANT_A, claim(fixture, { quantity: 2 }))
        )
      );
      const { ok, codes } = tally(outcomes);

      expect(ok).toBe(2);
      expect(Object.fromEntries(codes)).toEqual({ SLOT_UNAVAILABLE: 4 });
      expect(await liveAllocations(fixture.resourceId)).toBe(4);

      const rows = (await getAdminSql()`
        SELECT i.id, count(a.id)::int AS live
        FROM awcms_booking_reservation_items i
        LEFT JOIN awcms_booking_resource_allocations a
          ON a.item_id = i.id AND a.released_at IS NULL
        WHERE i.offering_id = ${fixture.offeringId}
        GROUP BY i.id
      `) as { id: string; live: number }[];

      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.live === 2)).toBe(true);
    });

    test("claims are first-free in a deterministic order: ordinals in turn, pool resources by sort_order", async () => {
      const single = await newFixture(TENANT_A, { capacity: 3 });
      const first = await placed(TENANT_A, single);
      const second = await placed(TENANT_A, single);
      const third = await placed(TENANT_A, single);

      expect(first.units[0]!.unitId).toBe(single.unitIds[0]!);
      expect(second.units[0]!.unitId).toBe(single.unitIds[1]!);
      expect(third.units[0]!.unitId).toBe(single.unitIds[2]!);

      const admin = getAdminSql();
      const poolRow = (await admin`
        INSERT INTO awcms_booking_resource_pools (tenant_id, code, name)
        VALUES (${TENANT_A}, ${`pool-${++sequence}`}, 'Rooms')
        RETURNING id
      `) as { id: string }[];
      const later = await newFixture(TENANT_A, {
        sortOrder: 20,
        poolId: poolRow[0]!.id
      });
      const earlier = await newFixture(TENANT_A, {
        sortOrder: 10,
        poolId: poolRow[0]!.id
      });
      // The pool's offering is the earlier resource's; the pool is the target.
      const viaPool = (extra: Partial<PlaceHoldInput> = {}) =>
        place(TENANT_A, {
          offeringId: earlier.offeringId,
          poolId: poolRow[0]!.id,
          startsAtMs: START,
          partySize: 1,
          quantity: 1,
          ...extra
        });
      const p1 = await viaPool();
      const p2 = await viaPool();
      const p3 = await viaPool();

      expect(p1).toMatchObject({ outcome: "ok" });
      expect(p2).toMatchObject({ outcome: "ok" });
      expect(p3).toMatchObject({
        outcome: "refused",
        code: "SLOT_UNAVAILABLE"
      });
      expect(
        (p1 as Extract<PlaceHoldOutcome, { outcome: "ok" }>).reservation
          .units[0]!.resourceId
      ).toBe(earlier.resourceId);
      expect(
        (p2 as Extract<PlaceHoldOutcome, { outcome: "ok" }>).reservation
          .units[0]!.resourceId
      ).toBe(later.resourceId);
    });

    test("a mixed soak -- overlapping slots, buffers, 1 or 2 units each: no unit is ever held twice over overlapping ranges, every win owns exactly its units", async () => {
      // A small deterministic PRNG, so a failure is reproducible from its seed.
      let state = 0x9e3779b9;
      const next = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 2 ** 32;
      };

      for (let round = 0; round < 5; round += 1) {
        const fixture = await newFixture(TENANT_A, {
          capacity: 4,
          setup: 300,
          cleanup: 600
        });
        const requests = Array.from({ length: 30 }, () => ({
          offset: Math.floor(next() * 4) * 30 * 60_000,
          quantity: 1 + Math.floor(next() * 2)
        }));
        const outcomes = await race(
          requests.map(
            (request) => () =>
              place(
                TENANT_A,
                claim(fixture, {
                  startsAtMs: START + request.offset,
                  quantity: request.quantity
                })
              )
          )
        );
        const won = outcomes.flatMap((outcome, index) =>
          outcome.outcome === "ok"
            ? [{ outcome, quantity: requests[index]!.quantity }]
            : []
        );

        // A refusal is only ever "taken" (or, if races kept flapping, a retry
        // hint) -- never an error, never an invalid input.
        for (const outcome of outcomes) {
          if (outcome.outcome === "refused") {
            expect(["SLOT_UNAVAILABLE", "CONTENTION_RETRY"]).toContain(
              outcome.code
            );
          } else {
            expect(outcome.outcome).toBe("ok");
          }
        }

        for (const { outcome, quantity } of won) {
          expect(outcome.reservation.units).toHaveLength(quantity);
          expect(
            new Set(outcome.reservation.units.map((u) => u.unitId)).size
          ).toBe(quantity);
        }

        expect(await liveAllocations(fixture.resourceId)).toBe(
          won.reduce((sum, entry) => sum + entry.quantity, 0)
        );

        // On a violation, fail with the offending rows and the round's
        // winners spelled out (Issue #1087) -- never weakened, never retried.
        const overlapping = await overlappingLiveAllocations(
          fixture.resourceId
        );

        if (overlapping.length > 0) {
          throw new Error(
            `soak round ${round}: ${overlapping.length} live overlapping allocation pair(s) on resource ${fixture.resourceId} ` +
              `(exclusion constraint violated). Offending pairs: ${JSON.stringify(overlapping, null, 2)}\n` +
              `Round requests (index: offsetMs/quantity/outcome): ${JSON.stringify(
                requests.map((request, index) => ({
                  index,
                  offsetMs: request.offset,
                  quantity: request.quantity,
                  outcome: outcomes[index]!.outcome
                }))
              )}`
          );
        }

        expect(overlapping).toHaveLength(0);
      }
    }, 120_000);

    test("a pool of 2 single-unit resources and 5 contenders: exactly 2 win, on distinct resources", async () => {
      const admin = getAdminSql();
      const poolRow = (await admin`
        INSERT INTO awcms_booking_resource_pools (tenant_id, code, name)
        VALUES (${TENANT_A}, ${`pool-${++sequence}`}, 'Chairs')
        RETURNING id
      `) as { id: string }[];
      const one = await newFixture(TENANT_A, { poolId: poolRow[0]!.id });
      const two = await newFixture(TENANT_A, { poolId: poolRow[0]!.id });
      const outcomes = await race(
        Array.from(
          { length: 5 },
          () => () =>
            place(TENANT_A, {
              offeringId: one.offeringId,
              poolId: poolRow[0]!.id,
              startsAtMs: START,
              partySize: 1,
              quantity: 1
            })
        )
      );
      const resources = outcomes.flatMap((outcome) =>
        outcome.outcome === "ok"
          ? outcome.reservation.units.map((unit) => unit.resourceId)
          : []
      );

      expect(tally(outcomes).ok).toBe(2);
      expect([...resources].sort()).toEqual(
        [one.resourceId, two.resourceId].sort()
      );
    });
  });

  describe("T6 -- hold expiry, with the reaper STOPPED", () => {
    test("an elapsed, unswept hold does not block a new claim, and is left expired with its units released", async () => {
      const fixture = await newFixture(TENANT_A);
      const hold = await placed(TENANT_A, fixture, {
        externalCustomerRef: "slow-customer"
      });

      expect(hold.status).toBe("held");
      expect(hold.holdExpiresAt).not.toBeNull();

      // Before it elapses the unit is genuinely held.
      expect(await place(TENANT_A, claim(fixture))).toMatchObject({
        outcome: "refused",
        code: "SLOT_UNAVAILABLE"
      });

      await backdateHold(hold.reservationId);

      const late = await place(
        TENANT_A,
        claim(fixture, { externalCustomerRef: "fast-customer" })
      );

      expect(late.outcome).toBe("ok");
      expect(await liveAllocations(fixture.resourceId)).toBe(1);

      const rows = (await getAdminSql()`
        SELECT r.status,
               (SELECT count(*) FROM awcms_booking_resource_allocations a
                JOIN awcms_booking_reservation_items i ON i.id = a.item_id
                WHERE i.reservation_id = r.id AND a.released_reason = 'expired')::int
                 AS released,
               (SELECT detail->>'trigger' FROM awcms_booking_reservation_events e
                WHERE e.reservation_id = r.id AND e.kind = 'expired') AS via
        FROM awcms_booking_reservations r WHERE r.id = ${hold.reservationId}
      `) as { status: string; released: number; via: string }[];

      expect(rows[0]).toEqual({
        status: "expired",
        released: 1,
        via: "lazy_reclaim"
      });
    });

    test("lazy reclaim writes an aggregate audit row naming no customer", async () => {
      const fixture = await newFixture(TENANT_A);
      const hold = await placed(TENANT_A, fixture, {
        externalCustomerRef: "private-customer-ref",
        customerNote: "allergic to nuts"
      });

      await backdateHold(hold.reservationId);
      await placed(TENANT_A, fixture);

      const audit = (await getAdminSql()`
        SELECT action, severity, message, attributes::text AS attributes
        FROM awcms_audit_events
        WHERE tenant_id = ${TENANT_A} AND module_key = 'booking'
        ORDER BY created_at DESC
        LIMIT 20
      `) as {
        action: string;
        severity: string;
        message: string;
        attributes: string | null;
      }[];
      const expired = audit.filter(
        (row) => row.action === "booking.reservation.expired"
      );

      expect(expired.length).toBeGreaterThan(0);
      expect(expired[0]!.attributes).toContain("lazy_reclaim");

      const everything = JSON.stringify(audit);

      expect(everything).not.toContain("private-customer-ref");
      expect(everything).not.toContain("allergic");
    });

    test("10 claimers racing for one elapsed hold: exactly one wins, the hold is expired ONCE, nothing drifts", async () => {
      const tenantId = "b9390000-0000-4000-8000-0000000000c1";

      await seedTenant(tenantId, "alloc-c1");

      const fixture = await newFixture(tenantId);
      const hold = await placed(tenantId, fixture);

      await backdateHold(hold.reservationId);

      const outcomes = await race(
        Array.from({ length: 10 }, () => () => place(tenantId, claim(fixture)))
      );
      const { ok, codes } = tally(outcomes);

      expect(ok).toBe(1);
      expect(Object.fromEntries(codes)).toEqual({ SLOT_UNAVAILABLE: 9 });
      expect(await liveAllocations(fixture.resourceId)).toBe(1);

      const events = (await getAdminSql()`
        SELECT count(*)::int AS n FROM awcms_booking_reservation_events
        WHERE reservation_id = ${hold.reservationId} AND kind = 'expired'
      `) as { n: number }[];

      expect(events[0]!.n).toBe(1);

      const report = await tenantTx(tenantId, (tx) =>
        runReconciliation(tx, tenantId)
      );

      expect(report.drift).toBe(0);
    });

    test("the reaper racing lazy reclaim: every elapsed hold is expired exactly once", async () => {
      const tenantId = "b9390000-0000-4000-8000-0000000000c2";

      await seedTenant(tenantId, "alloc-c2");

      const fixtures: Fixture[] = [];
      const holds: string[] = [];

      for (let index = 0; index < 6; index += 1) {
        const fixture = await newFixture(tenantId);
        const hold = await placed(tenantId, fixture);

        fixtures.push(fixture);
        holds.push(hold.reservationId);
        await backdateHold(hold.reservationId);
      }

      const claims = fixtures.map(
        (fixture) => () => place(tenantId, claim(fixture))
      );
      const reapers = [0, 1].map(
        () => () => workerTx(tenantId, (tx) => expireDueHolds(tx, tenantId, 50))
      );
      const outcomes = await race<PlaceHoldOutcome | ExpiryOutcome>([
        ...claims,
        ...reapers
      ]);
      const claimResults = outcomes.filter(
        (outcome): outcome is PlaceHoldOutcome => "outcome" in outcome
      );

      expect(claimResults).toHaveLength(6);
      // Every claimer got its unit: the elapsed hold never refused a live claim,
      // whichever of the claimer or the reaper expired it.
      expect(claimResults.every((outcome) => outcome.outcome === "ok")).toBe(
        true
      );

      const rows = (await getAdminSql()`
        SELECT r.id, r.status,
               (SELECT count(*) FROM awcms_booking_reservation_events e
                WHERE e.reservation_id = r.id AND e.kind = 'expired')::int AS expired_events
        FROM awcms_booking_reservations r
        WHERE r.id IN (${holds[0]!}, ${holds[1]!}, ${holds[2]!}, ${holds[3]!},
                       ${holds[4]!}, ${holds[5]!})
      `) as { id: string; status: string; expired_events: number }[];

      expect(rows).toHaveLength(6);
      expect(rows.every((row) => row.status === "expired")).toBe(true);
      expect(rows.every((row) => row.expired_events === 1)).toBe(true);

      for (const fixture of fixtures) {
        expect(await liveAllocations(fixture.resourceId)).toBe(1);
      }

      const report = await tenantTx(tenantId, (tx) =>
        runReconciliation(tx, tenantId)
      );

      expect(report.drift).toBe(0);
    });

    test("a hold that has NOT elapsed is untouched by the reaper and still blocks", async () => {
      const tenantId = "b9390000-0000-4000-8000-0000000000c3";

      await seedTenant(tenantId, "alloc-c3");

      const fixture = await newFixture(tenantId);
      const hold = await placed(tenantId, fixture, { holdSeconds: 600 });
      const swept = await workerTx(tenantId, (tx) =>
        expireDueHolds(tx, tenantId)
      );

      expect(swept.expired).toBe(0);
      expect(await liveAllocations(fixture.resourceId)).toBe(1);
      expect(await place(tenantId, claim(fixture))).toMatchObject({
        outcome: "refused",
        code: "SLOT_UNAVAILABLE"
      });

      const status = (await getAdminSql()`
        SELECT status FROM awcms_booking_reservations WHERE id = ${hold.reservationId}
      `) as { status: string }[];

      expect(status[0]!.status).toBe("held");
    });

    test("the reaper never waits on a hold another transaction has locked (SKIP LOCKED), and takes it next pass", async () => {
      const tenantId = "b9390000-0000-4000-8000-0000000000c4";

      await seedTenant(tenantId, "alloc-c4");

      const fixture = await newFixture(tenantId);
      const hold = await placed(tenantId, fixture);

      await backdateHold(hold.reservationId);

      let locked!: () => void;
      const lockTaken = new Promise<void>((resolve) => {
        locked = resolve;
      });
      let unlock!: () => void;
      const gate = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      // An in-flight transition: another request holds the reservation row lock.
      const holder = tenantTx(tenantId, async (tx) => {
        await tx`
          SELECT id FROM awcms_booking_reservations
          WHERE id = ${hold.reservationId} FOR UPDATE
        `;
        locked();
        await gate;
      });

      await lockTaken;

      const started = Date.now();
      const whileLocked = await workerTx(tenantId, (tx) =>
        expireDueHolds(tx, tenantId)
      );

      expect(whileLocked.expired).toBe(0);
      expect(Date.now() - started).toBeLessThan(2000);

      unlock();
      await holder;

      const after = await workerTx(tenantId, (tx) =>
        expireDueHolds(tx, tenantId)
      );

      expect(after).toMatchObject({ expired: 1, releasedAllocations: 1 });
    });

    test("an expired hold cannot be confirmed, even though nothing has swept it (the database clock decides)", async () => {
      const fixture = await newFixture(TENANT_A);
      const hold = await placed(TENANT_A, fixture);

      await backdateHold(hold.reservationId);

      let message = "";

      try {
        await getAdminSql()`
          UPDATE awcms_booking_reservations
          SET status = 'confirmed', hold_expires_at = NULL,
              status_changed_at = now(), updated_at = now()
          WHERE id = ${hold.reservationId}
        `;
      } catch (error) {
        message = String((error as Error).message);
      }

      expect(message).toContain("HOLD_EXPIRED");
      expect(await liveAllocations(fixture.resourceId)).toBe(1);
    });
  });

  describe("hold caps are a SUM and hold under concurrency (booking.md section 8.1 rule 4)", () => {
    test("a per-tenant cap of 2 with 6 concurrent holds on different resources: exactly 2 win, 4 are HOLD_LIMIT_EXCEEDED", async () => {
      const tenantId = "b9390000-0000-4000-8000-0000000000c5";

      await seedTenant(tenantId, "alloc-c5");
      await getAdminSql()`
        INSERT INTO awcms_booking_settings (tenant_id, max_active_holds_per_tenant)
        VALUES (${tenantId}, 2)
      `;

      const fixtures = await Promise.all(
        Array.from({ length: 6 }, () => newFixture(tenantId))
      );
      const outcomes = await race(
        fixtures.map((fixture) => () => place(tenantId, claim(fixture)))
      );
      const { ok, codes } = tally(outcomes);

      expect(ok).toBe(2);
      expect(Object.fromEntries(codes)).toEqual({ HOLD_LIMIT_EXCEEDED: 4 });
      expect(
        outcomes
          .filter((outcome) => outcome.outcome === "refused")
          .every(
            (outcome) =>
              outcome.outcome === "refused" && outcome.httpStatus === 429
          )
      ).toBe(true);
    });

    test("a per-customer cap counts that customer's live holds only; an elapsed hold does not count", async () => {
      const tenantId = "b9390000-0000-4000-8000-0000000000c6";

      await seedTenant(tenantId, "alloc-c6");
      await getAdminSql()`
        INSERT INTO awcms_booking_settings (tenant_id, max_active_holds_per_customer)
        VALUES (${tenantId}, 1)
      `;

      const one = await newFixture(tenantId);
      const two = await newFixture(tenantId);
      const three = await newFixture(tenantId);
      const first = await placed(tenantId, one, { externalCustomerRef: "c-1" });

      expect(
        await place(tenantId, claim(two, { externalCustomerRef: "c-1" }))
      ).toMatchObject({ outcome: "refused", code: "HOLD_LIMIT_EXCEEDED" });
      expect(
        (await place(tenantId, claim(two, { externalCustomerRef: "c-2" })))
          .outcome
      ).toBe("ok");

      await backdateHold(first.reservationId);

      expect(
        (await place(tenantId, claim(three, { externalCustomerRef: "c-1" })))
          .outcome
      ).toBe("ok");
    });

    test("an immediately confirmed reservation is not a hold: no expiry, no cap", async () => {
      const tenantId = "b9390000-0000-4000-8000-0000000000c7";

      await seedTenant(tenantId, "alloc-c7");
      await getAdminSql()`
        INSERT INTO awcms_booking_settings (tenant_id, max_active_holds_per_tenant)
        VALUES (${tenantId}, 1)
      `;

      const fixtureA = await newFixture(tenantId, {
        confirmation: "immediate"
      });
      const fixtureB = await newFixture(tenantId, {
        confirmation: "immediate"
      });
      const a = await placed(tenantId, fixtureA);
      const b = await placed(tenantId, fixtureB);

      expect(a.status).toBe("confirmed");
      expect(a.holdExpiresAt).toBeNull();
      expect(b.status).toBe("confirmed");

      const events = (await getAdminSql()`
        SELECT kind, to_status FROM awcms_booking_reservation_events
        WHERE reservation_id = ${a.reservationId} ORDER BY seq
      `) as { kind: string; to_status: string }[];

      expect(events).toEqual([
        { kind: "created", to_status: "confirmed" },
        { kind: "confirmed", to_status: "confirmed" }
      ]);
    });
  });

  describe("placement refusals are values and write nothing", () => {
    test("unknown offering, unknown resource, another tenant's resource: neutral not-found", async () => {
      const mine = await newFixture(TENANT_A);
      const theirs = await newFixture(TENANT_B);
      const before = await reservationCount(TENANT_A);

      expect(
        await place(
          TENANT_A,
          claim(mine, { offeringId: "b9390000-0000-4000-8000-0000000000ff" })
        )
      ).toMatchObject({ outcome: "refused", code: "OFFERING_NOT_FOUND" });
      expect(
        await place(
          TENANT_A,
          claim(mine, { resourceId: "b9390000-0000-4000-8000-0000000000fe" })
        )
      ).toMatchObject({ outcome: "refused", code: "RESOURCE_NOT_FOUND" });
      expect(
        await place(TENANT_A, claim(mine, { resourceId: theirs.resourceId }))
      ).toMatchObject({ outcome: "refused", code: "RESOURCE_NOT_FOUND" });
      expect(
        await place(TENANT_A, claim(mine, { offeringId: theirs.offeringId }))
      ).toMatchObject({ outcome: "refused", code: "OFFERING_NOT_FOUND" });
      expect(await reservationCount(TENANT_A)).toBe(before);
    });

    test("party size, quantity above the units, and a stay resource are refused with their own codes", async () => {
      const fixture = await newFixture(TENANT_A, { capacity: 2, maxParty: 3 });
      const stay = await newFixture(TENANT_A, { mode: "stay" });

      expect(
        await place(TENANT_A, claim(fixture, { partySize: 4 }))
      ).toMatchObject({ outcome: "refused", code: "PARTY_SIZE_OUT_OF_RANGE" });
      expect(
        await place(TENANT_A, claim(fixture, { quantity: 3 }))
      ).toMatchObject({
        outcome: "refused",
        code: "QUANTITY_EXCEEDS_UNITS",
        httpStatus: 422
      });
      expect(
        await place(TENANT_A, claim(stay, { offeringId: fixture.offeringId }))
      ).toMatchObject({ outcome: "refused", code: "BOOKING_MODE_MISMATCH" });
      expect(await liveAllocations(fixture.resourceId)).toBe(0);
    });

    test("malformed input is `invalid` with field names and never reaches the database", async () => {
      const fixture = await newFixture(TENANT_A);
      const outcome = await place(
        TENANT_A,
        claim(fixture, { externalCustomerRef: "a@b.id", quantity: 0 })
      );

      expect(outcome.outcome).toBe("invalid");
      expect(
        outcome.outcome === "invalid" ? outcome.errors.map((e) => e.field) : []
      ).toEqual(["quantity", "externalCustomerRef"]);
    });

    test("a live external reference is unique: the retry is EXTERNAL_REF_IN_USE and leaves no partial rows", async () => {
      const fixture = await newFixture(TENANT_A, { capacity: 2 });
      const externalRef = { type: "order", id: `ORD-${++sequence}` };

      await placed(TENANT_A, fixture, { externalRef });

      const before = await reservationCount(TENANT_A);
      const retry = await place(TENANT_A, claim(fixture, { externalRef }));

      expect(retry).toMatchObject({
        outcome: "refused",
        code: "EXTERNAL_REF_IN_USE"
      });
      expect(await reservationCount(TENANT_A)).toBe(before);
      expect(await liveAllocations(fixture.resourceId)).toBe(1);
    });

    test("the hold lifetime is clamped to the tenant policy, on the database clock", async () => {
      const tenantId = "b9390000-0000-4000-8000-0000000000c8";

      await seedTenant(tenantId, "alloc-c8");
      await getAdminSql()`
        INSERT INTO awcms_booking_settings
          (tenant_id, default_hold_seconds, max_hold_seconds)
        VALUES (${tenantId}, 120, 300)
      `;

      const fixture = await newFixture(tenantId, { capacity: 3 });
      const rows = (await Promise.all(
        [undefined, 1, 100_000].map((holdSeconds) =>
          placed(tenantId, fixture, { holdSeconds })
        )
      )) as { holdExpiresAt: string | null; reservationId: string }[];
      const seconds = (await getAdminSql()`
        SELECT id, floor(extract(epoch FROM hold_expires_at - status_changed_at))::int AS ttl
        FROM awcms_booking_reservations
        WHERE id IN (${rows[0]!.reservationId}, ${rows[1]!.reservationId}, ${rows[2]!.reservationId})
      `) as { id: string; ttl: number }[];
      const byId = new Map(seconds.map((row) => [row.id, row.ttl]));

      // default 120; a 1 second request is lifted to the 60 second floor; a huge
      // one is capped at the tenant maximum 300. (status_changed_at is `now()`,
      // the hold uses clock_timestamp(): allow the statement's few milliseconds.)
      expect(byId.get(rows[0]!.reservationId)).toBeGreaterThanOrEqual(119);
      expect(byId.get(rows[0]!.reservationId)).toBeLessThanOrEqual(121);
      expect(byId.get(rows[1]!.reservationId)).toBeGreaterThanOrEqual(59);
      expect(byId.get(rows[1]!.reservationId)).toBeLessThanOrEqual(61);
      expect(byId.get(rows[2]!.reservationId)).toBeGreaterThanOrEqual(299);
      expect(byId.get(rows[2]!.reservationId)).toBeLessThanOrEqual(301);
    });

    test("audit and history carry ids and instants, never the customer reference or the note", async () => {
      const fixture = await newFixture(TENANT_A);
      const hold = await placed(TENANT_A, fixture, {
        externalCustomerRef: "secret-customer-77",
        customerNote: "knee surgery last week"
      });
      const audit = (await getAdminSql()`
        SELECT message, attributes::text AS attributes
        FROM awcms_audit_events
        WHERE tenant_id = ${TENANT_A} AND resource_id = ${hold.reservationId}
      `) as { message: string; attributes: string | null }[];
      const events = (await getAdminSql()`
        SELECT detail::text AS detail
        FROM awcms_booking_reservation_events
        WHERE reservation_id = ${hold.reservationId}
      `) as { detail: string }[];

      expect(audit.length).toBe(1);

      const text = JSON.stringify([audit, events]);

      expect(text).not.toContain("secret-customer-77");
      expect(text).not.toContain("knee surgery");
      expect(text).toContain(hold.offeringId);
    });
  });

  describe("reconciliation", () => {
    test("a tenant that only used the allocator has zero drift; the reaper's lag is zero", async () => {
      const tenantId = "b9390000-0000-4000-8000-0000000000d1";

      await seedTenant(tenantId, "alloc-d1");

      const fixture = await newFixture(tenantId, { capacity: 3 });

      await placed(tenantId, fixture, { quantity: 2 });
      await placed(tenantId, fixture, {
        startsAtMs: START + 7_200_000,
        holdSeconds: 600
      });

      const report = await tenantTx(tenantId, (tx) =>
        runReconciliation(tx, tenantId)
      );

      expect(report.drift).toBe(0);
      expect(report.findings.every((finding) => finding.count === 0)).toBe(
        true
      );
      expect(report.reaper).toMatchObject({
        dueHolds: 0,
        overdueHolds: 0,
        oldestOverdueSeconds: 0
      });
    });

    test("a stopped reaper shows as hold_overdue_unswept and a lag; corrections are never made", async () => {
      const tenantId = "b9390000-0000-4000-8000-0000000000d2";

      await seedTenant(tenantId, "alloc-d2");

      const fixture = await newFixture(tenantId);
      const hold = await placed(tenantId, fixture);

      await getAdminSql().begin(async (tx) => {
        await tx.unsafe(
          "ALTER TABLE awcms_booking_reservations DISABLE TRIGGER awcms_booking_reservations_update_guard"
        );
        await tx`
          UPDATE awcms_booking_reservations
          SET hold_expires_at = clock_timestamp() - interval '20 minutes'
          WHERE id = ${hold.reservationId}
        `;
        await tx.unsafe(
          "ALTER TABLE awcms_booking_reservations ENABLE TRIGGER awcms_booking_reservations_update_guard"
        );
      });

      const report = await tenantTx(tenantId, (tx) =>
        runReconciliation(tx, tenantId)
      );
      const stuck = report.findings.find(
        (finding) => finding.check === "hold_overdue_unswept"
      )!;

      expect(stuck.count).toBe(1);
      expect(stuck.sampleIds).toEqual([hold.reservationId]);
      expect(report.reaper.overdueHolds).toBe(1);
      expect(report.reaper.oldestOverdueSeconds).toBeGreaterThanOrEqual(1190);

      // Read-only: the hold is still `held` and still has its allocation.
      expect(await liveAllocations(fixture.resourceId)).toBe(1);
    });

    test("it names an allocation released behind the reservation's back, and a live one under a cancelled reservation", async () => {
      const tenantId = "b9390000-0000-4000-8000-0000000000d3";

      await seedTenant(tenantId, "alloc-d3");

      const lost = await newFixture(tenantId);
      const orphan = await newFixture(tenantId);
      const lostHold = await placed(tenantId, lost);
      const orphanHold = await placed(tenantId, orphan);
      const admin = getAdminSql();

      // 1. Release the allocation but leave the reservation held.
      await admin`
        UPDATE awcms_booking_resource_allocations
        SET released_at = now(), released_reason = 'cancelled'
        WHERE id = ${lostHold.units[0]!.allocationId}
      `;
      // 2. Cancel the reservation but leave the allocation live.
      await admin`
        UPDATE awcms_booking_reservations
        SET status = 'cancelled', status_changed_at = now(), updated_at = now(),
            cancel_reason_code = 'test'
        WHERE id = ${orphanHold.reservationId}
      `;

      const report = await tenantTx(tenantId, (tx) =>
        runReconciliation(tx, tenantId)
      );
      const count = (check: string) =>
        report.findings.find((finding) => finding.check === check)!;

      expect(count("reservation_missing_allocation").sampleIds).toEqual([
        lostHold.reservationId
      ]);
      expect(
        count("live_allocation_on_released_reservation").sampleIds
      ).toEqual([orphanHold.units[0]!.allocationId]);
      expect(count("missing_status_event").sampleIds).toContain(
        orphanHold.reservationId
      );
      expect(report.drift).toBeGreaterThanOrEqual(3);
    });

    test("reconciliation is tenant-scoped: another tenant's drift is invisible", async () => {
      const report = await tenantTx(TENANT_B, (tx) =>
        runReconciliation(tx, TENANT_B)
      );

      expect(report.drift).toBe(0);
    });
  });

  describe("a deadlock victim retries, bounded (booking.md section 8.1 rule 3)", () => {
    /**
     * A real `40P01` cannot be provoked on demand (units are inserted in one
     * global order, which is the point), so the victim is simulated: the first
     * `times` allocation INSERTs fail with a genuine `Bun.SQL.PostgresError`
     * carrying SQLSTATE 40P01, and everything else reaches the database.
     */
    function injectDeadlocks(tx: Bun.TransactionSQL, times: number) {
      let remaining = times;
      let injected = 0;
      const wrapped = new Proxy(tx, {
        apply(target, thisArg, args) {
          const strings = args[0] as TemplateStringsArray | undefined;

          if (
            remaining > 0 &&
            Array.isArray(strings) &&
            strings
              .join("?")
              .includes("INSERT INTO awcms_booking_resource_allocations")
          ) {
            remaining -= 1;
            injected += 1;

            return Promise.reject(
              new Bun.SQL.PostgresError("deadlock detected", {
                errno: "40P01",
                code: "ERR_POSTGRES_SERVER_ERROR"
              } as never)
            );
          }

          return Reflect.apply(target, thisArg, args);
        }
      });

      return { wrapped, injected: () => injected };
    }

    function placeWithDeadlocks(
      tenantId: string,
      input: PlaceHoldInput,
      times: number
    ) {
      let injected = () => 0;
      const outcome = tenantTx(tenantId, (tx) => {
        const victim = injectDeadlocks(tx, times);

        injected = victim.injected;

        return placeHold(
          victim.wrapped,
          {
            tenantId,
            staff: NO_OP_STAFF_AVAILABILITY,
            actorTenantUserId: ACTORS.get(tenantId) ?? null
          },
          input
        );
      });

      return outcome.then((result) => ({ result, injected: injected() }));
    }

    test("two deadlocks are survived: the third attempt wins and nothing from the failed ones remains", async () => {
      const fixture = await newFixture(TENANT_A);
      const before = await reservationCount(TENANT_A);
      const { result, injected } = await placeWithDeadlocks(
        TENANT_A,
        claim(fixture),
        2
      );

      expect(injected).toBe(2);
      expect(result.outcome).toBe("ok");
      expect((await reservationCount(TENANT_A)) - before).toBe(1);
      expect(await liveAllocations(fixture.resourceId)).toBe(1);
    });

    test("a persistent deadlock is refused CONTENTION_RETRY after three retries, with no partial claim", async () => {
      const fixture = await newFixture(TENANT_A);
      const before = await reservationCount(TENANT_A);
      const { result, injected } = await placeWithDeadlocks(
        TENANT_A,
        claim(fixture),
        99
      );

      expect(injected).toBe(4);
      expect(result).toMatchObject({
        outcome: "refused",
        code: "CONTENTION_RETRY",
        httpStatus: 409
      });
      expect(await reservationCount(TENANT_A)).toBe(before);
      expect(await liveAllocations(fixture.resourceId)).toBe(0);
    });
  });

  describe("the hold-expiry job (booking:holds:expire)", () => {
    const context = (dryRun: boolean) => ({
      runId: crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
      dryRun,
      signal: new AbortController().signal
    });

    test("--dry-run counts the elapsed holds and mutates nothing; the real run expires them per tenant and audits once per tenant", async () => {
      const tenantX = "b9390000-0000-4000-8000-0000000000f1";
      const tenantY = "b9390000-0000-4000-8000-0000000000f2";

      await seedTenant(tenantX, "alloc-f1");
      await seedTenant(tenantY, "alloc-f2");

      const overdue: string[] = [];
      const live: string[] = [];

      for (const tenantId of [tenantX, tenantY]) {
        for (let index = 0; index < 3; index += 1) {
          const fixture = await newFixture(tenantId);
          const hold = await placed(tenantId, fixture);

          overdue.push(hold.reservationId);
          await backdateHold(hold.reservationId);
        }

        const fixture = await newFixture(tenantId);

        live.push((await placed(tenantId, fixture)).reservationId);
      }

      const statuses = async (ids: string[]) => {
        const rows = (await getAdminSql()`
          SELECT id, status FROM awcms_booking_reservations
          WHERE id = ANY(string_to_array(${ids.join(",")}::text, ',')::uuid[])
        `) as { id: string; status: string }[];

        return rows.map((row) => row.status);
      };

      const dry = await runBookingHoldExpiry(getWorkerRoleSql(), context(true));

      expect(dry.holdsExpired).toBeGreaterThanOrEqual(6);
      expect(await statuses(overdue)).toEqual(Array(6).fill("held"));

      const real = await runBookingHoldExpiry(
        getWorkerRoleSql(),
        context(false)
      );

      expect(real.holdsExpired).toBeGreaterThanOrEqual(6);
      expect(real.allocationsReleased).toBe(real.holdsExpired);
      expect(real.tenantsHitPassLimit).toEqual([]);
      expect(await statuses(overdue)).toEqual(Array(6).fill("expired"));
      // A hold that has not elapsed is left alone.
      expect(await statuses(live)).toEqual(["held", "held"]);

      const audit = (await getAdminSql()`
        SELECT tenant_id, attributes->>'expiredCount' AS expired,
               attributes->>'trigger' AS trigger
        FROM awcms_audit_events
        WHERE module_key = 'booking' AND action = 'booking.reservation.expired'
          AND tenant_id IN (${tenantX}, ${tenantY})
          AND attributes->>'trigger' = 'reaper'
      `) as { tenant_id: string; expired: string; trigger: string }[];

      expect(audit.map((row) => [row.tenant_id, row.expired]).sort()).toEqual([
        [tenantX, "3"],
        [tenantY, "3"]
      ]);

      // A second run finds nothing: the sweep is idempotent.
      const again = await runBookingHoldExpiry(
        getWorkerRoleSql(),
        context(false)
      );

      expect(again.holdsExpired).toBe(0);

      for (const tenantId of [tenantX, tenantY]) {
        const report = await tenantTx(tenantId, (tx) =>
          runReconciliation(tx, tenantId)
        );

        expect(report.drift).toBe(0);
      }
    });

    test("a tenant cannot expire, or see, another tenant's holds through its own context", async () => {
      const tenantId = "b9390000-0000-4000-8000-0000000000f3";

      await seedTenant(tenantId, "alloc-f3");

      const mine = await newFixture(TENANT_B);
      const hold = await placed(TENANT_B, mine);

      await backdateHold(hold.reservationId);

      const swept = await workerTx(tenantId, (tx) =>
        expireDueHolds(tx, tenantId)
      );

      expect(swept.expired).toBe(0);

      const status = (await getAdminSql()`
        SELECT status FROM awcms_booking_reservations WHERE id = ${hold.reservationId}
      `) as { status: string }[];

      expect(status[0]!.status).toBe("held");
    });
  });

  describe("lazy reclaim never truncates (booking.md section 5.1)", () => {
    test("more elapsed holds than one batch: every one is expired, and a hold outside the range is left alone", async () => {
      const tenantId = "b9390000-0000-4000-8000-0000000000a1";

      await seedTenant(tenantId, "alloc-a1");

      const fixture = await newFixture(tenantId, { capacity: 8 });
      const holds: string[] = [];

      for (let index = 0; index < 8; index += 1) {
        holds.push((await placed(tenantId, fixture)).reservationId);
      }

      const elsewhere = await placed(tenantId, fixture, {
        startsAtMs: START + 6 * 3_600_000
      });

      for (const hold of holds) {
        await backdateHold(hold);
      }

      // Batches of 3 against 8 elapsed holds: 3 + 3 + 2 + an empty batch.
      const outcome = await tenantTx(tenantId, (tx) =>
        reclaimExpiredHolds(
          tx,
          tenantId,
          [fixture.resourceId],
          { kind: "time", fromMs: START, toMs: START + 3_600_000 },
          3
        )
      );

      expect(outcome).toMatchObject({ expired: 8, releasedAllocations: 8 });

      const rows = (await getAdminSql()`
        SELECT status, count(*)::int AS n
        FROM awcms_booking_reservations
        WHERE tenant_id = ${tenantId}
        GROUP BY status ORDER BY status
      `) as { status: string; n: number }[];

      expect(rows).toEqual([
        { status: "expired", n: 8 },
        { status: "held", n: 1 }
      ]);
      expect(elsewhere.status).toBe("held");
      expect(await liveAllocations(fixture.resourceId)).toBe(1);

      // The whole capacity is claimable in one request, through the real path.
      const all = await place(
        tenantId,
        claim(fixture, { quantity: 8, startsAtMs: START })
      );

      expect(all.outcome).toBe("ok");

      const report = await tenantTx(tenantId, (tx) =>
        runReconciliation(tx, tenantId)
      );

      expect(report.drift).toBe(0);
    });

    test("the default batch is not a ceiling either: 150 elapsed holds on one unit's neighbours are all reclaimed", async () => {
      const tenantId = "b9390000-0000-4000-8000-0000000000a2";

      await seedTenant(tenantId, "alloc-a2");

      // 150 holds, one unit each, all overlapping the claim; 150 > the 100 default.
      const fixture = await newFixture(tenantId, { capacity: 150 });
      const ids = (await getAdminSql()`
        SELECT id FROM awcms_booking_resource_units
        WHERE resource_id = ${fixture.resourceId} ORDER BY ordinal
      `) as { id: string }[];

      expect(ids).toHaveLength(150);

      // One at a time: each claims the next free unit, no race to confuse the
      // point of this test, which is the reclaim loop.
      for (let index = 0; index < 150; index += 1) {
        await placed(tenantId, fixture, { holdSeconds: 3600 });
      }

      await getAdminSql().begin(async (tx) => {
        await tx.unsafe(
          "ALTER TABLE awcms_booking_reservations DISABLE TRIGGER awcms_booking_reservations_update_guard"
        );
        await tx`
          UPDATE awcms_booking_reservations
          SET hold_expires_at = clock_timestamp() - interval '2 seconds'
          WHERE tenant_id = ${tenantId} AND status = 'held'
        `;
        await tx.unsafe(
          "ALTER TABLE awcms_booking_reservations ENABLE TRIGGER awcms_booking_reservations_update_guard"
        );
      });

      const everything = await place(
        tenantId,
        claim(fixture, { quantity: 150, partySize: 1 })
      );

      expect(everything.outcome).toBe("ok");
      expect(await liveAllocations(fixture.resourceId)).toBe(150);
    }, 120_000);
  });

  describe("the sweep runs as awcms_worker through one narrow function (sql/200)", () => {
    const denied = /permission denied/i;

    async function rejectedMessage(promise: Promise<unknown>): Promise<string> {
      const error = await assertRejectedByDatabase(promise, "the statement");

      return `${error.message} ${String((error as { errno?: unknown }).errno ?? "")}`;
    }

    test("the worker expires an elapsed hold and writes the same facts a human could not forge", async () => {
      const tenantId = "b9390000-0000-4000-8000-0000000000b1";

      await seedTenant(tenantId, "alloc-b1");

      const fixture = await newFixture(tenantId);
      const hold = await placed(tenantId, fixture);
      const live = await newFixture(tenantId);
      const liveHold = await placed(tenantId, live, { holdSeconds: 3600 });

      await backdateHold(hold.reservationId);

      expect(
        await workerTx(tenantId, (tx) => countDueHolds(tx, tenantId))
      ).toBe(1);

      const outcome = await workerTx(tenantId, (tx) =>
        expireDueHolds(tx, tenantId)
      );

      expect(outcome).toMatchObject({ expired: 1, releasedAllocations: 1 });

      const rows = (await getAdminSql()`
        SELECT r.id, r.status, r.status_changed_by IS NULL AS system_actor,
               (SELECT count(*) FROM awcms_booking_resource_allocations a
                JOIN awcms_booking_reservation_items i ON i.id = a.item_id
                WHERE i.reservation_id = r.id AND a.released_reason = 'expired'
                  AND a.released_at IS NOT NULL)::int AS released,
               (SELECT e.detail->>'trigger' FROM awcms_booking_reservation_events e
                WHERE e.reservation_id = r.id AND e.kind = 'expired') AS via
        FROM awcms_booking_reservations r
        WHERE r.id IN (${hold.reservationId}, ${liveHold.reservationId})
        ORDER BY r.status
      `) as {
        id: string;
        status: string;
        system_actor: boolean;
        released: number;
        via: string | null;
      }[];
      const byId = new Map(rows.map((row) => [row.id, row]));

      expect(byId.get(hold.reservationId)).toMatchObject({
        status: "expired",
        system_actor: true,
        released: 1,
        via: "reaper"
      });
      // A hold that has not run out is none of its business.
      expect(byId.get(liveHold.reservationId)).toMatchObject({
        status: "held",
        released: 0
      });
    });

    test("the worker holds NO privilege on the booking tables: it cannot read, confirm, cancel, release or write history directly", async () => {
      const tenantId = "b9390000-0000-4000-8000-0000000000b2";

      await seedTenant(tenantId, "alloc-b2");

      const fixture = await newFixture(tenantId);
      const hold = await placed(tenantId, fixture);
      const allocationId = hold.units[0]!.allocationId;
      const attempts: [string, () => Promise<unknown>][] = [
        [
          "read reservations",
          () =>
            workerTx(
              tenantId,
              (tx) => tx`SELECT id FROM awcms_booking_reservations`
            )
        ],
        [
          "read allocations",
          () =>
            workerTx(
              tenantId,
              (tx) => tx`SELECT id FROM awcms_booking_resource_allocations`
            )
        ],
        [
          "confirm a hold",
          () =>
            workerTx(
              tenantId,
              (tx) => tx`
                UPDATE awcms_booking_reservations
                SET status = 'confirmed', hold_expires_at = NULL
                WHERE id = ${hold.reservationId}
              `
            )
        ],
        [
          "cancel a reservation",
          () =>
            workerTx(
              tenantId,
              (tx) => tx`
                UPDATE awcms_booking_reservations
                SET status = 'cancelled' WHERE id = ${hold.reservationId}
              `
            )
        ],
        [
          "release an allocation",
          () =>
            workerTx(
              tenantId,
              (tx) => tx`
                UPDATE awcms_booking_resource_allocations
                SET released_at = now(), released_reason = 'cancelled'
                WHERE id = ${allocationId}
              `
            )
        ],
        [
          "write a history row",
          () =>
            workerTx(
              tenantId,
              (tx) => tx`
                INSERT INTO awcms_booking_reservation_events
                  (tenant_id, reservation_id, seq, kind, to_status)
                VALUES (${tenantId}, ${hold.reservationId}, 99, 'cancelled', 'cancelled')
              `
            )
        ],
        [
          "delete a reservation",
          () =>
            workerTx(
              tenantId,
              (tx) => tx`
                DELETE FROM awcms_booking_reservations WHERE id = ${hold.reservationId}
              `
            )
        ]
      ];

      for (const [what, attempt] of attempts) {
        const message = await rejectedMessage(attempt());

        expect({ what, denied: denied.test(message) }).toEqual({
          what,
          denied: true
        });
      }

      // Nothing moved.
      const status = (await getAdminSql()`
        SELECT status FROM awcms_booking_reservations WHERE id = ${hold.reservationId}
      `) as { status: string }[];

      expect(status[0]!.status).toBe("held");
      expect(await liveAllocations(fixture.resourceId)).toBe(1);
    });

    test("it can only expire: even a function call cannot confirm or touch a hold that has not run out", async () => {
      const tenantId = "b9390000-0000-4000-8000-0000000000b3";

      await seedTenant(tenantId, "alloc-b3");

      const fixture = await newFixture(tenantId);
      const hold = await placed(tenantId, fixture, { holdSeconds: 3600 });
      const outcome = await workerTx(tenantId, (tx) =>
        expireDueHolds(tx, tenantId, 1000)
      );

      expect(outcome).toMatchObject({ expired: 0, releasedAllocations: 0 });

      const rows = (await getAdminSql()`
        SELECT status, hold_expires_at IS NOT NULL AS still_a_hold
        FROM awcms_booking_reservations WHERE id = ${hold.reservationId}
      `) as { status: string; still_a_hold: boolean }[];

      expect(rows[0]).toEqual({ status: "held", still_a_hold: true });
    });

    test("EXECUTE is the worker's alone: the runtime role cannot call the sweep or the count", async () => {
      const message = await rejectedMessage(
        tenantTx(TENANT_A, (tx) => expireDueHolds(tx, TENANT_A))
      );

      expect(message).toMatch(denied);

      const countMessage = await rejectedMessage(
        tenantTx(TENANT_A, (tx) => countDueHolds(tx, TENANT_A))
      );

      expect(countMessage).toMatch(denied);
    });

    test("the function refuses a tenant that is not the session's, and a session with no tenant at all", async () => {
      const wrongTenant = await rejectedMessage(
        workerTx(TENANT_A, (tx) => expireDueHolds(tx, TENANT_B))
      );

      expect(wrongTenant).toContain("session tenant context");

      const wrongCount = await rejectedMessage(
        workerTx(TENANT_A, (tx) => countDueHolds(tx, TENANT_B))
      );

      expect(wrongCount).toContain("session tenant context");

      const noTenant = await rejectedMessage(
        getWorkerRoleSql().begin((tx) => expireDueHolds(tx, TENANT_A))
      );

      expect(noTenant).toContain("session tenant context");
    });

    test("it sweeps only the session's tenant, however many other tenants have elapsed holds", async () => {
      const tenantX = "b9390000-0000-4000-8000-0000000000b4";
      const tenantY = "b9390000-0000-4000-8000-0000000000b5";

      await seedTenant(tenantX, "alloc-b4");
      await seedTenant(tenantY, "alloc-b5");

      const x = await placed(tenantX, await newFixture(tenantX));
      const y = await placed(tenantY, await newFixture(tenantY));

      await backdateHold(x.reservationId);
      await backdateHold(y.reservationId);

      expect(
        await workerTx(tenantX, (tx) => expireDueHolds(tx, tenantX))
      ).toMatchObject({ expired: 1, releasedAllocations: 1 });

      const rows = (await getAdminSql()`
        SELECT id, status FROM awcms_booking_reservations
        WHERE id IN (${x.reservationId}, ${y.reservationId})
      `) as { id: string; status: string }[];
      const byId = new Map(rows.map((row) => [row.id, row.status]));

      expect(byId.get(x.reservationId)).toBe("expired");
      expect(byId.get(y.reservationId)).toBe("held");
      expect(await workerTx(tenantY, (tx) => countDueHolds(tx, tenantY))).toBe(
        1
      );
    });

    test("a batch size the caller invents is clamped, not obeyed", async () => {
      const tenantId = "b9390000-0000-4000-8000-0000000000b6";

      await seedTenant(tenantId, "alloc-b6");

      for (let index = 0; index < 3; index += 1) {
        const hold = await placed(tenantId, await newFixture(tenantId));

        await backdateHold(hold.reservationId);
      }

      // 0 and negative clamp UP to one hold per call; the tenant has three.
      // (The function returns one row per expired reservation since sql/209.)
      const raw = (limit: number) =>
        workerTx(
          tenantId,
          (tx) =>
            tx`SELECT count(*)::int AS expired_count FROM awcms_booking_expire_due_holds(${tenantId}::uuid, ${limit}::integer)`
        ) as Promise<{ expired_count: number }[]>;

      expect((await raw(0))[0]!.expired_count).toBe(1);
      expect((await raw(-5))[0]!.expired_count).toBe(1);
      expect(
        await workerTx(tenantId, (tx) => countDueHolds(tx, tenantId))
      ).toBe(1);
      expect((await raw(1_000_000))[0]!.expired_count).toBe(1);
    });

    test("the reaper and lazy reclaim leave the SAME rows (two implementations, one end state)", async () => {
      const tenantId = "b9390000-0000-4000-8000-0000000000b7";

      await seedTenant(tenantId, "alloc-b7");

      const viaReclaim = await newFixture(tenantId);
      const viaReaper = await newFixture(tenantId);
      const a = await placed(tenantId, viaReclaim);
      const b = await placed(tenantId, viaReaper);

      await backdateHold(a.reservationId);

      // Lazy reclaim first, so the reaper has exactly one hold left to take.
      const reclaimed = await tenantTx(tenantId, (tx) =>
        reclaimExpiredHolds(tx, tenantId, [viaReclaim.resourceId], {
          kind: "time",
          fromMs: START,
          toMs: START + 3_600_000
        })
      );

      await backdateHold(b.reservationId);

      const swept = await workerTx(tenantId, (tx) =>
        expireDueHolds(tx, tenantId)
      );

      expect(reclaimed).toMatchObject({ expired: 1, releasedAllocations: 1 });
      expect(swept).toMatchObject({ expired: 1, releasedAllocations: 1 });

      const footprint = async (reservationId: string) => {
        const reservation = (await getAdminSql()`
          SELECT status, status_changed_by IS NULL AS system_actor,
                 hold_expires_at IS NOT NULL AS keeps_expiry
          FROM awcms_booking_reservations WHERE id = ${reservationId}
        `) as Record<string, unknown>[];
        const allocations = (await getAdminSql()`
          SELECT a.released_reason, a.released_at IS NOT NULL AS released
          FROM awcms_booking_resource_allocations a
          JOIN awcms_booking_reservation_items i ON i.id = a.item_id
          WHERE i.reservation_id = ${reservationId}
        `) as Record<string, unknown>[];
        const events = (await getAdminSql()`
          SELECT seq, kind, from_status, to_status,
                 actor_user_id IS NULL AS system_actor,
                 detail->>'trigger' AS via,
                 (detail - 'trigger' - 'holdExpiredAt') AS rest,
                 (detail ? 'holdExpiredAt') AS has_instant
          FROM awcms_booking_reservation_events
          WHERE reservation_id = ${reservationId} AND kind = 'expired'
          ORDER BY seq
        `) as Record<string, unknown>[];

        return { reservation, allocations, events };
      };

      const left = await footprint(a.reservationId);
      const right = await footprint(b.reservationId);

      expect(left.events[0]!.via).toBe("lazy_reclaim");
      expect(right.events[0]!.via).toBe("reaper");

      const normalise = (value: Awaited<ReturnType<typeof footprint>>) => ({
        ...value,
        events: value.events.map((event) => ({ ...event, via: undefined }))
      });

      expect(normalise(left)).toEqual(normalise(right));
      expect(left.reservation[0]).toEqual({
        status: "expired",
        system_actor: true,
        keeps_expiry: true
      });
    });
  });

  describe("T7 -- the test detects the defect", () => {
    test("WITHOUT the exclusion constraint two overlapping claims both commit (so T2's assertion is not vacuous)", async () => {
      const admin = getAdminSql();
      const definition = (await admin`
        SELECT pg_get_constraintdef(oid) AS def
        FROM pg_constraint
        WHERE conname = 'awcms_booking_resource_allocations_time_excl'
      `) as { def: string }[];

      expect(definition).toHaveLength(1);

      const tenantId = "b9390000-0000-4000-8000-0000000000e1";

      await seedTenant(tenantId, "alloc-e1");

      let live = 0;
      let overlappingPairs = 0;
      // An `immediate` offering: the claim is a confirmed reservation, not a hold,
      // so it takes no tenant cap lock (Issue #941). A held claim would, by design,
      // make B wait for A's commit on that lock, and this test keeps A open on
      // purpose while B runs.
      const fixture = await newFixture(tenantId, {
        confirmation: "immediate"
      });

      try {
        await admin.unsafe(
          "ALTER TABLE awcms_booking_resource_allocations DROP CONSTRAINT awcms_booking_resource_allocations_time_excl"
        );

        // Deterministic, not a race: A claims the unit and stays UNCOMMITTED; B
        // claims the overlapping range while A is open; then both commit. With
        // the constraint B would block on A (proved above); without it B
        // completes at once, so the await below returns instead of hanging.
        let aClaimed!: () => void;
        const claimed = new Promise<void>((resolve) => {
          aClaimed = resolve;
        });
        let commitA!: () => void;
        const gate = new Promise<void>((resolve) => {
          commitA = resolve;
        });
        const first = tenantTx(tenantId, async (tx) => {
          const outcome = await placeHold(
            tx,
            {
              tenantId,
              staff: NO_OP_STAFF_AVAILABILITY,
              actorTenantUserId: ACTORS.get(tenantId) ?? null
            },
            claim(fixture)
          );

          aClaimed();
          await gate;
          return outcome;
        });

        await claimed;

        const second = await place(
          tenantId,
          claim(fixture, { startsAtMs: START + 30 * 60_000 })
        );

        commitA();

        const a = await first;

        expect(a.outcome).toBe("ok");
        expect(second.outcome).toBe("ok");
        live = await liveAllocations(fixture.resourceId);

        // The #1087 diagnostic query must SEE this pair, with its evidence.
        const pairs = await overlappingLiveAllocations(fixture.resourceId);

        expect(pairs[0]).toMatchObject({
          a_released_at: null,
          b_released_at: null
        });
        expect(Object.keys(pairs[0] ?? {})).toEqual(
          expect.arrayContaining(["a_xmin", "b_xmin", "a_range", "snapshot"])
        );
        overlappingPairs = pairs.length;
      } finally {
        // Put the schema back EXACTLY: the rows written without the constraint
        // violate it, so the booking tables are emptied first (test database
        // only).
        await admin.unsafe(`
          TRUNCATE awcms_booking_reservation_events, awcms_booking_resource_allocations,
                   awcms_booking_reservation_items, awcms_booking_reminder_intents,
                   awcms_booking_staff_assignments, awcms_booking_reservations
        `);
        await admin.unsafe(
          `ALTER TABLE awcms_booking_resource_allocations
             ADD CONSTRAINT awcms_booking_resource_allocations_time_excl ${definition[0]!.def}`
        );
      }

      expect(live).toBe(2);
      expect(overlappingPairs).toBe(1);

      const restored = (await admin`
        SELECT pg_get_constraintdef(oid) AS def
        FROM pg_constraint
        WHERE conname = 'awcms_booking_resource_allocations_time_excl'
      `) as { def: string }[];

      expect(restored[0]!.def).toBe(definition[0]!.def);
    });
  });
});
