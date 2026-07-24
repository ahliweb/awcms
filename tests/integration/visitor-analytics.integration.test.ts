/**
 * Integration tests for `visitor_analytics` against a real PostgreSQL under the
 * WORLD-1 ephemeral-database harness. Proves, with real DDL/RLS/constraints
 * (not mocks):
 *
 *   - the collector writes a session + event inside `withTenant`, and the
 *     aggregate/realtime queries read them back correctly;
 *   - FORCE ROW LEVEL SECURITY tenant isolation: tenant A's rows are invisible
 *     to tenant B's context, AND a direct SELECT by the non-superuser
 *     `awcms_app` role with NO tenant context returns zero rows (fail-closed);
 *   - the cross-tenant composite FK `(tenant_id, visitor_session_id)` refuses a
 *     visit_event that points at another tenant's session;
 *   - retention purge hard-deletes events past the cutoff and the now-orphaned
 *     sessions.
 *
 * Gated on `DATABASE_URL` (harness §Gating). The privacy of stored identifiers
 * (salted hashing) is covered by the pure unit tests
 * (`tests/visitor-analytics-privacy.test.ts`).
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
  assertRejected,
  getAdminSql,
  getAppRoleSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenant } from "../../src/lib/database/tenant-context";
import { collectVisitorTelemetry } from "../../src/modules/visitor-analytics/application/collector";
import {
  fetchAnalyticsSummary,
  fetchRealtimeStats
} from "../../src/modules/visitor-analytics/application/analytics-queries";
import { purgeVisitorAnalyticsData } from "../../src/modules/visitor-analytics/application/retention-purge";
import {
  VISITOR_ANALYTICS_DEFAULTS,
  type VisitorAnalyticsConfig
} from "../../src/modules/visitor-analytics/domain/visitor-analytics-config";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const CONFIG: VisitorAnalyticsConfig = {
  ...VISITOR_ANALYTICS_DEFAULTS,
  enabled: true,
  hashSalt: "integration-salt"
};

async function seedTenants(): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
    VALUES
      (${TENANT_A}, 'tenant-a', 'Tenant A', 'active'),
      (${TENANT_B}, 'tenant-b', 'Tenant B', 'active')
    ON CONFLICT (id) DO NOTHING
  `;
}

async function collectHuman(tenantId: string, path: string): Promise<void> {
  await collectVisitorTelemetry({
    sql: getRuntimeSql(),
    tenantId,
    correlationId: "corr-int",
    config: CONFIG,
    method: "GET",
    rawPath: path,
    statusCode: 200,
    visitorKey: "11111111-1111-4111-8111-111111111111",
    ipAddress: "203.0.113.5",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    referrerHeader: "https://ref.example.com/x",
    isAuthenticated: false,
    identityId: null,
    geo: { countryCode: null, region: null, city: null, timezone: null }
  });
}

const suite = integrationEnabled ? describe : describe.skip;

suite("visitor_analytics module (integration)", () => {
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

  test("collector writes a session + event, queries read them back", async () => {
    const runtime = getRuntimeSql();
    await collectHuman(TENANT_A, "/blog/acme/post-1");

    const counts = await withTenant(runtime, TENANT_A, async (tx) => {
      const sessions = (await tx`
        SELECT count(*) AS n FROM awcms_visitor_sessions WHERE tenant_id = ${TENANT_A}
      `) as { n: string }[];
      const events = (await tx`
        SELECT count(*) AS n FROM awcms_visit_events WHERE tenant_id = ${TENANT_A}
      `) as { n: string }[];
      return {
        sessions: Number(sessions[0]?.n ?? 0),
        events: Number(events[0]?.n ?? 0)
      };
    });
    expect(counts.sessions).toBe(1);
    expect(counts.events).toBe(1);

    const summary = await withTenant(runtime, TENANT_A, (tx) =>
      fetchAnalyticsSummary(
        tx,
        TENANT_A,
        "7d",
        new Date(Date.now() - 86_400_000)
      )
    );
    expect(summary.humanPageviews).toBe(1);
    expect(summary.humanUniqueVisitors).toBe(1);
    expect(summary.botPageviews).toBe(0);

    const realtime = await withTenant(runtime, TENANT_A, (tx) =>
      fetchRealtimeStats(tx, TENANT_A, CONFIG.onlineWindowSeconds)
    );
    expect(realtime.onlineHumanCount).toBe(1);
    expect(realtime.onlinePublicCount).toBe(1);
  });

  test("stored detail is anonymized: raw IP is null by default, hashes are present", async () => {
    const runtime = getRuntimeSql();
    await collectHuman(TENANT_A, "/");

    const row = await withTenant(runtime, TENANT_A, async (tx) => {
      const rows = (await tx`
        SELECT ip_address, ip_hash, user_agent_hash, visitor_key_hash, identity_id
        FROM awcms_visitor_sessions WHERE tenant_id = ${TENANT_A} LIMIT 1
      `) as {
        ip_address: string | null;
        ip_hash: string | null;
        user_agent_hash: string | null;
        visitor_key_hash: string | null;
        identity_id: string | null;
      }[];
      return rows[0];
    });
    // rawIpEnabled defaults false -> raw IP not stored; salted hashes are.
    expect(row?.ip_address).toBeNull();
    expect(row?.identity_id).toBeNull();
    expect(row?.ip_hash?.startsWith("sha256:")).toBe(true);
    expect(row?.user_agent_hash?.startsWith("sha256:")).toBe(true);
    expect(row?.visitor_key_hash?.startsWith("sha256:")).toBe(true);
  });

  test("cross-tenant isolation: tenant B's context sees none of tenant A's rows", async () => {
    const runtime = getRuntimeSql();
    await collectHuman(TENANT_A, "/only-a");

    const asB = await withTenant(runtime, TENANT_B, async (tx) => {
      const rows = (await tx`
        SELECT count(*) AS n FROM awcms_visit_events
      `) as { n: string }[];
      return Number(rows[0]?.n ?? 0);
    });
    expect(asB).toBe(0);
  });

  test("RLS: awcms_app cannot SELECT without tenant context (fail-closed FORCE RLS)", async () => {
    if (!appRoleActivated) {
      // Without migration 019's awcms_app role the FORCE-RLS proof is not
      // meaningful (an owner-superuser bypasses RLS unconditionally).
      return;
    }
    await collectHuman(TENANT_A, "/rls-probe");

    const app = getAppRoleSql();
    const sessions = (await app`SELECT id FROM awcms_visitor_sessions`) as {
      id: string;
    }[];
    const events = (await app`SELECT id FROM awcms_visit_events`) as {
      id: string;
    }[];
    expect(sessions).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  test("cross-tenant composite FK refuses an event pointing at another tenant's session", async () => {
    const runtime = getRuntimeSql();
    await collectHuman(TENANT_A, "/");

    const sessionId = await withTenant(runtime, TENANT_A, async (tx) => {
      const rows = (await tx`
        SELECT id FROM awcms_visitor_sessions WHERE tenant_id = ${TENANT_A} LIMIT 1
      `) as { id: string }[];
      return rows[0]!.id;
    });

    // Under tenant B's context, referencing tenant A's session id violates the
    // (tenant_id, visitor_session_id) composite FK — (B, A_session) does not
    // exist in awcms_visitor_sessions(tenant_id, id).
    await assertRejected(
      withTenant(
        runtime,
        TENANT_B,
        (tx) =>
          tx`
          INSERT INTO awcms_visit_events
            (tenant_id, visitor_session_id, method, area, path_sanitized, human_status)
          VALUES (${TENANT_B}, ${sessionId}, 'GET', 'public', '/x', 'human')
        `
      ),
      "a visit_event referencing another tenant's session"
    );
  });

  test("retention purge hard-deletes events + orphaned sessions past the cutoff", async () => {
    const runtime = getRuntimeSql();
    const oldTs = "2000-01-01T00:00:00Z";

    // Seed one deliberately-ancient session + event directly.
    await withTenant(runtime, TENANT_A, async (tx) => {
      const sessionRows = (await tx`
        INSERT INTO awcms_visitor_sessions
          (tenant_id, visitor_key_hash, area, first_seen_at, last_seen_at)
        VALUES (${TENANT_A}, 'sha256:old', 'public', ${oldTs}, ${oldTs})
        RETURNING id
      `) as { id: string }[];
      const sessionId = sessionRows[0]!.id;
      await tx`
        INSERT INTO awcms_visit_events
          (tenant_id, visitor_session_id, occurred_at, method, area, path_sanitized, human_status)
        VALUES (${TENANT_A}, ${sessionId}, ${oldTs}, 'GET', 'public', '/old', 'human')
      `;
    });

    const result = await withTenant(runtime, TENANT_A, (tx) =>
      purgeVisitorAnalyticsData(tx, TENANT_A, CONFIG, new Date())
    );
    if (result instanceof Response)
      throw new Error("unexpected 503 during purge");

    expect(result.eventsDeleted).toBe(1);
    expect(result.sessionsDeleted).toBe(1);

    const remaining = await withTenant(runtime, TENANT_A, async (tx) => {
      const rows = (await tx`
        SELECT count(*) AS n FROM awcms_visit_events WHERE tenant_id = ${TENANT_A}
      `) as { n: string }[];
      return Number(rows[0]?.n ?? 0);
    });
    expect(remaining).toBe(0);
  });
});
