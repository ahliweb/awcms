import { describe, expect, test } from "bun:test";

import { validateVideoNewsThumbnailReferencesForFullOnlineR2Mode } from "../src/modules/blog-content/application/video-news-thumbnail-reference-gate";
import type {
  MediaLibraryPort,
  ResolvedMediaReferenceDTO
} from "../src/modules/_shared/ports/media-library-port";

const VALID_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_TENANT_ID = "22222222-2222-2222-2222-222222222222";

/** Fake `tx` — never dereferenced by the gate itself, only forwarded opaquely to `mediaPort`'s methods below, which ignore it. */
const FAKE_TX = {} as unknown as Bun.SQL;

function fakePort(options: {
  modeActive: boolean;
  safeIds?: Set<string>;
}): MediaLibraryPort {
  return {
    async isManagedMediaEnforcementActiveForTenant() {
      return options.modeActive;
    },
    async isMediaReferenceSafe(_tx, _tenantId, mediaObjectId) {
      return options.safeIds?.has(mediaObjectId) ?? false;
    },
    async resolveMediaReferences() {
      return new Map<string, ResolvedMediaReferenceDTO>();
    }
  };
}

describe("validateVideoNewsThumbnailReferencesForFullOnlineR2Mode (Issue #639)", () => {
  test("valid when contentJson is undefined", async () => {
    const result =
      await validateVideoNewsThumbnailReferencesForFullOnlineR2Mode(
        FAKE_TX,
        "tenant-a",
        undefined,
        fakePort({ modeActive: true })
      );
    expect(result).toEqual({ valid: true });
  });

  test("no-op (valid) when full-online R2-only mode is not active for the tenant, even with a malformed thumbnailMediaObjectId", async () => {
    const result =
      await validateVideoNewsThumbnailReferencesForFullOnlineR2Mode(
        FAKE_TX,
        "tenant-a",
        {
          blocks: [
            {
              type: "video_news",
              provider: "youtube",
              videoId: "dQw4w9WgXcQ",
              thumbnailMediaObjectId: "not-a-uuid"
            }
          ]
        },
        fakePort({ modeActive: false })
      );
    expect(result).toEqual({ valid: true });
  });

  test("valid when mode is active but no video_news block references a thumbnail", async () => {
    const result =
      await validateVideoNewsThumbnailReferencesForFullOnlineR2Mode(
        FAKE_TX,
        "tenant-a",
        {
          blocks: [
            { type: "video_news", provider: "youtube", videoId: "dQw4w9WgXcQ" }
          ]
        },
        fakePort({ modeActive: true })
      );
    expect(result).toEqual({ valid: true });
  });

  test("valid when mode is active and thumbnailMediaObjectId resolves as safe", async () => {
    const result =
      await validateVideoNewsThumbnailReferencesForFullOnlineR2Mode(
        FAKE_TX,
        "tenant-a",
        {
          blocks: [
            {
              type: "video_news",
              provider: "youtube",
              videoId: "dQw4w9WgXcQ",
              thumbnailMediaObjectId: VALID_ID
            }
          ]
        },
        fakePort({ modeActive: true, safeIds: new Set([VALID_ID]) })
      );
    expect(result).toEqual({ valid: true });
  });

  test("invalid when mode is active and thumbnailMediaObjectId is malformed", async () => {
    const result =
      await validateVideoNewsThumbnailReferencesForFullOnlineR2Mode(
        FAKE_TX,
        "tenant-a",
        {
          blocks: [
            {
              type: "video_news",
              provider: "youtube",
              videoId: "dQw4w9WgXcQ",
              thumbnailMediaObjectId: "not-a-uuid"
            }
          ]
        },
        fakePort({ modeActive: true })
      );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toEqual([
        {
          field: "contentJson",
          message:
            "contentJson.blocks[0].thumbnailMediaObjectId must be a valid UUID referencing a verified R2 media object in full-online R2-only mode."
        }
      ]);
    }
  });

  test("invalid when mode is active and thumbnailMediaObjectId does not resolve as safe (cross-tenant/deleted/unverified)", async () => {
    const result =
      await validateVideoNewsThumbnailReferencesForFullOnlineR2Mode(
        FAKE_TX,
        "tenant-a",
        {
          blocks: [
            {
              type: "video_news",
              provider: "youtube",
              videoId: "dQw4w9WgXcQ",
              thumbnailMediaObjectId: OTHER_TENANT_ID
            }
          ]
        },
        fakePort({ modeActive: true, safeIds: new Set([VALID_ID]) })
      );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toEqual([
        {
          field: "contentJson",
          message: `contentJson references thumbnailMediaObjectId "${OTHER_TENANT_ID}" which does not exist, does not belong to this tenant, or is not a verified R2 media object.`
        }
      ]);
    }
  });
});
