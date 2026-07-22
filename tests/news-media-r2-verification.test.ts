/**
 * `verifyNewsMediaR2Object` orchestration (Issue #634) — the exact function
 * that closes the security-auditor Critical finding on Issue #631: finalize
 * must do a real `GET` + magic-byte sniffing + server-side checksum, never
 * `HEAD` alone. Exercised here against a hand-written fake
 * `NewsMediaR2Client` (the real client against a real fake HTTP server is
 * covered separately by `news-media-r2-client.test.ts`) so this file stays
 * focused on the orchestration/decision wiring.
 */
import { describe, expect, test } from "bun:test";

import { verifyNewsMediaR2Object } from "../src/modules/news-portal/application/news-media-r2-verification";
import type {
  NewsMediaR2Client,
  NewsMediaR2HeadResult,
  NewsMediaR2GetResult
} from "../src/modules/news-portal/infrastructure/news-media-r2-client";

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_BYTES = 10_485_760;

const JPEG_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46
]);

/** `listObjects`/`deleteObject` (Issue #690) are not exercised by this file's orchestration-only tests — `verifyNewsMediaR2Object` never calls either. */
function unusedListObjects(): never {
  throw new Error(
    "listObjects should not be called by verifyNewsMediaR2Object"
  );
}
function unusedDeleteObject(): never {
  throw new Error(
    "deleteObject should not be called by verifyNewsMediaR2Object"
  );
}

function fakeClient(overrides: {
  head?: NewsMediaR2HeadResult;
  get?: NewsMediaR2GetResult;
}): NewsMediaR2Client {
  return {
    presignUploadUrl: () => "https://example.test/presigned",
    headObject: async () =>
      overrides.head ?? {
        ok: true,
        exists: true,
        sizeBytes: JPEG_BYTES.byteLength
      },
    getObject: async () =>
      overrides.get ?? { ok: true, sizeExceeded: false, bytes: JPEG_BYTES },
    listObjects: unusedListObjects,
    deleteObject: unusedDeleteObject
  };
}

describe("verifyNewsMediaR2Object (Issue #634)", () => {
  test("HEAD reports missing object -> rejected object_not_found, GET never called", async () => {
    let getCalled = false;
    const client: NewsMediaR2Client = {
      presignUploadUrl: () => "unused",
      headObject: async () => ({ ok: true, exists: false }),
      getObject: async () => {
        getCalled = true;
        return { ok: true, sizeExceeded: false, bytes: JPEG_BYTES };
      },
      listObjects: unusedListObjects,
      deleteObject: unusedDeleteObject
    };

    const result = await verifyNewsMediaR2Object(client, {
      objectKey: "k",
      claimedMimeType: "image/jpeg",
      allowedMimeTypes: ALLOWED,
      maxUploadBytes: MAX_BYTES,
      claimedChecksumSha256: null
    });

    expect(result).toEqual({ outcome: "rejected", reason: "object_not_found" });
    expect(getCalled).toBe(false);
  });

  test("HEAD reports oversized object -> rejected size_exceeded, GET never called (bandwidth guard, doc §9)", async () => {
    let getCalled = false;
    const client: NewsMediaR2Client = {
      presignUploadUrl: () => "unused",
      headObject: async () => ({
        ok: true,
        exists: true,
        sizeBytes: MAX_BYTES + 1
      }),
      getObject: async () => {
        getCalled = true;
        return { ok: true, sizeExceeded: false, bytes: JPEG_BYTES };
      },
      listObjects: unusedListObjects,
      deleteObject: unusedDeleteObject
    };

    const result = await verifyNewsMediaR2Object(client, {
      objectKey: "k",
      claimedMimeType: "image/jpeg",
      allowedMimeTypes: ALLOWED,
      maxUploadBytes: MAX_BYTES,
      claimedChecksumSha256: null
    });

    expect(result).toEqual({ outcome: "rejected", reason: "size_exceeded" });
    expect(getCalled).toBe(false);
  });

  test("HEAD reports in-bounds size but GET's actual read exceeds it (object swapped between HEAD and GET, PR #653 TOCTOU fix) -> rejected size_exceeded, authoritative over the stale HEAD", async () => {
    const client = fakeClient({
      head: { ok: true, exists: true, sizeBytes: 10 },
      get: { ok: true, sizeExceeded: true }
    });

    const result = await verifyNewsMediaR2Object(client, {
      objectKey: "k",
      claimedMimeType: "image/jpeg",
      allowedMimeTypes: ALLOWED,
      maxUploadBytes: MAX_BYTES,
      claimedChecksumSha256: null
    });

    expect(result).toEqual({ outcome: "rejected", reason: "size_exceeded" });
  });

  test("HEAD provider error -> provider_error, never mutates/decides content validity", async () => {
    const client = fakeClient({ head: { ok: false, error: "boom" } });
    const result = await verifyNewsMediaR2Object(client, {
      objectKey: "k",
      claimedMimeType: "image/jpeg",
      allowedMimeTypes: ALLOWED,
      maxUploadBytes: MAX_BYTES,
      claimedChecksumSha256: null
    });
    expect(result).toEqual({ outcome: "provider_error", error: "boom" });
  });

  test("GET provider error -> provider_error", async () => {
    const client = fakeClient({ get: { ok: false, error: "get boom" } });
    const result = await verifyNewsMediaR2Object(client, {
      objectKey: "k",
      claimedMimeType: "image/jpeg",
      allowedMimeTypes: ALLOWED,
      maxUploadBytes: MAX_BYTES,
      claimedChecksumSha256: null
    });
    expect(result).toEqual({ outcome: "provider_error", error: "get boom" });
  });

  test("real HTML-disguised-as-jpg payload (Issue #631 exploit) -> full GET happens, sniff fails, rejected", async () => {
    const html = new TextEncoder().encode(
      "<html><body><script>alert(document.cookie)</script></body></html>"
    );
    const client = fakeClient({
      head: { ok: true, exists: true, sizeBytes: html.byteLength },
      get: { ok: true, sizeExceeded: false, bytes: html }
    });

    const result = await verifyNewsMediaR2Object(client, {
      objectKey: "k",
      claimedMimeType: "image/jpeg",
      allowedMimeTypes: ALLOWED,
      maxUploadBytes: MAX_BYTES,
      claimedChecksumSha256: null
    });

    expect(result).toEqual({
      outcome: "rejected",
      reason: "mime_not_recognized"
    });
  });

  test("valid JPEG accepted, checksum computed server-side from the actually-read bytes", async () => {
    const client = fakeClient({});
    const result = await verifyNewsMediaR2Object(client, {
      objectKey: "k",
      claimedMimeType: "image/jpeg",
      allowedMimeTypes: ALLOWED,
      maxUploadBytes: MAX_BYTES,
      claimedChecksumSha256: null
    });

    expect(result.outcome).toBe("accepted");
    if (result.outcome === "accepted") {
      expect(result.sizeBytes).toBe(JPEG_BYTES.byteLength);
      const hasher = new Bun.CryptoHasher("sha256");
      hasher.update(JPEG_BYTES);
      expect(result.checksumSha256).toBe(hasher.digest("hex"));
    }
  });

  test("claimed checksum mismatch (transport-corruption detection) rejects even with a valid MIME sniff", async () => {
    const client = fakeClient({});
    const result = await verifyNewsMediaR2Object(client, {
      objectKey: "k",
      claimedMimeType: "image/jpeg",
      allowedMimeTypes: ALLOWED,
      maxUploadBytes: MAX_BYTES,
      claimedChecksumSha256: "0".repeat(64)
    });

    expect(result).toEqual({
      outcome: "rejected",
      reason: "checksum_mismatch"
    });
  });
});
