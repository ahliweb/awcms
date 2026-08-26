/**
 * Issue #599 — the legacy import and the redirect map it makes derivable,
 * against real PostgreSQL.
 *
 * The pure half (record validation, refusal-not-repair, the source-level
 * invariants) is in `tests/blog-legacy-import.test.ts`. What only a real
 * database can prove is the half that decides whether the archive survives the
 * move:
 *
 *   1. `ON CONFLICT DO NOTHING` on `sql/138`'s PARTIAL unique index actually
 *      catches a re-run. A partial index is only a conflict target when the
 *      `ON CONFLICT` clause repeats its predicate, and getting that wrong
 *      raises `there is no unique or exclusion constraint matching` — at
 *      runtime, in the middle of an import, never at compile time.
 *   2. `published_at` survives the round trip. The whole issue is SEO equity,
 *      and an import that re-dated the archive would look completely normal.
 *   3. The redirect map comes back LOCALE-PREFIXED (ADR-0098) and covers only
 *      published, non-deleted rows.
 *   4. A mapped image is a REGISTRY question, not a uuid-shape one — see the
 *      second suite at the bottom of this file.
 *
 * WORLD 1 (harness.ts) — the ephemeral migrated database, driven through the
 * application layer inside `withTenantOrThrow`.
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
  findTakenSlugs,
  importLegacyBlogPost
} from "../../src/modules/blog-content/application/legacy-import-directory";
import {
  listLegacyArticlePaths,
  listLegacyRedirectMappings
} from "../../src/modules/blog-content/application/blog-post-directory";
import { convertLegacyHtmlToPortableText } from "../../src/modules/blog-content/domain/legacy-html-conversion";
import { mediaLibraryPortAdapter } from "../../src/modules/media-library/application/media-library-port-adapter";
import type { LegacyPostImportInput } from "../../src/modules/blog-content/application/legacy-import-directory";

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_TENANT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AUTHOR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SYSTEM = "seputarborneo";

/** March 2019 — years before any row in this test database was created. */
const ORIGINAL_PUBLISHED_AT = new Date("2019-03-04T02:11:00.000Z");

function input(
  overrides: Partial<LegacyPostImportInput> = {}
): LegacyPostImportInput {
  return {
    legacyId: "48213",
    title: "Banjir melanda Kobar",
    slug: "banjir-melanda-kobar",
    excerpt: null,
    bodyPortableText: [
      {
        _type: "block",
        _key: "b1",
        style: "normal",
        children: [{ _type: "span", _key: "s1", text: "Air naik.", marks: [] }],
        markDefs: []
      }
    ],
    locale: "id",
    status: "published",
    visibility: "public",
    publishedAt: ORIGINAL_PUBLISHED_AT,
    seoTitle: null,
    metaDescription: null,
    featuredMediaId: null,
    // Defaults to the no-`--section-map` state, so the existing cases keep
    // asserting what that envelope looks like; the section cases opt in.
    section: null,
    ...overrides
  };
}

async function seedTenants(): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
    VALUES
      (${TENANT}, 'lentera', 'Lentera', 'active'),
      (${OTHER_TENANT}, 'seputar', 'Seputar', 'active')
    ON CONFLICT (id) DO NOTHING
  `;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("legacy article import (integration, Issue #599)", () => {
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

  test("the original publication date survives the round trip", async () => {
    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      importLegacyBlogPost(tx, TENANT, AUTHOR, SYSTEM, input())
    );

    const rows = (await getAdminSql()`
      SELECT published_at, status, legacy_source_system, legacy_source_id
      FROM awcms_blog_posts WHERE tenant_id = ${TENANT}
    `) as {
      published_at: Date;
      status: string;
      legacy_source_system: string;
      legacy_source_id: string;
    }[];

    expect(rows).toHaveLength(1);
    // The entire point of the issue. A row re-dated to the cutover afternoon
    // looks completely normal and has thrown away years of indexing.
    expect(rows[0]!.published_at.toISOString()).toBe(
      ORIGINAL_PUBLISHED_AT.toISOString()
    );
    expect(rows[0]!.status).toBe("published");
    expect(rows[0]!.legacy_source_system).toBe(SYSTEM);
    expect(rows[0]!.legacy_source_id).toBe("48213");
  });

  test("content_json arrives with a DERIVED projection and the section sidecar", async () => {
    // The half no pure test can reach, and the reason this case exists at all.
    //
    // `tests/legacy-section-map.test.ts` proves `legacyContentJson` builds the
    // right envelope. It passes just as happily over a function the INSERT does
    // not call — which is exactly the state this file shipped in: a hard-coded
    // `{ blocks: [] }` sat in the INSERT under a docblock claiming it was "the
    // same lossy projection every other write path produces". Only reading the
    // column back out of Postgres can tell the two apart.
    //
    // Both halves are what `ahliweb/awcms-astro` reads:
    //   - `renderContentBlocks(post.contentJson)` reads `blocks`, and returns
    //     "" for an empty array — a blank page for every article.
    //   - `getArticles` keeps a post only when `readBlock(post).kategori ===
    //     tab`, reading `awcmsAstro` — with no key, NO page is built at all,
    //     and no category archive either.
    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      importLegacyBlogPost(
        tx,
        TENANT,
        AUTHOR,
        SYSTEM,
        input({ section: "hukum" })
      )
    );

    const rows = (await getAdminSql()`
      SELECT content_json FROM awcms_blog_posts WHERE tenant_id = ${TENANT}
    `) as { content_json: Record<string, unknown> }[];

    expect(rows).toHaveLength(1);
    const envelope = rows[0]!.content_json;

    // An OBJECT, not the scalar string `"{\"blocks\":[]}"`. Bun JSON-encodes a
    // string bound to a jsonb slot (Issue #641), and a round trip is the only
    // thing that can catch it.
    expect(typeof envelope).toBe("object");

    expect(Array.isArray(envelope.blocks)).toBe(true);
    expect((envelope.blocks as unknown[]).length).toBeGreaterThan(0);
    expect(JSON.stringify(envelope.blocks)).toContain("Air naik.");

    expect(envelope.awcmsAstro).toEqual({
      schemaVersion: 1,
      kategori: "hukum"
    });
  });

  test("no section still stores a real body projection, and omits the sidecar", async () => {
    // The default path — no `--section-map`. It must not regress into the empty
    // envelope just because the sidecar is absent: an archive imported for a
    // tenant THIS repo serves still needs `blocks` for any later consumer, and
    // the two halves were broken by one line together.
    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      importLegacyBlogPost(tx, TENANT, AUTHOR, SYSTEM, input())
    );

    const rows = (await getAdminSql()`
      SELECT content_json FROM awcms_blog_posts WHERE tenant_id = ${TENANT}
    `) as { content_json: Record<string, unknown> }[];

    const envelope = rows[0]!.content_json;
    expect((envelope.blocks as unknown[]).length).toBeGreaterThan(0);
    expect("awcmsAstro" in envelope).toBe(false);
  });

  test("the redirect map applies the SERVING route's full predicate", async () => {
    // The docblock on `listLegacyRedirectMappings` promises exactly this, and
    // before this case existed it promised it over nothing: the function's four
    // integration call sites cover one-hop/locale-prefix, draft+soft-deleted,
    // unsupported-locale and cross-tenant, and not one of them seeds a
    // `private`, `unlisted`, unpublished or future-dated post.
    //
    // The function had said "only PUBLISHED, non-deleted posts: a redirect
    // pointing at a draft sends a search engine to a 404" over exactly those
    // two conditions, while `fetchPublicBlogPostBySlug` requires four. So a
    // `private` post and a future-dated one each got a rule whose destination
    // 404s — the failure the paragraph names, produced by its own function.
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await withTenantOrThrow(getRuntimeSql(), TENANT, async (tx) => {
      await importLegacyBlogPost(tx, TENANT, AUTHOR, SYSTEM, input());
      await importLegacyBlogPost(
        tx,
        TENANT,
        AUTHOR,
        SYSTEM,
        input({ legacyId: "2", slug: "private-post", visibility: "private" })
      );
      await importLegacyBlogPost(
        tx,
        TENANT,
        AUTHOR,
        SYSTEM,
        input({ legacyId: "3", slug: "unlisted-post", visibility: "unlisted" })
      );
      await importLegacyBlogPost(
        tx,
        TENANT,
        AUTHOR,
        SYSTEM,
        input({ legacyId: "4", slug: "future-post", publishedAt: future })
      );
      await importLegacyBlogPost(
        tx,
        TENANT,
        AUTHOR,
        SYSTEM,
        input({
          legacyId: "5",
          slug: "never-published",
          status: "draft",
          publishedAt: null
        })
      );
    });

    const mappings = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      listLegacyRedirectMappings(tx, TENANT, {
        system: SYSTEM,
        tenantCode: "lentera",
        pathTemplate: "/news/{legacyId}_{slug}.html"
      })
    );

    const ids = mappings.map((entry) => entry.legacyId).sort();

    // `unlisted` IS served by this repo's public route, so it keeps its rule.
    // `private`, future-dated and never-published do not, and must not.
    // "48213" is the fixture default; "3" is the unlisted one.
    expect(ids).toEqual(["3", "48213"]);
  });

  test("listLegacyArticlePaths reads the SECTION back out of the jsonb envelope", async () => {
    // The query that decides all 25,029 redirect destinations, and it had no
    // test at all — while `tests/blog-legacy-article-paths.test.ts` said in its
    // own header that "the query behind it is exercised" here. A comment
    // asserting a binding no call makes, in a file added to fix an instance of
    // that. This is the call.
    //
    // Three things only Postgres can answer:
    //   - `content_json -> 'awcmsAstro' ->> 'kategori'` really extracts the
    //     section from the envelope `legacyContentJson` wrote;
    //   - it yields SQL NULL for a row with no sidecar, rather than throwing or
    //     returning the string "null";
    //   - the predicate deliberately DIVERGES from its sibling by excluding
    //     `unlisted`, because the consuming site builds pages only for
    //     `visibility === 'public'`.
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await withTenantOrThrow(getRuntimeSql(), TENANT, async (tx) => {
      await importLegacyBlogPost(
        tx,
        TENANT,
        AUTHOR,
        SYSTEM,
        input({ section: "hukum" })
      );
      await importLegacyBlogPost(
        tx,
        TENANT,
        AUTHOR,
        SYSTEM,
        input({ legacyId: "2", slug: "no-section-post", section: null })
      );
      await importLegacyBlogPost(
        tx,
        TENANT,
        AUTHOR,
        SYSTEM,
        input({
          legacyId: "3",
          slug: "unlisted-post",
          visibility: "unlisted",
          section: "hukum"
        })
      );
      await importLegacyBlogPost(
        tx,
        TENANT,
        AUTHOR,
        SYSTEM,
        input({ legacyId: "4", slug: "future-post", publishedAt: future })
      );
    });

    const rows = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      listLegacyArticlePaths(tx, TENANT, { system: SYSTEM })
    );

    // `unlisted` and the future-dated row are BOTH absent: the artefact must
    // describe the pages the consuming site actually generates, and one that is
    // more generous than its consumer is a 301 into a 404 wearing a green
    // report. That is the deliberate divergence from
    // `listLegacyRedirectMappings`, which keeps `unlisted` because THIS repo's
    // route serves it.
    expect(rows.map((row) => row.legacyId).sort()).toEqual(["2", "48213"]);

    const withSection = rows.find((row) => row.legacyId === "48213");
    const withoutSection = rows.find((row) => row.legacyId === "2");

    expect(withSection?.section).toBe("hukum");
    // `->>` yields SQL NULL for a missing key, and the driver must hand that
    // back as `null` — not as the four-character string "null", which
    // `isValidSlug` would happily accept as a path segment.
    expect(withoutSection?.section).toBeNull();
  });

  test("a re-run inserts nothing, and says so", async () => {
    // `ON CONFLICT` against a PARTIAL unique index is only a valid conflict
    // target when the clause repeats the index predicate. Getting that wrong
    // raises `there is no unique or exclusion constraint matching` at runtime,
    // 12,000 rows into an import — which is exactly why this is tested against
    // a real index rather than asserted from the source.
    const first = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      importLegacyBlogPost(tx, TENANT, AUTHOR, SYSTEM, input())
    );
    const second = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      importLegacyBlogPost(
        tx,
        TENANT,
        AUTHOR,
        SYSTEM,
        input({ slug: "a-different-slug", title: "A different title" })
      )
    );

    expect(first.postId).not.toBeNull();
    // `null` is the signal the script reports as "already present" rather than
    // as an insert — preview -> commit -> fix -> commit again is the workflow.
    expect(second.postId).toBeNull();

    const count = (await getAdminSql()`
      SELECT count(*)::int AS count FROM awcms_blog_posts WHERE tenant_id = ${TENANT}
    `) as { count: number }[];
    expect(count[0]!.count).toBe(1);
  });

  test("the same legacy id in ANOTHER tenant is a different article", async () => {
    // The dedup index leads with `tenant_id`. Two newsrooms migrating from the
    // same platform will both have an article 48213, and one must not block the
    // other.
    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      importLegacyBlogPost(tx, TENANT, AUTHOR, SYSTEM, input())
    );
    const other = await withTenantOrThrow(getRuntimeSql(), OTHER_TENANT, (tx) =>
      importLegacyBlogPost(tx, OTHER_TENANT, AUTHOR, SYSTEM, input())
    );

    expect(other.postId).not.toBeNull();
  });

  test("findTakenSlugs sees existing slugs and ignores soft-deleted ones", async () => {
    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      importLegacyBlogPost(tx, TENANT, AUTHOR, SYSTEM, input())
    );
    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      importLegacyBlogPost(
        tx,
        TENANT,
        AUTHOR,
        SYSTEM,
        input({ legacyId: "9", slug: "sudah-dihapus" })
      )
    );
    await getAdminSql()`
      UPDATE awcms_blog_posts SET deleted_at = now() WHERE slug = 'sudah-dihapus'
    `;

    const taken = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      findTakenSlugs(tx, TENANT, [
        "banjir-melanda-kobar",
        "sudah-dihapus",
        "belum-dipakai"
      ])
    );

    expect(taken.has("banjir-melanda-kobar")).toBe(true);
    // A soft-deleted post does not hold its slug, so reporting it as taken
    // would refuse an import that would actually succeed.
    expect(taken.has("sudah-dihapus")).toBe(false);
    expect(taken.has("belum-dipakai")).toBe(false);
  });

  test("the redirect map lands in ONE hop, locale-prefixed", async () => {
    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      importLegacyBlogPost(tx, TENANT, AUTHOR, SYSTEM, input())
    );

    const map = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      listLegacyRedirectMappings(tx, TENANT, {
        system: SYSTEM,
        tenantCode: "lentera",
        pathTemplate: "/news/{legacyId}_{slug}.html"
      })
    );

    expect(map).toHaveLength(1);
    expect(map[0]!.sourcePath).toBe("/news/48213_banjir-melanda-kobar.html");
    // ADR-0098: the bare `/blog/lentera/...` would be answered by a SECOND
    // redirect onto this, which is the two-hop chain PRD §9.2 forbids and this
    // issue lists as its own acceptance criterion.
    expect(map[0]!.targetPath).toBe("/id/blog/lentera/banjir-melanda-kobar");
    expect(map[0]!.locale).toBe("id");
  });

  test("a draft and a soft-deleted post produce no rule", async () => {
    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      importLegacyBlogPost(
        tx,
        TENANT,
        AUTHOR,
        SYSTEM,
        input({
          legacyId: "1",
          slug: "masih-draf",
          status: "draft",
          publishedAt: null
        })
      )
    );
    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      importLegacyBlogPost(
        tx,
        TENANT,
        AUTHOR,
        SYSTEM,
        input({ legacyId: "2", slug: "sudah-dihapus" })
      )
    );
    await getAdminSql()`
      UPDATE awcms_blog_posts SET deleted_at = now() WHERE slug = 'sudah-dihapus'
    `;

    const map = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      listLegacyRedirectMappings(tx, TENANT, {
        system: SYSTEM,
        tenantCode: "lentera",
        pathTemplate: "/news/{legacyId}_{slug}.html"
      })
    );

    // A 301 to a draft is a 301 to a 404, which is worse than the 404 the URL
    // already had.
    expect(map).toHaveLength(0);
  });

  test("a post whose locale this deployment does not support keeps a bare target", async () => {
    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      importLegacyBlogPost(tx, TENANT, AUTHOR, SYSTEM, input({ locale: "jv" }))
    );

    const map = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      listLegacyRedirectMappings(tx, TENANT, {
        system: SYSTEM,
        tenantCode: "lentera",
        pathTemplate: "/news/{legacyId}_{slug}.html"
      })
    );

    // Inventing `/jv/...` would send a reader confidently into a language with
    // no routes. One hop to a path that then normalizes is the lesser failure,
    // and the redirect importer's own check reports it rather than writing it.
    expect(map[0]!.targetPath).toBe("/blog/lentera/banjir-melanda-kobar");
  });

  test("the map never crosses tenants", async () => {
    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      importLegacyBlogPost(tx, TENANT, AUTHOR, SYSTEM, input())
    );
    await withTenantOrThrow(getRuntimeSql(), OTHER_TENANT, (tx) =>
      importLegacyBlogPost(tx, OTHER_TENANT, AUTHOR, SYSTEM, input())
    );

    const map = await withTenantOrThrow(getRuntimeSql(), OTHER_TENANT, (tx) =>
      listLegacyRedirectMappings(tx, OTHER_TENANT, {
        system: SYSTEM,
        tenantCode: "seputar",
        pathTemplate: "/news/{legacyId}_{slug}.html"
      })
    );

    expect(map).toHaveLength(1);
    expect(map[0]!.targetPath).toBe("/id/blog/seputar/banjir-melanda-kobar");
  });
});

/**
 * The image handoff (Issue #599) — the half only a real database can answer.
 *
 * The pure half is in `tests/legacy-media-map.test.ts`. What matters here is
 * that "verified media of THIS tenant" is decided by the registry and not by
 * the map: an id that exists but belongs to somebody else, or exists and was
 * never verified, must fail the same way a made-up one does. The consequence of
 * getting that wrong is an article that imports cleanly and renders without its
 * photographs, because `renderGalleryBlockHtml` drops what it cannot resolve.
 */
suite("legacy image mapping (integration, Issue #599)", () => {
  const UPLOADER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const OTHER_UPLOADER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

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

  async function seedUploader(
    tenantId: string,
    userId: string,
    label: string
  ): Promise<void> {
    const admin = getAdminSql();
    const profile = (await admin`
      INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
      VALUES (${tenantId}, 'person', 'Uploader')
      RETURNING id
    `) as { id: string }[];
    const identity = (await admin`
      INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
      VALUES (${tenantId}, ${profile[0]!.id}, ${`${label}@example.test`}, 'x')
      RETURNING id
    `) as { id: string }[];
    await admin`
      INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
      VALUES (${userId}, ${tenantId}, ${identity[0]!.id})
    `;
  }

  /**
   * `module_key='news_portal'` and `storage_driver='cloudflare_r2'` are CHECK
   * constraints (`sql/041`), and `object_key` is CHECK-constrained to
   * `news-media/<tenant_id>/YYYY/MM/<uuid>.<ext>` against the row's OWN
   * tenant_id — so a fixture cannot take a shortcut here, and a cross-tenant
   * key is refused by the database rather than by application code.
   */
  async function seedMedia(
    tenantId: string,
    userId: string,
    status: string
  ): Promise<string> {
    const objectKey = `news-media/${tenantId}/2026/08/${crypto.randomUUID()}.png`;
    const rows = (await getAdminSql()`
      INSERT INTO awcms_news_media_objects
        (tenant_id, module_key, storage_driver, bucket_name, object_key,
         public_url, mime_type, status, created_by_tenant_user_id)
      VALUES (
        ${tenantId}, 'news_portal', 'cloudflare_r2', 'bucket', ${objectKey},
        'https://cdn.example.test/photo.png', 'image/png', ${status}, ${userId}
      )
      RETURNING id
    `) as { id: string }[];

    return rows[0]!.id;
  }

  test("a mapped image is stored as a gallery node the reader can resolve", async () => {
    await seedUploader(TENANT, UPLOADER, "lentera");
    const mediaId = await seedMedia(TENANT, UPLOADER, "verified");

    const converted = convertLegacyHtmlToPortableText(
      '<p>Air naik.</p><img src="http://legacy.example/banjir.jpg">',
      { resolveImage: (src) => (src.endsWith("banjir.jpg") ? mediaId : null) }
    );
    expect(converted.ok).toBe(true);

    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      importLegacyBlogPost(tx, TENANT, AUTHOR, SYSTEM, {
        ...input(),
        bodyPortableText: converted.document
      })
    );

    const rows = (await getAdminSql()`
      SELECT body_portable_text FROM awcms_blog_posts WHERE tenant_id = ${TENANT}
    `) as { body_portable_text: unknown }[];

    // An ARRAY, not the jsonb string Issue #641 was about — a gallery node that
    // came back as text would make `hasCanonicalPortableTextBody` false and the
    // article would render from the lossy projection, without the image.
    const stored = rows[0]!.body_portable_text as unknown[];
    expect(Array.isArray(stored)).toBe(true);
    expect(stored[1]).toEqual({
      _type: "gallery",
      _key: "n1",
      items: [{ mediaType: "image", mediaObjectId: mediaId }]
    });

    const safe = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      mediaLibraryPortAdapter.isMediaReferenceSafe(tx, TENANT, mediaId)
    );
    expect(safe).toBe(true);
  });

  test("the registry refuses another tenant's media, and unverified media", async () => {
    await seedUploader(TENANT, UPLOADER, "lentera");
    await seedUploader(OTHER_TENANT, OTHER_UPLOADER, "seputar");

    const foreign = await seedMedia(OTHER_TENANT, OTHER_UPLOADER, "verified");
    const unverified = await seedMedia(TENANT, UPLOADER, "uploaded");

    const verdicts = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT,
      async (tx) => ({
        // Exists, is verified, and belongs to somebody else. This is the check
        // the importer makes before writing anything, and the reason it is a
        // registry question rather than a "is it a uuid" question.
        foreign: await mediaLibraryPortAdapter.isMediaReferenceSafe(
          tx,
          TENANT,
          foreign
        ),
        // Exists, is ours, and stopped at `uploaded` — the bytes arrived and
        // nothing has vouched for them, which is exactly the state
        // `isMediaReferenceSafe` exists to distinguish from `verified`.
        unverified: await mediaLibraryPortAdapter.isMediaReferenceSafe(
          tx,
          TENANT,
          unverified
        ),
        invented: await mediaLibraryPortAdapter.isMediaReferenceSafe(
          tx,
          TENANT,
          "ffffffff-ffff-4fff-8fff-ffffffffffff"
        )
      })
    );

    expect(verdicts).toEqual({
      foreign: false,
      unverified: false,
      invented: false
    });
  });
});
