import { describe, expect, test } from "bun:test";

import {
  isVideoNewsProvider,
  normalizeYouTubeVideoId,
  validateAndNormalizeContentJsonVideoBlocks,
  VIDEO_NEWS_PROVIDERS
} from "../src/modules/blog-content/domain/video-news-block-validation";

const VALID_ID = "11111111-1111-1111-1111-111111111111";
const VIDEO_ID = "dQw4w9WgXcQ";

describe("VIDEO_NEWS_PROVIDERS / isVideoNewsProvider (Issue #639)", () => {
  test("only youtube is allowlisted today", () => {
    expect(VIDEO_NEWS_PROVIDERS).toEqual(["youtube"]);
  });

  test("accepts youtube, rejects anything else", () => {
    expect(isVideoNewsProvider("youtube")).toBe(true);
    expect(isVideoNewsProvider("vimeo")).toBe(false);
    expect(isVideoNewsProvider('vimeo" src="javascript:alert(1)')).toBe(false);
    expect(isVideoNewsProvider(123)).toBe(false);
    expect(isVideoNewsProvider(undefined)).toBe(false);
    expect(isVideoNewsProvider(null)).toBe(false);
  });
});

describe("normalizeYouTubeVideoId (Issue #639)", () => {
  test("accepts a bare 11-character video id", () => {
    expect(normalizeYouTubeVideoId(VIDEO_ID)).toBe(VIDEO_ID);
  });

  test("normalizes a watch?v= URL", () => {
    expect(
      normalizeYouTubeVideoId(`https://www.youtube.com/watch?v=${VIDEO_ID}`)
    ).toBe(VIDEO_ID);
    expect(
      normalizeYouTubeVideoId(`https://youtube.com/watch?v=${VIDEO_ID}&t=30s`)
    ).toBe(VIDEO_ID);
  });

  test("normalizes a youtu.be short URL", () => {
    expect(normalizeYouTubeVideoId(`https://youtu.be/${VIDEO_ID}`)).toBe(
      VIDEO_ID
    );
  });

  test("normalizes /embed/ and /shorts/ URLs", () => {
    expect(
      normalizeYouTubeVideoId(`https://www.youtube.com/embed/${VIDEO_ID}`)
    ).toBe(VIDEO_ID);
    expect(
      normalizeYouTubeVideoId(`https://www.youtube.com/shorts/${VIDEO_ID}`)
    ).toBe(VIDEO_ID);
    expect(
      normalizeYouTubeVideoId(
        `https://www.youtube-nocookie.com/embed/${VIDEO_ID}`
      )
    ).toBe(VIDEO_ID);
  });

  test("rejects a non-YouTube host", () => {
    expect(normalizeYouTubeVideoId(`https://vimeo.com/${VIDEO_ID}`)).toBeNull();
  });

  test("rejects malformed input (not a string, not a URL, wrong-length id)", () => {
    expect(normalizeYouTubeVideoId(123)).toBeNull();
    expect(normalizeYouTubeVideoId(undefined)).toBeNull();
    expect(normalizeYouTubeVideoId("not a url or id")).toBeNull();
    expect(normalizeYouTubeVideoId("short")).toBeNull();
    expect(
      normalizeYouTubeVideoId("https://www.youtube.com/watch?v=too-short")
    ).toBeNull();
  });

  test("rejects a raw iframe/script string masquerading as a videoId", () => {
    expect(
      normalizeYouTubeVideoId(
        `<iframe src="https://evil.example.com"></iframe>`
      )
    ).toBeNull();
    expect(
      normalizeYouTubeVideoId(`javascript:alert(document.cookie)`)
    ).toBeNull();
  });
});

describe("validateAndNormalizeContentJsonVideoBlocks (Issue #639)", () => {
  test("passes through contentJson unchanged when there is no video_news block", () => {
    const contentJson = { blocks: [{ type: "paragraph", text: "hi" }] };
    const result = validateAndNormalizeContentJsonVideoBlocks(contentJson);
    expect(result).toEqual({ valid: true, value: contentJson });
  });

  test("tolerates missing/non-array blocks", () => {
    expect(validateAndNormalizeContentJsonVideoBlocks({})).toEqual({
      valid: true,
      value: {}
    });
  });

  test("accepts a minimal valid video_news block and normalizes videoId from a URL", () => {
    const result = validateAndNormalizeContentJsonVideoBlocks({
      blocks: [
        {
          type: "video_news",
          provider: "youtube",
          videoId: `https://www.youtube.com/watch?v=${VIDEO_ID}`
        }
      ]
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.blocks).toEqual([
        { type: "video_news", provider: "youtube", videoId: VIDEO_ID }
      ]);
    }
  });

  test("accepts and preserves optional fields, dropping unrecognized ones", () => {
    const result = validateAndNormalizeContentJsonVideoBlocks({
      blocks: [
        {
          type: "video_news",
          provider: "youtube",
          videoId: VIDEO_ID,
          title: "Breaking news",
          caption: "A caption",
          thumbnailMediaObjectId: VALID_ID,
          durationSeconds: 125,
          sourceLabel: "Reuters",
          rawEmbedHtml: '<iframe src="https://evil.example.com"></iframe>',
          embedHtml: "<script>alert(1)</script>"
        }
      ]
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.blocks).toEqual([
        {
          type: "video_news",
          provider: "youtube",
          videoId: VIDEO_ID,
          title: "Breaking news",
          caption: "A caption",
          thumbnailMediaObjectId: VALID_ID,
          durationSeconds: 125,
          sourceLabel: "Reuters"
        }
      ]);
    }
  });

  test("rejects an unsupported/unlisted provider", () => {
    const result = validateAndNormalizeContentJsonVideoBlocks({
      blocks: [{ type: "video_news", provider: "vimeo", videoId: VIDEO_ID }]
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toEqual([
        {
          field: "contentJson.blocks[0].provider",
          message: "provider must be one of: youtube."
        }
      ]);
    }
  });

  test("rejects an invalid/malformed videoId", () => {
    const result = validateAndNormalizeContentJsonVideoBlocks({
      blocks: [
        { type: "video_news", provider: "youtube", videoId: "not-a-video-id" }
      ]
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toEqual([
        {
          field: "contentJson.blocks[0].videoId",
          message: "videoId must be a valid YouTube video id or video URL."
        }
      ]);
    }
  });

  test("rejects a raw iframe string passed as videoId", () => {
    const result = validateAndNormalizeContentJsonVideoBlocks({
      blocks: [
        {
          type: "video_news",
          provider: "youtube",
          videoId: `<iframe src="https://evil.example.com"></iframe>`
        }
      ]
    });

    expect(result.valid).toBe(false);
  });

  test("rejects an oversized title/caption/sourceLabel", () => {
    const result = validateAndNormalizeContentJsonVideoBlocks({
      blocks: [
        {
          type: "video_news",
          provider: "youtube",
          videoId: VIDEO_ID,
          title: "x".repeat(201),
          caption: "y".repeat(501),
          sourceLabel: "z".repeat(121)
        }
      ]
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map((e) => e.field)).toEqual([
        "contentJson.blocks[0].title",
        "contentJson.blocks[0].caption",
        "contentJson.blocks[0].sourceLabel"
      ]);
    }
  });

  test("rejects a negative/non-integer/absurdly large durationSeconds", () => {
    for (const durationSeconds of [-1, 1.5, 60 * 60 * 24 * 8]) {
      const result = validateAndNormalizeContentJsonVideoBlocks({
        blocks: [
          {
            type: "video_news",
            provider: "youtube",
            videoId: VIDEO_ID,
            durationSeconds
          }
        ]
      });
      expect(result.valid).toBe(false);
    }
  });

  test("does not format/existence-validate thumbnailMediaObjectId here (left to the mode-gated DB check)", () => {
    const result = validateAndNormalizeContentJsonVideoBlocks({
      blocks: [
        {
          type: "video_news",
          provider: "youtube",
          videoId: VIDEO_ID,
          thumbnailMediaObjectId: "not-a-uuid-at-all"
        }
      ]
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(
        (result.value.blocks as Array<Record<string, unknown>>)[0]
          ?.thumbnailMediaObjectId
      ).toBe("not-a-uuid-at-all");
    }
  });

  test("leaves non-video_news blocks (e.g. gallery, paragraph) completely untouched", () => {
    const galleryBlock = {
      type: "gallery",
      items: [{ mediaType: "image", mediaObjectId: VALID_ID }]
    };
    const result = validateAndNormalizeContentJsonVideoBlocks({
      blocks: [{ type: "paragraph", text: "hi" }, galleryBlock]
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.blocks).toEqual([
        { type: "paragraph", text: "hi" },
        galleryBlock
      ]);
    }
  });

  test("collects errors across multiple video_news blocks in one pass", () => {
    const result = validateAndNormalizeContentJsonVideoBlocks({
      blocks: [
        { type: "video_news", provider: "vimeo", videoId: VIDEO_ID },
        { type: "video_news", provider: "youtube", videoId: "bad" }
      ]
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toEqual([
        {
          field: "contentJson.blocks[0].provider",
          message: "provider must be one of: youtube."
        },
        {
          field: "contentJson.blocks[1].videoId",
          message: "videoId must be a valid YouTube video id or video URL."
        }
      ]);
    }
  });
});
