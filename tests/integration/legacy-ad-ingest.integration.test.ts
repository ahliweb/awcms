/**
 * Integration tests for ADR-0044 §4 Fase 2's legacy advertisement ingest
 * against a real PostgreSQL under the WORLD-1 ephemeral-database harness.
 *
 * `tests/legacy-ad-ingest.test.ts` proves the classification is right and the
 * migration text says the right things. Neither can see the property this file
 * exists for: **running the ingest twice must not duplicate anything.**
 *
 * That property lives entirely in migration 079's partial unique index and its
 * `NULLS NOT DISTINCT` clause, and it fails in the one way nobody notices in
 * review — the second run succeeds, reports rows written, and doubles a live
 * site's advertising. The expected operator workflow (preview, apply, resolve
 * residue, apply again) makes a second run the norm rather than the exception,
 * so this is the load-bearing assertion of the whole step.
 *
 * The partial predicate is tested from the other side too: it must NOT
 * constrain rows an editor created by hand, or the index turns ordinary
 * editorial work into a unique violation.
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
  insertIngestedAdPlacement,
  listLegacyAdPlacements,
  listLegacyAdsForIngest
} from "../../src/modules/blog-content/application/legacy-ad-ingest-directory";
import { fetchNewsMediaObjectByObjectKey } from "../../src/modules/media-library/application/media-object-directory";

async function provisionTenant(tenantCode: string): Promise<string> {
  const admin = getAdminSql();
  const tenantId = crypto.randomUUID();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
    VALUES (${tenantId}, ${tenantCode}, ${tenantCode}, 'active')
  `;

  return tenantId;
}

async function provisionMediaObject(
  tenantId: string,
  status = "verified"
): Promise<{ id: string; objectKey: string }> {
  const admin = getAdminSql();
  const id = crypto.randomUUID();
  const objectKey = `news-media/${tenantId}/2026/07/${id}.jpg`;

  await admin`
    INSERT INTO awcms_news_media_objects
      (id, tenant_id, bucket_name, object_key, public_url, mime_type, status,
       alt_text, created_by_tenant_user_id)
    VALUES (
      ${id}, ${tenantId}, 'test-bucket', ${objectKey},
      ${`https://media.example.test/${objectKey}`}, 'image/jpeg', ${status},
      'Banner', ${crypto.randomUUID()}
    )
  `;

  return { id, objectKey };
}

async function provisionLegacyAd(
  tenantId: string,
  imageUrl: string,
  placements: readonly { placementType: string; targetId: string | null }[]
): Promise<string> {
  const admin = getAdminSql();
  const adId = crypto.randomUUID();

  await admin`
    INSERT INTO awcms_blog_ads (id, tenant_id, name, image_url, link_url)
    VALUES (${adId}, ${tenantId}, 'Legacy banner', ${imageUrl}, null)
  `;

  for (const placement of placements) {
    await admin`
      INSERT INTO awcms_blog_ad_placements
        (tenant_id, ad_id, placement_type, target_id)
      VALUES (
        ${tenantId}, ${adId}, ${placement.placementType}, ${placement.targetId}
      )
    `;
  }

  return adId;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("legacy advertisement ingest (ADR-0044 §4, migration 079)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });
  afterAll(async () => {
    await teardownIntegrationDatabase();
  });
  beforeEach(async () => {
    await resetDatabase();
  });

  test("re-running the ingest inserts nothing it already inserted", async () => {
    const tenantId = await provisionTenant("acme");
    const media = await provisionMediaObject(tenantId);
    const adId = await provisionLegacyAd(
      tenantId,
      `https://media.example.test/${media.objectKey}`,
      [{ placementType: "global", targetId: null }]
    );

    async function runIngest(): Promise<boolean> {
      return withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
        insertIngestedAdPlacement(tx, tenantId, {
          placementKey: "sidebar_top",
          name: "Legacy banner",
          mediaObjectId: media.id,
          linkUrl: null,
          isActive: true,
          startsAt: null,
          endsAt: null,
          targetType: "global",
          targetId: null,
          sourceLegacyAdId: adId
        })
      );
    }

    expect(await runIngest()).toBe(true);
    // A `global` row has a NULL `target_id`. Under PostgreSQL's DEFAULT
    // NULLS-DISTINCT semantics two such rows never conflict, `ON CONFLICT DO
    // NOTHING` never fires, and this second call would report success while
    // doubling a live site's advertising.
    expect(await runIngest()).toBe(false);
    expect(await runIngest()).toBe(false);

    const rows = (await getAdminSql()`
      SELECT count(*)::int AS total FROM awcms_news_portal_ad_placements
      WHERE tenant_id = ${tenantId} AND source_legacy_ad_id = ${adId}
    `) as { total: number }[];

    expect(rows[0]!.total).toBe(1);
  });

  test("one legacy ad with several targets becomes several distinct rows", async () => {
    const tenantId = await provisionTenant("acme");
    const media = await provisionMediaObject(tenantId);
    const postId = crypto.randomUUID();
    const pageId = crypto.randomUUID();
    const adId = await provisionLegacyAd(
      tenantId,
      `https://media.example.test/${media.objectKey}`,
      [
        { placementType: "global", targetId: null },
        { placementType: "post", targetId: postId },
        { placementType: "page", targetId: pageId }
      ]
    );

    for (const [targetType, targetId] of [
      ["global", null],
      ["post", postId],
      ["page", pageId]
    ] as const) {
      const written = await withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
        insertIngestedAdPlacement(tx, tenantId, {
          placementKey: "sidebar_top",
          name: "Legacy banner",
          mediaObjectId: media.id,
          linkUrl: null,
          isActive: true,
          startsAt: null,
          endsAt: null,
          targetType,
          targetId,
          sourceLegacyAdId: adId
        })
      );

      expect(written).toBe(true);
    }

    const rows = (await getAdminSql()`
      SELECT count(*)::int AS total FROM awcms_news_portal_ad_placements
      WHERE tenant_id = ${tenantId} AND source_legacy_ad_id = ${adId}
    `) as { total: number }[];

    expect(rows[0]!.total).toBe(3);
  });

  test("the unique index does NOT constrain hand-created placements", async () => {
    // Every row an editor writes has a NULL `source_legacy_ad_id`. If the index
    // were not partial, `NULLS NOT DISTINCT` would make these two collide and
    // the second insert would fail with a unique violation naming a column no
    // editor has ever heard of.
    const tenantId = await provisionTenant("acme");
    const media = await provisionMediaObject(tenantId);
    const admin = getAdminSql();

    for (const name of ["First global banner", "Second global banner"]) {
      await admin`
        INSERT INTO awcms_news_portal_ad_placements
          (tenant_id, placement_key, name, media_object_id, target_type)
        VALUES (${tenantId}, 'sidebar_top', ${name}, ${media.id}, 'global')
      `;
    }

    const rows = (await admin`
      SELECT count(*)::int AS total FROM awcms_news_portal_ad_placements
      WHERE tenant_id = ${tenantId} AND source_legacy_ad_id IS NULL
    `) as { total: number }[];

    expect(rows[0]!.total).toBe(2);
  });

  test("the directory reads only this tenant's legacy ads", async () => {
    const acmeId = await provisionTenant("acme");
    const globexId = await provisionTenant("globex");

    await provisionLegacyAd(acmeId, "https://cdn.example/acme.jpg", [
      { placementType: "global", targetId: null }
    ]);
    await provisionLegacyAd(globexId, "https://cdn.example/globex.jpg", [
      { placementType: "global", targetId: null }
    ]);

    const acmeAds = await withTenantOrThrow(getRuntimeSql(), acmeId, (tx) =>
      listLegacyAdsForIngest(tx, acmeId)
    );

    expect(acmeAds).toHaveLength(1);
    expect(acmeAds[0]!.imageUrl).toBe("https://cdn.example/acme.jpg");

    const placements = await withTenantOrThrow(getRuntimeSql(), acmeId, (tx) =>
      listLegacyAdPlacements(tx, acmeId, acmeAds[0]!.id)
    );

    expect(placements).toEqual([{ placementType: "global", targetId: null }]);
  });

  test("a soft-deleted media object is not found, so its ad becomes residue", async () => {
    // `objectKeyExistsForTenant` deliberately ignores `deleted_at`, because its
    // question is "is this key tracked" before a destructive R2 delete. The
    // ingest asks the opposite question — "may a new ad point at this" — and a
    // soft-deleted object is exactly what must not acquire a fresh public
    // reference. Reusing the wrong lookup would resurrect deleted media.
    const tenantId = await provisionTenant("acme");
    const media = await provisionMediaObject(tenantId);

    await getAdminSql()`
      UPDATE awcms_news_media_objects
      SET deleted_at = now() WHERE id = ${media.id}
    `;

    const found = await withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
      fetchNewsMediaObjectByObjectKey(tx, tenantId, media.objectKey)
    );

    expect(found).toBe(null);
  });

  test("a media object lookup does not cross tenants", async () => {
    const acmeId = await provisionTenant("acme");
    const globexId = await provisionTenant("globex");
    const acmeMedia = await provisionMediaObject(acmeId);

    const found = await withTenantOrThrow(getRuntimeSql(), globexId, (tx) =>
      fetchNewsMediaObjectByObjectKey(tx, globexId, acmeMedia.objectKey)
    );

    expect(found).toBe(null);
  });
});
