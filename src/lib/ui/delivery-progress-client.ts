/**
 * The accessible live-progress panel for a realtime progress topic (Issue
 * #1171, ADR-0154 section 6, R11, R13). Browser module, bundled by the page's
 * `<script>` (an import keeps it external, which the CSP requires).
 *
 * ## The panel works with no stream at all
 *
 * The server renders the current counts. A labelled refresh button re-reads the
 * REST snapshot. When `EventSource` is missing, or the stream is closed by an
 * error, the panel polls that snapshot on a bounded interval. The stream only
 * makes it fresher; it is never the only way to learn the state.
 *
 * ## It never claims more than it knows
 *
 * The connection state is TEXT ("Live", "Reconnecting…", "Not live — showing
 * the state as of HH:MM", "Access ended"), not only a colour, and a stale state
 * says it is stale. Nothing here says "delivered": a stream is not delivery
 * confirmation, and it stops when the tab is closed or backgrounded.
 *
 * ## Announcements are rate-limited
 *
 * The polite `aria-live` region speaks at most once per `ANNOUNCE_INTERVAL_MS`,
 * and immediately for a state change of the connection; a counter that ticks
 * every five seconds must not talk over a screen-reader user.
 */

export const PROGRESS_STATUSES = [
  "queued",
  "retry_wait",
  "sending",
  "sent",
  "failed",
  "cancelled",
  "expired"
] as const;

export type ProgressCounts = Partial<
  Record<(typeof PROGRESS_STATUSES)[number], number>
>;

export const ANNOUNCE_INTERVAL_MS = 10_000;
export const POLL_INTERVAL_MS = 30_000;

/** Reads `counts` from a v1 frame or snapshot; anything else is ignored, never trusted. */
export function parseProgressCounts(raw: unknown): ProgressCounts | null {
  if (typeof raw !== "object" || raw === null) return null;

  const envelope = raw as { v?: unknown; counts?: unknown };

  if (
    envelope.v !== 1 ||
    typeof envelope.counts !== "object" ||
    envelope.counts === null
  ) {
    return null;
  }

  const counts: ProgressCounts = {};

  for (const status of PROGRESS_STATUSES) {
    const value = (envelope.counts as Record<string, unknown>)[status];

    if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
      counts[status] = value;
    }
  }

  return counts;
}

/** Whether an announcement may be spoken now (pure, so it is testable). */
export function shouldAnnounce(
  lastAnnouncedAt: number | null,
  now: number,
  urgent: boolean
): boolean {
  return (
    urgent ||
    lastAnnouncedAt === null ||
    now - lastAnnouncedAt >= ANNOUNCE_INTERVAL_MS
  );
}

/** Reconnect delay after a `stream-error`: exponential with full jitter, capped. */
export function backoffDelayMs(
  attempt: number,
  random: () => number = Math.random
): number {
  const ceiling = Math.min(60_000, 2_000 * 2 ** Math.max(0, attempt));

  return Math.floor(1_000 + random() * ceiling);
}

type ConnectionState = "live" | "reconnecting" | "stale" | "revoked";

/** Wires one `[data-delivery-progress]` panel. Returns a disposer. */
export function mountDeliveryProgress(root: HTMLElement): () => void {
  const streamUrl = root.dataset.streamUrl ?? "";
  const snapshotUrl = root.dataset.snapshotUrl ?? "";
  const stateText = root.querySelector<HTMLElement>("[data-progress-state]");
  const announce = root.querySelector<HTMLElement>("[data-progress-announce]");
  const refresh = root.querySelector<HTMLButtonElement>(
    "[data-progress-refresh]"
  );
  const label = (key: string) => root.dataset[key] ?? "";

  let source: EventSource | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let errorAttempts = 0;
  let lastAnnouncedAt: number | null = null;
  let lastUpdatedAt = new Date();
  let state: ConnectionState = "stale";
  let disposed = false;

  const timeLabel = (date: Date) =>
    date.toISOString().replace("T", " ").slice(0, 16) + " UTC";

  const setState = (next: ConnectionState) => {
    const changed = next !== state;

    state = next;
    root.dataset.connection = next;

    if (stateText) {
      stateText.textContent =
        next === "live"
          ? label("labelLive")
          : next === "reconnecting"
            ? label("labelReconnecting")
            : next === "revoked"
              ? label("labelRevoked")
              : label("labelStale").replace("{time}", timeLabel(lastUpdatedAt));
    }

    if (changed && announce) {
      announce.textContent = stateText?.textContent ?? "";
      lastAnnouncedAt = Date.now();
    }
  };

  const render = (counts: ProgressCounts) => {
    lastUpdatedAt = new Date();

    for (const cell of root.querySelectorAll<HTMLElement>(
      "[data-progress-count]"
    )) {
      const key = cell.dataset.progressCount as keyof ProgressCounts;
      const value = counts[key];

      if (value !== undefined) cell.textContent = String(value);
    }

    if (announce && shouldAnnounce(lastAnnouncedAt, Date.now(), false)) {
      announce.textContent = label("labelSummary")
        .replace("{sent}", String(counts.sent ?? 0))
        .replace("{failed}", String(counts.failed ?? 0))
        .replace(
          "{waiting}",
          String(
            (counts.queued ?? 0) +
              (counts.retry_wait ?? 0) +
              (counts.sending ?? 0)
          )
        );
      lastAnnouncedAt = Date.now();
    }

    if (state !== "live" && state !== "revoked") setState(state);
  };

  const fetchSnapshot = async (): Promise<boolean> => {
    try {
      const response = await fetch(snapshotUrl, {
        credentials: "same-origin",
        headers: { accept: "application/json" }
      });

      if (
        response.status === 401 ||
        response.status === 403 ||
        response.status === 404
      ) {
        stop();
        setState("revoked");
        return false;
      }

      if (!response.ok) return false;

      const body = (await response.json()) as { data?: unknown };
      const counts = parseProgressCounts(body.data);

      if (counts) render(counts);

      return counts !== null;
    } catch {
      return false;
    }
  };

  const startPolling = () => {
    if (pollTimer !== null || state === "revoked") return;

    pollTimer = setInterval(() => {
      void fetchSnapshot();
    }, POLL_INTERVAL_MS);
  };

  const stopPolling = () => {
    if (pollTimer !== null) clearInterval(pollTimer);
    pollTimer = null;
  };

  const closeSource = () => {
    source?.close();
    source = null;
  };

  function stop() {
    closeSource();
    stopPolling();
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const scheduleReconnect = () => {
    if (disposed || state === "revoked") return;

    const delay = backoffDelayMs(errorAttempts);

    errorAttempts += 1;
    reconnectTimer = setTimeout(connect, delay);
  };

  function connect() {
    reconnectTimer = null;

    if (disposed || !("EventSource" in window) || streamUrl === "") {
      startPolling();
      return;
    }

    const stream = new EventSource(streamUrl);

    source = stream;

    stream.addEventListener("open", () => {
      errorAttempts = 0;
      stopPolling();
      setState("live");
    });

    stream.addEventListener("progress", (event) => {
      try {
        const counts = parseProgressCounts(
          JSON.parse((event as MessageEvent<string>).data)
        );

        if (counts) render(counts);
      } catch {
        // A frame that does not parse changes nothing on screen.
      }
    });

    stream.addEventListener("snapshot-required", () => {
      void fetchSnapshot();
    });

    // Terminal: the server says access ended. Never reconnect.
    stream.addEventListener("authorization-revoked", () => {
      stop();
      setState("revoked");
    });

    // Terminal but retryable: back off with jitter, poll meanwhile.
    for (const name of ["stream-error", "slow-consumer"]) {
      stream.addEventListener(name, () => {
        closeSource();
        setState("stale");
        startPolling();
        scheduleReconnect();
      });
    }

    // `stream-expired` needs nothing: the server closes, and `EventSource`
    // reconnects by itself with `Last-Event-ID`.

    stream.addEventListener("error", () => {
      if (stream.readyState === EventSource.CLOSED) {
        // A refused (re)connect (401/403/404/429): fall back to polling, which
        // learns from the snapshot whether access ended.
        closeSource();
        setState("stale");
        startPolling();
        void fetchSnapshot();
      } else if (state !== "revoked") {
        setState("reconnecting");
      }
    });
  }

  refresh?.addEventListener("click", () => {
    void fetchSnapshot();
  });

  setState("stale");
  connect();

  return () => {
    disposed = true;
    stop();
  };
}
