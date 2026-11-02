/**
 * The browser half of image compression (Issue #1221): the thin adapter that
 * implements {@link ImageCompressionPorts} with `createImageBitmap` and a
 * canvas. Everything in here touches a browser API and nothing in it decides
 * anything; the decisions are in `media-image-compression-plan.ts` and the
 * orchestration is in `media-image-compression.ts`.
 *
 * ## Why the browser surface is injected
 *
 * `bun test` has no `createImageBitmap`, no `OffscreenCanvas` and no
 * `document`. {@link BrowserImageEnv} is the narrow seam those four calls go
 * through, so the adapter's own logic (orientation fallback, encoder probe,
 * mislabelled-blob detection, alpha scan) runs against a fake in
 * `tests/media-image-compression-browser.test.ts`. {@link defaultBrowserEnv} is
 * the only part that names a real browser global, and the only part a unit test
 * cannot reach; the Playwright spec `media-upload-compression.e2e.ts` is what
 * exercises it.
 *
 * ## What it relies on, and what it does when that is missing
 *
 * - `createImageBitmap(blob, { imageOrientation: "from-image" })` decodes with
 *   the EXIF orientation applied, so a portrait phone photo is not uploaded
 *   sideways. A browser that rejects the option as an unknown enum value
 *   (`TypeError`) is retried without it; every browser old enough to do that
 *   already applies orientation by default.
 * - A canvas that can encode. Where there is neither `OffscreenCanvas` nor
 *   `document.createElement("canvas")`, or no `createImageBitmap`,
 *   {@link createBrowserImagePorts} answers `null` and the caller reports
 *   `unsupported_browser`. It never falls back to sending the original.
 * - WebP/JPEG encode support is PROBED, not assumed: some browsers answer a
 *   `toBlob("image/webp")` with a PNG and say nothing. A blob whose `type` is
 *   not the type asked for is treated as "cannot encode that type".
 *
 * ## EXIF
 *
 * Drawing to a canvas and encoding it writes a fresh file with no metadata, so
 * a re-encoded image carries no EXIF and no GPS position. That is intended and
 * documented. A file within the cap is uploaded unchanged and keeps its
 * metadata.
 */
import type {
  DecodedImage,
  ImageCompressionPorts
} from "./media-image-compression";

/** A decoded, oriented image as far as this adapter cares. */
export type BitmapLike = {
  width: number;
  height: number;
  close?: () => void;
};

/** One canvas of a fixed size that a bitmap can be drawn onto and encoded from. */
export type CanvasSurface = {
  /** Draws the whole bitmap scaled to the surface's size. */
  draw(bitmap: BitmapLike): void;
  /** RGBA bytes of the whole surface, 4 per pixel. */
  readPixels(): Uint8ClampedArray;
  /** Resolves `null` on failure; may resolve a blob of a type other than asked. */
  encode(mimeType: string, quality: number): Promise<Blob | null>;
};

export type BrowserImageEnv = {
  createImageBitmap:
    | ((
        source: Blob,
        options?: { imageOrientation?: "from-image" }
      ) => Promise<BitmapLike>)
    | null;
  /** `null` when this browser has no canvas it can create. */
  createSurface:
    ((width: number, height: number) => CanvasSurface | null) | null;
};

/** Long edge of the throw-away surface used to look for transparency. */
const ALPHA_PROBE_LONG_EDGE = 1024;

/** The types this module ever asks a canvas to produce. */
const PROBED_OUTPUT_TYPES = ["image/webp", "image/jpeg"] as const;

/**
 * Whether any pixel is not fully opaque.
 *
 * Walks the alpha byte of every RGBA pixel and stops at the first one below
 * 255. Pure, so it is tested directly.
 */
export function hasTransparentPixel(rgba: Uint8ClampedArray): boolean {
  for (let index = 3; index < rgba.length; index += 4) {
    if ((rgba[index] as number) < 255) return true;
  }

  return false;
}

async function decodeOriented(
  env: BrowserImageEnv,
  source: Blob
): Promise<BitmapLike> {
  const create = env.createImageBitmap;
  if (create === null) throw new TypeError("createImageBitmap is unavailable");

  try {
    return await create(source, { imageOrientation: "from-image" });
  } catch (error) {
    // An engine that predates the "from-image" value rejects the dictionary
    // with a TypeError. A decode failure is NOT a TypeError, so it is not
    // retried, and a genuinely broken file fails once.
    if (error instanceof TypeError) return create(source);
    throw error;
  }
}

/**
 * Which of WebP and JPEG this browser genuinely encodes, found by encoding a
 * 1x1 canvas and reading the type back.
 */
export async function probeEncodableTypes(
  env: BrowserImageEnv
): Promise<string[]> {
  const surface = env.createSurface?.(1, 1) ?? null;
  if (surface === null) return [];

  const supported: string[] = [];

  for (const mimeType of PROBED_OUTPUT_TYPES) {
    try {
      const blob = await surface.encode(mimeType, 0.8);
      if (blob !== null && blob.type === mimeType && blob.size > 0) {
        supported.push(mimeType);
      }
    } catch {
      // Not supported; simply absent from the list.
    }
  }

  return supported;
}

/**
 * Builds the ports for this browser, or `null` when it cannot compress at all
 * (no `createImageBitmap`, no canvas, or no encodable output type).
 */
export async function createBrowserImagePorts(
  env: BrowserImageEnv = defaultBrowserEnv()
): Promise<ImageCompressionPorts | null> {
  if (env.createImageBitmap === null || env.createSurface === null) {
    return null;
  }

  const encodableTypes = await probeEncodableTypes(env);
  if (encodableTypes.length === 0) return null;

  return {
    encodableTypes,

    async decode(source: Blob): Promise<DecodedImage> {
      const bitmap = await decodeOriented(env, source);
      const createSurface = env.createSurface as NonNullable<
        BrowserImageEnv["createSurface"]
      >;

      // One surface is reused while consecutive attempts share a size, so the
      // two encodes of an opaque JPEG at one step draw the bitmap once.
      let cached: {
        width: number;
        height: number;
        surface: CanvasSurface;
      } | null = null;

      const surfaceFor = (width: number, height: number): CanvasSurface => {
        if (
          cached !== null &&
          cached.width === width &&
          cached.height === height
        ) {
          return cached.surface;
        }

        const surface = createSurface(width, height);
        if (surface === null) throw new Error("canvas unavailable");
        surface.draw(bitmap);
        cached = { width, height, surface };

        return surface;
      };

      return {
        width: bitmap.width,
        height: bitmap.height,

        async hasAlpha(): Promise<boolean> {
          const longEdge = Math.max(bitmap.width, bitmap.height);
          const scale = Math.min(1, ALPHA_PROBE_LONG_EDGE / longEdge);
          const probe = createSurface(
            Math.max(1, Math.round(bitmap.width * scale)),
            Math.max(1, Math.round(bitmap.height * scale))
          );
          if (probe === null) throw new Error("canvas unavailable");
          probe.draw(bitmap);

          return hasTransparentPixel(probe.readPixels());
        },

        async encode(request): Promise<Blob | null> {
          const surface = surfaceFor(request.width, request.height);
          const blob = await surface.encode(request.mimeType, request.quality);

          // A browser that cannot write the asked type often answers PNG. A
          // blob of another type is "cannot encode", never a result.
          return blob !== null && blob.type === request.mimeType ? blob : null;
        },

        dispose(): void {
          cached = null;
          bitmap.close?.();
        }
      };
    }
  };
}

/**
 * The real browser environment. Prefers `OffscreenCanvas` (no DOM node, usable
 * off the main thread later) and falls back to a detached `<canvas>` element.
 *
 * No `URL.createObjectURL` and no `<img>`: the page's CSP has no `blob:` in
 * `img-src`, and none is needed because `createImageBitmap` takes the `File`
 * directly.
 */
export function defaultBrowserEnv(): BrowserImageEnv {
  const globals = globalThis as unknown as {
    createImageBitmap?: NonNullable<BrowserImageEnv["createImageBitmap"]>;
    OffscreenCanvas?: new (
      width: number,
      height: number
    ) => {
      getContext(kind: "2d"): CanvasRenderingContext2D | null;
      convertToBlob(options: { type: string; quality: number }): Promise<Blob>;
    };
    document?: Document;
  };

  const createImageBitmapFn =
    typeof globals.createImageBitmap === "function"
      ? (source: Blob, options?: { imageOrientation?: "from-image" }) =>
          (
            globals.createImageBitmap as NonNullable<
              BrowserImageEnv["createImageBitmap"]
            >
          )(source, options)
      : null;

  const hasOffscreen = typeof globals.OffscreenCanvas === "function";
  const hasDocument =
    typeof globals.document !== "undefined" &&
    typeof globals.document.createElement === "function";

  if (!hasOffscreen && !hasDocument) {
    return { createImageBitmap: createImageBitmapFn, createSurface: null };
  }

  const createSurface = (
    width: number,
    height: number
  ): CanvasSurface | null => {
    if (hasOffscreen) {
      const Offscreen = globals.OffscreenCanvas as NonNullable<
        typeof globals.OffscreenCanvas
      >;
      const canvas = new Offscreen(width, height);
      const context = canvas.getContext("2d");
      if (context === null) return null;
      context.imageSmoothingQuality = "high";

      return {
        draw: (bitmap) =>
          context.drawImage(
            bitmap as unknown as CanvasImageSource,
            0,
            0,
            width,
            height
          ),
        readPixels: () => context.getImageData(0, 0, width, height).data,
        encode: (mimeType, quality) =>
          canvas.convertToBlob({ type: mimeType, quality })
      };
    }

    const canvas = (globals.document as Document).createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) return null;
    context.imageSmoothingQuality = "high";

    return {
      draw: (bitmap) =>
        context.drawImage(
          bitmap as unknown as CanvasImageSource,
          0,
          0,
          width,
          height
        ),
      readPixels: () => context.getImageData(0, 0, width, height).data,
      encode: (mimeType, quality) =>
        new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality))
    };
  };

  return { createImageBitmap: createImageBitmapFn, createSurface };
}
