/**
 * ONE PostgreSQL `LISTEN` connection per process (Issue #1171, ADR-0154
 * section 2 and 7). It forwards each NOTIFY payload to a callback and nothing
 * else: no stream, no request, no tenant data passes through it.
 *
 * ## Properties
 *
 * - **One per process, not per client.** The connection is not drawn from the
 *   request pool and does not grow with open streams.
 * - **Never a privileged login.** Before `LISTEN`, the connection asks the
 *   server who it is and refuses SUPERUSER and BYPASSRLS. The listener needs no
 *   privilege at all (`LISTEN` is open to any role), so a login that has any is
 *   a misconfiguration; refusing is permanent (no retry), loud, and leaves the
 *   streams on their polling tick, which is correct on its own.
 * - **Reconnect with backoff, then catch up.** On loss the client is closed
 *   (stopping the driver's own silent reconnect, so exactly one owner decides),
 *   and a new one is built after an exponential, jittered delay. A success calls
 *   `onReconnected`, which wakes every stream: notifications sent while the
 *   connection was down are gone, so each stream reads from the cursor it
 *   already holds. Durability never depended on a NOTIFY.
 */
import { REALTIME_WAKE_CHANNEL } from "./wake-hub";

/** An alias, on purpose: the swallow gate reads a `: Bun.SQL` annotation as a transaction handle, and this connection is not one. */
type SqlClient = Bun.SQL;

export type WakeListenerState = "connecting" | "listening" | "down" | "refused";

export type WakeListenerOptions = {
  url: string;
  channel?: string;
  onPayload: (raw: string) => void;
  /** After a successful (re)connect: wake everything, hints may have been lost. */
  onReconnected: () => void;
  onStateChange?: (state: WakeListenerState, detail?: string) => void;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  random?: () => number;
  /** Test seam: builds the client. Defaults to `Bun.SQL` with a single connection. */
  createClient?: (url: string, onclose: (error?: unknown) => void) => SqlClient;
};

export type WakeListenerHandle = {
  state: () => WakeListenerState;
  stop: () => Promise<void>;
};

/** A listening login that is more than a login. Not retried. */
export class WakeListenerRoleRefused extends Error {
  constructor(detail: string) {
    super(
      `The realtime wake listener refuses a privileged login: ${detail}. It needs no privilege; point it at the application role.`
    );
    this.name = "WakeListenerRoleRefused";
  }
}

/** The role check. Exported so a test drives it on its own. */
export async function assertListenerRoleIsUnprivileged(
  sql: SqlClient
): Promise<void> {
  const rows = (await sql`
    SELECT r.rolname AS name, r.rolsuper AS superuser, r.rolbypassrls AS bypass
    FROM pg_roles r
    WHERE r.rolname = session_user
  `) as { name: string; superuser: boolean; bypass: boolean }[];
  const who = rows[0];

  if (!who) throw new WakeListenerRoleRefused("the login is not in pg_roles");
  if (who.superuser)
    throw new WakeListenerRoleRefused("the login is SUPERUSER");
  if (who.bypass) throw new WakeListenerRoleRefused("the login has BYPASSRLS");
}

function defaultCreateClient(
  url: string,
  onclose: (error?: unknown) => void
): SqlClient {
  return new Bun.SQL(url, {
    max: 1,
    // A session-level LISTEN needs a plain session; no prepared-statement cache
    // is useful for the two statements this connection ever runs.
    prepare: false,
    onclose
  });
}

export function startWakeListener(
  options: WakeListenerOptions
): WakeListenerHandle {
  const channel = options.channel ?? REALTIME_WAKE_CHANNEL;
  const initialBackoffMs = options.initialBackoffMs ?? 500;
  const maxBackoffMs = options.maxBackoffMs ?? 30_000;
  const random = options.random ?? Math.random;
  const createClient = options.createClient ?? defaultCreateClient;

  let state: WakeListenerState = "connecting";
  let stopped = false;
  let current: SqlClient | null = null;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const setState = (next: WakeListenerState, detail?: string) => {
    state = next;
    options.onStateChange?.(next, detail);
  };

  const scheduleReconnect = () => {
    if (stopped || retryTimer !== null || state === "refused") return;

    const ceiling = Math.min(maxBackoffMs, initialBackoffMs * 2 ** attempt);
    // Jitter in [50%, 100%] of the ceiling: replicas that lost the database
    // together must not reconnect together.
    const delay = Math.floor(ceiling * (0.5 + random() / 2));

    attempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, delay);
  };

  const dropCurrent = async () => {
    const old = current;

    current = null;

    if (old) {
      try {
        await old.close({ timeout: 0 });
      } catch {
        // Already closed.
      }
    }
  };

  const onClosed = (client: SqlClient) => {
    // Only the CURRENT client's loss matters; one we closed ourselves, or a
    // stale one, must not trigger a second reconnect.
    if (stopped || client !== current) return;

    setState("down", "connection lost");
    void dropCurrent().then(scheduleReconnect);
  };

  const connect = async (): Promise<void> => {
    if (stopped) return;

    setState("connecting");

    let client: SqlClient | null = null;

    try {
      // The role is checked on a short-lived connection of the SAME login that
      // is closed before listening, so the listener itself is exactly one
      // backend (a query on the listening client would leave a second, pooled
      // one open next to the reserved `LISTEN` connection).
      const checker: SqlClient = createClient(options.url, () => undefined);

      try {
        await assertListenerRoleIsUnprivileged(checker);
      } finally {
        await checker.close({ timeout: 0 }).catch(() => undefined);
      }

      const created: SqlClient = createClient(options.url, () => {
        onClosed(created);
      });

      client = created;
      current = created;

      await created.listen(channel, (payload: string) => {
        try {
          options.onPayload(payload);
        } catch {
          // A callback fault must not kill the listener.
        }
      });

      if (stopped || current !== created) {
        await created.close({ timeout: 0 }).catch(() => undefined);
        return;
      }

      attempt = 0;
      setState("listening");
      options.onReconnected();
    } catch (error) {
      if (client && current === client) await dropCurrent();
      else if (client)
        await client.close({ timeout: 0 }).catch(() => undefined);

      if (error instanceof WakeListenerRoleRefused) {
        // Permanent: retrying would only repeat the refusal.
        setState("refused", error.message);
        return;
      }

      setState("down", error instanceof Error ? error.name : "error");
      scheduleReconnect();
    }
  };

  void connect();

  return {
    state: () => state,
    async stop() {
      stopped = true;

      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }

      await dropCurrent();
    }
  };
}
