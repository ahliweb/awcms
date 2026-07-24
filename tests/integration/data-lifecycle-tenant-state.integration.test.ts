/**
 * Integration tests for `data_lifecycle` (ADR-0037, migrations sql/055 + sql/056)
 * against a real PostgreSQL under the ephemeral-database harness. These prove
 * exactly the claims a typecheck cannot:
 *
 *   1. `awcms_data_lifecycle_legal_holds` is FORCE ROW LEVEL SECURITY, tenant
 *      isolated — proven under the non-superuser `awcms_app` LOGIN role: a direct
 *      SELECT with NO tenant context returns zero rows (fail-closed default GUC),
 *      and one tenant's context never sees another tenant's hold.
 *   2. The legal-hold coupling actually works END TO END: an active hold blocks
 *      the visitor_analytics events purge AND the logging audit-events purge, and
 *      releasing the hold un-blocks both — the guard is a real gate, not a
 *      no-op that always answers "not held".
 *
 * Skipped unless a real database is configured (see tests/integration/harness.ts).
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
  appRoleActivated,
  getAdminSql,
  getAppRoleSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenant } from "../../src/lib/database/tenant-context";
import {
  createLegalHold,
  fetchActiveLegalHoldsForPlanning,
  releaseLegalHold
} from "../../src/modules/data-lifecycle/application/legal-hold-service";
import { legalHoldGuardPortAdapter } from "../../src/modules/data-lifecycle/application/legal-hold-guard-port-adapter";
import { purgeVisitorAnalyticsData } from "../../src/modules/visitor-analytics/application/retention-purge";
import { purgeExpiredAuditEvents } from "../../src/modules/logging/application/audit-purge";
import {
  VISITOR_ANALYTICS_DEFAULTS,
  type VisitorAnalyticsConfig
} from "../../src/modules/visitor-analytics/domain/visitor-analytics-config";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACTOR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const VA_CONFIG: VisitorAnalyticsConfig = {
  ...VISITOR_ANALYTICS_DEFAULTS,
  enabled: true,
  hashSalt: "integration-salt"
};

const NOW = new Date("2026-07-01T00:00:00.000Z");
function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

async function seedTenants(): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
    VALUES
      (${TENANT_A}, 'tenant-a', 'Tenant A', 'active'),
      (${TENANT_B}, 'tenant-b', 'Tenant B', 'active')
    ON CONFLICT (id) DO NOTHING
  `;
}

const validHoldInput = (descriptorKey: string | null) => ({
  descriptorKey,
  scopeDescription: "Preserve data for an ongoing legal matter.",
  reason: "Litigation hold opened 2026-07 — do not purge.",
  authorityReference: "Court order 2026-07-CV-001",
  endsAt: null
});

const suite = integrationEnabled ? describe : describe.skip;

suite("data_lifecycle module (integration)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });
  afterAll(async () => {
    await teardownIntegrationDatabase();
  });
  beforeEach(async () => {
    await resetDatabase();
    await seedTenants();
  });

  test("create + list + fetchActive round-trip, tenant-scoped", async () => {
    const runtime = getRuntimeSql();
    const created = await withTenant(runtime, TENANT_A, (tx) =>
      createLegalHold(tx, TENANT_A, ACTOR, validHoldInput(null))
    );
    if (created instanceof Response || !created.ok) {
      throw new Error("createLegalHold unexpectedly failed");
    }
    expect(created.hold.status).toBe("active");
    expect(created.hold.tenantId).toBe(TENANT_A);

    const active = await withTenant(runtime, TENANT_A, (tx) =>
      fetchActiveLegalHoldsForPlanning(tx, TENANT_A)
    );
    if (active instanceof Response) throw new Error("unexpected 503");
    expect(active.map((h) => h.id)).toContain(created.hold.id);
  });

  test("RLS FORCE: awcms_app cannot read legal_holds without tenant context, and never across tenants", async () => {
    if (!appRoleActivated) {
      // Without the awcms_app LOGIN role the FORCE-RLS proof is not meaningful
      // (the owner/superuser bypasses RLS unconditionally).
      return;
    }
    const runtime = getRuntimeSql();
    await withTenant(runtime, TENANT_A, (tx) =>
      createLegalHold(tx, TENANT_A, ACTOR, validHoldInput(null))
    );

    const app = getAppRoleSql();
    // Fail-closed: no app.current_tenant_id set -> zero rows.
    const noContext = (await app`
      SELECT id FROM awcms_data_lifecycle_legal_holds
    `) as { id: string }[];
    expect(noContext).toHaveLength(0);

    // Tenant B's context sees none of tenant A's holds.
    const asB = await withTenant(app, TENANT_B, async (tx) => {
      const rows = (await tx`
        SELECT count(*)::int AS n FROM awcms_data_lifecycle_legal_holds
      `) as { n: number }[];
      return rows[0]!.n;
    });
    expect(asB).toBe(0);

    // Tenant A's own context DOES see its hold.
    const asA = await withTenant(app, TENANT_A, async (tx) => {
      const rows = (await tx`
        SELECT count(*)::int AS n FROM awcms_data_lifecycle_legal_holds
      `) as { n: number }[];
      return rows[0]!.n;
    });
    expect(asA).toBe(1);
  });

  test("legal hold blocks the visitor_analytics events purge; release un-blocks it", async () => {
    const runtime = getRuntimeSql();

    // Seed one session + one old visit event for tenant A (past the 90d cutoff).
    await withTenant(runtime, TENANT_A, async (tx) => {
      const oldTs = daysAgo(200);
      const sessionRows = (await tx`
        INSERT INTO awcms_visitor_sessions
          (tenant_id, visitor_key_hash, area, first_seen_at, last_seen_at)
        VALUES (${TENANT_A}, 'sha256:old', 'public', ${oldTs}, ${oldTs})
        RETURNING id
      `) as { id: string }[];
      await tx`
        INSERT INTO awcms_visit_events
          (tenant_id, visitor_session_id, occurred_at, method, area, path_sanitized, human_status)
        VALUES (${TENANT_A}, ${sessionRows[0]!.id}, ${oldTs}, 'GET', 'public', '/old', 'human')
      `;
    });

    // Create an ACTIVE hold scoped to visitor_analytics.visit_events.
    await withTenant(runtime, TENANT_A, (tx) =>
      createLegalHold(
        tx,
        TENANT_A,
        ACTOR,
        validHoldInput("visitor_analytics.visit_events")
      )
    );

    // Purge while held: step-1 events DELETE is skipped.
    const held = await withTenant(runtime, TENANT_A, (tx) =>
      purgeVisitorAnalyticsData(
        tx,
        TENANT_A,
        VA_CONFIG,
        NOW,
        legalHoldGuardPortAdapter
      )
    );
    if (held instanceof Response) throw new Error("unexpected 503 (held run)");
    expect(held.eventsDeleted).toBe(0);

    const stillThere = await withTenant(runtime, TENANT_A, async (tx) => {
      const rows = (await tx`
        SELECT count(*)::int AS n FROM awcms_visit_events WHERE tenant_id = ${TENANT_A}
      `) as { n: number }[];
      return rows[0]!.n;
    });
    expect(stillThere).toBe(1);

    // Release every active hold for A, then re-run: the event is now purged.
    await withTenant(runtime, TENANT_A, async (tx) => {
      const active = await fetchActiveLegalHoldsForPlanning(tx, TENANT_A);
      for (const hold of active) {
        await releaseLegalHold(tx, TENANT_A, ACTOR, hold.id, {
          releaseReason: "Legal matter concluded 2026-07."
        });
      }
    });

    const unblocked = await withTenant(runtime, TENANT_A, (tx) =>
      purgeVisitorAnalyticsData(
        tx,
        TENANT_A,
        VA_CONFIG,
        NOW,
        legalHoldGuardPortAdapter
      )
    );
    if (unblocked instanceof Response) throw new Error("unexpected 503");
    expect(unblocked.eventsDeleted).toBe(1);
  });

  test("legal hold preserves ALL visitor-analytics data — session PII + rollups, not just events (M2)", async () => {
    const runtime = getRuntimeSql();
    const oldTs = daysAgo(200);
    const oldDate = daysAgo(800).toISOString().slice(0, 10); // past 730d rollup cutoff

    // An ORPHANED old session (no visit_events) WITH raw PII, plus an old
    // rollup — absent a hold, step 2 clears the PII, step 3 deletes the session,
    // step 4 deletes the rollup. (No event, so this is distinct from the prior
    // test where the event transitively protected the session.)
    await withTenant(runtime, TENANT_A, async (tx) => {
      await tx`
        INSERT INTO awcms_visitor_sessions
          (tenant_id, visitor_key_hash, area, first_seen_at, last_seen_at,
           ip_address, login_identifier_snapshot)
        VALUES (${TENANT_A}, 'sha256:orphan', 'public', ${oldTs}, ${oldTs},
           '203.0.113.5', 'hash:user@example')
      `;
      await tx`
        INSERT INTO awcms_visitor_daily_rollups (tenant_id, date, area)
        VALUES (${TENANT_A}, ${oldDate}, 'public')
      `;
    });

    // A TENANT-WIDE hold (descriptorKey null) must cover visit_events too, so
    // the whole purge is skipped.
    await withTenant(runtime, TENANT_A, (tx) =>
      createLegalHold(tx, TENANT_A, ACTOR, validHoldInput(null))
    );

    const held = await withTenant(runtime, TENANT_A, (tx) =>
      purgeVisitorAnalyticsData(
        tx,
        TENANT_A,
        VA_CONFIG,
        NOW,
        legalHoldGuardPortAdapter
      )
    );
    if (held instanceof Response) throw new Error("unexpected 503 (held run)");
    expect(held).toEqual({
      eventsDeleted: 0,
      sessionsRawDetailCleared: 0,
      sessionsDeleted: 0,
      rollupsDeleted: 0
    });

    // The PII column is physically untouched, and both rows still exist.
    const preserved = await withTenant(runtime, TENANT_A, async (tx) => {
      const s = (await tx`
        SELECT ip_address, login_identifier_snapshot
        FROM awcms_visitor_sessions WHERE tenant_id = ${TENANT_A}
      `) as {
        ip_address: string | null;
        login_identifier_snapshot: string | null;
      }[];
      const r = (await tx`
        SELECT count(*)::int AS n FROM awcms_visitor_daily_rollups WHERE tenant_id = ${TENANT_A}
      `) as { n: number }[];
      return { s, rollups: r[0]!.n };
    });
    expect(preserved.s).toHaveLength(1);
    expect(preserved.s[0]!.ip_address).toBe("203.0.113.5");
    expect(preserved.s[0]!.login_identifier_snapshot).toBe("hash:user@example");
    expect(preserved.rollups).toBe(1);

    // Release → normal retention resumes: PII cleared, session + rollup deleted.
    await withTenant(runtime, TENANT_A, async (tx) => {
      const active = await fetchActiveLegalHoldsForPlanning(tx, TENANT_A);
      for (const hold of active) {
        await releaseLegalHold(tx, TENANT_A, ACTOR, hold.id, {
          releaseReason: "Legal matter concluded 2026-07."
        });
      }
    });
    const after = await withTenant(runtime, TENANT_A, (tx) =>
      purgeVisitorAnalyticsData(
        tx,
        TENANT_A,
        VA_CONFIG,
        NOW,
        legalHoldGuardPortAdapter
      )
    );
    if (after instanceof Response) throw new Error("unexpected 503");
    expect(after.sessionsRawDetailCleared).toBe(1);
    expect(after.sessionsDeleted).toBe(1);
    expect(after.rollupsDeleted).toBe(1);
  });

  test("legal hold blocks the logging audit-events purge; release un-blocks it", async () => {
    const runtime = getRuntimeSql();
    const oldTs = daysAgo(900); // past the 730d audit default cutoff

    // Seed 3 old audit events for tenant A.
    await withTenant(runtime, TENANT_A, async (tx) => {
      for (let i = 0; i < 3; i += 1) {
        await tx`
          INSERT INTO awcms_audit_events
            (tenant_id, module_key, action, resource_type, severity, message, created_at)
          VALUES (${TENANT_A}, 'test', 'create', 'thing', 'info', ${"old event " + i}, ${oldTs})
        `;
      }
    });

    // A tenant-wide hold (descriptorKey null) covers logging.audit_events too.
    await withTenant(runtime, TENANT_A, (tx) =>
      createLegalHold(tx, TENANT_A, ACTOR, validHoldInput(null))
    );

    const held = await purgeExpiredAuditEvents(
      runtime,
      TENANT_A,
      legalHoldGuardPortAdapter,
      { now: NOW }
    );
    expect(held.purgedCount).toBe(0);

    const oldRemaining = await withTenant(runtime, TENANT_A, async (tx) => {
      const rows = (await tx`
        SELECT count(*)::int AS n FROM awcms_audit_events
        WHERE tenant_id = ${TENANT_A} AND created_at < ${held.cutoff}
      `) as { n: number }[];
      return rows[0]!.n;
    });
    expect(oldRemaining).toBe(3);

    // Release the hold, then re-run: the 3 old events are purged.
    await withTenant(runtime, TENANT_A, async (tx) => {
      const active = await fetchActiveLegalHoldsForPlanning(tx, TENANT_A);
      for (const hold of active) {
        await releaseLegalHold(tx, TENANT_A, ACTOR, hold.id, {
          releaseReason: "Legal matter concluded 2026-07."
        });
      }
    });

    const unblocked = await purgeExpiredAuditEvents(
      runtime,
      TENANT_A,
      legalHoldGuardPortAdapter,
      { now: NOW }
    );
    expect(unblocked.purgedCount).toBe(3);
  });
});
