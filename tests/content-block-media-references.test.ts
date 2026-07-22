import { describe, expect, test } from "bun:test";

import {
  collectGalleryImageReferences,
  collectVideoNewsThumbnailReferences
} from "../src/modules/blog-content/domain/content-block-media-references";

const VALID_ID = "11111111-1111-1111-1111-111111111111";
const VALID_ID_2 = "22222222-2222-2222-2222-222222222222";

describe("collectGalleryImageReferences (Issue #636)", () => {
  test("empty for content with no blocks/gallery blocks", () => {
    expect(collectGalleryImageReferences({})).toEqual({
      mediaObjectIds: [],
      violations: []
    });
    expect(
      collectGalleryImageReferences({
        blocks: [{ type: "paragraph", text: "hi" }]
      })
    ).toEqual({ mediaObjectIds: [], violations: [] });
  });

  test("collects a well-formed mediaObjectId from an image gallery item", () => {
    const result = collectGalleryImageReferences({
      blocks: [
        {
          type: "gallery",
          items: [{ mediaType: "image", mediaObjectId: VALID_ID }]
        }
      ]
    });
    expect(result).toEqual({ mediaObjectIds: [VALID_ID], violations: [] });
  });

  test("deduplicates the same mediaObjectId referenced multiple times", () => {
    const result = collectGalleryImageReferences({
      blocks: [
        {
          type: "gallery",
          items: [
            { mediaType: "image", mediaObjectId: VALID_ID },
            { mediaType: "image", mediaObjectId: VALID_ID }
          ]
        }
      ]
    });
    expect(result.mediaObjectIds).toEqual([VALID_ID]);
  });

  test('flags a raw url on an image item as a violation, in full-online R2-only mode ("raw_url_not_allowed")', () => {
    const result = collectGalleryImageReferences({
      blocks: [
        {
          type: "gallery",
          items: [{ mediaType: "image", url: "https://cdn.example.com/a.jpg" }]
        }
      ]
    });
    expect(result.mediaObjectIds).toEqual([]);
    expect(result.violations).toEqual([
      {
        itemIndex: 0,
        reason: "raw_url_not_allowed",
        rawUrl: "https://cdn.example.com/a.jpg"
      }
    ]);
  });

  test("flags a missing mediaObjectId on an image item", () => {
    const result = collectGalleryImageReferences({
      blocks: [{ type: "gallery", items: [{ mediaType: "image" }] }]
    });
    expect(result.violations).toEqual([
      { itemIndex: 0, reason: "media_object_id_missing_or_malformed" }
    ]);
  });

  test("flags a malformed (non-UUID) mediaObjectId", () => {
    const result = collectGalleryImageReferences({
      blocks: [
        {
          type: "gallery",
          items: [{ mediaType: "image", mediaObjectId: "not-a-uuid" }]
        }
      ]
    });
    expect(result.violations).toEqual([
      { itemIndex: 0, reason: "media_object_id_missing_or_malformed" }
    ]);
  });

  test("ignores video items entirely (Issue #639's scope, not #636)", () => {
    const result = collectGalleryImageReferences({
      blocks: [
        {
          type: "gallery",
          items: [
            { mediaType: "video", url: "https://cdn.example.com/a.mp4" },
            { mediaType: "video" }
          ]
        }
      ]
    });
    expect(result).toEqual({ mediaObjectIds: [], violations: [] });
  });

  test("reports the correct itemIndex per violation across multiple items", () => {
    const result = collectGalleryImageReferences({
      blocks: [
        {
          type: "gallery",
          items: [
            { mediaType: "image", mediaObjectId: VALID_ID },
            { mediaType: "image", url: "https://cdn.example.com/a.jpg" },
            { mediaType: "image" },
            { mediaType: "image", mediaObjectId: VALID_ID_2 }
          ]
        }
      ]
    });
    expect(result.mediaObjectIds.sort()).toEqual([VALID_ID, VALID_ID_2].sort());
    expect(result.violations).toEqual([
      {
        itemIndex: 1,
        reason: "raw_url_not_allowed",
        rawUrl: "https://cdn.example.com/a.jpg"
      },
      { itemIndex: 2, reason: "media_object_id_missing_or_malformed" }
    ]);
  });

  test("tolerates malformed contentJson shapes (non-array blocks, non-array items) without throwing", () => {
    expect(collectGalleryImageReferences({ blocks: "nope" })).toEqual({
      mediaObjectIds: [],
      violations: []
    });
    expect(
      collectGalleryImageReferences({
        blocks: [{ type: "gallery", items: "nope" }]
      })
    ).toEqual({ mediaObjectIds: [], violations: [] });
  });
});

describe("collectVideoNewsThumbnailReferences (Issue #639)", () => {
  test("empty for content with no blocks/video_news blocks", () => {
    expect(collectVideoNewsThumbnailReferences({})).toEqual({
      mediaObjectIds: [],
      violations: []
    });
    expect(
      collectVideoNewsThumbnailReferences({
        blocks: [{ type: "paragraph", text: "hi" }]
      })
    ).toEqual({ mediaObjectIds: [], violations: [] });
  });

  test("a video_news block with NO thumbnailMediaObjectId is not a violation (custom thumbnail is optional)", () => {
    const result = collectVideoNewsThumbnailReferences({
      blocks: [
        { type: "video_news", provider: "youtube", videoId: "dQw4w9WgXcQ" }
      ]
    });
    expect(result).toEqual({ mediaObjectIds: [], violations: [] });
  });

  test("collects a well-formed thumbnailMediaObjectId", () => {
    const result = collectVideoNewsThumbnailReferences({
      blocks: [
        {
          type: "video_news",
          provider: "youtube",
          videoId: "dQw4w9WgXcQ",
          thumbnailMediaObjectId: VALID_ID
        }
      ]
    });
    expect(result).toEqual({ mediaObjectIds: [VALID_ID], violations: [] });
  });

  test("deduplicates the same thumbnailMediaObjectId referenced by multiple blocks", () => {
    const result = collectVideoNewsThumbnailReferences({
      blocks: [
        {
          type: "video_news",
          provider: "youtube",
          videoId: "dQw4w9WgXcQ",
          thumbnailMediaObjectId: VALID_ID
        },
        {
          type: "video_news",
          provider: "youtube",
          videoId: "dQw4w9WgXcR",
          thumbnailMediaObjectId: VALID_ID
        }
      ]
    });
    expect(result.mediaObjectIds).toEqual([VALID_ID]);
  });

  test("flags a malformed (non-UUID) thumbnailMediaObjectId", () => {
    const result = collectVideoNewsThumbnailReferences({
      blocks: [
        {
          type: "video_news",
          provider: "youtube",
          videoId: "dQw4w9WgXcQ",
          thumbnailMediaObjectId: "not-a-uuid"
        }
      ]
    });
    expect(result.mediaObjectIds).toEqual([]);
    expect(result.violations).toEqual([
      { blockIndex: 0, reason: "media_object_id_malformed" }
    ]);
  });

  test("ignores gallery/other block types entirely", () => {
    const result = collectVideoNewsThumbnailReferences({
      blocks: [
        {
          type: "gallery",
          items: [{ mediaType: "image", mediaObjectId: VALID_ID }]
        }
      ]
    });
    expect(result).toEqual({ mediaObjectIds: [], violations: [] });
  });

  test("reports the correct blockIndex per violation across multiple blocks", () => {
    const result = collectVideoNewsThumbnailReferences({
      blocks: [
        { type: "paragraph", text: "intro" },
        {
          type: "video_news",
          provider: "youtube",
          videoId: "dQw4w9WgXcQ",
          thumbnailMediaObjectId: "not-a-uuid"
        },
        {
          type: "video_news",
          provider: "youtube",
          videoId: "dQw4w9WgXcR",
          thumbnailMediaObjectId: VALID_ID_2
        }
      ]
    });
    expect(result.mediaObjectIds).toEqual([VALID_ID_2]);
    expect(result.violations).toEqual([
      { blockIndex: 1, reason: "media_object_id_malformed" }
    ]);
  });

  test("tolerates malformed contentJson shapes (non-array blocks) without throwing", () => {
    expect(collectVideoNewsThumbnailReferences({ blocks: "nope" })).toEqual({
      mediaObjectIds: [],
      violations: []
    });
  });
});
