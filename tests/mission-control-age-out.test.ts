import { describe, expect, test } from "bun:test";
import { ageOutScene } from "../src/lib/ui/mission-control/vocab";
import type {
  MissionControlSceneNode,
  MissionControlSceneView,
  MissionControlVisualState
} from "../src/modules/omes-control/domain/mission-control-types";

/**
 * ahliweb/omes#265: "failure to refresh retains last-known data as stale".
 * `ageOutScene` is the browser's downgrade after a missed refresh window and
 * must follow the same rule as a stale source (OMES ADR-0031): a last-known
 * success is never shown as current, a last-known problem never disappears.
 */
function node(
  visual: MissionControlVisualState,
  freshness: MissionControlSceneNode["freshness"] = "live"
): MissionControlSceneNode {
  return {
    node_id: "n1",
    kind: "server",
    source_id: "srv-1",
    label: "srv-1",
    source_state: "online",
    visual_state: visual,
    freshness,
    observed_at: "2026-10-02T08:00:00Z",
    detail_route: "/admin/omes/servers"
  };
}

function scene(nodes: MissionControlSceneNode[]): MissionControlSceneView {
  return {
    schema_version: "1.0.0",
    source_map_version: "1.0.0",
    tenant_id: "t1",
    generated_at: "2026-10-02T08:00:00Z",
    mode: "live",
    as_of: "2026-10-02T08:00:00Z",
    sources: [
      {
        source_kind: "omes_server_inventory",
        authority: "omes",
        status: "available",
        observed_at: "2026-10-02T08:00:00Z"
      },
      {
        source_kind: "omes_job_status",
        authority: "omes",
        status: "unavailable",
        observed_at: null
      }
    ],
    nodes,
    relations: [],
    truncated: { nodes: 0, relations: 0 }
  };
}

describe("ageOutScene", () => {
  test.each([
    ["ok", "stale"],
    ["in_progress", "stale"],
    ["pending", "stale"],
    ["cancelled", "stale"],
    ["informational", "stale"],
    ["stale", "stale"],
    ["failed", "failed"],
    ["warning", "warning"],
    ["unknown", "unknown"]
  ] as const)("live %s becomes %s", (before, after) => {
    const aged = ageOutScene(scene([node(before)]));
    expect(aged.nodes[0]?.visual_state).toBe(after);
    expect(aged.nodes[0]?.freshness).toBe("stale");
  });

  test("unknown freshness is left unknown, never upgraded to stale", () => {
    const aged = ageOutScene(scene([node("unknown", "unknown")]));
    expect(aged.nodes[0]?.freshness).toBe("unknown");
    expect(aged.nodes[0]?.visual_state).toBe("unknown");
  });

  test("available sources become stale; unavailable ones stay unavailable", () => {
    const aged = ageOutScene(scene([]));
    expect(aged.sources.map((s) => s.status)).toEqual(["stale", "unavailable"]);
  });

  test("never mutates its input", () => {
    const input = scene([node("ok")]);
    const snapshot = JSON.stringify(input);
    ageOutScene(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
