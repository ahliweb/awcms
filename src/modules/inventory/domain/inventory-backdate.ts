/**
 * How far into the past a caller may date a movement (Issue #887, ADR-0126).
 *
 * `occurredAt` is the business time the SOURCE states. It is the one value in a
 * posting a caller can choose freely and that nothing else corroborates, so an
 * unbounded backdate lets `movements.create` rewrite the apparent history of a
 * period that has already been counted, reported or audited. The window is
 * therefore bounded for everyone who holds only `create`/`transfer`; a caller
 * holding `movements.adjust` — the permission whose whole purpose is to correct
 * history, and which is high-risk and audited — may go further.
 *
 * Configurable because a shop that syncs a day's offline sales each evening needs
 * a window longer than one that is always online: `INVENTORY_BACKDATE_WINDOW_DAYS`
 * (default 7, `0` = no backdating beyond clock skew, ceiling 3650).
 */
export const DEFAULT_BACKDATE_WINDOW_DAYS = 7;
export const MAX_BACKDATE_WINDOW_DAYS = 3650;

const DAY_MS = 24 * 60 * 60 * 1000;

export function resolveBackdateWindowDays(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = env.INVENTORY_BACKDATE_WINDOW_DAYS;

  if (raw === undefined || raw === "") {
    return DEFAULT_BACKDATE_WINDOW_DAYS;
  }

  const days = Number(raw);

  if (!Number.isInteger(days) || days < 0) {
    return DEFAULT_BACKDATE_WINDOW_DAYS;
  }

  return Math.min(days, MAX_BACKDATE_WINDOW_DAYS);
}

/** `true` when `occurredAt` is older than the window and so needs `movements.adjust`. */
export function exceedsBackdateWindow(
  occurredAt: Date | null,
  now: Date,
  windowDays: number
): boolean {
  if (occurredAt === null) {
    return false;
  }

  return occurredAt.getTime() < now.getTime() - windowDays * DAY_MS;
}
