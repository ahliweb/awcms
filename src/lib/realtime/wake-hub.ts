/**
 * The wake-up hub of the realtime progress streams (Issue #1171, ADR-0154
 * section 2 and 7). Pure: no database, no network.
 *
 * ## What a hint IS, and what it is not
 *
 * A hint says "something committed for this tenant and topic; read now instead
 * of at the next tick". It carries a tenant id and a topic name and NOTHING
 * else: no resource id, no row id, no counter, no text. It is not a delivery
 * mechanism and not a source of truth: a stream that never receives it still
 * reads PostgreSQL every tick, so a lost, late, duplicated or forged hint costs
 * latency or one redundant read, never correctness.
 *
 * ## Why the hub does not authorize
 *
 * Waking a stream grants it nothing. The woken stream runs its ordinary tick:
 * a fresh tenant transaction, `authorizeInTransaction`, the resource
 * visibility re-check, then the read with the cursor it already holds
 * (ADR-0075, ADR-0154 R3 and R6). A subscriber is keyed by the tenant its own
 * authenticated session belongs to, so a hint for tenant B simply has no
 * subscriber among tenant A's streams.
 *
 * ## Why delivery is spread (audit B1, the thundering herd)
 *
 * One hint wakes EVERY stream of a tenant and topic, and each woken stream runs
 * a tick: a tenant transaction in the small `realtime_stream` work class (3
 * slots, queue 12). Waking 100 streams in one synchronous loop asks for 100
 * transactions at once; everything past the queue is refused, and a refusal on
 * the old path ended the stream. The hub therefore hands each woken stream a
 * random delay inside a window that grows with the number of streams
 * (`perSubscriberMs` each, capped at `maxSpreadMs`), so the demand arrives as a
 * ramp the class can serve. The route adds the second half: a tick triggered by
 * a wake that the database refuses (queue full, breaker) degrades to the timer
 * instead of ending the stream. The same spread applies to `wakeAll` after a
 * listener reconnect, across ALL streams of the process.
 *
 * ## Why it is throttled
 *
 * A burst of writes (a broadcast finalising a thousand rows) emits a hint per
 * statement. Without a floor every open stream of the tenant would run a tick
 * per hint. The hub delivers at most one wake per (tenant, topic) per
 * `throttleMs`: the first immediately, the rest collapsed into one trailing
 * wake, so a burst costs each stream two ticks, and the last write of a burst
 * is never left unannounced.
 */

/** The PostgreSQL channel every producer notifies on (`sql/418`). */
export const REALTIME_WAKE_CHANNEL = "awcms_realtime";

/** A NOTIFY payload is capped far below PostgreSQL's 8000 bytes: a hint is two ids' worth. */
export const MAX_WAKE_PAYLOAD_BYTES = 256;

export type WakeHint = { tenantId: string; topic: string };

export type WakeDispatchResult = "delivered" | "no_subscriber" | "malformed";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Parses a NOTIFY payload strictly: exactly `{"t": <uuid>, "k": <known topic>}`.
 * Anything else (extra keys, wrong types, an unknown topic, an oversized body)
 * is `null`. Strictness is the point: the channel is writable by any role that
 * can run `pg_notify`, so a payload is untrusted input to a process that holds
 * live streams.
 */
export function parseWakeHint(
  raw: string,
  knownTopics: ReadonlySet<string>
): WakeHint | null {
  if (typeof raw !== "string" || raw.length > MAX_WAKE_PAYLOAD_BYTES) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length !== 2
  ) {
    return null;
  }

  const { t, k } = parsed as Record<string, unknown>;

  if (
    typeof t !== "string" ||
    !UUID_PATTERN.test(t) ||
    typeof k !== "string" ||
    !knownTopics.has(k)
  ) {
    return null;
  }

  return { tenantId: t, topic: k };
}

export type WakeHubOptions = {
  knownTopics: ReadonlySet<string>;
  /** Minimum gap between two wakes of one (tenant, topic). */
  throttleMs?: number;
  /** Window added per extra subscriber when spreading a wake (default 20 ms). */
  perSubscriberMs?: number;
  /** Ceiling of the spreading window (default 2000 ms). */
  maxSpreadMs?: number;
  random?: () => number;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

export type WakeHub = {
  /** Registers a wake callback for one tenant's topic; returns the unsubscribe. */
  subscribe: (tenantId: string, topic: string, wake: () => void) => () => void;
  /** Parses and delivers one raw NOTIFY payload. */
  dispatch: (raw: string) => WakeDispatchResult;
  /** Wakes every subscriber now (after a listener reconnect: hints may have been lost). */
  wakeAll: () => void;
  subscriberCount: () => number;
};

export const DEFAULT_WAKE_THROTTLE_MS = 250;
export const DEFAULT_WAKE_PER_SUBSCRIBER_MS = 20;
export const DEFAULT_WAKE_MAX_SPREAD_MS = 2000;

type KeyState = {
  subscribers: Set<() => void>;
  lastWakeAt: number;
  timer: unknown;
};

function keyOf(tenantId: string, topic: string): string {
  return `${tenantId}|${topic}`;
}

export function createWakeHub(options: WakeHubOptions): WakeHub {
  const throttleMs = options.throttleMs ?? DEFAULT_WAKE_THROTTLE_MS;
  const now = options.now ?? Date.now;
  const setTimer =
    options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer =
    options.clearTimer ??
    ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const perSubscriberMs =
    options.perSubscriberMs ?? DEFAULT_WAKE_PER_SUBSCRIBER_MS;
  const maxSpreadMs = options.maxSpreadMs ?? DEFAULT_WAKE_MAX_SPREAD_MS;
  const random = options.random ?? Math.random;
  const keys = new Map<string, KeyState>();

  function call(wake: () => void): void {
    try {
      wake();
    } catch {
      // One broken subscriber must not starve the others.
    }
  }

  /** Wakes `wakes`, each after its own random delay inside a window sized by their number. */
  function release(wakes: (() => void)[]): void {
    const spread = Math.min(maxSpreadMs, (wakes.length - 1) * perSubscriberMs);

    for (const wake of wakes) {
      if (spread <= 0) {
        call(wake);
      } else {
        // A late wake of a stream that has since left is harmless: it only
        // marks a hint pending on a loop that has ended.
        setTimer(() => call(wake), Math.floor(random() * spread));
      }
    }
  }

  function fire(state: KeyState): void {
    state.lastWakeAt = now();

    // A copy: a callback may unsubscribe itself.
    release([...state.subscribers]);
  }

  return {
    subscribe(tenantId, topic, wake) {
      const key = keyOf(tenantId, topic);
      let state = keys.get(key);

      if (!state) {
        state = {
          subscribers: new Set(),
          lastWakeAt: Number.NEGATIVE_INFINITY,
          timer: null
        };
        keys.set(key, state);
      }

      state.subscribers.add(wake);

      return () => {
        const current = keys.get(key);

        if (!current) return;

        current.subscribers.delete(wake);

        if (current.subscribers.size === 0) {
          if (current.timer !== null) clearTimer(current.timer);
          keys.delete(key);
        }
      };
    },

    dispatch(raw) {
      const hint = parseWakeHint(raw, options.knownTopics);

      if (!hint) return "malformed";

      // Keyed by the (tenant, topic) of the hint: a hint for a tenant with no
      // open stream on this instance finds no state and is dropped here, so
      // the map never grows from hints alone.
      const state = keys.get(keyOf(hint.tenantId, hint.topic));

      if (!state) return "no_subscriber";

      const elapsed = now() - state.lastWakeAt;

      if (elapsed >= throttleMs) {
        if (state.timer !== null) {
          clearTimer(state.timer);
          state.timer = null;
        }

        fire(state);
      } else if (state.timer === null) {
        // One trailing wake covers every hint that lands inside the window.
        state.timer = setTimer(() => {
          state.timer = null;
          fire(state);
        }, throttleMs - elapsed);
      }

      return "delivered";
    },

    wakeAll() {
      const everyone: (() => void)[] = [];

      for (const state of keys.values()) {
        if (state.timer !== null) {
          clearTimer(state.timer);
          state.timer = null;
        }

        state.lastWakeAt = now();
        everyone.push(...state.subscribers);
      }

      // One window across every stream of the process, not one per key.
      release(everyone);
    },

    subscriberCount() {
      let total = 0;

      for (const state of keys.values()) total += state.subscribers.size;

      return total;
    }
  };
}
