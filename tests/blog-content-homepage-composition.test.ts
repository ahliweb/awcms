/**
 * The composed homepage (Issue #594) — resolution, the deterministic fallback,
 * the caps, and the renderer.
 *
 * The composer is exercised against a FAKE tagged-template executor that
 * dispatches on the SQL text, not against a database. That is a deliberate
 * trade: it cannot prove the SQL is valid (the integration suite and
 * `db:fk-index:check` cover that), and it CAN prove the behaviour every
 * reviewer of this change actually worries about — that a curated slot pointing
 * at an unpublished article does not render a heading over nothing, that the
 * fallback never repeats an article a human curated, and that the query count on
 * an anonymous public page is bounded by a constant rather than by how many
 * sections somebody configured.
 *
 * Pure — no database, no network.
 */
import { describe, expect, test } from "bun:test";

import {
  MAX_CATEGORY_GROUPS,
  MAX_RENDERED_SECTIONS,
  composeHomepage
} from "../src/modules/blog-content/application/homepage-composition";
import {
  renderComposedHomepageHtml,
  renderHomepageSectionHtml
} from "../src/modules/blog-content/domain/homepage-section-rendering";
import type { MediaLibraryPort } from "../src/modules/_shared/ports/media-library-port";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-08-21T00:00:00.000Z");

type SectionSeed = {
  id: string;
  section_key: string;
  section_type: string;
  title: string | null;
  config_json: Record<string, unknown>;
};

type PostSeed = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  published_at: Date;
  featured_media_id: string | null;
};

function post(n: number, overrides: Partial<PostSeed> = {}): PostSeed {
  return {
    id: `p${n}`,
    title: `Post ${n}`,
    slug: `post-${n}`,
    excerpt: null,
    published_at: new Date("2026-08-01T00:00:00.000Z"),
    featured_media_id: null,
    ...overrides
  };
}

function section(seed: Partial<SectionSeed> & { section_type: string }) {
  return {
    id: seed.id ?? `s-${seed.section_type}`,
    tenant_id: TENANT,
    section_key: seed.section_key ?? seed.section_type,
    section_type: seed.section_type,
    title: seed.title ?? null,
    config_json: seed.config_json ?? {},
    sort_order: 0,
    is_enabled: true,
    starts_at: null,
    ends_at: null,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    deleted_by: null,
    delete_reason: null
  };
}

type World = {
  sections: ReturnType<typeof section>[];
  /** Every publicly-eligible post, newest first — the shape both post queries read. */
  posts: PostSeed[];
  terms: {
    id: string;
    taxonomy_type: string;
    name: string;
    slug: string;
    description: null;
  }[];
  /** term id -> ordered post ids */
  postsByTerm: Record<string, string[]>;
};

/** Records the SQL each call issued, so the query COUNT can be asserted directly. */
function fakeTx(world: World): { tx: Bun.SQL; queries: string[] } {
  const queries: string[] = [];

  const run = (strings: TemplateStringsArray, values: unknown[]): unknown[] => {
    const sql = strings.join(" ? ");
    queries.push(sql);

    if (sql.includes("awcms_news_portal_homepage_sections")) {
      return world.sections;
    }

    if (sql.includes("awcms_blog_terms")) {
      const wanted = values.find((value) => Array.isArray(value)) as
        string[] | undefined;

      return world.terms.filter((term) => (wanted ?? []).includes(term.slug));
    }

    if (sql.includes("awcms_blog_post_terms")) {
      // `listPublicBlogPostsByTermId` — the term id is the second bound value,
      // and the limit is `pageSize + 1`.
      const termId = values[1] as string;
      const limit = values[2] as number;
      const ids = world.postsByTerm[termId] ?? [];

      return world.posts
        .filter((entry) => ids.includes(entry.id))
        .slice(0, limit);
    }

    if (sql.includes("id = ANY")) {
      const wanted = values.find((value) => Array.isArray(value)) as
        string[] | undefined;

      return world.posts.filter((entry) => (wanted ?? []).includes(entry.id));
    }

    if (sql.includes("awcms_blog_posts")) {
      const limit = values[1] as number;
      return world.posts.slice(0, limit);
    }

    return [];
  };

  const tx = ((strings: TemplateStringsArray, ...values: unknown[]) =>
    Promise.resolve(run(strings, values))) as unknown as Bun.SQL;

  (tx as unknown as { array: (input: unknown[]) => unknown[] }).array = (
    input
  ) => input;

  return { tx, queries };
}

const emptyMediaPort: MediaLibraryPort = {
  isMediaReferenceSafe: async () => false,
  resolveMediaReferences: async () => new Map()
} as unknown as MediaLibraryPort;

function mediaPortWith(
  ids: readonly string[],
  altText: string | null = "alt"
): MediaLibraryPort {
  return {
    isMediaReferenceSafe: async () => true,
    resolveMediaReferences: async (
      _tx: unknown,
      _tenantId: string,
      requested: string[]
    ) =>
      new Map(
        requested
          .filter((id) => ids.includes(id))
          .map((id) => [
            id,
            {
              publicUrl: `https://cdn.example/${id}.jpg`,
              altText,
              mimeType: "image/jpeg",
              width: 800,
              height: 600
            }
          ])
      )
  } as unknown as MediaLibraryPort;
}

const EMPTY_WORLD: World = {
  sections: [],
  posts: [],
  terms: [],
  postsByTerm: {}
};

describe("a tenant that has composed nothing", () => {
  test("reports empty, so the caller keeps its chronological index", async () => {
    const { tx, queries } = fakeTx(EMPTY_WORLD);
    const composed = await composeHomepage(tx, TENANT, emptyMediaPort, NOW);

    expect(composed).toEqual({ sections: [], isEmpty: true });
    // And it costs exactly one query. A composer that kept going would make
    // every tenant pay for a feature none of them had switched on.
    expect(queries).toHaveLength(1);
  });
});

describe("curated slots", () => {
  test("preserve the editor's order and drop references that are gone", async () => {
    const { tx } = fakeTx({
      ...EMPTY_WORLD,
      sections: [
        section({
          section_type: "featured_posts",
          config_json: { postIds: ["p3", "p-gone", "p1"] }
        })
      ],
      posts: [post(1), post(3)]
    });

    const composed = await composeHomepage(tx, TENANT, emptyMediaPort, NOW);
    const slugs = composed.sections[0]!.groups[0]!.posts.map(
      (entry) => entry.slug
    );

    // Curation order, NOT `published_at DESC`, and the missing id simply absent.
    expect(slugs).toEqual(["post-3", "post-1"]);
    expect(composed.sections[0]!.fellBackToLatest).toBe(false);
  });

  test("fall back to the latest eligible articles when everything curated is gone", async () => {
    const { tx } = fakeTx({
      ...EMPTY_WORLD,
      sections: [
        section({
          section_type: "editor_picks",
          config_json: { postIds: ["p-gone", "p-also-gone"] }
        })
      ],
      posts: [post(9), post(8), post(7), post(6)]
    });

    const composed = await composeHomepage(tx, TENANT, emptyMediaPort, NOW);

    expect(composed.sections[0]!.fellBackToLatest).toBe(true);
    expect(
      composed.sections[0]!.groups[0]!.posts.map((entry) => entry.slug)
    ).toEqual(["post-9", "post-8", "post-7"]);
  });

  test("a headline falls back to exactly one article", async () => {
    const { tx } = fakeTx({
      ...EMPTY_WORLD,
      sections: [
        section({ section_type: "headline", config_json: { postId: "p-gone" } })
      ],
      posts: [post(9), post(8)]
    });

    const composed = await composeHomepage(tx, TENANT, emptyMediaPort, NOW);

    expect(composed.sections[0]!.groups[0]!.posts).toHaveLength(1);
    expect(composed.sections[0]!.groups[0]!.posts[0]!.slug).toBe("post-9");
  });

  test("a fallback never repeats an article a human curated above it", async () => {
    // The property that makes the fallback safe to ship: without it, the
    // editor's chosen headline would appear a second time three rows down,
    // which reads as a duplicate-content bug rather than as a fallback.
    const { tx } = fakeTx({
      ...EMPTY_WORLD,
      sections: [
        section({
          id: "s1",
          section_key: "hero",
          section_type: "headline",
          config_json: { postId: "p9" }
        }),
        section({
          id: "s2",
          section_key: "picks",
          section_type: "editor_picks",
          config_json: { postIds: ["p-gone"] }
        })
      ],
      posts: [post(9), post(8), post(7), post(6)]
    });

    const composed = await composeHomepage(tx, TENANT, emptyMediaPort, NOW);

    expect(composed.sections[0]!.groups[0]!.posts[0]!.slug).toBe("post-9");
    expect(
      composed.sections[1]!.groups[0]!.posts.map((entry) => entry.slug)
    ).toEqual(["post-8", "post-7", "post-6"]);
  });

  test("the same inputs produce the same output twice", async () => {
    const world: World = {
      ...EMPTY_WORLD,
      sections: [
        section({ section_type: "editor_picks", config_json: { postIds: [] } })
      ],
      posts: [post(9), post(8), post(7), post(6), post(5)]
    };

    const first = await composeHomepage(
      fakeTx(world).tx,
      TENANT,
      emptyMediaPort,
      NOW
    );
    const second = await composeHomepage(
      fakeTx(world).tx,
      TENANT,
      emptyMediaPort,
      NOW
    );

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe("live-content slots are not rescued by the fallback", () => {
  test("a `latest_posts` section pointing at a vanished category renders empty, not everything", async () => {
    // Widening to "all categories" would silently answer a different question
    // than the editor asked, and the page would look correct while being wrong.
    const { tx } = fakeTx({
      ...EMPTY_WORLD,
      sections: [
        section({
          section_type: "latest_posts",
          config_json: { limit: 3, categorySlug: "politik" }
        })
      ],
      posts: [post(9), post(8)]
    });

    const composed = await composeHomepage(tx, TENANT, emptyMediaPort, NOW);

    expect(composed.sections[0]!.groups[0]!.posts).toEqual([]);
    expect(composed.sections[0]!.fellBackToLatest).toBe(false);
  });
});

describe("the query count is bounded by constants, not by configuration", () => {
  test("more sections than the cap are rendered up to it", async () => {
    const many = Array.from({ length: MAX_RENDERED_SECTIONS + 4 }, (_, index) =>
      section({
        id: `s${index}`,
        section_key: `k${index}`,
        section_type: "featured_posts",
        config_json: { postIds: ["p1"] }
      })
    );

    const { tx } = fakeTx({ ...EMPTY_WORLD, sections: many, posts: [post(1)] });
    const composed = await composeHomepage(tx, TENANT, emptyMediaPort, NOW);

    expect(composed.sections).toHaveLength(MAX_RENDERED_SECTIONS);
  });

  test("category groups are capped across the whole page, and every grid query is one query", async () => {
    const slugs = Array.from({ length: 8 }, (_, index) => `c${index}`);
    const terms = slugs.map((slug, index) => ({
      id: `t${index}`,
      taxonomy_type: "category",
      name: `Category ${index}`,
      slug,
      description: null
    }));

    const { tx, queries } = fakeTx({
      sections: [
        section({
          id: "g1",
          section_key: "grid-1",
          section_type: "category_grid",
          config_json: { categorySlugs: slugs, postsPerCategory: 2 }
        }),
        section({
          id: "g2",
          section_key: "grid-2",
          section_type: "category_grid",
          config_json: { categorySlugs: slugs, postsPerCategory: 2 }
        })
      ],
      posts: [post(1), post(2)],
      terms,
      postsByTerm: Object.fromEntries(terms.map((term) => [term.id, ["p1"]]))
    });

    const composed = await composeHomepage(tx, TENANT, emptyMediaPort, NOW);
    const drawn = composed.sections.reduce(
      (total, entry) => total + entry.groups.length,
      0
    );

    expect(drawn).toBe(MAX_CATEGORY_GROUPS);

    // Sixteen configured groups, twelve drawn, and the slug lookup was ONE
    // query rather than sixteen. That difference is the whole point of the bulk
    // passes.
    const termQueries = queries.filter((sql) =>
      sql.includes("awcms_blog_terms")
    );
    expect(termQueries).toHaveLength(1);
    expect(queries.length).toBeLessThanOrEqual(MAX_CATEGORY_GROUPS + 6);
  });
});

describe("images", () => {
  test("an id that does not resolve renders no image rather than a broken one", async () => {
    const { tx } = fakeTx({
      ...EMPTY_WORLD,
      sections: [
        section({
          section_type: "gallery_block",
          config_json: { mediaObjectIds: ["m1", "m-gone"], caption: "Kalteng" }
        })
      ]
    });

    const composed = await composeHomepage(
      tx,
      TENANT,
      mediaPortWith(["m1"]),
      NOW
    );

    expect(composed.sections[0]!.images).toHaveLength(1);
    expect(composed.sections[0]!.images[0]!.url).toBe(
      "https://cdn.example/m1.jpg"
    );
    expect(composed.sections[0]!.caption).toBe("Kalteng");
  });

  test("every image on the page is resolved in ONE port call", async () => {
    let calls = 0;
    const port = {
      isMediaReferenceSafe: async () => true,
      resolveMediaReferences: async () => {
        calls += 1;
        return new Map();
      }
    } as unknown as MediaLibraryPort;

    const { tx } = fakeTx({
      ...EMPTY_WORLD,
      sections: [
        section({
          id: "a",
          section_key: "a",
          section_type: "gallery_block",
          config_json: { mediaObjectIds: ["m1"] }
        }),
        section({
          id: "b",
          section_key: "b",
          section_type: "gallery_block",
          config_json: { mediaObjectIds: ["m2"] }
        })
      ]
    });

    await composeHomepage(tx, TENANT, port, NOW);

    expect(calls).toBe(1);
  });
});

describe("renderComposedHomepageHtml", () => {
  const base = "/id/blog/acme";

  test("escapes every text value it is handed", () => {
    const html = renderHomepageSectionHtml(base, {
      sectionKey: 'k"><script>',
      sectionType: "featured_posts",
      title: "<script>alert(1)</script>",
      groups: [
        {
          heading: null,
          slug: null,
          posts: [
            {
              title: "<b>bold</b>",
              slug: 'a"b',
              excerpt: "<i>x</i>",
              publishedAt: NOW,
              image: null
            }
          ]
        }
      ],
      images: [],
      caption: null,
      fellBackToLatest: false
    });

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(html).toContain("&quot;");
  });

  test("a section with nothing in it is dropped, heading included", () => {
    const html = renderHomepageSectionHtml(base, {
      sectionKey: "empty",
      sectionType: "latest_posts",
      title: "Terbaru",
      groups: [{ heading: null, slug: null, posts: [] }],
      images: [],
      caption: null,
      fellBackToLatest: false
    });

    expect(html).toBe("");
  });

  test("a gallery with no resolvable image is dropped, caption included", () => {
    const html = renderHomepageSectionHtml(base, {
      sectionKey: "gal",
      sectionType: "gallery_block",
      title: "Galeri",
      groups: [],
      images: [],
      caption: "A caption with no pictures",
      fellBackToLatest: false
    });

    expect(html).toBe("");
    expect(html).not.toContain("A caption with no pictures");
  });

  test("links are built from the locale-prefixed base path", () => {
    const html = renderHomepageSectionHtml(base, {
      sectionKey: "grid",
      sectionType: "category_grid",
      title: null,
      groups: [
        {
          heading: "Politik",
          slug: "politik",
          posts: [
            {
              title: "Satu",
              slug: "satu",
              excerpt: null,
              publishedAt: NOW,
              image: null
            }
          ]
        }
      ],
      images: [],
      caption: null,
      fellBackToLatest: false
    });

    // ADR-0098 — an in-page link that dropped the prefix would send the reader
    // through a redirect to the other language.
    expect(html).toContain('href="/id/blog/acme/category/politik"');
    expect(html).toContain('href="/id/blog/acme/satu"');
    // A grid names its columns, so its cards sit a heading level below them.
    expect(html).toContain('<h3><a href="/id/blog/acme/category/politik"');
    expect(html).toContain('<h3><a href="/id/blog/acme/satu"');
  });

  test("the whole page is the empty string when every section drops out", () => {
    expect(
      renderComposedHomepageHtml(base, {
        isEmpty: false,
        sections: [
          {
            sectionKey: "a",
            sectionType: "headline",
            title: "Utama",
            groups: [{ heading: null, slug: null, posts: [] }],
            images: [],
            caption: null,
            fellBackToLatest: false
          }
        ]
      })
    ).toBe("");
  });
});
