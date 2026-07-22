import { describe, expect, test } from "bun:test";

import {
  buildNewsMediaObjectKey,
  buildNewsMediaPublicUrl,
  deriveExtensionFromMimeType,
  isValidNewsMediaObjectKey,
  UnsupportedNewsMediaMimeTypeError,
  UntrustedNewsMediaPublicBaseUrlError
} from "../src/modules/news-portal/domain/news-media-object-key";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_TENANT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const UUID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

describe("deriveExtensionFromMimeType", () => {
  test("maps every default-allowed mime type per architecture doc §6", () => {
    expect(deriveExtensionFromMimeType("image/jpeg")).toBe("jpg");
    expect(deriveExtensionFromMimeType("image/png")).toBe("png");
    expect(deriveExtensionFromMimeType("image/webp")).toBe("webp");
    expect(deriveExtensionFromMimeType("image/gif")).toBe("gif");
  });

  test("is case-insensitive and trims whitespace", () => {
    expect(deriveExtensionFromMimeType(" IMAGE/JPEG ")).toBe("jpg");
  });

  test("returns undefined for an unmapped mime type (e.g. svg, disallowed by default)", () => {
    expect(deriveExtensionFromMimeType("image/svg+xml")).toBeUndefined();
    expect(deriveExtensionFromMimeType("application/pdf")).toBeUndefined();
  });
});

describe("buildNewsMediaObjectKey", () => {
  test("builds the exact §6 format: news-media/{tenantId}/{yyyy}/{mm}/{uuid}.{ext}", () => {
    const key = buildNewsMediaObjectKey({
      tenantId: TENANT_ID,
      mimeType: "image/png",
      uuid: UUID,
      now: new Date("2026-03-05T00:00:00Z")
    });

    expect(key).toBe(`news-media/${TENANT_ID}/2026/03/${UUID}.png`);
  });

  test("throws UnsupportedNewsMediaMimeTypeError for an unmapped mime type", () => {
    expect(() =>
      buildNewsMediaObjectKey({
        tenantId: TENANT_ID,
        mimeType: "image/svg+xml",
        uuid: UUID
      })
    ).toThrow(UnsupportedNewsMediaMimeTypeError);
  });

  test("never includes an original filename, title, or other client text", () => {
    const key = buildNewsMediaObjectKey({
      tenantId: TENANT_ID,
      mimeType: "image/jpeg",
      uuid: UUID,
      now: new Date("2026-01-01T00:00:00Z")
    });

    // The key is fully determined by tenantId/date/uuid/ext — nothing else
    // could sneak in even if a caller tried (no such parameter exists).
    expect(key).toBe(`news-media/${TENANT_ID}/2026/01/${UUID}.jpg`);
  });
});

describe("isValidNewsMediaObjectKey", () => {
  test("accepts a well-formed key for the given tenant", () => {
    const key = `news-media/${TENANT_ID}/2026/03/${UUID}.jpg`;
    expect(isValidNewsMediaObjectKey(TENANT_ID, key)).toBe(true);
  });

  test("rejects a key belonging to a different tenant", () => {
    const key = `news-media/${OTHER_TENANT_ID}/2026/03/${UUID}.jpg`;
    expect(isValidNewsMediaObjectKey(TENANT_ID, key)).toBe(false);
  });

  test("rejects a key with a local-filesystem-looking path", () => {
    expect(isValidNewsMediaObjectKey(TENANT_ID, "/uploads/photo.jpg")).toBe(
      false
    );
    expect(isValidNewsMediaObjectKey(TENANT_ID, "/public/photo.jpg")).toBe(
      false
    );
  });

  test("rejects a key using the original filename instead of a uuid", () => {
    const key = `news-media/${TENANT_ID}/2026/03/photo-lapangan.jpg`;
    expect(isValidNewsMediaObjectKey(TENANT_ID, key)).toBe(false);
  });

  test("rejects a key with a malformed date partition", () => {
    const key = `news-media/${TENANT_ID}/26/3/${UUID}.jpg`;
    expect(isValidNewsMediaObjectKey(TENANT_ID, key)).toBe(false);
  });

  test("rejects path traversal attempts", () => {
    const key = `news-media/${TENANT_ID}/../../etc/passwd`;
    expect(isValidNewsMediaObjectKey(TENANT_ID, key)).toBe(false);
  });
});

describe("buildNewsMediaPublicUrl", () => {
  test("builds a URL from the trusted base URL and server-generated object key", () => {
    const key = `news-media/${TENANT_ID}/2026/03/${UUID}.jpg`;
    expect(buildNewsMediaPublicUrl("https://media.example.test", key)).toBe(
      `https://media.example.test/${key}`
    );
  });

  test("trims a trailing slash on the base URL before joining", () => {
    const key = `news-media/${TENANT_ID}/2026/03/${UUID}.jpg`;
    expect(buildNewsMediaPublicUrl("https://media.example.test/", key)).toBe(
      `https://media.example.test/${key}`
    );
  });

  test("rejects a non-https base URL", () => {
    expect(() =>
      buildNewsMediaPublicUrl("http://media.example.test", "k")
    ).toThrow(UntrustedNewsMediaPublicBaseUrlError);
  });

  test("rejects a malformed base URL", () => {
    expect(() => buildNewsMediaPublicUrl("not-a-url", "k")).toThrow(
      UntrustedNewsMediaPublicBaseUrlError
    );
  });
});
