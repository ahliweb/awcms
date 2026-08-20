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
 * ## Why the dependencies are injected
 *
 * The orchestration here — what cancels when, what the operator is told, which
 * error wins when two things fail — is the part worth testing, and it is the
 * part a browser test would be slowest at. The transport is passed in so the
 * sequence can be driven in a plain unit test.
 */

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
