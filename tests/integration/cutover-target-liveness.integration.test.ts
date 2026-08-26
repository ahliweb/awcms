/**
 * Pre-cutover target liveness against a real PostgreSQL (Issue #599 item 4,
 * Issue #711, ADR-0114).
 *
 * ## The thing this proves that no unit test can
 *
 * `blog:legacy:cutover:verify` reported `ok` for every destination it could not
 * look up. `targetLive` came back `null`, `null` fell through to `return "ok"`,
 * and the report printed "All N legacy URL(s) resolve in one hop to a page this
 * deployment serves" — for 62 rules whose targets (`/kategori/**`) are served
 * by an entirely different deployment. The gate could not fail.
 *
 * Fixing that has two halves, and only one of them is pure:
 *
 *  1. the verdict — `target_unverifiable` instead of `ok` (tested next door in
 *     `tests/cutover-verification.test.ts`);
 *  2. the LOOKUP — teaching the job the archive families this repo really does
 *     serve, so a `/blog/{code}/category/{slug}` target is answered from a row
 *     rather than shrugged at.
 *
 * Half 2 is a claim about SQL, `deleted_at`, `status`, `visibility` and a
 * tenant-level settings read. Asserting it against a hand-rolled fake would
 * prove the fake agrees with itself. So the rows below are real, inserted into
 * a migrated database, and read back through the SAME functions the public
 * routes call: `fetchPublicTermBySlug` (`category/[slug].ts`, `tag/[slug].ts`),
 * `fetchPublicBlogPostBySlug` (`[slug].ts`) and `fetchPublicBlogPageBySlug`
 * (`pages/[slug].ts`).
 *
 * ## The `/news/**` case is here on purpose
 *
 * ADR-0114 decision 2 exists because the shipped article template matches 0 of
 * 25,029 legacy URLs: every legacy title contains a space, so every legacy URL
 * segment carries `_`, which `SLUG_PATTERN` forbids — and matching is by
 * equality, so no slug that can pass the validator can ever equal the indexed
 * segment. The last test seeds a post the way the importer would and asks for
 * the `/blog/{code}/{id}_{Raw_Slug}.html` path the retired-`/news` fallback
 * builds. It must come back `target_missing`. If it ever comes back `ok`, the
 * fallback has started 301ing into a 404 again and nobody will be told.
 *
 * Gated on `DATABASE_URL` (harness §Gating).
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
import { classifyCutoverOutcome } from "../../src/modules/seo-distribution/domain/cutover-verification";
import { resolveTargetLiveness } from "../../scripts/blog-legacy-cutover-verify";
import type { EffectivePublicRouteSettings } from "../../src/modules/blog-content/application/public-route-settings";

const TENANT = "f4444444-4444-4444-8444-444444444444";
const TENANT_CODE = "seputarborneo";
const AUTHOR = "a4444444-4444-4444-8444-444444444444";

/** The default a tenant that has never touched its settings resolves to. */
const ROUTES_ON: EffectivePublicRouteSettings = {
  legacyTenantRouteEnabled: true,
  rssEnabled: true,
  sitemapEnabled: true
};

async function seedFixtures(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT}, ${TENANT_CODE}, 'Seputar Borneo')
  `;

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT}, 'person', 'Redaksi')
    RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${TENANT}, ${profile[0]!.id}, 'redaksi@example.test', 'x')
    RETURNING id
  `) as { id: string }[];
  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
    VALUES (${AUTHOR}, ${TENANT}, ${identity[0]!.id})
  `;

  // One live category, one live tag, one SOFT-DELETED category: the third is
  // the case a bare `EXISTS` would get wrong, and the route it stands in for
  // answers 404 for it.
  await admin`
    INSERT INTO awcms_blog_terms (tenant_id, taxonomy_type, name, slug)
    VALUES (${TENANT}, 'category', 'Kalteng', 'kalteng'),
           (${TENANT}, 'tag', 'Banjir', 'banjir')
  `;
  await admin`
    INSERT INTO awcms_blog_terms (tenant_id, taxonomy_type, name, slug, deleted_at)
    VALUES (${TENANT}, 'category', 'Rubrik Lama', 'rubrik-lama', now())
  `;

  await admin`
    INSERT INTO awcms_blog_posts
      (tenant_id, author_tenant_user_id, title, slug, content_json, content_text,
       status, visibility, locale, published_at)
    VALUES
      (${TENANT}, ${AUTHOR}, 'Banjir Kobar', 'banjir-kobar', '{}'::jsonb, 'isi',
       'published', 'public', 'id', now() - interval '1 day'),
      (${TENANT}, ${AUTHOR}, 'Belum Terbit', 'belum-terbit', '{}'::jsonb, 'isi',
       'draft', 'public', 'id', NULL)
  `;
}

/** The exact call the script makes for one resolved destination. */
async function liveness(
  target: string,
  settings: EffectivePublicRouteSettings = ROUTES_ON
): Promise<boolean | null> {
  return withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
    resolveTargetLiveness(tx, TENANT, TENANT_CODE, settings, target)
  );
}

/** …and the verdict that liveness produces for a one-hop rule. */
async function verdictFor(
  target: string,
  settings: EffectivePublicRouteSettings = ROUTES_ON
): Promise<string> {
  return classifyCutoverOutcome({
    eligible: true,
    hops: 1,
    refusal: null,
    targetLive: await liveness(target, settings)
  });
}

const suite = integrationEnabled ? describe : describe.skip;

suite("cutover target liveness", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedFixtures();
  });

  test("a /kategori/* target is UNVERIFIABLE, never ok", async () => {
    // The assertion whose absence let 62 rules look verified. There is no query
    // that could answer this one: `/kategori/**` is served by
    // `ahliweb/awcms-astro`, a separate `output: "static"` deployment with no
    // middleware, and ADR-0114 moved the 301s themselves to the edge.
    expect(await liveness("/kategori/kalteng")).toBeNull();
    expect(await verdictFor("/kategori/kalteng")).toBe("target_unverifiable");

    // …including when a category with that very slug DOES exist here. The slug
    // matching is not the point; the origin is.
    expect(await verdictFor("/kategori/nope")).toBe("target_unverifiable");
  });

  test("a category archive this repo serves resolves from a real row", async () => {
    expect(await liveness(`/blog/${TENANT_CODE}/category/kalteng`)).toBe(true);
    expect(await verdictFor(`/blog/${TENANT_CODE}/category/kalteng`)).toBe(
      "ok"
    );
  });

  test("a tag archive too", async () => {
    expect(await liveness(`/blog/${TENANT_CODE}/tag/banjir`)).toBe(true);
    expect(await verdictFor(`/blog/${TENANT_CODE}/tag/banjir`)).toBe("ok");
  });

  test("an archive whose term does NOT exist is a 301 into a 404", async () => {
    expect(await liveness(`/blog/${TENANT_CODE}/category/tidak-ada`)).toBe(
      false
    );
    expect(await verdictFor(`/blog/${TENANT_CODE}/category/tidak-ada`)).toBe(
      "target_missing"
    );
  });

  test("a SOFT-DELETED term is missing, not live", async () => {
    // `fetchPublicTermBySlug` filters `deleted_at IS NULL`, and the archive
    // route 404s. A liveness check that only asked "is there a row" would call
    // this one green.
    expect(await liveness(`/blog/${TENANT_CODE}/category/rubrik-lama`)).toBe(
      false
    );
  });

  test("the taxonomy type is part of the identity", async () => {
    // `kalteng` is a category and `banjir` is a tag. Crossing them must miss —
    // otherwise a tag archive would vouch for a category target.
    expect(await liveness(`/blog/${TENANT_CODE}/tag/kalteng`)).toBe(false);
    expect(await liveness(`/blog/${TENANT_CODE}/category/banjir`)).toBe(false);
  });

  test("a published post is live and a draft is not", async () => {
    expect(await liveness(`/blog/${TENANT_CODE}/banjir-kobar`)).toBe(true);
    expect(await liveness(`/blog/${TENANT_CODE}/belum-terbit`)).toBe(false);
  });

  test("the retired-/news fallback target is reported MISSING, not ok", async () => {
    // ADR-0114 decision 2, stated as a test. `buildLegacyBlogPath` produces
    // this shape, and no slug that can pass `SLUG_PATTERN` (lowercase, hyphens,
    // no `_`) can ever equal it — so the fallback 301s into a 404 for all
    // 25,029 articles. That is `CUTOVER_VERDICT_REASON.target_missing` in its
    // own words, and this is the assertion that says so out loud.
    expect(
      await verdictFor(`/blog/${TENANT_CODE}/48213_Banjir_Kobar.html`)
    ).toBe("target_missing");
  });

  test("with the public surface OFF, every destination here is a 404", async () => {
    // Each of the eight `/blog/{tenantCode}/*` routes checks
    // `legacyTenantRouteEnabled` FIRST and answers 404 when it is off
    // (ADR-0071 §3). A verifier that skipped the setting would report a live
    // category for a tenant serving no public content at all.
    const off: EffectivePublicRouteSettings = {
      legacyTenantRouteEnabled: false,
      rssEnabled: true,
      sitemapEnabled: true
    };

    expect(await liveness(`/blog/${TENANT_CODE}/category/kalteng`, off)).toBe(
      false
    );
    expect(await liveness(`/blog/${TENANT_CODE}/banjir-kobar`, off)).toBe(
      false
    );
    expect(await liveness(`/blog/${TENANT_CODE}`, off)).toBe(false);

    // …and an off-surface target is STILL unverifiable rather than false: the
    // tenant's own setting says nothing about another deployment's routes.
    expect(await liveness("/kategori/kalteng", off)).toBeNull();
  });

  test("the feed and sitemap follow their own settings", async () => {
    const noFeeds: EffectivePublicRouteSettings = {
      legacyTenantRouteEnabled: true,
      rssEnabled: false,
      sitemapEnabled: false
    };

    expect(await liveness(`/blog/${TENANT_CODE}/feed.xml`)).toBe(true);
    expect(await liveness(`/blog/${TENANT_CODE}/feed.xml`, noFeeds)).toBe(
      false
    );
    expect(
      await liveness(`/blog/${TENANT_CODE}/sitemap-blog.xml`, noFeeds)
    ).toBe(false);
  });

  test("another tenant's row cannot vouch for this tenant's target", async () => {
    const admin = getAdminSql();
    const other = "f5555555-5555-4555-8555-555555555555";

    await admin`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${other}, 'tetangga', 'Tetangga')
    `;
    await admin`
      INSERT INTO awcms_blog_terms (tenant_id, taxonomy_type, name, slug)
      VALUES (${other}, 'category', 'Milik Tetangga', 'milik-tetangga')
    `;

    expect(await liveness(`/blog/${TENANT_CODE}/category/milik-tetangga`)).toBe(
      false
    );
  });
});
