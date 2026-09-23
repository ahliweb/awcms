/**
 * Server heartbeat staleness (Issue ahliweb/omes#198).
 *
 * A server is "stale" when it has never reported a heartbeat, or its last
 * heartbeat is older than {@link STALE_HEARTBEAT_THRESHOLD_MS}. Read
 * endpoints compute this flag on every response rather than storing it,
 * since staleness is a pure function of `now` and never persisted state
 * that could drift from the clock.
 */
export const STALE_HEARTBEAT_THRESHOLD_MS = 5 * 60 * 1000;

export function isHeartbeatStale(
  lastHeartbeatAt: Date | null,
  now: Date
): boolean {
  if (!lastHeartbeatAt) {
    return true;
  }

  return (
    now.getTime() - lastHeartbeatAt.getTime() > STALE_HEARTBEAT_THRESHOLD_MS
  );
}
