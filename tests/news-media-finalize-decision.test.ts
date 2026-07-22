import { describe, expect, test } from "bun:test";

import { decideNewsMediaFinalizeOutcome } from "../src/modules/news-portal/domain/news-media-finalize-decision";

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];

describe("decideNewsMediaFinalizeOutcome (Issue #634)", () => {
  test("accepts when sniffed mime matches allow-list and claimed mime, no checksum claim", () => {
    const decision = decideNewsMediaFinalizeOutcome({
      claimedMimeType: "image/jpeg",
      allowedMimeTypes: ALLOWED,
      sniffedMimeType: "image/jpeg",
      claimedChecksumSha256: null,
      computedChecksumSha256: "a".repeat(64)
    });
    expect(decision).toEqual({ accepted: true });
  });

  test("accepts when checksum claim matches computed checksum (case-insensitive)", () => {
    const decision = decideNewsMediaFinalizeOutcome({
      claimedMimeType: "image/png",
      allowedMimeTypes: ALLOWED,
      sniffedMimeType: "image/png",
      claimedChecksumSha256: "ABCD".repeat(16),
      computedChecksumSha256: "abcd".repeat(16)
    });
    expect(decision).toEqual({ accepted: true });
  });

  test("rejects — mime not recognized at all (HTML/JS disguised as an image, the Issue #631 exploit)", () => {
    const decision = decideNewsMediaFinalizeOutcome({
      claimedMimeType: "image/jpeg",
      allowedMimeTypes: ALLOWED,
      sniffedMimeType: undefined,
      claimedChecksumSha256: null,
      computedChecksumSha256: "a".repeat(64)
    });
    expect(decision).toEqual({
      accepted: false,
      reason: "mime_not_recognized"
    });
  });

  test("rejects — sniffed mime recognized but not in the deployment's allow-list", () => {
    const decision = decideNewsMediaFinalizeOutcome({
      claimedMimeType: "image/gif",
      allowedMimeTypes: ["image/jpeg", "image/png"],
      sniffedMimeType: "image/gif",
      claimedChecksumSha256: null,
      computedChecksumSha256: "a".repeat(64)
    });
    expect(decision).toEqual({ accepted: false, reason: "mime_not_allowed" });
  });

  test("rejects — sniffed mime does not match the claimed mime type at create time", () => {
    const decision = decideNewsMediaFinalizeOutcome({
      claimedMimeType: "image/png",
      allowedMimeTypes: ALLOWED,
      sniffedMimeType: "image/jpeg",
      claimedChecksumSha256: null,
      computedChecksumSha256: "a".repeat(64)
    });
    expect(decision).toEqual({ accepted: false, reason: "mime_mismatch" });
  });

  test("rejects — checksum claim does not match server-computed checksum, even though mime sniff passed", () => {
    const decision = decideNewsMediaFinalizeOutcome({
      claimedMimeType: "image/jpeg",
      allowedMimeTypes: ALLOWED,
      sniffedMimeType: "image/jpeg",
      claimedChecksumSha256: "b".repeat(64),
      computedChecksumSha256: "a".repeat(64)
    });
    expect(decision).toEqual({ accepted: false, reason: "checksum_mismatch" });
  });

  test("a passing MIME sniff never overrides a checksum claim mismatch (defense in depth — every check must pass)", () => {
    const decision = decideNewsMediaFinalizeOutcome({
      claimedMimeType: "image/webp",
      allowedMimeTypes: ALLOWED,
      sniffedMimeType: "image/webp",
      claimedChecksumSha256: "deadbeef".repeat(8),
      computedChecksumSha256: "0".repeat(64)
    });
    expect(decision.accepted).toBe(false);
  });
});
