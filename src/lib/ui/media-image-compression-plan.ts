/**
 * The decision half of browser-side image compression (Issue #1221). PURE: no
 * DOM, no `Blob`, no canvas, no I/O. Everything in this file is a function from
 * numbers and strings to numbers and strings, so every branch is testable in
 * `bun test` without a browser (`tests/media-image-compression-plan.test.ts`).
 *
 * ## What it decides, and what it does not
 *
 * The media uploader accepts at most `NEWS_MEDIA_R2_MAX_UPLOAD_BYTES` per image
 * (default 2 MiB). A phone photo is 3-8 MB, so a hard refusal at the cap makes
 * the uploader useless for the most common input. The browser therefore
 * re-encodes an oversize image before it is sent. That work splits in two:
 *
 * 1. **This file** decides WHETHER to touch the file and, if so, the ordered
 *    list of attempts to try (output types, long-edge steps, quality steps).
 * 2. `media-image-compression.ts` runs that list through injected ports, and
 *    `media-image-compression-browser.ts` is the thin adapter that implements
 *    the ports with `createImageBitmap` + canvas. Only the adapter touches a
 *    browser API, and nothing in it makes a decision.
 *
 * None of this is a security control. The server enforces the cap on the
 * claimed `byteSize` when the session is created and on the real object size
 * at finalize, exactly as before, so a client that skips compression is simply
 * refused over the cap. What the client owes the server is only honesty: the
 * `byteSize` and `contentType` it claims must be those of the bytes it sends.
 *
 * ## The rules, each with the reason it is not the other way round
 *
 * - **Within the cap -> untouched.** Re-encoding is lossy; a file that already
 *   fits gains nothing from it. This also keeps EXIF for files uploaded as-is.
 * - **GIF is never re-encoded.** A canvas draws one frame, so re-encoding an
 *   animated GIF silently destroys the animation. A GIF over the cap is refused
 *   with its own message rather than flattened into a still the person did not
 *   ask for.
 * - **Animated WebP and APNG are refused too.** The same one-frame argument
 *   applies, but the claimed type does not reveal it, so the orchestrator
 *   detects it from the header bytes (`media-image-header.ts`) and refuses an
 *   over-cap animated file with `animated_over_cap`. Under the cap it is
 *   untouched like any other file.
 * - **Only JPEG, PNG and WebP are re-encoded.** Those are the raster types the
 *   server allow-list names that a canvas can reproduce faithfully. SVG is
 *   excluded by default on the server, and is not a bitmap to re-encode anyway.
 * - **The output is WebP, or JPEG, whichever is smaller.** WebP keeps alpha, so
 *   a transparent PNG logo stays transparent; JPEG cannot, so alpha input is
 *   WebP only. An opaque JPEG is tried as both and the smaller wins.
 * - **Never upscale.** A smaller picture cannot be made smaller by making it
 *   bigger; each long-edge step is clipped to the source's own long edge.
 * - **Edge steps, then quality steps, with a floor on both.** See
 *   `COMPRESSION_LIMITS`. Reaching the floor and still being over the cap is an
 *   explicit failure, never a silent upload of an oversize file.
 */

/** The raster types that may be re-encoded. GIF and SVG are deliberately absent. */
export const COMPRESSIBLE_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp"
] as const;

export type CompressibleImageType = (typeof COMPRESSIBLE_IMAGE_TYPES)[number];

/**
 * The shipped search space. Edge-major: the largest edge is tried at every
 * quality before the edge is stepped down, because pixels are what a reader
 * notices and quality below ~0.5 is where WebP/JPEG start to band visibly.
 *
 * - **`longEdgeSteps`** — 2560 px is plenty for a full-width hero on a 4K
 *   display; 1280 px is the floor, the smallest a photo stays usable as a
 *   content image. A source already smaller than a step is never enlarged.
 * - **`qualitySteps`** — 0.85 is visually transparent for photographs; 0.5 is
 *   the floor. Lowest practical size at the floor of both is a few hundred KB
 *   for a photograph, which is why reaching the floor still over 2 MiB is an
 *   error for a pathological input rather than a normal outcome.
 */
export const COMPRESSION_LIMITS = {
  longEdgeSteps: [2560, 1920, 1600, 1280],
  qualitySteps: [0.85, 0.75, 0.65, 0.55, 0.5]
} as const;

export type CompressionOptions = {
  /** Descending, positive. The last entry is the floor. */
  longEdgeSteps?: readonly number[];
  /** Descending, each in (0, 1]. The last entry is the floor. */
  qualitySteps?: readonly number[];
};

export type CompressionRefusalReason =
  /** A GIF over the cap: re-encoding would destroy its animation. */
  | "gif_over_cap"
  /** An animated WebP/APNG over the cap: a canvas keeps one frame, as for GIF. */
  | "animated_over_cap"
  /** Any other type over the cap that this module does not re-encode (SVG, unknown). */
  | "type_not_compressible"
  | "invalid_input";

export type CompressionDecision =
  | { action: "passthrough" }
  | { action: "compress" }
  | { action: "refuse"; reason: CompressionRefusalReason };

function normalizeType(mimeType: string): string {
  return mimeType.trim().toLowerCase();
}

/**
 * Whether to leave the file alone, re-encode it, or refuse it. Needs only the
 * claimed type and the byte size, so it runs before anything is decoded.
 */
export function decideCompression(
  file: { mimeType: string; byteSize: number },
  maxBytes: number
): CompressionDecision {
  if (
    !Number.isFinite(file.byteSize) ||
    file.byteSize < 0 ||
    !Number.isFinite(maxBytes) ||
    maxBytes <= 0
  ) {
    return { action: "refuse", reason: "invalid_input" };
  }

  // Exactly at the cap is within it: the server's check is `> max`.
  if (file.byteSize <= maxBytes) return { action: "passthrough" };

  const type = normalizeType(file.mimeType);

  if (type === "image/gif") {
    return { action: "refuse", reason: "gif_over_cap" };
  }

  if ((COMPRESSIBLE_IMAGE_TYPES as readonly string[]).includes(type)) {
    return { action: "compress" };
  }

  return { action: "refuse", reason: "type_not_compressible" };
}

export type CompressionAttempt = {
  /** Output pixel size. Never larger than the source in either dimension. */
  width: number;
  height: number;
  /** Encoder quality in (0, 1]. */
  quality: number;
};

export type CompressionPlanFailureReason =
  | "invalid_dimensions"
  /** The browser can encode none of the types this image may be written as. */
  | "no_encoder"
  /** The image has transparency and the browser cannot encode WebP. */
  | "alpha_needs_webp";

export type CompressionPlan =
  | {
      ok: true;
      /**
       * Output types to try at EVERY attempt, in preference order. More than one
       * means "encode each, keep the smaller".
       */
      outputTypes: string[];
      attempts: CompressionAttempt[];
    }
  | { ok: false; reason: CompressionPlanFailureReason };

/**
 * Which output types an image may be written as, given what the browser can
 * encode.
 *
 * - Transparency -> WebP only. JPEG would flatten the alpha onto black, which
 *   turns a transparent logo into a black box without telling anyone.
 * - Opaque JPEG source -> WebP and JPEG, smaller wins (the issue's rule).
 * - Opaque PNG/WebP source -> WebP; JPEG only as the fallback when the browser
 *   cannot encode WebP (Safari's `toBlob("image/webp")` silently answers PNG),
 *   because turning line art into JPEG is a worse default than WebP but better
 *   than refusing the upload.
 */
export function chooseOutputTypes(
  source: { mimeType: string; hasAlpha: boolean },
  encodableTypes: readonly string[]
):
  | { ok: true; outputTypes: string[] }
  | { ok: false; reason: "no_encoder" | "alpha_needs_webp" } {
  const canWebp = encodableTypes.includes("image/webp");
  const canJpeg = encodableTypes.includes("image/jpeg");

  if (source.hasAlpha) {
    return canWebp
      ? { ok: true, outputTypes: ["image/webp"] }
      : { ok: false, reason: "alpha_needs_webp" };
  }

  const isJpeg = normalizeType(source.mimeType) === "image/jpeg";
  const outputTypes: string[] = [];

  if (isJpeg) {
    if (canWebp) outputTypes.push("image/webp");
    if (canJpeg) outputTypes.push("image/jpeg");
  } else if (canWebp) {
    outputTypes.push("image/webp");
  } else if (canJpeg) {
    outputTypes.push("image/jpeg");
  }

  return outputTypes.length > 0
    ? { ok: true, outputTypes }
    : { ok: false, reason: "no_encoder" };
}

function isDescendingPositive(values: readonly number[]): boolean {
  if (values.length === 0) return false;

  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] as number;
    if (!Number.isFinite(value) || value <= 0) return false;
    if (i > 0 && value >= (values[i - 1] as number)) return false;
  }

  return true;
}

/**
 * The ordered attempts for one decoded image.
 *
 * Edge-major, quality-minor: for each long-edge step (largest first) every
 * quality step (highest first). The first attempt that lands within the cap
 * wins, so the order IS the preference: the least damage that fits.
 *
 * Each edge step is clipped to the source's own long edge, and consecutive
 * duplicates collapse. So a 1000 px source yields one edge group at 1000 px
 * (never upscaled, never repeated), and a 2000 px source yields 2000, 1920,
 * 1600, 1280. A source below the floor is therefore not shrunk further: the
 * floor is a lower bound on how far an image is scaled DOWN, not a size every
 * image must be reduced to.
 */
export function planCompressionAttempts(
  source: {
    mimeType: string;
    width: number;
    height: number;
    hasAlpha: boolean;
  },
  encodableTypes: readonly string[],
  options: CompressionOptions = {}
): CompressionPlan {
  const { width, height } = source;

  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return { ok: false, reason: "invalid_dimensions" };
  }

  const edgeSteps = options.longEdgeSteps ?? COMPRESSION_LIMITS.longEdgeSteps;
  const qualitySteps = options.qualitySteps ?? COMPRESSION_LIMITS.qualitySteps;

  // A malformed override must not become an infinite or empty plan.
  if (!isDescendingPositive(edgeSteps)) {
    throw new RangeError(
      "longEdgeSteps must be a non-empty, strictly descending list of positive numbers."
    );
  }
  if (!isDescendingPositive(qualitySteps) || qualitySteps.some((q) => q > 1)) {
    throw new RangeError(
      "qualitySteps must be a non-empty, strictly descending list of numbers in (0, 1]."
    );
  }

  const types = chooseOutputTypes(
    { mimeType: source.mimeType, hasAlpha: source.hasAlpha },
    encodableTypes
  );

  if (!types.ok) return { ok: false, reason: types.reason };

  const sourceLongEdge = Math.max(width, height);
  const edges: number[] = [];

  for (const step of edgeSteps) {
    // Never upscale: a step larger than the source collapses to the source.
    const edge = Math.min(Math.floor(step), sourceLongEdge);
    if (edges[edges.length - 1] !== edge) edges.push(edge);
  }

  const attempts: CompressionAttempt[] = [];

  for (const edge of edges) {
    const scale = edge / sourceLongEdge;
    // `edge === sourceLongEdge` keeps the exact source size; otherwise round,
    // with a 1 px minimum so an extreme aspect ratio never yields a 0-px side.
    const attemptWidth =
      edge === sourceLongEdge ? width : Math.max(1, Math.round(width * scale));
    const attemptHeight =
      edge === sourceLongEdge
        ? height
        : Math.max(1, Math.round(height * scale));

    for (const quality of qualitySteps) {
      attempts.push({ width: attemptWidth, height: attemptHeight, quality });
    }
  }

  return { ok: true, outputTypes: types.outputTypes, attempts };
}

/** File extension for an output type this module can produce. */
const EXTENSION_BY_TYPE: Readonly<Record<string, string>> = {
  "image/webp": "webp",
  "image/jpeg": "jpg"
};

/**
 * `holiday.png` re-encoded as WebP becomes `holiday.webp`. The server derives
 * the stored extension from the validated MIME type and ignores the name, but
 * the name is what the person sees and what a browser would save the file as,
 * so it must not claim a format the bytes are not.
 */
export function renameForOutputType(
  fileName: string,
  outputType: string
): string {
  const extension = EXTENSION_BY_TYPE[outputType];
  const trimmed = fileName.trim();
  const dot = trimmed.lastIndexOf(".");
  // A leading dot (`.hidden`) is a name, not an extension.
  const base = dot > 0 ? trimmed.slice(0, dot) : trimmed;
  const safeBase = base.length > 0 ? base : "image";

  return extension === undefined ? safeBase : `${safeBase}.${extension}`;
}

/**
 * `1.6 MiB`, `640 KiB`, `812 B`. Binary units because the cap is a power of two
 * (2 MiB = 2,097,152) and a person comparing "2 MB" with a 2,000,000-byte file
 * would be told two different things. `locale` only chooses the decimal
 * separator; the unit symbols are the same everywhere.
 */
export function formatByteSize(bytes: number, locale?: string): string {
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;

  const format = (value: number, fractionDigits: number): string =>
    new Intl.NumberFormat(locale, {
      maximumFractionDigits: fractionDigits
    }).format(value);

  if (safe >= 1024 * 1024) return `${format(safe / (1024 * 1024), 1)} MiB`;
  if (safe >= 1024) return `${format(safe / 1024, 0)} KiB`;

  return `${format(safe, 0)} B`;
}

/**
 * Fills `{name}` placeholders. A placeholder with no value is left verbatim,
 * the same rule as the server-side `t()`, which is what lets the server render
 * a message with some values filled (`{cap}`) and hand the rest (`{original}`,
 * `{final}`) to the browser.
 */
export function fillMessage(
  template: string,
  values: Readonly<Record<string, string>>
): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key)
      ? (values[key] as string)
      : whole
  );
}
