/**
 * Runs a compression plan (Issue #1221). The orchestration between the pure
 * planner (`media-image-compression-plan.ts`) and the browser adapter
 * (`media-image-compression-browser.ts`): what is decoded once, which attempt
 * runs when, what "smaller of two encodes" means, and which failure is reported
 * when. It touches no browser API itself, only the injected
 * {@link ImageCompressionPorts}, so it is driven in a plain unit test with a
 * fake codec (`tests/media-image-compression.test.ts`).
 *
 * ## Failure is explicit, never a silent oversize upload
 *
 * Every way this can fall short returns a named `{ ok: false, reason }`. There
 * is no path that hands back the ORIGINAL oversize bytes: a caller that gets an
 * `ok: true` result gets either the untouched file (which was within the cap)
 * or a re-encoded blob that is within the cap: the only `changed: true` return
 * is guarded by `best.blob.size <= maxBytes`, and the upload client re-checks
 * the byte length it is about to send before it creates a session.
 */
import {
  decideCompression,
  planCompressionAttempts,
  renameForOutputType,
  type CompressionAttempt,
  type CompressionOptions,
  type CompressionRefusalReason
} from "./media-image-compression-plan";
import {
  detectAnimation,
  HEADER_SCAN_BYTES,
  readPixelDimensions,
  sniffImageType
} from "./media-image-header";

/**
 * Above this many source pixels the image is refused rather than decoded. A
 * decoded bitmap is 4 bytes per pixel: 100 MP is ~400 MB of RAM, which a phone
 * tab does not survive, and an OOM looks to the person like a frozen page.
 */
export const MAX_SOURCE_PIXELS = 100_000_000;

export type DecodedImage = {
  /** Pixel size AFTER EXIF orientation was applied. */
  width: number;
  height: number;
  /** Whether any pixel is not fully opaque. Only asked for PNG/WebP sources. */
  hasAlpha(): Promise<boolean>;
  /**
   * Re-encodes at the requested size and quality. Resolves `null` when the
   * browser could not produce `mimeType` (some answer a different type than the
   * one asked for; the adapter reports that as `null`, never as a mislabelled
   * blob).
   */
  encode(
    request: CompressionAttempt & { mimeType: string }
  ): Promise<Blob | null>;
  /** Releases the decoded bitmap. Always called, success or not. */
  dispose(): void;
};

export type ImageCompressionPorts = {
  /** The output types this browser can really encode (feature-detected once). */
  encodableTypes: readonly string[];
  /** Decodes with EXIF orientation applied. Rejects when the file is not a decodable image. */
  decode(source: Blob): Promise<DecodedImage>;
};

export type CompressionFailureReason =
  | CompressionRefusalReason
  /** The browser lacks `createImageBitmap` or a canvas encoder entirely. */
  | "unsupported_browser"
  | "decode_failed"
  | "source_too_large"
  | "invalid_dimensions"
  | "no_encoder"
  | "alpha_needs_webp"
  /** Every attempt down to the floor was still over the cap. */
  | "floor_reached";

export type CompressionResult =
  | {
      ok: true;
      /** `false`: the file was already within the cap and is returned as chosen. */
      changed: false;
      name: string;
      mimeType: string;
      byteSize: number;
    }
  | {
      ok: true;
      changed: true;
      name: string;
      mimeType: string;
      byteSize: number;
      blob: Blob;
      width: number;
      height: number;
      originalByteSize: number;
      /** Attempts run, including the one that fit. */
      attemptsUsed: number;
    }
  | {
      ok: false;
      reason: CompressionFailureReason;
      maxBytes: number;
      originalByteSize: number;
      /** The smallest size reached; only set for `floor_reached`. */
      smallestByteSize?: number;
    };

export type CompressImageInput = {
  name: string;
  /** The type the browser reported for the file (never trusted by the server). */
  type: string;
  size: number;
  blob: Blob;
};

function fail(
  reason: CompressionFailureReason,
  input: CompressImageInput,
  maxBytes: number,
  extra: { smallestByteSize?: number } = {}
): CompressionResult {
  return {
    ok: false,
    reason,
    maxBytes,
    originalByteSize: input.size,
    ...extra
  };
}

export type CompressImageHooks = {
  /**
   * Builds the browser ports. Called ONLY when a re-encode is actually needed,
   * so a within-cap file never probes the browser. Resolves `null` where the
   * browser has no `createImageBitmap`/canvas encode.
   */
  loadPorts: () => Promise<ImageCompressionPorts | null>;
  /** Called once, just before decoding starts, so the UI can say "compressing". */
  onCompressing?: () => void;
  /** Overrides the planner's shipped steps (tests; never set in production). */
  planOptions?: CompressionOptions;
};

/**
 * Brings one file within `maxBytes`, or says plainly why it cannot.
 *
 * A within-cap file is returned unchanged without ever calling `loadPorts`, so
 * an old browser can still upload a small image.
 */
export async function compressImageForUpload(
  input: CompressImageInput,
  maxBytes: number,
  hooks: CompressImageHooks
): Promise<CompressionResult> {
  const decision = decideCompression(
    { mimeType: input.type, byteSize: input.size },
    maxBytes
  );

  if (decision.action === "refuse") {
    return fail(decision.reason, input, maxBytes);
  }

  if (decision.action === "passthrough") {
    return {
      ok: true,
      changed: false,
      name: input.name,
      mimeType: input.type,
      byteSize: input.size
    };
  }

  // The claimed type is never trusted for a decision: the magic bytes are. A
  // read failure is an empty header, which sniffs as "not compressible".
  let header: Uint8Array;
  try {
    header = new Uint8Array(
      await input.blob.slice(0, HEADER_SCAN_BYTES).arrayBuffer()
    );
  } catch {
    header = new Uint8Array(0);
  }

  const sniffed = sniffImageType(header);

  if (sniffed === null) return fail("type_not_compressible", input, maxBytes);

  // A canvas keeps one frame, exactly as for GIF: refuse rather than flatten.
  if (detectAnimation(header, sniffed)) {
    return fail("animated_over_cap", input, maxBytes);
  }

  // Refuse on the header's own size BEFORE decode allocates the bitmap. An
  // unreadable header falls through; the post-decode check below is the backstop.
  const headerSize = readPixelDimensions(header, sniffed);

  if (
    headerSize !== null &&
    headerSize.width * headerSize.height > MAX_SOURCE_PIXELS
  ) {
    return fail("source_too_large", input, maxBytes);
  }

  hooks.onCompressing?.();

  let ports: ImageCompressionPorts | null;
  try {
    ports = await hooks.loadPorts();
  } catch {
    ports = null;
  }

  if (ports === null) return fail("unsupported_browser", input, maxBytes);

  let decoded: DecodedImage;
  try {
    decoded = await ports.decode(input.blob);
  } catch {
    return fail("decode_failed", input, maxBytes);
  }

  try {
    if (decoded.width * decoded.height > MAX_SOURCE_PIXELS) {
      return fail("source_too_large", input, maxBytes);
    }

    // Only PNG and WebP can carry transparency; a JPEG never does, so the
    // pixel scan is skipped for it. The SNIFFED type decides, not the claimed
    // one: a PNG labelled image/jpeg must still be scanned. When the scan itself cannot run, assume
    // transparency: the cost of a wrong "yes" is WebP-only output, the cost of
    // a wrong "no" is a transparent logo flattened onto black.
    let hasAlpha = false;
    if (sniffed !== "image/jpeg") {
      try {
        hasAlpha = await decoded.hasAlpha();
      } catch {
        hasAlpha = true;
      }
    }

    const plan = planCompressionAttempts(
      {
        mimeType: sniffed,
        width: decoded.width,
        height: decoded.height,
        hasAlpha
      },
      ports.encodableTypes,
      hooks.planOptions
    );

    if (!plan.ok) return fail(plan.reason, input, maxBytes);

    // A type the browser claimed it could encode but did not, mid-run, is
    // dropped for the remaining attempts rather than retried at every step.
    const usable = new Set(plan.outputTypes);
    let smallest = Number.POSITIVE_INFINITY;
    let attemptsUsed = 0;

    for (const attempt of plan.attempts) {
      attemptsUsed += 1;

      let best: { blob: Blob; mimeType: string } | null = null;

      for (const mimeType of plan.outputTypes) {
        if (!usable.has(mimeType)) continue;

        let blob: Blob | null;
        try {
          blob = await decoded.encode({ ...attempt, mimeType });
        } catch {
          blob = null;
        }

        // A mislabelled or empty blob is not a result: uploading it would claim
        // a type the bytes are not, or an empty file.
        if (blob === null || blob.type !== mimeType || blob.size === 0) {
          usable.delete(mimeType);
          continue;
        }

        if (blob.size < smallest) smallest = blob.size;

        if (best === null || blob.size < best.blob.size) {
          best = { blob, mimeType };
        }
      }

      if (usable.size === 0) return fail("no_encoder", input, maxBytes);

      if (best !== null && best.blob.size <= maxBytes) {
        return {
          ok: true,
          changed: true,
          name: renameForOutputType(input.name, best.mimeType),
          mimeType: best.mimeType,
          byteSize: best.blob.size,
          blob: best.blob,
          width: attempt.width,
          height: attempt.height,
          originalByteSize: input.size,
          attemptsUsed
        };
      }
    }

    return fail("floor_reached", input, maxBytes, {
      smallestByteSize: Number.isFinite(smallest) ? smallest : undefined
    });
  } finally {
    decoded.dispose();
  }
}
