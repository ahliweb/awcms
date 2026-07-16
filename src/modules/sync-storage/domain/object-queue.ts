export type ValidationError = {
  field: string;
  message: string;
};

export type ObjectSyncQueueItem = {
  objectKey: string;
  localPath: string;
  checksumSha256: string;
  byteSize: number;
};

export type ObjectSyncEnqueueRequestBody = {
  objects: ObjectSyncQueueItem[];
};

export type ObjectSyncEnqueueValidationResult =
  | { valid: true; value: ObjectSyncEnqueueRequestBody }
  | { valid: false; errors: ValidationError[] };

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

export function validateObjectSyncEnqueueRequestBody(
  body: unknown
): ObjectSyncEnqueueValidationResult {
  const errors: ValidationError[] = [];
  const record = (body ?? {}) as Record<string, unknown>;

  if (!Array.isArray(record.objects) || record.objects.length === 0) {
    errors.push({
      field: "objects",
      message: "objects must be a non-empty array."
    });

    return { valid: false, errors };
  }

  record.objects.forEach((object, index) => {
    const candidate = (object ?? {}) as Record<string, unknown>;

    if (
      typeof candidate.objectKey !== "string" ||
      candidate.objectKey.trim().length === 0
    ) {
      errors.push({
        field: `objects[${index}].objectKey`,
        message: "objectKey is required."
      });
    }

    if (
      typeof candidate.localPath !== "string" ||
      candidate.localPath.trim().length === 0
    ) {
      errors.push({
        field: `objects[${index}].localPath`,
        message: "localPath is required."
      });
    }

    if (
      typeof candidate.checksumSha256 !== "string" ||
      !SHA256_HEX_PATTERN.test(candidate.checksumSha256)
    ) {
      errors.push({
        field: `objects[${index}].checksumSha256`,
        message: "checksumSha256 must be 64 lowercase hex characters."
      });
    }

    if (
      typeof candidate.byteSize !== "number" ||
      !Number.isInteger(candidate.byteSize) ||
      candidate.byteSize < 0
    ) {
      errors.push({
        field: `objects[${index}].byteSize`,
        message: "byteSize must be a non-negative integer."
      });
    }
  });

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      objects: (record.objects as ObjectSyncQueueItem[]).map((object) => ({
        objectKey: object.objectKey.trim(),
        localPath: object.localPath.trim(),
        checksumSha256: object.checksumSha256,
        byteSize: object.byteSize
      }))
    }
  };
}

/**
 * Pure string equality — checksum is not a secret, so no timing-safe
 * compare is needed (unlike sync-hmac.ts's signature verification).
 */
export function verifyObjectChecksum(
  expectedSha256: string,
  actualSha256: string
): boolean {
  return expectedSha256 === actualSha256;
}

// Retry policy constants (exponential backoff for object upload retries).
// Capped at 60 minutes so a stuck object doesn't wait indefinitely between
// attempts, and ineligible past 5 retries so a permanently-broken object
// stops being retried forever and surfaces as `failed` for manual attention.
export const OBJECT_SYNC_MAX_RETRIES = 5;
export const OBJECT_SYNC_MAX_RETRY_DELAY_MINUTES = 60;

export type ObjectRetryEvaluation = {
  eligible: boolean;
  nextRetryAt?: Date;
};

/**
 * Exponential backoff: delay is 2^retryCount minutes, capped at
 * OBJECT_SYNC_MAX_RETRY_DELAY_MINUTES. Ineligible once retryCount reaches
 * or exceeds OBJECT_SYNC_MAX_RETRIES.
 */
export function evaluateObjectRetry(
  retryCount: number,
  now: Date
): ObjectRetryEvaluation {
  if (retryCount >= OBJECT_SYNC_MAX_RETRIES) {
    return { eligible: false };
  }

  const delayMinutes = Math.min(
    2 ** retryCount,
    OBJECT_SYNC_MAX_RETRY_DELAY_MINUTES
  );

  return {
    eligible: true,
    nextRetryAt: new Date(now.getTime() + delayMinutes * 60_000)
  };
}
