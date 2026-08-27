/**
 * Editing an article must not make it vanish from the site that serves it.
 *
 * ## What this is actually about
 *
 * `content_json` is the non-body ENVELOPE (ADR-0100 §4), and it survived the
 * Portable Text cutover for one reason: `ahliweb/awcms-astro` stores a sidecar
 * in it. ADR-0115 §2 then made that a written contract —
 * `content_json.awcmsAstro.kategori` carries the SECTION, and
 * `blog:legacy:import` populates it from `--section-map`.
 *
 * `updateBlogPost` used to have two branches for that column, and a **body-only**
 * PATCH took the projection branch with `input.contentJson === undefined`.
 * `withProjectedBlocks` spreads a non-object envelope to `{}`, so the row came
 * back holding `blocks` and nothing else. The sidecar was destroyed on save.
 *
 * The admin edit screen is exactly that caller: `admin/blog.astro` sets
 * `body.bodyPortableText` and has never set `body.contentJson`.
 *
 * ## Why the consequence is in the test names and the column is not
 *
 * Nothing fails when the sidecar goes. The article still renders perfectly in
 * THIS repo, because `/blog/{code}/{slug}` reads `body_portable_text`. What
 * breaks is one repository away: `getArticles` in `ahliweb/awcms-astro` keeps a
 * post only when the sidecar names a configured tab, so the article silently
 * stops being BUILT — green build, no page, no warning on either side.
 *
 * A test called "content_json keeps its keys" describes the mechanism and hides
 * the stake. These are named for what a reader loses.
 *
 * ## Why this needs a database
 *
 * The repair is a `jsonb_set` inside the `UPDATE`, chosen over reading the row
 * first precisely because a read-modify-write would race. There is no way to
 * prove a SQL `CASE` picks the right branch without executing it, and the
 * failing branch returned a perfectly valid row — which is why nothing caught
 * this for the life of the column.
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
import { updateBlogPost } from "../../src/modules/blog-content/application/blog-post-directory";
import { updateBlogPage } from "../../src/modules/blog-content/application/blog-page-directory";
import type { PortableTextDocument } from "../../src/modules/blog-content/domain/portable-text";

const TENANT = "f3333333-3333-4333-8333-333333333333";
const AUTHOR = "f3000000-0000-4000-8000-000000000001";

/**
 * The envelope as `blog:legacy:import` writes it: the derived projection PLUS
 * the consumer's sidecar, and one extra key nobody in this repo reads.
 *
 * The extra key is not padding. The repair must preserve every key it was never
 * told about, not a hard-coded allowlist containing `awcmsAstro` — an allowlist
 * would pass this file and lose the next consumer's data.
 */
const ENVELOPE_TERSIMPAN = {
  blocks: [{ type: "paragraph", text: "Badan lama" }],
  awcmsAstro: { schemaVersion: 1, kategori: "panduan", urutan: 3 },
  catatanKonsumenLain: { apaPun: true }
};

/** A new body, with a mark the old projection cannot carry — so `blocks` must visibly change. */
const BADAN_BARU: PortableTextDocument = [
  {
    _type: "block",
    _key: "n0",
    style: "normal",
    children: [
      { _type: "span", _key: "n0s0", text: "Badan ", marks: [] },
      { _type: "span", _key: "n0s1", text: "baru", marks: ["strong"] }
    ],
    markDefs: []
  }
];

async function seedFixtures(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT}, 'sidecar-tenant', 'Sidecar Tenant')
  `;

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT}, 'person', 'Author')
    RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${TENANT}, ${profile[0]!.id}, 'sidecar@example.test', 'x')
    RETURNING id
  `) as { id: string }[];
  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
    VALUES (${AUTHOR}, ${TENANT}, ${identity[0]!.id})
  `;
}

/** Inserts one post carrying the stored envelope and returns its id. */
async function postDenganSidecar(): Promise<string> {
  const rows = (await getAdminSql()`
    INSERT INTO awcms_blog_posts
      (tenant_id, author_tenant_user_id, title, slug, content_json, content_text,
       body_portable_text, status, visibility, locale)
    VALUES
      (${TENANT}, ${AUTHOR}, 'Artikel impor', 'artikel-impor',
       ${ENVELOPE_TERSIMPAN}::jsonb, 'Badan lama', '[]'::jsonb,
       'published', 'public', 'id')
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

/** Inserts one page carrying the stored envelope and returns its id. */
async function pageDenganSidecar(): Promise<string> {
  const rows = (await getAdminSql()`
    INSERT INTO awcms_blog_pages
      (tenant_id, author_tenant_user_id, title, slug, content_json, content_text,
       body_portable_text, status, visibility, locale)
    VALUES
      (${TENANT}, ${AUTHOR}, 'Halaman impor', 'halaman-impor',
       ${ENVELOPE_TERSIMPAN}::jsonb, 'Badan lama', '[]'::jsonb,
       'published', 'public', 'id')
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

const suite = integrationEnabled ? describe : describe.skip;

suite(
  "editing an article does not unpublish it from the consuming site",
  () => {
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

    test("a body-only edit keeps the section the consuming site builds the article from", async () => {
      const id = await postDenganSidecar();

      await withTenantOrThrow(getRuntimeSql(), TENANT, async (tx) => {
        // Exactly what `admin/blog.astro` sends: a body, and no envelope.
        const updated = await updateBlogPost(tx, TENANT, id, {
          bodyPortableText: BADAN_BARU
        });

        expect(updated).not.toBeNull();

        // The whole point. Before the repair this was `undefined`, and the
        // article stopped being built one repository away.
        expect(updated!.contentJson.awcmsAstro).toEqual(
          ENVELOPE_TERSIMPAN.awcmsAstro
        );
      });
    });

    test("a key this repo has never heard of survives too", async () => {
      const id = await postDenganSidecar();

      await withTenantOrThrow(getRuntimeSql(), TENANT, async (tx) => {
        const updated = await updateBlogPost(tx, TENANT, id, {
          bodyPortableText: BADAN_BARU
        });

        // Guards against the repair that would pass the test above and still be
        // wrong: an allowlist that preserves `awcmsAstro` by name. The envelope
        // belongs to its consumers, and this repo does not know their keys.
        expect(updated!.contentJson.catatanKonsumenLain).toEqual(
          ENVELOPE_TERSIMPAN.catatanKonsumenLain
        );
      });
    });

    test("the projection is still re-derived — preserving the envelope must not freeze the body", async () => {
      const id = await postDenganSidecar();

      await withTenantOrThrow(getRuntimeSql(), TENANT, async (tx) => {
        const updated = await updateBlogPost(tx, TENANT, id, {
          bodyPortableText: BADAN_BARU
        });

        // The green direction, and it is not decoration: "stop touching
        // content_json at all" would satisfy every assertion above while leaving
        // `blocks` describing an article nobody can read any more.
        const blocks = updated!.contentJson.blocks as { text?: string }[];
        expect(blocks).toHaveLength(1);
        // Marks flatten on the way across (ADR-0100 §4, lossy by construction).
        expect(blocks[0]!.text).toBe("Badan baru");
      });
    });

    test("a caller that DOES send an envelope still owns it", async () => {
      const id = await postDenganSidecar();

      await withTenantOrThrow(getRuntimeSql(), TENANT, async (tx) => {
        const updated = await updateBlogPost(tx, TENANT, id, {
          bodyPortableText: BADAN_BARU,
          contentJson: { awcmsAstro: { schemaVersion: 1, kategori: "berita" } }
        });

        // Unchanged contract: supplying the envelope replaces it. The repair adds
        // a branch for callers who send NO envelope; it does not quietly merge
        // for callers who send one, because that would make it impossible to
        // REMOVE a key.
        expect(updated!.contentJson.awcmsAstro).toEqual({
          schemaVersion: 1,
          kategori: "berita"
        });
        expect(updated!.contentJson.catatanKonsumenLain).toBeUndefined();
      });
    });

    test("an edit that does not touch the body leaves the envelope alone", async () => {
      const id = await postDenganSidecar();

      await withTenantOrThrow(getRuntimeSql(), TENANT, async (tx) => {
        const updated = await updateBlogPost(tx, TENANT, id, {
          title: "Judul baru"
        });

        expect(updated!.title).toBe("Judul baru");
        expect(updated!.contentJson).toEqual(ENVELOPE_TERSIMPAN);
      });
    });

    test("a page behaves identically — the twin does not keep its sibling's defect", async () => {
      const id = await pageDenganSidecar();

      await withTenantOrThrow(getRuntimeSql(), TENANT, async (tx) => {
        const updated = await updateBlogPage(tx, TENANT, id, {
          bodyPortableText: BADAN_BARU
        });

        // No consumer stores a sidecar on a page today, so this proves nothing a
        // reader currently depends on. It proves the two functions did not
        // diverge — which is how the defect would come back.
        expect(updated!.contentJson.awcmsAstro).toEqual(
          ENVELOPE_TERSIMPAN.awcmsAstro
        );
        expect(updated!.contentJson.catatanKonsumenLain).toEqual(
          ENVELOPE_TERSIMPAN.catatanKonsumenLain
        );
      });
    });
  }
);
