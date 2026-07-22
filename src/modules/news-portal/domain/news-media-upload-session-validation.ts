/**
 * Request-shape validation for the presigned upload session endpoints
 * (Issue #634, epic `news_portal`). Pure — no DB/network access. Follows
 * `blog-content/domain/blog-post-validation.ts`'s
 * `{ valid: true; value } | { valid: false; errors }` convention.
 *
 * `r2-upload-sop.md` §2 step 1 validates SHAPE ONLY at create time (no bytes
 * exist yet to check content against) — `mimeType` must be in the
 * deployment's configured allow-list and `byteSize` must not exceed
 * `NEWS_MEDIA_R2_MAX_UPLOAD_BYTES`. Neither is persisted verbatim: the
 * object key's real extension is derived from the validated `mimeType`
 * (`news-media-object-key.ts`), and the real `size_bytes` column is only
 * ever populated later from R2's own `HEAD` response at finalize time
 * (`markNewsMediaObjectUploaded`) — the client's claimed `byteSize` here is
 * only an early, cheap rejection of an obviously-oversized request before
 * any presigned URL is even generated.
 */

export type ValidationError = {
  field: string;
  message: string;
};

const MAX_TEXT_FIELD_LENGTH = 500;

export type CreateNewsMediaUploadSessionInput = {
  mimeType: string;
  byteSize: number;
  originalFilename: string | null;
  altText: string | null;
  caption: string | null;
};

export type CreateNewsMediaUploadSessionValidationResult =
  | { valid: true; value: CreateNewsMediaUploadSessionInput }
  | { valid: false; errors: ValidationError[] };

function validateOptionalText(
  raw: unknown,
  field: string,
  errors: ValidationError[]
): string | null {
  if (raw === undefined || raw === null) return null;

  if (typeof raw !== "string") {
    errors.push({ field, message: `${field} must be a string.` });
    return null;
  }

  const trimmed = raw.trim();

  if (trimmed.length === 0) return null;

  if (trimmed.length > MAX_TEXT_FIELD_LENGTH) {
    errors.push({
      field,
      message: `${field} must be at most ${MAX_TEXT_FIELD_LENGTH} characters.`
    });
    return null;
  }

  return trimmed;
}

export function validateCreateNewsMediaUploadSessionInput(
  raw: unknown,
  allowedMimeTypes: string[],
  maxUploadBytes: number
): CreateNewsMediaUploadSessionValidationResult {
  const errors: ValidationError[] = [];

  if (!raw || typeof raw !== "object") {
    return {
      valid: false,
      errors: [{ field: "body", message: "Request body must be an object." }]
    };
  }

  const body = raw as Record<string, unknown>;

  let mimeType = "";
  if (typeof body.mimeType !== "string" || body.mimeType.trim().length === 0) {
    errors.push({ field: "mimeType", message: "mimeType is required." });
  } else {
    mimeType = body.mimeType.toLowerCase().trim();
    if (!allowedMimeTypes.includes(mimeType)) {
      errors.push({
        field: "mimeType",
        message: `mimeType must be one of: ${allowedMimeTypes.join(", ")}.`
      });
    }
  }

  let byteSize = 0;
  if (
    typeof body.byteSize !== "number" ||
    !Number.isFinite(body.byteSize) ||
    !Number.isInteger(body.byteSize) ||
    body.byteSize <= 0
  ) {
    errors.push({
      field: "byteSize",
      message: "byteSize must be a positive integer."
    });
  } else {
    byteSize = body.byteSize;
    if (byteSize > maxUploadBytes) {
      errors.push({
        field: "byteSize",
        message: `byteSize must not exceed ${maxUploadBytes} bytes.`
      });
    }
  }

  const originalFilename = validateOptionalText(
    body.originalFilename,
    "originalFilename",
    errors
  );
  const altText = validateOptionalText(body.altText, "altText", errors);
  const caption = validateOptionalText(body.caption, "caption", errors);

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: { mimeType, byteSize, originalFilename, altText, caption }
  };
}

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/i;

export type FinalizeNewsMediaUploadSessionInput = {
  checksumSha256: string | null;
};

export type FinalizeNewsMediaUploadSessionValidationResult =
  | { valid: true; value: FinalizeNewsMediaUploadSessionInput }
  | { valid: false; errors: ValidationError[] };

/**
 * `checksumSha256` is optional (issue's own acceptance criteria: "Optional
 * checksum SHA-256") — when present it must be a well-formed SHA-256 hex
 * digest. Per §9, a match/mismatch here only ever detects transport
 * corruption; it is never sufficient on its own to accept an upload (see
 * `news-media-finalize-decision.ts`).
 */
export function validateFinalizeNewsMediaUploadSessionInput(
  raw: unknown
): FinalizeNewsMediaUploadSessionValidationResult {
  // An absent/empty body is valid — checksum is optional.
  if (raw === null || raw === undefined) {
    return { valid: true, value: { checksumSha256: null } };
  }

  if (typeof raw !== "object") {
    return {
      valid: false,
      errors: [{ field: "body", message: "Request body must be an object." }]
    };
  }

  const body = raw as Record<string, unknown>;

  if (body.checksumSha256 === undefined || body.checksumSha256 === null) {
    return { valid: true, value: { checksumSha256: null } };
  }

  if (
    typeof body.checksumSha256 !== "string" ||
    !SHA256_HEX_PATTERN.test(body.checksumSha256)
  ) {
    return {
      valid: false,
      errors: [
        {
          field: "checksumSha256",
          message: "checksumSha256 must be a 64-character hex SHA-256 digest."
        }
      ]
    };
  }

  return {
    valid: true,
    value: { checksumSha256: body.checksumSha256.toLowerCase() }
  };
}
