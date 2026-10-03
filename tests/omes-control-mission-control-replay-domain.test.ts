/**
 * 3D Mission Control historical replay — pure domain tests (Issue
 * ahliweb/omes#266, epic ahliweb/omes#263; OMES ADR-0031 rule 4).
 *
 * Covers: de-duplication; deterministic order independent of input order;
 * `late_arrival` labelling; missing evidence reported as gaps and never
 * interpolated; the opaque cursor (round trip, tampering); the 500-event page
 * bound; strict query validation; the historical scene (a node is absent
 * before its first evidence, `current_only` objects are unknown and never
 * back-dated, a stale source is never shown live); every vendored replay-window
 * fixture; and server-side performance evidence for 5,000 synthetic rows.
 *
 * No database, no network.
 */
import { describe, expect, test } from "bun:test";

import {
  buildReplayPage,
  buildReplayWindow,
  assertMissionControlReplayWindowValid,
  composeHistoricalScene,
  computeEvidenceGaps,
  decodeReplayCursor,
  encodeReplayCursor,
  MISSION_CONTROL_REPLAY_MAX_WINDOW_MS,
  MissionControlReplayInvalidError,
  parseReplayQuery,
  parseSceneQuery,
  toExactInstant,
  type HistoricalEvidenceRow,
  type ReplayEvidenceRow
} from "../src/modules/omes-control/domain/mission-control-replay";
import {
  assertMissionControlSceneValid,
  deriveVisualState,
  loadMissionControlSourceMap
} from "../src/modules/omes-control/domain/mission-control";
import {
  MISSION_CONTROL_KINDS,
  MISSION_CONTROL_SOURCE_KINDS,
  type MissionControlReplayWindow
} from "../src/modules/omes-control/domain/mission-control-types";
import {
  validateOmesContract,
  type JsonValue
} from "../src/modules/omes-control/domain/contracts";
import {
  listFixtureFiles,
  loadFixture
} from "../src/modules/omes-control/domain/contracts/loader";

const TENANT = "tenant-demo-01";
const NOW = new Date("2026-10-02T08:00:00Z");
const FROM = "2026-10-02T07:00:00Z";
const TO = "2026-10-02T08:00:00Z";
const WINDOW = { from: FROM, to: TO };
const SOURCE_MAP = loadMissionControlSourceMap();

function at(seconds: number): string {
  return `${new Date(Date.parse(FROM) + seconds * 1000)
    .toISOString()
    .slice(0, 19)}Z`;
}

function hermes(
  id: string,
  seconds: number,
  state = "RUNNING",
  overrides: Partial<ReplayEvidenceRow> = {}
): ReplayEvidenceRow {
  return {
    at: at(seconds),
    recordedAt: at(seconds),
    evidenceKind: "hermes_event",
    evidenceId: id,
    kind: "hermes_subagent",
    sourceId: "sub-1",
    parentSourceId: null,
    sourceState: state,
    ...overrides
  };
}

function page(rows: readonly ReplayEvidenceRow[], extra = {}) {
  return buildReplayPage(rows, {
    tenantId: TENANT,
    now: NOW,
    window: WINDOW,
    ...extra
  });
}

/** Deterministic PRNG so shuffles and the perf fixture are reproducible. */
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

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const random = mulberry32(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

describe("buildReplayWindow — de-duplication and deterministic order", () => {
  test("duplicates of one (evidence_kind, evidence_id) collapse to one event", () => {
    const rows = [
      hermes("evt-1", 10),
      hermes("evt-1", 10),
      hermes("evt-1", 10, "RUNNING", { correlationId: "corr-x" })
    ];
    const events = page(rows).window.events;
    expect(events).toHaveLength(1);
    // The same id under a DIFFERENT evidence kind is a different piece of evidence.
    const both = page([
      ...rows,
      {
        ...hermes("evt-1", 10),
        evidenceKind: "health_snapshot",
        kind: "health_report"
      }
    ]).window.events;
    expect(both.map((e) => e.evidence_kind).sort()).toEqual([
      "health_snapshot",
      "hermes_event"
    ]);
  });

  test("the result depends only on the SET of rows, never on their input order", () => {
    const rows: ReplayEvidenceRow[] = [];
    for (let i = 0; i < 60; i += 1) {
      rows.push(hermes(`evt-${i}`, i % 7, i % 2 ? "RUNNING" : "SUCCEEDED"));
    }
    const expected = JSON.stringify(page(rows).window);
    for (const seed of [1, 2, 3, 4, 5]) {
      expect(JSON.stringify(page(shuffled(rows, seed)).window)).toBe(expected);
    }
  });

  test("order is (at, evidence_kind, evidence_id); ties on one instant break by kind then id", () => {
    const rows: ReplayEvidenceRow[] = [
      hermes("b", 5),
      hermes("a", 5),
      {
        ...hermes("z", 5),
        evidenceKind: "health_snapshot",
        kind: "health_report",
        sourceId: "srv-1",
        sourceState: "healthy"
      },
      hermes("early", 1)
    ];
    const events = page(rows).window.events;
    expect(
      events.map((e) => `${e.at}|${e.evidence_kind}|${e.evidence_id}`)
    ).toEqual([
      `${at(1)}|hermes_event|early`,
      `${at(5)}|health_snapshot|z`,
      `${at(5)}|hermes_event|a`,
      `${at(5)}|hermes_event|b`
    ]);
  });

  test("ordering uses the stored instant at microsecond precision; the wire `at` is whole seconds", () => {
    const rows: ReplayEvidenceRow[] = [
      hermes("id-2", 0, "RUNNING", { at: "2026-10-02T07:00:10.900000Z" }),
      hermes("id-1", 0, "RUNNING", { at: "2026-10-02T07:00:10.100000Z" })
    ];
    const events = page(rows).window.events;
    expect(events.map((e) => e.evidence_id)).toEqual(["id-1", "id-2"]);
    expect(events.every((e) => e.at === "2026-10-02T07:00:10Z")).toBe(true);
  });

  test("events outside the window are dropped; the window bounds are inclusive", () => {
    const rows = [
      hermes("before", -1),
      hermes("first", 0),
      hermes("last", 3600),
      hermes("after", 3601)
    ];
    expect(page(rows).window.events.map((e) => e.evidence_id)).toEqual([
      "first",
      "last"
    ]);
  });

  test("visual_state is the deterministic derivation; hermes carries parent_source_id only from its own evidence", () => {
    const events = page([
      hermes("c", 1, "RUNNING", { sourceId: "child", parentSourceId: "root" }),
      {
        ...hermes("j", 2),
        evidenceKind: "job_record",
        kind: "job",
        sourceId: "job-1",
        sourceState: "completed",
        // A non-hermes row can never claim a parent.
        parentSourceId: "root"
      }
    ]).window.events;
    for (const event of events) {
      expect(event.visual_state).toBe(
        deriveVisualState(event.kind, event.source_state, "live")
      );
    }
    const child = events.find((e) => e.source_id === "child")!;
    const job = events.find((e) => e.source_id === "job-1")!;
    expect(child.parent_source_id).toBe("root");
    expect("parent_source_id" in job).toBe(false);
  });

  test("an unrecognised state is unknown, a malformed identifier is omitted (and counted), nothing is rewritten", () => {
    const result = page([
      hermes("ok", 1, "TOTALLY_NEW"),
      hermes("bad id with spaces", 2),
      hermes("worse", 3, "RUNNING", { sourceId: "has space" }),
      hermes("noinstant", 4, "RUNNING", { at: "not-a-time" })
    ]);
    expect(result.omitted).toBe(3);
    expect(result.window.events).toHaveLength(1);
    expect(result.window.events[0]!.visual_state).toBe("unknown");
    expect(result.window.events[0]!.source_state).toBe("TOTALLY_NEW");
  });
});

describe("late_arrival provenance", () => {
  test("a row recorded AFTER a row whose `at` is later is late_arrival; the rest are observed", () => {
    const rows = [
      hermes("e1", 10, "PENDING", { recordedAt: at(11) }),
      hermes("e3", 30, "SUCCEEDED", { recordedAt: at(31) }),
      // happened at 20 but only recorded at 40 — after e3 (at 30) was stored.
      hermes("e2", 20, "RUNNING", { recordedAt: at(40) })
    ];
    const events = page(rows).window.events;
    expect(events.map((e) => [e.evidence_id, e.provenance])).toEqual([
      ["e1", "observed"],
      ["e2", "late_arrival"],
      ["e3", "observed"]
    ]);
  });

  test("same instant, recorded in time order, missing recorded time and other sources are never late", () => {
    const rows = [
      hermes("tie-a", 10, "RUNNING", { recordedAt: at(50) }),
      hermes("tie-b", 10, "RUNNING", { recordedAt: at(51) }),
      hermes("norec", 5, "RUNNING", { recordedAt: null }),
      // a different (kind, source_id): independent history.
      hermes("other", 1, "RUNNING", { sourceId: "sub-2", recordedAt: at(99) })
    ];
    expect(
      page(rows).window.events.every((e) => e.provenance === "observed")
    ).toBe(true);
  });

  test("late_arrival does not rewrite order: the late event stays at its own `at`", () => {
    const rows = [
      hermes("late", 20, "RUNNING", { recordedAt: at(40) }),
      hermes("later", 30, "SUCCEEDED", { recordedAt: at(31) })
    ];
    expect(page(rows).window.events.map((e) => e.evidence_id)).toEqual([
      "late",
      "later"
    ]);
  });
});

describe("opaque cursor", () => {
  const cursor = {
    at: "2026-10-02T07:10:00.123456Z",
    evidenceKind: "hermes_event" as const,
    evidenceId: "evt-9"
  };

  test("round-trips and is base64url of at|kind|id", () => {
    const encoded = encodeReplayCursor(cursor);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
    expect(Buffer.from(encoded, "base64url").toString("utf8")).toBe(
      "2026-10-02T07:10:00.123456Z|hermes_event|evt-9"
    );
    expect(decodeReplayCursor(encoded)).toEqual(cursor);
  });

  test("anything that is not exactly the canonical encoding of a well-formed triple is rejected", () => {
    const good = encodeReplayCursor(cursor);
    const enc = (text: string) =>
      Buffer.from(text, "utf8").toString("base64url");
    const bad: unknown[] = [
      undefined,
      null,
      42,
      "",
      "!!!",
      `${good}=`,
      `${good}A`,
      "x".repeat(257),
      enc("2026-10-02T07:10:00.123456Z|hermes_event"),
      enc("2026-10-02T07:10:00.123456Z|hermes_event|evt-9|extra"),
      enc("2026-10-02T07:10:00.123456Z|bogus_kind|evt-9"),
      enc("2026-10-02T07:10:00.123456Z|hermes_event|has space"),
      enc("2026-10-02T07:10:00.123456Z|hermes_event|"),
      enc("2026-10-02T07:10:00Z|hermes_event|evt-9"),
      enc("2026-13-45T07:10:00.123456Z|hermes_event|evt-9"),
      enc("2026-10-02 07:10:00.123456Z|hermes_event|evt-9"),
      enc("2026-10-02T07:10:00.123456Z|hermes_event|evt-9\n"),
      enc("'; DROP TABLE x;--|hermes_event|evt-9")
    ];
    for (const value of bad) {
      expect(decodeReplayCursor(value), String(value)).toBeNull();
    }
  });

  test("flipping any single character of a valid cursor never yields a different VALID cursor for the same input", () => {
    const good = encodeReplayCursor(cursor);
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
    for (let i = 0; i < good.length; i += 1) {
      const swapped =
        alphabet[(alphabet.indexOf(good[i]!) + 1) % alphabet.length]!;
      const tampered = `${good.slice(0, i)}${swapped}${good.slice(i + 1)}`;
      const decoded = decodeReplayCursor(tampered);
      // Either rejected, or it decodes to a cursor whose canonical encoding IS the tampered text.
      if (decoded) expect(encodeReplayCursor(decoded)).toBe(tampered);
    }
  });

  test("a page after the cursor starts strictly after it", () => {
    const rows = [hermes("a", 1), hermes("b", 2), hermes("c", 3)];
    const first = page(rows, { limit: 2 }).window;
    expect(first.events.map((e) => e.evidence_id)).toEqual(["a", "b"]);
    expect(first.next_cursor).not.toBeNull();
    const second = page(rows, {
      limit: 2,
      cursor: decodeReplayCursor(first.next_cursor!)
    }).window;
    expect(second.events.map((e) => e.evidence_id)).toEqual(["c"]);
    expect(second.next_cursor).toBeNull();
  });
});

describe("bounds", () => {
  test("501 rows -> 500 events and a next_cursor; the next page returns the 501st", () => {
    const rows: ReplayEvidenceRow[] = [];
    for (let i = 0; i < 501; i += 1) {
      rows.push(hermes(`evt-${String(i).padStart(4, "0")}`, Math.floor(i / 2)));
    }
    const first = page(rows).window;
    expect(first.events).toHaveLength(500);
    expect(first.next_cursor).not.toBeNull();
    const second = page(rows, {
      cursor: decodeReplayCursor(first.next_cursor!)
    }).window;
    expect(second.events).toHaveLength(1);
    expect(second.events[0]!.evidence_id).toBe("evt-0500");
    expect(second.next_cursor).toBeNull();
  });

  test("exactly 500 rows -> no next_cursor; limit is clamped to 1..500", () => {
    const rows = Array.from({ length: 500 }, (_, i) =>
      hermes(`evt-${String(i).padStart(4, "0")}`, i)
    );
    expect(page(rows).window.next_cursor).toBeNull();
    expect(page(rows, { limit: 10_000 }).window.events).toHaveLength(500);
    expect(page(rows, { limit: 0 }).window.events).toHaveLength(1);
    expect(page(rows, { limit: 3 }).window.events).toHaveLength(3);
  });

  test("a cursor of the longest legal evidence id still fits the schema's 256-character bound", () => {
    const id = "a".repeat(128);
    const rows = [hermes(id, 1), hermes("b", 2)];
    const first = page(rows, { limit: 1 }).window;
    expect(first.next_cursor!.length).toBeLessThanOrEqual(256);
  });

  test("every page validates against the vendored replay-window schema", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => hermes(`evt-${i}`, i));
    const window = page(rows, {
      limit: 5,
      evidenceGaps: [
        {
          source_kind: "omes_server_inventory",
          from: FROM,
          to: TO,
          reason: "not_retained"
        }
      ]
    }).window;
    await assertMissionControlReplayWindowValid(window);

    const broken = {
      ...window,
      events: [{ ...window.events[0]!, kind: "bogus" }]
    } as unknown as MissionControlReplayWindow;
    await expect(
      assertMissionControlReplayWindowValid(broken)
    ).rejects.toBeInstanceOf(MissionControlReplayInvalidError);
  });
});

describe("evidence gaps — shown as gaps, never interpolated", () => {
  const consultedAll = MISSION_CONTROL_SOURCE_KINDS.map((sourceKind) => ({
    sourceKind,
    available: true
  }));
  const wide = { from: "2026-10-02T00:00:00Z", to: "2026-10-02T08:00:00Z" };

  test("current_only sources are not_retained over the WHOLE window; unreadable sources are source_unavailable only", () => {
    const gaps = computeEvidenceGaps(wide, {}, [
      ...consultedAll.filter(
        (s) => s.sourceKind !== "omes_ai_privacy_posture_view"
      ),
      { sourceKind: "omes_ai_privacy_posture_view", available: false }
    ]);
    const currentOnly = [
      "omes_server_inventory",
      "omes_deployment_view",
      "omes_architecture_capabilities_view",
      "github_repository_progress_view"
    ];
    for (const source of currentOnly) {
      expect(gaps).toContainEqual({
        source_kind: source,
        from: wide.from,
        to: wide.to,
        reason: "not_retained"
      });
    }
    expect(
      gaps.filter((g) => g.source_kind === "omes_ai_privacy_posture_view")
    ).toEqual([
      {
        source_kind: "omes_ai_privacy_posture_view",
        from: wide.from,
        to: wide.to,
        reason: "source_unavailable"
      }
    ]);
    // Intermediate steps of a terminal_transitions source are an explicit gap too.
    for (const source of ["omes_job_status", "awcms_workflow_approval"]) {
      expect(gaps).toContainEqual({
        source_kind: source,
        from: wide.from,
        to: wide.to,
        reason: "not_retained"
      });
    }
    // event_log / snapshot_series sources with no retention info claim nothing.
    expect(
      gaps.some((g) => g.source_kind === "hermes_orchestration_tree")
    ).toBe(false);
  });

  test("the source map classifies exactly these kinds as current_only", () => {
    const currentOnly: string[] = MISSION_CONTROL_KINDS.filter(
      (kind) => SOURCE_MAP.kinds[kind].replay_basis === "current_only"
    ).sort();
    expect(currentOnly).toEqual(
      [
        "server",
        "deployment",
        "architecture_plane",
        "capability",
        "repository_milestone",
        "ai_privacy_posture"
      ].sort()
    );
  });

  test("a window before the earliest retained row is before_first_observation (and a source with no rows at all, the whole window)", () => {
    const gaps = computeEvidenceGaps(
      wide,
      {
        omes_health_readiness: {
          earliest: "2026-10-02T03:00:00Z",
          horizon: null
        },
        hermes_orchestration_tree: { earliest: null, horizon: null }
      },
      consultedAll
    );
    expect(gaps).toContainEqual({
      source_kind: "omes_health_readiness",
      from: wide.from,
      to: "2026-10-02T03:00:00Z",
      reason: "before_first_observation"
    });
    expect(gaps).toContainEqual({
      source_kind: "hermes_orchestration_tree",
      from: wide.from,
      to: wide.to,
      reason: "before_first_observation"
    });
  });

  test("a window older than the data-lifecycle horizon is retention_expired up to the horizon only", () => {
    const gaps = computeEvidenceGaps(
      wide,
      {
        omes_health_readiness: {
          earliest: "2026-10-02T04:00:00Z",
          horizon: "2026-10-02T02:00:00Z"
        }
      },
      consultedAll
    );
    const health = gaps.filter(
      (g) => g.source_kind === "omes_health_readiness"
    );
    expect(health).toEqual([
      {
        source_kind: "omes_health_readiness",
        from: wide.from,
        to: "2026-10-02T02:00:00Z",
        reason: "retention_expired"
      },
      {
        source_kind: "omes_health_readiness",
        from: "2026-10-02T02:00:00Z",
        to: "2026-10-02T04:00:00Z",
        reason: "before_first_observation"
      }
    ]);
    // A window entirely inside retention reports neither.
    expect(
      computeEvidenceGaps(
        { from: "2026-10-02T05:00:00Z", to: "2026-10-02T06:00:00Z" },
        {
          omes_health_readiness: {
            earliest: "2026-10-02T04:00:00Z",
            horizon: "2026-10-02T02:00:00Z"
          }
        },
        consultedAll
      ).filter((g) => g.source_kind === "omes_health_readiness")
    ).toEqual([]);
  });

  test("gaps are ordered by source-map order then reason, bounded by the schema's 64, and deterministic", () => {
    const first = computeEvidenceGaps(wide, {}, consultedAll);
    const second = computeEvidenceGaps(wide, {}, [...consultedAll].reverse());
    expect(second).toEqual(first);
    expect(first.length).toBeLessThanOrEqual(64);
    const order = Object.keys(SOURCE_MAP.sources);
    const indexes = first.map((g) => order.indexOf(g.source_kind));
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
  });

  test("missing evidence yields NO event and NO node — a gap is never turned into a state", () => {
    expect(page([]).window.events).toEqual([]);
    const scene = composeHistoricalScene(
      {
        sources: consultedAll,
        evidence: [],
        anchors: [],
        gaps: computeEvidenceGaps(wide, {}, consultedAll)
      },
      { tenantId: TENANT, now: NOW, asOf: NOW }
    );
    expect(scene.nodes).toEqual([]);
    expect(scene.evidence_gaps!.length).toBeGreaterThan(0);
  });
});

describe("parseReplayQuery / parseSceneQuery — strict, no free-form fields", () => {
  const params = (init: Record<string, string>) => new URLSearchParams(init);
  const ok = { from: "2026-10-02T07:00:00Z", to: "2026-10-02T08:00:00Z" };

  test("a valid window parses; the window may be exactly 24 hours", () => {
    const parsed = parseReplayQuery(params(ok), NOW);
    expect(parsed.ok).toBe(true);
    const day = parseReplayQuery(
      params({ from: "2026-10-01T08:00:00Z", to: "2026-10-02T08:00:00Z" }),
      NOW
    );
    expect(day.ok).toBe(true);
  });

  test("a window longer than 24 hours, from >= to, a future `to` and malformed instants are rejected", () => {
    const rejected = [
      { from: "2026-10-01T07:59:59Z", to: "2026-10-02T08:00:00Z" },
      { from: "2026-10-02T08:00:00Z", to: "2026-10-02T08:00:00Z" },
      { from: "2026-10-02T09:00:00Z", to: "2026-10-02T07:00:00Z" },
      { from: "2026-10-02T07:00:00Z", to: "2026-10-02T08:00:01Z" },
      { from: "2026-10-02T07:00:00.500Z", to: "2026-10-02T08:00:00Z" },
      { from: "2026-10-02T07:00:00+02:00", to: "2026-10-02T08:00:00Z" },
      { from: "2026-02-30T07:00:00Z", to: "2026-10-02T08:00:00Z" },
      { from: "yesterday", to: "now" },
      { from: ok.from },
      { to: ok.to }
    ];
    for (const init of rejected) {
      expect(
        parseReplayQuery(params(init as Record<string, string>), NOW).ok
      ).toBe(false);
    }
    expect(MISSION_CONTROL_REPLAY_MAX_WINDOW_MS).toBe(24 * 3600 * 1000);
  });

  test("an unknown query parameter is rejected, not ignored; so is a repeated one", () => {
    expect(parseReplayQuery(params({ ...ok, limit: "10" }), NOW)).toEqual({
      ok: false,
      message: "Unknown query parameter 'limit'."
    });
    expect(parseReplayQuery(params({ ...ok, tenant_id: "x" }), NOW).ok).toBe(
      false
    );
    const repeated = new URLSearchParams(
      "from=2026-10-02T07:00:00Z&from=2026-10-02T06:00:00Z&to=2026-10-02T08:00:00Z"
    );
    expect(parseReplayQuery(repeated, NOW).ok).toBe(false);
    expect(
      parseSceneQuery(params({ as_of: TO, kind: "job" }), NOW, 1e9).ok
    ).toBe(false);
  });

  test("a cursor must decode and belong to the window", () => {
    const inside = encodeReplayCursor({
      at: "2026-10-02T07:30:00.000000Z",
      evidenceKind: "hermes_event",
      evidenceId: "e"
    });
    const outside = encodeReplayCursor({
      at: "2026-10-02T06:00:00.000000Z",
      evidenceKind: "hermes_event",
      evidenceId: "e"
    });
    expect(parseReplayQuery(params({ ...ok, cursor: inside }), NOW).ok).toBe(
      true
    );
    expect(parseReplayQuery(params({ ...ok, cursor: outside }), NOW).ok).toBe(
      false
    );
    expect(
      parseReplayQuery(params({ ...ok, cursor: "garbage!" }), NOW).ok
    ).toBe(false);
  });

  test("as_of: absent = live; must not be in the future nor older than the retention horizon", () => {
    const day = 24 * 3600 * 1000;
    expect(parseSceneQuery(params({}), NOW, 90 * day)).toEqual({
      ok: true,
      value: { asOf: null }
    });
    expect(parseSceneQuery(params({ as_of: TO }), NOW, 90 * day).ok).toBe(true);
    expect(
      parseSceneQuery(params({ as_of: "2026-10-02T08:00:01Z" }), NOW, 90 * day)
        .ok
    ).toBe(false);
    expect(
      parseSceneQuery(params({ as_of: "2026-06-01T00:00:00Z" }), NOW, 90 * day)
        .ok
    ).toBe(false);
    expect(parseSceneQuery(params({ as_of: "soon" }), NOW, 90 * day).ok).toBe(
      false
    );
  });
});

describe("composeHistoricalScene", () => {
  const ASOF = new Date("2026-10-02T07:10:00Z");
  const sources = MISSION_CONTROL_SOURCE_KINDS.map((sourceKind) => ({
    sourceKind,
    available: true
  }));
  const ev = (
    row: Partial<HistoricalEvidenceRow> &
      Pick<HistoricalEvidenceRow, "kind" | "sourceId" | "at" | "sourceState">
  ): HistoricalEvidenceRow => ({
    recordedAt: row.at,
    evidenceKind: "hermes_event",
    evidenceId: `${row.kind}-${row.sourceId}-${String(row.at)}`,
    ...row
  });

  const evidence: HistoricalEvidenceRow[] = [
    ev({
      kind: "hermes_subagent",
      sourceId: "root",
      at: "2026-10-02T07:05:00Z",
      sourceState: "PENDING",
      label: "orchestrator"
    }),
    ev({
      kind: "hermes_subagent",
      sourceId: "root",
      at: "2026-10-02T07:09:00Z",
      sourceState: "RUNNING",
      label: "orchestrator"
    }),
    ev({
      kind: "hermes_subagent",
      sourceId: "root",
      at: "2026-10-02T07:20:00Z",
      sourceState: "SUCCEEDED",
      label: "orchestrator"
    }),
    ev({
      kind: "hermes_subagent",
      sourceId: "child",
      at: "2026-10-02T07:12:00Z",
      sourceState: "RUNNING",
      parentSourceId: "root"
    }),
    ev({
      kind: "health_report",
      sourceId: "srv-1",
      at: "2026-10-02T07:00:00Z",
      sourceState: "healthy",
      evidenceKind: "health_snapshot",
      serverId: "srv-1"
    }),
    ev({
      kind: "backup",
      sourceId: "bk-1",
      at: "2026-10-02T06:30:00Z",
      sourceState: "verified",
      evidenceKind: "backup_snapshot",
      serverId: "srv-1"
    })
  ];
  const anchors = [
    {
      kind: "server" as const,
      sourceId: "srv-1",
      label: "host-1.example.test",
      sourceState: "online",
      freshness: "live" as const,
      observedAt: "2026-10-02T07:59:00Z"
    },
    {
      kind: "deployment" as const,
      sourceId: "dep-1",
      label: "dep-1",
      sourceState: "converged",
      freshness: "live" as const,
      observedAt: "2026-10-02T07:59:00Z",
      evidence: { serverId: "srv-1" }
    }
  ];

  function compose(asOf = ASOF, rows = evidence) {
    return composeHistoricalScene(
      {
        sources,
        evidence: rows,
        anchors,
        gaps: computeEvidenceGaps(
          { from: "2026-10-01T07:10:00Z", to: "2026-10-02T07:10:00Z" },
          {},
          sources
        )
      },
      { tenantId: TENANT, now: NOW, asOf }
    );
  }
  const find = (scene: ReturnType<typeof compose>, kind: string, id: string) =>
    scene.nodes.find((n) => n.kind === kind && n.source_id === id);

  test("is historical, as_of is the requested instant, and it validates against the vendored scene schema", async () => {
    const scene = compose();
    expect(scene.mode).toBe("historical");
    expect(scene.as_of).toBe("2026-10-02T07:10:00Z");
    expect(scene.generated_at).toBe("2026-10-02T08:00:00Z");
    await assertMissionControlSceneValid(scene);
    expect(scene.evidence_gaps).toBeDefined();
  });

  test("each object is in the state of its LATEST evidence at or before as_of; later evidence is ignored", () => {
    const scene = compose();
    expect(find(scene, "hermes_subagent", "root")!.source_state).toBe(
      "RUNNING"
    );
    expect(find(scene, "hermes_subagent", "root")!.label).toBe("orchestrator");
    const later = compose(new Date("2026-10-02T07:25:00Z"));
    expect(find(later, "hermes_subagent", "root")!.source_state).toBe(
      "SUCCEEDED"
    );
  });

  test("a node is absent before its first evidence — it did not provably exist yet", () => {
    // The child's first evidence is 07:12; the scene at 07:10 has no child.
    expect(find(compose(), "hermes_subagent", "child")).toBeUndefined();
    expect(
      find(
        compose(new Date("2026-10-02T07:12:00Z")),
        "hermes_subagent",
        "child"
      )
    ).toBeDefined();
    // Before ANY evidence only the anchors remain.
    const empty = compose(new Date("2026-10-02T05:00:00Z"));
    expect(empty.nodes.map((n) => n.kind).sort()).toEqual([
      "deployment",
      "server"
    ]);
  });

  test("current_only objects are unknown, not_reported and never back-dated", () => {
    const scene = compose();
    for (const [kind, id] of [
      ["server", "srv-1"],
      ["deployment", "dep-1"]
    ] as const) {
      const node = find(scene, kind, id)!;
      expect(node.source_state).toBe("not_reported");
      expect(node.freshness).toBe("unknown");
      expect(node.visual_state).toBe("unknown");
      expect(node.observed_at).toBeNull();
    }
    expect(
      scene
        .evidence_gaps!.filter((g) => g.reason === "not_retained")
        .map((g) => g.source_kind)
    ).toContain("omes_server_inventory");
    // The present-day state strings never leak into the historical scene.
    expect(JSON.stringify(scene)).not.toContain("converged");
    expect(JSON.stringify(scene)).not.toContain('"online"');
  });

  test("a source whose last evidence is older than its budget at as_of is stale, never live", () => {
    // Hermes budget is 120 s: root's last evidence at 07:09 is 60 s old at 07:10 (live)…
    expect(find(compose(), "hermes_subagent", "root")!.freshness).toBe("live");
    // …but 10 minutes later with no newer evidence it is stale (SUCCEEDED -> stale, RUNNING -> stale).
    const rows = evidence.filter((e) => e.at !== "2026-10-02T07:20:00Z");
    const scene = compose(new Date("2026-10-02T07:19:00Z"), rows);
    const root = find(scene, "hermes_subagent", "root")!;
    expect(root.source_state).toBe("RUNNING");
    expect(root.freshness).toBe("stale");
    expect(root.visual_state).toBe("stale");
    // Health has a 1,800 s budget: still live at 07:10, stale at 07:40.
    expect(find(compose(), "health_report", "srv-1")!.freshness).toBe("live");
    expect(
      find(compose(new Date("2026-10-02T07:40:00Z")), "health_report", "srv-1")!
        .freshness
    ).toBe("stale");
    // A last-known PROBLEM keeps its colour when stale.
    const failing = compose(new Date("2026-10-02T09:00:00Z"), [
      ev({
        kind: "health_report",
        sourceId: "srv-9",
        at: "2026-10-02T07:00:00Z",
        sourceState: "unhealthy",
        evidenceKind: "health_snapshot"
      })
    ]);
    expect(find(failing, "health_report", "srv-9")!.visual_state).toBe(
      "failed"
    );
  });

  test("a terminal job state never goes stale; a non-terminal one ages with the job budget", () => {
    const rows: HistoricalEvidenceRow[] = [
      ev({
        kind: "job",
        sourceId: "job-done",
        at: "2026-10-02T06:00:00Z",
        sourceState: "completed",
        evidenceKind: "job_record",
        evidenceId: "j1:terminal"
      }),
      ev({
        kind: "job",
        sourceId: "job-queued",
        at: "2026-10-02T06:00:00Z",
        sourceState: "queued",
        evidenceKind: "job_record",
        evidenceId: "j2:created"
      })
    ];
    const scene = compose(new Date("2026-10-02T07:10:00Z"), rows);
    expect(find(scene, "job", "job-done")!.freshness).toBe("live");
    expect(find(scene, "job", "job-done")!.visual_state).toBe("ok");
    expect(find(scene, "job", "job-queued")!.freshness).toBe("stale");
    expect(find(scene, "job", "job-queued")!.visual_state).toBe("stale");
  });

  test("relations come only from evidence fields (parent_source_id, a row's server_id) and from the anchors' own links", () => {
    const scene = compose(new Date("2026-10-02T07:15:00Z"));
    const id = (kind: string, sourceId: string) =>
      find(scene, kind, sourceId)!.node_id;
    const has = (from: string, to: string, relation: string) =>
      scene.relations.some(
        (r) => r.from === from && r.to === to && r.relation === relation
      );
    expect(
      has(
        id("hermes_subagent", "root"),
        id("hermes_subagent", "child"),
        "delegates_to"
      )
    ).toBe(true);
    expect(has(id("server", "srv-1"), id("deployment", "dep-1"), "hosts")).toBe(
      true
    );
    expect(
      has(id("health_report", "srv-1"), id("server", "srv-1"), "describes")
    ).toBe(true);
    expect(has(id("backup", "bk-1"), id("server", "srv-1"), "protects")).toBe(
      true
    );
    // awaits_decision_for needs a present-day join and is not reconstructed.
    expect(
      scene.relations.some((r) => r.relation === "awaits_decision_for")
    ).toBe(false);
  });

  test("anchors of an event-backed kind are ignored — present-day state can never stand in for history", () => {
    const scene = composeHistoricalScene(
      {
        sources,
        evidence: [],
        anchors: [
          {
            kind: "job",
            sourceId: "job-now",
            label: "job-now",
            sourceState: "running",
            freshness: "live",
            observedAt: "2026-10-02T07:59:00Z"
          }
        ],
        gaps: []
      },
      { tenantId: TENANT, now: NOW, asOf: ASOF }
    );
    expect(scene.nodes).toEqual([]);
  });

  test("an unavailable source contributes no node, even if evidence rows were handed in", () => {
    const scene = composeHistoricalScene(
      {
        sources: sources.map((s) =>
          s.sourceKind === "hermes_orchestration_tree"
            ? { ...s, available: false }
            : s
        ),
        evidence,
        anchors,
        gaps: []
      },
      { tenantId: TENANT, now: NOW, asOf: ASOF }
    );
    expect(scene.nodes.some((n) => n.kind === "hermes_subagent")).toBe(false);
    expect(
      scene.sources.find((s) => s.source_kind === "hermes_orchestration_tree")!
        .status
    ).toBe("unavailable");
  });

  test("untrusted labels stay verbatim; secret-shaped ones are omitted and counted; the scene is composed through the live composer's bounds", async () => {
    const scene = composeHistoricalScene(
      {
        sources,
        evidence: [
          ev({
            kind: "hermes_subagent",
            sourceId: "xss",
            at: "2026-10-02T07:05:00Z",
            sourceState: "RUNNING",
            label: "<img src=x onerror=alert(1)>"
          }),
          ev({
            kind: "hermes_subagent",
            sourceId: "leak",
            at: "2026-10-02T07:05:00Z",
            sourceState: "RUNNING",
            label: "Bearer aaaaaaaaaaaaaaaaaaaaaaaa"
          })
        ],
        anchors: [],
        gaps: [],
        extraTruncatedNodes: 7
      },
      { tenantId: TENANT, now: NOW, asOf: ASOF }
    );
    expect(find(scene, "hermes_subagent", "xss")!.label).toBe(
      "<img src=x onerror=alert(1)>"
    );
    expect(find(scene, "hermes_subagent", "leak")).toBeUndefined();
    expect(scene.truncated.nodes).toBe(1 + 7);
    await assertMissionControlSceneValid(scene);
  });

  test("it is deterministic regardless of evidence order", () => {
    const expected = JSON.stringify(compose());
    for (const seed of [1, 2, 3]) {
      expect(JSON.stringify(compose(ASOF, shuffled(evidence, seed)))).toBe(
        expected
      );
    }
  });
});

describe("vendored replay-window fixtures", () => {
  test("every valid-*.json validates and its visual_state equals the deterministic derivation; every invalid-*.json is rejected", async () => {
    const files = await listFixtureFiles("mission-control-replay-window");
    const valid = files.filter((f) => f.startsWith("valid-"));
    const invalid = files.filter((f) => f.startsWith("invalid-"));
    expect(valid.length).toBeGreaterThanOrEqual(2);
    expect(invalid.length).toBeGreaterThanOrEqual(4);
    for (const file of valid) {
      const { value, floatLiteralPaths } = await loadFixture(
        "mission-control-replay-window",
        file
      );
      expect(
        await validateOmesContract(
          "mission-control-replay-window",
          value as JsonValue,
          { floatLiteralPaths }
        )
      ).toEqual([]);
      const window = value as unknown as MissionControlReplayWindow;
      for (const event of window.events) {
        expect(deriveVisualState(event.kind, event.source_state, "live")).toBe(
          event.visual_state
        );
      }
      // The fixture's own cursor, when present, is a legal opaque cursor shape.
      if (window.next_cursor)
        expect(window.next_cursor).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
    }
    for (const file of invalid) {
      const { value, floatLiteralPaths } = await loadFixture(
        "mission-control-replay-window",
        file
      );
      expect(
        (
          await validateOmesContract(
            "mission-control-replay-window",
            value as JsonValue,
            { floatLiteralPaths }
          )
        ).length
      ).toBeGreaterThan(0);
    }
  });

  test("a vendored valid fixture, re-fed through the builder as rows, comes back schema-valid and ordered", async () => {
    const { value } = await loadFixture(
      "mission-control-replay-window",
      "valid-01-hermes-and-jobs.json"
    );
    const source = value as unknown as MissionControlReplayWindow;
    const rows: ReplayEvidenceRow[] = source.events.map((e) => ({
      at: e.at,
      recordedAt: e.at,
      evidenceKind: e.evidence_kind,
      evidenceId: e.evidence_id,
      kind: e.kind,
      sourceId: e.source_id,
      parentSourceId: e.parent_source_id ?? null,
      sourceState: e.source_state,
      correlationId: e.correlation_id ?? null
    }));
    const rebuilt = buildReplayWindow(shuffled(rows, 9), {
      tenantId: source.tenant_id,
      now: new Date(source.generated_at),
      window: source.window,
      evidenceGaps: source.evidence_gaps
    });
    await assertMissionControlReplayWindowValid(rebuilt);
    expect(rebuilt.events.map((e) => e.evidence_id)).toEqual(
      source.events.map((e) => e.evidence_id)
    );
  });
});

describe("toExactInstant", () => {
  test("normalises Date and ISO strings to six fractional digits and rejects non-instants", () => {
    expect(toExactInstant(new Date("2026-10-02T07:00:00.123Z"))).toBe(
      "2026-10-02T07:00:00.123000Z"
    );
    expect(toExactInstant("2026-10-02T07:00:00Z")).toBe(
      "2026-10-02T07:00:00.000000Z"
    );
    expect(toExactInstant("2026-10-02T07:00:00.12Z")).toBe(
      "2026-10-02T07:00:00.120000Z"
    );
    expect(toExactInstant("2026-10-02T07:00:00.1234567Z")).toBeNull();
    expect(toExactInstant("2026-02-31T07:00:00Z")).toBeNull();
    expect(toExactInstant(null)).toBeNull();
    expect(toExactInstant(new Date("nope"))).toBeNull();
  });
});

describe("performance evidence — 5,000 synthetic rows", () => {
  test("pages 5,000 rows (nested Hermes delegations, one long session) in 500-event pages; every page bounded and the walk is complete and ordered", async () => {
    const random = mulberry32(266);
    const rows: ReplayEvidenceRow[] = [];
    // One long session: 1,000 subagents in a delegation chain (sub-N is a child
    // of sub-(N-1)), five events each; plus ~10% recorded out of order.
    for (let i = 0; i < 5000; i += 1) {
      const sub = Math.floor(i / 5);
      const seconds = Math.floor(random() * 3500);
      rows.push({
        at: at(seconds),
        recordedAt: at(seconds + (random() < 0.1 ? 120 : 1)),
        evidenceKind: "hermes_event",
        evidenceId: `evt-${String(i).padStart(5, "0")}`,
        kind: "hermes_subagent",
        sourceId: `sub-${sub}`,
        parentSourceId: sub === 0 ? null : `sub-${sub - 1}`,
        sourceState: ["PENDING", "STARTING", "RUNNING", "RUNNING", "SUCCEEDED"][
          i % 5
        ]!
      });
    }
    // Hand the builder a shuffled, partly duplicated input: the realistic worst case.
    const input = shuffled([...rows, ...rows.slice(0, 250)], 11);

    const started = performance.now();
    const seen = new Set<string>();
    let cursor = null as ReturnType<typeof decodeReplayCursor>;
    let pages = 0;
    let previousAt = "";
    let late = 0;
    const pageMs: number[] = [];
    for (let guard = 0; guard < 50; guard += 1) {
      const pageStarted = performance.now();
      const result = buildReplayPage(input, {
        tenantId: TENANT,
        now: NOW,
        window: WINDOW,
        cursor
      });
      pageMs.push(performance.now() - pageStarted);
      pages += 1;
      expect(result.window.events.length).toBeLessThanOrEqual(500);
      for (const event of result.window.events) {
        expect(event.at >= previousAt).toBe(true);
        previousAt = event.at;
        seen.add(event.evidence_id);
        if (event.provenance === "late_arrival") late += 1;
      }
      if (!result.window.next_cursor) break;
      cursor = decodeReplayCursor(result.window.next_cursor);
      expect(cursor).not.toBeNull();
    }
    const totalMs = performance.now() - started;
    expect(seen.size).toBe(5000);
    expect(pages).toBe(10);
    expect(late).toBeGreaterThan(0);

    const sceneStarted = performance.now();
    const scene = composeHistoricalScene(
      {
        sources: MISSION_CONTROL_SOURCE_KINDS.map((sourceKind) => ({
          sourceKind,
          available: true
        })),
        evidence: rows.map((r) => ({ ...r, label: "worker" })),
        anchors: [],
        gaps: []
      },
      {
        tenantId: TENANT,
        now: NOW,
        asOf: new Date(Date.parse(FROM) + 3000 * 1000)
      }
    );
    const sceneMs = performance.now() - sceneStarted;
    await assertMissionControlSceneValid(scene);
    expect(scene.nodes.length).toBeLessThanOrEqual(500);

    const mean = pageMs.reduce((a, b) => a + b, 0) / pageMs.length;
    console.log(
      `[mission-control replay perf] builder over 5,250 input rows (5,000 unique): ${pages} pages, ` +
        `mean ${mean.toFixed(1)} ms, worst ${Math.max(...pageMs).toFixed(1)} ms/page, total ${totalMs.toFixed(0)} ms; ` +
        `historical scene (1,000 subagents, ${scene.nodes.length} nodes, ${scene.relations.length} relations) ${sceneMs.toFixed(1)} ms`
    );
    // Generous ceilings: a regression to quadratic behaviour fails, machine noise does not.
    expect(totalMs).toBeLessThan(15_000);
    expect(sceneMs).toBeLessThan(3_000);
  });
});
