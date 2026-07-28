/**
 * Integration tests for ad placement targeting (ADR-0044 §4, migration 078)
 * against a real PostgreSQL under the WORLD-1 ephemeral-database harness.
 *
 * `tests/ad-placement-targeting.test.ts` reads migration 078 as TEXT and
 * asserts it says the right things. That is worth having — sequencing is a
 * property of the file — but it proves nothing about the database. A CHECK
 * constraint that is never applied, a column default that never lands, and a
 * WHERE clause that quietly matches nothing all read exactly like working code.
 *
 * Three claims are settled here and nowhere else:
 *
 *   1. The pairing rule is really enforced by the DATABASE. This is the whole
 *      reason it was not left in the validator: the retired free-URL system
 *      enforced its identical rule in application code only, which held right
 *      up until a writer skipped it.
 *   2. Rendering unions global ads with the page's own. The retired system
 *      matched one scope exactly, so getting this wrong is not a crash — it is
 *      a site-wide banner that silently stops appearing on article pages.
 *   3. A row written the pre-078 way is site-wide. Migration 078 rests on it,
 *      and it is the difference between "widening changed nothing for existing
 *      ads" and "every existing ad quietly stopped rendering".
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
import { listActiveAdPlacementsForRendering } from "../../src/modules/blog-content/application/ad-placement-directory";

async function provisionTenant(tenantCode: string): Promise<string> {
  const admin = getAdminSql();
  const tenantId = crypto.randomUUID();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
    VALUES (${tenantId}, ${tenantCode}, ${tenantCode}, 'active')
  `;

  return tenantId;
}

/**
 * A `verified` media object, which is what `listActiveAdPlacementsForRendering`
 * requires before it will return a row at all — `media_object_id` is a real FK,
 * so there is no way to exercise the render path without one.
 */
async function provisionMediaObject(tenantId: string): Promise<string> {
  const admin = getAdminSql();
  const mediaObjectId = crypto.randomUUID();
  // Migration 041 constrains `object_key` to
  // `news-media/<tenant_id>/<yyyy>/<mm>/<uuid>.<ext>` — the registry's own
  // server-generated layout (`news-media-object-key.ts`). Built here rather
  // than through that helper so this fixture stays a plain INSERT.
  const objectKey = `news-media/${tenantId}/2026/07/${mediaObjectId}.jpg`;

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

suite("ad placement targeting (ADR-0044 §4, migration 078)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });
  afterAll(async () => {
    await teardownIntegrationDatabase();
  });
  beforeEach(async () => {
    await resetDatabase();
  });

  test("the database rejects a global placement that carries a target id", async () => {
    const tenantId = await provisionTenant("acme");
    const mediaObjectId = await provisionMediaObject(tenantId);
    const admin = getAdminSql();

    let rejected = false;

    try {
      await admin`
        INSERT INTO awcms_news_portal_ad_placements
          (tenant_id, placement_key, name, media_object_id, target_type, target_id)
        VALUES (
          ${tenantId}, 'sidebar_top', 'Bad global', ${mediaObjectId},
          'global', ${crypto.randomUUID()}
        )
      `;
    } catch {
      rejected = true;
    }

    // Written as admin, i.e. the migration-role path that bypasses RLS
    // entirely — a CHECK constraint is the only thing that can stop this, and
    // that is exactly the writer the application-only rule could not reach.
    expect(rejected).toBe(true);
  });

  test("the database rejects a scoped placement with no target id", async () => {
    const tenantId = await provisionTenant("acme");
    const mediaObjectId = await provisionMediaObject(tenantId);
    const admin = getAdminSql();

    let rejected = false;

    try {
      await admin`
        INSERT INTO awcms_news_portal_ad_placements
          (tenant_id, placement_key, name, media_object_id, target_type)
        VALUES (
          ${tenantId}, 'sidebar_top', 'Dangling post ad', ${mediaObjectId}, 'post'
        )
      `;
    } catch {
      rejected = true;
    }

    expect(rejected).toBe(true);
  });

  test("a row written the pre-078 way is site-wide, so existing ads keep rendering", async () => {
    const tenantId = await provisionTenant("acme");
    const mediaObjectId = await provisionMediaObject(tenantId);
    const admin = getAdminSql();

    // Deliberately names neither targeting column — the exact INSERT shape
    // every row predating migration 078 was written with.
    await admin`
      INSERT INTO awcms_news_portal_ad_placements
        (tenant_id, placement_key, name, media_object_id)
      VALUES (${tenantId}, 'sidebar_top', 'Legacy banner', ${mediaObjectId})
    `;

    const rows = (await admin`
      SELECT target_type, target_id FROM awcms_news_portal_ad_placements
      WHERE tenant_id = ${tenantId}
    `) as { target_type: string; target_id: string | null }[];

    expect(rows).toHaveLength(1);
    expect(rows[0]!.target_type).toBe("global");
    expect(rows[0]!.target_id).toBe(null);

    // And it still renders for a caller that asks for no particular target,
    // which is what every pre-078 caller does.
    const rendered = await withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
      listActiveAdPlacementsForRendering(tx, tenantId, "sidebar_top")
    );

    expect(rendered.map((ad) => ad.name)).toEqual(["Legacy banner"]);
  });

  test("rendering a post unions the global ads with that post's own, and excludes another post's", async () => {
    const tenantId = await provisionTenant("acme");
    const mediaObjectId = await provisionMediaObject(tenantId);
    const admin = getAdminSql();

    const thisPostId = crypto.randomUUID();
    const otherPostId = crypto.randomUUID();

    for (const [name, targetType, targetId] of [
      ["Site-wide banner", "global", null],
      ["This article only", "post", thisPostId],
      ["Another article only", "post", otherPostId],
      ["A page, not a post", "page", thisPostId]
    ] as const) {
      await admin`
        INSERT INTO awcms_news_portal_ad_placements
          (tenant_id, placement_key, name, media_object_id, target_type, target_id)
        VALUES (
          ${tenantId}, 'sidebar_top', ${name}, ${mediaObjectId},
          ${targetType}, ${targetId}
        )
      `;
    }

    const rendered = await withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
      listActiveAdPlacementsForRendering(tx, tenantId, "sidebar_top", {
        targetType: "post",
        targetId: thisPostId
      })
    );

    // The last row is the one a naive `target_id = $1` filter would wrongly
    // include: same id, different type. Type and id must both match.
    expect(rendered.map((ad) => ad.name).sort()).toEqual([
      "Site-wide banner",
      "This article only"
    ]);
  });

  test("asking for no target returns global ads only", async () => {
    const tenantId = await provisionTenant("acme");
    const mediaObjectId = await provisionMediaObject(tenantId);
    const admin = getAdminSql();

    for (const [name, targetType, targetId] of [
      ["Site-wide banner", "global", null],
      ["Article only", "post", crypto.randomUUID()]
    ] as const) {
      await admin`
        INSERT INTO awcms_news_portal_ad_placements
          (tenant_id, placement_key, name, media_object_id, target_type, target_id)
        VALUES (
          ${tenantId}, 'sidebar_top', ${name}, ${mediaObjectId},
          ${targetType}, ${targetId}
        )
      `;
    }

    const rendered = await withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
      listActiveAdPlacementsForRendering(tx, tenantId, "sidebar_top")
    );

    expect(rendered.map((ad) => ad.name)).toEqual(["Site-wide banner"]);
  });

  test("targeting does not cross tenants — one tenant's post id selects nothing in another", async () => {
    const acmeId = await provisionTenant("acme");
    const globexId = await provisionTenant("globex");
    const acmeMediaId = await provisionMediaObject(acmeId);
    const admin = getAdminSql();

    const acmePostId = crypto.randomUUID();

    await admin`
      INSERT INTO awcms_news_portal_ad_placements
        (tenant_id, placement_key, name, media_object_id, target_type, target_id)
      VALUES (
        ${acmeId}, 'sidebar_top', 'Acme article ad', ${acmeMediaId},
        'post', ${acmePostId}
      )
    `;

    const rendered = await withTenantOrThrow(getRuntimeSql(), globexId, (tx) =>
      listActiveAdPlacementsForRendering(tx, globexId, "sidebar_top", {
        targetType: "post",
        targetId: acmePostId
      })
    );

    expect(rendered).toEqual([]);
  });
});
