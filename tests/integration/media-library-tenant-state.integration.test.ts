/**
 * Integration tests for `media_library`'s own per-tenant managed-media
 * enforcement signal (ADR-0036, migration `053`) against a real PostgreSQL under
 * the WORLD-1 ephemeral-database harness.
 *
 * These exist because the claims that matter here are all claims about the
 * DATABASE, and every one is invisible to a typecheck:
 *
 *   1. The `sql/053` backfill genuinely copies rows ACROSS tenants. Its header
 *      argues it works because migrations run as a superuser that bypasses RLS
 *      regardless of FORCE. That reasoning is only as good as the role the runner
 *      actually connects as — so this asserts the rows move, rather than trusting
 *      the comment.
 *   2. The flag is tenant-isolated (FORCE RLS). It gates media validation, so one
 *      tenant reading another's flag would be a real cross-tenant defect, and the
 *      non-superuser `awcms_app` role with NO tenant context must read zero rows.
 *   3. Enforcement works with NO `news_portal` state whatsoever — the brochure
 *      site case. This is the entire product gap the inversion was written to
 *      close, and nothing else in the suite proves it.
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
  isManagedMediaEnforcedForTenant,
  markManagedMediaEnforced
} from "../../src/modules/media-library/application/media-library-tenant-state";
import { mediaLibraryPortAdapter } from "../../src/modules/media-library/application/media-library-port-adapter";

/** Media R2 configured and separated from sync-storage's own R2 vars — deliberately WITHOUT any NEWS_PORTAL_* var. */
const MEDIA_READY_ENV_WITHOUT_NEWS_PORTAL = {
  NEWS_MEDIA_R2_ENABLED: "true",
  NEWS_MEDIA_R2_ACCOUNT_ID: "acct",
  NEWS_MEDIA_R2_ACCESS_KEY_ID: "news-key",
  NEWS_MEDIA_R2_SECRET_ACCESS_KEY: "news-secret",
  NEWS_MEDIA_R2_BUCKET: "news-media-bucket",
  NEWS_MEDIA_R2_PUBLIC_BASE_URL: "https://media.example.test"
} as NodeJS.ProcessEnv;

/**
 * A bare `active` tenant row — all these tests need, since every assertion below
 * goes through `withTenant`/admin SQL rather than an authenticated HTTP route.
 */
async function provisionTenant(tenantCode: string): Promise<string> {
  const admin = getAdminSql();
  const tenantId = crypto.randomUUID();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
    VALUES (${tenantId}, ${tenantCode}, ${tenantCode}, 'active')
  `;

  return tenantId;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("media_library tenant state (ADR-0036)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });
  afterAll(async () => {
    await teardownIntegrationDatabase();
  });
  beforeEach(async () => {
    await resetDatabase();
  });

  test("markManagedMediaEnforced round-trips inside a tenant-scoped transaction", async () => {
    const tenantId = await provisionTenant("acme");

    await withTenant(getRuntimeSql(), tenantId, async (tx) => {
      expect(await isManagedMediaEnforcedForTenant(tx, tenantId)).toBe(false);
      await markManagedMediaEnforced(tx, tenantId);
      expect(await isManagedMediaEnforcedForTenant(tx, tenantId)).toBe(true);
    });
  });

  test("one tenant's enforcement flag is invisible to another — RLS holds on the table that gates media validation", async () => {
    const enforcedTenantId = await provisionTenant("acme");
    const otherTenantId = await provisionTenant("globex");

    await withTenant(getRuntimeSql(), enforcedTenantId, async (tx) => {
      await markManagedMediaEnforced(tx, enforcedTenantId);
    });

    await withTenant(getRuntimeSql(), otherTenantId, async (tx) => {
      // Fail-closed for the tenant that never opted in — and, critically, asking
      // about ANOTHER tenant's id from inside this tenant's context must not leak
      // that tenant's state either.
      expect(await isManagedMediaEnforcedForTenant(tx, otherTenantId)).toBe(
        false
      );
      expect(await isManagedMediaEnforcedForTenant(tx, enforcedTenantId)).toBe(
        false
      );
    });
  });

  test("RLS: awcms_app cannot SELECT the enforcement table without tenant context (fail-closed FORCE RLS)", async () => {
    if (!appRoleActivated) {
      // Without migration 019's awcms_app role the FORCE-RLS proof is not
      // meaningful (an owner-superuser bypasses RLS unconditionally).
      return;
    }

    const enforcedTenantId = await provisionTenant("acme");
    await withTenant(getRuntimeSql(), enforcedTenantId, async (tx) => {
      await markManagedMediaEnforced(tx, enforcedTenantId);
    });

    const app = getAppRoleSql();
    const rows = (await app`
      SELECT tenant_id FROM awcms_media_library_tenant_state
    `) as { tenant_id: string }[];
    expect(rows).toHaveLength(0);
  });

  test("the sql/053 backfill copies news_portal preset state across tenants — the migration role really does bypass RLS", async () => {
    // sql/053's backfill runs at migration time, when no tenant exists yet, so it
    // can never be observed by simply migrating. This re-runs the EXACT statement
    // the migration carries, against real rows, to prove the claim its header
    // makes: that an INSERT...SELECT reading a FORCE'd RLS table sees every
    // tenant's rows rather than silently copying nothing.
    //
    // If this ever fails, sql/053 is silently a no-op and every tenant that
    // applied the R2 preset LOSES media enforcement on deploy — a security
    // regression disguised as a refactor. (In THIS base news_portal has no writer
    // for its state today, so the backfill reads zero rows at deploy time; this
    // proves the mechanism is correct for when that writer is ported.)
    const tenantA = await provisionTenant("acme");
    const tenantB = await provisionTenant("globex");

    const admin = getAdminSql();
    const appliedAt = new Date("2026-01-15T10:00:00.000Z");

    for (const tenantId of [tenantA, tenantB]) {
      await admin`
        INSERT INTO awcms_news_portal_tenant_state
          (tenant_id, full_online_r2_mode_applied_at, updated_at)
        VALUES (${tenantId}, ${appliedAt}, now())
      `;
    }

    // Start from empty so the assertion is about the backfill, not the fixture.
    await admin`DELETE FROM awcms_media_library_tenant_state`;

    await admin`
      INSERT INTO awcms_media_library_tenant_state
        (tenant_id, managed_media_enforced_at, updated_at)
      SELECT tenant_id, full_online_r2_mode_applied_at, now()
      FROM awcms_news_portal_tenant_state
      ON CONFLICT (tenant_id) DO NOTHING
    `;

    const rows = (await admin`
      SELECT tenant_id, managed_media_enforced_at
      FROM awcms_media_library_tenant_state
      ORDER BY tenant_id
    `) as { tenant_id: string; managed_media_enforced_at: Date }[];

    expect(rows.length).toBe(2);
    expect(new Set(rows.map((r) => r.tenant_id))).toEqual(
      new Set([tenantA, tenantB])
    );

    // Carried over verbatim, not stamped with now() — the flag records when
    // enforcement genuinely began, not when the migration happened to run.
    for (const row of rows) {
      expect(new Date(row.managed_media_enforced_at).toISOString()).toBe(
        appliedAt.toISOString()
      );
    }
  });

  test("a brochure-site tenant gets managed media with NO news_portal state at all — the product gap ADR-0036 closes", async () => {
    const tenantId = await provisionTenant("acme");

    await withTenant(getRuntimeSql(), tenantId, async (tx) => {
      // Before opting in: enforcement off, even though the deployment's media R2
      // is fully configured. Deployment readiness alone must never opt a tenant in.
      expect(
        await mediaLibraryPortAdapter.isManagedMediaEnforcementActiveForTenant(
          tx,
          tenantId,
          MEDIA_READY_ENV_WITHOUT_NEWS_PORTAL
        )
      ).toBe(false);

      await markManagedMediaEnforced(tx, tenantId);

      // After opting in: enforcement ON, with no NEWS_PORTAL_* var and no row in
      // `awcms_news_portal_tenant_state`. Under the old `NewsMediaPort` this
      // combination was unreachable by construction — the gate required
      // news_portal's preset. That is the whole point of the split.
      expect(
        await mediaLibraryPortAdapter.isManagedMediaEnforcementActiveForTenant(
          tx,
          tenantId,
          MEDIA_READY_ENV_WITHOUT_NEWS_PORTAL
        )
      ).toBe(true);
    });

    const admin = getAdminSql();
    const newsPortalRows = (await admin`
      SELECT tenant_id FROM awcms_news_portal_tenant_state
    `) as { tenant_id: string }[];
    expect(newsPortalRows).toEqual([]);
  });

  test("enforcement fails closed when the deployment's media R2 is not configured, even for an opted-in tenant", async () => {
    const tenantId = await provisionTenant("acme");

    await withTenant(getRuntimeSql(), tenantId, async (tx) => {
      await markManagedMediaEnforced(tx, tenantId);

      // The tenant flag alone must never enforce registry-backed references on a
      // deployment with no working media storage to back them.
      expect(
        await mediaLibraryPortAdapter.isManagedMediaEnforcementActiveForTenant(
          tx,
          tenantId,
          { NEWS_MEDIA_R2_ENABLED: "false" } as NodeJS.ProcessEnv
        )
      ).toBe(false);

      // Enabled but incompletely configured — also fail-closed.
      expect(
        await mediaLibraryPortAdapter.isManagedMediaEnforcementActiveForTenant(
          tx,
          tenantId,
          { NEWS_MEDIA_R2_ENABLED: "true" } as NodeJS.ProcessEnv
        )
      ).toBe(false);
    });
  });
});
