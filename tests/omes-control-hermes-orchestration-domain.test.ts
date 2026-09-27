/**
 * Pure-unit tests for the Hermes orchestration domain layer (Issue
 * ahliweb/omes#246, OMES issue #183, ADR-0028): freshness recomputation,
 * node-state/depth rollups, and the reused disallowed-evidence-key scanner.
 * No database.
 */
import { describe, expect, test } from "bun:test";

import {
  classifyOrchestrationFreshness,
  findDisallowedEvidenceKeys,
  ORCHESTRATION_STATES,
  projectOrchestrationEvent,
  projectOrchestrationTree,
  type StoredOrchestrationEvent,
  type StoredOrchestrationNode,
  type StoredOrchestrationTree
} from "../src/modules/omes-control/domain/hermes-orchestration";

const NOW = new Date("2026-09-27T12:00:00Z");

function node(
  overrides: Partial<StoredOrchestrationNode> = {}
): StoredOrchestrationNode {
  return {
    subagentId: "sub-lead-001",
    parentSubagentId: null,
    role: "lead_planner",
    goal: "Orchestrate release verification",
    state: "RUNNING",
    startedAt: "2026-09-27T11:58:00Z",
    completedAt: null,
    durationSeconds: 120,
    activeTool: "delegate_task",
    stepCount: 3,
    summary: "Delegated sub-tasks",
    children: [],
    ...overrides
  };
}

function tree(
  overrides: Partial<StoredOrchestrationTree> = {}
): StoredOrchestrationTree {
  return {
    serverId: "srv-prod-01",
    sessionId: "sess-main-12345",
    rootSubagentId: "sub-lead-001",
    generatedAt: "2026-09-27T11:59:30Z",
    activeCount: 1,
    completedCount: 0,
    failedCount: 0,
    nodes: [node()],
    correlationId: "corr-1",
    receivedAt: "2026-09-27T11:59:31Z",
    ...overrides
  };
}

describe("classifyOrchestrationFreshness", () => {
  test("a recent generated_at within the window is live", () => {
    expect(classifyOrchestrationFreshness("2026-09-27T11:59:00Z", NOW)).toBe(
      "live"
    );
  });

  test("a generated_at older than the default 120s window is stale", () => {
    expect(classifyOrchestrationFreshness("2026-09-27T11:50:00Z", NOW)).toBe(
      "stale"
    );
  });

  test("a missing/unparsable generated_at is unknown, never live", () => {
    expect(classifyOrchestrationFreshness(null, NOW)).toBe("unknown");
    expect(classifyOrchestrationFreshness(undefined, NOW)).toBe("unknown");
    expect(classifyOrchestrationFreshness("not-a-date", NOW)).toBe("unknown");
  });

  test("a generated_at in the future (clock/producer problem) is unknown, never live", () => {
    expect(classifyOrchestrationFreshness("2026-09-28T00:00:00Z", NOW)).toBe(
      "unknown"
    );
  });

  test("a custom max-age window is honored", () => {
    expect(
      classifyOrchestrationFreshness("2026-09-27T11:59:00Z", NOW, 30)
    ).toBe("stale");
  });
});

describe("projectOrchestrationTree — staleness and node-state rollups are recomputed, never trusted", () => {
  test("a live tree with a running root reports isActive true", () => {
    const result = projectOrchestrationTree(tree(), NOW);
    expect(result.freshness).toBe("live");
    expect(result.isActive).toBe(true);
    expect(result.activeCount).toBe(1);
  });

  test("a stale generated_at is never reported as live, even if a node is still RUNNING", () => {
    const result = projectOrchestrationTree(
      tree({ generatedAt: "2026-09-27T11:00:00Z" }),
      NOW
    );
    expect(result.freshness).toBe("stale");
    expect(result.isActive).toBe(false);
  });

  test("a stale tree's nodes are all marked isHistorical, so a renderer never paints their last-reported state as live", () => {
    const result = projectOrchestrationTree(
      tree({
        generatedAt: "2026-09-27T11:00:00Z",
        nodes: [node({ state: "RUNNING" })]
      }),
      NOW
    );
    expect(result.freshness).toBe("stale");
    expect(result.nodes[0]!.effectiveState).toBe("RUNNING");
    expect(result.nodes[0]!.isHistorical).toBe(true);
  });

  test("an unknown-freshness tree's nodes are also marked isHistorical (unknown is never treated as live)", () => {
    const result = projectOrchestrationTree(
      tree({ generatedAt: "not-a-date" }),
      NOW
    );
    expect(result.freshness).toBe("unknown");
    expect(result.nodes[0]!.isHistorical).toBe(true);
  });

  test("a live tree's nodes are NOT marked isHistorical", () => {
    const result = projectOrchestrationTree(tree(), NOW);
    expect(result.freshness).toBe("live");
    expect(result.nodes[0]!.isHistorical).toBe(false);
  });

  test("stored active/completed/failed counts are IGNORED — recomputed from actual node states", () => {
    const result = projectOrchestrationTree(
      tree({
        // Stored counts claim everything failed; actual node state is RUNNING.
        activeCount: 0,
        completedCount: 0,
        failedCount: 99,
        nodes: [node({ state: "RUNNING" })]
      }),
      NOW
    );
    expect(result.activeCount).toBe(1);
    expect(result.failedCount).toBe(0);
  });

  test("an unrecognized node state is projected as UNKNOWN and counted separately", () => {
    const result = projectOrchestrationTree(
      tree({ nodes: [node({ state: "TOTALLY_FINE_HONEST" })] }),
      NOW
    );
    expect(ORCHESTRATION_STATES as readonly string[]).not.toContain(
      "TOTALLY_FINE_HONEST"
    );
    expect(result.nodes[0]!.effectiveState).toBe("UNKNOWN");
    expect(result.unknownCount).toBe(1);
    expect(result.activeCount).toBe(0);
  });

  test("depth is computed by BFS from the declared root", () => {
    const result = projectOrchestrationTree(
      tree({
        nodes: [
          node({ subagentId: "root", children: ["child-a", "child-b"] }),
          node({
            subagentId: "child-a",
            parentSubagentId: "root",
            children: ["grandchild"]
          }),
          node({
            subagentId: "child-b",
            parentSubagentId: "root",
            children: []
          }),
          node({
            subagentId: "grandchild",
            parentSubagentId: "child-a",
            children: []
          })
        ],
        rootSubagentId: "root"
      }),
      NOW
    );
    const byId = new Map(result.nodes.map((n) => [n.subagentId, n.depth]));
    expect(byId.get("root")).toBe(0);
    expect(byId.get("child-a")).toBe(1);
    expect(byId.get("child-b")).toBe(1);
    expect(byId.get("grandchild")).toBe(2);
  });

  test("a node unreachable from the declared root gets depth -1, never hidden", () => {
    const result = projectOrchestrationTree(
      tree({
        nodes: [
          node({ subagentId: "root", children: [] }),
          node({
            subagentId: "orphan",
            parentSubagentId: "someone-else",
            children: []
          })
        ],
        rootSubagentId: "root"
      }),
      NOW
    );
    expect(result.nodes).toHaveLength(2);
    const orphan = result.nodes.find((n) => n.subagentId === "orphan");
    expect(orphan?.depth).toBe(-1);
  });

  test("a process restart with a missing/never-terminal RUNNING node still reconciles to stale, never invented completion", () => {
    // Issue #183's own requirement: a stalled connection must never render
    // as successful completion — this is exactly what `freshness` alone
    // (not node state) must guarantee here.
    const result = projectOrchestrationTree(
      tree({
        generatedAt: "2026-09-20T00:00:00Z",
        nodes: [node({ state: "RUNNING", completedAt: null })]
      }),
      NOW
    );
    expect(result.freshness).toBe("stale");
    expect(result.nodes[0]!.effectiveState).toBe("RUNNING");
    expect(result.isActive).toBe(false);
  });
});

describe("projectOrchestrationEvent", () => {
  function event(
    overrides: Partial<StoredOrchestrationEvent> = {}
  ): StoredOrchestrationEvent {
    return {
      id: "evt-1",
      eventType: "subagent_start",
      serverId: "srv-prod-01",
      sessionId: "sess-main-12345",
      turnId: "turn-001",
      subagentId: "sub-code-001",
      parentSubagentId: null,
      role: "code_refactorer",
      goal: "Refactor indexes",
      state: "RUNNING",
      stepNumber: 1,
      activeTool: "view_file",
      summary: "Started analysis",
      hermesVersion: "v2026.9.14",
      eventTimestamp: "2026-09-27T12:00:00Z",
      correlationId: "corr-1",
      receivedAt: "2026-09-27T12:00:01Z",
      ...overrides
    };
  }

  test("a recognized event type/state pass through as their effective form", () => {
    const result = projectOrchestrationEvent(event());
    expect(result.effectiveEventType).toBe("subagent_start");
    expect(result.effectiveState).toBe("RUNNING");
  });

  test("an unrecognized event type is projected as UNKNOWN", () => {
    const result = projectOrchestrationEvent(
      event({ eventType: "subagent_teleport" })
    );
    expect(result.effectiveEventType).toBe("UNKNOWN");
  });

  test("an unrecognized state is projected as UNKNOWN", () => {
    const result = projectOrchestrationEvent(event({ state: "VIBING" }));
    expect(result.effectiveState).toBe("UNKNOWN");
  });

  test("an event stamped with a live session freshness is not historical", () => {
    const result = projectOrchestrationEvent(event(), "live");
    expect(result.sessionFreshness).toBe("live");
    expect(result.isHistorical).toBe(false);
  });

  test("an event stamped with a stale session freshness is historical, even though the event itself is timestamped/real", () => {
    const result = projectOrchestrationEvent(event(), "stale");
    expect(result.sessionFreshness).toBe("stale");
    expect(result.isHistorical).toBe(true);
    // The event's own recognized state is unchanged — only the RENDER
    // treatment (isHistorical) differs; the domain never overwrites what
    // was actually reported.
    expect(result.effectiveState).toBe("RUNNING");
  });

  test("an event with no session freshness passed defaults to unknown/historical, never live", () => {
    const result = projectOrchestrationEvent(event());
    expect(result.sessionFreshness).toBe("unknown");
    expect(result.isHistorical).toBe(true);
  });
});

describe("findDisallowedEvidenceKeys (reused as-is from domain/ai-privacy.ts)", () => {
  test("a bounded, clean node payload has no disallowed keys", () => {
    expect(findDisallowedEvidenceKeys([node()])).toEqual([]);
  });

  test("a prompt/transcript-shaped key nested in node data is found regardless of depth", () => {
    const found = findDisallowedEvidenceKeys([
      node({ summary: "fine" }),
      { nested: { raw_provider_response: "...", chain_of_thought: "..." } }
    ]);
    expect(found).toContain("raw_provider_response");
    expect(found).toContain("chain_of_thought");
  });
});
