/**
 * Integration tests for `media_library`'s own per-tenant managed-media
 * enforcement signal (ADR-0036, migration `053`) against a real PostgreSQL under
 * the WORLD-1 ephemeral-database harness.
 *
 * These exist because the claims that matter here are all claims about the
 * DATABASE, and every one is invisible to a typecheck:
 *
 *   1. A migration's `INSERT ... SELECT` genuinely moves rows ACROSS tenants.
 *      Migration headers here (`sql/053`, and now `sql/076`) argue this works
 *      because migrations run as a superuser that bypasses RLS regardless of
 *      FORCE. That reasoning is only as good as the role the runner actually
 *      connects as — so this asserts the rows move, rather than trusting the
 *      comment. ADR-0044 dropped `sql/053`'s SOURCE table
 *      (`awcms_news_portal_tenant_state`, inert with no writer), so the proof
 *      is retargeted at `sql/076`'s permission repoint — the same statement
 *      shape against a FORCE'd table, and one that is live rather than
 *      hypothetical.
 *   2. The flag is tenant-isolated (FORCE RLS). It gates media validation, so one
 *      tenant reading another's flag would be a real cross-tenant defect, and the
 *      non-superuser `awcms_app` role with NO tenant context must read zero rows.
 *   3. Enforcement works on its own, with no editorial/news preset anywhere in
 *      the picture — the brochure site case. This is the entire product gap the
 *      inversion was written to close, and nothing else in the suite proves it.
 *      Since ADR-0044 there is no `news_portal` state table left to be absent,
 *      which makes the gap closed by construction; the behavioural half of the
 *      assertion is what still earns its place.
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
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
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

    await withTenantOrThrow(getRuntimeSql(), tenantId, async (tx) => {
      expect(await isManagedMediaEnforcedForTenant(tx, tenantId)).toBe(false);
      await markManagedMediaEnforced(tx, tenantId);
      expect(await isManagedMediaEnforcedForTenant(tx, tenantId)).toBe(true);
    });
  });

  test("one tenant's enforcement flag is invisible to another — RLS holds on the table that gates media validation", async () => {
    const enforcedTenantId = await provisionTenant("acme");
    const otherTenantId = await provisionTenant("globex");

    await withTenantOrThrow(getRuntimeSql(), enforcedTenantId, async (tx) => {
      await markManagedMediaEnforced(tx, enforcedTenantId);
    });

    await withTenantOrThrow(getRuntimeSql(), otherTenantId, async (tx) => {
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
    await withTenantOrThrow(getRuntimeSql(), enforcedTenantId, async (tx) => {
      await markManagedMediaEnforced(tx, enforcedTenantId);
    });

    const app = getAppRoleSql();
    const rows = (await app`
      SELECT tenant_id FROM awcms_media_library_tenant_state
    `) as { tenant_id: string }[];
    expect(rows).toHaveLength(0);
  });

  test("a migration's INSERT...SELECT crosses tenants — the migration role really does bypass FORCE RLS", async () => {
    // A migration's cross-tenant backfill runs when few or no tenants exist, so
    // it can never be observed by simply migrating. This re-runs the EXACT
    // statement shape `sql/076` carries, against real rows in two tenants, to
    // prove the claim its header makes: an INSERT...SELECT reading a FORCE'd RLS
    // table sees EVERY tenant's rows rather than silently copying nothing.
    //
    // If this ever fails, `sql/076` is silently a no-op and every tenant that had
    // granted the editorial permissions LOSES them on deploy — access revoked
    // with every gate green, which is exactly the failure the ordering in that
    // migration exists to prevent.
    //
    // (This assertion used to run against `sql/053`'s backfill. ADR-0044 dropped
    // its source table — `awcms_news_portal_tenant_state`, which never had a
    // writer in this base — so the guarantee moved to a live statement instead of
    // being deleted with the table.)
    const tenantA = await provisionTenant("acme");
    const tenantB = await provisionTenant("globex");

    const admin = getAdminSql();

    // A role per tenant, each granted a permission under the OLD module key.
    await admin`
      INSERT INTO awcms_permissions (module_key, activity_code, action, description)
      VALUES ('news_portal', 'homepage_sections', 'configure', 'pre-merge grant')
      ON CONFLICT (module_key, activity_code, action) DO NOTHING
    `;

    for (const tenantId of [tenantA, tenantB]) {
      await admin`
        INSERT INTO awcms_roles (tenant_id, role_code, role_name, is_system)
        VALUES (${tenantId}, 'editor', 'Editor', false)
      `;
      await admin`
        INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
        SELECT ${tenantId}, r.id, p.id
        FROM awcms_roles r, awcms_permissions p
        WHERE r.tenant_id = ${tenantId}
          AND r.role_code = 'editor'
          AND p.module_key = 'news_portal'
          AND p.activity_code = 'homepage_sections'
      `;
    }

    // The repoint, verbatim from sql/076 step 2 — one statement, both tenants.
    await admin`
      INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
      SELECT rp.tenant_id, rp.role_id, new_permission.id
      FROM awcms_role_permissions rp
      JOIN awcms_permissions old_permission
        ON old_permission.id = rp.permission_id
       AND old_permission.module_key = 'news_portal'
       AND old_permission.activity_code IN ('homepage_sections', 'ad_placements')
      JOIN awcms_permissions new_permission
        ON new_permission.module_key = 'blog_content'
       AND new_permission.activity_code = old_permission.activity_code
       AND new_permission.action = old_permission.action
      ON CONFLICT DO NOTHING
    `;

    const moved = (await admin`
      SELECT rp.tenant_id
      FROM awcms_role_permissions rp
      JOIN awcms_permissions p ON p.id = rp.permission_id
      WHERE p.module_key = 'blog_content'
        AND p.activity_code = 'homepage_sections'
        AND p.action = 'configure'
      ORDER BY rp.tenant_id
    `) as { tenant_id: string }[];

    // BOTH tenants, from one statement. One row here would mean the migration
    // role silently saw only its own tenant context.
    expect(moved.length).toBe(2);
    expect(new Set(moved.map((r) => r.tenant_id))).toEqual(
      new Set([tenantA, tenantB])
    );
  });

  test("a brochure-site tenant gets managed media with no editorial preset at all — the product gap ADR-0036 closes", async () => {
    const tenantId = await provisionTenant("acme");

    await withTenantOrThrow(getRuntimeSql(), tenantId, async (tx) => {
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

      // After opting in: enforcement ON, with no NEWS_PORTAL_* var anywhere.
      // Under the old `NewsMediaPort` this combination was unreachable by
      // construction — the gate required news_portal's preset. That is the whole
      // point of the split.
      expect(
        await mediaLibraryPortAdapter.isManagedMediaEnforcementActiveForTenant(
          tx,
          tenantId,
          MEDIA_READY_ENV_WITHOUT_NEWS_PORTAL
        )
      ).toBe(true);
    });

    // The old tail of this test read `awcms_news_portal_tenant_state` to show it
    // was empty. ADR-0044 dropped that table outright, so "no preset state
    // exists" is now true by construction rather than by assertion — asserting
    // against a table that cannot exist would test the schema, not the gap.
  });

  test("enforcement fails closed when the deployment's media R2 is not configured, even for an opted-in tenant", async () => {
    const tenantId = await provisionTenant("acme");

    await withTenantOrThrow(getRuntimeSql(), tenantId, async (tx) => {
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
