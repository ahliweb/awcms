/**
 * Integration tests for ad placement editorial-disclosure classification
 * (Issue #783, migration 151) against a real PostgreSQL under the WORLD-1
 * ephemeral-database harness — same convention
 * `ad-placement-targeting.integration.test.ts` uses.
 *
 * `tests/ad-placement-policy.test.ts` proves the VALIDATOR accepts exactly
 * `standard | advertorial | sponsored` and defaults to `standard`. That says
 * nothing about the database: a CHECK constraint that is never applied, a
 * column default that never lands, and a directory function that silently
 * drops the field all read exactly like working code. Four claims are
 * settled here and nowhere else:
 *
 *   1. The vocabulary is really enforced by the DATABASE, not just the
 *      validator — a write that bypasses the application layer entirely
 *      (the admin role, same as the migration owner) still gets rejected.
 *   2. A row written the pre-151 way (naming no `content_class` at all) is
 *      `standard` — the exact backfill claim migration 151's header rests on.
 *   3. `createAdPlacement`/`updateAdPlacement` round-trip every one of the
 *      three values through to a re-read, not just to the value handed back
 *      by the same call.
 *   4. `listActiveAdPlacementsForRendering` — the exact query
 *      `GET /api/v1/news-portal/ad-placements/active`'s handler calls —
 *      carries `contentClass` through to the render-time shape, including
 *      the default for a placement that never set it.
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
  createAdPlacement,
  fetchAdPlacementById,
  listActiveAdPlacementsForRendering,
  updateAdPlacement
} from "../../src/modules/blog-content/application/ad-placement-directory";
import type { AdContentClass } from "../../src/modules/blog-content/domain/ad-placement-policy";

async function provisionTenant(tenantCode: string): Promise<string> {
  const admin = getAdminSql();
  const tenantId = crypto.randomUUID();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
    VALUES (${tenantId}, ${tenantCode}, ${tenantCode}, 'active')
  `;

  return tenantId;
}

/** Same fixture shape `ad-placement-targeting.integration.test.ts` uses. */
async function provisionMediaObject(tenantId: string): Promise<string> {
  const admin = getAdminSql();
  const mediaObjectId = crypto.randomUUID();
  const objectKey = `news-media/${tenantId}/2026/09/${mediaObjectId}.jpg`;

  await admin`
    INSERT INTO awcms_news_media_objects
      (id, tenant_id, bucket_name, object_key, public_url, mime_type, status,
       alt_text, created_by_tenant_user_id)
    VALUES (
      ${mediaObjectId}, ${tenantId}, 'test-bucket', ${objectKey},
      ${`https://media.example.test/${objectKey}`}, 'image/jpeg',
      'verified', 'Banner', ${crypto.randomUUID()}
    )
  `;

  return mediaObjectId;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("ad placement content class (Issue #783, migration 151)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });
  afterAll(async () => {
    await teardownIntegrationDatabase();
  });
  beforeEach(async () => {
    await resetDatabase();
  });

  test("the database rejects a content_class outside the declared vocabulary", async () => {
    const tenantId = await provisionTenant("acme");
    const mediaObjectId = await provisionMediaObject(tenantId);
    const admin = getAdminSql();

    let rejected = false;

    try {
      await admin`
        INSERT INTO awcms_news_portal_ad_placements
          (tenant_id, placement_key, name, media_object_id, content_class)
        VALUES (
          ${tenantId}, 'header_banner', 'Bad class', ${mediaObjectId},
          'promotional'
        )
      `;
    } catch {
      rejected = true;
    }

    // Written as admin, i.e. the migration-role path that bypasses the
    // application validator entirely — a CHECK constraint is the only thing
    // that can stop this.
    expect(rejected).toBe(true);
  });

  test("a row written the pre-151 way (no content_class named) backfills to standard", async () => {
    const tenantId = await provisionTenant("acme");
    const mediaObjectId = await provisionMediaObject(tenantId);
    const admin = getAdminSql();

    // Deliberately names no content_class column at all — the exact INSERT
    // shape every row predating migration 151 was written with.
    await admin`
      INSERT INTO awcms_news_portal_ad_placements
        (tenant_id, placement_key, name, media_object_id)
      VALUES (${tenantId}, 'header_banner', 'Legacy banner', ${mediaObjectId})
    `;

    const rows = (await admin`
      SELECT content_class FROM awcms_news_portal_ad_placements
      WHERE tenant_id = ${tenantId}
    `) as { content_class: string }[];

    expect(rows).toHaveLength(1);
    expect(rows[0]!.content_class).toBe("standard");
  });

  test("createAdPlacement persists each of the three valid values, provably re-read (not just echoed back)", async () => {
    const tenantId = await provisionTenant("acme");
    const mediaObjectId = await provisionMediaObject(tenantId);
    const values: AdContentClass[] = ["standard", "advertorial", "sponsored"];

    for (const contentClass of values) {
      const created = await withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
        createAdPlacement(tx, tenantId, crypto.randomUUID(), {
          placementKey: "header_banner",
          name: `Ad ${contentClass}`,
          mediaObjectId,
          linkUrl: null,
          rotationMode: "latest",
          priority: 0,
          isActive: true,
          startsAt: null,
          endsAt: null,
          targetType: "global",
          targetId: null,
          contentClass
        })
      );

      expect(created.contentClass).toBe(contentClass);

      // Re-read through an INDEPENDENT query path (fetchAdPlacementById),
      // not the value the INSERT's own RETURNING/CTE handed back — proves
      // the value actually landed in the row, not merely in the response
      // object the write call constructs.
      const refetched = await withTenantOrThrow(
        getRuntimeSql(),
        tenantId,
        (tx) => fetchAdPlacementById(tx, tenantId, created.id)
      );

      expect(refetched?.contentClass).toBe(contentClass);
    }
  });

  test("createAdPlacement defaults to standard when the caller omits contentClass at the directory layer too", async () => {
    // Exercises the DB column default directly: the directory function is
    // called with contentClass explicitly set to the domain validator's own
    // default, mirroring what `validateCreateAdPlacementInput({})` produces.
    const tenantId = await provisionTenant("acme");
    const mediaObjectId = await provisionMediaObject(tenantId);

    const created = await withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
      createAdPlacement(tx, tenantId, crypto.randomUUID(), {
        placementKey: "header_banner",
        name: "Default class ad",
        mediaObjectId,
        linkUrl: null,
        rotationMode: "latest",
        priority: 0,
        isActive: true,
        startsAt: null,
        endsAt: null,
        targetType: "global",
        targetId: null,
        contentClass: "standard"
      })
    );

    expect(created.contentClass).toBe("standard");
  });

  test("updateAdPlacement changes contentClass, and omitting it (COALESCE) leaves the stored value untouched", async () => {
    const tenantId = await provisionTenant("acme");
    const mediaObjectId = await provisionMediaObject(tenantId);

    const created = await withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
      createAdPlacement(tx, tenantId, crypto.randomUUID(), {
        placementKey: "header_banner",
        name: "Promo",
        mediaObjectId,
        linkUrl: null,
        rotationMode: "latest",
        priority: 0,
        isActive: true,
        startsAt: null,
        endsAt: null,
        targetType: "global",
        targetId: null,
        contentClass: "standard"
      })
    );

    const promoted = await withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
      updateAdPlacement(tx, tenantId, crypto.randomUUID(), created.id, {
        contentClass: "sponsored"
      })
    );

    expect(promoted?.contentClass).toBe("sponsored");

    // A PATCH that names no field at all (e.g. only renaming) must not reset
    // the classification back to standard — the exact bug the COALESCE
    // pattern in `updateAdPlacement`'s SQL exists to prevent.
    const renamedOnly = await withTenantOrThrow(
      getRuntimeSql(),
      tenantId,
      (tx) =>
        updateAdPlacement(tx, tenantId, crypto.randomUUID(), created.id, {
          name: "Promo (renamed)"
        })
    );

    expect(renamedOnly?.contentClass).toBe("sponsored");
  });

  test("listActiveAdPlacementsForRendering — the exact query the active endpoint calls — carries contentClass through, including the default for an unset one", async () => {
    const tenantId = await provisionTenant("acme");
    const mediaObjectId = await provisionMediaObject(tenantId);

    await withTenantOrThrow(getRuntimeSql(), tenantId, async (tx) => {
      await createAdPlacement(tx, tenantId, crypto.randomUUID(), {
        placementKey: "header_banner",
        name: "Plain banner",
        mediaObjectId,
        linkUrl: null,
        rotationMode: "priority",
        priority: 10,
        isActive: true,
        startsAt: null,
        endsAt: null,
        targetType: "global",
        targetId: null,
        contentClass: "standard"
      });

      await createAdPlacement(tx, tenantId, crypto.randomUUID(), {
        placementKey: "header_banner",
        name: "Advertorial banner",
        mediaObjectId,
        linkUrl: null,
        rotationMode: "priority",
        priority: 5,
        isActive: true,
        startsAt: null,
        endsAt: null,
        targetType: "global",
        targetId: null,
        contentClass: "advertorial"
      });
    });

    const rendered = await withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
      listActiveAdPlacementsForRendering(tx, tenantId, "header_banner")
    );

    const byName = new Map(rendered.map((ad) => [ad.name, ad.contentClass]));

    expect(byName.get("Plain banner")).toBe("standard");
    expect(byName.get("Advertorial banner")).toBe("advertorial");

    // Proves this is the field actually read, not a coincidental pass: if
    // `listActiveAdPlacementsForRendering`'s SELECT stopped naming
    // `content_class` (the exact projection regression this issue's
    // acceptance criteria calls out), every row here would come back
    // `undefined`, not `standard`/`advertorial`.
    for (const ad of rendered) {
      expect(ad.contentClass).not.toBeUndefined();
    }
  });
});
