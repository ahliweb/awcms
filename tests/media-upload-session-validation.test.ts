import { describe, expect, test } from "bun:test";

import {
  validateCreateNewsMediaUploadSessionInput,
  validateFinalizeNewsMediaUploadSessionInput
} from "../src/modules/media-library/domain/media-upload-session-validation";

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];
/** The shipped default cap, 2 MiB (Issue #1221). */
const MAX_BYTES = 2_097_152;

describe("validateCreateNewsMediaUploadSessionInput (Issue #634)", () => {
  test("valid minimal request", () => {
    const result = validateCreateNewsMediaUploadSessionInput(
      { mimeType: "image/jpeg", byteSize: 1024 },
      ALLOWED,
      MAX_BYTES
    );
    expect(result).toEqual({
      valid: true,
      value: {
        mimeType: "image/jpeg",
        byteSize: 1024,
        originalFilename: null,
        altText: null,
        caption: null
      }
    });
  });

  test("normalizes mimeType casing/whitespace", () => {
    const result = validateCreateNewsMediaUploadSessionInput(
      { mimeType: "  IMAGE/PNG  ", byteSize: 100 },
      ALLOWED,
      MAX_BYTES
    );
    expect(result.valid).toBe(true);
    expect(result.valid && result.value.mimeType).toBe("image/png");
  });

  test("rejects a mimeType outside the allow-list (e.g. image/svg+xml)", () => {
    const result = validateCreateNewsMediaUploadSessionInput(
      { mimeType: "image/svg+xml", byteSize: 100 },
      ALLOWED,
      MAX_BYTES
    );
    expect(result.valid).toBe(false);
  });

  test("the cap is inclusive: exactly the default 2 MiB is accepted, one byte more is refused", () => {
    const at = validateCreateNewsMediaUploadSessionInput(
      { mimeType: "image/jpeg", byteSize: MAX_BYTES },
      ALLOWED,
      MAX_BYTES
    );
    const over = validateCreateNewsMediaUploadSessionInput(
      { mimeType: "image/jpeg", byteSize: MAX_BYTES + 1 },
      ALLOWED,
      MAX_BYTES
    );

    expect(at.valid).toBe(true);
    expect(over.valid).toBe(false);
  });

  test("a client that skips compression and claims a 5 MiB phone photo is refused at the default (the server never trusts the browser)", () => {
    const result = validateCreateNewsMediaUploadSessionInput(
      { mimeType: "image/jpeg", byteSize: 5 * 1024 * 1024 },
      ALLOWED,
      MAX_BYTES
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "byteSize")).toBe(true);
    }
  });

  test("an operator override raises or lowers the cap, and the old 10 MiB is now an override", () => {
    const tenMiB = 10_485_760;

    expect(
      validateCreateNewsMediaUploadSessionInput(
        { mimeType: "image/jpeg", byteSize: tenMiB },
        ALLOWED,
        tenMiB
      ).valid
    ).toBe(true);
    expect(
      validateCreateNewsMediaUploadSessionInput(
        { mimeType: "image/jpeg", byteSize: tenMiB },
        ALLOWED,
        MAX_BYTES
      ).valid
    ).toBe(false);
  });

  test("rejects a byteSize larger than the configured max", () => {
    const result = validateCreateNewsMediaUploadSessionInput(
      { mimeType: "image/jpeg", byteSize: MAX_BYTES + 1 },
      ALLOWED,
      MAX_BYTES
    );
    expect(result.valid).toBe(false);
    expect(
      result.valid === false &&
        result.errors.some((e) => e.field === "byteSize")
    ).toBe(true);
  });

  test("rejects missing mimeType/byteSize", () => {
    const result = validateCreateNewsMediaUploadSessionInput(
      {},
      ALLOWED,
      MAX_BYTES
    );
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.errors.length).toBe(2);
  });

  test("rejects a non-object body", () => {
    const result = validateCreateNewsMediaUploadSessionInput(
      null,
      ALLOWED,
      MAX_BYTES
    );
    expect(result.valid).toBe(false);
  });

  test("accepts optional originalFilename/altText/caption, trims and treats blank as null", () => {
    const result = validateCreateNewsMediaUploadSessionInput(
      {
        mimeType: "image/jpeg",
        byteSize: 1,
        originalFilename: "  photo.jpg  ",
        altText: "   ",
        caption: "A caption"
      },
      ALLOWED,
      MAX_BYTES
    );
    expect(result.valid).toBe(true);
    expect(result.valid && result.value.originalFilename).toBe("photo.jpg");
    expect(result.valid && result.value.altText).toBeNull();
    expect(result.valid && result.value.caption).toBe("A caption");
  });
});

describe("validateFinalizeNewsMediaUploadSessionInput (Issue #634)", () => {
  test("empty/absent body is valid (checksum is optional)", () => {
    expect(validateFinalizeNewsMediaUploadSessionInput(null)).toEqual({
      valid: true,
      value: { checksumSha256: null }
    });
    expect(validateFinalizeNewsMediaUploadSessionInput({})).toEqual({
      valid: true,
      value: { checksumSha256: null }
    });
  });

  test("accepts a well-formed 64-hex-char checksum, lowercased", () => {
    const result = validateFinalizeNewsMediaUploadSessionInput({
      checksumSha256: "A".repeat(64)
    });
    expect(result).toEqual({
      valid: true,
      value: { checksumSha256: "a".repeat(64) }
    });
  });

  test("rejects a malformed checksum", () => {
    expect(
      validateFinalizeNewsMediaUploadSessionInput({
        checksumSha256: "not-a-checksum"
      }).valid
    ).toBe(false);
    expect(
      validateFinalizeNewsMediaUploadSessionInput({
        checksumSha256: "a".repeat(63)
      }).valid
    ).toBe(false);
  });

  test("rejects a non-object body", () => {
    expect(validateFinalizeNewsMediaUploadSessionInput("nope").valid).toBe(
      false
    );
  });
});
