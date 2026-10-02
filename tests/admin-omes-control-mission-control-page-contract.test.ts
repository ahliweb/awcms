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

  test("the HUD markup is an aria-live region with no button or form; actions are created by the lazy client module", async () => {
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

  test("the page itself sends no mutation and has no form or submit control (actions live in the lazy client module)", async () => {
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
      "actions.ts",
      "controller.ts",
      "layout.ts",
      "math.ts",
      "replay.ts",
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

describe("History mode (ahliweb/omes#266) — same page, unmistakable, accessible", () => {
  const SELECTED_CSS = "src/styles/omes-control-center.css";

  test("a persistent historical banner and a polite aria-live announcer exist in the markup, hidden until History is entered", async () => {
    const markup = template(await readFile(PAGE, "utf8"));

    expect(markup).toMatch(
      /<p[^>]*class="omes-mc-banner omes-mc-banner-historical"[^>]*id="omes-mc-banner"[^>]*hidden/
    );
    const announcer = markup.match(/<p[^>]*id="omes-mc-announce"[^>]*>/)?.[0];
    expect(announcer).toContain('aria-live="polite"');
    expect(announcer).toContain('role="status"');
    expect(announcer).toContain('aria-atomic="true"');
    // The mode is announced in TEXT (Live/History), never colour alone.
    expect(markup).toContain('name="omes-mc-mode"');
    expect(markup).toContain('value="live"');
    expect(markup).toContain('value="history"');
    expect(markup).toContain('id="omes-mc-mode-label"');
  });

  test("the time controls, scrubber, speed, gap list and a synchronized event <ol> are in the page", async () => {
    const markup = template(await readFile(PAGE, "utf8"));

    for (const id of [
      "omes-mc-history",
      "omes-mc-from",
      "omes-mc-to",
      "omes-mc-load",
      "omes-mc-step-back",
      "omes-mc-play",
      "omes-mc-step-forward",
      "omes-mc-speed",
      "omes-mc-live",
      "omes-mc-scrub",
      "omes-mc-replay-at",
      "omes-mc-gaps",
      "omes-mc-events",
      "omes-mc-history-error"
    ]) {
      expect(markup, id).toContain(`id="${id}"`);
    }
    expect(markup).toMatch(/<ol[^>]*id="omes-mc-events"/);
    expect(markup).toContain('type="datetime-local"');
    expect(markup).toContain('type="range"');
    for (const speed of ["0.5", "1", "2", "4"]) {
      expect(markup).toContain(`value="${speed}"`);
    }
    // The History panel and its controls are hidden until the script reveals them,
    // and carry no mutating control.
    expect(markup).toMatch(/<section[^>]*id="omes-mc-history"[^>]*hidden/);
    expect(markup).not.toContain("<form");
  });

  test("replay.ts marks the current event aria-current=step and writes only through textContent/attributes", async () => {
    const { "replay.ts": replay = "" } = await clientSources();

    expect(replay).toContain('setAttribute("aria-current", "step")');
    expect(replay).toContain('removeAttribute("aria-current")');
    expect(replay).toContain("textContent");
    expect(replay).not.toMatch(/\.innerHTML\s*[+]?=/);
    expect(replay).not.toContain("insertAdjacentHTML");
    expect(replay).not.toMatch(/method\s*:/);
    // Every event offers a deep link into the screen that owns the evidence.
    expect(replay).toContain("isSafeDetailRoute(route)");
    expect(replay).toContain('"omes-mc-late"');
    // The scrubber states a text alternative to its numeric value.
    expect(replay).toContain("aria-valuetext");
  });

  test("replay is lazily imported ONLY from the controller (never statically, never from the page script) so live mode does not download it", async () => {
    const { "controller.ts": controller = "" } = await clientSources();
    const pageSource = await readFile(PAGE, "utf8");
    const script = pageSource.slice(pageSource.lastIndexOf("<script>"));

    expect(controller).toContain('await import("./replay")');
    expect(controller).not.toMatch(
      /^import\s+\{[^}]*\}\s+from\s+"\.\/replay"/m
    );
    // A type-only import is erased at build and costs nothing.
    expect(controller).toMatch(/import type \{[^}]*\} from "\.\/replay"/);
    expect(script).not.toContain("replay");
    for (const [name, source] of Object.entries(await clientSources())) {
      if (name === "controller.ts" || name === "replay.ts") continue;
      expect(source, name).not.toContain("./replay");
    }
  });

  test("entering History stops live polling and aborts the refresh in flight; leaving restores the live scene, resumes polling and announces", async () => {
    const { "controller.ts": controller = "" } = await clientSources();

    expect(controller).toContain('mode !== "live"');
    expect(controller).toContain("pollAbort?.abort()");
    expect(controller).toContain("replay?.exit()");
    expect(controller).toContain("ui.liveResumed");
    expect(controller).toContain("liveScene");
    // The mode is mirrored onto the root so the CSS can mark the whole workspace.
    expect(controller).toContain("rootEl.dataset.mode = mode");
    // A refresh that finishes after History was entered must not repaint live state.
    expect(controller).toMatch(/if \(mode !== "live"\) return;/);
  });

  test("History state lives in the URL as validated mode/from/to/at params, restored on load; absence is live", async () => {
    const { "replay.ts": replay = "", "controller.ts": controller = "" } =
      await clientSources();

    for (const key of ["mode", "from", "to", "at"]) {
      expect(replay).toContain(`searchParams.set("${key}"`);
      expect(replay).toContain(`searchParams.delete(key)`);
    }
    expect(replay).toContain("WIRE_RE");
    expect(replay).toContain("MAX_WINDOW_MS");
    expect(replay).toContain("history.replaceState");
    expect(controller).toContain('get("mode") === "history"');
  });

  test("bounded loading: keyset paging by cursor, one in-flight request per kind, abort on mode/range change, and a hard cap on held events", async () => {
    const { "replay.ts": replay = "" } = await clientSources();

    expect(replay).toContain("MISSION_CONTROL_REPLAY_API");
    expect(replay).toContain('params.set("cursor"');
    expect(replay).toContain("MAX_LOADED = 2000");
    expect(replay).toContain("PREFETCH_AHEAD");
    expect(replay).toContain("AbortController");
    expect(replay).toContain("abort()");
    expect(replay).toContain("generation");
    // Never asks beyond the window it was given.
    expect(replay).toContain("wire(range.to)");
  });

  test("playback awaits each scene (no flooding), supports 0.5/1/2/4x, and steps without camera animation under prefers-reduced-motion", async () => {
    const { "replay.ts": replay = "", "controller.ts": controller = "" } =
      await clientSources();

    expect(replay).toContain("BASE_STEP_MS / speed");
    expect(replay).toMatch(/await goTo\(pos \+ 1\)/);
    expect(replay).toContain("!host.reducedMotion()");
    expect(controller).toContain("reducedMotion: () => motion.matches");
    // Auto-announcing every step of a fast replay would flood a screen reader.
    expect(replay).toContain('playing ? "off" : "polite"');
  });

  test("replay's kind -> detail route table mirrors the vendored source map", async () => {
    const { "replay.ts": replay = "" } = await clientSources();
    const map = JSON.parse(await readFile(SOURCE_MAP, "utf8")) as {
      kinds: Record<string, { detail_route: string }>;
    };
    const block = replay.slice(
      replay.indexOf("const KIND_ROUTE"),
      replay.indexOf("};", replay.indexOf("const KIND_ROUTE"))
    );
    const routes = Object.fromEntries(
      [...block.matchAll(/\b([a-z_]+):\s*"([^"]+)"/g)].map((m) => [m[1], m[2]])
    );
    expect(Object.keys(routes).sort()).toEqual(
      [...MISSION_CONTROL_KINDS].sort()
    );
    for (const kind of MISSION_CONTROL_KINDS) {
      expect(routes[kind], kind).toBe(map.kinds[kind]?.detail_route);
    }
  });

  test("every label key the client reads is translated by the page (no English in the browser module)", async () => {
    const page = await readFile(PAGE, "utf8");
    const { "replay.ts": replay = "" } = await clientSources();
    const block = page.slice(
      page.indexOf("  replay: {"),
      page.indexOf("const screen = await loadAdminScreen")
    );
    const provided = new Set(
      [...block.matchAll(/^\s{4}([A-Za-z_]+):\s*t\(/gm)].map((m) => m[1])
    );
    const used = new Set([
      ...[...replay.matchAll(/\btext\("([A-Za-z_]+)"/g)].map((m) => m[1]),
      ...[...replay.matchAll(/\bL\.([A-Za-z_]+)/g)].map((m) => m[1]),
      ...[...replay.matchAll(/L\["([A-Za-z_]+)"\]/g)].map((m) => m[1])
    ]);
    for (const key of used) expect(provided.has(key as string), key).toBe(true);
    // The four gap reasons are provided as reason_<reason>.
    for (const reason of [
      "not_retained",
      "retention_expired",
      "source_unavailable",
      "before_first_observation"
    ]) {
      expect(provided.has(`reason_${reason}`), reason).toBe(true);
    }
  });

  test("the historical look is class-based and distinct: banner, workspace bar, current-event outline, late badge — and no inline style", async () => {
    const css = await readFile(SELECTED_CSS, "utf8");

    expect(css).toContain(".omes-cc .omes-mc-banner-historical");
    expect(css).toContain('.omes-cc .omes-mc[data-mode="history"]');
    expect(css).toContain('.omes-cc .omes-mc-event[aria-current="step"]');
    expect(css).toContain(".omes-cc .omes-mc-late");
    const markup = template(await readFile(PAGE, "utf8"));
    expect(markup).not.toMatch(/\sstyle\s*=/);
    const { "replay.ts": replay = "" } = await clientSources();
    expect(replay).not.toMatch(/\.style\b|setAttribute\("style"/);
  });

  test("History exposes no actions: no mutating control in the History panel and no request with a method", async () => {
    const markup = template(await readFile(PAGE, "utf8"));
    const panel =
      markup.match(
        /<section[^>]*id="omes-mc-history"[\s\S]*?<\/section>/
      )?.[0] ?? "";
    expect(panel).not.toMatch(/type="submit"/);
    expect(panel).not.toContain("<form");
    // Only navigation/playback buttons: nothing that names an operation.
    for (const verb of ["restore", "rollback", "cancel", "approve", "apply"]) {
      expect(panel.toLowerCase()).not.toContain(`id="omes-mc-${verb}`);
    }
  });
});

describe("contextual actions (ahliweb/omes#267) — shortcuts to existing endpoints, never a second path", () => {
  const CSS = "src/styles/omes-control-center.css";
  type ActionsSourceMap = {
    kinds: Record<string, { candidate_actions: string[] }>;
  };

  test("the actions module is lazy-loaded by the controller, never imported statically, and only in live mode", async () => {
    const { "controller.ts": controller = "" } = await clientSources();
    const body = code(controller);

    expect(body).toContain('import("./actions")');
    expect(body).toMatch(/import type \{[^}]*\} from "\.\/actions"/);
    expect(body).not.toMatch(/^import \{[^}]*\} from "\.\/actions"/m);
    // History mode (and an empty selection) clears and never fetches actions.
    expect(body).toMatch(/mode !== "live" \|\| !node/);
    expect(body).toContain("actions?.clear()");
    expect(body).toContain("syncActions(null)");
    expect(body).toMatch(/mode === "live" && selectedKey === key/);
    // The controller itself still sends no mutation.
    expect(body).not.toMatch(/method\s*:/);
  });

  test("actions.ts only calls allowlisted existing mutation paths with an Idempotency-Key and credentials, and has no raw dialog or HTML sink", async () => {
    const { "actions.ts": actions = "" } = await clientSources();
    const body = code(actions);

    expect(body).toContain('"Idempotency-Key"');
    expect(body).toContain("crypto.randomUUID()");
    expect(body).toContain('credentials: "same-origin"');
    expect(body).toContain('method: "POST"');
    expect(body).toContain("MUTATION_PATH");
    for (const endpoint of [
      "operations",
      "jobs\\/[A-Za-z0-9-]{1,64}\\/(cancel|approve)",
      "backups\\/[A-Za-z0-9-]{1,64}\\/restore"
    ]) {
      expect(body, endpoint).toContain(endpoint);
    }
    // Destructive requests use the shared ConfirmDialog, never a raw dialog.
    expect(body).toContain("confirmAction");
    expect(body).not.toMatch(/\b(window\.)?(confirm|prompt|alert)\s*\(/);
    // Approval decisions are never made here: no approve/reject call to the inbox.
    expect(body).not.toMatch(/\/api\/v1\/workflows/);
    expect(body).not.toMatch(/\.innerHTML|insertAdjacentHTML|document\.write/);
    // Browser-safe imports only: types, the outcome mapper, the confirm client, shared DOM helpers.
    const imports = [...actions.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(
      [
        "../../../modules/omes-control/domain/mission-control-outcome",
        "../../../modules/omes-control/domain/mission-control-types",
        "../confirm-dialog-client",
        "./vocab"
      ].sort()
    );
  });

  test("actions.ts stays well under the per-file client budget", async () => {
    const { "actions.ts": actions = "" } = await clientSources();
    expect(Buffer.byteLength(actions)).toBeLessThan(27_000);
  });

  test("the HUD carries an empty, hidden actions container, a status region and no button", async () => {
    const markup = template(await readFile(PAGE, "utf8"));
    const hud = markup.match(/<aside[\s\S]*?<\/aside>/)?.[0] ?? "";

    expect(hud).toContain("data-hud-actions");
    expect(hud).toContain("data-actions-list");
    expect(hud).toContain("data-actions-panel");
    expect(hud).toMatch(/data-actions-result[\s\S]*?role="status"/);
    expect(hud).not.toContain("<button");
    expect(hud).not.toContain("<form");
  });

  test("every object-list button and Open-details link is a command-palette item, server-rendered and client-built", async () => {
    const markup = template(await readFile(PAGE, "utf8"));
    const { "controller.ts": controller = "" } = await clientSources();

    expect(markup.match(/data-command-palette-item/g)?.length).toBe(2);
    expect(markup.match(/data-command-palette-label=/g)?.length).toBe(2);
    expect(controller.match(/"data-command-palette-item"/g)?.length).toBe(2);
    expect(controller.match(/"data-command-palette-label"/g)?.length).toBe(2);
  });

  test("every label the actions client reads is translated by the page and covers the whole closed vocabulary", async () => {
    const page = await readFile(PAGE, "utf8");
    const { "actions.ts": actions = "" } = await clientSources();
    const map = JSON.parse(
      await readFile(SOURCE_MAP, "utf8")
    ) as ActionsSourceMap;
    const block = page.slice(
      page.indexOf("  actions: {"),
      page.indexOf("const screen = await loadAdminScreen")
    );
    const uiBlock = block.slice(block.indexOf("    ui: {"));
    const uiProvided = new Set(
      [...uiBlock.matchAll(/^\s{6}([A-Za-z_]+):\s*t\(/gm)].map((m) => m[1])
    );
    const uiUsed = new Set([
      ...[...actions.matchAll(/\bui\.([A-Za-z_]+)/g)].map((m) => m[1]),
      // Outcome sentences + link texts selected by key in `describeOutcome`.
      "accepted",
      "approval_required",
      "approval_not_configured",
      "rejected",
      "unknown",
      "openRecord",
      "openInbox"
    ]);
    for (const key of uiUsed) {
      expect(uiProvided.has(key as string), `ui.${key}`).toBe(true);
    }

    const everyAction = new Set(
      Object.values(map.kinds)
        .flatMap((kind) => kind.candidate_actions)
        .filter((action) => action !== "open_details")
    );
    for (const action of everyAction) {
      expect(block, action).toContain(`"${action}": t(`);
    }
    for (const reason of [
      "permission_denied",
      "state_not_eligible",
      "not_found",
      "historical_mode"
    ]) {
      expect(block, reason).toMatch(new RegExp(`${reason}: t\\(`));
    }
    for (const advisory of [
      "target_stale",
      "target_decommissioned",
      "backup_not_verified"
    ]) {
      expect(block, advisory).toMatch(new RegExp(`${advisory}: t\\(`));
    }
  });

  test("every class the actions client creates has a rule in omes-control-center.css", async () => {
    const css = await readFile(CSS, "utf8");
    const { "actions.ts": actions = "" } = await clientSources();
    for (const cls of [
      "omes-mc-action",
      "omes-mc-actions",
      "omes-mc-badge",
      "omes-mc-warning",
      "omes-mc-hud",
      "omes-mc-transport"
    ]) {
      expect(css, cls).toContain(`.omes-cc .${cls}`);
    }
    for (const cls of [
      "omes-mc-action",
      "omes-mc-badge",
      "omes-mc-warning",
      "omes-mc-transport"
    ]) {
      expect(actions, cls).toContain(`"${cls}"`);
    }
  });
});
