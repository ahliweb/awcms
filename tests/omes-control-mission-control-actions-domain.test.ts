/**
 * Mission Control contextual actions — pure domain tests (Issue
 * ahliweb/omes#267, epic ahliweb/omes#263; ADR-0031).
 *
 * Iterates the vendored source map so an action outside
 * `kinds[*].candidate_actions` can never be evaluated, and pins every
 * eligibility rule to the existing endpoint it shortcuts.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  actionPermissionGuard,
  allMissionControlActionNames,
  candidateActionsForKind,
  evaluateMissionControlActions,
  mapMutationOutcome,
  MISSION_CONTROL_ACTION_ADVISORIES,
  MISSION_CONTROL_ACTION_REASONS,
  type MissionControlActionRecord,
  type MissionControlActionsInput
} from "../src/modules/omes-control/domain/mission-control-actions";
import { MISSION_CONTROL_KINDS } from "../src/modules/omes-control/domain/mission-control-types";
import {
  OMES_DESTRUCTIVE_WORKFLOW_KEY,
  OMES_OPERATION_CODES
} from "../src/modules/omes-control/domain/operations";
import { OMES_GUARDS } from "../src/modules/omes-control/domain/permissions";

const CONTRACTS = join(
  import.meta.dir,
  "..",
  "src/modules/omes-control/contracts/v1"
);
const sourceMap = JSON.parse(
  readFileSync(join(CONTRACTS, "mission-control-source-map.json"), "utf8")
) as {
  kinds: Record<string, { candidate_actions: string[]; detail_route: string }>;
  actions: Record<string, { mutating: boolean }>;
};
const operationSchema = JSON.parse(
  readFileSync(join(CONTRACTS, "operation-request.schema.json"), "utf8")
) as { properties: { operation: { enum: string[] } } };

const READ_ONLY_KINDS = [
  "hermes_subagent",
  "architecture_plane",
  "capability",
  "repository_milestone",
  "ai_privacy_posture",
  "health_report"
] as const;

function allGranted(kind: string): Record<string, boolean> {
  return Object.fromEntries(
    sourceMap.kinds[kind]!.candidate_actions.map((a) => [a, true])
  );
}

function liveRecord(
  overrides: Partial<MissionControlActionRecord> = {}
): MissionControlActionRecord {
  return { state: "online", freshness: "live", ...overrides };
}

function evaluate(
  kind: (typeof MISSION_CONTROL_KINDS)[number],
  overrides: Partial<MissionControlActionsInput> = {}
) {
  return evaluateMissionControlActions({
    kind,
    sourceId: "abc-123",
    record: liveRecord(),
    permissions: allGranted(kind),
    mode: "live",
    ...overrides
  });
}

function byAction(
  evaluations: ReturnType<typeof evaluate>,
  action: string
): ReturnType<typeof evaluate>[number] {
  const found = evaluations.find((e) => e.action === action);
  if (!found) throw new Error(`missing evaluation for ${action}`);
  return found;
}

describe("candidate actions come from the vendored map", () => {
  test("every kind is evaluated, and only its candidate_actions appear", () => {
    expect([...MISSION_CONTROL_KINDS].map(String).sort()).toEqual(
      Object.keys(sourceMap.kinds).sort()
    );
    for (const kind of MISSION_CONTROL_KINDS) {
      const expected = sourceMap.kinds[kind]!.candidate_actions;
      expect(candidateActionsForKind(kind)).toEqual(expected);
      for (const record of [liveRecord(), null]) {
        for (const mode of ["live", "historical"] as const) {
          const names = evaluate(kind, { record, mode }).map((e) => e.action);
          expect(names).toEqual(expected);
        }
      }
    }
  });

  test("every candidate action exists in the actions table and vice versa", () => {
    const used = new Set(
      Object.values(sourceMap.kinds).flatMap((k) => k.candidate_actions)
    );
    for (const name of used) expect(sourceMap.actions[name]).toBeDefined();
    expect(allMissionControlActionNames().sort()).toEqual(
      Object.keys(sourceMap.actions).sort()
    );
  });

  test("read-only kinds expose only open_details", () => {
    for (const kind of READ_ONLY_KINDS) {
      const evaluations = evaluate(kind);
      expect(evaluations.map((e) => e.action)).toEqual(["open_details"]);
      expect(evaluations[0]!.available).toBe(true);
      expect(evaluations[0]!.mutating).toBe(false);
      expect(evaluations[0]!.method).toBe("GET");
      expect(evaluations[0]!.path).toBe(sourceMap.kinds[kind]!.detail_route);
    }
  });

  test("reasons are a closed enum", () => {
    expect([...MISSION_CONTROL_ACTION_REASONS].map(String).sort()).toEqual(
      [
        "available",
        "historical_mode",
        "not_found",
        "permission_denied",
        "state_not_eligible"
      ].sort()
    );
    for (const kind of MISSION_CONTROL_KINDS) {
      for (const e of evaluate(kind)) {
        expect(MISSION_CONTROL_ACTION_REASONS).toContain(e.reason);
        expect(e.available).toBe(e.reason === "available");
      }
    }
  });
});

describe("jobs", () => {
  const jobStates = [
    "queued",
    "leased",
    "running",
    "succeeded",
    "failed",
    "cancelled",
    "unknown_state"
  ];

  test("job.cancel is available only for a queued job", () => {
    for (const state of jobStates) {
      const e = byAction(
        evaluate("job", { record: liveRecord({ state }) }),
        "job.cancel"
      );
      expect(e.available).toBe(state === "queued");
      expect(e.reason).toBe(
        state === "queued" ? "available" : "state_not_eligible"
      );
      expect(e.method).toBe("POST");
      expect(e.path).toBe("/api/v1/omes/jobs/abc-123/cancel");
      expect(e.requiresApproval).toBe(false);
    }
  });

  test("job.requeue is available only for a failed job", () => {
    for (const state of jobStates) {
      const e = byAction(
        evaluate("job", { record: liveRecord({ state }) }),
        "job.requeue"
      );
      expect(e.available).toBe(state === "failed");
      expect(e.reason).toBe(
        state === "failed" ? "available" : "state_not_eligible"
      );
      expect(e.path).toBe("/api/v1/omes/jobs/abc-123/approve");
    }
  });

  test("a stale server heartbeat neither blocks nor warns on cancel/requeue (AWCMS-only transitions)", () => {
    const stale = evaluate("job", {
      record: liveRecord({ state: "queued", freshness: "stale" })
    });
    expect(byAction(stale, "job.cancel").available).toBe(true);
    expect(byAction(stale, "job.cancel").advisories).toEqual([]);
  });
});

describe("operations", () => {
  test("every operation.* name is in the operation-request allowlist", () => {
    const allowlist = new Set(operationSchema.properties.operation.enum);
    expect([...OMES_OPERATION_CODES].map(String).sort()).toEqual(
      [...allowlist].sort()
    );
    for (const action of allMissionControlActionNames()) {
      if (!action.startsWith("operation.")) continue;
      expect(allowlist.has(action.slice("operation.".length))).toBe(true);
    }
  });

  test("decommissioned server: still available, with a target_decommissioned advisory", () => {
    const evaluations = evaluate("server", {
      record: liveRecord({ state: "decommissioned" })
    });
    for (const e of evaluations.filter((x) =>
      x.action.startsWith("operation.")
    )) {
      expect(e.available).toBe(true);
      expect(e.reason).toBe("available");
      expect(e.advisories).toContain("target_decommissioned");
    }
    expect(byAction(evaluations, "open_details").advisories).toEqual([]);
  });

  test("decommissioned deployment target (serverStatus): available, advisory only", () => {
    const evaluations = evaluate("deployment", {
      record: liveRecord({
        state: "converged",
        serverStatus: "decommissioned",
        serverId: "srv-1"
      })
    });
    for (const e of evaluations.filter((x) =>
      x.action.startsWith("operation.")
    )) {
      expect(e.available).toBe(true);
      expect(e.advisories).toContain("target_decommissioned");
    }
  });

  test("stale or unknown freshness: still available; lifecycle ops carry target_stale, status/preflight do not", () => {
    for (const freshness of ["stale", "unknown"] as const) {
      const evaluations = evaluate("deployment", {
        record: liveRecord({ state: "converged", freshness })
      });
      for (const e of evaluations) {
        expect(e.available).toBe(true);
        expect(e.reason).toBe("available");
      }
      for (const op of [
        "start",
        "stop",
        "restart",
        "update",
        "backup",
        "rollback"
      ]) {
        expect(byAction(evaluations, `operation.${op}`).advisories).toEqual([
          "target_stale"
        ]);
      }
      for (const op of ["status", "preflight"]) {
        expect(byAction(evaluations, `operation.${op}`).advisories).toEqual([]);
      }
      expect(byAction(evaluations, "open_details").advisories).toEqual([]);
    }
  });

  test("stale and decommissioned together: both advisories, still available", () => {
    const e = byAction(
      evaluate("deployment", {
        record: liveRecord({
          state: "converged",
          freshness: "stale",
          serverStatus: "decommissioned"
        })
      }),
      "operation.start"
    );
    expect(e.available).toBe(true);
    expect(e.advisories).toEqual(["target_stale", "target_decommissioned"]);
  });

  test("live, present deployment: all operations available with no advisories", () => {
    const evaluations = evaluate("deployment", {
      record: liveRecord({ state: "converged" })
    });
    for (const e of evaluations) {
      expect(e.available).toBe(true);
      expect(e.reason).toBe("available");
      expect(e.advisories).toEqual([]);
    }
    const op = byAction(evaluations, "operation.start");
    expect(op.method).toBe("POST");
    expect(op.path).toBe("/api/v1/omes/operations");
    expect(op.mutating).toBe(true);
  });

  test("a server only offers open_details, status and preflight", () => {
    expect(evaluate("server").map((e) => e.action)).toEqual([
      "open_details",
      "operation.status",
      "operation.preflight"
    ]);
  });
});

describe("backups", () => {
  test("backup.restore is available for any existing backup; non-completed/verified carries backup_not_verified", () => {
    for (const state of [
      "completed",
      "verified",
      "in_progress",
      "failed",
      null
    ]) {
      const e = byAction(
        evaluate("backup", { record: liveRecord({ state }) }),
        "backup.restore"
      );
      const verified = state === "completed" || state === "verified";
      expect(e.available).toBe(true);
      expect(e.reason).toBe("available");
      expect(e.advisories).toEqual(verified ? [] : ["backup_not_verified"]);
      expect(e.path).toBe("/api/v1/omes/backups/abc-123/restore");
    }
  });

  test("an old (stale) backup is still restorable with no advisory", () => {
    const e = byAction(
      evaluate("backup", {
        record: liveRecord({ state: "completed", freshness: "stale" })
      }),
      "backup.restore"
    );
    expect(e.available).toBe(true);
    expect(e.advisories).toEqual([]);
  });
});

describe("approval_item", () => {
  test("inbox link is a non-mutating GET to the canonical inbox", () => {
    const e = byAction(
      evaluate("approval_item", { sourceId: "wf-inst-1" }),
      "approval.open_in_inbox"
    );
    expect(e.available).toBe(true);
    expect(e.mutating).toBe(false);
    expect(e.method).toBe("GET");
    expect(e.requiresApproval).toBe(false);
    expect(e.path).toBe(
      `/admin/approvals?workflowKey=${OMES_DESTRUCTIVE_WORKFLOW_KEY}&instance=wf-inst-1`
    );
  });
});

describe("permissions, not_found and historical mode", () => {
  test("permission false -> permission_denied (including non-mutating actions)", () => {
    for (const kind of MISSION_CONTROL_KINDS) {
      const evaluations = evaluate(kind, {
        permissions: {},
        record: liveRecord({ state: "queued" })
      });
      for (const e of evaluations) {
        expect(e.reason).toBe("permission_denied");
        expect(e.available).toBe(false);
      }
    }
  });

  test("permission is checked before state eligibility", () => {
    const e = byAction(
      evaluate("job", {
        record: liveRecord({ state: "running" }),
        permissions: { open_details: true, "job.cancel": false }
      }),
      "job.cancel"
    );
    expect(e.reason).toBe("permission_denied");
  });

  test("a single denied permission only affects that action", () => {
    const evaluations = evaluate("deployment", {
      record: liveRecord({ state: "converged" }),
      permissions: {
        ...allGranted("deployment"),
        "operation.stop": false
      }
    });
    expect(byAction(evaluations, "operation.stop").reason).toBe(
      "permission_denied"
    );
    expect(byAction(evaluations, "operation.start").available).toBe(true);
  });

  test("null record -> not_found for every action of every kind, in either mode", () => {
    for (const kind of MISSION_CONTROL_KINDS) {
      for (const mode of ["live", "historical"] as const) {
        for (const e of evaluate(kind, { record: null, mode })) {
          expect(e.reason).toBe("not_found");
          expect(e.available).toBe(false);
        }
      }
    }
  });

  test("historical mode: no mutating action is available; reads are unaffected", () => {
    for (const kind of MISSION_CONTROL_KINDS) {
      const evaluations = evaluate(kind, {
        mode: "historical",
        record: liveRecord({ state: "queued" })
      });
      for (const e of evaluations) {
        if (e.mutating) {
          expect(e.available).toBe(false);
          expect(e.reason).toBe("historical_mode");
        } else {
          expect(e.available).toBe(true);
        }
      }
    }
  });
});

describe("advisories", () => {
  test("closed enum", () => {
    expect([...MISSION_CONTROL_ACTION_ADVISORIES].map(String).sort()).toEqual(
      ["backup_not_verified", "target_decommissioned", "target_stale"].sort()
    );
  });

  test("availability depends only on endpoint rules: freshness, server status and backup state never change it", () => {
    for (const kind of MISSION_CONTROL_KINDS) {
      // The only state-dependent availability is the job state rules.
      const stateAffects = (action: string) =>
        action === "job.cancel" || action === "job.requeue";
      for (const freshness of ["live", "stale", "unknown"] as const) {
        for (const state of [
          "decommissioned",
          "failed",
          "queued",
          "online",
          null
        ]) {
          for (const serverStatus of ["decommissioned", "online", null]) {
            const evaluations = evaluate(kind, {
              record: liveRecord({ state, freshness, serverStatus })
            });
            for (const e of evaluations) {
              const expected = stateAffects(e.action)
                ? e.action === "job.cancel"
                  ? state === "queued"
                  : state === "failed"
                : true;
              expect(e.available).toBe(expected);
              for (const adv of e.advisories) {
                expect(MISSION_CONTROL_ACTION_ADVISORIES).toContain(adv);
              }
            }
          }
        }
      }
    }
  });

  test("advisories are empty when the record is missing and for non-operation actions", () => {
    for (const kind of MISSION_CONTROL_KINDS) {
      for (const e of evaluate(kind, { record: null })) {
        expect(e.advisories).toEqual([]);
      }
      for (const e of evaluate(kind, {
        record: liveRecord({ state: "decommissioned", freshness: "stale" })
      })) {
        if (
          e.action.startsWith("operation.") ||
          e.action === "backup.restore"
        ) {
          continue;
        }
        expect(e.advisories).toEqual([]);
      }
    }
  });
});

describe("requiresApproval", () => {
  test("true for stop, rollback and restore only", () => {
    const flagged = new Set<string>();
    for (const kind of MISSION_CONTROL_KINDS) {
      for (const e of evaluate(kind)) {
        if (e.requiresApproval) flagged.add(e.action);
      }
    }
    expect([...flagged].sort()).toEqual(
      ["backup.restore", "operation.rollback", "operation.stop"].sort()
    );
  });

  test("requiresApproval is independent of availability", () => {
    const e = byAction(
      evaluate("deployment", { record: null }),
      "operation.stop"
    );
    expect(e.available).toBe(false);
    expect(e.requiresApproval).toBe(true);
  });
});

describe("actionPermissionGuard", () => {
  test("covers every action in the vendored actions table", () => {
    for (const action of allMissionControlActionNames()) {
      if (action === "open_details") continue;
      const guard = actionPermissionGuard(action);
      expect(guard.moduleKey.length).toBeGreaterThan(0);
      const declared = (
        sourceMap.actions[action] as unknown as { permission: string }
      ).permission;
      expect(`${guard.moduleKey}.${guard.activityCode}.${guard.action}`).toBe(
        declared
      );
    }
  });

  test("open_details resolves to the kind's source read guard", () => {
    for (const kind of MISSION_CONTROL_KINDS) {
      const guard = actionPermissionGuard("open_details", kind);
      expect(guard.action).toBe("read");
    }
    expect(actionPermissionGuard("open_details", "job")).toEqual(
      OMES_GUARDS.jobs.read
    );
    expect(actionPermissionGuard("open_details", "health_report")).toEqual(
      OMES_GUARDS.servers.read
    );
    expect(actionPermissionGuard("open_details", "approval_item")).toEqual({
      moduleKey: "workflow",
      activityCode: "approval",
      action: "read"
    });
  });

  test("reuses the existing guards, never a new permission", () => {
    expect(actionPermissionGuard("job.cancel")).toEqual(
      OMES_GUARDS.jobs.cancel
    );
    expect(actionPermissionGuard("job.requeue")).toEqual(
      OMES_GUARDS.jobs.approve
    );
    expect(actionPermissionGuard("backup.restore")).toEqual(
      OMES_GUARDS.backups.restore
    );
    expect(actionPermissionGuard("operation.rollback")).toEqual(
      OMES_GUARDS.backups.rollback
    );
    expect(actionPermissionGuard("operation.status")).toEqual(
      OMES_GUARDS.deployments.read
    );
  });

  test("unknown actions and open_details without a kind throw", () => {
    expect(() => actionPermissionGuard("operation.install")).toThrow();
    expect(() => actionPermissionGuard("operation.restore")).toThrow();
    expect(() => actionPermissionGuard("kill_all_ai")).toThrow();
    expect(() => actionPermissionGuard("")).toThrow();
    expect(() => actionPermissionGuard("open_details")).toThrow();
  });
});

describe("mapMutationOutcome", () => {
  const destructive201 = {
    success: true,
    data: { operationRequest: { id: "r1", workflowInstanceId: "wf-1" } }
  };
  const plain201 = {
    success: true,
    data: { operationRequest: { id: "r1", workflowInstanceId: null } }
  };
  const err = (code: string) => ({ success: false, error: { code } });

  test("2xx is accepted, never succeeded", () => {
    for (const status of [200, 201, 202]) {
      expect(mapMutationOutcome(status)).toBe("accepted");
      expect(mapMutationOutcome(status, plain201)).toBe("accepted");
    }
    expect(mapMutationOutcome(201, { success: true, data: { job: {} } })).toBe(
      "accepted"
    );
    expect(mapMutationOutcome(201, undefined)).toBe("accepted");
    expect(mapMutationOutcome(201, "garbage")).toBe("accepted");
  });

  test("a response carrying a workflow instance id -> approval_required", () => {
    expect(mapMutationOutcome(201, destructive201)).toBe("approval_required");
  });

  test("409 APPROVAL_WORKFLOW_NOT_CONFIGURED -> approval_required", () => {
    expect(
      mapMutationOutcome(409, err("APPROVAL_WORKFLOW_NOT_CONFIGURED"))
    ).toBe("approval_required");
  });

  test("other 4xx -> rejected", () => {
    expect(mapMutationOutcome(409, err("JOB_NOT_CANCELLABLE"))).toBe(
      "rejected"
    );
    expect(mapMutationOutcome(409, err("IDEMPOTENCY_CONFLICT"))).toBe(
      "rejected"
    );
    expect(mapMutationOutcome(409)).toBe("rejected");
    for (const status of [400, 401, 403, 404, 422, 429]) {
      expect(mapMutationOutcome(status, err("X"))).toBe("rejected");
    }
  });

  test("5xx, network errors and timeouts -> unknown", () => {
    for (const status of [500, 502, 503, 504]) {
      expect(mapMutationOutcome(status)).toBe("unknown");
    }
    expect(mapMutationOutcome("network_error")).toBe("unknown");
    expect(mapMutationOutcome("timeout")).toBe("unknown");
    expect(mapMutationOutcome("timeout", destructive201)).toBe("unknown");
  });

  test("an unexpected 2xx/3xx is unknown rather than success", () => {
    expect(mapMutationOutcome(204)).toBe("unknown");
    expect(mapMutationOutcome(302)).toBe("unknown");
  });
});

describe("endpoint addressing (#267): job and backup requests address the row id, not the scene source_id", () => {
  const ROW = "0b9b6f64-1e2f-4f0a-8a55-6a1d6f3f2c11";

  test("a record's pathId is used for job cancel / requeue and backup restore, and only for those", () => {
    const job = evaluateMissionControlActions({
      kind: "job",
      sourceId: "job_a_1",
      record: { state: "queued", freshness: "live", pathId: ROW },
      permissions: { "job.cancel": true, "job.requeue": true },
      mode: "live"
    });
    expect(job.find((a) => a.action === "job.cancel")?.path).toBe(
      `/api/v1/omes/jobs/${ROW}/cancel`
    );
    expect(job.find((a) => a.action === "job.requeue")?.path).toBe(
      `/api/v1/omes/jobs/${ROW}/approve`
    );

    const backup = evaluateMissionControlActions({
      kind: "backup",
      sourceId: "bk-1",
      record: { state: "verified", freshness: "live", pathId: ROW },
      permissions: { "backup.restore": true },
      mode: "live"
    });
    expect(backup.find((a) => a.action === "backup.restore")?.path).toBe(
      `/api/v1/omes/backups/${ROW}/restore`
    );

    // The inbox link still addresses the workflow instance (= source_id).
    const approval = evaluateMissionControlActions({
      kind: "approval_item",
      sourceId: "inst-1",
      record: { state: "pending", freshness: "live", pathId: ROW },
      permissions: { "approval.open_in_inbox": true, open_details: true },
      mode: "live"
    });
    expect(
      approval.find((a) => a.action === "approval.open_in_inbox")?.path
    ).toBe(
      `/admin/approvals?workflowKey=${OMES_DESTRUCTIVE_WORKFLOW_KEY}&instance=inst-1`
    );
  });

  test("without a pathId the path falls back to the source id (and is URL-encoded)", () => {
    const job = evaluateMissionControlActions({
      kind: "job",
      sourceId: "job:a.1",
      record: { state: "queued", freshness: "live" },
      permissions: { "job.cancel": true },
      mode: "live"
    });
    expect(job.find((a) => a.action === "job.cancel")?.path).toBe(
      "/api/v1/omes/jobs/job%3Aa.1/cancel"
    );
  });
});

describe("the outcome mapper is browser-safe (#267)", () => {
  test("mission-control-outcome.ts has no imports, so the client bundles nothing else", () => {
    const source = readFileSync(
      join(
        import.meta.dir,
        "..",
        "src/modules/omes-control/domain/mission-control-outcome.ts"
      ),
      "utf8"
    );
    expect(source).not.toMatch(/^\s*import\s/m);
  });

  test("workflowInstanceIdOf reads only a non-empty string instance id", async () => {
    const { workflowInstanceIdOf } =
      await import("../src/modules/omes-control/domain/mission-control-outcome");
    expect(
      workflowInstanceIdOf({
        data: { operationRequest: { workflowInstanceId: "w-1" } }
      })
    ).toBe("w-1");
    for (const body of [
      null,
      "x",
      {},
      { data: {} },
      { data: { operationRequest: {} } },
      { data: { operationRequest: { workflowInstanceId: "" } } },
      { data: { operationRequest: { workflowInstanceId: 7 } } }
    ]) {
      expect(workflowInstanceIdOf(body)).toBeNull();
    }
  });
});
