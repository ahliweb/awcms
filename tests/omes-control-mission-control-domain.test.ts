/**
 * 3D Mission Control composition — pure domain tests (Issue
 * ahliweb/omes#265, epic ahliweb/omes#263; ADR-0031).
 *
 * Covers the deterministic `visual_state` derivation (the freshness rule),
 * source-map <-> AWCMS vocabulary parity (so a new state added to an AWCMS
 * SQL CHECK constraint cannot ship without being classified in the vendored
 * map), relation / dedupe / truncation / bound behavior of `composeScene`,
 * verbatim untrusted text, fail-closed schema validation, every vendored
 * scene-view fixture, and the server-side performance evidence for a
 * representative large scene (compose duration + JSON bytes are printed).
 *
 * No database, no network: the SQL vocabularies are read from the
 * checked-in migrations as TEXT, the same technique
 * `tests/omes-control-route-permissions.test.ts` uses for route guards.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  assertMissionControlSceneValid,
  clampText,
  composeScene,
  deriveVisualState,
  freshnessFromAge,
  loadMissionControlSourceMap,
  MissionControlSceneInvalidError,
  sourceFreshnessBudgetSeconds,
  toSceneTimestamp,
  type MissionControlRecordInput
} from "../src/modules/omes-control/domain/mission-control";
import {
  MISSION_CONTROL_KINDS,
  MISSION_CONTROL_MAX_NODES,
  MISSION_CONTROL_MAX_RELATIONS,
  MISSION_CONTROL_RELATIONS,
  MISSION_CONTROL_SOURCE_KINDS,
  MISSION_CONTROL_VISUAL_STATES,
  type MissionControlFreshness,
  type MissionControlKind,
  type MissionControlSceneView
} from "../src/modules/omes-control/domain/mission-control-types";
import {
  validateOmesContract,
  type JsonValue
} from "../src/modules/omes-control/domain/contracts";
import {
  listFixtureFiles,
  loadFixture
} from "../src/modules/omes-control/domain/contracts/loader";
import { ORCHESTRATION_STATES } from "../src/modules/omes-control/domain/hermes-orchestration";
import { AI_PRIVACY_STATUSES } from "../src/modules/omes-control/domain/ai-privacy";
import { STALE_HEARTBEAT_THRESHOLD_MS } from "../src/modules/omes-control/domain/staleness";
import { DEFAULT_TREE_FRESHNESS_WINDOW_SECONDS } from "../src/modules/omes-control/domain/hermes-orchestration";
import {
  DEFAULT_REPOSITORY_PROGRESS_POLL_INTERVAL_SECONDS,
  REPOSITORY_PROGRESS_STALE_GRACE_MULTIPLIER
} from "../src/modules/omes-control/domain/repository-progress";
import { STALE_RECONCILIATION_THRESHOLD_MS } from "../src/modules/omes-control/application/deployment-directory";
import { BACKUP_FRESHNESS_THRESHOLD_MS } from "../src/modules/omes-control/application/backup-directory";

const NOW = new Date("2026-10-02T08:00:00Z");
const TENANT = "tenant-demo-01";
const SOURCE_MAP = loadMissionControlSourceMap();

const ALL_SOURCES = MISSION_CONTROL_SOURCE_KINDS.map((sourceKind) => ({
  sourceKind,
  available: true
}));

function record(
  overrides: Partial<MissionControlRecordInput> &
    Pick<MissionControlRecordInput, "kind" | "sourceId">
): MissionControlRecordInput {
  return {
    label: overrides.sourceId,
    sourceState: null,
    freshness: "live",
    observedAt: "2026-10-02T07:59:00Z",
    ...overrides
  };
}

function compose(
  records: MissionControlRecordInput[],
  sources = ALL_SOURCES
): MissionControlSceneView {
  return composeScene({ sources, records }, { tenantId: TENANT, now: NOW });
}

function nodeIdOf(
  scene: MissionControlSceneView,
  kind: MissionControlKind,
  sourceId: string
): string | undefined {
  return scene.nodes.find((n) => n.kind === kind && n.source_id === sourceId)
    ?.node_id;
}

describe("deriveVisualState (source-map freshness_rule)", () => {
  test("the eight Hermes subagent states map exactly as the map defines (live)", () => {
    const expected: Record<string, string> = {
      PENDING: "pending",
      STARTING: "in_progress",
      RUNNING: "in_progress",
      SUCCEEDED: "ok",
      FAILED: "failed",
      INTERRUPTED: "warning",
      CANCELLED: "cancelled",
      UNKNOWN: "unknown"
    };
    expect(Object.keys(expected).sort()).toEqual(
      [...ORCHESTRATION_STATES].sort()
    );
    for (const [state, visual] of Object.entries(expected)) {
      expect(
        deriveVisualState("hermes_subagent", state, "live") as string
      ).toBe(visual);
    }
  });

  test("a stale last-known success is NEVER shown as current; a last-known problem never disappears", () => {
    expect(deriveVisualState("hermes_subagent", "SUCCEEDED", "stale")).toBe(
      "stale"
    );
    expect(deriveVisualState("hermes_subagent", "RUNNING", "stale")).toBe(
      "stale"
    );
    expect(deriveVisualState("hermes_subagent", "PENDING", "stale")).toBe(
      "stale"
    );
    expect(deriveVisualState("hermes_subagent", "FAILED", "stale")).toBe(
      "failed"
    );
    expect(deriveVisualState("hermes_subagent", "INTERRUPTED", "stale")).toBe(
      "warning"
    );
    expect(deriveVisualState("server", "degraded", "stale")).toBe("warning");
    expect(deriveVisualState("job", "failed", "stale")).toBe("failed");
    expect(deriveVisualState("server", "online", "stale")).toBe("stale");
  });

  test("unknown freshness is always unknown — even for failed (no observation to trust)", () => {
    for (const [kind, entry] of Object.entries(SOURCE_MAP.kinds)) {
      for (const state of Object.keys(entry.state_map)) {
        expect(deriveVisualState(kind, state, "unknown")).toBe("unknown");
      }
    }
  });

  test("an unmapped state, an unknown kind, and prototype keys are unknown (fail closed)", () => {
    expect(deriveVisualState("server", "exploded", "live")).toBe("unknown");
    expect(deriveVisualState("server", "not_reported", "live")).toBe("unknown");
    expect(deriveVisualState("not_a_kind", "online", "live")).toBe("unknown");
    expect(deriveVisualState("constructor", "online", "live")).toBe("unknown");
    expect(deriveVisualState("server", "constructor", "live")).toBe("unknown");
    expect(deriveVisualState("server", "__proto__", "live")).toBe("unknown");
    expect(deriveVisualState("server", "toString", "live")).toBe("unknown");
  });

  test("an unrecognised freshness value is treated like live (OMES derive_visual_state parity)", () => {
    expect(deriveVisualState("server", "online", "bogus")).toBe("ok");
  });

  test("exhaustive table: every kind x mapped state x freshness follows the rule", () => {
    const keeps = new Set(SOURCE_MAP.freshness_rule.stale_keeps);
    let cases = 0;
    for (const [kind, entry] of Object.entries(SOURCE_MAP.kinds)) {
      for (const [state, base] of Object.entries(entry.state_map)) {
        expect(deriveVisualState(kind, state, "live")).toBe(base);
        expect(deriveVisualState(kind, state, "stale")).toBe(
          keeps.has(base) ? base : "stale"
        );
        expect(deriveVisualState(kind, state, "unknown")).toBe("unknown");
        expect(MISSION_CONTROL_VISUAL_STATES).toContain(base);
        cases += 3;
      }
    }
    expect(cases).toBeGreaterThan(100);
  });

  test("stale_keeps is exactly failed + warning (the documented rule)", () => {
    expect([...SOURCE_MAP.freshness_rule.stale_keeps].sort()).toEqual([
      "failed",
      "warning"
    ]);
  });
});

describe("freshnessFromAge / toSceneTimestamp / clampText", () => {
  test("live within budget, stale strictly beyond it, unknown for missing/unparsable/future", () => {
    expect(freshnessFromAge("2026-10-02T07:55:00Z", NOW, 300)).toBe("live");
    expect(freshnessFromAge("2026-10-02T07:54:59Z", NOW, 300)).toBe("stale");
    expect(freshnessFromAge(null, NOW, 300)).toBe("unknown");
    expect(freshnessFromAge(undefined, NOW, 300)).toBe("unknown");
    expect(freshnessFromAge("not-a-date", NOW, 300)).toBe("unknown");
    expect(freshnessFromAge("2026-10-02T08:00:01Z", NOW, 300)).toBe("unknown");
    expect(freshnessFromAge("2020-01-01T00:00:00Z", NOW, null)).toBe("live");
    expect(freshnessFromAge(new Date("2026-10-02T07:00:00Z"), NOW, 3600)).toBe(
      "live"
    );
  });

  test("wire timestamps carry no milliseconds (the schema pattern forbids them)", () => {
    expect(toSceneTimestamp(new Date("2026-10-02T08:00:00.987Z"))).toBe(
      "2026-10-02T08:00:00Z"
    );
    expect(toSceneTimestamp("2026-10-02T08:00:00.5Z")).toBe(
      "2026-10-02T08:00:00Z"
    );
    expect(toSceneTimestamp(null)).toBeNull();
    expect(toSceneTimestamp("nope")).toBeNull();
  });

  test("clampText cuts the tail only and never leaves a dangling surrogate", () => {
    expect(clampText("abc", 5)).toBe("abc");
    expect(clampText("abcdef", 3)).toBe("abc");
    const astral = "😀".repeat(70); // 140 UTF-16 units
    const clamped = clampText(astral, 121);
    expect(clamped.length).toBeLessThanOrEqual(121);
    expect(clamped.length % 2).toBe(0); // whole pairs only
    expect(clamped.startsWith("😀")).toBe(true);
  });
});

/** The text of the checked-in migrations, so the vocabularies cannot drift unseen. */
function sqlText(file: string): string {
  return readFileSync(join(import.meta.dir, "..", "sql", file), "utf8");
}

/** Values of `CONSTRAINT <name> CHECK (<column> IN ('a', 'b', ...))`. */
function checkValues(sql: string, constraint: string): string[] {
  const match = new RegExp(
    `CONSTRAINT\\s+${constraint}\\s+CHECK\\s*\\(\\s*\\w+\\s+IN\\s*\\(([^)]*)\\)`,
    "m"
  ).exec(sql);
  expect(match).not.toBeNull();
  return [...match![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

/** Values of the FIRST `CHECK (<column> IN ('a', ...))` whose list starts with `first`. */
function anonymousCheckValues(
  sql: string,
  column: string,
  first: string
): string[] {
  const match = new RegExp(
    `CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(\\s*'${first}'([^)]*)\\)`,
    "m"
  ).exec(sql);
  expect(match).not.toBeNull();
  return [first, ...[...match![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!)];
}

describe("source-map <-> AWCMS vocabulary parity (anti-drift)", () => {
  const schema154 = sqlText("154_awcms_omes_control_schema.sql");

  const vocabularies: Array<{
    kind: MissionControlKind;
    name: string;
    values: () => string[];
  }> = [
    {
      kind: "server",
      name: "awcms_omes_servers.status",
      values: () => checkValues(schema154, "awcms_omes_servers_status_check")
    },
    {
      kind: "deployment",
      name: "awcms_omes_deployments.reconciliation_status",
      values: () =>
        checkValues(schema154, "awcms_omes_deployments_status_check")
    },
    {
      kind: "job",
      name: "awcms_omes_jobs.state",
      values: () => checkValues(schema154, "awcms_omes_jobs_state_check")
    },
    {
      kind: "health_report",
      name: "awcms_omes_health_snapshots.overall_status",
      values: () => checkValues(schema154, "awcms_omes_health_overall_check")
    },
    {
      kind: "backup",
      name: "awcms_omes_backup_snapshots.status",
      values: () => checkValues(schema154, "awcms_omes_backup_status_check")
    },
    {
      kind: "hermes_subagent",
      name: "awcms_omes_hermes_orchestration_events.state",
      values: () =>
        anonymousCheckValues(
          sqlText("163_awcms_omes_hermes_orchestration_schema.sql"),
          "state",
          "PENDING"
        )
    },
    {
      kind: "ai_privacy_posture",
      name: "awcms_omes_ai_privacy_posture.status",
      values: () =>
        anonymousCheckValues(
          sqlText("160_awcms_omes_ai_privacy_schema.sql"),
          "status",
          "PASS"
        )
    },
    {
      kind: "approval_item",
      name: "awcms_workflow_instances.status",
      values: () =>
        checkValues(
          sqlText("013_awcms_workflow_approval_schema.sql"),
          "awcms_workflow_instances_status_check"
        )
    }
  ];

  test.each(vocabularies.map((v) => [v.name, v] as const))(
    "%s: every SQL value is a state_map key and the set equals projection_state_values",
    (_name, vocabulary) => {
      const values = vocabulary.values();
      expect(values.length).toBeGreaterThan(2);
      const entry = SOURCE_MAP.kinds[vocabulary.kind];
      for (const value of values) {
        expect(Object.hasOwn(entry.state_map, value)).toBe(true);
      }
      expect([...values].sort()).toEqual(
        [...entry.projection_state_values].sort()
      );
    }
  );

  test("the in-code Hermes / AI-privacy vocabularies agree with the map too", () => {
    expect([...(ORCHESTRATION_STATES as readonly string[])].sort()).toEqual(
      [...SOURCE_MAP.kinds.hermes_subagent.projection_state_values].sort()
    );
    expect([...(AI_PRIVACY_STATUSES as readonly string[])].sort()).toEqual(
      [...SOURCE_MAP.kinds.ai_privacy_posture.projection_state_values].sort()
    );
  });

  test("the map covers exactly the kinds, sources and relations the TypeScript types declare", () => {
    expect(Object.keys(SOURCE_MAP.kinds)).toEqual([...MISSION_CONTROL_KINDS]);
    expect(Object.keys(SOURCE_MAP.sources).sort()).toEqual(
      [...MISSION_CONTROL_SOURCE_KINDS].sort()
    );
    expect(Object.keys(SOURCE_MAP.relations).sort()).toEqual(
      [...MISSION_CONTROL_RELATIONS].sort()
    );
  });

  test("freshness budgets equal the AWCMS constants the map says they come from", () => {
    expect(sourceFreshnessBudgetSeconds("omes_server_inventory")).toBe(
      STALE_HEARTBEAT_THRESHOLD_MS / 1000
    );
    expect(sourceFreshnessBudgetSeconds("omes_job_status")).toBe(
      STALE_HEARTBEAT_THRESHOLD_MS / 1000
    );
    expect(sourceFreshnessBudgetSeconds("omes_deployment_view")).toBe(
      STALE_RECONCILIATION_THRESHOLD_MS / 1000
    );
    expect(sourceFreshnessBudgetSeconds("omes_backup_status")).toBe(
      BACKUP_FRESHNESS_THRESHOLD_MS / 1000
    );
    expect(sourceFreshnessBudgetSeconds("hermes_orchestration_tree")).toBe(
      DEFAULT_TREE_FRESHNESS_WINDOW_SECONDS
    );
    expect(
      sourceFreshnessBudgetSeconds("github_repository_progress_view")
    ).toBe(
      DEFAULT_REPOSITORY_PROGRESS_POLL_INTERVAL_SECONDS *
        REPOSITORY_PROGRESS_STALE_GRACE_MULTIPLIER
    );
    // The one NEW rule (ADR-0031 rule 2): AWCMS has no health staleness rule.
    expect(sourceFreshnessBudgetSeconds("omes_health_readiness")).toBe(1800);
    expect(
      sourceFreshnessBudgetSeconds("omes_architecture_capabilities_view")
    ).toBeNull();
    expect(sourceFreshnessBudgetSeconds("omes_ai_privacy_posture_view")).toBe(
      null
    );
    expect(sourceFreshnessBudgetSeconds("awcms_workflow_approval")).toBeNull();
  });
});

describe("composeScene — structure", () => {
  test("empty inputs compose a valid, empty, honest scene", async () => {
    const scene = compose(
      [],
      [{ sourceKind: "omes_server_inventory", available: true }]
    );
    expect(scene.nodes).toEqual([]);
    expect(scene.relations).toEqual([]);
    expect(scene.truncated).toEqual({ nodes: 0, relations: 0 });
    expect(scene.mode).toBe("live");
    expect(scene.as_of).toBe(scene.generated_at);
    expect(scene.generated_at).toBe("2026-10-02T08:00:00Z");
    expect(scene.tenant_id).toBe(TENANT);
    await assertMissionControlSceneValid(scene);
  });

  test("nodes are ordered by source-map kind order then source_id, with ids n1..nN, regardless of input order", () => {
    const records = [
      record({ kind: "job", sourceId: "job_b" }),
      record({ kind: "server", sourceId: "srv-2" }),
      record({ kind: "backup", sourceId: "bk-1" }),
      record({ kind: "server", sourceId: "srv-1" }),
      record({ kind: "job", sourceId: "job_a" })
    ];
    const scene = compose(records);
    expect(scene.nodes.map((n) => [n.node_id, n.kind, n.source_id])).toEqual([
      ["n1", "server", "srv-1"],
      ["n2", "server", "srv-2"],
      ["n3", "job", "job_a"],
      ["n4", "job", "job_b"],
      ["n5", "backup", "bk-1"]
    ]);
    expect(compose([...records].reverse())).toEqual(scene);
  });

  test("detail_route is the source-map route for the kind; source_state/visual_state/freshness are echoed and derived", () => {
    const scene = compose([
      record({
        kind: "hermes_subagent",
        sourceId: "sub-1",
        sourceState: "RUNNING",
        freshness: "stale"
      }),
      record({
        kind: "job",
        sourceId: "job_1",
        sourceState: "failed",
        freshness: "stale"
      })
    ]);
    const hermes = scene.nodes.find((n) => n.kind === "hermes_subagent")!;
    expect(hermes.detail_route).toBe("/admin/omes/orkestrasi-langsung");
    expect(hermes.source_state).toBe("RUNNING");
    expect(hermes.visual_state).toBe("stale");
    expect(hermes.freshness).toBe("stale");
    const job = scene.nodes.find((n) => n.kind === "job")!;
    expect(job.detail_route).toBe("/admin/omes/jobs");
    expect(job.visual_state).toBe("failed");
  });

  test("an unknown/unreported state is unknown, never healthy", () => {
    const scene = compose([
      record({ kind: "server", sourceId: "srv-1", sourceState: null }),
      // Outside the schema's source_state pattern: reported as not_reported.
      record({
        kind: "job",
        sourceId: "job_1",
        sourceState: "totally-new-state"
      }),
      // A well-formed but unmapped value is echoed verbatim and classed unknown.
      record({ kind: "backup", sourceId: "bk", sourceState: "mystery" })
    ]);
    expect(scene.nodes.map((n) => n.source_state)).toEqual([
      "not_reported",
      "not_reported",
      "mystery"
    ]);
    for (const node of scene.nodes) {
      expect(node.visual_state).toBe("unknown");
    }
  });

  test("dedupe keeps the NEWEST observation per (kind, source_id), independent of input order", () => {
    const older = record({
      kind: "server",
      sourceId: "srv-1",
      label: "older",
      sourceState: "online",
      observedAt: "2026-10-02T07:00:00Z"
    });
    const newer = record({
      kind: "server",
      sourceId: "srv-1",
      label: "newer",
      sourceState: "degraded",
      observedAt: "2026-10-02T07:30:00Z"
    });
    const never = record({
      kind: "server",
      sourceId: "srv-1",
      label: "never",
      sourceState: "online",
      observedAt: null
    });
    for (const order of [
      [older, newer, never],
      [never, newer, older],
      [newer, never, older]
    ]) {
      const scene = compose(order);
      expect(scene.nodes).toHaveLength(1);
      expect(scene.nodes[0]!.label).toBe("newer");
    }
    // Same kind, different source_id are distinct; same source_id, different kind are distinct.
    const scene = compose([
      record({ kind: "server", sourceId: "x" }),
      record({ kind: "health_report", sourceId: "x" })
    ]);
    expect(scene.nodes).toHaveLength(2);
  });

  test("an exact tie is broken deterministically (input order never matters)", () => {
    const a = record({
      kind: "server",
      sourceId: "s",
      label: "aaa",
      sourceState: "online"
    });
    const b = record({
      kind: "server",
      sourceId: "s",
      label: "bbb",
      sourceState: "online"
    });
    expect(compose([a, b])).toEqual(compose([b, a]));
  });
});

describe("composeScene — sources[]", () => {
  test("one entry per consulted source in map order; unavailable sources contribute no nodes", () => {
    const scene = compose(
      [
        record({ kind: "server", sourceId: "srv-1", sourceState: "online" }),
        record({
          kind: "hermes_subagent",
          sourceId: "sub-1",
          sourceState: "RUNNING"
        })
      ],
      [
        { sourceKind: "hermes_orchestration_tree", available: false },
        { sourceKind: "omes_server_inventory", available: true }
      ]
    );
    expect(scene.sources.map((s) => s.source_kind)).toEqual([
      "omes_server_inventory",
      "hermes_orchestration_tree"
    ]);
    const hermes = scene.sources.find(
      (s) => s.source_kind === "hermes_orchestration_tree"
    )!;
    expect(hermes).toEqual({
      source_kind: "hermes_orchestration_tree",
      authority: "hermes",
      status: "unavailable",
      observed_at: null
    });
    expect(scene.nodes.map((n) => n.kind)).toEqual(["server"]);
  });

  test("a record whose source was never consulted is ignored (not invented)", () => {
    const scene = compose(
      [record({ kind: "job", sourceId: "job_1", sourceState: "queued" })],
      [{ sourceKind: "omes_server_inventory", available: true }]
    );
    expect(scene.nodes).toEqual([]);
    expect(scene.truncated.nodes).toBe(0);
  });

  test("status: stale only when read, none live, and one is older than budget; observed_at is the newest observation", () => {
    const stale = compose(
      [
        record({
          kind: "server",
          sourceId: "a",
          freshness: "stale",
          observedAt: "2026-10-02T06:00:00Z"
        }),
        record({
          kind: "server",
          sourceId: "b",
          freshness: "stale",
          observedAt: "2026-10-02T06:30:00Z"
        })
      ],
      [{ sourceKind: "omes_server_inventory", available: true }]
    );
    expect(stale.sources[0]).toMatchObject({
      status: "stale",
      observed_at: "2026-10-02T06:30:00Z"
    });

    const mixed = compose(
      [
        record({ kind: "server", sourceId: "a", freshness: "stale" }),
        record({ kind: "server", sourceId: "b", freshness: "live" })
      ],
      [{ sourceKind: "omes_server_inventory", available: true }]
    );
    expect(mixed.sources[0]!.status).toBe("available");

    const empty = compose(
      [],
      [{ sourceKind: "omes_server_inventory", available: true }]
    );
    expect(empty.sources[0]).toMatchObject({
      status: "available",
      observed_at: null
    });
  });
});

describe("composeScene — relations (source-map vocabulary only)", () => {
  const records: MissionControlRecordInput[] = [
    record({ kind: "server", sourceId: "srv-1", sourceState: "online" }),
    record({
      kind: "deployment",
      sourceId: "dep-1",
      sourceState: "converged",
      evidence: { serverId: "srv-1" }
    }),
    record({
      kind: "job",
      sourceId: "job_1",
      sourceState: "running",
      evidence: { serverId: "srv-1", deploymentId: "dep-1" }
    }),
    record({
      kind: "health_report",
      sourceId: "srv-1",
      sourceState: "healthy",
      evidence: { serverId: "srv-1" }
    }),
    record({
      kind: "backup",
      sourceId: "bk-1",
      sourceState: "verified",
      evidence: { serverId: "srv-1" }
    }),
    record({
      kind: "hermes_subagent",
      sourceId: "root",
      sourceState: "RUNNING",
      evidence: { serverId: "srv-1" }
    }),
    record({
      kind: "hermes_subagent",
      sourceId: "child",
      sourceState: "PENDING",
      evidence: { serverId: "srv-1", parentSourceId: "root" }
    }),
    record({
      kind: "ai_privacy_posture",
      sourceId: "srv-1",
      sourceState: "PASS",
      evidence: { serverId: "srv-1" }
    }),
    record({
      kind: "architecture_plane",
      sourceId: "host_control",
      sourceState: "deterministic"
    }),
    record({
      kind: "capability",
      sourceId: "omes.jobs",
      sourceState: "implemented",
      evidence: { planeId: "host_control" }
    }),
    record({
      kind: "approval_item",
      sourceId: "wf-1",
      sourceState: "pending",
      evidence: {
        decisionFor: [
          { kind: "job", sourceId: "job_1" },
          { kind: "deployment", sourceId: "dep-1" },
          { kind: "backup", sourceId: "bk-1" }
        ]
      }
    })
  ];

  test("every one of the eight relations is produced, with the map's direction", () => {
    const scene = compose(records);
    const id = (kind: MissionControlKind, sourceId: string) =>
      nodeIdOf(scene, kind, sourceId)!;
    const has = (from: string, to: string, relation: string) =>
      scene.relations.some(
        (r) => r.from === from && r.to === to && r.relation === relation
      );

    expect(has(id("server", "srv-1"), id("deployment", "dep-1"), "hosts")).toBe(
      true
    );
    expect(has(id("job", "job_1"), id("server", "srv-1"), "targets")).toBe(
      true
    );
    expect(has(id("job", "job_1"), id("deployment", "dep-1"), "targets")).toBe(
      true
    );
    expect(
      has(
        id("hermes_subagent", "root"),
        id("hermes_subagent", "child"),
        "delegates_to"
      )
    ).toBe(true);
    expect(
      has(id("hermes_subagent", "child"), id("server", "srv-1"), "observed_on")
    ).toBe(true);
    expect(
      has(
        id("ai_privacy_posture", "srv-1"),
        id("server", "srv-1"),
        "observed_on"
      )
    ).toBe(true);
    expect(
      has(id("health_report", "srv-1"), id("server", "srv-1"), "describes")
    ).toBe(true);
    expect(has(id("backup", "bk-1"), id("server", "srv-1"), "protects")).toBe(
      true
    );
    expect(
      has(
        id("capability", "omes.jobs"),
        id("architecture_plane", "host_control"),
        "member_of"
      )
    ).toBe(true);
    for (const [kind, sourceId] of [
      ["job", "job_1"],
      ["deployment", "dep-1"],
      ["backup", "bk-1"]
    ] as const) {
      expect(
        has(
          id("approval_item", "wf-1"),
          id(kind, sourceId),
          "awaits_decision_for"
        )
      ).toBe(true);
    }
    expect(new Set(scene.relations.map((r) => r.relation))).toEqual(
      new Set(MISSION_CONTROL_RELATIONS)
    );
  });

  test("every emitted relation is allowed by the map's from/to kind vocabulary", () => {
    const scene = compose(records);
    const kindById = new Map(scene.nodes.map((n) => [n.node_id, n.kind]));
    for (const relation of scene.relations) {
      const vocabulary = SOURCE_MAP.relations[relation.relation];
      expect(vocabulary.from).toContain(kindById.get(relation.from)!);
      expect(vocabulary.to).toContain(kindById.get(relation.to)!);
    }
  });

  test("a relation whose endpoint is absent is dropped, never invented", () => {
    const scene = compose([
      record({
        kind: "deployment",
        sourceId: "dep-1",
        sourceState: "converged",
        evidence: { serverId: "srv-missing" }
      }),
      record({
        kind: "approval_item",
        sourceId: "wf-1",
        sourceState: "pending",
        evidence: { decisionFor: [{ kind: "job", sourceId: "job_missing" }] }
      }),
      record({
        kind: "hermes_subagent",
        sourceId: "orphan",
        sourceState: "RUNNING",
        evidence: { parentSourceId: "no-such-parent" }
      })
    ]);
    expect(scene.nodes).toHaveLength(3);
    expect(scene.relations).toEqual([]);
  });

  test("evidence on a kind the vocabulary does not allow produces no edge; self/duplicate edges collapse", () => {
    const scene = compose([
      record({ kind: "server", sourceId: "srv-1" }),
      // A capability/architecture record has no server relation in the map.
      record({
        kind: "capability",
        sourceId: "cap",
        evidence: { serverId: "srv-1" }
      }),
      record({
        kind: "hermes_subagent",
        sourceId: "self",
        evidence: { parentSourceId: "self" }
      }),
      record({
        kind: "approval_item",
        sourceId: "wf-1",
        evidence: {
          decisionFor: [
            { kind: "job", sourceId: "job_1" },
            { kind: "job", sourceId: "job_1" }
          ]
        }
      }),
      record({ kind: "job", sourceId: "job_1" })
    ]);
    expect(
      scene.relations.filter((r) => r.relation === "awaits_decision_for")
    ).toHaveLength(1);
    expect(scene.relations.some((r) => r.relation === "delegates_to")).toBe(
      false
    );
    const capId = nodeIdOf(scene, "capability", "cap")!;
    expect(
      scene.relations.some((r) => r.from === capId || r.to === capId)
    ).toBe(false);
  });
});

describe("composeScene — bounds and truncation", () => {
  test("more than 500 nodes: problems are kept before healthy/informational ones and truncated.nodes reports the omission", async () => {
    const records: MissionControlRecordInput[] = [];
    // 480 informational capabilities + 60 failed jobs + 20 ok servers = 560.
    for (let i = 0; i < 480; i += 1) {
      records.push(
        record({
          kind: "capability",
          sourceId: `cap-${String(i).padStart(4, "0")}`,
          sourceState: "implemented"
        })
      );
    }
    for (let i = 0; i < 60; i += 1) {
      records.push(
        record({
          kind: "job",
          sourceId: `job_${String(i).padStart(3, "0")}`,
          sourceState: "failed"
        })
      );
    }
    for (let i = 0; i < 20; i += 1) {
      records.push(
        record({
          kind: "server",
          sourceId: `srv-${String(i).padStart(3, "0")}`,
          sourceState: "online"
        })
      );
    }
    const scene = compose(records);
    expect(scene.nodes).toHaveLength(MISSION_CONTROL_MAX_NODES);
    expect(scene.truncated.nodes).toBe(60);
    // Every failed job survived; the dropped ones are informational/ok.
    expect(scene.nodes.filter((n) => n.kind === "job")).toHaveLength(60);
    expect(scene.nodes.filter((n) => n.visual_state === "failed")).toHaveLength(
      60
    );
    // Ids stay contiguous and in kind/source order after truncation.
    expect(scene.nodes.map((n) => n.node_id)).toEqual(
      scene.nodes.map((_, i) => `n${i + 1}`)
    );
    await assertMissionControlSceneValid(scene);
  });

  test("unknown and stale nodes outrank ok nodes under truncation too", () => {
    const records: MissionControlRecordInput[] = [];
    for (let i = 0; i < 500; i += 1) {
      records.push(
        record({
          kind: "server",
          sourceId: `srv-${String(i).padStart(4, "0")}`,
          sourceState: "online"
        })
      );
    }
    records.push(
      record({
        kind: "backup",
        sourceId: "bk-stale",
        sourceState: "verified",
        freshness: "stale"
      }),
      record({
        kind: "hermes_subagent",
        sourceId: "sub-unknown",
        sourceState: "UNKNOWN"
      })
    );
    const scene = compose(records);
    expect(scene.nodes).toHaveLength(500);
    expect(scene.truncated.nodes).toBe(2);
    expect(nodeIdOf(scene, "backup", "bk-stale")).toBeDefined();
    expect(nodeIdOf(scene, "hermes_subagent", "sub-unknown")).toBeDefined();
  });

  test("more than 1000 relations: the bound holds and truncated.relations reports the omission", async () => {
    const records: MissionControlRecordInput[] = [];
    for (let j = 0; j < 12; j += 1) {
      records.push(record({ kind: "job", sourceId: `job_${j}` }));
    }
    for (let a = 0; a < 100; a += 1) {
      records.push(
        record({
          kind: "approval_item",
          sourceId: `wf-${String(a).padStart(3, "0")}`,
          sourceState: "pending",
          evidence: {
            decisionFor: Array.from({ length: 12 }, (_, j) => ({
              kind: "job" as const,
              sourceId: `job_${j}`
            }))
          }
        })
      );
    }
    const scene = compose(records);
    expect(scene.relations).toHaveLength(MISSION_CONTROL_MAX_RELATIONS);
    expect(scene.truncated.relations).toBe(200);
    await assertMissionControlSceneValid(scene);
  });

  test("records that cannot be represented are omitted and counted, never emitted", () => {
    const scene = compose([
      record({ kind: "server", sourceId: "ok-1" }),
      record({ kind: "server", sourceId: "has space" }),
      record({ kind: "server", sourceId: "slash/id" }),
      record({ kind: "server", sourceId: "x".repeat(129) }),
      record({
        kind: "hermes_subagent",
        sourceId: "leaky",
        label: "Bearer abcdefghijklmnopqrstuvwxyz0123456789"
      })
    ]);
    expect(scene.nodes.map((n) => n.source_id)).toEqual(["ok-1"]);
    expect(scene.truncated.nodes).toBe(4);
  });
});

describe("composeScene — untrusted text stays verbatim", () => {
  const XSS = "<img src=x onerror=alert(1)>";

  test("an XSS label is data: preserved byte-for-byte, and the scene is still schema-valid", async () => {
    const scene = compose([
      record({
        kind: "hermes_subagent",
        sourceId: "sub-xss",
        label: XSS,
        summary: `<script>alert("x")</script> & "quotes" 'single'`,
        sourceState: "RUNNING"
      })
    ]);
    expect(scene.nodes[0]!.label).toBe(XSS);
    expect(scene.nodes[0]!.summary).toBe(
      `<script>alert("x")</script> & "quotes" 'single'`
    );
    await assertMissionControlSceneValid(scene);
    // Verbatim through serialization as well (the renderer encodes, never the server).
    expect(JSON.parse(JSON.stringify(scene)).nodes[0].label).toBe(XSS);
  });

  test("label is clamped to 120 and summary to 280 (tail cut only); an empty label falls back to the source_id", async () => {
    const scene = compose([
      record({
        kind: "hermes_subagent",
        sourceId: "long",
        label: "L".repeat(500),
        summary: "S".repeat(900)
      }),
      record({ kind: "job", sourceId: "job_blank", label: "   " }),
      record({ kind: "job", sourceId: "job_empty", label: "" })
    ]);
    const long = scene.nodes.find((n) => n.source_id === "long")!;
    expect(long.label).toBe("L".repeat(120));
    expect(long.summary).toBe("S".repeat(280));
    expect(scene.nodes.find((n) => n.source_id === "job_blank")!.label).toBe(
      "job_blank"
    );
    expect(scene.nodes.find((n) => n.source_id === "job_empty")!.label).toBe(
      "job_empty"
    );
    await assertMissionControlSceneValid(scene);
  });

  test("an absent summary is omitted entirely (no undefined key on the wire)", () => {
    const scene = compose([record({ kind: "server", sourceId: "srv-1" })]);
    expect("summary" in scene.nodes[0]!).toBe(false);
  });
});

describe("fail-closed schema validation", () => {
  test("a tampered scene throws a typed error that names paths only, never values", async () => {
    const scene = compose([
      record({
        kind: "hermes_subagent",
        sourceId: "sub-1",
        label: "SENSITIVE-LABEL-TEXT"
      })
    ]);
    const tampered = JSON.parse(
      JSON.stringify(scene)
    ) as MissionControlSceneView;
    (tampered.nodes[0] as unknown as Record<string, unknown>).visual_state =
      "totally-green";
    (tampered as unknown as Record<string, unknown>).schema_version = "2.0.0";

    let thrown: unknown;
    try {
      await assertMissionControlSceneValid(tampered);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(MissionControlSceneInvalidError);
    const error = thrown as MissionControlSceneInvalidError;
    expect(error.invalidPaths.length).toBeGreaterThan(0);
    expect(error.invalidPaths.some((p) => p.startsWith("$.nodes[0]"))).toBe(
      true
    );
    expect(error.message).not.toContain("SENSITIVE-LABEL-TEXT");
    expect(JSON.stringify(error.invalidPaths)).not.toContain(
      "SENSITIVE-LABEL-TEXT"
    );
  });

  test("an unknown schema major is rejected", async () => {
    const scene = compose([]);
    (scene as unknown as Record<string, unknown>).schema_version = "2.0.0";
    await expect(assertMissionControlSceneValid(scene)).rejects.toBeInstanceOf(
      MissionControlSceneInvalidError
    );
  });

  test("an additional (forbidden) property is rejected", async () => {
    const scene = compose([record({ kind: "server", sourceId: "srv-1" })]);
    (scene.nodes[0] as unknown as Record<string, unknown>).command = "rm -rf /";
    await expect(assertMissionControlSceneValid(scene)).rejects.toBeInstanceOf(
      MissionControlSceneInvalidError
    );
  });
});

describe("vendored scene-view fixtures", () => {
  test("every valid-*.json validates and every node's visual_state equals deriveVisualState (MC8 parity)", async () => {
    const files = (await listFixtureFiles("mission-control-scene-view")).filter(
      (f) => f.startsWith("valid-")
    );
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const file of files) {
      const { value, floatLiteralPaths } = await loadFixture(
        "mission-control-scene-view",
        file
      );
      expect(
        await validateOmesContract(
          "mission-control-scene-view",
          value as JsonValue,
          { floatLiteralPaths }
        )
      ).toEqual([]);

      const scene = value as unknown as MissionControlSceneView;
      for (const node of scene.nodes) {
        expect(
          deriveVisualState(node.kind, node.source_state, node.freshness)
        ).toBe(node.visual_state);
        expect(node.detail_route.split("?")[0]).toBe(
          SOURCE_MAP.kinds[node.kind].detail_route
        );
      }
    }
  });

  test("every invalid-*.json is rejected by the module's validator", async () => {
    const files = (await listFixtureFiles("mission-control-scene-view")).filter(
      (f) => f.startsWith("invalid-")
    );
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const file of files) {
      const { value, floatLiteralPaths } = await loadFixture(
        "mission-control-scene-view",
        file
      );
      const errors = await validateOmesContract(
        "mission-control-scene-view",
        value as JsonValue,
        { floatLiteralPaths }
      );
      expect(errors.length).toBeGreaterThan(0);
    }
  });
});

/** Small deterministic PRNG so the performance fixture is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function representativeFleet(): MissionControlRecordInput[] {
  const rand = mulberry32(265);
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(rand() * items.length)]!;
  const freshness = (): MissionControlFreshness =>
    pick(["live", "live", "live", "stale", "unknown"] as const);
  const records: MissionControlRecordInput[] = [];
  const pad = (n: number, width = 3) => String(n).padStart(width, "0");

  for (let s = 0; s < 50; s += 1) {
    records.push(
      record({
        kind: "server",
        sourceId: `srv-${pad(s)}`,
        label: `host-${pad(s)}.example.test`,
        sourceState: pick(["online", "online", "degraded", "offline"]),
        freshness: freshness()
      })
    );
    records.push(
      record({
        kind: "health_report",
        sourceId: `srv-${pad(s)}`,
        sourceState: pick(["healthy", "degraded", "unhealthy"]),
        freshness: freshness(),
        evidence: { serverId: `srv-${pad(s)}` }
      })
    );
    records.push(
      record({
        kind: "deployment",
        sourceId: `dep-${pad(s)}`,
        sourceState: pick(["converged", "drifted", "failed", "in_progress"]),
        freshness: freshness(),
        evidence: { serverId: `srv-${pad(s)}` }
      })
    );
  }
  for (let j = 0; j < 100; j += 1) {
    records.push(
      record({
        kind: "job",
        sourceId: `job_${pad(j)}`,
        label: "operation.update",
        sourceState: pick(["queued", "running", "completed", "failed"]),
        freshness: freshness(),
        evidence: {
          serverId: `srv-${pad(j % 50)}`,
          deploymentId: `dep-${pad((j * 7) % 50)}`
        }
      })
    );
  }
  for (let b = 0; b < 40; b += 1) {
    records.push(
      record({
        kind: "backup",
        sourceId: `bk-${pad(b)}`,
        sourceState: pick(["verified", "completed", "failed"]),
        freshness: freshness(),
        evidence: { serverId: `srv-${pad(b % 50)}` }
      })
    );
  }
  // 220 Hermes nodes: 22 sessions x (1 root + 9 descendants), nested 3 deep.
  const states = [
    "PENDING",
    "STARTING",
    "RUNNING",
    "SUCCEEDED",
    "FAILED",
    "INTERRUPTED",
    "CANCELLED",
    "UNKNOWN"
  ];
  for (let session = 0; session < 22; session += 1) {
    const serverId = `srv-${pad(session % 50)}`;
    const root = `h${pad(session)}-0`;
    records.push(
      record({
        kind: "hermes_subagent",
        sourceId: root,
        label: `orchestrator-${session}`,
        sourceState: "RUNNING",
        freshness: freshness(),
        summary: "Coordinating subagents for the release checklist.",
        evidence: { serverId }
      })
    );
    for (let n = 1; n < 10; n += 1) {
      const parent = n <= 3 ? root : `h${pad(session)}-${((n - 1) % 3) + 1}`;
      records.push(
        record({
          kind: "hermes_subagent",
          sourceId: `h${pad(session)}-${n}`,
          label: `worker-${session}-${n}`,
          sourceState: pick(states),
          freshness: freshness(),
          evidence: { serverId, parentSourceId: parent }
        })
      );
    }
  }
  for (let c = 0; c < 41; c += 1) {
    records.push(
      record({
        kind: "capability",
        sourceId: `cap.${pad(c)}`,
        label: `Capability ${c}`,
        sourceState: "implemented",
        evidence: { planeId: `plane_${c % 6}` }
      })
    );
  }
  for (let p = 0; p < 6; p += 1) {
    records.push(
      record({
        kind: "architecture_plane",
        sourceId: `plane_${p}`,
        sourceState: "deterministic"
      })
    );
  }
  for (let a = 0; a < 5; a += 1) {
    records.push(
      record({
        kind: "approval_item",
        sourceId: `wf-${a}`,
        label: "rollback",
        sourceState: "pending",
        evidence: { decisionFor: [{ kind: "job", sourceId: `job_${pad(a)}` }] }
      })
    );
  }
  return records;
}

describe("performance evidence (server-side composition)", () => {
  test("a large representative fleet composes inside the bounds; duration and JSON size are recorded", async () => {
    const records = representativeFleet();
    const hermes = records.filter((r) => r.kind === "hermes_subagent");
    expect(hermes.length).toBeGreaterThanOrEqual(200);
    expect(records.filter((r) => r.kind === "server")).toHaveLength(50);
    expect(records.filter((r) => r.kind === "deployment")).toHaveLength(50);
    expect(records.filter((r) => r.kind === "job")).toHaveLength(100);

    // Warm-up (module/JIT), then measure the median of several runs.
    compose(records);
    const runs: number[] = [];
    let scene = compose(records);
    for (let i = 0; i < 7; i += 1) {
      const start = performance.now();
      scene = compose(records);
      runs.push(performance.now() - start);
    }
    runs.sort((a, b) => a - b);
    const medianMs = runs[Math.floor(runs.length / 2)]!;

    const validateStart = performance.now();
    await assertMissionControlSceneValid(scene);
    const validateMs = performance.now() - validateStart;

    const json = JSON.stringify({ success: true, data: { scene } });
    const bytes = new TextEncoder().encode(json).length;

    console.log(
      `[mission-control perf] input=${records.length} records ` +
        `nodes=${scene.nodes.length} relations=${scene.relations.length} ` +
        `truncated=${JSON.stringify(scene.truncated)} ` +
        `compose_median_ms=${medianMs.toFixed(2)} ` +
        `compose_min_ms=${runs[0]!.toFixed(2)} compose_max_ms=${runs[runs.length - 1]!.toFixed(2)} ` +
        `schema_validate_ms=${validateMs.toFixed(2)} json_bytes=${bytes}`
    );

    expect(scene.nodes.length).toBeLessThanOrEqual(MISSION_CONTROL_MAX_NODES);
    expect(scene.relations.length).toBeLessThanOrEqual(
      MISSION_CONTROL_MAX_RELATIONS
    );
    // Total input is 50+50+50+100+40+220+41+6+5 = 562 > 500, so the bound bit.
    expect(scene.truncated.nodes).toBe(records.length - scene.nodes.length);
    // Nesting survived: delegation edges exist.
    expect(scene.relations.some((r) => r.relation === "delegates_to")).toBe(
      true
    );
    // Generous ceilings: this is evidence, not a flaky micro-benchmark gate.
    expect(medianMs).toBeLessThan(250);
    expect(bytes).toBeLessThan(512 * 1024);
    // Deterministic under reordering even at this size.
    expect(compose([...records].reverse())).toEqual(scene);
  });
});
