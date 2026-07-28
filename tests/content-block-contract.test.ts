import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  CONTENT_BLOCK_TYPES,
  renderContentJsonToHtml
} from "../src/modules/blog-content/domain/content-block-rendering";

/**
 * `content_json`'s block vocabulary is stated in THREE places that have to
 * agree, and until now only one of them was checked against anything:
 *
 *   1. `ContentBlock` — the TypeScript union. Enforced by `tsc`, but a type is
 *      invisible to everything outside it.
 *   2. `renderContentJsonToHtml`'s switch — what this repo actually renders.
 *   3. `BlogContentBlock` in the OpenAPI contract — what every OTHER consumer
 *      reads, including front-ends in separate repositories.
 *
 * (1) and the runtime constant are already welded together by a mutual
 * assignability assertion in `content-block-rendering.ts`, so `bun run
 * typecheck` fails if either drifts. This file welds (2) and (3) to the same
 * constant.
 *
 * The reason is concrete rather than theoretical. `awcms-astro` re-derived this
 * vocabulary by reading prose and got it wrong three ways at once: it invented
 * an `ordered_list` type that does not exist, and dropped `gallery` and
 * `video_news` because they carry no `text` field and its fallback rendered
 * `text`. Nothing failed anywhere. Numbered lists came out bulleted and media
 * sections vanished from live pages.
 *
 * A vocabulary that only exists in prose gets re-derived, and re-derivation is
 * where it breaks.
 */
const FRAGMENT_PATH = "openapi/modules/blog-content.openapi.yaml";
const FRAGMENT = readFileSync(FRAGMENT_PATH, "utf8");
const RENDERER = readFileSync(
  "src/modules/blog-content/domain/content-block-rendering.ts",
  "utf8"
);

describe("content_json block vocabulary", () => {
  test("the OpenAPI contract publishes exactly the declared block types", () => {
    // Every `enum: [<type>]` inside the BlogContentBlock oneOf. Parsed from the
    // fragment text rather than from a YAML object graph so this test keeps
    // working regardless of how the bundler reshapes things downstream.
    const schemaStart = FRAGMENT.indexOf("    BlogContentBlock:");
    const schemaEnd = FRAGMENT.indexOf("    BlogContentJson:");

    expect(schemaStart).toBeGreaterThan(-1);
    expect(schemaEnd).toBeGreaterThan(schemaStart);

    const schema = FRAGMENT.slice(schemaStart, schemaEnd);
    const published = [...schema.matchAll(/enum: \[([a-z_]+)\]/g)]
      .map((match) => match[1]!)
      .sort();

    expect(published).toEqual([...CONTENT_BLOCK_TYPES].sort());
  });

  test("every contentJson field in the contract points at the schema", () => {
    // The vocabulary used to appear in ONE prose `description` on one of five
    // `contentJson` occurrences; the other four said only `type: object`. A
    // consumer reading the contract had a four-in-five chance of learning
    // nothing at all about what the field contains.
    const bareObjectFields = FRAGMENT.match(/contentJson:\n\s+type: object/g);

    expect(bareObjectFields).toBeNull();

    const references = FRAGMENT.match(
      /contentJson:\n\s+\$ref: "#\/components\/schemas\/BlogContentJson"/g
    );

    expect(references).not.toBeNull();
    expect(references!.length).toBeGreaterThanOrEqual(5);
  });

  test("the renderer handles exactly the declared block types", () => {
    // A type in the vocabulary with no `case` renders as nothing — which is the
    // exact shape of the bug this whole file exists because of, just on the
    // other side of the wire.
    const handled = [...RENDERER.matchAll(/^\s+case "([a-z_]+)":/gm)]
      .map((match) => match[1]!)
      .sort();

    expect(handled).toEqual([...CONTENT_BLOCK_TYPES].sort());
  });

  test("every declared block type renders something non-empty", () => {
    // The stronger form of the assertion above: not "there is a case" but "the
    // case produces output". `gallery` and `video_news` are the two that carry
    // no `text`, and they are exactly the two a text-shaped fallback loses.
    const samples: Record<string, Record<string, unknown>> = {
      paragraph: { type: "paragraph", text: "Halo" },
      heading: { type: "heading", level: 2, text: "Judul" },
      list: { type: "list", items: ["satu"] },
      quote: { type: "quote", text: "Kutipan" },
      gallery: {
        type: "gallery",
        items: [{ mediaType: "image", url: "https://media.test/a.jpg" }]
      },
      video_news: {
        type: "video_news",
        provider: "youtube",
        videoId: "dQw4w9WgXcQ"
      }
    };

    for (const type of CONTENT_BLOCK_TYPES) {
      expect(samples[type]).toBeDefined();

      const html = renderContentJsonToHtml({ blocks: [samples[type]!] });

      expect(html.length).toBeGreaterThan(0);
    }
  });

  test("ordering is a field on list, not a separate block type", () => {
    // The single most re-derivable mistake in this vocabulary, and the one a
    // consumer already made. Pinned from both sides: `ordered` changes the tag,
    // and `ordered_list` is not a type.
    expect(
      renderContentJsonToHtml({
        blocks: [{ type: "list", ordered: true, items: ["a"] }]
      })
    ).toContain("<ol>");

    expect(
      renderContentJsonToHtml({
        blocks: [{ type: "list", items: ["a"] }]
      })
    ).toContain("<ul>");

    expect(CONTENT_BLOCK_TYPES).not.toContain(
      "ordered_list" as (typeof CONTENT_BLOCK_TYPES)[number]
    );

    expect(
      renderContentJsonToHtml({
        blocks: [{ type: "ordered_list", items: ["a"] }]
      })
    ).toBe("");
  });

  test("there is no raw-HTML block variant in the contract", () => {
    // The guarantee the whole structured-content arrangement rests on. A
    // variant named html/raw/embed would let an editor ship markup through a
    // path no reviewer of this repo ever sees.
    for (const forbidden of ["html", "raw", "embed", "script", "iframe"]) {
      expect(CONTENT_BLOCK_TYPES).not.toContain(
        forbidden as (typeof CONTENT_BLOCK_TYPES)[number]
      );
    }
  });
});
