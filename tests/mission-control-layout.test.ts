/**
 * Pure unit tests for the deterministic Mission Control layout (Issue
 * ahliweb/omes#265). Positions are presentation only: the same scene must
 * always lay out identically, every node must get a finite position, and no
 * relation shape (cycles, missing endpoints, deep delegation) may break it.
 */
import { describe, expect, test } from "bun:test";

import { layoutScene } from "../src/lib/ui/mission-control/layout";
import type {
  MissionControlKind,
  MissionControlSceneRelation
} from "../src/modules/omes-control/domain/mission-control-types";

type N = { node_id: string; kind: MissionControlKind };

function nodes(kinds: Record<string, MissionControlKind>): N[] {
  return Object.entries(kinds).map(([node_id, kind]) => ({ node_id, kind }));
}

const rel = (
  from: string,
  to: string,
  relation: MissionControlSceneRelation["relation"]
): MissionControlSceneRelation => ({ from, to, relation });

const finite = (p: readonly number[]) => p.every((v) => Number.isFinite(v));

/** A representative mixed scene. */
function sample() {
  const list = nodes({
    n1: "server",
    n2: "server",
    n3: "deployment",
    n4: "deployment",
    n5: "health_report",
    n6: "backup",
    n7: "job",
    n8: "job",
    n9: "hermes_subagent",
    n10: "hermes_subagent",
    n11: "hermes_subagent",
    n12: "approval_item",
    n13: "architecture_plane",
    n14: "capability",
    n15: "capability",
    n16: "repository_milestone",
    n17: "ai_privacy_posture"
  });
  const relations = [
    rel("n1", "n3", "hosts"),
    rel("n1", "n4", "hosts"),
    rel("n5", "n1", "describes"),
    rel("n6", "n2", "protects"),
    rel("n7", "n3", "targets"),
    rel("n9", "n10", "delegates_to"),
    rel("n10", "n11", "delegates_to"),
    rel("n14", "n13", "member_of"),
    rel("n15", "n13", "member_of"),
    rel("n12", "n7", "awaits_decision_for")
  ];
  return { list, relations };
}

describe("layoutScene", () => {
  test("same input yields exactly the same output", () => {
    const { list, relations } = sample();
    const a = layoutScene(list, relations);
    const b = layoutScene(structuredClone(list), structuredClone(relations));
    expect(b).toEqual(a);
  });

  test("every node gets a finite, distinct position index-aligned with the input", () => {
    const { list, relations } = sample();
    const { positions } = layoutScene(list, relations);

    expect(positions).toHaveLength(list.length);
    for (const p of positions) expect(finite(p)).toBe(true);
    const unique = new Set(
      positions.map((p) => p.map((v) => v.toFixed(3)).join())
    );
    expect(unique.size).toBe(list.length);
  });

  test("bounds enclose every position", () => {
    const { list, relations } = sample();
    const { positions, min, max } = layoutScene(list, relations);
    for (const p of positions) {
      for (let a = 0; a < 3; a++) {
        expect(p[a] as number).toBeGreaterThanOrEqual(min[a] as number);
        expect(p[a] as number).toBeLessThanOrEqual(max[a] as number);
      }
    }
  });

  test("an empty scene lays out to nothing without throwing", () => {
    const { positions, min, max } = layoutScene([], []);
    expect(positions).toEqual([]);
    expect(min).toEqual([0, 0, 0]);
    expect(max).toEqual([0, 0, 0]);
  });

  test("deployments are stacked beside their hosting server, health/backup alongside it", () => {
    const { list, relations } = sample();
    const { positions } = layoutScene(list, relations);
    const at = (id: string) =>
      positions[list.findIndex((n) => n.node_id === id)]!;
    const dist = (a: readonly number[], b: readonly number[]) =>
      Math.hypot(a[0]! - b[0]!, a[2]! - b[2]!);

    expect(dist(at("n3"), at("n1"))).toBeLessThan(3);
    expect(dist(at("n4"), at("n1"))).toBeLessThan(3);
    // Two deployments on one server stack vertically, not on top of each other.
    expect(at("n4")[1]).toBeGreaterThan(at("n3")[1]!);
    expect(dist(at("n5"), at("n1"))).toBeLessThan(3);
    expect(dist(at("n6"), at("n2"))).toBeLessThan(3);
    // A server is far from the other server.
    expect(dist(at("n1"), at("n2"))).toBeGreaterThan(4);
  });

  test("orphans (no hosting server) are still placed", () => {
    const list = nodes({ n1: "deployment", n2: "backup", n3: "health_report" });
    const { positions } = layoutScene(list, []);
    expect(positions.every(finite)).toBe(true);
    expect(new Set(positions.map((p) => p.join())).size).toBe(3);
  });

  test("a relation naming an absent node is ignored, never invented", () => {
    const list = nodes({ n1: "server", n2: "deployment" });
    const { positions } = layoutScene(list, [rel("n1", "n99", "hosts")]);
    expect(positions.every(finite)).toBe(true);
  });

  test("nested delegation: each level sits farther from the root than the last", () => {
    const list = nodes({
      a: "hermes_subagent",
      b: "hermes_subagent",
      c: "hermes_subagent",
      d: "hermes_subagent",
      e: "hermes_subagent"
    });
    const relations = [
      rel("a", "b", "delegates_to"),
      rel("a", "c", "delegates_to"),
      rel("b", "d", "delegates_to"),
      rel("d", "e", "delegates_to")
    ];
    const { positions } = layoutScene(list, relations);
    // Zone placement recentres the footprint, so measure from the root node.
    const root = positions[0]!;
    const radius = (i: number) =>
      Math.hypot(positions[i]![0] - root[0], positions[i]![2] - root[2]);

    // One root -> it sits at the centre of the radial tree.
    const r = [0, 1, 2, 3, 4].map(radius);
    expect(r[0]!).toBe(0);
    expect(r[1]!).toBeGreaterThan(r[0]!);
    expect(r[2]!).toBeGreaterThan(r[0]!);
    expect(r[3]!).toBeGreaterThan(r[1]!);
    expect(r[4]!).toBeGreaterThan(r[3]!);
    expect(
      new Set(positions.map((p) => p.map((v) => v.toFixed(2)).join())).size
    ).toBe(5);
  });

  test("a deep delegation chain of 400 agents lays out without overflow or collision of depth", () => {
    const ids = Array.from({ length: 400 }, (_, i) => `n${i}`);
    const list = ids.map((node_id) => ({
      node_id,
      kind: "hermes_subagent" as const
    }));
    const relations = ids
      .slice(1)
      .map((id, i) => rel(ids[i]!, id, "delegates_to"));
    const { positions } = layoutScene(list, relations);
    expect(positions).toHaveLength(400);
    expect(positions.every(finite)).toBe(true);
  });

  test("delegation cycles and self-loops terminate and still place every node", () => {
    const list = nodes({
      a: "hermes_subagent",
      b: "hermes_subagent",
      c: "hermes_subagent"
    });
    const relations = [
      rel("a", "b", "delegates_to"),
      rel("b", "c", "delegates_to"),
      rel("c", "a", "delegates_to"),
      rel("a", "a", "delegates_to")
    ];
    const { positions } = layoutScene(list, relations);
    expect(positions).toHaveLength(3);
    expect(positions.every(finite)).toBe(true);
  });

  test("several independent roots share the circle without overlapping", () => {
    const list = nodes({
      r1: "hermes_subagent",
      r2: "hermes_subagent",
      r3: "hermes_subagent",
      c1: "hermes_subagent"
    });
    const { positions } = layoutScene(list, [rel("r1", "c1", "delegates_to")]);
    expect(
      new Set(positions.map((p) => p.map((v) => v.toFixed(2)).join())).size
    ).toBe(4);
  });

  test("architecture: capabilities sit in their plane's column, loose ones get their own", () => {
    const list = nodes({
      p1: "architecture_plane",
      p2: "architecture_plane",
      c1: "capability",
      c2: "capability",
      c3: "capability"
    });
    const { positions } = layoutScene(list, [
      rel("c1", "p1", "member_of"),
      rel("c2", "p2", "member_of")
    ]);
    const x = (i: number) => positions[i]![0];
    expect(x(2)).toBeCloseTo(x(0), 5);
    expect(x(3)).toBeCloseTo(x(1), 5);
    expect(x(4)).not.toBeCloseTo(x(0), 1);
    expect(x(4)).not.toBeCloseTo(x(1), 1);
  });

  test("wide rows wrap rather than extending without bound", () => {
    const list = Array.from({ length: 40 }, (_, i) => ({
      node_id: `j${i}`,
      kind: "job" as const
    }));
    const { min, max } = layoutScene(list, []);
    expect(max[0] - min[0]).toBeLessThan(40 * 2.6);
    expect(max[2] - min[2]).toBeGreaterThan(0);
  });

  test("zones never overlap: each zone's footprint is a separate box on the ground plane", () => {
    const { list, relations } = sample();
    const { positions } = layoutScene(list, relations);
    const zones: MissionControlKind[][] = [
      ["server", "deployment", "health_report", "backup"],
      ["job"],
      ["hermes_subagent"],
      ["approval_item"],
      ["architecture_plane", "capability"],
      ["repository_milestone"],
      ["ai_privacy_posture"]
    ];
    const boxes = zones.map((kinds) => {
      const pts = list.flatMap((n, i) =>
        kinds.includes(n.kind) ? [positions[i]!] : []
      );
      return {
        x0: Math.min(...pts.map((p) => p[0])),
        x1: Math.max(...pts.map((p) => p[0])),
        z0: Math.min(...pts.map((p) => p[2])),
        z1: Math.max(...pts.map((p) => p[2]))
      };
    });
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const apart = a.x1 < b.x0 || b.x1 < a.x0 || a.z1 < b.z0 || b.z1 < a.z0;
        expect(apart, `${i} vs ${j}`).toBe(true);
      }
    }
  });

  test("the scene keeps a screen-like aspect ratio instead of one long strip", () => {
    const list = [
      ...Array.from({ length: 9 }, (_, i) => ({
        node_id: `s${i}`,
        kind: "server" as const
      })),
      ...Array.from({ length: 24 }, (_, i) => ({
        node_id: `j${i}`,
        kind: "job" as const
      })),
      ...Array.from({ length: 30 }, (_, i) => ({
        node_id: `a${i}`,
        kind: "hermes_subagent" as const
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        node_id: `c${i}`,
        kind: "capability" as const
      }))
    ];
    const { min, max } = layoutScene(list, []);
    const w = max[0] - min[0];
    const d = max[2] - min[2];
    expect(Math.max(w, d) / Math.min(w, d)).toBeLessThan(4);
  });
});
