/**
 * Contract tests for `/admin/omes/mission-control` — the 3D Mission Control
 * workspace, Issue ahliweb/omes#265 (epic ahliweb/omes#263; contract #264,
 * ADR-0031). Sibling of `admin-omes-control-hermes-orchestration-page-contract
 * .test.ts` — same pattern: pure, no database, no browser. It pins what the
 * page and its client modules MUST keep doing, because a WebGL scene cannot be
 * exercised here:
 *
 *   - the page is gated on `omes_control.servers.read` ONLY (no new permission);
 *   - the accessible object list is server-rendered and is the canonical view;
 *   - the canvas is a decorative `aria-hidden` mirror;
 *   - untrusted labels never reach `innerHTML`/`set:html`;
 *   - nothing mutating, no inline style, no inline script, no data island.
 *
 * Runtime behaviour (picking, camera, polling) is covered by the pure
 * `mission-control-layout`/`mission-control-math` tests and, for the browser, by
 * the frame-time method recorded in the module README.
 */
import { readFile, readdir } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import {
  MISSION_CONTROL_KINDS,
  MISSION_CONTROL_VISUAL_STATES
} from "../src/modules/omes-control/domain/mission-control-types";
import {
  KIND_SOURCE,
  KIND_ZONE,
  VISUAL_STATE_TONE,
  isSafeDetailRoute,
  nodeKey
} from "../src/lib/ui/mission-control/vocab";

const PAGE = "src/pages/admin/omes/mission-control.astro";
const CLIENT_DIR = "src/lib/ui/mission-control";
const SOURCE_MAP =
  "src/modules/omes-control/contracts/v1/mission-control-source-map.json";

async function clientSources(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of await readdir(CLIENT_DIR)) {
    if (name.endsWith(".ts")) {
      out[name] = await readFile(`${CLIENT_DIR}/${name}`, "utf8");
    }
  }
  return out;
}

/** Source with block comments and whole-line `//` comments removed. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** The markup between the frontmatter fence and the page `<script>`. */
function template(source: string): string {
  const body = source.slice(source.indexOf("---", 3) + 3);
  return body.slice(0, body.lastIndexOf("<script>"));
}

describe("mission-control.astro permission contract", () => {
  test("the literal guard triple is omes_control.servers.read and is the only triple", async () => {
    const source = await readFile(PAGE, "utf8");
    const triples = [
      ...source.matchAll(
        /moduleKey:\s*"omes_control",\s*activityCode:\s*"([a-z_]+)",\s*action:\s*"([a-z]+)"/g
      )
    ].map((m) => `omes_control.${m[1]}.${m[2]}`);

    expect(triples).toEqual(["omes_control.servers.read"]);
    expect(source).toContain("authorize: SERVERS_READ_GUARD");
    expect(source).toMatch(/\}\s*as const;/);
  });

  test("the nav entry reuses servers.read, sits at order 104, and adds no permission", () => {
    const mod = listModules().find((m) => m.key === "omes_control");
    const entry = (mod?.navigation ?? []).find(
      (item) => item.path === "/admin/omes/mission-control"
    );

    expect(entry).toBeDefined();
    expect(entry?.labelKey).toBe("admin.layout.nav_omes_mission_control");
    expect(entry?.order).toBe(104);
    expect(entry?.requiredPermission).toBe("omes_control.servers.read");
    expect(
      (mod?.permissions ?? []).some((p) =>
        `${p.activityCode}`.includes("mission")
      )
    ).toBe(false);
  });

  test("the page composes the scene through the viewer-aware directory", async () => {
    const source = await readFile(PAGE, "utf8");
    expect(source).toContain("composeMissionControlSceneForViewer");
    expect(source).toMatch(/composeMissionControlSceneForViewer\(\{\s*tx,/);
    expect(source).toContain("can");
    expect(source).toContain("logAdminPageError");
  });
});

describe("mission-control.astro rendering contract", () => {
  test("renders allowed, denied and error states", async () => {
    const source = await readFile(PAGE, "utf8");
    expect(source).toContain('id="omes-mc-denied"');
    expect(source).toContain('id="omes-mc-error"');
    expect(source).toContain("screen.state");
  });

  test("never uses set:html, an inline style attribute, or an inline/data-island script", async () => {
    const source = code(await readFile(PAGE, "utf8"));
    const markup = template(source);

    expect(source).not.toContain("set:html");
    expect(source).not.toContain("is:inline");
    expect(markup).not.toMatch(/\sstyle\s*=/);
    expect(markup).not.toMatch(/<script/);
    expect(source).not.toContain('type="application/json"');
  });

  test("the canvas lives inside an aria-hidden, initially hidden region, with a hidden fallback notice", async () => {
    const markup = template(await readFile(PAGE, "utf8"));
    const stage = markup.match(/<div[^>]*id="omes-mc-stage"[\s\S]*?<\/div>/);

    expect(stage?.[0]).toContain('aria-hidden="true"');
    expect(stage?.[0]).toContain("hidden");
    expect(stage?.[0]).toContain("<canvas");
    expect(markup).toMatch(/id="omes-mc-fallback"[\s\S]*?hidden/);
    // The fallback notice is OUTSIDE the aria-hidden region so it is announced.
    expect(stage?.[0]).not.toContain("omes-mc-fallback");
  });

  test("the accessible object list is server-rendered, grouped by zone, with a button and an Open-details link per object", async () => {
    const markup = template(await readFile(PAGE, "utf8"));

    expect(markup).toContain('id="omes-mc-list"');
    expect(markup).toContain("<h3");
    expect(markup).toMatch(
      /<button[\s\S]*?type="button"[\s\S]*?class="omes-mc-obj"/
    );
    for (const attr of [
      "data-node-id={node.node_id}",
      "data-kind={node.kind}",
      "data-source-id={node.source_id}"
    ]) {
      expect(markup).toContain(attr);
    }
    expect(markup).toContain("href={node.detail_route}");
    expect(markup).toContain('t("Open details")');
    // Visual state is TEXT inside a status pill, never colour alone.
    expect(markup).toContain("{STATE_LABEL[node.visual_state]}");
    expect(markup).toContain("admin-status-pill");
    // Untrusted label rendered as an escaped text node.
    expect(markup).toContain("{node.label}");
  });

  test("the HUD is an aria-live region, read-only, with no action buttons", async () => {
    const markup = template(await readFile(PAGE, "utf8"));
    const hud = markup.match(/<aside[\s\S]*?<\/aside>/)?.[0] ?? "";

    expect(hud).toContain('id="omes-mc-hud"');
    expect(hud).toContain('aria-live="polite"');
    expect(hud).not.toContain("<button");
    expect(hud).not.toContain("<form");
    for (const field of [
      "kind",
      "authority",
      "sourceStatus",
      "sourceId",
      "sourceState",
      "state",
      "freshness",
      "observed",
      "summary",
      "link"
    ]) {
      expect(hud).toContain(`data-hud="${field}"`);
    }
  });

  test("has the zone/state filters, a Reset view button, source strip and truncation notice", async () => {
    const markup = template(await readFile(PAGE, "utf8"));
    for (const id of [
      "omes-mc-filter-zone",
      "omes-mc-filter-state",
      "omes-mc-reset",
      "omes-mc-sources",
      "omes-mc-truncated",
      "omes-mc-connectivity",
      "omes-mc-asof"
    ]) {
      expect(markup).toContain(`id="${id}"`);
    }
    expect(markup).toContain("SOURCE_STATE_LABEL[source.status]");
    expect(markup).toContain("AUTHORITY_LABEL[source.authority]");
  });

  test("the page is read-only: no mutating request, form or action control", async () => {
    const source = await readFile(PAGE, "utf8");
    expect(source).not.toMatch(/method\s*[:=]\s*["']?(POST|PUT|PATCH|DELETE)/i);
    expect(source).not.toContain("<form");
    expect(source).not.toContain('type="submit"');
  });

  test("the scene reaches the client as an escaped data attribute, without the tenant id", async () => {
    const source = await readFile(PAGE, "utf8");
    expect(source).toContain("data-scene={clientScene}");
    expect(source).toContain("JSON.stringify({");
    expect(source).not.toContain("tenant_id: scene.tenant_id");
    expect(source).toContain("data-labels={JSON.stringify(CLIENT_LABELS)}");
  });

  test("the page script imports the controller (a real cross-chunk import, never inline)", async () => {
    const source = await readFile(PAGE, "utf8");
    const script = source.slice(source.lastIndexOf("<script>"));

    expect(script).toMatch(
      /import \{ startMissionControl \} from "\.\.\/\.\.\/\.\.\/lib\/ui\/mission-control\/controller"/
    );
    expect(script).toContain("startMissionControl()");
  });

  test("every visible string goes through t(): no bare English text nodes in the markup", async () => {
    const markup = template(await readFile(PAGE, "utf8"));
    // Text nodes between `>` and `<` that contain a run of letters and are not
    // a `{...}` expression are untranslated literals.
    const literals = [...markup.matchAll(/>([^<>{}]*[A-Za-z]{3,}[^<>{}]*)</g)]
      .map((m) => (m[1] as string).trim())
      .filter((text) => text.length > 0);
    expect(literals).toEqual([]);
  });
});

describe("Mission Control client modules", () => {
  test("never assign untrusted data through innerHTML, outerHTML, insertAdjacentHTML or document.write", async () => {
    const sources = await clientSources();
    expect(Object.keys(sources).sort()).toEqual([
      "controller.ts",
      "layout.ts",
      "math.ts",
      "scene-gl.ts",
      "vocab.ts"
    ]);
    for (const [name, source] of Object.entries(sources)) {
      expect(source, name).not.toMatch(/\.innerHTML\s*[+]?=/);
      expect(source, name).not.toMatch(/\.outerHTML\s*[+]?=/);
      expect(source, name).not.toContain("insertAdjacentHTML");
      expect(source, name).not.toContain("document.write");
      expect(source, name).not.toMatch(/\beval\(|new Function\(/);
      expect(source, name).not.toMatch(/new Worker\(|blob:|importScripts/);
    }
  });

  test("the controller refreshes the shared scene API read-only every 15 s while visible", async () => {
    const { "controller.ts": controller = "" } = await clientSources();

    expect(controller).toContain("MISSION_CONTROL_SCENE_API");
    expect(controller).toContain("POLL_MS = 15_000");
    expect(controller).toContain("document.hidden");
    expect(controller).toContain('messageBox("omes-mc-connectivity")');
    expect(controller).not.toMatch(/method\s*:/);
    // A failed or malformed refresh keeps the last scene rather than clearing it.
    expect(controller).toContain("connectivity.show");
  });

  test("the controller restores and writes only kind + id URL state, validated against the kind vocabulary", async () => {
    const { "controller.ts": controller = "" } = await clientSources();

    expect(controller).toContain('searchParams.set("kind"');
    expect(controller).toContain('searchParams.set("id"');
    expect(controller).toContain("history.replaceState");
    expect(controller).toContain("Object.hasOwn(KIND_ZONE");
  });

  test("the renderer requests WebGL2 low-power, pauses when hidden and never pulses stale/unknown", async () => {
    const { "scene-gl.ts": renderer = "" } = await clientSources();

    expect(renderer).toContain('getContext("webgl2"');
    expect(renderer).toContain('powerPreference: "low-power"');
    expect(renderer).toContain("MissionControlRendererUnavailable");
    expect(renderer).toContain("webglcontextlost");
    expect(renderer).toContain("document.hidden");
    expect(renderer).toContain('it.state === "in_progress"');
    expect(renderer).toContain("ResizeObserver");
  });
});

describe("Mission Control presentation vocabulary mirrors the vendored source map", () => {
  type SourceMap = {
    kinds: Record<
      string,
      { zone: string; source: string; detail_route: string }
    >;
    visual_states: Record<string, string>;
  };

  test("kinds, zones, sources and detail routes agree", async () => {
    const map = JSON.parse(await readFile(SOURCE_MAP, "utf8")) as SourceMap;

    expect(Object.keys(map.kinds).sort()).toEqual(
      [...MISSION_CONTROL_KINDS].sort()
    );
    for (const kind of MISSION_CONTROL_KINDS) {
      expect(KIND_ZONE[kind], kind).toBe(map.kinds[kind]?.zone as never);
      expect(KIND_SOURCE[kind], kind).toBe(map.kinds[kind]?.source as never);
      expect(isSafeDetailRoute(map.kinds[kind]?.detail_route), kind).toBe(true);
    }
  });

  test("every visual state has a tone, stale/unknown are never success, and the set matches the map", async () => {
    const map = JSON.parse(await readFile(SOURCE_MAP, "utf8")) as SourceMap;

    expect(Object.keys(map.visual_states).sort()).toEqual(
      [...MISSION_CONTROL_VISUAL_STATES].sort()
    );
    for (const state of MISSION_CONTROL_VISUAL_STATES) {
      expect(VISUAL_STATE_TONE[state], state).toBeDefined();
    }
    expect(VISUAL_STATE_TONE.stale).not.toBe("success");
    expect(VISUAL_STATE_TONE.unknown).not.toBe("success");
  });

  test("isSafeDetailRoute accepts app-relative paths only", () => {
    expect(isSafeDetailRoute("/admin/omes/servers")).toBe(true);
    for (const bad of [
      "//evil.example/x",
      "https://evil.example/",
      "javascript:alert(1)",
      "/\\evil",
      "admin/omes",
      "",
      42,
      null
    ]) {
      expect(isSafeDetailRoute(bad)).toBe(false);
    }
  });

  test("nodeKey separates kind from source id unambiguously", () => {
    expect(nodeKey("server", "a")).not.toBe(nodeKey("serve", "ra"));
  });
});
