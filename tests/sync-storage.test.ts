import { describe, expect, test } from "bun:test";

import {
  computeSyncSignature,
  isTimestampWithinSkew,
  verifySyncSignature
} from "../src/modules/sync-storage/domain/sync-hmac";
import { evaluatePushEventConflict } from "../src/modules/sync-storage/domain/sync-conflict";
import {
  validateConflictResolutionRequestBody,
  validateSyncPushRequestBody,
  MAX_SYNC_PUSH_EVENTS,
  MAX_SYNC_PULL_EVENTS
} from "../src/modules/sync-storage/domain/sync-validation";
import {
  evaluateObjectRetry,
  OBJECT_SYNC_MAX_RETRIES,
  validateObjectSyncEnqueueRequestBody,
  verifyObjectChecksum
} from "../src/modules/sync-storage/domain/object-queue";
import { validateUpdateSyncNodeInput } from "../src/modules/sync-storage/domain/node-management";
import { isHighRiskAction } from "../src/modules/identity-access/domain/access-control";

describe("computeSyncSignature", () => {
  test("is deterministic and depends on the secret, timestamp, and body", () => {
    const a = computeSyncSignature(
      "secret",
      "2026-07-05T00:00:00.000Z",
      '{"a":1}'
    );
    const b = computeSyncSignature(
      "secret",
      "2026-07-05T00:00:00.000Z",
      '{"a":1}'
    );
    const differentSecret = computeSyncSignature(
      "other-secret",
      "2026-07-05T00:00:00.000Z",
      '{"a":1}'
    );
    const differentBody = computeSyncSignature(
      "secret",
      "2026-07-05T00:00:00.000Z",
      '{"a":2}'
    );

    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(differentSecret);
    expect(a).not.toBe(differentBody);
  });
});

describe("verifySyncSignature", () => {
  const secret = "shared-secret";
  const timestamp = "2026-07-05T00:00:00.000Z";
  const body = '{"batchId":"b1","events":[]}';

  test("accepts a correctly computed signature", () => {
    const signature = computeSyncSignature(secret, timestamp, body);

    expect(verifySyncSignature(secret, timestamp, body, signature)).toBe(true);
  });

  test("rejects a tampered body", () => {
    const signature = computeSyncSignature(secret, timestamp, body);

    expect(
      verifySyncSignature(
        secret,
        timestamp,
        '{"batchId":"b1","events":[1]}',
        signature
      )
    ).toBe(false);
  });

  test("rejects the wrong secret", () => {
    const signature = computeSyncSignature(secret, timestamp, body);

    expect(
      verifySyncSignature("wrong-secret", timestamp, body, signature)
    ).toBe(false);
  });

  test("rejects a signature of the wrong length without throwing", () => {
    expect(verifySyncSignature(secret, timestamp, body, "abcd")).toBe(false);
  });
});

describe("isTimestampWithinSkew", () => {
  const now = new Date("2026-07-05T00:00:00.000Z");

  test("accepts a timestamp within the allowed skew", () => {
    expect(isTimestampWithinSkew("2026-07-05T00:04:00.000Z", now, 300)).toBe(
      true
    );
    expect(isTimestampWithinSkew("2026-07-04T23:56:00.000Z", now, 300)).toBe(
      true
    );
  });

  test("rejects a timestamp outside the allowed skew", () => {
    expect(isTimestampWithinSkew("2026-07-05T00:06:00.000Z", now, 300)).toBe(
      false
    );
  });

  test("rejects an unparseable timestamp", () => {
    expect(isTimestampWithinSkew("not-a-date", now, 300)).toBe(false);
  });
});

describe("validateSyncPushRequestBody", () => {
  const VALID_BODY = {
    batchId: "batch-1",
    events: [
      {
        eventType: "created",
        aggregateType: "example",
        payload: { foo: "bar" }
      }
    ]
  };

  test("accepts a valid body", () => {
    const result = validateSyncPushRequestBody(VALID_BODY);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.batchId).toBe("batch-1");
      expect(result.value.events).toHaveLength(1);
    }
  });

  test("rejects a missing batchId", () => {
    const result = validateSyncPushRequestBody({ events: VALID_BODY.events });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContainEqual({
        field: "batchId",
        message: "batchId is required."
      });
    }
  });

  test("rejects an empty events array", () => {
    const result = validateSyncPushRequestBody({ batchId: "b1", events: [] });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContainEqual({
        field: "events",
        message: "events must be a non-empty array."
      });
    }
  });

  test("reports per-event validation errors with index", () => {
    const result = validateSyncPushRequestBody({
      batchId: "b1",
      events: [{ aggregateType: "example", payload: 1 }]
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContainEqual({
        field: "events[0].eventType",
        message: "eventType is required."
      });
    }
  });

  test("rejects a null body", () => {
    expect(validateSyncPushRequestBody(null).valid).toBe(false);
  });

  test("accepts a batch of exactly MAX_SYNC_PUSH_EVENTS", () => {
    const result = validateSyncPushRequestBody({
      batchId: "b1",
      events: Array.from({ length: MAX_SYNC_PUSH_EVENTS }, () => ({
        eventType: "created",
        aggregateType: "example",
        payload: {}
      }))
    });

    // The boundary is inclusive. Asserted alongside the refusal below, because
    // an off-by-one here refuses a batch a well-behaved node is entitled to
    // send and would read as an outage on the node's side.
    expect(result.valid).toBe(true);
  });

  test("refuses a batch of one more than the maximum, and does not truncate it", () => {
    // The write side had NO count bound: `readTextBody(request, "large")` allows
    // 5 MB, so one authenticated request could carry on the order of 30,000
    // events, each costing a compare-and-set plus an INSERT, all sequential and
    // all inside one transaction holding the aggregate rows it had advanced.
    const events = Array.from({ length: MAX_SYNC_PUSH_EVENTS + 1 }, () => ({
      eventType: "created",
      aggregateType: "example",
      payload: {}
    }));

    const result = validateSyncPushRequestBody({ batchId: "b1", events });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContainEqual({
        field: "events",
        message: `events may contain at most ${MAX_SYNC_PUSH_EVENTS} entries per batch; received ${MAX_SYNC_PUSH_EVENTS + 1}. Split the batch.`
      });

      // ONE error, not one per event. An error body carrying a field error for
      // each of 30,000 events is its own denial of service, and the verdict
      // does not depend on their contents.
      expect(result.errors).toHaveLength(1);
    }
  });

  test("the push bound IS the pull page size, not a second number equal to it", () => {
    // A node must not be able to push more in one batch than it can pull in one
    // page. `pull.ts` has clamped reads since it shipped; the write side was
    // uncapped. Asserting the RELATIONSHIP rather than the literal 500 is the
    // point — two independent constants that happen to agree today are how the
    // asymmetry comes back the next time one of them is tuned.
    expect(MAX_SYNC_PUSH_EVENTS).toBe(MAX_SYNC_PULL_EVENTS);
    expect(MAX_SYNC_PUSH_EVENTS).toBeGreaterThan(0);
  });

  test("accepts an event with a valid baseVersion", () => {
    const result = validateSyncPushRequestBody({
      batchId: "b1",
      events: [
        {
          eventType: "updated",
          aggregateType: "example",
          aggregateId: "11111111-1111-1111-1111-111111111111",
          baseVersion: 2,
          payload: {}
        }
      ]
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.events[0]?.baseVersion).toBe(2);
    }
  });

  test("rejects a negative or non-integer baseVersion", () => {
    const negative = validateSyncPushRequestBody({
      batchId: "b1",
      events: [
        { eventType: "e", aggregateType: "a", baseVersion: -1, payload: {} }
      ]
    });
    const fractional = validateSyncPushRequestBody({
      batchId: "b1",
      events: [
        { eventType: "e", aggregateType: "a", baseVersion: 1.5, payload: {} }
      ]
    });

    expect(negative.valid).toBe(false);
    expect(fractional.valid).toBe(false);
  });
});

describe("evaluatePushEventConflict", () => {
  test("allows the first event for a fresh aggregate (version 0, no baseVersion)", () => {
    expect(evaluatePushEventConflict(0, undefined)).toEqual({
      conflict: false
    });
  });

  test("allows an event whose baseVersion matches the current version", () => {
    expect(evaluatePushEventConflict(3, 3)).toEqual({ conflict: false });
  });

  test("flags missing_base_version when the aggregate has history but no baseVersion is given", () => {
    expect(evaluatePushEventConflict(2, undefined)).toEqual({
      conflict: true,
      conflictType: "missing_base_version"
    });
  });

  test("flags version_mismatch when baseVersion is stale", () => {
    expect(evaluatePushEventConflict(3, 2)).toEqual({
      conflict: true,
      conflictType: "version_mismatch"
    });
  });

  test("flags version_mismatch even if baseVersion is ahead of the server (should not happen, but not silently accepted)", () => {
    expect(evaluatePushEventConflict(3, 4)).toEqual({
      conflict: true,
      conflictType: "version_mismatch"
    });
  });
});

describe("validateConflictResolutionRequestBody", () => {
  test("accepts a valid resolution without a note", () => {
    const result = validateConflictResolutionRequestBody({
      resolution: "accept_incoming"
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.resolution).toBe("accept_incoming");
      expect(result.value.note).toBeUndefined();
    }
  });

  test("accepts a valid resolution with a note", () => {
    const result = validateConflictResolutionRequestBody({
      resolution: "manual",
      note: "reconciled by hand"
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.note).toBe("reconciled by hand");
    }
  });

  test("rejects an unknown resolution value", () => {
    const result = validateConflictResolutionRequestBody({
      resolution: "auto_merge"
    });

    expect(result.valid).toBe(false);
  });

  test("rejects a non-string note", () => {
    const result = validateConflictResolutionRequestBody({
      resolution: "manual",
      note: 123
    });

    expect(result.valid).toBe(false);
  });

  test("rejects a null body", () => {
    expect(validateConflictResolutionRequestBody(null).valid).toBe(false);
  });
});

describe("verifyObjectChecksum", () => {
  test("returns true when checksums match", () => {
    expect(verifyObjectChecksum("a".repeat(64), "a".repeat(64))).toBe(true);
  });

  test("returns false when checksums mismatch", () => {
    expect(verifyObjectChecksum("a".repeat(64), "b".repeat(64))).toBe(false);
  });
});

describe("evaluateObjectRetry", () => {
  const now = new Date("2026-07-05T00:00:00.000Z");

  test("is eligible under the max retry count, with delay growing with retryCount", () => {
    const first = evaluateObjectRetry(0, now);
    const second = evaluateObjectRetry(1, now);
    const third = evaluateObjectRetry(2, now);

    expect(first.eligible).toBe(true);
    expect(second.eligible).toBe(true);
    expect(third.eligible).toBe(true);
    expect(first.nextRetryAt?.getTime()).toBeLessThan(
      second.nextRetryAt!.getTime()
    );
    expect(second.nextRetryAt?.getTime()).toBeLessThan(
      third.nextRetryAt!.getTime()
    );
  });

  test("caps the backoff delay at the configured maximum", () => {
    const evaluation = evaluateObjectRetry(OBJECT_SYNC_MAX_RETRIES - 1, now);

    expect(evaluation.eligible).toBe(true);
    expect(evaluation.nextRetryAt).toBeDefined();
  });

  test("is ineligible once retryCount reaches the max", () => {
    const evaluation = evaluateObjectRetry(OBJECT_SYNC_MAX_RETRIES, now);

    expect(evaluation.eligible).toBe(false);
    expect(evaluation.nextRetryAt).toBeUndefined();
  });

  test("is ineligible once retryCount exceeds the max", () => {
    const evaluation = evaluateObjectRetry(OBJECT_SYNC_MAX_RETRIES + 3, now);

    expect(evaluation.eligible).toBe(false);
  });
});

describe("validateObjectSyncEnqueueRequestBody", () => {
  const VALID_BODY = {
    objects: [
      {
        objectKey: "receipts/2026/07/05/abc.pdf",
        localPath: "/var/awcms/storage/receipts/abc.pdf",
        checksumSha256: "a".repeat(64),
        byteSize: 1024
      }
    ]
  };

  test("accepts a valid body", () => {
    const result = validateObjectSyncEnqueueRequestBody(VALID_BODY);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.objects).toHaveLength(1);
      expect(result.value.objects[0]?.objectKey).toBe(
        "receipts/2026/07/05/abc.pdf"
      );
    }
  });

  test("rejects an empty objects array", () => {
    const result = validateObjectSyncEnqueueRequestBody({ objects: [] });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContainEqual({
        field: "objects",
        message: "objects must be a non-empty array."
      });
    }
  });

  test("rejects a missing objectKey", () => {
    const result = validateObjectSyncEnqueueRequestBody({
      objects: [{ ...VALID_BODY.objects[0], objectKey: "" }]
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContainEqual({
        field: "objects[0].objectKey",
        message: "objectKey is required."
      });
    }
  });

  test("rejects a missing localPath", () => {
    const result = validateObjectSyncEnqueueRequestBody({
      objects: [{ ...VALID_BODY.objects[0], localPath: "" }]
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContainEqual({
        field: "objects[0].localPath",
        message: "localPath is required."
      });
    }
  });

  test("rejects a checksumSha256 that is not 64 hex characters", () => {
    const result = validateObjectSyncEnqueueRequestBody({
      objects: [{ ...VALID_BODY.objects[0], checksumSha256: "not-a-hash" }]
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContainEqual({
        field: "objects[0].checksumSha256",
        message: "checksumSha256 must be 64 lowercase hex characters."
      });
    }
  });

  test("rejects a negative byteSize", () => {
    const result = validateObjectSyncEnqueueRequestBody({
      objects: [{ ...VALID_BODY.objects[0], byteSize: -1 }]
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContainEqual({
        field: "objects[0].byteSize",
        message: "byteSize must be a non-negative integer."
      });
    }
  });

  test("rejects a null body", () => {
    expect(validateObjectSyncEnqueueRequestBody(null).valid).toBe(false);
  });
});

describe("validateUpdateSyncNodeInput", () => {
  test("accepts a status-only update", () => {
    const result = validateUpdateSyncNodeInput({ status: "inactive" });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value).toEqual({ status: "inactive" });
    }
  });

  test("accepts a nodeName-only update and trims it", () => {
    const result = validateUpdateSyncNodeInput({ nodeName: "  Kasir 2  " });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value).toEqual({ nodeName: "Kasir 2" });
    }
  });

  test("rejects an empty body (nothing to update)", () => {
    const result = validateUpdateSyncNodeInput({});

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContainEqual({
        field: "body",
        message: "Provide at least one of status or nodeName."
      });
    }
  });

  test("rejects an invalid status value", () => {
    const result = validateUpdateSyncNodeInput({ status: "revoked" });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContainEqual({
        field: "status",
        message: "status must be 'active' or 'inactive'."
      });
    }
  });
});

describe("retry AccessAction (admin object-queue retry)", () => {
  test("retry is a valid action but is not classified as high risk", () => {
    // It is a manual override of an automatic backoff schedule, not a
    // destructive/irreversible action like delete/approve/export/assign —
    // see src/pages/api/v1/sync/object-queue/[id]/retry.ts's header comment.
    expect(isHighRiskAction("retry")).toBe(false);
  });
});
