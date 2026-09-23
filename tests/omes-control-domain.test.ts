/**
 * Pure-unit tests for the omes_control domain layer (Issue ahliweb/omes#198):
 * the safe-operation allowlist, destructive classification, per-operation
 * permission routing, submission validation, heartbeat staleness, and
 * server-registration/enrollment-challenge domain logic. No database.
 */
import { describe, expect, test } from "bun:test";

import {
  DESTRUCTIVE_OMES_OPERATIONS,
  isDestructiveOmesOperation,
  isSupportedOmesOperation,
  OMES_DESTRUCTIVE_WORKFLOW_KEY,
  OMES_OPERATION_CODES,
  OMES_OPERATION_GUARD,
  validateOperationSubmission
} from "../src/modules/omes-control/domain/operations";
import {
  isHeartbeatStale,
  STALE_HEARTBEAT_THRESHOLD_MS
} from "../src/modules/omes-control/domain/staleness";
import {
  ENROLLMENT_CHALLENGE_TTL_MS,
  hashEnrollmentChallenge,
  issueEnrollmentChallenge,
  validateServerRegistrationInput
} from "../src/modules/omes-control/domain/server-registration";

describe("OMES_OPERATION_CODES / isSupportedOmesOperation", () => {
  test("matches the OMES contract's operation-request.schema.json enum exactly", () => {
    // Byte-for-byte against contracts/control-center/v1/operation-request.schema.json
    // (ahliweb/omes) — see this module's own header for why it must never drift.
    expect(OMES_OPERATION_CODES).toEqual([
      "status",
      "preflight",
      "start",
      "stop",
      "restart",
      "update",
      "backup",
      "rollback"
    ]);
  });

  test("accepts every declared code and rejects anything else", () => {
    for (const code of OMES_OPERATION_CODES) {
      expect(isSupportedOmesOperation(code)).toBe(true);
    }
    expect(isSupportedOmesOperation("restore")).toBe(false);
    expect(isSupportedOmesOperation("configure")).toBe(false);
    expect(isSupportedOmesOperation("install")).toBe(false);
    expect(isSupportedOmesOperation("")).toBe(false);
    expect(isSupportedOmesOperation("STATUS")).toBe(false);
  });
});

describe("destructive classification", () => {
  test("exactly stop and rollback are destructive", () => {
    expect([...DESTRUCTIVE_OMES_OPERATIONS].sort()).toEqual([
      "rollback",
      "stop"
    ]);
  });

  test("isDestructiveOmesOperation agrees with the set for every code", () => {
    for (const code of OMES_OPERATION_CODES) {
      expect(isDestructiveOmesOperation(code)).toBe(
        DESTRUCTIVE_OMES_OPERATIONS.has(code)
      );
    }
  });

  test("every operation has exactly one guard, and every guard names a real omes_control permission", () => {
    for (const code of OMES_OPERATION_CODES) {
      const guard = OMES_OPERATION_GUARD[code];
      expect(guard.moduleKey).toBe("omes_control");
      expect(typeof guard.activityCode).toBe("string");
      expect(typeof guard.action).toBe("string");
    }

    // Destructive ops must never be gated by a plain `.read`/`.operate` guard
    // that a routine caller could already hold — rollback specifically needs
    // the MORE specific backups.rollback.
    expect(OMES_OPERATION_GUARD.rollback).toEqual({
      moduleKey: "omes_control",
      activityCode: "backups",
      action: "rollback"
    });
    expect(OMES_OPERATION_GUARD.stop).toEqual({
      moduleKey: "omes_control",
      activityCode: "deployments",
      action: "operate"
    });
  });

  test("the destructive-operation workflow key is stable (referenced by SQL/admin approval authoring)", () => {
    expect(OMES_DESTRUCTIVE_WORKFLOW_KEY).toBe(
      "omes_control.destructive_operation"
    );
  });
});

describe("validateOperationSubmission", () => {
  test("accepts a minimal valid submission", () => {
    const result = validateOperationSubmission({
      serverId: "srv-1",
      operation: "status"
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.serverId).toBe("srv-1");
      expect(result.value.operation).toBe("status");
      expect(result.value.parameters).toEqual({});
    }
  });

  test("accepts every optional field when present and well-formed", () => {
    const result = validateOperationSubmission({
      serverId: "srv-1",
      deploymentId: "dep-1",
      operation: "rollback",
      parameters: { note: "planned" },
      backupId: "bk-1",
      rollbackRef: "ref-1"
    });

    expect(result.valid).toBe(true);
  });

  test("rejects a non-object body", () => {
    expect(validateOperationSubmission(null).valid).toBe(false);
    expect(validateOperationSubmission("nope").valid).toBe(false);
    expect(validateOperationSubmission([]).valid).toBe(false);
  });

  test("rejects a missing/invalid serverId", () => {
    const result = validateOperationSubmission({ operation: "status" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "serverId")).toBe(true);
    }
  });

  test("rejects an unsupported operation name — never invents/widens the enum", () => {
    const result = validateOperationSubmission({
      serverId: "srv-1",
      operation: "restore"
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "operation")).toBe(true);
    }
  });

  test("rejects parameters that are not a plain object", () => {
    const result = validateOperationSubmission({
      serverId: "srv-1",
      operation: "status",
      parameters: ["not", "an", "object"]
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "parameters")).toBe(true);
    }
  });

  test("rejects an id-shaped field that violates the external-id pattern", () => {
    const result = validateOperationSubmission({
      serverId: "srv 1 with spaces",
      operation: "status"
    });
    expect(result.valid).toBe(false);
  });
});

describe("isHeartbeatStale", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  test("a server that has never reported a heartbeat is stale", () => {
    expect(isHeartbeatStale(null, now)).toBe(true);
  });

  test("a heartbeat within the threshold is not stale", () => {
    const recent = new Date(now.getTime() - STALE_HEARTBEAT_THRESHOLD_MS + 1);
    expect(isHeartbeatStale(recent, now)).toBe(false);
  });

  test("a heartbeat past the threshold is stale", () => {
    const old = new Date(now.getTime() - STALE_HEARTBEAT_THRESHOLD_MS - 1);
    expect(isHeartbeatStale(old, now)).toBe(true);
  });
});

describe("validateServerRegistrationInput", () => {
  test("accepts a well-formed registration body", () => {
    const result = validateServerRegistrationInput({
      hostname: "web-01.example.test",
      platform: { os: "ubuntu", version: "24.04", arch: "amd64" }
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.hostname).toBe("web-01.example.test");
      expect(result.value.platform.os).toBe("ubuntu");
    }
  });

  test("rejects an unsupported OS or arch", () => {
    expect(
      validateServerRegistrationInput({
        hostname: "web-01",
        platform: { os: "windows", version: "11", arch: "amd64" }
      }).valid
    ).toBe(false);

    expect(
      validateServerRegistrationInput({
        hostname: "web-01",
        platform: { os: "ubuntu", version: "24.04", arch: "x86" }
      }).valid
    ).toBe(false);
  });

  test("rejects a missing hostname or platform", () => {
    expect(
      validateServerRegistrationInput({
        platform: { os: "ubuntu", version: "24.04", arch: "amd64" }
      }).valid
    ).toBe(false);

    expect(validateServerRegistrationInput({ hostname: "web-01" }).valid).toBe(
      false
    );
  });

  test("rejects tags that are not an array", () => {
    const result = validateServerRegistrationInput({
      hostname: "web-01",
      platform: { os: "ubuntu", version: "24.04", arch: "amd64" },
      tags: "not-an-array"
    });
    expect(result.valid).toBe(false);
  });
});

describe("enrollment challenge issuance", () => {
  test("mints a high-entropy raw challenge, a matching hash, and a future expiry", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const challenge = issueEnrollmentChallenge(now);

    expect(challenge.rawChallenge.length).toBeGreaterThanOrEqual(32);
    expect(challenge.challengeHash).toBe(
      hashEnrollmentChallenge(challenge.rawChallenge)
    );
    expect(challenge.expiresAt.getTime()).toBe(
      now.getTime() + ENROLLMENT_CHALLENGE_TTL_MS
    );
    // worker_id is minted server-side, never client-supplied.
    expect(challenge.workerId.startsWith("worker_")).toBe(true);
  });

  test("two challenges never collide", () => {
    const now = new Date();
    const a = issueEnrollmentChallenge(now);
    const b = issueEnrollmentChallenge(now);

    expect(a.rawChallenge).not.toBe(b.rawChallenge);
    expect(a.workerId).not.toBe(b.workerId);
  });

  test("the raw challenge never equals its own hash (never accidentally store the raw value)", () => {
    const challenge = issueEnrollmentChallenge(new Date());
    expect(challenge.challengeHash).not.toBe(challenge.rawChallenge);
  });
});
