export type SyncPushEvent = {
  eventType: string;
  aggregateType: string;
  aggregateId?: string;
  baseVersion?: number;
  payload: unknown;
};

export type SyncPushRequestBody = {
  batchId: string;
  events: SyncPushEvent[];
};

export type ValidationError = {
  field: string;
  message: string;
};

export type SyncPushValidationResult =
  | { valid: true; value: SyncPushRequestBody }
  | { valid: false; errors: ValidationError[] };

/**
 * The most events one PULL page may return. `pull.ts` has clamped to this since
 * it shipped; it lives here rather than in the route so the push bound below
 * can be defined in terms of it instead of repeating the number.
 */
export const MAX_SYNC_PULL_EVENTS = 500;

/**
 * The most events one push batch may carry.
 *
 * Defined AS the pull page size rather than as a second 500, because the reason
 * for the number is the relationship: a node must not be able to push more in
 * one batch than it can pull in one page. The two halves of this protocol had
 * asymmetric bounds — the read side capped since it shipped, the write side
 * with no count bound at all — and two independent literals are how that
 * asymmetry comes back the next time one of them is tuned.
 *
 * What "no bound" meant in practice. `readTextBody(request, "large")` allows
 * 5 MB, and a minimal event serialises to a couple of hundred bytes, so a
 * single authenticated request could carry on the order of 30,000 events. Each
 * accepted one costs a compare-and-set on the aggregate version plus an inbox
 * INSERT, each conflicted one a conflict INSERT — all sequential, all inside
 * ONE transaction that holds a connection and keeps the aggregate rows it has
 * advanced locked until commit. The cost is not the round trips alone; it is
 * how long everything else waits behind them.
 *
 * REFUSED, never truncated. Truncation on a write path silently drops events a
 * node believes it delivered, and the node's whole model is that an accepted
 * batch was accepted in full — it would advance its own cursor past events that
 * never landed. This is the bound posture #180 settled for the business-scope
 * resolver: every bound refuses rather than truncating. The read side clamps
 * instead, correctly, because a clamped page still says `hasMore`.
 */
export const MAX_SYNC_PUSH_EVENTS = MAX_SYNC_PULL_EVENTS;

export function validateSyncPushRequestBody(
  body: unknown
): SyncPushValidationResult {
  const errors: ValidationError[] = [];
  const record = (body ?? {}) as Record<string, unknown>;

  if (
    typeof record.batchId !== "string" ||
    record.batchId.trim().length === 0
  ) {
    errors.push({ field: "batchId", message: "batchId is required." });
  }

  if (!Array.isArray(record.events) || record.events.length === 0) {
    errors.push({
      field: "events",
      message: "events must be a non-empty array."
    });
  } else if (record.events.length > MAX_SYNC_PUSH_EVENTS) {
    // Reported on its own, without also validating 30,000 events: the answer
    // does not depend on their contents, and an error body listing a field
    // error per event is its own denial-of-service.
    errors.push({
      field: "events",
      message: `events may contain at most ${MAX_SYNC_PUSH_EVENTS} entries per batch; received ${record.events.length}. Split the batch.`
    });
  } else {
    record.events.forEach((event, index) => {
      const candidate = (event ?? {}) as Record<string, unknown>;

      if (
        typeof candidate.eventType !== "string" ||
        candidate.eventType.trim().length === 0
      ) {
        errors.push({
          field: `events[${index}].eventType`,
          message: "eventType is required."
        });
      }

      if (
        typeof candidate.aggregateType !== "string" ||
        candidate.aggregateType.trim().length === 0
      ) {
        errors.push({
          field: `events[${index}].aggregateType`,
          message: "aggregateType is required."
        });
      }

      if (!("payload" in candidate)) {
        errors.push({
          field: `events[${index}].payload`,
          message: "payload is required."
        });
      }

      if (
        "baseVersion" in candidate &&
        candidate.baseVersion !== undefined &&
        (typeof candidate.baseVersion !== "number" ||
          !Number.isInteger(candidate.baseVersion) ||
          candidate.baseVersion < 0)
      ) {
        errors.push({
          field: `events[${index}].baseVersion`,
          message: "baseVersion must be a non-negative integer when provided."
        });
      }
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      batchId: (record.batchId as string).trim(),
      events: (record.events as SyncPushEvent[]).map((event) => ({
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        baseVersion: event.baseVersion,
        payload: event.payload
      }))
    }
  };
}

export type ConflictResolution = "accept_incoming" | "keep_existing" | "manual";

export type ConflictResolutionRequestBody = {
  resolution: ConflictResolution;
  note?: string;
};

export type ConflictResolutionValidationResult =
  | { valid: true; value: ConflictResolutionRequestBody }
  | { valid: false; errors: ValidationError[] };

const VALID_RESOLUTIONS: ReadonlySet<string> = new Set([
  "accept_incoming",
  "keep_existing",
  "manual"
]);

export function validateConflictResolutionRequestBody(
  body: unknown
): ConflictResolutionValidationResult {
  const errors: ValidationError[] = [];
  const record = (body ?? {}) as Record<string, unknown>;

  if (
    typeof record.resolution !== "string" ||
    !VALID_RESOLUTIONS.has(record.resolution)
  ) {
    errors.push({
      field: "resolution",
      message:
        "resolution must be one of accept_incoming, keep_existing, manual."
    });
  }

  if (record.note !== undefined && typeof record.note !== "string") {
    errors.push({
      field: "note",
      message: "note must be a string when provided."
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      resolution: record.resolution as ConflictResolution,
      note: record.note as string | undefined
    }
  };
}
