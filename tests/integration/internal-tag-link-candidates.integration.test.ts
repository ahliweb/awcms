/**
 * Which tags automatic internal linking can actually see (Issue #648), against
 * a real PostgreSQL.
 *
 * ## The defect this closes
 *
 * `resolveInternalTagLinkingContext` built its candidate list by calling the
 * ADMIN list — `ORDER BY name ASC`, bounded at a hundred. The local variable was
 * even called `allTags`. On any tenant with more than a hundred tags it was not
 * all tags: it was the alphabetically-first hundred, so **whether a tag was ever
 * linked was decided by its first letter**, and nothing anywhere said so. An
 * editor asking "why was `Sepak Bola` not linked?" got no answer — the tag
 * exists, it is enabled, it is spelled correctly, and it happens to start with S.
 *
 * ## Why the fix is not "remove the bound"
 *
 * The engine compiles ONE alternation regex from every candidate, so an
 * unbounded vocabulary means a very large regex on a public post render. What
 * was wrong was that the bound was inherited by accident, degraded
 * alphabetically, and was invisible. So the tests below are about the ORDER and
 * the REPORTING, not about the number.
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
import {
  countTags,
  listTagLinkCandidates
} from "../../src/modules/blog-content/application/blog-taxonomy-directory";
import {
  MAX_INTERNAL_TAG_LINK_CANDIDATES,
  resolveInternalTagLinkingContext
} from "../../src/modules/blog-content/application/internal-tag-link-rendering";

const TENANT = "f6666666-6666-4666-8666-666666666666";
const AUTHOR = "f6000000-0000-4000-8000-000000000001";

async function seedFixtures(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT}, 'tag-link-tenant', 'Tag Link Tenant')
  `;

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT}, 'person', 'Author')
    RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${TENANT}, ${profile[0]!.id}, 'taglink@example.test', 'x')
    RETURNING id
  `) as { id: string }[];
  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
    VALUES (${AUTHOR}, ${TENANT}, ${identity[0]!.id})
  `;
}

async function seedTag(name: string, slug: string): Promise<string> {
  const rows = (await getAdminSql()`
    INSERT INTO awcms_blog_terms (tenant_id, taxonomy_type, name, slug)
    VALUES (${TENANT}, 'tag', ${name}, ${slug})
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

async function seedPostWithTag(
  slug: string,
  termId: string,
  deleted = false
): Promise<void> {
  const admin = getAdminSql();
  const post = (await admin`
    INSERT INTO awcms_blog_posts
      (tenant_id, author_tenant_user_id, title, slug, content_json, content_text,
       status, visibility, locale, deleted_at)
    VALUES (${TENANT}, ${AUTHOR}, ${slug}, ${slug}, '{}'::jsonb, '',
            'published', 'public', 'id', ${deleted ? new Date() : null})
    RETURNING id
  `) as { id: string }[];

  await admin`
    INSERT INTO awcms_blog_post_terms (tenant_id, post_id, term_id)
    VALUES (${TENANT}, ${post[0]!.id}, ${termId})
  `;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("internal tag link candidates", () => {
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

  test("the MOST-USED tag comes first, not the alphabetically first", async () => {
    // The whole defect, in one assertion. "Alpha" wins on the alphabet and
    // "Zebra" wins on usage; before Issue #648 the alphabet decided.
    const alpha = await seedTag("Alpha", "alpha");
    const zebra = await seedTag("Zebra", "zebra");

    await seedPostWithTag("satu", zebra);
    await seedPostWithTag("dua", zebra);
    await seedPostWithTag("tiga", alpha);

    const runtime = getRuntimeSql();
    const kandidat = await withTenantOrThrow(runtime, TENANT, (tx) =>
      listTagLinkCandidates(tx, TENANT, 10)
    );

    expect(kandidat.map((row) => row.name)).toEqual(["Zebra", "Alpha"]);
    expect(kandidat[0]!.usageCount).toBe(2);
  });

  test("an unused tag is still a candidate — it is just last", async () => {
    // A tag nobody has applied yet can still occur in prose, so it must not be
    // dropped; it only loses the tiebreak.
    const dipakai = await seedTag("Dipakai", "dipakai");
    await seedTag("Belum", "belum");
    await seedPostWithTag("satu", dipakai);

    const runtime = getRuntimeSql();
    const kandidat = await withTenantOrThrow(runtime, TENANT, (tx) =>
      listTagLinkCandidates(tx, TENANT, 10)
    );

    expect(kandidat.map((row) => row.name)).toEqual(["Dipakai", "Belum"]);
    expect(kandidat[1]!.usageCount).toBe(0);
  });

  test("assignments to SOFT-DELETED posts do not count", async () => {
    // Otherwise a tag left on five hundred deleted articles outranks one in
    // daily use, and the ordering stops meaning what it says.
    const hantu = await seedTag("Hantu", "hantu");
    const hidup = await seedTag("Hidup", "hidup");

    await seedPostWithTag("mati-1", hantu, true);
    await seedPostWithTag("mati-2", hantu, true);
    await seedPostWithTag("hidup-1", hidup);

    const runtime = getRuntimeSql();
    const kandidat = await withTenantOrThrow(runtime, TENANT, (tx) =>
      listTagLinkCandidates(tx, TENANT, 10)
    );

    expect(kandidat.map((row) => row.name)).toEqual(["Hidup", "Hantu"]);
    expect(kandidat.find((row) => row.name === "Hantu")!.usageCount).toBe(0);
  });

  test("ties break on name, so the order is deterministic across builds", async () => {
    await seedTag("Beta", "beta");
    await seedTag("Alfa", "alfa");
    await seedTag("Gama", "gama");

    const runtime = getRuntimeSql();
    const kandidat = await withTenantOrThrow(runtime, TENANT, (tx) =>
      listTagLinkCandidates(tx, TENANT, 10)
    );

    expect(kandidat.map((row) => row.name)).toEqual(["Alfa", "Beta", "Gama"]);
  });

  test("only tags — a category is never a linking candidate", async () => {
    await getAdminSql()`
      INSERT INTO awcms_blog_terms (tenant_id, taxonomy_type, name, slug)
      VALUES (${TENANT}, 'category', 'Politik', 'politik'),
             (${TENANT}, 'channel', 'Olahraga', 'olahraga'),
             (${TENANT}, 'tag', 'APBD', 'apbd')
    `;

    const runtime = getRuntimeSql();
    const kandidat = await withTenantOrThrow(runtime, TENANT, (tx) =>
      listTagLinkCandidates(tx, TENANT, 10)
    );

    expect(kandidat.map((row) => row.name)).toEqual(["APBD"]);
  });

  test("soft-deleted tags are neither candidates nor counted", async () => {
    const hidup = await seedTag("Hidup", "hidup");
    await seedTag("Dibuang", "dibuang");

    await getAdminSql()`
      UPDATE awcms_blog_terms SET deleted_at = now()
      WHERE tenant_id = ${TENANT} AND slug = 'dibuang'
    `;

    const runtime = getRuntimeSql();
    const { kandidat, total } = await withTenantOrThrow(
      runtime,
      TENANT,
      async (tx) => ({
        kandidat: await listTagLinkCandidates(tx, TENANT, 10),
        total: await countTags(tx, TENANT)
      })
    );

    expect(kandidat.map((row) => row.id)).toEqual([hidup]);
    expect(total).toBe(1);
  });

  test("the context REPORTS whether the vocabulary was capped", async () => {
    // The one reason a tag goes unlinked that an editor cannot fix by editing.
    // Before this, it was indistinguishable from "the tag is not in the body".
    await seedTag("Satu", "satu");

    const runtime = getRuntimeSql();
    const context = await withTenantOrThrow(runtime, TENANT, (tx) =>
      resolveInternalTagLinkingContext(tx, TENANT, "/blog/x", false, {
        ...process.env,
        BLOG_AUTO_INTERNAL_TAG_LINKS_ENABLED: "true"
      })
    );

    expect(context.vocabulary).toEqual({
      total: 1,
      limit: MAX_INTERNAL_TAG_LINK_CANDIDATES,
      truncated: false
    });
  });

  test("a tag the tenant DISABLED is still counted in the vocabulary total", async () => {
    // `total` answers "how big is this vocabulary", not "how many made it into
    // the engine". Conflating them would report a truncated vocabulary for a
    // tenant that had merely switched some tags off.
    const dimatikan = await seedTag("Dimatikan", "dimatikan");
    await seedTag("Aktif", "aktif");

    await getAdminSql()`
      INSERT INTO awcms_blog_internal_tag_link_settings
        (tenant_id, enabled, case_insensitive, disabled_tag_ids)
      VALUES (${TENANT}, true, true, ${getAdminSql().array([dimatikan], "uuid")})
    `;

    const runtime = getRuntimeSql();
    const context = await withTenantOrThrow(runtime, TENANT, (tx) =>
      resolveInternalTagLinkingContext(tx, TENANT, "/blog/x", false, {
        ...process.env,
        BLOG_AUTO_INTERNAL_TAG_LINKS_ENABLED: "true"
      })
    );

    expect(context.vocabulary.total).toBe(2);
    expect(context.candidates.map((c) => c.name)).toEqual(["Aktif"]);
  });
});
