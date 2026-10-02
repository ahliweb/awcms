/**
 * Deterministic zone layout for the 3D Mission Control scene (Issue
 * ahliweb/omes#265, ADR-0031). Pure and presentation-only: positions are
 * derived from node ORDER and relations, never persisted, never an authority.
 * The same input always yields the same output.
 *
 * Zones (source map `kinds[*].zone`): agents are a radial delegation tree;
 * infrastructure is a grid of servers with their deployments stacked beside
 * them and health/backup records alongside; operations, governance, repository
 * and AI privacy are wrapped rows; architecture is one column per plane.
 * Zones are stacked along Z and centred on the origin.
 */
import type {
  MissionControlKind,
  MissionControlSceneRelation
} from "../../../modules/omes-control/domain/mission-control-types";
import { KIND_ZONE } from "./vocab";
import type { V3 } from "./math";

export type LayoutNode = { node_id: string; kind: MissionControlKind };
export type SceneLayout = { positions: V3[]; min: V3; max: V3 };

const ZONE_ORDER = [
  "infrastructure",
  "operations",
  "agents",
  "governance",
  "architecture",
  "repository",
  "ai_privacy"
] as const;
const GAP = 3.5;
const PER_ROW = 12;

type Local = Map<number, [number, number, number]>;

function row(indices: number[], local: Local, spacing = 2.2): void {
  indices.forEach((n, i) => {
    local.set(n, [
      (i % PER_ROW) * spacing,
      0,
      Math.floor(i / PER_ROW) * spacing
    ]);
  });
}

function infrastructure(
  idx: Record<string, number[]>,
  host: Map<number, number>,
  local: Local
): void {
  const servers = idx.server ?? [];
  const cols = Math.max(1, Math.ceil(Math.sqrt(servers.length)));
  const used = new Map<string, number>();
  servers.forEach((n, i) => {
    local.set(n, [(i % cols) * 4.2, 0, Math.floor(i / cols) * 4.2]);
  });
  const rows = Math.ceil(servers.length / cols);
  const orphans: number[] = [];
  for (const kind of ["deployment", "health_report", "backup"]) {
    for (const n of idx[kind] ?? []) {
      const s = host.get(n);
      const at = s === undefined ? undefined : local.get(s);
      if (!at) {
        orphans.push(n);
        continue;
      }
      const k = used.get(`${s}:${kind}`) ?? 0;
      used.set(`${s}:${kind}`, k + 1);
      if (kind === "deployment")
        local.set(n, [at[0] + 1.9, 0.5 + k * 1.1, at[2] - 1]);
      else if (kind === "health_report")
        local.set(n, [at[0] - 1.6, 0, at[2] + 1.6 + k]);
      else local.set(n, [at[0] + 1.6, 0, at[2] + 1.6 + k]);
    }
  }
  orphans.forEach((n, i) => {
    local.set(n, [
      (i % PER_ROW) * 2.2,
      0,
      (rows + Math.floor(i / PER_ROW)) * 4.2 + 0.5
    ]);
  });
}

function agents(
  list: number[],
  kids: Map<number, number[]>,
  hasParent: Set<number>,
  local: Local
): void {
  // First parent wins, cycles are cut: build a forest by DFS from the roots,
  // then promote anything still unseen (a pure cycle) to a root.
  const seen = new Set<number>();
  const tree = new Map<number, number[]>();
  const walk = (n: number): void => {
    seen.add(n);
    const out: number[] = [];
    for (const c of kids.get(n) ?? []) {
      if (seen.has(c)) continue;
      out.push(c);
      walk(c);
    }
    tree.set(n, out);
  };
  const roots = list.filter((n) => !hasParent.has(n));
  for (const n of roots) walk(n);
  for (const n of list) {
    if (!seen.has(n)) {
      roots.push(n);
      walk(n);
    }
  }
  const leaves = new Map<number, number>();
  const count = (n: number): number => {
    const c = tree.get(n) ?? [];
    const v = c.length === 0 ? 1 : c.reduce((a, k) => a + count(k), 0);
    leaves.set(n, v);
    return v;
  };
  const total = roots.reduce((a, n) => a + count(n), 0);
  const base = roots.length === 1 ? 0 : 1;
  const place = (n: number, a0: number, a1: number, depth: number): void => {
    const r = depth * 3;
    const a = (a0 + a1) / 2;
    local.set(n, [r * Math.cos(a), 0, r * Math.sin(a)]);
    let cursor = a0;
    for (const c of tree.get(n) ?? []) {
      const span = ((a1 - a0) * (leaves.get(c) ?? 1)) / (leaves.get(n) ?? 1);
      place(c, cursor, cursor + span, depth + 1);
      cursor += span;
    }
  };
  let cursor = 0;
  for (const n of roots) {
    const span = (Math.PI * 2 * (leaves.get(n) ?? 1)) / (total || 1);
    place(n, cursor, cursor + span, base);
    cursor += span;
  }
}

function architecture(
  idx: Record<string, number[]>,
  plane: Map<number, number>,
  local: Local
): void {
  const planes = idx.architecture_plane ?? [];
  const slot = new Map<number, number>();
  planes.forEach((n, i) => {
    local.set(n, [i * 3.6, 0, 0]);
    slot.set(n, 0);
  });
  const loose: number[] = [];
  for (const n of idx.capability ?? []) {
    const p = plane.get(n);
    const at = p === undefined ? undefined : local.get(p);
    if (!at) {
      loose.push(n);
      continue;
    }
    const k = (slot.get(p as number) ?? 0) + 1;
    slot.set(p as number, k);
    local.set(n, [at[0], 0, 2.2 + (k - 1) * 1.5]);
  }
  loose.forEach((n, i) => {
    local.set(n, [planes.length * 3.6, 0, 2.2 + i * 1.5]);
  });
}

export function layoutScene(
  nodes: readonly LayoutNode[],
  relations: readonly MissionControlSceneRelation[]
): SceneLayout {
  const byId = new Map<string, number>();
  const idx: Record<string, number[]> = {};
  nodes.forEach((n, i) => {
    byId.set(n.node_id, i);
    (idx[n.kind] ??= []).push(i);
  });

  const host = new Map<number, number>();
  const plane = new Map<number, number>();
  const kids = new Map<number, number[]>();
  const hasParent = new Set<number>();
  for (const rel of relations) {
    const a = byId.get(rel.from);
    const b = byId.get(rel.to);
    if (a === undefined || b === undefined || a === b) continue;
    const ka = nodes[a]?.kind;
    const kb = nodes[b]?.kind;
    if (rel.relation === "hosts" && ka === "server" && !host.has(b))
      host.set(b, a);
    else if (
      (rel.relation === "describes" || rel.relation === "protects") &&
      kb === "server" &&
      !host.has(a)
    )
      host.set(a, b);
    else if (rel.relation === "member_of" && kb === "architecture_plane")
      plane.set(a, b);
    else if (
      rel.relation === "delegates_to" &&
      ka === "hermes_subagent" &&
      kb === "hermes_subagent" &&
      !hasParent.has(b)
    ) {
      hasParent.add(b);
      (kids.get(a) ?? kids.set(a, []).get(a)!).push(b);
    }
  }

  const positions: V3[] = nodes.map(() => [0, 0, 0] as V3);
  // Lay each zone out locally, then shelf-pack the zones into rows so the whole
  // scene keeps a screen-like aspect ratio instead of one long strip.
  const zones: {
    local: Local;
    x0: number;
    z0: number;
    w: number;
    d: number;
  }[] = [];
  for (const zone of ZONE_ORDER) {
    const members = nodes.flatMap((n, i) =>
      KIND_ZONE[n.kind] === zone ? [i] : []
    );
    if (members.length === 0) continue;
    const local: Local = new Map();
    if (zone === "infrastructure") infrastructure(idx, host, local);
    else if (zone === "agents")
      agents(idx.hermes_subagent ?? [], kids, hasParent, local);
    else if (zone === "architecture") architecture(idx, plane, local);
    else row(members, local);

    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const p of local.values()) {
      x0 = Math.min(x0, p[0]);
      x1 = Math.max(x1, p[0]);
      z0 = Math.min(z0, p[2]);
      z1 = Math.max(z1, p[2]);
    }
    zones.push({ local, x0, z0, w: x1 - x0, d: z1 - z0 });
  }

  const area = zones.reduce((a, z) => a + (z.w + GAP) * (z.d + GAP), 0);
  const rowWidth = Math.max(24, 1.7 * Math.sqrt(area));
  let cx = 0;
  let top = 0;
  let depth = 0;
  for (const z of zones) {
    if (cx > 0 && cx + z.w > rowWidth) {
      top += depth + GAP;
      cx = 0;
      depth = 0;
    }
    for (const [n, p] of z.local) {
      positions[n] = [cx + p[0] - z.x0, p[1], top + p[2] - z.z0];
    }
    cx += z.w + GAP;
    depth = Math.max(depth, z.d);
  }

  const min: [number, number, number] = [0, 0, 0];
  const max: [number, number, number] = [0, 0, 0];
  positions.forEach((p, i) => {
    for (let a = 0; a < 3; a++) {
      const v = p[a] as number;
      if (i === 0 || v < (min[a] as number)) min[a] = v;
      if (i === 0 || v > (max[a] as number)) max[a] = v;
    }
  });
  // Centre on the origin in the ground plane.
  const mx = (min[0] + max[0]) / 2;
  const mz = (min[2] + max[2]) / 2;
  positions.forEach((p, i) => {
    positions[i] = [p[0] - mx, p[1], p[2] - mz];
  });
  min[0] -= mx;
  max[0] -= mx;
  min[2] -= mz;
  max[2] -= mz;
  return { positions, min, max };
}
