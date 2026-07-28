/**
 * Integration tests for ADR-0044 §4 Fase 2's drop-readiness check against a
 * real PostgreSQL under the WORLD-1 ephemeral-database harness.
 *
 * This is the last gate before an irreversible migration takes a live site's
 * advertising with it, so the failure that matters is the one where it says
 * READY too early. A readiness check that under-reports blockers is worse than
 * no check at all: it converts "I think we ran the ingest" into "the tool
 * confirmed it".
 *
 * So the assertions here are mostly about what must NOT be counted as
 * accounted-for, and they are exercised against real rows rather than against
 * the query's shape.
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
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import {
  assessLegacyAdDropReadiness,
  isReadyToDrop
} from "../../src/modules/blog-content/application/legacy-ad-drop-readiness";

async function provisionTenant(tenantCode: string): Promise<string> {
  const admin = getAdminSql();
  const tenantId = crypto.randomUUID();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
    VALUES (${tenantId}, ${tenantCode}, ${tenantCode}, 'active')
  `;

  return tenantId;
}

async function provisionMediaObject(tenantId: string): Promise<string> {
  const admin = getAdminSql();
  const id = crypto.randomUUID();
  const objectKey = `news-media/${tenantId}/2026/07/${id}.jpg`;

  await admin`
    INSERT INTO awcms_news_media_objects
      (id, tenant_id, bucket_name, object_key, public_url, mime_type, status,
       alt_text, created_by_tenant_user_id)
    VALUES (
      ${id}, ${tenantId}, 'test-bucket', ${objectKey},
      ${`https://media.example.test/${objectKey}`}, 'image/jpeg', 'verified',
      'Banner', ${crypto.randomUUID()}
    )
  `;

  return id;
}

async function provisionLegacyAd(tenantId: string): Promise<string> {
  const admin = getAdminSql();
  const adId = crypto.randomUUID();

  await admin`
    INSERT INTO awcms_blog_ads (id, tenant_id, name, image_url)
    VALUES (${adId}, ${tenantId}, 'Legacy banner', 'https://cdn.example/a.jpg')
  `;

  return adId;
}

async function provisionSuccessor(
  tenantId: string,
  mediaObjectId: string,
  sourceLegacyAdId: string
): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_news_portal_ad_placements
      (tenant_id, placement_key, name, media_object_id, target_type,
       source_legacy_ad_id)
    VALUES (
      ${tenantId}, 'sidebar_top', 'Migrated banner', ${mediaObjectId},
      'global', ${sourceLegacyAdId}
    )
  `;
}

function assess(tenantId: string) {
  return withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
    assessLegacyAdDropReadiness(tx, tenantId)
  );
}

const suite = integrationEnabled ? describe : describe.skip;

suite("legacy advertisement drop readiness (ADR-0044 §4)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });
  afterAll(async () => {
    await teardownIntegrationDatabase();
  });
  beforeEach(async () => {
    await resetDatabase();
  });

  test("a tenant with no legacy ads at all is ready", async () => {
    const tenantId = await provisionTenant("acme");
    const report = await assess(tenantId);

    expect(report).toMatchObject({
      totalLegacyAds: 0,
      migrated: 0,
      outstanding: 0,
      retired: 0
    });
    expect(isReadyToDrop([report])).toBe(true);
  });

  test("an un-migrated legacy ad BLOCKS, and is named", async () => {
    const tenantId = await provisionTenant("acme");
    const adId = await provisionLegacyAd(tenantId);

    const report = await assess(tenantId);

    expect(report.totalLegacyAds).toBe(1);
    expect(report.migrated).toBe(0);
    expect(report.outstanding).toBe(1);
    expect(report.outstandingAdIds).toEqual([adId]);
    expect(isReadyToDrop([report])).toBe(false);
  });

  test("a migrated legacy ad is accounted for", async () => {
    const tenantId = await provisionTenant("acme");
    const mediaObjectId = await provisionMediaObject(tenantId);
    const adId = await provisionLegacyAd(tenantId);

    await provisionSuccessor(tenantId, mediaObjectId, adId);

    const report = await assess(tenantId);

    expect(report.totalLegacyAds).toBe(1);
    expect(report.migrated).toBe(1);
    expect(report.outstanding).toBe(0);
    expect(report.outstandingAdIds).toEqual([]);
    expect(isReadyToDrop([report])).toBe(true);
  });

  test("one ad with several successors is counted ONCE, not once per row", async () => {
    // A legacy ad with three placements becomes three successor rows. A plain
    // JOIN would count it three times and report `migrated` above
    // `totalLegacyAds` — which, subtracted, yields a NEGATIVE outstanding and a
    // cheerful READY for a tenant that has un-migrated ads elsewhere.
    const tenantId = await provisionTenant("acme");
    const mediaObjectId = await provisionMediaObject(tenantId);
    const migratedAdId = await provisionLegacyAd(tenantId);
    const blockingAdId = await provisionLegacyAd(tenantId);

    for (const [targetType, targetId] of [
      ["global", null],
      ["post", crypto.randomUUID()],
      ["page", crypto.randomUUID()]
    ] as const) {
      await getAdminSql()`
        INSERT INTO awcms_news_portal_ad_placements
          (tenant_id, placement_key, name, media_object_id, target_type,
           target_id, source_legacy_ad_id)
        VALUES (
          ${tenantId}, 'sidebar_top', 'Migrated banner', ${mediaObjectId},
          ${targetType}, ${targetId}, ${migratedAdId}
        )
      `;
    }

    const report = await assess(tenantId);

    expect(report.totalLegacyAds).toBe(2);
    expect(report.migrated).toBe(1);
    expect(report.outstanding).toBe(1);
    expect(report.outstandingAdIds).toEqual([blockingAdId]);
    expect(isReadyToDrop([report])).toBe(false);
  });

  test("a soft-deleted legacy ad is accounted for without migrating", async () => {
    // The operator read the residue report and decided this ad does not come
    // along. That is a decision, and the check has to accept decisions or
    // there is no way to ever reach READY with residue that cannot migrate.
    const tenantId = await provisionTenant("acme");
    const adId = await provisionLegacyAd(tenantId);

    await getAdminSql()`
      UPDATE awcms_blog_ads SET deleted_at = now() WHERE id = ${adId}
    `;

    const report = await assess(tenantId);

    expect(report.totalLegacyAds).toBe(0);
    expect(report.retired).toBe(1);
    expect(report.outstanding).toBe(0);
    expect(isReadyToDrop([report])).toBe(true);
  });

  test("a successor belonging to ANOTHER tenant does not count", async () => {
    // The most dangerous false READY available: a successor row that names this
    // ad's id but lives in a different tenant. One tenant's migration must not
    // silently clear another's blocker.
    const acmeId = await provisionTenant("acme");
    const globexId = await provisionTenant("globex");
    const globexMediaId = await provisionMediaObject(globexId);
    const acmeAdId = await provisionLegacyAd(acmeId);

    await provisionSuccessor(globexId, globexMediaId, acmeAdId);

    const report = await assess(acmeId);

    expect(report.outstanding).toBe(1);
    expect(report.outstandingAdIds).toEqual([acmeAdId]);
    expect(isReadyToDrop([report])).toBe(false);
  });

  test("cross-tenant isolation survives WITHOUT RLS — the query's own predicate holds", async () => {
    // The test above passes even if `p.tenant_id = a.tenant_id` is deleted from
    // both queries, because the runtime role is subject to FORCE'd RLS and RLS
    // silently does the work. Verified by mutation: removing the predicate left
    // all seven other tests green.
    //
    // That is a gap worth closing rather than a reassurance. Two mechanisms are
    // claimed here — RLS and an explicit predicate — and a test that cannot
    // tell them apart proves only that at least one exists. So this runs the
    // SAME assessment as the admin role, which bypasses RLS entirely, leaving
    // the predicate as the only thing between one tenant's migration and
    // another tenant's blocker.
    const acmeId = await provisionTenant("acme");
    const globexId = await provisionTenant("globex");
    const globexMediaId = await provisionMediaObject(globexId);
    const acmeAdId = await provisionLegacyAd(acmeId);

    await provisionSuccessor(globexId, globexMediaId, acmeAdId);

    const report = await assessLegacyAdDropReadiness(getAdminSql(), acmeId);

    expect(report.outstanding).toBe(1);
    expect(report.outstandingAdIds).toEqual([acmeAdId]);
  });

  test("readiness across tenants is AND, not majority", async () => {
    const readyTenantId = await provisionTenant("acme");
    const blockedTenantId = await provisionTenant("globex");
    await provisionLegacyAd(blockedTenantId);

    const reports = [
      await assess(readyTenantId),
      await assess(blockedTenantId)
    ];

    expect(isReadyToDrop([reports[0]!])).toBe(true);
    expect(isReadyToDrop(reports)).toBe(false);
  });
});
