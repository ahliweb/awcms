import { describe, expect, test } from "bun:test";

import { decideNewsMediaFinalizeOutcome } from "../src/modules/media-library/domain/media-finalize-decision";

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_WITH_SVG = [...ALLOWED, "image/svg+xml"];

describe("decideNewsMediaFinalizeOutcome (Issue #634)", () => {
  test("accepts when sniffed mime matches allow-list and claimed mime, no checksum claim", () => {
    const decision = decideNewsMediaFinalizeOutcome({
      claimedMimeType: "image/jpeg",
      allowedMimeTypes: ALLOWED,
      sniffedMimeType: "image/jpeg",
      svgUnsafe: false,
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
      svgUnsafe: false,
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
      svgUnsafe: false,
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
      svgUnsafe: false,
      claimedChecksumSha256: null,
      computedChecksumSha256: "a".repeat(64)
    });
    expect(decision).toEqual({ accepted: false, reason: "mime_not_allowed" });
  });

  test("rejects — SVG sniffed but not in the deployment's allow-list (the default posture — SVG is opt-in), even though the content itself is safe", () => {
    const decision = decideNewsMediaFinalizeOutcome({
      claimedMimeType: "image/svg+xml",
      allowedMimeTypes: ALLOWED,
      sniffedMimeType: "image/svg+xml",
      svgUnsafe: false,
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
      svgUnsafe: false,
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
      svgUnsafe: false,
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
      svgUnsafe: false,
      claimedChecksumSha256: "deadbeef".repeat(8),
      computedChecksumSha256: "0".repeat(64)
    });
    expect(decision.accepted).toBe(false);
  });

  describe("SVG content safety (Issue #806)", () => {
    test("accepts a safe SVG once the deployment opts in via the allow-list", () => {
      const decision = decideNewsMediaFinalizeOutcome({
        claimedMimeType: "image/svg+xml",
        allowedMimeTypes: ALLOWED_WITH_SVG,
        sniffedMimeType: "image/svg+xml",
        svgUnsafe: false,
        claimedChecksumSha256: null,
        computedChecksumSha256: "a".repeat(64)
      });
      expect(decision).toEqual({ accepted: true });
    });

    test("rejects an allow-listed SVG whose content tripped the safety scan (<script>/on*=/javascript:/external entity)", () => {
      const decision = decideNewsMediaFinalizeOutcome({
        claimedMimeType: "image/svg+xml",
        allowedMimeTypes: ALLOWED_WITH_SVG,
        sniffedMimeType: "image/svg+xml",
        svgUnsafe: true,
        claimedChecksumSha256: null,
        computedChecksumSha256: "a".repeat(64)
      });
      expect(decision).toEqual({
        accepted: false,
        reason: "svg_unsafe_content"
      });
    });

    test("svg_unsafe_content is checked before the checksum claim (defense in depth order)", () => {
      const decision = decideNewsMediaFinalizeOutcome({
        claimedMimeType: "image/svg+xml",
        allowedMimeTypes: ALLOWED_WITH_SVG,
        sniffedMimeType: "image/svg+xml",
        svgUnsafe: true,
        claimedChecksumSha256: "a".repeat(64),
        computedChecksumSha256: "a".repeat(64)
      });
      expect(decision).toEqual({
        accepted: false,
        reason: "svg_unsafe_content"
      });
    });

    test("svgUnsafe is ignored for a non-SVG sniff — a raster image is never affected by this field", () => {
      const decision = decideNewsMediaFinalizeOutcome({
        claimedMimeType: "image/jpeg",
        allowedMimeTypes: ALLOWED,
        sniffedMimeType: "image/jpeg",
        svgUnsafe: true,
        claimedChecksumSha256: null,
        computedChecksumSha256: "a".repeat(64)
      });
      expect(decision).toEqual({ accepted: true });
    });
  });
});
