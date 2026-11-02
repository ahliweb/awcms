/**
 * Image header sniffing for browser-side compression (Issue #1221 review).
 * PURE: byte arrays in, plain values out. Nothing here decodes pixels, so it is
 * safe to run BEFORE `createImageBitmap` allocates a full bitmap.
 *
 * Every parser is bounds-checked and returns `null` / `false` for a header it
 * cannot read: the caller decides what an unreadable header means (the
 * orchestrator falls through to decode and keeps its post-decode backstop).
 */

/** How many leading bytes the orchestrator reads for these helpers. */
export const HEADER_SCAN_BYTES = 256 * 1024;

export type SniffedImageType = "image/jpeg" | "image/png" | "image/webp";

function ascii(bytes: Uint8Array, offset: number, text: string): boolean {
  if (offset + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

function u32be(bytes: Uint8Array, o: number): number {
  return (
    ((bytes[o] as number) * 0x1000000 +
      ((bytes[o + 1] as number) << 16) +
      ((bytes[o + 2] as number) << 8) +
      (bytes[o + 3] as number)) >>>
    0
  );
}

function u32le(bytes: Uint8Array, o: number): number {
  return (
    ((bytes[o + 3] as number) * 0x1000000 +
      ((bytes[o + 2] as number) << 16) +
      ((bytes[o + 1] as number) << 8) +
      (bytes[o] as number)) >>>
    0
  );
}

function u24le(bytes: Uint8Array, o: number): number {
  return (
    (bytes[o] as number) |
    ((bytes[o + 1] as number) << 8) |
    ((bytes[o + 2] as number) << 16)
  );
}

/** The real type from the magic bytes, or `null` for anything else. */
export function sniffImageType(bytes: Uint8Array): SniffedImageType | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) {
    return "image/webp";
  }
  return null;
}

/**
 * Whether the file is an animated WebP (VP8X animation flag or an `ANIM`
 * chunk) or an APNG (an `acTL` chunk before the first `IDAT`). JPEG never is.
 */
export function detectAnimation(
  bytes: Uint8Array,
  type: SniffedImageType
): boolean {
  if (type === "image/png") {
    let o = 8;
    while (o + 8 <= bytes.length) {
      const length = u32be(bytes, o);
      if (ascii(bytes, o + 4, "acTL")) return true;
      if (ascii(bytes, o + 4, "IDAT") || ascii(bytes, o + 4, "IEND")) {
        return false;
      }
      o += 12 + length;
    }
    return false;
  }

  if (type === "image/webp") {
    let o = 12;
    while (o + 8 <= bytes.length) {
      if (ascii(bytes, o, "ANIM")) return true;
      if (ascii(bytes, o, "VP8X") && o + 9 <= bytes.length) {
        if (((bytes[o + 8] as number) & 0x02) !== 0) return true;
      }
      const size = u32le(bytes, o + 4);
      o += 8 + size + (size & 1);
    }
    return false;
  }

  return false;
}

/** Pixel size from the header (before EXIF orientation), or `null`. */
export function readPixelDimensions(
  bytes: Uint8Array,
  type: SniffedImageType
): { width: number; height: number } | null {
  if (type === "image/png") {
    if (bytes.length < 24 || !ascii(bytes, 12, "IHDR")) return null;
    return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
  }

  if (type === "image/jpeg") {
    let o = 2;
    while (o + 4 <= bytes.length) {
      if (bytes[o] !== 0xff) return null;
      // Fill bytes: any number of 0xFF may precede a marker.
      while (bytes[o + 1] === 0xff && o + 2 < bytes.length) o += 1;
      const marker = bytes[o + 1] as number;
      // Standalone markers carry no length.
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
        o += 2;
        continue;
      }
      // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC).
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        if (o + 9 > bytes.length) return null;
        return {
          height: ((bytes[o + 5] as number) << 8) | (bytes[o + 6] as number),
          width: ((bytes[o + 7] as number) << 8) | (bytes[o + 8] as number)
        };
      }
      o += 2 + (((bytes[o + 2] as number) << 8) | (bytes[o + 3] as number));
    }
    return null;
  }

  // WebP: the first chunk after "WEBP" carries the size.
  if (bytes.length < 30) return null;
  if (ascii(bytes, 12, "VP8X")) {
    return {
      width: 1 + u24le(bytes, 24),
      height: 1 + u24le(bytes, 27)
    };
  }
  if (ascii(bytes, 12, "VP8 ")) {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
      return null;
    }
    return {
      width: (((bytes[27] as number) << 8) | (bytes[26] as number)) & 0x3fff,
      height: (((bytes[29] as number) << 8) | (bytes[28] as number)) & 0x3fff
    };
  }
  if (ascii(bytes, 12, "VP8L")) {
    if (bytes[20] !== 0x2f) return null;
    const bits = u32le(bytes, 21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1
    };
  }
  return null;
}
