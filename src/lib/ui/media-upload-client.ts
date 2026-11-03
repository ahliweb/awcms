/**
 * The browser half of the direct-to-R2 upload (Issue #595).
 *
 * `media_library` has had the server half for months — presigned session,
 * magic-byte MIME sniff over the real bytes, server-side SHA-256 verification,
 * authoritative post-TOCTOU size check. What was missing is the only part a
 * journalist can actually use: a file picker that drives it.
 *
 * ## The three steps, and why the middle one is not `fetch`
 *
 * 1. `POST /api/v1/media/news-images/upload-sessions` — shape only, no bytes
 *    exist yet. Returns a presigned `PUT` URL scoped to one object key.
 * 2. `PUT` the bytes straight to R2. **`XMLHttpRequest`, not `fetch`**, for one
 *    reason: `fetch` reports no upload progress. A newsroom photo on a regional
 *    connection is tens of seconds of silence otherwise, and silence is
 *    indistinguishable from a hang — people retry, and every retry is another
 *    orphan object.
 * 3. `POST .../finalize` — the server verifies what actually landed.
 *
 * That `PUT` is cross-origin, which is why it needs `connect-src` to name R2's
 * S3 endpoint. Until that directive existed this whole flow was unreachable
 * from a browser (see `src/lib/security/security-headers.ts`).
 *
 * ## Every failure path cancels the session
 *
 * A created session is a `pending_upload` row. Abandoning one leaves a row the
 * orphan-reconcile job has to clean up later, so a failure at step 2 or 3
 * cancels explicitly rather than walking away. Cancellation is best-effort: if
 * it also fails, the original error is what the operator is told, because the
 * cancel failure is not the thing they can act on.
 *
 * ## The checksum is optional ON PURPOSE
 *
 * `crypto.subtle` is unavailable outside a secure context, and the LAN/offline
 * deployment profile is a supported one that may be served over plain HTTP.
 * `validateFinalizeNewsMediaUploadSessionInput` already treats
 * `checksumSha256` as optional, so this sends one when it can and omits it when
 * it cannot — rather than failing an upload on a deployment shape the project
 * explicitly supports. The server verifies the bytes it received either way;
 * the client checksum is corroboration, not the guarantee.
 *
 * ## Compression happens BEFORE step 1 (Issue #1221)
 *
 * `uploadMediaFile` re-encodes an oversize JPEG/PNG/WebP in the browser first,
 * then hands the result to `uploadMediaBytes`, which derives `byteSize` from
 * the buffer and `mimeType` from the type it is given. So the size and type the
 * session claims are those of the bytes that are actually sent, by
 * construction rather than by a second copy of the numbers. The server is
 * untouched and still the source of truth: it checks the claimed `byteSize` at
 * session creation and the real object at finalize. A file that cannot be
 * brought within the cap is refused here with a named reason; nothing oversize
 * is ever sent "in case the server allows it".
 *
 * ## Why the dependencies are injected
 *
 * The orchestration here — what cancels when, what the operator is told, which
 * error wins when two things fail — is the part worth testing, and it is the
 * part a browser test would be slowest at. The transport is passed in so the
 * sequence can be driven in a plain unit test.
 */

import {
  compressImageForUpload,
  type CompressionFailureReason,
  type ImageCompressionPorts
} from "./media-image-compression";
import {
  fillMessage,
  formatByteSize,
  formatByteSizeAgainstCap
} from "./media-image-compression-plan";

export type UploadSessionData = {
  objectId: string;
  objectKey: string;
  presignedUrl: string;
  expiresAt: string;
};

export type UploadOutcome =
  | { ok: true; objectId: string }
  | { ok: false; step: UploadStep; errorCode: string };

/** Which step failed — the operator's next move differs per step. */
export type UploadStep = "session" | "transfer" | "finalize";

export type UploadProgress = {
  /** Bytes transferred so far. */
  loaded: number;
  /** Total bytes, or `null` when the browser cannot report it. */
  total: number | null;
};

export type UploadTransport = {
  createSession(input: {
    fileName: string;
    mimeType: string;
    byteSize: number;
  }): Promise<{
    ok: boolean;
    data: UploadSessionData | null;
    errorCode: string | null;
  }>;
  putBytes(input: {
    url: string;
    bytes: ArrayBuffer;
    contentType: string;
    onProgress: (progress: UploadProgress) => void;
  }): Promise<{ ok: boolean; errorCode: string | null }>;
  finalize(input: {
    objectId: string;
    checksumSha256: string | null;
  }): Promise<{ ok: boolean; errorCode: string | null }>;
  cancel(objectId: string): Promise<void>;
  /** Returns a lowercase hex SHA-256, or `null` where `crypto.subtle` is absent. */
  digest(bytes: ArrayBuffer): Promise<string | null>;
};

/**
 * Runs the three-step upload for one already-read file.
 *
 * Takes the bytes rather than the `File` so the caller reads once and the same
 * buffer is both hashed and uploaded — reading twice on a large image is
 * wasted work, and worse, lets the two reads disagree if the file changes on
 * disk between them.
 */
export async function uploadMediaBytes(
  file: { name: string; type: string; bytes: ArrayBuffer },
  transport: UploadTransport,
  onProgress: (progress: UploadProgress) => void = () => {}
): Promise<UploadOutcome> {
  const byteSize = file.bytes.byteLength;

  const session = await transport.createSession({
    fileName: file.name,
    mimeType: file.type,
    byteSize
  });

  if (!session.ok || session.data === null) {
    return {
      ok: false,
      step: "session",
      errorCode: session.errorCode ?? "UNKNOWN"
    };
  }

  const { objectId, presignedUrl } = session.data;

  const transfer = await transport.putBytes({
    url: presignedUrl,
    bytes: file.bytes,
    contentType: file.type,
    onProgress
  });

  if (!transfer.ok) {
    await cancelQuietly(transport, objectId);
    return {
      ok: false,
      step: "transfer",
      errorCode: transfer.errorCode ?? "UNKNOWN"
    };
  }

  // A digest failure must not fail the upload: the checksum is optional and the
  // server verifies the bytes regardless. Treated exactly like "not available".
  let checksumSha256: string | null = null;
  try {
    checksumSha256 = await transport.digest(file.bytes);
  } catch {
    checksumSha256 = null;
  }

  const finalized = await transport.finalize({ objectId, checksumSha256 });

  if (!finalized.ok) {
    await cancelQuietly(transport, objectId);
    return {
      ok: false,
      step: "finalize",
      errorCode: finalized.errorCode ?? "UNKNOWN"
    };
  }

  return { ok: true, objectId };
}

/**
 * Cancels without letting a cancel failure replace the real error.
 *
 * The operator can act on "the upload failed"; they cannot act on "and the
 * cleanup call also failed", and surfacing the second would hide the first.
 * The orphan-reconcile job is the backstop for the row either way.
 */
async function cancelQuietly(
  transport: UploadTransport,
  objectId: string
): Promise<void> {
  try {
    await transport.cancel(objectId);
  } catch {
    // Deliberately swallowed — see above.
  }
}

/**
 * Human-facing message per failure step and error code.
 *
 * Kept here rather than at the call site so the mapping is testable, and so
 * the message names what the person can DO. `PROVIDER_ERROR` on session
 * creation means the deployment has no R2 configured, which is an operator
 * problem, not something the journalist can retry their way out of.
 */
export function describeUploadFailure(outcome: {
  step: UploadStep;
  errorCode: string;
}): string {
  if (outcome.step === "session") {
    if (outcome.errorCode === "PROVIDER_ERROR") {
      return "Media storage is not configured for this deployment, so uploads cannot be accepted. This needs an administrator, not a retry.";
    }
    if (outcome.errorCode === "VALIDATION_ERROR") {
      return "This file was refused before it was sent: check that it is a supported image type and within the size limit.";
    }
    if (outcome.errorCode === "FORBIDDEN") {
      return "You do not have permission to upload media in this tenant.";
    }
    return "Could not start the upload. Nothing was sent.";
  }

  if (outcome.step === "transfer") {
    return "The file could not be sent to storage. The upload was cancelled, so nothing is left half-written — try again.";
  }

  if (outcome.errorCode === "VALIDATION_ERROR") {
    return "Storage received the file but the server refused it — the bytes did not match what was declared (type, size or checksum). The upload was cancelled.";
  }

  return "The file reached storage but could not be registered, so the upload was cancelled. Try again.";
}

/** Formats a progress reading for display; `null` total means indeterminate. */
export function formatProgress(progress: UploadProgress): string {
  if (progress.total === null || progress.total === 0) {
    return `${Math.round(progress.loaded / 1024)} kB sent`;
  }

  const percent = Math.min(
    100,
    Math.round((progress.loaded / progress.total) * 100)
  );

  return `${percent}%`;
}

/** What the browser hands over for a chosen file (a `File` satisfies this). */
export type ChosenImageFile = Blob & { name: string };

/** How a file was changed on its way to the session. `null` when it was not. */
export type CompressionSummary = {
  originalByteSize: number;
  byteSize: number;
  mimeType: string;
  name: string;
  width: number;
  height: number;
};

export type UploadMediaFileOutcome =
  | { ok: true; objectId: string; compression: CompressionSummary | null }
  | { ok: false; step: UploadStep; errorCode: string }
  | {
      ok: false;
      step: "compress";
      reason: CompressionFailureReason;
      maxBytes: number;
      originalByteSize: number;
      smallestByteSize: number | null;
    };

export type UploadMediaFileDeps = {
  transport: UploadTransport;
  /**
   * The cap the server enforces. `null` means the page could not tell, in which
   * case the file is sent as chosen and the SERVER decides (it refuses over its
   * cap) rather than this client guessing one.
   */
  maxBytes: number | null;
  /** Builds the browser ports lazily; see `createBrowserImagePorts`. */
  loadPorts: () => Promise<ImageCompressionPorts | null>;
  onCompressing?: () => void;
  /** Called once the compressed bytes are ready, before anything is sent. */
  onCompressed?: (summary: CompressionSummary) => void;
  onProgress?: (progress: UploadProgress) => void;
};

/**
 * Brings the chosen file within the cap if it needs it, then uploads it.
 *
 * The one rule this function exists to hold: the size and type claimed to the
 * server are those of the bytes sent. `uploadMediaBytes` reads both off the
 * buffer and type it is given, and this function gives it the COMPRESSED buffer
 * and the COMPRESSED type, never the original's.
 */
export async function uploadMediaFile(
  file: ChosenImageFile,
  deps: UploadMediaFileDeps
): Promise<UploadMediaFileOutcome> {
  const { maxBytes } = deps;

  let upload: { name: string; type: string; bytes: ArrayBuffer };
  let compression: CompressionSummary | null = null;

  if (maxBytes === null) {
    upload = {
      name: file.name,
      type: file.type,
      bytes: await file.arrayBuffer()
    };
  } else {
    const result = await compressImageForUpload(
      { name: file.name, type: file.type, size: file.size, blob: file },
      maxBytes,
      { loadPorts: deps.loadPorts, onCompressing: deps.onCompressing }
    );

    if (!result.ok) {
      return {
        ok: false,
        step: "compress",
        reason: result.reason,
        maxBytes: result.maxBytes,
        originalByteSize: result.originalByteSize,
        smallestByteSize: result.smallestByteSize ?? null
      };
    }

    if (result.changed) {
      upload = {
        name: result.name,
        type: result.mimeType,
        bytes: await result.blob.arrayBuffer()
      };
      compression = {
        originalByteSize: result.originalByteSize,
        byteSize: result.byteSize,
        mimeType: result.mimeType,
        name: result.name,
        width: result.width,
        height: result.height
      };
    } else {
      upload = {
        name: file.name,
        type: file.type,
        bytes: await file.arrayBuffer()
      };
    }

    // The bytes about to be sent, measured, not the number a result claimed.
    // A file that changed on disk between the size check and this read, or a
    // codec that lied about a blob's size, cannot slip an oversize upload past.
    if (upload.bytes.byteLength > maxBytes) {
      return {
        ok: false,
        step: "compress",
        reason: "floor_reached",
        maxBytes,
        originalByteSize: file.size,
        smallestByteSize: upload.bytes.byteLength
      };
    }

    if (compression !== null) deps.onCompressed?.(compression);
  }

  const outcome = await uploadMediaBytes(
    upload,
    deps.transport,
    deps.onProgress
  );

  return outcome.ok ? { ...outcome, compression } : outcome;
}

/** Placeholders: `{cap}`, `{original}`, `{final}`, `{smallest}`. */
export type CompressionMessages = {
  compressing: string;
  compressed: string;
  gifOverCap: string;
  animatedOverCap: string;
  typeNotCompressible: string;
  floorReached: string;
  unsupportedBrowser: string;
  decodeFailed: string;
  sourceTooLarge: string;
  noEncoder: string;
  alphaNeedsWebp: string;
  invalidInput: string;
};

/**
 * English fallbacks. The page passes the SERVER-translated templates down as
 * `data-*` attributes (client scripts cannot translate: the catalogue is a
 * server module), and these are what a missing attribute degrades to, so a
 * wiring slip shows readable English rather than an empty message.
 */
export const DEFAULT_COMPRESSION_MESSAGES: CompressionMessages = {
  compressing: "Compressing the image in your browser ({original})…",
  compressed:
    "Compressed from {original} to {final} before upload. Camera and location metadata (EXIF) is not kept.",
  gifOverCap:
    "This GIF is {original}, over the {cap} limit. GIF files are never re-compressed because that would remove the animation. Choose a smaller GIF, or use a JPEG, PNG or WebP image.",
  animatedOverCap:
    "This animated image is {original}, over the {cap} limit. Animated images are never re-compressed because that would remove the animation. Choose a smaller file, or use a still JPEG, PNG or WebP image.",
  typeNotCompressible:
    "This file is {original}, over the {cap} limit, and its type cannot be compressed in the browser. Nothing was uploaded.",
  floorReached:
    "Even at the smallest size tried, the image is still {smallest}, over the {cap} limit. Choose a smaller image. Nothing was uploaded.",
  unsupportedBrowser:
    "This image is {original}, over the {cap} limit, and this browser cannot compress images. Use a current version of Chrome, Edge, Firefox or Safari, or choose a smaller image. Nothing was uploaded.",
  decodeFailed:
    "This image could not be read, so it could not be compressed to fit the {cap} limit. Nothing was uploaded.",
  sourceTooLarge:
    "This image has too many pixels to compress in the browser. Resize it first, or choose a smaller image. Nothing was uploaded.",
  noEncoder:
    "This browser cannot write the image formats needed to compress this file to fit the {cap} limit. Nothing was uploaded.",
  alphaNeedsWebp:
    "This image has transparency and this browser cannot write WebP, so it cannot be compressed without losing the transparency. Choose a smaller image. Nothing was uploaded.",
  invalidInput:
    "This file could not be checked against the {cap} limit. Nothing was uploaded."
};

const FAILURE_MESSAGE_KEY: Record<
  CompressionFailureReason,
  keyof CompressionMessages
> = {
  gif_over_cap: "gifOverCap",
  animated_over_cap: "animatedOverCap",
  type_not_compressible: "typeNotCompressible",
  invalid_input: "invalidInput",
  unsupported_browser: "unsupportedBrowser",
  decode_failed: "decodeFailed",
  source_too_large: "sourceTooLarge",
  invalid_dimensions: "decodeFailed",
  no_encoder: "noEncoder",
  alpha_needs_webp: "alphaNeedsWebp",
  floor_reached: "floorReached"
};

/** The sentence for a refused or failed compression, naming the cap. */
export function describeCompressionFailure(
  failure: Extract<UploadMediaFileOutcome, { step: "compress" }>,
  messages: CompressionMessages = DEFAULT_COMPRESSION_MESSAGES,
  locale?: string
): string {
  const template = messages[FAILURE_MESSAGE_KEY[failure.reason]];
  const smallestBytes = failure.smallestByteSize ?? failure.originalByteSize;
  // The floor message compares the smallest size reached with the cap; every
  // other message compares the original. That pair is the one that must not
  // round to the same label (Issue #1238).
  const floor = failure.reason === "floor_reached";
  const compared = formatByteSizeAgainstCap(
    floor ? smallestBytes : failure.originalByteSize,
    failure.maxBytes,
    locale
  );

  return fillMessage(template, {
    cap: compared.cap,
    original: floor
      ? formatByteSize(failure.originalByteSize, locale)
      : compared.size,
    smallest: floor ? compared.size : formatByteSize(smallestBytes, locale)
  });
}

/** "Compressed from X to Y" for a result that changed the file. */
export function describeCompressionSuccess(
  summary: CompressionSummary,
  messages: CompressionMessages = DEFAULT_COMPRESSION_MESSAGES,
  locale?: string
): string {
  return fillMessage(messages.compressed, {
    original: formatByteSize(summary.originalByteSize, locale),
    final: formatByteSize(summary.byteSize, locale)
  });
}

const MESSAGE_DATASET_KEYS: Record<keyof CompressionMessages, string> = {
  compressing: "msgCompressing",
  compressed: "msgCompressed",
  gifOverCap: "msgGifOverCap",
  animatedOverCap: "msgAnimatedOverCap",
  typeNotCompressible: "msgTypeNotCompressible",
  floorReached: "msgFloorReached",
  unsupportedBrowser: "msgUnsupportedBrowser",
  decodeFailed: "msgDecodeFailed",
  sourceTooLarge: "msgSourceTooLarge",
  noEncoder: "msgNoEncoder",
  alphaNeedsWebp: "msgAlphaNeedsWebp",
  invalidInput: "msgInvalidInput"
};

/**
 * Reads the server-translated templates off the form's `data-msg-*`
 * attributes (`dataset.msgCompressing` is `data-msg-compressing`). Anything
 * absent or blank falls back to the English default, so the uploader never
 * shows an empty message.
 */
export function readCompressionMessages(
  dataset: Readonly<Record<string, string | undefined>>
): CompressionMessages {
  const messages = { ...DEFAULT_COMPRESSION_MESSAGES };

  for (const key of Object.keys(MESSAGE_DATASET_KEYS) as Array<
    keyof CompressionMessages
  >) {
    const value = dataset[MESSAGE_DATASET_KEYS[key]];
    if (typeof value === "string" && value.trim().length > 0) {
      messages[key] = value;
    }
  }

  return messages;
}
