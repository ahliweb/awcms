/**
 * Implementation of `bun run bench:booking` (entry: `scripts/bench-booking.ts`).
 * It lives under `tests/bench/` because it seeds a throwaway database through
 * the admin connection exactly as the integration tests do, and the
 * table-write-ownership gate scans `scripts/*.ts` for production writes.
 *
 * Reproducible load / stress / concurrency benchmarks for `booking` and
 * `hr_workforce` attendance ingest (Issue #967, epic ahliweb/awcms-one#280 item
 * 34). `bun run bench:booking`.
 *
 * WHY A SEPARATE TARGET. A benchmark asserts on WALL-CLOCK TIME, and a timing
 * assertion in `bun test` is a flaky test (a shared CI runner, a noisy
 * neighbour, a cold cache). So this file is NOT a `*.test.ts`: `bun test` and
 * `bun test tests/integration/` never discover it, and it is deliberately not in
 * the `bun run check` chain. Two kinds of check live here and they are kept
 * apart:
 *
 *   * INVARIANTS (always enforced, exit 1): exactly one winner for the last
 *     slot/night, `capacity` winners for a pool, no live allocation beyond the
 *     claims that won, every elapsed hold expired by the reaper, every attendance
 *     event recorded exactly once, a replay a replay. These are correctness under
 *     load, not timing, and they do not flake.
 *   * THRESHOLDS (enforced by default, `--no-thresholds`
 *     to only report): p95 latency and throughput floors, set with a wide margin
 *     over the numbers recorded in `docs/awcms/booking-benchmarks.md` so ordinary
 *     machine variance does not trip them but an order-of-magnitude regression
 *     (a lost index, an N+1, a lock held across a round trip) does.
 *
 * It follows the repo's existing performance-gate shape: a `scripts/*.ts` target
 * with a documented budget (`build:asset-budget:check`) that is run on demand or
 * in a dedicated lane, never in the default unit suite
 * (`docs/awcms/performance-suite.md`).
 *
 * WHAT IT RUNS AGAINST. The integration harness's throwaway database
 * (`tests/integration/harness.ts`): the real migrations, the least-privilege
 * runtime role `awcms_app` with FORCE RLS in effect, and `awcms_worker` for the
 * reaper -- the production roles, not a superuser shortcut. It needs the same
 * superuser `DATABASE_URL` the integration suite needs and refuses to run
 * without it. It never touches the database that URL names beyond creating (and
 * dropping) its own `awcms_it_<pid>` database.
 *
 * WHAT IT MEASURES (each connection is its own pooled connection and its own
 * transaction, the production transaction shape `withTenant` without the
 * in-process work-class gate, so the DATABASE sees every contender at once):
 *
 *   1. last-slot / last-night / pool-of-K claims at N concurrent workers
 *   2. availability read latency at a stated resource count and backlog
 *   3. the hold-expiry reaper draining a backlog, with claims racing it
 *   4. attendance event ingest rate (recorded + replayed)
 *
 * Usage: bun run bench:booking [--profile smoke|standard] [--json <file>]
 *                              [--no-thresholds]
 */
import { writeFileSync } from "node:fs";

import {
  createRuntimePool,
  getAdminSql,
  getWorkerRoleSql,
  integrationEnabled,
  reassertRuntimeRoleLogins,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "../integration/harness";
import { answerAvailability } from "../../src/modules/booking/application/booking-availability-directory";
import { placeHold } from "../../src/modules/booking/application/booking-hold-service";
import { runBookingHoldExpiry } from "../../src/modules/booking/application/booking-hold-expiry-job";
import type { PlaceHoldInput } from "../../src/modules/booking/domain/booking-allocation";
import { NO_OP_STAFF_AVAILABILITY } from "../../src/modules/booking/domain/booking-staff-availability";
import { recordEvent } from "../../src/modules/hr-workforce/application/hr-attendance-directory";

// --- Profiles and thresholds -------------------------------------------------

type Profile = {
  name: "smoke" | "standard";
  /** Rounds of each race (a round = one fresh fixture, N simultaneous claims). */
  raceRounds: number;
  raceWorkers: readonly number[];
  availabilityResources: number;
  availabilityHoldsPerResource: number;
  availabilityQueries: number;
  reaperBacklog: number;
  reaperResources: number;
  attendanceEmployments: number;
  attendanceEvents: number;
  attendanceReplays: number;
  workers: number;
};

const PROFILES: Record<Profile["name"], Profile> = {
  smoke: {
    name: "smoke",
    raceRounds: 3,
    raceWorkers: [8],
    availabilityResources: 20,
    availabilityHoldsPerResource: 2,
    availabilityQueries: 40,
    reaperBacklog: 200,
    reaperResources: 10,
    attendanceEmployments: 20,
    attendanceEvents: 200,
    attendanceReplays: 50,
    workers: 8
  },
  standard: {
    name: "standard",
    raceRounds: 30,
    raceWorkers: [8, 32],
    availabilityResources: 500,
    availabilityHoldsPerResource: 4,
    availabilityQueries: 400,
    reaperBacklog: 5000,
    reaperResources: 100,
    attendanceEmployments: 200,
    attendanceEvents: 5000,
    attendanceReplays: 1000,
    workers: 16
  }
};

/**
 * Budgets for the `standard` profile. Each is a margin over the recorded
 * baseline (docs/awcms/booking-benchmarks.md), not the baseline itself: a
 * threshold at the measured value would be a flaky assertion by another name.
 * Applied only to the `standard` profile; `smoke` checks invariants alone,
 * because a handful of samples has no meaningful p95.
 */
export const THRESHOLDS = {
  /** p95 of ONE claim inside a race, ms (includes waiting on the winner's lock). */
  raceClaimP95Ms: 1500,
  /** p95 of one availability answer, sequential, ms. */
  availabilityP95Ms: 250,
  /** p95 of one availability answer with `workers` readers in flight, ms. */
  availabilityConcurrentP95Ms: 750,
  /** Reaper throughput while draining a backlog, holds expired per second. */
  reaperMinHoldsPerSecond: 100,
  /** p95 of a claim placed while the reaper drains, ms. */
  claimDuringReaperP95Ms: 1500,
  /** Attendance ingest, events recorded per second at `workers` writers. */
  attendanceMinEventsPerSecond: 100,
  /** p95 of one attendance record, ms. */
  attendanceP95Ms: 500
} as const;

// --- CLI ---------------------------------------------------------------------

function parseArgs(argv: string[]) {
  let profileName: Profile["name"] = "standard";
  let jsonPath: string | null = null;
  let thresholds = true;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;

    if (arg === "--profile") {
      const value = argv[(index += 1)];

      if (value !== "smoke" && value !== "standard") {
        throw new Error("--profile must be smoke or standard");
      }

      profileName = value;
    } else if (arg === "--json") {
      jsonPath = argv[(index += 1)] ?? null;
    } else if (arg === "--no-thresholds") {
      thresholds = false;
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }

  return { profile: PROFILES[profileName], jsonPath, thresholds };
}

// --- Statistics --------------------------------------------------------------

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }

  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );

  return sorted[index]!;
}

type Latency = {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
};

function latencyOf(samples: readonly number[]): Latency {
  const sorted = [...samples].sort((a, b) => a - b);
  const round = (value: number) => Math.round(value * 100) / 100;

  return {
    count: sorted.length,
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted[sorted.length - 1] ?? 0)
  };
}

async function timed<T>(samples: number[], work: () => Promise<T>): Promise<T> {
  const start = performance.now();

  try {
    return await work();
  } finally {
    samples.push(performance.now() - start);
  }
}

/** Runs `total` jobs with at most `concurrency` in flight; a thrown job fails the run. */
async function pooled(
  total: number,
  concurrency: number,
  job: (index: number) => Promise<void>
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = next;
      next += 1;

      if (index >= total) {
        return;
      }

      await job(index);
    }
  });

  await Promise.all(lanes);
}

// --- Reporting, invariants, thresholds ---------------------------------------

const results: Record<string, unknown> = {};
const violations: string[] = [];

function invariant(condition: boolean, message: string): void {
  if (!condition) {
    violations.push(`INVARIANT ${message}`);
  }
}

let enforceThresholds = true;
let activeProfile: Profile = PROFILES.standard;

function budget(
  name: string,
  actual: number,
  limit: number,
  kind: "max" | "min"
) {
  if (!enforceThresholds || activeProfile.name !== "standard") {
    return;
  }

  const ok = kind === "max" ? actual <= limit : actual >= limit;

  if (!ok) {
    violations.push(
      `THRESHOLD ${name}: ${actual} ${kind === "max" ? "exceeds" : "is below"} ${limit}`
    );
  }
}

function logSection(title: string, body: unknown): void {
  console.log(`\n== ${title}`);
  console.log(JSON.stringify(body, null, 2));
}

// --- Fixtures ----------------------------------------------------------------

type Sql = Bun.SQL;
let pool: Sql;
let tenantSeq = 0;
let codeSeq = 0;

type Tenant = { id: string; actor: string };

async function seedTenant(label: string): Promise<Tenant> {
  // Every section starts here: re-open the shared roles another process's
  // teardown may have shut while this long run was going.
  await reassertRuntimeRoleLogins();
  tenantSeq += 1;
  const id = `b9670000-0000-4000-8000-${String(tenantSeq).padStart(12, "0")}`;
  const code = `bench-${label}-${tenantSeq}`;
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${id}, ${code}, ${`Bench ${code}`})
  `;

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${id}, 'person', ${`Actor ${code}`}) RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${id}, ${profile[0]!.id}, ${`${code}@example.com`}, 'x') RETURNING id
  `) as { id: string }[];
  const user = (await admin`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${id}, ${identity[0]!.id}) RETURNING id
  `) as { id: string }[];

  // The module's default caps (500 live holds per tenant, 5 per customer) are
  // abuse limits; a backlog benchmark would just measure the 429. Raise them
  // for the bench tenant only.
  await admin`
    INSERT INTO awcms_booking_settings
      (tenant_id, max_active_holds_per_tenant, max_active_holds_per_customer)
    VALUES (${id}, 1000000, 1000000)
  `;

  return { id, actor: user[0]!.id };
}

function tenantTx<T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return pool.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
    return fn(tx);
  });
}

type Fixture = { resourceId: string; offeringId: string };

/** One resource of `capacity` units and an offering of the matching mode. */
async function newFixture(
  tenantId: string,
  mode: "slot" | "stay",
  capacity = 1
): Promise<Fixture> {
  const admin = getAdminSql();
  codeSeq += 1;
  const code = `f${codeSeq}`;
  const resource = (await admin`
    INSERT INTO awcms_booking_resources
      (tenant_id, code, name, kind, capacity, timezone, booking_mode,
       stay_check_in_time, stay_check_out_time)
    VALUES (${tenantId}, ${code}, ${`Room ${code}`}, 'room', ${capacity},
            'Asia/Pontianak', ${mode},
            ${mode === "stay" ? "14:00" : null}::time,
            ${mode === "stay" ? "12:00" : null}::time)
    RETURNING id
  `) as { id: string }[];

  await admin`
    INSERT INTO awcms_booking_resource_units (tenant_id, resource_id, ordinal)
    SELECT ${tenantId}, ${resource[0]!.id}, g FROM generate_series(1, ${capacity}::int) g
  `;

  const offering =
    mode === "stay"
      ? ((await admin`
          INSERT INTO awcms_booking_service_offerings
            (tenant_id, code, name, granularity, min_nights, max_nights,
             max_party, confirmation_mode)
          VALUES (${tenantId}, ${`n-${code}`}, 'Night', 'stay', 1, 30, 4,
                  'hold_then_confirm') RETURNING id
        `) as { id: string }[])
      : ((await admin`
          INSERT INTO awcms_booking_service_offerings
            (tenant_id, code, name, granularity, duration_seconds, setup_seconds,
             cleanup_seconds, slot_step_seconds, max_party, confirmation_mode)
          VALUES (${tenantId}, ${`h-${code}`}, 'Hour', 'time', 3600, 0, 0, 900, 4,
                  'hold_then_confirm') RETURNING id
        `) as { id: string }[]);

  return { resourceId: resource[0]!.id, offeringId: offering[0]!.id };
}

/** A whole hour three days ahead, so no lead-time or past-slot rule is in play. */
const SLOT_BASE =
  Math.ceil((Date.now() + 3 * 86_400_000) / 3_600_000) * 3_600_000;

function slotClaim(fixture: Fixture, startsAtMs: number): PlaceHoldInput {
  return {
    offeringId: fixture.offeringId,
    resourceId: fixture.resourceId,
    startsAtMs,
    partySize: 1,
    quantity: 1
  };
}

function stayClaim(fixture: Fixture): PlaceHoldInput {
  return {
    offeringId: fixture.offeringId,
    resourceId: fixture.resourceId,
    stay: { checkInDate: "2031-06-10", checkOutDate: "2031-06-11" },
    partySize: 1,
    quantity: 1
  };
}

type Outcome = Awaited<ReturnType<typeof placeHold>>;

function claimOnce(tenant: Tenant, input: PlaceHoldInput): Promise<Outcome> {
  return tenantTx(tenant.id, (tx) =>
    placeHold(
      tx,
      {
        tenantId: tenant.id,
        staff: NO_OP_STAFF_AVAILABILITY,
        actorTenantUserId: tenant.actor,
        correlationId: crypto.randomUUID()
      },
      input
    )
  );
}

async function liveAllocations(resourceId: string): Promise<number> {
  const rows = (await getAdminSql()`
    SELECT count(*)::int AS n FROM awcms_booking_resource_allocations
    WHERE resource_id = ${resourceId} AND released_at IS NULL
  `) as { n: number }[];

  return rows[0]!.n;
}

// --- 1. Races ----------------------------------------------------------------

async function raceRound(
  tenant: Tenant,
  kind: "slot" | "stay",
  capacity: number,
  workers: number,
  samples: number[]
): Promise<{ wins: number; refusals: number; wallMs: number }> {
  const fixture = await newFixture(tenant.id, kind, capacity);
  const input =
    kind === "slot" ? slotClaim(fixture, SLOT_BASE) : stayClaim(fixture);
  let go!: () => void;
  const start = new Promise<void>((resolve) => {
    go = resolve;
  });
  const contenders = Array.from({ length: workers }, async () => {
    await start;
    return timed(samples, () => claimOnce(tenant, input));
  });
  const began = performance.now();

  go();

  const settled = await Promise.allSettled(contenders);
  const wallMs = performance.now() - began;
  const threw = settled.filter((s) => s.status === "rejected");

  invariant(
    threw.length === 0,
    `${kind} race: ${threw.length} contender(s) threw instead of returning a refusal`
  );

  const outcomes = settled
    .filter(
      (s): s is PromiseFulfilledResult<Outcome> => s.status === "fulfilled"
    )
    .map((s) => s.value);
  const wins = outcomes.filter((o) => o.outcome === "ok").length;
  const refused = outcomes.filter(
    (o) => o.outcome === "refused" && o.code === "SLOT_UNAVAILABLE"
  ).length;

  invariant(
    wins === Math.min(capacity, workers),
    `${kind} race capacity ${capacity} x ${workers} workers: ${wins} winner(s), expected ${Math.min(capacity, workers)}`
  );
  invariant(
    wins + refused === workers,
    `${kind} race: ${workers - wins - refused} contender(s) ended neither ok nor SLOT_UNAVAILABLE`
  );
  invariant(
    (await liveAllocations(fixture.resourceId)) === wins,
    `${kind} race: live allocations differ from the winners (double allocation or a partial claim left behind)`
  );

  return { wins, refusals: refused, wallMs };
}

async function benchRaces(profile: Profile): Promise<void> {
  const tenant = await seedTenant("race");
  const report: Record<string, unknown> = {};

  for (const workers of profile.raceWorkers) {
    for (const [name, kind, capacity] of [
      ["last_slot", "slot", 1],
      ["last_night", "stay", 1],
      ["pool_of_3", "slot", 3]
    ] as const) {
      const samples: number[] = [];
      const walls: number[] = [];

      for (let round = 0; round < profile.raceRounds; round += 1) {
        walls.push(
          (await raceRound(tenant, kind, capacity, workers, samples)).wallMs
        );
      }

      const claim = latencyOf(samples);

      report[`${name}_${workers}_workers`] = {
        rounds: profile.raceRounds,
        claimMs: claim,
        roundWallMs: latencyOf(walls)
      };
      budget(
        `${name}@${workers} claim p95 ms`,
        claim.p95,
        THRESHOLDS.raceClaimP95Ms,
        "max"
      );
    }
  }

  results.races = report;
  logSection(
    "1. concurrent claims (last slot / last night / pool of 3)",
    report
  );
}

// --- 2. Availability reads ---------------------------------------------------

async function benchAvailability(profile: Profile): Promise<void> {
  const tenant = await seedTenant("avail");
  const admin = getAdminSql();
  const resources = profile.availabilityResources;
  const everyDay = {
    weekly: Object.fromEntries(
      ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [
        day,
        [{ from: "08:00", to: "20:00" }]
      ])
    )
  };

  const offering = (await admin`
    INSERT INTO awcms_booking_service_offerings
      (tenant_id, code, name, granularity, duration_seconds, setup_seconds,
       cleanup_seconds, slot_step_seconds, max_party, confirmation_mode)
    VALUES (${tenant.id}, 'avail-hour', 'Hour', 'time', 3600, 0, 0, 900, 4,
            'hold_then_confirm') RETURNING id
  `) as { id: string }[];
  const rows = (await admin`
    INSERT INTO awcms_booking_resources
      (tenant_id, code, name, kind, capacity, timezone)
    SELECT ${tenant.id}, 'ar' || g, 'Room ' || g, 'room', 2, 'Asia/Pontianak'
    FROM generate_series(1, ${resources}::int) g
    RETURNING id
  `) as { id: string }[];
  const ids = rows.map((row) => row.id);

  await admin`
    INSERT INTO awcms_booking_resource_units (tenant_id, resource_id, ordinal)
    SELECT ${tenant.id}, r, o
    FROM unnest(${admin.array(ids, "UUID")}::uuid[]) r, generate_series(1, 2) o
  `;
  await admin`
    INSERT INTO awcms_booking_schedules
      (tenant_id, resource_id, timezone, effective_from, rules, status)
    SELECT ${tenant.id}, r, 'Asia/Pontianak', '2020-01-01'::date,
           ${everyDay as object}::jsonb, 'active'
    FROM unnest(${admin.array(ids, "UUID")}::uuid[]) r
  `;

  // Existing load: holds spread across the day, so the read has real
  // allocations to subtract (resources x holds-per-resource of them).
  const placeStarted = performance.now();
  const holds = resources * profile.availabilityHoldsPerResource;
  let placed = 0;

  await pooled(holds, profile.workers, async (index) => {
    const resourceId = ids[index % resources]!;
    const slot = Math.floor(index / resources);
    const outcome = await claimOnce(
      tenant,
      slotClaim(
        { resourceId, offeringId: offering[0]!.id },
        SLOT_BASE + slot * 3_600_000
      )
    );

    if (outcome.outcome === "ok") {
      placed += 1;
    }
  });
  invariant(
    placed === holds,
    `availability seed: ${placed}/${holds} holds placed`
  );
  const seedMs = performance.now() - placeStarted;

  const ask = (index: number) =>
    tenantTx(tenant.id, (tx) =>
      answerAvailability(tx, tenant.id, {
        mode: "slot",
        resourceId: ids[index % resources]!,
        offeringId: offering[0]!.id,
        quantity: 1,
        fromMs: SLOT_BASE - 3_600_000,
        toMs: SLOT_BASE + 7 * 86_400_000,
        limit: 200
      })
    );

  // Warm the plan cache and the pool once; not measured.
  await ask(0);

  const sequential: number[] = [];
  let answered = 0;

  for (let index = 0; index < profile.availabilityQueries; index += 1) {
    const outcome = await timed(sequential, () => ask(index));

    if (outcome.outcome === "ok") {
      answered += 1;
    }
  }

  const concurrent: number[] = [];
  const began = performance.now();

  await pooled(profile.availabilityQueries, profile.workers, async (index) => {
    const outcome = await timed(concurrent, () => ask(index));

    if (outcome.outcome === "ok") {
      answered += 1;
    }
  });

  const wallMs = performance.now() - began;

  invariant(
    answered === profile.availabilityQueries * 2,
    `availability: ${answered}/${profile.availabilityQueries * 2} questions answered ok`
  );

  const sequentialLatency = latencyOf(sequential);
  const concurrentLatency = latencyOf(concurrent);

  results.availability = {
    resources,
    unitsPerResource: 2,
    liveHolds: holds,
    windowDays: 7,
    seedMs: Math.round(seedMs),
    sequentialMs: sequentialLatency,
    concurrentMs: concurrentLatency,
    concurrentWorkers: profile.workers,
    concurrentQueriesPerSecond: Math.round(
      (profile.availabilityQueries / wallMs) * 1000
    )
  };
  logSection(
    `2. availability read (${resources} resources, ${holds} live holds, 7-day window)`,
    results.availability
  );
  budget(
    "availability p95 ms",
    sequentialLatency.p95,
    THRESHOLDS.availabilityP95Ms,
    "max"
  );
  budget(
    "availability concurrent p95 ms",
    concurrentLatency.p95,
    THRESHOLDS.availabilityConcurrentP95Ms,
    "max"
  );
}

// --- 3. Hold-expiry reaper under backlog --------------------------------------

async function benchReaper(profile: Profile): Promise<void> {
  const tenant = await seedTenant("reaper");
  const admin = getAdminSql();
  const resourceCount = profile.reaperResources;
  const perResource = Math.ceil(profile.reaperBacklog / resourceCount);
  const fixtures: Fixture[] = [];

  for (let index = 0; index < resourceCount; index += 1) {
    fixtures.push(await newFixture(tenant.id, "slot", 1));
  }

  let placed = 0;

  await pooled(resourceCount * perResource, profile.workers, async (index) => {
    const outcome = await claimOnce(
      tenant,
      slotClaim(
        fixtures[index % resourceCount]!,
        SLOT_BASE + Math.floor(index / resourceCount) * 3_600_000
      )
    );

    if (outcome.outcome === "ok") {
      placed += 1;
    }
  });
  invariant(
    placed === resourceCount * perResource,
    `reaper seed: ${placed}/${resourceCount * perResource} holds placed`
  );

  // Make every hold elapsed, through SQL: the database clock is the only clock
  // and the update guard forbids shortening a hold, so it is lifted for this
  // one statement exactly as the concurrency suite does.
  await admin.begin(async (tx) => {
    await tx.unsafe(
      "ALTER TABLE awcms_booking_reservations DISABLE TRIGGER awcms_booking_reservations_update_guard"
    );
    await tx`
      UPDATE awcms_booking_reservations
      SET hold_expires_at = clock_timestamp() - interval '2 seconds'
      WHERE tenant_id = ${tenant.id} AND status = 'held'
    `;
    await tx.unsafe(
      "ALTER TABLE awcms_booking_reservations ENABLE TRIGGER awcms_booking_reservations_update_guard"
    );
  });

  // Fresh resources for the claimers that race the drain, so they contend with
  // the reaper's locks and the table, not with each other.
  const racers: Fixture[] = [];

  for (let index = 0; index < 8; index += 1) {
    racers.push(await newFixture(tenant.id, "slot", 1));
  }

  const claimSamples: number[] = [];
  let draining = true;
  let racerRefusals = 0;
  let racerSlot = 0;
  const claimers = racers.map(async (fixture) => {
    while (draining) {
      const outcome = await timed(claimSamples, () =>
        claimOnce(
          tenant,
          slotClaim(fixture, SLOT_BASE + racerSlot++ * 3_600_000)
        )
      );

      if (outcome.outcome !== "ok") {
        racerRefusals += 1;
      }
    }
  });

  const context = () => ({
    runId: crypto.randomUUID(),
    correlationId: crypto.randomUUID(),
    dryRun: false,
    signal: new AbortController().signal
  });
  const runMs: number[] = [];
  let expired = 0;
  let released = 0;
  let runs = 0;
  const began = performance.now();

  // The job caps one run per tenant (a pass limit), so a backlog takes several
  // runs: exactly what the scheduler does. Loop until a run finds nothing.
  try {
    while (true) {
      await reassertRuntimeRoleLogins();

      const result = await timed(runMs, () =>
        runBookingHoldExpiry(getWorkerRoleSql(), context())
      );

      runs += 1;
      expired += result.holdsExpired;
      released += result.allocationsReleased;

      if (result.holdsExpired === 0 || runs > 1000) {
        break;
      }
    }
  } catch (error) {
    draining = false;
    await Promise.allSettled(claimers);
    throw error;
  }

  const drainMs = performance.now() - began;

  draining = false;
  await Promise.all(claimers);

  const backlog = resourceCount * perResource;
  const remaining = (await admin`
    SELECT count(*)::int AS n FROM awcms_booking_reservations
    WHERE tenant_id = ${tenant.id} AND status = 'held'
      AND hold_expires_at < clock_timestamp()
  `) as { n: number }[];

  invariant(
    expired === backlog,
    `reaper: expired ${expired}, backlog was ${backlog}`
  );
  invariant(
    released === backlog,
    `reaper: released ${released} allocations for ${backlog} holds`
  );
  invariant(
    remaining[0]!.n === 0,
    `reaper: ${remaining[0]!.n} elapsed hold(s) still held`
  );
  invariant(
    racerRefusals === 0,
    `reaper: ${racerRefusals} claim(s) racing the drain were refused (a reaper lock blocked a free slot)`
  );

  const perSecond = Math.round((expired / drainMs) * 1000);
  const claimLatency = latencyOf(claimSamples);

  results.reaper = {
    backlog,
    resources: resourceCount,
    runs,
    drainMs: Math.round(drainMs),
    holdsExpiredPerSecond: perSecond,
    runMs: latencyOf(runMs),
    claimsRacingTheDrain: claimLatency
  };
  logSection(
    `3. hold-expiry reaper draining ${backlog} elapsed holds`,
    results.reaper
  );
  budget(
    "reaper holds/s",
    perSecond,
    THRESHOLDS.reaperMinHoldsPerSecond,
    "min"
  );
  budget(
    "claim during reaper p95 ms",
    claimLatency.p95,
    THRESHOLDS.claimDuringReaperP95Ms,
    "max"
  );
}

// --- 4. Attendance ingest ------------------------------------------------------

async function benchAttendance(profile: Profile): Promise<void> {
  const tenant = await seedTenant("hr");
  const admin = getAdminSql();
  const count = profile.attendanceEmployments;

  const profiles = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    SELECT ${tenant.id}, 'person', 'Employee ' || g FROM generate_series(1, ${count}::int) g
    RETURNING id
  `) as { id: string }[];
  const employments = (await admin`
    INSERT INTO awcms_hr_employments (tenant_id, profile_id, employee_no, hired_on)
    SELECT ${tenant.id}, p, 'B-' || row_number() OVER (), '2026-01-01'
    FROM unnest(${admin.array(
      profiles.map((row) => row.id),
      "UUID"
    )}::uuid[]) p
    RETURNING id
  `) as { id: string }[];
  const ids = employments.map((row) => row.id);

  await admin`
    INSERT INTO awcms_hr_employment_terms
      (tenant_id, employment_id, employment_type, status, effective_from)
    SELECT ${tenant.id}, e, 'permanent', 'active', '2026-01-01'::date
    FROM unnest(${admin.array(ids, "UUID")}::uuid[]) e
  `;

  const kinds = ["clock_in", "break_start", "break_end", "clock_out"] as const;
  const eventFor = (index: number) => ({
    employmentId: ids[index % count]!,
    kind: kinds[index % kinds.length]!,
    // The server clock bounds a claimed instant: a second ago is "now" to a
    // self-recorded tap, and a distinct key makes each a new event.
    occurredAt: new Date(Date.now() - 1000),
    // ~10% are supervisor-recorded, the audited path (recorded for another).
    source: (index % 10 === 0 ? "supervisor" : "self") as "self" | "supervisor",
    clientEventKey: `bench-${index}`,
    officeId: null,
    positionSample: null
  });
  const record = (input: ReturnType<typeof eventFor>) =>
    tenantTx(tenant.id, (tx) =>
      recordEvent(
        tx,
        tenant.id,
        { actorTenantUserId: tenant.actor, correlationId: crypto.randomUUID() },
        input
      )
    );

  const total = profile.attendanceEvents;
  const samples: number[] = [];
  const originals = new Map<number, string>();
  let recorded = 0;
  let wrongOutcome = 0;
  const began = performance.now();

  await pooled(total, profile.workers, async (index) => {
    const outcome = await timed(samples, () => record(eventFor(index)));

    if (outcome.outcome === "ok" && !outcome.replayed) {
      recorded += 1;
      originals.set(index, outcome.event.id);
    } else {
      wrongOutcome += 1;
    }
  });

  const ingestMs = performance.now() - began;
  const perSecond = Math.round((recorded / ingestMs) * 1000);

  // Replays: an offline queue re-posting the same key must return the original.
  const replaySamples: number[] = [];
  let replayedOk = 0;
  const replays = Math.min(profile.attendanceReplays, total);

  await pooled(replays, profile.workers, async (index) => {
    // Same key, same kind/instant/source: the original instant is needed, so
    // reload it rather than guessing the clock.
    const original = originals.get(index);
    const stored = (await admin`
      SELECT occurred_at FROM awcms_hr_attendance_events WHERE id = ${original!}
    `) as { occurred_at: Date }[];
    const outcome = await timed(replaySamples, () =>
      record({
        ...eventFor(index),
        occurredAt: new Date(stored[0]!.occurred_at)
      })
    );

    if (
      outcome.outcome === "ok" &&
      outcome.replayed &&
      outcome.event.id === original
    ) {
      replayedOk += 1;
    }
  });

  const stored = (await admin`
    SELECT count(*)::int AS n FROM awcms_hr_attendance_events
    WHERE tenant_id = ${tenant.id}
  `) as { n: number }[];

  invariant(
    wrongOutcome === 0,
    `attendance: ${wrongOutcome} event(s) not recorded as new`
  );
  invariant(
    stored[0]!.n === total,
    `attendance: ${stored[0]!.n} rows stored for ${total} events (a replay wrote a second row, or an event was lost)`
  );
  invariant(
    replayedOk === replays,
    `attendance: ${replayedOk}/${replays} replays returned the original`
  );

  const latency = latencyOf(samples);

  results.attendance = {
    employments: count,
    events: total,
    writers: profile.workers,
    supervisorShare: "10%",
    ingestMs: Math.round(ingestMs),
    eventsPerSecond: perSecond,
    recordMs: latency,
    replayMs: latencyOf(replaySamples)
  };
  logSection(
    `4. attendance ingest (${total} events, ${profile.workers} writers)`,
    results.attendance
  );
  budget(
    "attendance events/s",
    perSecond,
    THRESHOLDS.attendanceMinEventsPerSecond,
    "min"
  );
  budget("attendance p95 ms", latency.p95, THRESHOLDS.attendanceP95Ms, "max");
}

// --- Environment ---------------------------------------------------------------

async function environment(): Promise<Record<string, unknown>> {
  const admin = getAdminSql();
  const version = (await admin`SELECT version() AS v`) as { v: string }[];
  const memory = (
    await Bun.file("/proc/meminfo")
      .text()
      .catch(() => "")
  ).split("\n")[0];
  const cpu = (
    await Bun.file("/proc/cpuinfo")
      .text()
      .catch(() => "")
  )
    .split("\n")
    .find((line) => line.startsWith("model name"));
  const os = await import("node:os");

  return {
    postgres: version[0]!.v.split(" on ")[0],
    cpuModel: cpu?.split(":")[1]?.trim() ?? os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    memory: memory?.replace(/\s+/g, " "),
    bun: Bun.version,
    runtimePoolSize: 32
  };
}

export async function main(): Promise<number> {
  if (!integrationEnabled) {
    console.error(
      "bench:booking needs a superuser DATABASE_URL (the integration harness's admin channel), e.g.\n  DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres bun run bench:booking"
    );
    return 2;
  }

  const args = parseArgs(process.argv.slice(2));

  activeProfile = args.profile;
  enforceThresholds = args.thresholds;

  await setupIntegrationDatabase();
  pool = createRuntimePool(Math.max(32, ...args.profile.raceWorkers) + 2);

  try {
    results.profile = args.profile.name;
    results.environment = await environment();
    logSection("environment", results.environment);

    await benchRaces(args.profile);
    await benchAvailability(args.profile);
    await benchReaper(args.profile);
    await benchAttendance(args.profile);
  } catch (error) {
    console.error("bench:booking aborted:", error);
    violations.push(
      `ABORTED ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await pool.close({ timeout: 1 });
    await teardownIntegrationDatabase();
  }

  results.thresholds = THRESHOLDS;
  results.violations = violations;

  if (args.jsonPath) {
    writeFileSync(args.jsonPath, `${JSON.stringify(results, null, 2)}\n`);
  }

  if (violations.length > 0) {
    console.error(`\nFAILED (${violations.length}):`);

    for (const violation of violations) {
      console.error(`  - ${violation}`);
    }

    return 1;
  }

  console.log(
    `\nOK: every invariant held${enforceThresholds && args.profile.name === "standard" ? " and every threshold passed" : " (thresholds not enforced)"}.`
  );

  return 0;
}
