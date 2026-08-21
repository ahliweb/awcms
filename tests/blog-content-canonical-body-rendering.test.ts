/**
 * Which stored body a reader actually sees (Issue #624).
 *
 * ## The defect
 *
 * ADR-0100 made Portable Text canonical and #605/#606 gave editors marks — bold,
 * italic, code, inline links. `renderPortableTextToHtml` rendered every one of
 * them correctly and had ZERO production callers. The public post route rendered
 * `content_json.blocks`, the projection its own converter calls lossy by
 * construction, so a bolded phrase reached the reader plain with no error, no log
 * and no red gate.
 *
 * ## What is pinned here
 *
 * 1. **The fallback is a fallback.** Canonical when non-empty, projection when
 *    empty. Unconditional either way is a bug: reading the canonical column on a
 *    deployment that has not run `bun run blog:portable-text:backfill` blanks
 *    every article, and reading the projection is the defect itself.
 * 2. **Media survives the switch.** Ids are collected from both stored shapes and
 *    ordered by the one that renders, because "first image in the content" feeds
 *    the social-preview fallback.
 * 3. **The canonical renderer cannot lose its callers again.** This repo has
 *    recorded this defect class before ("the writer moved, its readers did not"):
 *    a renderer with no callers is invisible to every gate that checks shape
 *    rather than reach. So the two low-level renderers are reachable from exactly
 *    one production module, and that module is called by the routes that serve
 *    readers.
 *
 * Pure — no database, no network.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { stripComments } from "../scripts/access-chokepoint-check";
import {
  collectBlogBodyMediaObjectIds,
  hasCanonicalPortableTextBody,
  renderBlogBodyHtml
} from "../src/modules/blog-content/domain/blog-body-rendering";

const MEDIA_A = "11111111-1111-4111-8111-111111111111";
const MEDIA_B = "22222222-2222-4222-8222-222222222222";
const MEDIA_C = "33333333-3333-4333-8333-333333333333";

/** A body with a mark — the exact thing the projection flattens. */
const CANONICAL_WITH_MARK = [
  {
    _type: "block",
    _key: "a",
    style: "normal",
    markDefs: [{ _key: "l1", _type: "link", href: "https://example.org/x" }],
    children: [
      { _type: "span", _key: "s1", text: "Menteri ", marks: [] },
      { _type: "span", _key: "s2", text: "menegaskan", marks: ["strong"] },
      { _type: "span", _key: "s3", text: " ", marks: [] },
      { _type: "span", _key: "s4", text: "hal itu", marks: ["l1"] }
    ]
  }
];

/** The projection of the body above, as `portableTextToContentBlocks` produces it. */
const FLATTENED_PROJECTION = {
  blocks: [{ type: "paragraph", text: "Menteri menegaskan hal itu" }]
};

describe("renderBlogBodyHtml picks the body a reader should see", () => {
  test("renders the canonical body, marks included, when it holds content", () => {
    const html = renderBlogBodyHtml({
      bodyPortableText: CANONICAL_WITH_MARK,
      contentJson: FLATTENED_PROJECTION
    });

    // The whole point of the issue: this is what an editor typed.
    expect(html).toContain("<strong>menegaskan</strong>");
    expect(html).toContain(
      '<a href="https://example.org/x" rel="noopener noreferrer">hal itu</a>'
    );
  });

  test("falls back to the projection when the canonical column is still `[]`", () => {
    // `sql/134`'s DEFAULT, on a deployment that has not run the backfill. If this
    // ever renders "" instead, every pre-backfill article on that deployment is
    // a blank page — and blank is indistinguishable from "nothing was written".
    const html = renderBlogBodyHtml({
      bodyPortableText: [],
      contentJson: FLATTENED_PROJECTION
    });

    expect(html).toBe("<p>Menteri menegaskan hal itu</p>");
  });

  test("falls back when the column was not selected at all", () => {
    const html = renderBlogBodyHtml({
      bodyPortableText: undefined,
      contentJson: FLATTENED_PROJECTION
    });

    expect(html).toBe("<p>Menteri menegaskan hal itu</p>");
  });

  test("a genuinely empty body renders empty, from either shape", () => {
    expect(
      renderBlogBodyHtml({ bodyPortableText: [], contentJson: { blocks: [] } })
    ).toBe("");
    expect(renderBlogBodyHtml({ bodyPortableText: [], contentJson: {} })).toBe(
      ""
    );
  });

  test("a corrupt canonical body degrades rather than throwing", () => {
    expect(() =>
      renderBlogBodyHtml({
        bodyPortableText: [null, 42, { _type: "unknown" }],
        contentJson: FLATTENED_PROJECTION
      })
    ).not.toThrow();
  });

  test("resolved media urls reach whichever renderer runs", () => {
    const gallery = {
      _type: "gallery",
      _key: "g",
      items: [{ mediaType: "image", mediaObjectId: MEDIA_A }]
    };

    const html = renderBlogBodyHtml(
      { bodyPortableText: [gallery], contentJson: {} },
      new Map([[MEDIA_A, "https://cdn.example.org/a.jpg"]])
    );

    expect(html).toContain("https://cdn.example.org/a.jpg");
  });

  test("hasCanonicalPortableTextBody is the single predicate", () => {
    expect(
      hasCanonicalPortableTextBody({
        bodyPortableText: CANONICAL_WITH_MARK,
        contentJson: {}
      })
    ).toBe(true);
    expect(
      hasCanonicalPortableTextBody({ bodyPortableText: [], contentJson: {} })
    ).toBe(false);
    expect(
      hasCanonicalPortableTextBody({ bodyPortableText: null, contentJson: {} })
    ).toBe(false);
  });
});

describe("media references are collected from both stored shapes", () => {
  test("an image present only in the canonical body is still resolved", () => {
    const refs = collectBlogBodyMediaObjectIds({
      bodyPortableText: [
        {
          _type: "gallery",
          _key: "g",
          items: [{ mediaType: "image", mediaObjectId: MEDIA_A }]
        }
      ],
      contentJson: { blocks: [] }
    });

    expect(refs.galleryImageMediaObjectIds).toEqual([MEDIA_A]);
  });

  test("an image present only in the projection is still resolved", () => {
    const refs = collectBlogBodyMediaObjectIds({
      bodyPortableText: [],
      contentJson: {
        blocks: [
          {
            type: "gallery",
            items: [{ mediaType: "image", mediaObjectId: MEDIA_B }]
          }
        ]
      }
    });

    expect(refs.galleryImageMediaObjectIds).toEqual([MEDIA_B]);
  });

  test("ids are deduplicated and ordered by the body that renders", () => {
    // The social-preview fallback takes the FIRST content image. When the
    // canonical body renders, "first" must mean first as the reader sees it.
    const refs = collectBlogBodyMediaObjectIds({
      bodyPortableText: [
        {
          _type: "gallery",
          _key: "g",
          items: [
            { mediaType: "image", mediaObjectId: MEDIA_C },
            { mediaType: "image", mediaObjectId: MEDIA_A }
          ]
        }
      ],
      contentJson: {
        blocks: [
          {
            type: "gallery",
            items: [
              { mediaType: "image", mediaObjectId: MEDIA_A },
              { mediaType: "image", mediaObjectId: MEDIA_B }
            ]
          }
        ]
      }
    });

    expect(refs.galleryImageMediaObjectIds).toEqual([
      MEDIA_C,
      MEDIA_A,
      MEDIA_B
    ]);
  });

  test("video thumbnails are collected from both node spellings", () => {
    const refs = collectBlogBodyMediaObjectIds({
      bodyPortableText: [
        {
          _type: "videoNews",
          _key: "v",
          provider: "youtube",
          thumbnailMediaObjectId: MEDIA_A
        }
      ],
      contentJson: {
        blocks: [{ type: "video_news", thumbnailMediaObjectId: MEDIA_B }]
      }
    });

    expect(refs.videoThumbnailMediaObjectIds).toEqual([MEDIA_A, MEDIA_B]);
  });
});

const BODY_RENDERING_MODULE =
  "src/modules/blog-content/domain/blog-body-rendering.ts";

/**
 * The files allowed to name the two low-level renderers: their own definitions,
 * and the one module that decides between them.
 */
const RENDERER_OWNERS: readonly string[] = [
  "src/modules/blog-content/domain/content-block-rendering.ts",
  "src/modules/blog-content/domain/portable-text-rendering.ts",
  BODY_RENDERING_MODULE
];

async function productionSources(): Promise<string[]> {
  const files: string[] = [];

  for (const pattern of ["**/*.ts", "**/*.astro"]) {
    for await (const file of new Bun.Glob(pattern).scan({ cwd: "src" })) {
      files.push(`src/${file}`);
    }
  }

  return files.sort();
}

describe("the canonical renderer cannot lose its callers again", () => {
  test("no production file picks a body renderer for itself", async () => {
    const offenders: string[] = [];

    for (const file of await productionSources()) {
      if (RENDERER_OWNERS.includes(file)) {
        continue;
      }

      // Comments stripped first: several files legitimately EXPLAIN these
      // functions, and a docblock must not be able to satisfy — or violate — a
      // reachability assertion.
      const source = stripComments(await readFile(file, "utf8"));

      if (
        source.includes("renderContentJsonToHtml") ||
        source.includes("renderPortableTextToHtml")
      ) {
        offenders.push(file);
      }
    }

    // A route that reaches past `renderBlogBodyHtml` picks one stored body
    // unconditionally, which is either "marks never reach a reader" (Issue #624)
    // or "every pre-backfill article is blank". Route through the decision.
    expect(offenders).toEqual([]);
  });

  test("both renderers are actually reachable from the deciding module", async () => {
    const source = stripComments(await readFile(BODY_RENDERING_MODULE, "utf8"));

    expect(source).toContain("renderPortableTextToHtml(");
    expect(source).toContain("renderContentJsonToHtml(");
  });

  test("and that module is called by the surfaces that serve readers", async () => {
    const readerSurfaces = [
      "src/pages/blog/[tenantCode]/[slug].ts",
      "src/pages/blog/[tenantCode]/pages/[slug].ts"
    ];

    for (const file of readerSurfaces) {
      const source = stripComments(await readFile(file, "utf8"));

      expect(source).toContain("renderBlogBodyHtml(");
    }
  });

  test("the public post query selects the canonical column", async () => {
    const source = stripComments(
      await readFile(
        "src/modules/blog-content/application/public-blog-directory.ts",
        "utf8"
      )
    );

    // Without this the fallback is unconditional and silently correct-looking:
    // an unselected column is `undefined`, which is not an array, which renders
    // the projection forever.
    expect(source).toContain("FROM awcms_blog_posts");
    expect(source).toContain("seo_image_media_id, body_portable_text");
    expect(source).toContain("bodyPortableText: row.body_portable_text");
  });
});
