/**
 * Findings C2 and C5 of the 17 August 2026 audit round — two reads with no
 * ceiling.
 *
 * They are one PR because they are one habit: a statement whose cost is
 * O(everything this tenant has ever accumulated), written where the author was
 * thinking about one subject or one cutoff. Neither is wrong on a small table
 * and neither has a size at which it starts being wrong loudly.
 *
 * Against a real PostgreSQL, and it has to be. C2's fix is only meaningful if
 * repeated passes make monotonic progress, which is a property of what the
 * previous pass actually deleted; C5's is a claim about which PLAN the planner
 * chooses, and a fake driver has no planner.
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
import { purgeVisitorAnalyticsData } from "../../src/modules/visitor-analytics/application/retention-purge";
import {
  loadColumnTypes,
  readSubjectExport
} from "../../src/modules/data-lifecycle/application/subject-data-executor";
import { buildSubjectPlan } from "../../src/modules/data-lifecycle/domain/subject-data-plan";
import { collectSubjectDataDescriptors } from "../../src/modules/data-lifecycle/domain/subject-data-registry";
import { listModules } from "../../src/modules";
import { stripComments } from "../../scripts/lib/source-text";
import { VISITOR_ANALYTICS_DEFAULTS } from "../../src/modules/visitor-analytics/domain/visitor-analytics-config";
import type { LegalHoldGuardPort } from "../../src/modules/_shared/ports/legal-hold-guard-port";

const suite = integrationEnabled ? describe : describe.skip;

const TENANT = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const SUBJECT = "c5c5c5c5-c5c5-4c5c-8c5c-c5c5c5c5c5c5";
// Distinct ids, never reused: `buildSubjectPlan` ORs the three, so sharing one
// value would make a match on the wrong column look like a match on the right
// one and the truncation assertions would be about the wrong row set.
const SUBJECT_IDENTITY = "c5c5c5c5-c5c5-4c5c-8c5c-c5c5c5c5c5c6";
const SUBJECT_PROFILE = "c5c5c5c5-c5c5-4c5c-8c5c-c5c5c5c5c5c7";
const NOW = new Date("2026-08-22T12:00:00.000Z");

/** No hold. The held path has its own test in `data-lifecycle-tenant-state`. */
const NO_HOLD: LegalHoldGuardPort = {
  async isDescriptorHeld() {
    return false;
  }
};

async function seedTenant(): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
    VALUES (${TENANT}, 'c2-bounds', 'C2 Bounds', 'active')
  `;
}

/** `count` visit events, all comfortably past the retention cutoff. */
async function seedOldEvents(count: number): Promise<void> {
  const old = new Date(
    NOW.getTime() -
      (VISITOR_ANALYTICS_DEFAULTS.eventRetentionDays + 30) * 86_400_000
  );

  await getAdminSql()`
    INSERT INTO awcms_visit_events
      (tenant_id, occurred_at, method, area, path_sanitized, human_status)
    SELECT ${TENANT}, ${old}::timestamptz + (g || ' seconds')::interval,
           'GET', 'public', '/x', 'human'
    FROM generate_series(1, ${count}) g
  `;
}

function purge(batchLimit: number) {
  return withTenantOrThrow(
    getRuntimeSql(),
    TENANT,
    (tx) =>
      purgeVisitorAnalyticsData(
        tx,
        TENANT,
        VISITOR_ANALYTICS_DEFAULTS,
        NOW,
        NO_HOLD,
        { batchLimit }
      ),
    { workClass: "maintenance" }
  );
}

async function remainingEvents(): Promise<number> {
  const rows = (await getAdminSql()`
    SELECT count(*)::int AS n FROM awcms_visit_events WHERE tenant_id = ${TENANT}
  `) as { n: number }[];

  return rows[0]!.n;
}

suite("reads that used to have no ceiling (C2, C5)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedTenant();
  });

  test("C2: a pass deletes at most its batch, and says there is more", async () => {
    await seedOldEvents(25);

    const first = await purge(10);

    expect(first.eventsDeleted).toBe(10);
    expect(first.hasMore).toBe(true);
    expect(await remainingEvents()).toBe(15);
  });

  test("C2: repeated passes converge and then stop", async () => {
    // Termination does not depend on the ORDER BY — a DELETE removes what it
    // took — so this asserts convergence, which is what is actually true. What
    // the ordering buys has its own test below.
    await seedOldEvents(25);

    const counts: number[] = [];
    let passes = 0;

    for (;;) {
      const pass = await purge(10);
      counts.push(pass.eventsDeleted);
      passes += 1;

      if (!pass.hasMore) break;
      if (passes > 10) throw new Error("purge did not converge");
    }

    expect(counts).toEqual([10, 10, 5]);
    expect(await remainingEvents()).toBe(0);
  });

  test("C2: a pass that exactly empties the table still reports hasMore, and the next one is a no-op", async () => {
    // `hasMore` is "the batch filled", not "rows remain" — it cannot be the
    // latter without a second count. The honest consequence is one extra empty
    // pass, which the loop terminates on, and this test exists so that extra
    // pass is a documented behaviour rather than a surprise.
    await seedOldEvents(10);

    const first = await purge(10);
    expect(first.eventsDeleted).toBe(10);
    expect(first.hasMore).toBe(true);

    const second = await purge(10);
    expect(second.eventsDeleted).toBe(0);
    expect(second.hasMore).toBe(false);
  });

  test("C2: a partial purge removes the OLDEST rows, not an arbitrary slice", async () => {
    // What the ORDER BY actually buys, pinned. Dropping it left every other
    // test in this file green — Postgres returned rows in physical order on a
    // small table and the ordering looked redundant. On a retention control,
    // "which half got deleted when the pass ran out of budget" is not a detail:
    // an interrupted purge must have removed the data furthest past its window.
    await seedOldEvents(20);

    await purge(5);

    const rows = (await getAdminSql()`
      SELECT occurred_at FROM awcms_visit_events
      WHERE tenant_id = ${TENANT} ORDER BY occurred_at ASC LIMIT 1
    `) as { occurred_at: Date }[];

    const oldest = new Date(
      NOW.getTime() -
        (VISITOR_ANALYTICS_DEFAULTS.eventRetentionDays + 30) * 86_400_000
    );

    // The five oldest are gone, so the survivor's timestamp is at least five
    // one-second steps past the seed's start.
    expect(rows[0]!.occurred_at.getTime()).toBeGreaterThanOrEqual(
      oldest.getTime() + 5_000
    );
  });

  test("C2: nothing past the cutoff is touched", async () => {
    // NON-VACUOUS. A purge that deleted everything would satisfy every count
    // above.
    await seedOldEvents(5);
    await getAdminSql()`
      INSERT INTO awcms_visit_events
        (tenant_id, occurred_at, method, area, path_sanitized, human_status)
      VALUES (${TENANT}, ${NOW}, 'GET', 'public', '/fresh', 'human')
    `;

    await purge(100);

    expect(await remainingEvents()).toBe(1);
  });

  test("C5: the subject-actor read uses the new index instead of scanning", async () => {
    // `db:fk-index:check` structurally cannot see these columns — they are not
    // foreign keys, deliberately, because an audit row must survive the deletion
    // of the actor it names. So the coverage is asserted here or nowhere.
    const admin = getAdminSql();

    await admin`
      INSERT INTO awcms_audit_events
        (tenant_id, actor_tenant_user_id, module_key, action, resource_type, severity, message)
      SELECT ${TENANT},
             CASE WHEN g % 200 = 0 THEN ${SUBJECT}::uuid ELSE gen_random_uuid() END,
             'logging', 'x', 'y', 'info', 'm'
      FROM generate_series(1, 4000) g
    `;
    await admin.unsafe("ANALYZE awcms_audit_events");

    const plan = (await admin.unsafe(
      `EXPLAIN (FORMAT JSON)
       SELECT id FROM awcms_audit_events
       WHERE tenant_id = $1::uuid AND actor_tenant_user_id = $2::uuid`,
      [TENANT, SUBJECT]
    )) as { "QUERY PLAN": unknown }[];

    const text = JSON.stringify(plan);

    expect(text).toContain("awcms_audit_events_actor_tenant_user_idx");
    expect(text).not.toContain("Seq Scan");
  });

  test("C5: dropping the index brings the scan back — the assertion above is not free", async () => {
    // Without this, every claim in the previous test also passes on a table too
    // small for the planner to care, which is the failure mode
    // `blog-list-ordering-plan` documents for the same kind of assertion. The
    // drop is inside a transaction that is rolled back, so the schema is
    // untouched.
    const admin = getAdminSql();

    await admin`
      INSERT INTO awcms_audit_events
        (tenant_id, actor_tenant_user_id, module_key, action, resource_type, severity, message)
      SELECT ${TENANT},
             CASE WHEN g % 200 = 0 THEN ${SUBJECT}::uuid ELSE gen_random_uuid() END,
             'logging', 'x', 'y', 'info', 'm'
      FROM generate_series(1, 4000) g
    `;
    await admin.unsafe("ANALYZE awcms_audit_events");

    let planWithout = "";

    try {
      await admin.begin(async (tx) => {
        await tx.unsafe("DROP INDEX awcms_audit_events_actor_tenant_user_idx");
        await tx.unsafe("ANALYZE awcms_audit_events");

        const plan = (await tx.unsafe(
          `EXPLAIN (FORMAT JSON)
           SELECT id FROM awcms_audit_events
           WHERE tenant_id = $1::uuid AND actor_tenant_user_id = $2::uuid`,
          [TENANT, SUBJECT]
        )) as { "QUERY PLAN": unknown }[];

        planWithout = JSON.stringify(plan);

        // `expect().rejects` hangs on this pool harness, so the rollback is a
        // thrown sentinel caught outside.
        throw new Error("__rollback__");
      });
    } catch (error) {
      if ((error as Error).message !== "__rollback__") throw error;
    }

    expect(planWithout).toContain("Seq Scan");
  });
  test("C5: a table over the cap is CUT and SAYS SO, and one under it is not", async () => {
    // The two halves have to be asserted together. `truncated: true` on
    // everything would satisfy the first assertion alone, and a report that
    // over-claims incompleteness is its own kind of wrong on a legal
    // obligation.
    const admin = getAdminSql();

    await admin`
      INSERT INTO awcms_audit_events
        (tenant_id, actor_tenant_user_id, module_key, action, resource_type, severity, message)
      SELECT ${TENANT}, ${SUBJECT}::uuid, 'logging', 'x', 'y', 'info', 'm'
      FROM generate_series(1, 12) g
    `;

    const plan = buildSubjectPlan(
      collectSubjectDataDescriptors(listModules()),
      {
        tenantId: TENANT,
        tenantUserId: SUBJECT,
        identityId: SUBJECT_IDENTITY,
        profileId: SUBJECT_PROFILE
      }
    );
    const tableNames = plan.exportEntries.map((entry) => entry.tableName);

    const tables = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT,
      async (tx) =>
        readSubjectExport(
          tx,
          TENANT,
          plan,
          await loadColumnTypes(tx, tableNames),
          { rowLimit: 10 }
        ),
      { workClass: "interactive" }
    );

    const audit = tables.find(
      (table) => table.tableName === "awcms_audit_events"
    );

    expect(audit).toBeDefined();
    // Exactly the cap, not the cap plus the probe row.
    expect(audit!.rows).toHaveLength(10);
    expect(audit!.truncated).toBe(true);

    // Every other table has nothing for this subject and must not claim to have
    // been cut short.
    for (const table of tables) {
      if (table.tableName === "awcms_audit_events") continue;
      expect(table.truncated).toBe(false);
    }
  });

  test("C5: a table exactly AT the cap is not reported as truncated", async () => {
    // The off-by-one the `+1` probe row exists to get right. Reading exactly the
    // limit cannot distinguish "there were exactly N" from "there were more",
    // and guessing either way is wrong on a report that is signed.
    const admin = getAdminSql();

    await admin`
      INSERT INTO awcms_audit_events
        (tenant_id, actor_tenant_user_id, module_key, action, resource_type, severity, message)
      SELECT ${TENANT}, ${SUBJECT}::uuid, 'logging', 'x', 'y', 'info', 'm'
      FROM generate_series(1, 10) g
    `;

    const plan = buildSubjectPlan(
      collectSubjectDataDescriptors(listModules()),
      {
        tenantId: TENANT,
        tenantUserId: SUBJECT,
        identityId: SUBJECT_IDENTITY,
        profileId: SUBJECT_PROFILE
      }
    );

    const tables = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT,
      async (tx) =>
        readSubjectExport(
          tx,
          TENANT,
          plan,
          await loadColumnTypes(
            tx,
            plan.exportEntries.map((entry) => entry.tableName)
          ),
          { rowLimit: 10 }
        ),
      { workClass: "interactive" }
    );

    const audit = tables.find(
      (table) => table.tableName === "awcms_audit_events"
    )!;

    expect(audit.rows).toHaveLength(10);
    expect(audit.truncated).toBe(false);
  });
  test("C5: the LIMIT is actually in the statement, not just in the result shape", async () => {
    // This assertion exists because removing the LIMIT entirely turned NOTHING
    // red. With 12 rows and a cap of 10, an unbounded read still yields
    // `rows.length = 12 > 10`, so `truncated` is still true and the slice is
    // still 10 — the behaviour is identical and only the COST differs. That is
    // precisely the shape of the finding: an unbounded read that looks fine
    // from the outside.
    //
    // Comments stripped first: the paragraph above this one in the executor
    // discusses the LIMIT at length, and an assertion that matched prose rather
    // than code would be finding D2 all over again.
    const source = stripComments(
      await Bun.file(
        "src/modules/data-lifecycle/application/subject-data-executor.ts"
      ).text()
    );

    expect(source).toContain("LIMIT ${limitPlaceholder}");
    // And the probe row that makes `truncated` a fact rather than a guess.
    expect(source).toContain("rowLimit + 1");
  });
});
