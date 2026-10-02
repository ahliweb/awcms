/**
 * Historical replay for the 3D Mission Control workspace (Issue
 * ahliweb/omes#266, ADR-0031 rule 4). Lazily `import()`ed by
 * `controller.ts` the first time History mode is entered, so a live-mode user
 * never downloads it.
 *
 * Everything shown here is RETAINED EVIDENCE fetched from the two read-only
 * endpoints — `GET .../replay` (one keyset page of observed events) and
 * `GET .../scene?as_of=` (the scene those events prove). The camera and any
 * animation between observations are decorative: the event list, the HUD and
 * the banner only ever show evidence-backed states, and a gap is listed as a
 * gap, never interpolated.
 *
 * Bounds: at most {@link MAX_WINDOW_MS} of history per range, at most 500
 * events per request (server bound), at most {@link MAX_LOADED} events held in
 * the browser, one in-flight request at a time (aborted on every mode or range
 * change). Playback awaits each scene before stepping, so it never floods the
 * API.
 *
 * Event text and identifiers are UNTRUSTED display text: every DOM write is
 * `textContent`/`setAttribute`/`dataset` — never `innerHTML`. Nothing here
 * mutates anything: no action control exists in History mode.
 */
import {
  MISSION_CONTROL_REPLAY_API,
  MISSION_CONTROL_SCENE_API,
  type MissionControlEvidenceGap,
  type MissionControlKind,
  type MissionControlReplayEvent,
  type MissionControlReplayWindow
} from "../../../modules/omes-control/domain/mission-control-types";
import { VISUAL_STATE_TONE, el, isSafeDetailRoute } from "./vocab";

type Dict = Record<string, string>;

/** What the controller hands over: DOM access plus the few scene operations replay needs. */
export type ReplayHost = {
  labels: {
    kinds?: Dict;
    states?: Dict;
    sources?: Dict;
    replay?: Dict;
    ui?: Dict;
  };
  /** Shows a scene from the API in the list, HUD and 3D view; `false` = malformed (nothing changed). */
  showScene: (raw: unknown) => boolean;
  /** Selects (and, when `animate`, flies to) the object an event describes. */
  focus: (kind: string, sourceId: string, animate: boolean) => void;
  announce: (text: string) => void;
  reducedMotion: () => boolean;
  /** The server's clock, so a skewed browser clock cannot ask for the future. */
  serverNow: () => number;
  /** The user asked to return to live. */
  onExit: () => void;
};

export type ReplayApi = {
  /** Enters History mode: restores a valid `?mode=history` range from the URL, else the last hour. */
  enter: () => void;
  /** Leaves History mode: stops playback and in-flight requests and clears the replay URL state. */
  exit: () => void;
};

const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RANGE_MS = 60 * 60 * 1000;
const MAX_LOADED = 2000;
const PREFETCH_AHEAD = 50;
const BASE_STEP_MS = 1000;
const WIRE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** Canonical 2D screen per kind (source map `kinds.<kind>.detail_route`; pinned by a test). */
const KIND_ROUTE: Readonly<Record<MissionControlKind, string>> = {
  server: "/admin/omes/servers",
  deployment: "/admin/omes/deployments",
  job: "/admin/omes/jobs",
  health_report: "/admin/omes/health",
  backup: "/admin/omes/backups",
  hermes_subagent: "/admin/omes/orkestrasi-langsung",
  architecture_plane: "/admin/omes/arsitektur",
  capability: "/admin/omes/arsitektur",
  repository_milestone: "/admin/omes/progres-hermes",
  ai_privacy_posture: "/admin/omes/ai-privacy",
  approval_item: "/admin/approvals"
};

const wire = (ms: number): string =>
  `${new Date(ms).toISOString().slice(0, 19)}Z`;

/** `datetime-local` value (local wall time, seconds) for an instant. */
function toLocalInput(ms: number): string {
  return new Date(ms - new Date(ms).getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 19);
}

function parseWire(value: string | null): number | null {
  if (!value || !WIRE_RE.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) || wire(ms) !== value ? null : ms;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asWindow(raw: unknown): MissionControlReplayWindow | null {
  const data = isRecord(raw) ? raw.window : null;
  if (
    !isRecord(data) ||
    !Array.isArray(data.events) ||
    !Array.isArray(data.evidence_gaps)
  ) {
    return null;
  }
  return data as unknown as MissionControlReplayWindow;
}

export function startReplay(host: ReplayHost): ReplayApi {
  const L = host.labels.replay ?? {};
  const ui = host.labels.ui ?? {};
  const text = (key: string, values: Dict = {}): string =>
    Object.entries(values).reduce(
      (out, [k, v]) => out.replace(`{${k}}`, v),
      L[key] ?? ""
    );
  const q = <T extends HTMLElement>(id: string): T | null =>
    document.getElementById(id) as T | null;

  const fromInput = q<HTMLInputElement>("omes-mc-from");
  const toInput = q<HTMLInputElement>("omes-mc-to");
  const loadBtn = q<HTMLButtonElement>("omes-mc-load");
  const backBtn = q<HTMLButtonElement>("omes-mc-step-back");
  const fwdBtn = q<HTMLButtonElement>("omes-mc-step-forward");
  const playBtn = q<HTMLButtonElement>("omes-mc-play");
  const liveBtn = q<HTMLButtonElement>("omes-mc-live");
  const speedSel = q<HTMLSelectElement>("omes-mc-speed");
  const scrub = q<HTMLInputElement>("omes-mc-scrub");
  const atEl = q("omes-mc-replay-at");
  const errEl = q("omes-mc-history-error");
  const gapsEl = q("omes-mc-gaps");
  const moreEl = q("omes-mc-events-more");
  const listEl = q<HTMLOListElement>("omes-mc-events");
  const bannerEl = q("omes-mc-banner");

  let events: MissionControlReplayEvent[] = [];
  let gaps: MissionControlEvidenceGap[] = [];
  let nextCursor: string | null = null;
  let range = { from: 0, to: 0 };
  let pos = 0;
  let shownAsOf = "";
  let playing = false;
  let timer = 0;
  let scrubTimer = 0;
  let pageAbort: AbortController | null = null;
  let sceneAbort: AbortController | null = null;
  let generation = 0;
  let loadingMore = false;
  let exhausted = false;
  let active = false;
  const scenes = new Map<string, unknown>();

  const asOfFor = (position: number): string => {
    const event = events[position - 1];
    return event ? event.at : wire(range.from);
  };

  function setError(message: string): void {
    if (!errEl) return;
    errEl.textContent = message;
    errEl.hidden = message === "";
  }

  function setBanner(asOf: string): void {
    shownAsOf = asOf;
    if (bannerEl) bannerEl.textContent = text("banner", { time: asOf });
  }

  function cancelRequests(): void {
    pageAbort?.abort();
    sceneAbort?.abort();
    pageAbort = null;
    sceneAbort = null;
  }

  async function getData(url: string, signal: AbortSignal): Promise<unknown> {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      credentials: "same-origin",
      signal
    });
    if (!response.ok) throw new Error("request failed");
    const body: unknown = await response.json();
    if (!isRecord(body) || !isRecord(body.data)) throw new Error("malformed");
    return body.data;
  }

  // ---- URL state (validated; absence = live) ---------------------------------
  function writeUrl(): void {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("mode", "history");
      url.searchParams.set("from", wire(range.from));
      url.searchParams.set("to", wire(range.to));
      url.searchParams.set("at", asOfFor(pos));
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // History can be unavailable (sandboxed frames); replay still works.
    }
  }

  function clearUrl(): void {
    try {
      const url = new URL(window.location.href);
      for (const key of ["mode", "from", "to", "at"]) {
        url.searchParams.delete(key);
      }
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // see writeUrl
    }
  }

  function readUrl(): { from: number; to: number; at: number | null } | null {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mode") !== "history") return null;
    const from = parseWire(params.get("from"));
    const to = parseWire(params.get("to"));
    const at = parseWire(params.get("at"));
    if (from === null || to === null) return null;
    if (from >= to || to - from > MAX_WINDOW_MS || to > host.serverNow()) {
      return null;
    }
    return { from, to, at: at !== null && at >= from && at <= to ? at : null };
  }

  // ---- rendering ----------------------------------------------------------
  function buildEvent(
    event: MissionControlReplayEvent,
    index: number
  ): HTMLElement {
    const li = el("li", "omes-mc-event");
    li.dataset.pos = String(index + 1);
    li.dataset.state = event.visual_state;
    const btn = el("button", "omes-mc-event-btn");
    btn.type = "button";
    btn.dataset.pos = String(index + 1);
    const pill = el("span", "admin-status-pill");
    pill.dataset.tone = VISUAL_STATE_TONE[event.visual_state] ?? "neutral";
    const dot = el("span", "admin-status-pill-dot");
    dot.setAttribute("aria-hidden", "true");
    pill.append(
      dot,
      document.createTextNode(
        `${host.labels.states?.[event.visual_state] ?? event.visual_state} (${event.source_state})`
      )
    );
    btn.append(
      el("span", "cell-muted", event.at),
      el("span", "omes-mc-kind", host.labels.kinds?.[event.kind] ?? event.kind),
      el("span", "omes-mc-label", event.source_id),
      pill
    );
    if (event.provenance === "late_arrival") {
      const late = el("span", "omes-mc-late", L.late ?? "");
      btn.append(late);
    }
    li.append(btn);
    const route = KIND_ROUTE[event.kind];
    if (isSafeDetailRoute(route)) {
      const link = el("a", "omes-mc-link", ui.openDetails ?? "");
      link.href = route;
      link.setAttribute(
        "aria-label",
        (ui.openDetailsFor ?? "").replace("{name}", event.source_id)
      );
      li.append(link);
    }
    return li;
  }

  function appendEvents(from: number): void {
    if (!listEl) return;
    listEl.append(...events.slice(from).map((e, i) => buildEvent(e, from + i)));
  }

  function renderGaps(): void {
    if (!gapsEl) return;
    if (gaps.length === 0) {
      gapsEl.replaceChildren(el("li", "cell-muted", L.noGaps ?? ""));
      return;
    }
    gapsEl.replaceChildren(
      ...gaps.map((gap) =>
        el(
          "li",
          "omes-mc-gap",
          text("gapLine", {
            source: host.labels.sources?.[gap.source_kind] ?? gap.source_kind,
            reason: L[`reason_${gap.reason}`] ?? gap.reason,
            from: gap.from,
            to: gap.to
          })
        )
      )
    );
  }

  function renderPosition(): void {
    const total = events.length;
    const label =
      pos === 0
        ? (L.windowStart ?? "")
        : text("position", {
            n: String(pos),
            total: String(total),
            time: asOfFor(pos)
          });
    if (atEl) {
      atEl.textContent = `${asOfFor(pos)} — ${label}`;
      atEl.setAttribute("aria-live", playing ? "off" : "polite");
    }
    if (scrub) {
      scrub.max = String(total);
      scrub.value = String(pos);
      scrub.setAttribute("aria-valuetext", label);
      scrub.disabled = total === 0;
    }
    if (backBtn) backBtn.disabled = pos <= 0;
    if (fwdBtn) fwdBtn.disabled = pos >= total;
    if (playBtn) {
      playBtn.disabled = total === 0;
      playBtn.textContent = playing ? (L.pause ?? "") : (L.play ?? "");
      playBtn.setAttribute("aria-pressed", playing ? "true" : "false");
    }
    const current = listEl?.children[pos - 1] as HTMLElement | undefined;
    if (listEl && current?.dataset.pos === String(pos)) {
      listEl.querySelector("[aria-current]")?.removeAttribute("aria-current");
      current.setAttribute("aria-current", "step");
      current.scrollIntoView({ block: "nearest" });
    } else {
      listEl?.querySelector("[aria-current]")?.removeAttribute("aria-current");
    }
    if (moreEl) {
      const capped = nextCursor !== null && events.length >= MAX_LOADED;
      moreEl.hidden = !capped;
      moreEl.textContent = capped
        ? text("more", { count: String(events.length) })
        : "";
    }
  }

  // ---- loading ---------------------------------------------------------------
  async function fetchPage(): Promise<void> {
    if (loadingMore || exhausted || events.length >= MAX_LOADED) return;
    loadingMore = true;
    const mine = generation;
    try {
      const params = new URLSearchParams({
        from: wire(range.from),
        to: wire(range.to)
      });
      if (nextCursor) params.set("cursor", nextCursor);
      pageAbort ??= new AbortController();
      const page = asWindow(
        await getData(
          `${MISSION_CONTROL_REPLAY_API}?${params.toString()}`,
          pageAbort.signal
        )
      );
      if (!page || mine !== generation) return;
      const before = events.length;
      events.push(...page.events.slice(0, MAX_LOADED - before));
      gaps = page.evidence_gaps;
      nextCursor = page.next_cursor;
      exhausted = nextCursor === null;
      appendEvents(before);
      renderGaps();
    } finally {
      if (mine === generation) loadingMore = false;
    }
  }

  async function showAt(position: number): Promise<void> {
    const asOf = asOfFor(position);
    let raw = scenes.get(asOf);
    if (raw === undefined) {
      sceneAbort?.abort();
      sceneAbort = new AbortController();
      try {
        const data = await getData(
          `${MISSION_CONTROL_SCENE_API}?as_of=${encodeURIComponent(asOf)}`,
          sceneAbort.signal
        );
        raw = isRecord(data) ? data.scene : null;
      } catch (error) {
        if ((error as Error)?.name === "AbortError") return;
        setError(text("sceneFailed", { time: shownAsOf }));
        return;
      }
      if (scenes.size > 40) scenes.delete(scenes.keys().next().value as string);
      scenes.set(asOf, raw);
    }
    if (!active || position !== pos) return;
    if (!host.showScene(raw)) {
      setError(text("sceneFailed", { time: shownAsOf }));
      return;
    }
    setError("");
    setBanner(asOf);
    const event = events[position - 1];
    if (event) host.focus(event.kind, event.source_id, !host.reducedMotion());
  }

  async function goTo(next: number): Promise<void> {
    pos = Math.max(0, Math.min(next, events.length));
    renderPosition();
    writeUrl();
    if (events.length - pos < PREFETCH_AHEAD) {
      void fetchPage().then(renderPosition, () => undefined);
    }
    await showAt(pos);
  }

  function pause(): void {
    playing = false;
    window.clearTimeout(timer);
    renderPosition();
  }

  async function tick(): Promise<void> {
    if (!playing || !active) return;
    if (pos >= events.length) {
      await fetchPage().catch(() => undefined);
      if (pos >= events.length) return pause();
    }
    await goTo(pos + 1);
    if (!playing || !active) return;
    const speed = Number(speedSel?.value) || 1;
    timer = window.setTimeout(() => void tick(), BASE_STEP_MS / speed);
  }

  function play(): void {
    if (playing) return pause();
    if (pos >= events.length) pos = 0;
    playing = true;
    renderPosition();
    void tick();
  }

  async function load(
    from: number,
    to: number,
    at: number | null
  ): Promise<void> {
    pause();
    cancelRequests();
    generation += 1;
    loadingMore = false;
    exhausted = false;
    range = { from, to };
    events = [];
    gaps = [];
    nextCursor = null;
    pos = 0;
    scenes.clear();
    listEl?.replaceChildren();
    listEl?.setAttribute("aria-busy", "true");
    setError("");
    renderGaps();
    // Nothing from the live view stays on screen under the historical banner.
    host.showScene({
      mode: "historical",
      as_of: wire(from),
      nodes: [],
      relations: [],
      sources: [],
      truncated: { nodes: 0, relations: 0 }
    });
    setBanner(wire(from));
    if (fromInput) fromInput.value = toLocalInput(from);
    if (toInput) toInput.value = toLocalInput(to);
    renderPosition();
    try {
      await fetchPage();
      if (at !== null) {
        while (
          nextCursor !== null &&
          events.length < MAX_LOADED &&
          wire(at) > (events[events.length - 1]?.at ?? "")
        ) {
          await fetchPage();
        }
        pos = events.filter((e) => e.at <= wire(at)).length;
      }
      listEl?.setAttribute("aria-busy", "false");
      if (events.length === 0) {
        listEl?.append(el("li", "cell-muted", L.noEvents ?? ""));
      }
      await goTo(pos);
    } catch (error) {
      listEl?.setAttribute("aria-busy", "false");
      if ((error as Error)?.name !== "AbortError") setError(L.loadFailed ?? "");
    }
  }

  function applyRange(): void {
    const from = fromInput?.value ? new Date(fromInput.value).getTime() : NaN;
    const to = toInput?.value ? new Date(toInput.value).getTime() : NaN;
    const now = host.serverNow();
    if (
      Number.isNaN(from) ||
      Number.isNaN(to) ||
      from >= to ||
      to - from > MAX_WINDOW_MS ||
      to > now + 1000
    ) {
      setError(L.rangeInvalid ?? "");
      return;
    }
    void load(
      Math.floor(from / 1000) * 1000,
      Math.floor(to / 1000) * 1000,
      null
    );
  }

  // ---- events ----------------------------------------------------------------
  listEl?.addEventListener("click", (event) => {
    const btn = (event.target as Element | null)?.closest<HTMLButtonElement>(
      "button[data-pos]"
    );
    if (!btn) return;
    pause();
    void goTo(Number(btn.dataset.pos));
  });
  loadBtn?.addEventListener("click", applyRange);
  backBtn?.addEventListener("click", () => {
    pause();
    void goTo(pos - 1);
  });
  fwdBtn?.addEventListener("click", () => {
    pause();
    void goTo(pos + 1);
  });
  playBtn?.addEventListener("click", play);
  liveBtn?.addEventListener("click", () => host.onExit());
  scrub?.addEventListener("input", () => {
    pause();
    pos = Number(scrub.value);
    renderPosition();
    window.clearTimeout(scrubTimer);
    scrubTimer = window.setTimeout(() => void goTo(pos), 200);
  });

  return {
    enter() {
      active = true;
      const fromUrl = readUrl();
      const now = Math.floor(host.serverNow() / 1000) * 1000;
      host.announce(
        text("announceHistory", {
          time: wire(fromUrl?.at ?? fromUrl?.from ?? now - DEFAULT_RANGE_MS)
        })
      );
      if (fromUrl) void load(fromUrl.from, fromUrl.to, fromUrl.at);
      else void load(now - DEFAULT_RANGE_MS, now, null);
    },
    exit() {
      active = false;
      pause();
      cancelRequests();
      generation += 1;
      window.clearTimeout(scrubTimer);
      events = [];
      scenes.clear();
      setError("");
      clearUrl();
    }
  };
}
