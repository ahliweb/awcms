/**
 * Pure tests for the Mission Control actions client (Issue
 * ahliweb/omes#267): outcome -> UI mapping, one Idempotency-Key per intent, and
 * the closed allowlist the client re-applies to whatever the advisory endpoint
 * returns. No DOM: the module's top level touches none.
 */
import { describe, expect, test } from "bun:test";

import {
  describeOutcome,
  intentKey,
  parseAction,
  recordLink,
  type ActionItem,
  type IntentStore
} from "../src/lib/ui/mission-control/actions";
import { mapMutationOutcome } from "../src/modules/omes-control/domain/mission-control-outcome";

const op = (operation: string, extra: Record<string, unknown> = {}) => ({
  action: `operation.${operation}`,
  available: true,
  reason: "available",
  requires_approval: operation === "stop" || operation === "rollback",
  mutating: true,
  method: "POST",
  path: "/api/v1/omes/operations",
  advisories: [],
  body: { serverId: "srv-1", operation, deploymentId: "dep-1" },
  ...extra
});

function item(raw: unknown): ActionItem {
  const parsed = parseAction(raw);
  expect(parsed).not.toBeNull();
  return parsed as ActionItem;
}

describe("outcome -> UI mapping (never conflated, never optimistic)", () => {
  const start = item(op("start"));
  const stop = item(op("stop"));

  test("201/200/202 without a workflow instance is accepted: pending verification, link to the record", () => {
    for (const status of [200, 201, 202]) {
      const outcome = mapMutationOutcome(status, { success: true });
      expect(outcome).toBe("accepted");
      const view = describeOutcome(outcome, start, { success: true });
      expect(view).toEqual({
        message: "accepted",
        href: "/admin/omes/operations?serverId=srv-1",
        link: "openRecord",
        keepIntent: false
      });
    }
  });

  test("a response carrying a workflow instance links to that inbox item and finishes the intent", () => {
    const body = {
      data: { operationRequest: { workflowInstanceId: "wf 1/2" } }
    };
    const outcome = mapMutationOutcome(201, body);
    expect(outcome).toBe("approval_required");
    expect(describeOutcome(outcome, stop, body)).toEqual({
      message: "approval_required",
      href: "/admin/approvals?workflowKey=omes_control.destructive_operation&instance=wf%201%2F2",
      link: "openInbox",
      keepIntent: false
    });
  });

  test("409 APPROVAL_WORKFLOW_NOT_CONFIGURED is approval_required without an instance: recorded nothing, key kept, inbox link without instance", () => {
    const body = { error: { code: "APPROVAL_WORKFLOW_NOT_CONFIGURED" } };
    const outcome = mapMutationOutcome(409, body);
    expect(outcome).toBe("approval_required");
    expect(describeOutcome(outcome, stop, body)).toEqual({
      message: "approval_not_configured",
      href: "/admin/approvals?workflowKey=omes_control.destructive_operation",
      link: "openInbox",
      keepIntent: true
    });
  });

  test("403 / 409 / 429 are rejected with no link and the intent kept for a retry", () => {
    for (const status of [400, 403, 404, 409, 429]) {
      const outcome = mapMutationOutcome(status, { error: { code: "X" } });
      expect(outcome).toBe("rejected");
      expect(describeOutcome(outcome, start, null)).toEqual({
        message: "rejected",
        href: null,
        link: null,
        keepIntent: true
      });
    }
  });

  test("500 / network error / timeout are unknown, never success: a link to the record, key kept", () => {
    for (const status of [500, 502, 503, "network_error", "timeout"] as const) {
      const outcome = mapMutationOutcome(status, { success: true });
      expect(outcome).toBe("unknown");
      const view = describeOutcome(outcome, start, { success: true });
      expect(view.message).toBe("unknown");
      expect(view.message).not.toBe("accepted");
      expect(view.href).toBe("/admin/omes/operations?serverId=srv-1");
      expect(view.keepIntent).toBe(true);
    }
  });

  test("the record link depends on the action: jobs, backups, operations", () => {
    expect(
      recordLink(
        item({
          action: "job.cancel",
          available: true,
          reason: "available",
          mutating: true,
          path: "/api/v1/omes/jobs/0b9b6f64-1e2f-4f0a-8a55-6a1d6f3f2c11/cancel",
          advisories: []
        })
      )
    ).toBe("/admin/omes/jobs");
    expect(
      recordLink(
        item({
          action: "backup.restore",
          available: true,
          reason: "available",
          mutating: true,
          path: "/api/v1/omes/backups/0b9b6f64-1e2f-4f0a-8a55-6a1d6f3f2c11/restore",
          advisories: []
        })
      )
    ).toBe("/admin/omes/backups");
  });
});

describe("one Idempotency-Key per intent", () => {
  test("the same intent reuses its key; a different intent gets a fresh one", () => {
    const store: IntentStore = new Map();
    let n = 0;
    const gen = () => `key-${(n += 1)}`;

    const a1 = intentKey(store, "server\0srv-1\0operation.start", gen);
    const a2 = intentKey(store, "server\0srv-1\0operation.start", gen);
    const b = intentKey(store, "server\0srv-1\0operation.stop", gen);
    const c = intentKey(store, "server\0srv-2\0operation.start", gen);

    expect(a1).toBe("key-1");
    expect(a2).toBe(a1);
    expect(new Set([a1, b, c]).size).toBe(3);
    expect(n).toBe(3);
  });

  test("after the intent is finished (entry deleted) the next intent gets a fresh key", () => {
    const store: IntentStore = new Map();
    let n = 0;
    const gen = () => `key-${(n += 1)}`;
    const first = intentKey(store, "i", gen);
    store.delete("i");
    expect(intentKey(store, "i", gen)).not.toBe(first);
  });

  test("the default generator yields distinct UUIDs", () => {
    const store: IntentStore = new Map();
    const a = intentKey(store, "a");
    const b = intentKey(store, "b");
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(a).not.toBe(b);
  });
});

describe("parseAction re-applies a closed allowlist to the advisory response", () => {
  test("accepts the existing mutation endpoints with the exact canonical body shape", () => {
    expect(parseAction(op("status"))).not.toBeNull();
    expect(
      parseAction(
        op("rollback", { body: { serverId: "srv-1", operation: "rollback" } })
      )
    ).not.toBeNull();
    for (const [action, path] of [
      [
        "job.cancel",
        "/api/v1/omes/jobs/0b9b6f64-1e2f-4f0a-8a55-6a1d6f3f2c11/cancel"
      ],
      [
        "job.requeue",
        "/api/v1/omes/jobs/0b9b6f64-1e2f-4f0a-8a55-6a1d6f3f2c11/approve"
      ],
      [
        "backup.restore",
        "/api/v1/omes/backups/0b9b6f64-1e2f-4f0a-8a55-6a1d6f3f2c11/restore"
      ]
    ] as const) {
      expect(
        parseAction({
          action,
          available: true,
          reason: "available",
          mutating: true,
          path,
          advisories: []
        })
      ).not.toBeNull();
    }
  });

  test("drops a mutating action whose path is not one of the four existing endpoints", () => {
    for (const path of [
      "/api/v1/omes/operations/../../admin",
      "/api/v1/omes/jobs/x/delete",
      "/api/v1/omes/jobs//cancel",
      "/api/v1/omes/worker/jobs",
      "https://evil.example/api/v1/omes/operations",
      "//evil.example/api/v1/omes/operations",
      "/api/v1/workflows/tasks/1/decide",
      "/api/v1/omes/operations?x=1"
    ]) {
      expect(parseAction(op("start", { path })), path).toBeNull();
    }
  });

  test("drops an operation body with extra or free-form fields, non-string values or a missing serverId/operation", () => {
    for (const body of [
      { serverId: "srv-1", operation: "start", command: "rm -rf /" },
      { serverId: "srv-1", operation: "start", argv: ["x"] },
      { serverId: "srv-1", operation: "start", parameters: {} },
      { serverId: "srv-1", operation: "start", deploymentId: 7 },
      { serverId: 7, operation: "start" },
      { operation: "start" },
      { serverId: "srv-1" },
      [],
      null
    ]) {
      expect(
        parseAction(op("start", { body })),
        JSON.stringify(body)
      ).toBeNull();
    }
  });

  test("an operations request needs a body, and a job/backup request must not have one", () => {
    expect(parseAction(op("start", { body: undefined }))).toBeNull();
    expect(
      parseAction({
        action: "job.cancel",
        available: true,
        reason: "available",
        mutating: true,
        path: "/api/v1/omes/jobs/0b9b6f64-1e2f-4f0a-8a55-6a1d6f3f2c11/cancel",
        advisories: [],
        body: { serverId: "srv-1", operation: "start" }
      })
    ).toBeNull();
  });

  test("an approval-inbox link is only the canonical inbox path; anything else is dropped", () => {
    const inbox = (path: string) => ({
      action: "approval.open_in_inbox",
      available: true,
      reason: "available",
      mutating: false,
      path,
      advisories: []
    });
    expect(
      parseAction(
        inbox(
          "/admin/approvals?workflowKey=omes_control.destructive_operation&instance=wf-1"
        )
      )
    ).not.toBeNull();
    expect(
      parseAction(inbox("https://evil.example/admin/approvals"))
    ).toBeNull();
    expect(parseAction(inbox("/admin/omes/jobs"))).toBeNull();
  });

  test("malformed entries are dropped (fail closed)", () => {
    for (const raw of [
      null,
      7,
      "x",
      {},
      { action: "a" },
      { action: 1, available: true, reason: "r", path: "/" }
    ]) {
      expect(parseAction(raw)).toBeNull();
    }
  });

  test("approval and advisories survive parsing as data only", () => {
    const parsed = item(op("stop", { advisories: ["target_stale", 7, null] }));
    expect(parsed.requiresApproval).toBe(true);
    expect(parsed.advisories).toEqual(["target_stale"]);
  });
});
