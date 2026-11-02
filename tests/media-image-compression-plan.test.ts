/**
 * The pure compression planner (Issue #1221). No DOM, no Blob: numbers and
 * strings in, a decision or an ordered attempt list out. Every rule in the
 * issue's decisions 3-5 and 7 is pinned here, because this is the file that
 * decides what a person's photo turns into and a wrong turn is invisible until
 * somebody's logo has a black box behind it.
 */
import { describe, expect, test } from "bun:test";

import { NEWS_MEDIA_R2_DEFAULTS } from "../src/modules/media-library/domain/media-r2-public-config";
import {
  chooseOutputTypes,
  COMPRESSION_LIMITS,
  decideCompression,
  fillMessage,
  formatByteSize,
  planCompressionAttempts,
  renameForOutputType
} from "../src/lib/ui/media-image-compression-plan";
import {
  detectAnimation,
  readPixelDimensions,
  sniffImageType
} from "../src/lib/ui/media-image-header";

const MIB = 1024 * 1024;
const CAP = 2 * MIB;
const BOTH = ["image/webp", "image/jpeg"];

describe("the shipped parameters", () => {
  test("the cap the uploader compresses to is the server default, 2 MiB", () => {
    expect<number>(NEWS_MEDIA_R2_DEFAULTS.maxUploadBytes).toBe(CAP);
  });

  test("long edge 2560 -> 1920 -> 1600 -> 1280, quality 0.85 down to a 0.5 floor", () => {
    expect([...COMPRESSION_LIMITS.longEdgeSteps]).toEqual([
      2560, 1920, 1600, 1280
    ]);
    expect([...COMPRESSION_LIMITS.qualitySteps]).toEqual([
      0.85, 0.75, 0.65, 0.55, 0.5
    ]);
  });
});

describe("decideCompression", () => {
  test("a file within the cap is left untouched, whatever its type", () => {
    for (const mimeType of [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/svg+xml"
    ]) {
      expect(decideCompression({ mimeType, byteSize: CAP - 1 }, CAP)).toEqual({
        action: "passthrough"
      });
    }
  });

  test("a file exactly at the cap is within it (the server refuses only `> max`)", () => {
    expect(
      decideCompression({ mimeType: "image/jpeg", byteSize: CAP }, CAP)
    ).toEqual({ action: "passthrough" });
  });

  test("an oversize JPEG, PNG or WebP is compressed", () => {
    for (const mimeType of ["image/jpeg", "image/png", "image/webp"]) {
      expect(decideCompression({ mimeType, byteSize: CAP + 1 }, CAP)).toEqual({
        action: "compress"
      });
    }
  });

  test("the type is compared case- and whitespace-insensitively", () => {
    expect(
      decideCompression({ mimeType: "  IMAGE/JPEG ", byteSize: CAP + 1 }, CAP)
    ).toEqual({ action: "compress" });
  });

  test("a GIF over the cap is refused, never re-encoded (it would lose its animation)", () => {
    expect(
      decideCompression({ mimeType: "image/gif", byteSize: CAP + 1 }, CAP)
    ).toEqual({ action: "refuse", reason: "gif_over_cap" });
  });

  test("a GIF within the cap is untouched", () => {
    expect(
      decideCompression({ mimeType: "image/gif", byteSize: 1000 }, CAP)
    ).toEqual({ action: "passthrough" });
  });

  test("SVG and unknown types over the cap are refused, not compressed", () => {
    for (const mimeType of ["image/svg+xml", "image/avif", "", "text/html"]) {
      expect(decideCompression({ mimeType, byteSize: CAP + 1 }, CAP)).toEqual({
        action: "refuse",
        reason: "type_not_compressible"
      });
    }
  });

  test("nonsense sizes or caps are refused rather than guessed at", () => {
    const bad = [
      { byteSize: Number.NaN, cap: CAP },
      { byteSize: -1, cap: CAP },
      { byteSize: Number.POSITIVE_INFINITY, cap: CAP },
      { byteSize: 100, cap: 0 },
      { byteSize: 100, cap: Number.NaN }
    ];

    for (const { byteSize, cap } of bad) {
      expect(
        decideCompression({ mimeType: "image/jpeg", byteSize }, cap)
      ).toEqual({ action: "refuse", reason: "invalid_input" });
    }
  });

  test("a smaller custom cap is honoured (the env override)", () => {
    expect(
      decideCompression(
        { mimeType: "image/jpeg", byteSize: 600 * 1024 },
        512 * 1024
      )
    ).toEqual({ action: "compress" });
  });
});

describe("chooseOutputTypes", () => {
  test("alpha input is WebP only, never JPEG (JPEG would flatten transparency)", () => {
    expect(
      chooseOutputTypes({ mimeType: "image/png", hasAlpha: true }, BOTH)
    ).toEqual({ ok: true, outputTypes: ["image/webp"] });
    expect(
      chooseOutputTypes({ mimeType: "image/webp", hasAlpha: true }, BOTH)
    ).toEqual({ ok: true, outputTypes: ["image/webp"] });
  });

  test("alpha input in a browser that cannot encode WebP is an explicit failure", () => {
    expect(
      chooseOutputTypes({ mimeType: "image/png", hasAlpha: true }, [
        "image/jpeg"
      ])
    ).toEqual({ ok: false, reason: "alpha_needs_webp" });
  });

  test("an opaque JPEG is tried as both WebP and JPEG, smaller wins", () => {
    expect(
      chooseOutputTypes({ mimeType: "image/jpeg", hasAlpha: false }, BOTH)
    ).toEqual({ ok: true, outputTypes: ["image/webp", "image/jpeg"] });
  });

  test("an opaque JPEG falls back to the one type the browser can encode", () => {
    expect(
      chooseOutputTypes({ mimeType: "image/jpeg", hasAlpha: false }, [
        "image/jpeg"
      ])
    ).toEqual({ ok: true, outputTypes: ["image/jpeg"] });
    expect(
      chooseOutputTypes({ mimeType: "image/jpeg", hasAlpha: false }, [
        "image/webp"
      ])
    ).toEqual({ ok: true, outputTypes: ["image/webp"] });
  });

  test("an opaque PNG/WebP is WebP, and JPEG only when WebP cannot be encoded", () => {
    expect(
      chooseOutputTypes({ mimeType: "image/png", hasAlpha: false }, BOTH)
    ).toEqual({ ok: true, outputTypes: ["image/webp"] });
    expect(
      chooseOutputTypes({ mimeType: "image/png", hasAlpha: false }, [
        "image/jpeg"
      ])
    ).toEqual({ ok: true, outputTypes: ["image/jpeg"] });
  });

  test("a browser that can encode neither is an explicit failure", () => {
    for (const mimeType of ["image/jpeg", "image/png"]) {
      expect(chooseOutputTypes({ mimeType, hasAlpha: false }, [])).toEqual({
        ok: false,
        reason: "no_encoder"
      });
    }
  });
});

function plan(
  width: number,
  height: number,
  extra: Partial<{
    mimeType: string;
    hasAlpha: boolean;
    encodable: string[];
  }> = {}
) {
  return planCompressionAttempts(
    {
      mimeType: extra.mimeType ?? "image/jpeg",
      width,
      height,
      hasAlpha: extra.hasAlpha ?? false
    },
    extra.encodable ?? BOTH
  );
}

describe("planCompressionAttempts", () => {
  test("a large photo steps quality first, then the long edge, edge-major", () => {
    const result = plan(4000, 3000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 4 edge steps x 5 quality steps.
    expect(result.attempts).toHaveLength(20);

    // First edge group: 2560 px wide, aspect preserved, 0.85 -> 0.5.
    expect(result.attempts.slice(0, 5)).toEqual(
      [0.85, 0.75, 0.65, 0.55, 0.5].map((quality) => ({
        width: 2560,
        height: 1920,
        quality
      }))
    );

    // Edges in order, each restarting at the top quality.
    const firsts = result.attempts.filter((_, index) => index % 5 === 0);
    expect(firsts.map((attempt) => attempt.width)).toEqual([
      2560, 1920, 1600, 1280
    ]);
    expect(firsts.every((attempt) => attempt.quality === 0.85)).toBe(true);
  });

  test("the last attempt is the floor: 1280 px long edge at quality 0.5", () => {
    const result = plan(4000, 3000);
    if (!result.ok) throw new Error("expected a plan");

    expect(result.attempts[result.attempts.length - 1]).toEqual({
      width: 1280,
      height: 960,
      quality: 0.5
    });
  });

  test("never upscales: no attempt is larger than the source in either side", () => {
    for (const [width, height] of [
      [800, 600],
      [1280, 720],
      [1500, 1500],
      [2000, 3000],
      [6000, 200],
      [100, 9000]
    ] as const) {
      const result = plan(width, height);
      if (!result.ok) throw new Error("expected a plan");

      for (const attempt of result.attempts) {
        expect(attempt.width).toBeLessThanOrEqual(width);
        expect(attempt.height).toBeLessThanOrEqual(height);
        expect(attempt.width).toBeGreaterThanOrEqual(1);
        expect(attempt.height).toBeGreaterThanOrEqual(1);
      }
    }
  });

  test("a source smaller than the first step starts at its own size and does not repeat it", () => {
    const result = plan(1000, 500);
    if (!result.ok) throw new Error("expected a plan");

    // Every step clips to 1000 px: one edge group, not four identical ones.
    expect(result.attempts).toHaveLength(5);
    expect(
      new Set(result.attempts.map((a) => `${a.width}x${a.height}`))
    ).toEqual(new Set(["1000x500"]));
  });

  test("a source between steps keeps its own size first, then the lower steps", () => {
    const result = plan(2000, 1000);
    if (!result.ok) throw new Error("expected a plan");

    const edges = [...new Set(result.attempts.map((attempt) => attempt.width))];
    expect(edges).toEqual([2000, 1920, 1600, 1280]);
  });

  test("the long edge is the larger side, for portrait as for landscape", () => {
    const result = plan(3000, 4000);
    if (!result.ok) throw new Error("expected a plan");

    expect(result.attempts[0]).toEqual({
      width: 1920,
      height: 2560,
      quality: 0.85
    });
  });

  test("an extreme aspect ratio never yields a zero-pixel side", () => {
    const result = plan(20000, 3);
    if (!result.ok) throw new Error("expected a plan");

    for (const attempt of result.attempts) {
      expect(attempt.height).toBeGreaterThanOrEqual(1);
    }
  });

  test("qualities are strictly descending within every edge group", () => {
    const result = plan(4000, 3000);
    if (!result.ok) throw new Error("expected a plan");

    for (let start = 0; start < result.attempts.length; start += 5) {
      const group = result.attempts.slice(start, start + 5);
      const qualities = group.map((attempt) => attempt.quality);
      expect(qualities).toEqual([...qualities].sort((a, b) => b - a));
    }
  });

  test("alpha input plans WebP only", () => {
    const result = plan(4000, 3000, {
      mimeType: "image/png",
      hasAlpha: true
    });
    if (!result.ok) throw new Error("expected a plan");

    expect(result.outputTypes).toEqual(["image/webp"]);
  });

  test("an opaque JPEG plans both types", () => {
    const result = plan(4000, 3000);
    if (!result.ok) throw new Error("expected a plan");

    expect(result.outputTypes).toEqual(["image/webp", "image/jpeg"]);
  });

  test("alpha with no WebP encoder fails with an explicit reason, no plan", () => {
    expect(
      plan(4000, 3000, {
        mimeType: "image/png",
        hasAlpha: true,
        encodable: ["image/jpeg"]
      })
    ).toEqual({ ok: false, reason: "alpha_needs_webp" });
  });

  test("no encodable type fails with an explicit reason, no plan", () => {
    expect(plan(4000, 3000, { encodable: [] })).toEqual({
      ok: false,
      reason: "no_encoder"
    });
  });

  test("non-positive or fractional dimensions are rejected", () => {
    for (const [w, h] of [
      [0, 100],
      [100, 0],
      [-5, 100],
      [100.5, 100],
      [Number.NaN, 100]
    ] as const) {
      expect(plan(w, h)).toEqual({ ok: false, reason: "invalid_dimensions" });
    }
  });

  test("custom steps replace the shipped ones; malformed steps throw", () => {
    const result = planCompressionAttempts(
      { mimeType: "image/jpeg", width: 4000, height: 3000, hasAlpha: false },
      BOTH,
      { longEdgeSteps: [2000, 1000], qualitySteps: [0.9, 0.6] }
    );
    if (!result.ok) throw new Error("expected a plan");
    expect(result.attempts).toHaveLength(4);

    const bad = (options: Parameters<typeof planCompressionAttempts>[2]) =>
      planCompressionAttempts(
        { mimeType: "image/jpeg", width: 4000, height: 3000, hasAlpha: false },
        BOTH,
        options
      );

    expect(() => bad({ longEdgeSteps: [] })).toThrow(RangeError);
    expect(() => bad({ longEdgeSteps: [1000, 2000] })).toThrow(RangeError);
    expect(() => bad({ longEdgeSteps: [0, -1] })).toThrow(RangeError);
    expect(() => bad({ qualitySteps: [] })).toThrow(RangeError);
    expect(() => bad({ qualitySteps: [1.5, 0.5] })).toThrow(RangeError);
    expect(() => bad({ qualitySteps: [0.5, 0.9] })).toThrow(RangeError);
  });
});

describe("renameForOutputType", () => {
  test("the extension follows the bytes, not the original name", () => {
    expect(renameForOutputType("holiday.PNG", "image/webp")).toBe(
      "holiday.webp"
    );
    expect(renameForOutputType("photo.jpeg", "image/jpeg")).toBe("photo.jpg");
    expect(renameForOutputType("a.b.c.png", "image/webp")).toBe("a.b.c.webp");
  });

  test("a name with no extension, or only a dotfile, still gets a sane name", () => {
    expect(renameForOutputType("scan", "image/webp")).toBe("scan.webp");
    expect(renameForOutputType(".png", "image/webp")).toBe(".png.webp");
    expect(renameForOutputType("   ", "image/webp")).toBe("image.webp");
    expect(renameForOutputType("", "image/jpeg")).toBe("image.jpg");
  });
});

describe("formatByteSize", () => {
  test("binary units, since the cap is a power of two", () => {
    expect(formatByteSize(0, "en")).toBe("0 B");
    expect(formatByteSize(812, "en")).toBe("812 B");
    expect(formatByteSize(1024, "en")).toBe("1 KiB");
    expect(formatByteSize(640 * 1024, "en")).toBe("640 KiB");
    expect(formatByteSize(CAP, "en")).toBe("2 MiB");
    expect(formatByteSize(Math.round(1.6 * MIB), "en")).toBe("1.6 MiB");
    expect(formatByteSize(4_400_000, "en")).toBe("4.2 MiB");
  });

  test("the locale only changes the decimal separator", () => {
    expect(formatByteSize(Math.round(1.6 * MIB), "id")).toBe("1,6 MiB");
  });

  test("garbage input is zero rather than NaN on screen", () => {
    expect(formatByteSize(Number.NaN, "en")).toBe("0 B");
    expect(formatByteSize(-5, "en")).toBe("0 B");
  });
});

describe("fillMessage", () => {
  test("fills known placeholders and leaves unknown ones verbatim", () => {
    expect(
      fillMessage("From {original} to {final} ({other})", {
        original: "3 MiB",
        final: "1 MiB"
      })
    ).toBe("From 3 MiB to 1 MiB ({other})");
  });

  test("a value containing a brace pattern is not expanded again", () => {
    expect(fillMessage("{a} {b}", { a: "{b}", b: "x" })).toBe("{b} x");
  });
});

// ---- Header fixtures: tiny hand-built byte arrays, no binary files. ----

const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));
const be32 = (n: number): number[] => [
  (n >>> 24) & 255,
  (n >>> 16) & 255,
  (n >>> 8) & 255,
  n & 255
];
const le32 = (n: number): number[] => [
  n & 255,
  (n >>> 8) & 255,
  (n >>> 16) & 255,
  (n >>> 24) & 255
];
const le24 = (n: number): number[] => [
  n & 255,
  (n >>> 8) & 255,
  (n >>> 16) & 255
];

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngChunk(type: string, data: number[]): number[] {
  return [...be32(data.length), ...ascii(type), ...data, 0, 0, 0, 0];
}

function png(width: number, height: number, ...extra: number[][]): Uint8Array {
  const ihdr = [...be32(width), ...be32(height), 8, 6, 0, 0, 0];
  return new Uint8Array([
    ...PNG_SIG,
    ...pngChunk("IHDR", ihdr),
    ...extra.flat(),
    ...pngChunk("IDAT", [1, 2, 3])
  ]);
}

function jpeg(width: number, height: number, withApp = true): Uint8Array {
  const app = withApp ? [0xff, 0xe1, 0x00, 0x06, 1, 2, 3, 4] : [];
  const sof = [
    0xff,
    0xc0,
    0x00,
    0x11,
    8,
    (height >> 8) & 255,
    height & 255,
    (width >> 8) & 255,
    width & 255,
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1
  ];
  return new Uint8Array([0xff, 0xd8, ...app, ...sof, 0xff, 0xd9]);
}

function riff(...chunks: number[][]): Uint8Array {
  const body = [...ascii("WEBP"), ...chunks.flat()];
  return new Uint8Array([...ascii("RIFF"), ...le32(body.length), ...body]);
}

function webpChunk(fourcc: string, data: number[]): number[] {
  return [
    ...ascii(fourcc),
    ...le32(data.length),
    ...data,
    ...(data.length % 2 === 1 ? [0] : [])
  ];
}

function vp8x(width: number, height: number, flags: number): number[] {
  return webpChunk("VP8X", [
    flags,
    0,
    0,
    0,
    ...le24(width - 1),
    ...le24(height - 1)
  ]);
}

describe("sniffImageType", () => {
  test("recognises JPEG, PNG and WebP by magic bytes only", () => {
    expect(sniffImageType(jpeg(1, 1))).toBe("image/jpeg");
    expect(sniffImageType(png(1, 1))).toBe("image/png");
    expect(sniffImageType(riff(vp8x(1, 1, 0)))).toBe("image/webp");
  });

  test("GIF, SVG, RIFF-but-not-WEBP and empty bytes are not recognised", () => {
    expect(sniffImageType(new Uint8Array(ascii("GIF89a....")))).toBeNull();
    expect(sniffImageType(new Uint8Array(ascii("<svg xmlns=...>")))).toBeNull();
    expect(
      sniffImageType(
        new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVE")])
      )
    ).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });
});

describe("detectAnimation", () => {
  test("APNG: an acTL chunk before IDAT is animated", () => {
    const actl = pngChunk("acTL", [0, 0, 0, 2, 0, 0, 0, 0]);
    expect(detectAnimation(png(10, 10, actl), "image/png")).toBe(true);
  });

  test("a still PNG, and an acTL-looking chunk after IDAT, are not animated", () => {
    expect(detectAnimation(png(10, 10), "image/png")).toBe(false);
    const late = new Uint8Array([
      ...png(10, 10),
      ...pngChunk("acTL", [0, 0, 0, 2, 0, 0, 0, 0])
    ]);
    expect(detectAnimation(late, "image/png")).toBe(false);
  });

  test("animated WebP: the VP8X animation flag, or an ANIM chunk", () => {
    expect(detectAnimation(riff(vp8x(10, 10, 0x02)), "image/webp")).toBe(true);
    expect(
      detectAnimation(
        riff(vp8x(10, 10, 0), webpChunk("ANIM", [0, 0, 0, 0, 0, 0])),
        "image/webp"
      )
    ).toBe(true);
  });

  test("a still WebP (VP8X without the flag, or plain VP8L) is not animated", () => {
    expect(detectAnimation(riff(vp8x(10, 10, 0x10)), "image/webp")).toBe(false);
    expect(
      detectAnimation(riff(webpChunk("VP8L", [0x2f, 0, 0, 0, 0])), "image/webp")
    ).toBe(false);
  });

  test("JPEG and truncated input are never animated and never throw", () => {
    expect(detectAnimation(jpeg(10, 10), "image/jpeg")).toBe(false);
    expect(detectAnimation(new Uint8Array(PNG_SIG), "image/png")).toBe(false);
    expect(detectAnimation(new Uint8Array(ascii("RIFF")), "image/webp")).toBe(
      false
    );
  });
});

describe("readPixelDimensions", () => {
  test("PNG IHDR", () => {
    expect(readPixelDimensions(png(12000, 9000), "image/png")).toEqual({
      width: 12000,
      height: 9000
    });
  });

  test("JPEG SOF0 after an APP segment, and SOF2 (progressive)", () => {
    expect(readPixelDimensions(jpeg(4032, 3024), "image/jpeg")).toEqual({
      width: 4032,
      height: 3024
    });
    const progressive = jpeg(640, 480, false);
    progressive[3] = 0xc2;
    expect(readPixelDimensions(progressive, "image/jpeg")).toEqual({
      width: 640,
      height: 480
    });
  });

  test("JPEG: a DHT marker (C4) is not mistaken for a frame header", () => {
    const dht = [0xff, 0xc4, 0x00, 0x04, 0, 0];
    const bytes = new Uint8Array([
      0xff,
      0xd8,
      ...dht,
      ...jpeg(300, 200, false).slice(2)
    ]);
    expect(readPixelDimensions(bytes, "image/jpeg")).toEqual({
      width: 300,
      height: 200
    });
  });

  test("WebP VP8X, lossy VP8 and lossless VP8L", () => {
    expect(
      readPixelDimensions(riff(vp8x(20000, 9000, 0)), "image/webp")
    ).toEqual({
      width: 20000,
      height: 9000
    });

    const vp8 = webpChunk("VP8 ", [
      0,
      0,
      0,
      0x9d,
      0x01,
      0x2a,
      ...[1280 & 255, 1280 >> 8],
      ...[720 & 255, 720 >> 8]
    ]);
    expect(readPixelDimensions(riff(vp8), "image/webp")).toEqual({
      width: 1280,
      height: 720
    });

    const bits = (800 - 1) | ((600 - 1) << 14);
    const vp8l = webpChunk("VP8L", [
      0x2f,
      ...le32(bits >>> 0),
      0,
      0,
      0,
      0,
      0,
      0
    ]);
    expect(readPixelDimensions(riff(vp8l), "image/webp")).toEqual({
      width: 800,
      height: 600
    });
  });

  test("an unreadable or truncated header yields null, never a throw", () => {
    expect(
      readPixelDimensions(new Uint8Array(PNG_SIG), "image/png")
    ).toBeNull();
    expect(
      readPixelDimensions(new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg")
    ).toBeNull();
    expect(
      readPixelDimensions(
        new Uint8Array([0xff, 0xd8, 0x12, 0x34, 0, 0]),
        "image/jpeg"
      )
    ).toBeNull();
    expect(readPixelDimensions(riff(), "image/webp")).toBeNull();
  });
});
