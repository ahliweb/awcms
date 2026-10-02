/**
 * Browser entry for the 3D Mission Control workspace (Issue
 * ahliweb/omes#265, ADR-0031). Imported by `mission-control.astro`'s page
 * script so Astro bundles it as an external module (the CSP has no inline
 * script allowance).
 *
 * The server-rendered object list is the CANONICAL, accessible, no-JS
 * equivalent of the scene; this controller only enhances it: it parses the
 * scene, lays it out, lazily loads the WebGL2 renderer and keeps list, scene,
 * HUD and URL in step. If WebGL2 is unavailable or the context is lost, the
 * canvas is hidden and a notice is shown — the list keeps working.
 *
 * Labels and summaries are UNTRUSTED text: every DOM write below is
 * `textContent`/`setAttribute`/`dataset` — never `innerHTML`.
 *
 * Selecting an object in LIVE mode lazily loads `actions.ts` (ahliweb/omes#267),
 * which shows the advisory, existing-endpoint actions for it; the controller
 * itself still has no mutating request. A failed refresh keeps the last scene
 * and says so; an empty or failed response is never treated as healthy.
 *
 * History mode (ahliweb/omes#266) lives in `replay.ts`, which is `import()`ed
 * only when the user first enters it — a live-mode user never downloads it.
 * Entering it stops live polling, aborts any refresh in flight and puts the
 * persistent "Historical" banner up; leaving it restores the last live scene,
 * resumes polling and announces the change.
 */
import {
  MISSION_CONTROL_SCENE_API,
  MISSION_CONTROL_ZONES,
  type MissionControlKind,
  type MissionControlSceneNode,
  type MissionControlSceneView
} from "../../../modules/omes-control/domain/mission-control-types";
import { messageBox } from "../admin-form-client";
import { layoutScene, type SceneLayout } from "./layout";
import type { ActionLabels, ActionsApi } from "./actions";
import type { ReplayApi, ReplayHost } from "./replay";
import type { MissionControlRenderer } from "./scene-gl";
import {
  KIND_SOURCE,
  KIND_ZONE,
  VISUAL_STATE_TONE,
  ageOutScene,
  el,
  fill,
  isSafeDetailRoute,
  nodeKey
} from "./vocab";

const POLL_MS = 15_000;
const ITEM_SELECTOR = "button.omes-mc-obj";

type Dict = Record<string, string>;
type Labels = {
  kinds: Dict;
  zones: Dict;
  states: Dict;
  freshness: Dict;
  sources: Dict;
  sourceStates: Dict;
  authority: Dict;
  ui: Dict;
  replay: Dict;
  actions: ActionLabels;
};
type Entry = { index: number; li: HTMLElement; btn: HTMLButtonElement };

function parseJson(raw: string | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Fail closed: drop unknown kinds, coerce unknown states/freshness. */
function normalise(raw: unknown): MissionControlSceneView | null {
  if (
    !isObject(raw) ||
    !Array.isArray(raw.nodes) ||
    !Array.isArray(raw.relations) ||
    !Array.isArray(raw.sources)
  ) {
    return null;
  }
  const nodes = (raw.nodes as MissionControlSceneNode[]).filter(
    (n) =>
      isObject(n) &&
      typeof n.source_id === "string" &&
      typeof n.node_id === "string" &&
      Object.hasOwn(KIND_ZONE, n.kind)
  );
  for (const n of nodes) {
    if (!Object.hasOwn(VISUAL_STATE_TONE, n.visual_state)) {
      n.visual_state = "unknown";
    }
    if (n.freshness !== "live" && n.freshness !== "stale")
      n.freshness = "unknown";
  }
  return { ...(raw as MissionControlSceneView), nodes };
}

function pill(tone: string, text: string): HTMLElement {
  const node = el("span", "admin-status-pill");
  node.dataset.tone = tone;
  const dot = el("span", "admin-status-pill-dot");
  dot.setAttribute("aria-hidden", "true");
  node.append(dot, document.createTextNode(text));
  return node;
}

const SOURCE_TONE: Dict = {
  available: "success",
  stale: "warning",
  unavailable: "danger"
};

export function startMissionControl(): void {
  const root = document.getElementById("omes-mission-control");
  const listEl = document.getElementById("omes-mc-list");
  if (!root || !listEl) return;
  const list: HTMLElement = listEl;
  const rootEl: HTMLElement = root;

  const rawLabels = parseJson(root.dataset.labels);
  const L = (isObject(rawLabels) ? rawLabels : {}) as Partial<Labels>;
  const ui = L.ui ?? {};
  const word = (map: Dict | undefined, key: string): string =>
    map?.[key] ?? key;

  const stage = document.getElementById("omes-mc-stage");
  const canvas = document.getElementById(
    "omes-mc-canvas"
  ) as HTMLCanvasElement | null;
  const fallback = document.getElementById("omes-mc-fallback");
  const hud = document.getElementById("omes-mc-hud");
  const zoneFilter = document.getElementById(
    "omes-mc-filter-zone"
  ) as HTMLSelectElement | null;
  const stateFilter = document.getElementById(
    "omes-mc-filter-state"
  ) as HTMLSelectElement | null;
  const connectivity = messageBox("omes-mc-connectivity");
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");

  let scene: MissionControlSceneView | null = null;
  let nodes: MissionControlSceneNode[] = [];
  let layout: SceneLayout | null = null;
  let entries = new Map<string, Entry>();
  let keyIndex = new Map<string, number>();
  let selectedKey: string | null = null;
  let renderer: MissionControlRenderer | null = null;
  let signature = "";
  let mode: "live" | "history" = "live";
  let replay: ReplayApi | null = null;
  let liveScene: MissionControlSceneView | null = null;
  let clockSkew = 0;
  let pollAbort: AbortController | null = null;

  function visible(node: MissionControlSceneNode): boolean {
    return (
      (!zoneFilter?.value || KIND_ZONE[node.kind] === zoneFilter.value) &&
      (!stateFilter?.value || node.visual_state === stateFilter.value)
    );
  }

  // ---- source strip, as-of badge, truncation notice ----------------------
  function renderMeta(): void {
    if (!scene) return;
    const asOf = document.getElementById("omes-mc-asof");
    if (asOf) asOf.textContent = fill(ui.asOf, { time: scene.as_of });
    const strip = document.getElementById("omes-mc-sources");
    if (strip) {
      strip.replaceChildren(
        ...scene.sources.map((source) => {
          const li = el("li", "omes-mc-source");
          li.append(
            el(
              "span",
              "omes-mc-source-name",
              word(L.sources, source.source_kind)
            ),
            el("span", "cell-muted", word(L.authority, source.authority)),
            pill(
              SOURCE_TONE[source.status] ?? "neutral",
              word(L.sourceStates, source.status)
            ),
            el(
              "span",
              "cell-muted",
              source.observed_at
                ? fill(ui.observed, { time: source.observed_at })
                : (ui.notObserved ?? "")
            )
          );
          return li;
        })
      );
    }
    const dropped = document.getElementById("omes-mc-truncated");
    if (dropped) {
      const count = scene.truncated?.nodes ?? 0;
      dropped.hidden = count <= 0;
      dropped.textContent = fill(ui.truncated, { count: String(count) });
    }
  }

  // ---- accessible list -----------------------------------------------------
  function buildItem(
    node: MissionControlSceneNode,
    zone: string,
    index: number
  ): Entry {
    const li = el("li", "omes-mc-item");
    li.dataset.zone = zone;
    li.dataset.state = node.visual_state;
    const btn = el("button", "omes-mc-obj");
    btn.type = "button";
    btn.dataset.nodeId = node.node_id;
    btn.dataset.kind = node.kind;
    btn.dataset.sourceId = node.source_id;
    btn.setAttribute("aria-pressed", "false");
    btn.setAttribute("data-command-palette-item", "");
    btn.setAttribute(
      "data-command-palette-label",
      `${word(L.kinds, node.kind)}: ${node.label}`
    );
    btn.append(
      el("span", "omes-mc-kind", word(L.kinds, node.kind)),
      el("span", "omes-mc-label", node.label),
      pill(
        VISUAL_STATE_TONE[node.visual_state],
        word(L.states, node.visual_state)
      ),
      el(
        "span",
        "cell-muted",
        `${word(L.freshness, node.freshness)} · ${
          node.observed_at
            ? fill(ui.observed, { time: node.observed_at })
            : (ui.notObserved ?? "")
        }`
      )
    );
    li.append(btn);
    if (isSafeDetailRoute(node.detail_route)) {
      const link = el("a", "omes-mc-link", ui.openDetails);
      link.href = node.detail_route;
      const linkLabel = fill(ui.openDetailsFor, { name: node.label });
      link.setAttribute("aria-label", linkLabel);
      link.setAttribute("data-command-palette-item", "");
      link.setAttribute("data-command-palette-label", linkLabel);
      li.append(link);
    }
    return { index, li, btn };
  }

  function buildList(): void {
    entries = new Map();
    const sections: HTMLElement[] = [];
    for (const zone of MISSION_CONTROL_ZONES) {
      const members = nodes.flatMap((n, i) =>
        KIND_ZONE[n.kind] === zone ? [i] : []
      );
      if (members.length === 0) continue;
      const section = el("section", "omes-mc-zone");
      section.dataset.zone = zone;
      const heading = el("h3", "omes-mc-zone-title", word(L.zones, zone));
      heading.id = `omes-mc-zone-${zone}`;
      section.setAttribute("aria-labelledby", heading.id);
      const ul = el("ul", "omes-mc-items");
      for (const i of members) {
        const node = nodes[i] as MissionControlSceneNode;
        const entry = buildItem(node, zone, i);
        entries.set(nodeKey(node.kind, node.source_id), entry);
        ul.append(entry.li);
      }
      section.append(heading, ul);
      sections.push(section);
    }
    list.replaceChildren(...sections);
  }

  function indexRenderedList(): void {
    entries = new Map();
    list?.querySelectorAll<HTMLButtonElement>(ITEM_SELECTOR).forEach((btn) => {
      const key = nodeKey(btn.dataset.kind ?? "", btn.dataset.sourceId ?? "");
      const index = keyIndex.get(key);
      const li = btn.closest<HTMLElement>("li");
      if (index !== undefined && li) entries.set(key, { index, li, btn });
    });
    if (entries.size !== nodes.length) buildList();
  }

  // ---- HUD + contextual actions (ahliweb/omes#267) --------------------------
  // Actions are loaded lazily on the first LIVE selection and never in History
  // mode (no fetch, no UI); a failed load leaves the HUD and list unchanged.
  let actions: ActionsApi | null = null;
  function syncActions(node: MissionControlSceneNode | null): void {
    const box = hud?.querySelector<HTMLElement>("[data-hud-actions]");
    if (!box) return;
    if (mode !== "live" || !node) {
      actions?.clear();
      box.hidden = true;
      return;
    }
    const key = nodeKey(node.kind, node.source_id);
    void (async () => {
      try {
        actions ??= (await import("./actions")).startActions({
          root: box,
          labels: L.actions ?? {},
          isLive: () => mode === "live"
        });
        if (mode === "live" && selectedKey === key) actions.show(node);
      } catch {
        // The accessible list and Open-details links work without actions.
      }
    })();
  }

  function fillHud(node: MissionControlSceneNode | null): void {
    if (!hud) return;
    syncActions(node);
    const body = hud.querySelector<HTMLElement>("[data-hud-body]");
    const empty = hud.querySelector<HTMLElement>("[data-hud-empty]");
    if (body) body.hidden = !node;
    if (empty) empty.hidden = !!node;
    if (!node) return;
    const source = scene?.sources.find(
      (s) => s.source_kind === KIND_SOURCE[node.kind]
    );
    const set = (name: string, text: string): void => {
      const target = hud.querySelector<HTMLElement>(`[data-hud="${name}"]`);
      if (target) target.textContent = text;
    };
    set("label", node.label);
    set("kind", word(L.kinds, node.kind));
    set(
      "authority",
      source ? word(L.authority, source.authority) : (ui.notObserved ?? "")
    );
    set(
      "sourceStatus",
      source
        ? word(L.sourceStates, source.status)
        : word(L.sourceStates, "unavailable")
    );
    set("sourceId", node.source_id);
    set("sourceState", node.source_state);
    set("state", word(L.states, node.visual_state));
    set("freshness", word(L.freshness, node.freshness));
    set("observed", node.observed_at ?? ui.notObserved ?? "");
    set("summary", node.summary ?? "");
    const summaryRow = hud.querySelector<HTMLElement>(
      "[data-hud-row='summary']"
    );
    if (summaryRow) summaryRow.hidden = !node.summary;
    const link = hud.querySelector<HTMLAnchorElement>("[data-hud='link']");
    if (link) {
      const safe = isSafeDetailRoute(node.detail_route);
      link.hidden = !safe;
      if (safe) link.href = node.detail_route;
    }
  }

  // ---- URL state -----------------------------------------------------------
  function syncUrl(node: MissionControlSceneNode | null): void {
    try {
      const url = new URL(window.location.href);
      if (node) {
        url.searchParams.set("kind", node.kind);
        url.searchParams.set("id", node.source_id);
      } else {
        url.searchParams.delete("kind");
        url.searchParams.delete("id");
      }
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // History can be unavailable (sandboxed frames); selection still works.
    }
  }

  function restoreFromUrl(): void {
    const params = new URLSearchParams(window.location.search);
    const kind = params.get("kind");
    const id = params.get("id");
    if (!kind || !id || id.length > 256) return;
    if (!Object.hasOwn(KIND_ZONE, kind as MissionControlKind)) return;
    const key = nodeKey(kind, id);
    if (entries.has(key)) select(key, { fly: true });
  }

  // ---- selection -----------------------------------------------------------
  function select(
    key: string | null,
    opts: { fly?: boolean; focus?: boolean } = {}
  ): void {
    const entry = key ? entries.get(key) : undefined;
    selectedKey = entry ? key : null;
    for (const [k, e] of entries) {
      e.btn.setAttribute("aria-pressed", k === selectedKey ? "true" : "false");
    }
    const node = entry ? (nodes[entry.index] ?? null) : null;
    renderer?.setSelected(entry ? entry.index : -1);
    fillHud(node);
    syncUrl(node);
    if (entry && layout && opts.fly) {
      const p = layout.positions[entry.index];
      if (p) renderer?.flyTo(p);
    }
    if (entry && opts.focus) {
      entry.btn.focus();
      entry.btn.scrollIntoView({ block: "nearest" });
    }
  }

  // ---- filters + scene feed ------------------------------------------------
  function pushScene(): void {
    if (!renderer || !layout) return;
    const ids = new Map<string, number>();
    const items = nodes.flatMap((n, index) => {
      const p = layout?.positions[index];
      if (!p || !visible(n)) return [];
      ids.set(n.node_id, index);
      return [{ id: index, p, kind: n.kind, state: n.visual_state }];
    });
    const lines: number[] = [];
    for (const rel of scene?.relations ?? []) {
      const a = ids.get(rel.from);
      const b = ids.get(rel.to);
      const pa = a === undefined ? undefined : layout.positions[a];
      const pb = b === undefined ? undefined : layout.positions[b];
      if (pa && pb) lines.push(...pa, ...pb);
    }
    const sel = selectedKey ? (entries.get(selectedKey)?.index ?? -1) : -1;
    renderer.setData(items, lines, layout.min, layout.max, sel);
  }

  function applyFilters(): void {
    let shown = 0;
    for (const entry of entries.values()) {
      const show = visible(nodes[entry.index] as MissionControlSceneNode);
      entry.li.hidden = !show;
      if (show) shown++;
    }
    list?.querySelectorAll<HTMLElement>(".omes-mc-zone").forEach((section) => {
      section.hidden = !section.querySelector("li:not([hidden])");
    });
    const count = document.getElementById("omes-mc-count");
    if (count)
      count.textContent = fill(ui.shown, {
        shown: String(shown),
        total: String(nodes.length)
      });
    if (selectedKey && entries.get(selectedKey)?.li.hidden) select(null);
    pushScene();
  }

  function adopt(next: MissionControlSceneView, rebuildList: boolean): void {
    scene = next;
    nodes = next.nodes;
    keyIndex = new Map(nodes.map((n, i) => [nodeKey(n.kind, n.source_id), i]));
    layout = layoutScene(nodes, next.relations);
    if (rebuildList) buildList();
    else indexRenderedList();
    renderMeta();
    const empty = document.getElementById("omes-mc-empty");
    if (empty) empty.hidden = nodes.length > 0;
    const had = selectedKey;
    if (had && !entries.has(had)) {
      selectedKey = null;
      syncUrl(null);
    }
    const node = selectedKey
      ? nodes[entries.get(selectedKey)?.index ?? -1]
      : undefined;
    if (selectedKey)
      entries.get(selectedKey)?.btn.setAttribute("aria-pressed", "true");
    fillHud(node ?? null);
    applyFilters();
  }

  // ---- renderer (lazy; failure leaves the list fully functional) -----------
  function showFallback(): void {
    renderer?.dispose();
    renderer = null;
    if (stage) stage.hidden = true;
    if (fallback) {
      fallback.textContent = ui.fallback ?? "";
      fallback.hidden = false;
    }
  }

  async function startRenderer(): Promise<void> {
    if (!canvas) return showFallback();
    try {
      const mod = await import("./scene-gl");
      renderer = mod.createRenderer(canvas, {
        reducedMotion: motion.matches,
        onLost: showFallback
      });
      if (stage) stage.hidden = false;
      pushScene();
      const at = selectedKey ? entries.get(selectedKey) : undefined;
      const p = at ? layout?.positions[at.index] : undefined;
      if (p) renderer.flyTo(p);
    } catch {
      showFallback();
    }
  }

  // ---- live / history mode -------------------------------------------------
  const modeRadios = rootEl.querySelectorAll<HTMLInputElement>(
    'input[name="omes-mc-mode"]'
  );
  const announceEl = document.getElementById("omes-mc-announce");
  const bannerEl = document.getElementById("omes-mc-banner");
  const historyEl = document.getElementById("omes-mc-history");
  const modeLabel = document.getElementById("omes-mc-mode-label");

  function announce(message: string): void {
    if (announceEl) announceEl.textContent = message;
  }

  function syncMode(): void {
    rootEl.dataset.mode = mode;
    modeRadios.forEach((radio) => {
      radio.checked = radio.value === mode;
    });
    if (bannerEl) bannerEl.hidden = mode !== "history";
    if (historyEl) historyEl.hidden = mode !== "history";
    if (modeLabel) {
      modeLabel.textContent =
        (mode === "live" ? ui.liveView : ui.historicalView) ?? "";
    }
  }

  const host: ReplayHost = {
    labels: { ...L, replay: L.replay, ui },
    showScene(raw) {
      const next = normalise(raw);
      if (!next) return false;
      signature = JSON.stringify([
        next.sources,
        next.nodes,
        next.relations,
        next.truncated
      ]);
      adopt(next, true);
      return true;
    },
    focus(kind, sourceId, animate) {
      const key = nodeKey(kind, sourceId);
      select(entries.has(key) ? key : null, { fly: animate });
    },
    announce,
    reducedMotion: () => motion.matches,
    serverNow: () => Date.now() + clockSkew,
    onExit: () => void setMode("live")
  };

  async function setMode(next: "live" | "history"): Promise<void> {
    if (next === mode) return;
    if (next === "history") {
      mode = "history";
      pollAbort?.abort();
      syncActions(null);
      syncMode();
      try {
        replay ??= (await import("./replay")).startReplay(host);
        replay.enter();
      } catch {
        mode = "live";
        syncMode();
        connectivity.show(ui.historyUnavailable ?? "");
      }
      return;
    }
    mode = "live";
    replay?.exit();
    syncMode();
    if (liveScene) {
      signature = "";
      adopt(
        Date.now() - lastOk > POLL_MS ? ageOutScene(liveScene) : liveScene,
        true
      );
    }
    announce(ui.liveResumed ?? "");
    void poll();
  }

  modeRadios.forEach((radio) =>
    radio.addEventListener("change", () => {
      if (radio.checked) void setMode(radio.value as "live" | "history");
    })
  );

  // ---- events --------------------------------------------------------------
  list.addEventListener("click", (event) => {
    const btn = (event.target as Element | null)?.closest<HTMLButtonElement>(
      ITEM_SELECTOR
    );
    if (btn)
      select(nodeKey(btn.dataset.kind ?? "", btn.dataset.sourceId ?? ""), {
        fly: true
      });
  });

  list.addEventListener("keydown", (event) => {
    const current = (
      event.target as Element | null
    )?.closest<HTMLButtonElement>(ITEM_SELECTOR);
    if (!current) return;
    const items = [
      ...list.querySelectorAll<HTMLButtonElement>(
        `li:not([hidden]) > ${ITEM_SELECTOR}`
      )
    ];
    const at = items.indexOf(current);
    const target =
      event.key === "ArrowDown"
        ? items[at + 1]
        : event.key === "ArrowUp"
          ? items[at - 1]
          : event.key === "Home"
            ? items[0]
            : event.key === "End"
              ? items[items.length - 1]
              : undefined;
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      target?.focus();
    }
  });

  root.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const typing =
      event.target instanceof HTMLSelectElement ||
      event.target instanceof HTMLInputElement;
    if (typing) return;
    if (event.key === "Escape" && selectedKey) {
      event.preventDefault();
      select(null);
    } else if (event.key === "0") {
      renderer?.reset();
    }
  });

  zoneFilter?.addEventListener("change", applyFilters);
  stateFilter?.addEventListener("change", applyFilters);
  document
    .getElementById("omes-mc-reset")
    ?.addEventListener("click", () => renderer?.reset());
  motion.addEventListener("change", () =>
    renderer?.setReducedMotion(motion.matches)
  );

  if (canvas) {
    let drag: { x: number; y: number; moved: number } | null = null;
    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      drag = { x: event.clientX, y: event.clientY, moved: 0 };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag = {
        x: event.clientX,
        y: event.clientY,
        moved: drag.moved + Math.abs(dx) + Math.abs(dy)
      };
      renderer?.orbit(dx, dy);
    });
    canvas.addEventListener("pointerup", (event) => {
      const wasClick = drag !== null && drag.moved < 5;
      drag = null;
      if (!wasClick || !renderer) return;
      const node = nodes[renderer.pick(event.clientX, event.clientY)];
      if (node)
        select(nodeKey(node.kind, node.source_id), { fly: true, focus: true });
    });
    canvas.addEventListener("pointercancel", () => {
      drag = null;
    });
    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        renderer?.zoom(Math.exp(event.deltaY * 0.0015));
      },
      { passive: false }
    );
  }

  // ---- polling -------------------------------------------------------------
  let inflight = false;
  let lastOk = Date.now();

  async function poll(): Promise<void> {
    if (document.hidden || inflight || mode !== "live") return;
    inflight = true;
    const abort = new AbortController();
    pollAbort = abort;
    const timer = window.setTimeout(() => abort.abort(), 10_000);
    try {
      const response = await fetch(MISSION_CONTROL_SCENE_API, {
        headers: { accept: "application/json" },
        credentials: "same-origin",
        signal: abort.signal
      });
      if (!response.ok) throw new Error("refresh failed");
      const body: unknown = await response.json();
      const next = normalise(
        isObject(body) && isObject(body.data) ? body.data.scene : null
      );
      if (!next) throw new Error("malformed scene");
      // A refresh that finished after History mode was entered must not paint
      // live state under the historical banner.
      if (mode !== "live") return;
      liveScene = next;
      lastOk = Date.now();
      connectivity.clear();
      const focused = (
        document.activeElement as Element | null
      )?.closest<HTMLButtonElement>(ITEM_SELECTOR);
      const focusKey = focused
        ? nodeKey(focused.dataset.kind ?? "", focused.dataset.sourceId ?? "")
        : null;
      const nextSignature = JSON.stringify([
        next.sources,
        next.nodes,
        next.relations,
        next.truncated
      ]);
      if (nextSignature === signature) {
        scene = next;
        renderMeta();
      } else {
        signature = nextSignature;
        adopt(next, true);
        if (focusKey) entries.get(focusKey)?.btn.focus();
      }
    } catch {
      if (mode !== "live") return;
      // Keep the last scene on screen and SAY the data may be out of date; a
      // failed refresh is never an empty or healthy scene. Once a whole refresh
      // window has been missed, the retained objects are also re-labelled
      // stale (`ageOutScene`), so nothing keeps claiming to be current; the
      // cleared signature makes the next good response re-adopt in full.
      connectivity.show(ui.connectivity ?? "");
      if (scene && Date.now() - lastOk > POLL_MS) {
        signature = "";
        adopt(ageOutScene(scene), true);
      }
    } finally {
      window.clearTimeout(timer);
      inflight = false;
    }
  }

  window.setInterval(() => void poll(), POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Date.now() - lastOk > POLL_MS) void poll();
  });

  // ---- boot ----------------------------------------------------------------
  // Controls that cannot work without this script ship `hidden`; the list and
  // its "Open details" links work without it.
  root.querySelectorAll<HTMLElement>("[data-js-only]").forEach((node) => {
    node.hidden = false;
  });
  const initial = normalise(parseJson(root.dataset.scene));
  if (initial) {
    liveScene = initial;
    clockSkew = (Date.parse(initial.as_of) || Date.now()) - Date.now();
    signature = JSON.stringify([
      initial.sources,
      initial.nodes,
      initial.relations,
      initial.truncated
    ]);
    adopt(initial, false);
    restoreFromUrl();
    void startRenderer();
    if (new URLSearchParams(window.location.search).get("mode") === "history") {
      void setMode("history");
    }
  } else {
    // No usable scene was embedded: keep the server-rendered list, say the 3D
    // view is unavailable, and let the first poll try to populate it.
    showFallback();
    void poll();
  }
}
