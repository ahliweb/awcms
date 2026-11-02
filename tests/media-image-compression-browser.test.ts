/**
 * The browser adapter (Issue #1221), driven through its injected
 * `BrowserImageEnv` because `bun test` has no `createImageBitmap`, no canvas and
 * no DOM. What is under test is the adapter's own logic: the orientation
 * fallback, the encoder PROBE, treating a mislabelled blob as "cannot encode",
 * the transparency scan, surface reuse and bitmap release. The real browser
 * globals behind `defaultBrowserEnv()` are exercised by the Playwright spec
 * `tests/e2e/media-upload-compression.e2e.ts`, which cannot run here.
 */
import { describe, expect, test } from "bun:test";

import {
  createBrowserImagePorts,
  defaultBrowserEnv,
  hasTransparentPixel,
  probeEncodableTypes,
  type BitmapLike,
  type BrowserImageEnv,
  type CanvasSurface
} from "../src/lib/ui/media-image-compression-browser";

type Log = {
  decodeOptions: Array<{ imageOrientation?: "from-image" } | undefined>;
  surfaces: Array<{ width: number; height: number; draws: number }>;
  encodes: Array<{ mimeType: string; quality: number }>;
  closed: number;
};

function fakeEnv(
  options: {
    /** What `encode` answers for a type: a blob type, or `null`/`"throw"`. */
    encodeAs?: Record<string, string | null | "throw">;
    /** Types the "browser" really encodes; other types answer PNG. */
    realTypes?: string[];
    bitmap?: { width: number; height: number };
    rejectFromImage?: "type-error" | "decode-error" | null;
    pixels?: (width: number, height: number) => Uint8ClampedArray;
    noBitmap?: boolean;
    noSurface?: boolean;
    surfaceNull?: boolean;
  } = {}
): { env: BrowserImageEnv; log: Log } {
  const log: Log = { decodeOptions: [], surfaces: [], encodes: [], closed: 0 };
  const realTypes = options.realTypes ?? ["image/webp", "image/jpeg"];

  const bitmap: BitmapLike = {
    width: options.bitmap?.width ?? 4000,
    height: options.bitmap?.height ?? 3000,
    close() {
      log.closed += 1;
    }
  };

  const env: BrowserImageEnv = {
    createImageBitmap: options.noBitmap
      ? null
      : async (_source, decodeOptions) => {
          log.decodeOptions.push(decodeOptions);
          if (decodeOptions !== undefined) {
            if (options.rejectFromImage === "type-error") {
              throw new TypeError("invalid enum value");
            }
            if (options.rejectFromImage === "decode-error") {
              throw new DOMException("bad image", "InvalidStateError");
            }
          }
          return bitmap;
        },
    createSurface: options.noSurface
      ? null
      : (width, height) => {
          if (options.surfaceNull) return null;
          const record = { width, height, draws: 0 };
          log.surfaces.push(record);

          const surface: CanvasSurface = {
            draw() {
              record.draws += 1;
            },
            readPixels() {
              return (
                options.pixels?.(width, height) ??
                new Uint8ClampedArray(width * height * 4).fill(255)
              );
            },
            async encode(mimeType, quality) {
              log.encodes.push({ mimeType, quality });
              const answer = options.encodeAs?.[mimeType];
              if (answer === "throw") throw new Error("encode failed");
              if (answer === null) return null;
              const type =
                answer ??
                (realTypes.includes(mimeType) ? mimeType : "image/png");
              return new Blob([new Uint8Array(8)], { type });
            }
          };

          return surface;
        }
  };

  return { env, log };
}

describe("hasTransparentPixel", () => {
  test("false for fully opaque pixels, true at the first non-255 alpha", () => {
    expect(hasTransparentPixel(new Uint8ClampedArray(0))).toBe(false);
    expect(hasTransparentPixel(new Uint8ClampedArray(16).fill(255))).toBe(
      false
    );

    const rgba = new Uint8ClampedArray(16).fill(255);
    rgba[11] = 254; // alpha of the third pixel
    expect(hasTransparentPixel(rgba)).toBe(true);
  });

  test("looks only at the alpha byte, not at colour channels", () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 255, 0, 10, 0, 255]);
    expect(hasTransparentPixel(rgba)).toBe(false);
  });
});

describe("probeEncodableTypes", () => {
  test("reports exactly the types the canvas really produced", async () => {
    const { env } = fakeEnv({ realTypes: ["image/jpeg"] });
    expect(await probeEncodableTypes(env)).toEqual(["image/jpeg"]);
  });

  test("a browser that answers PNG for WebP (Safari) is not credited with WebP", async () => {
    const { env } = fakeEnv({ realTypes: ["image/jpeg"] });
    expect(await probeEncodableTypes(env)).not.toContain("image/webp");
  });

  test("an encode that throws is simply absent", async () => {
    const { env } = fakeEnv({ encodeAs: { "image/webp": "throw" } });
    expect(await probeEncodableTypes(env)).toEqual(["image/jpeg"]);
  });

  test("no canvas at all probes to an empty list", async () => {
    expect(await probeEncodableTypes(fakeEnv({ noSurface: true }).env)).toEqual(
      []
    );
    expect(
      await probeEncodableTypes(fakeEnv({ surfaceNull: true }).env)
    ).toEqual([]);
  });
});

describe("createBrowserImagePorts availability", () => {
  test("null without createImageBitmap, null without a canvas, null when nothing encodes", async () => {
    expect(
      await createBrowserImagePorts(fakeEnv({ noBitmap: true }).env)
    ).toBeNull();
    expect(
      await createBrowserImagePorts(fakeEnv({ noSurface: true }).env)
    ).toBeNull();
    expect(
      await createBrowserImagePorts(fakeEnv({ realTypes: [] }).env)
    ).toBeNull();
  });

  test("exposes the probed types", async () => {
    const ports = await createBrowserImagePorts(fakeEnv().env);
    expect(ports?.encodableTypes).toEqual(["image/webp", "image/jpeg"]);
  });

  test("defaultBrowserEnv under bun (no DOM) reports no capability instead of throwing", async () => {
    const env = defaultBrowserEnv();
    expect(env.createSurface).toBeNull();
    expect(await createBrowserImagePorts(env)).toBeNull();
  });
});

describe("decode", () => {
  test("asks for EXIF orientation, and reports the oriented bitmap's size", async () => {
    const { env, log } = fakeEnv({ bitmap: { width: 3000, height: 4000 } });
    const ports = await createBrowserImagePorts(env);
    const image = await ports!.decode(new Blob());

    expect(log.decodeOptions).toEqual([{ imageOrientation: "from-image" }]);
    expect([image.width, image.height]).toEqual([3000, 4000]);
  });

  test("an engine that rejects the option as an unknown enum is retried without it", async () => {
    const { env, log } = fakeEnv({ rejectFromImage: "type-error" });
    const ports = await createBrowserImagePorts(env);
    const image = await ports!.decode(new Blob());

    expect(log.decodeOptions).toEqual([
      { imageOrientation: "from-image" },
      undefined
    ]);
    expect(image.width).toBe(4000);
  });

  test("a genuine decode failure is NOT retried and reaches the caller", async () => {
    const { env, log } = fakeEnv({ rejectFromImage: "decode-error" });
    const ports = await createBrowserImagePorts(env);

    await expect(ports!.decode(new Blob())).rejects.toThrow();
    expect(log.decodeOptions).toHaveLength(1);
  });
});

describe("encode", () => {
  test("draws at the requested size and passes type and quality through", async () => {
    const { env, log } = fakeEnv();
    const ports = await createBrowserImagePorts(env);
    const image = await ports!.decode(new Blob());
    log.surfaces.length = 0;
    log.encodes.length = 0;

    const blob = await image.encode({
      width: 2560,
      height: 1920,
      quality: 0.85,
      mimeType: "image/webp"
    });

    expect(blob?.type).toBe("image/webp");
    expect(log.surfaces).toEqual([{ width: 2560, height: 1920, draws: 1 }]);
    expect(log.encodes).toEqual([{ mimeType: "image/webp", quality: 0.85 }]);
  });

  test("one surface is reused for the same size (two encodes, one draw), a new one for a new size", async () => {
    const { env, log } = fakeEnv();
    const ports = await createBrowserImagePorts(env);
    const image = await ports!.decode(new Blob());
    log.surfaces.length = 0;

    const base = { width: 2560, height: 1920, quality: 0.85 };
    await image.encode({ ...base, mimeType: "image/webp" });
    await image.encode({ ...base, mimeType: "image/jpeg" });
    await image.encode({ ...base, quality: 0.75, mimeType: "image/webp" });
    expect(log.surfaces).toEqual([{ width: 2560, height: 1920, draws: 1 }]);

    await image.encode({
      width: 1920,
      height: 1440,
      quality: 0.85,
      mimeType: "image/webp"
    });
    expect(log.surfaces).toHaveLength(2);
  });

  test("a blob of another type than asked is reported as null, never as a result", async () => {
    // The probe passes (WebP is real), then the canvas starts answering PNG.
    const options = { encodeAs: {} as Record<string, string | null | "throw"> };
    const { env } = fakeEnv(options);
    const ports = await createBrowserImagePorts(env);
    const image = await ports!.decode(new Blob());

    options.encodeAs["image/webp"] = "image/png";

    expect(
      await image.encode({
        width: 10,
        height: 10,
        quality: 0.5,
        mimeType: "image/webp"
      })
    ).toBeNull();
  });

  test("a canvas that cannot be created mid-run rejects instead of returning garbage", async () => {
    const options = { surfaceNull: false };
    const { env } = fakeEnv(options);
    const ports = await createBrowserImagePorts(env);
    const image = await ports!.decode(new Blob());

    options.surfaceNull = true;

    await expect(
      image.encode({
        width: 1,
        height: 1,
        quality: 0.5,
        mimeType: "image/webp"
      })
    ).rejects.toThrow();
  });

  test("dispose releases the bitmap", async () => {
    const { env, log } = fakeEnv();
    const ports = await createBrowserImagePorts(env);
    const image = await ports!.decode(new Blob());

    image.dispose();

    expect(log.closed).toBe(1);
  });
});

describe("hasAlpha", () => {
  test("scans a bounded-size probe, not the full-resolution bitmap", async () => {
    const { env, log } = fakeEnv({ bitmap: { width: 8000, height: 6000 } });
    const ports = await createBrowserImagePorts(env);
    const image = await ports!.decode(new Blob());
    log.surfaces.length = 0;

    await image.hasAlpha();

    // Long edge 1024: 8000x6000 -> 1024x768.
    expect(log.surfaces).toEqual([{ width: 1024, height: 768, draws: 1 }]);
  });

  test("a small bitmap is scanned at its own size, never enlarged", async () => {
    const { env, log } = fakeEnv({ bitmap: { width: 300, height: 200 } });
    const ports = await createBrowserImagePorts(env);
    const image = await ports!.decode(new Blob());
    log.surfaces.length = 0;

    await image.hasAlpha();

    expect(log.surfaces).toEqual([{ width: 300, height: 200, draws: 1 }]);
  });

  test("true when a pixel is not opaque, false when all are", async () => {
    const opaque = fakeEnv({ bitmap: { width: 10, height: 10 } });
    const opaquePorts = await createBrowserImagePorts(opaque.env);
    expect(await (await opaquePorts!.decode(new Blob())).hasAlpha()).toBe(
      false
    );

    const translucent = fakeEnv({
      bitmap: { width: 10, height: 10 },
      pixels: (width, height) => {
        const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
        rgba[3] = 0;
        return rgba;
      }
    });
    const translucentPorts = await createBrowserImagePorts(translucent.env);
    expect(await (await translucentPorts!.decode(new Blob())).hasAlpha()).toBe(
      true
    );
  });
});
