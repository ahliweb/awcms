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

/**
 * Finding A7 — an `objectKey` reaches `Bun.S3Client.write` as the destination,
 * and the node chose it. Two things follow.
 *
 * It must be a plain relative key: no leading `/`, no `..` segment, no
 * backslash, no control character. S3 and R2 have no server-side path
 * semantics, so `../` is not traversal AT the provider — but `/` IS a delimiter
 * for listing, lifecycle rules and every console and CLI that presents a
 * bucket as a tree, and those normalise. A key that reads as an escape in the
 * one place a human looks at it is a key that will eventually be treated as
 * one.
 *
 * And it must be namespaced per tenant, which `objectSyncStorageKey` does at
 * PUT time rather than here. The queue row is already tenant-scoped by
 * `UNIQUE (tenant_id, node_id, object_key)`; it was the destination that was
 * not, so one node could PUT another tenant's key and an S3 PUT to an existing
 * key is an overwrite.
 */
const OBJECT_KEY_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const OBJECT_KEY_MAX_LENGTH = 512;

export function isSafeObjectKey(value: string): boolean {
  if (value.length === 0 || value.length > OBJECT_KEY_MAX_LENGTH) return false;

  const segments = value.split("/");

  // A trailing or doubled `/` yields an empty segment, which the pattern
  // rejects — so `a//b` and `a/` are refused without a separate rule.
  return segments.every((segment) => OBJECT_KEY_SEGMENT_PATTERN.test(segment));
}

/**
 * The destination key actually written to object storage: the tenant's id, then
 * the key the node asked for.
 *
 * Applied at the point of upload rather than stored, so no migration and no
 * re-keying of rows already queued — and so the value a node reads back from
 * `GET /sync/objects/status` is still the key it sent, which is the only key it
 * knows about.
 */
export function objectSyncStorageKey(
  tenantId: string,
  objectKey: string
): string {
  return `${tenantId}/${objectKey}`;
}

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
    } else if (!isSafeObjectKey(candidate.objectKey.trim())) {
      errors.push({
        field: `objects[${index}].objectKey`,
        message:
          "objectKey must be slash-separated segments of letters, digits, '.', '_' or '-', each starting with a letter or digit."
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
