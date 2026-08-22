/**
 * Shared cursor-boundary safety margin (Issue #753). Deliberately
 * DUPLICATED (not imported) from `data-lifecycle/domain/cursor-boundary.ts`
 * — that file documents the exact same root cause this module's own
 * cursor-ordered bounded scans (`application/projection-incremental-
 * worker.ts`, `application/projection-rebuild.ts`) are equally exposed to:
 * a `timestamptz` cursor value read back from Postgres as a JS `Date`
 * loses everything below 1 millisecond, so a plain `<=`/`>` comparison
 * against a row's own (truncated) stored value can spuriously evaluate
 * false exactly at the boundary row. `reporting`'s `module.ts` does not
 * declare a `dependencies` edge on `data_lifecycle` (no other file in this
 * module needs it), so importing one 10-line pure helper across that
 * boundary would introduce a real module-lifecycle-ordering coupling for a
 * disproportionately small amount of shared code — duplicating it here
 * (same value, same semantics) avoids that coupling entirely. If this
 * constant/helper ever needs a THIRD independent copy, that is the signal
 * to promote it to `src/lib/` instead of duplicating again.
 */
export const CURSOR_BOUNDARY_SAFETY_MARGIN_MS = 1;

/**
 * Pads a cursor boundary value by `CURSOR_BOUNDARY_SAFETY_MARGIN_MS` so a
 * comparison against it is guaranteed to include (not exclude) the row that
 * produced it, regardless of which direction the comparison faces (an
 * upper-bound `<=`/`<` or a lower-bound `>`/`>=`) — both directions need the
 * SAME upward pad because the true underlying value is always >= the
 * JS-`Date`-truncated one that was actually stored/read.
 */
export function applyCursorBoundarySafetyMargin(value: Date): Date {
  return new Date(value.getTime() + CURSOR_BOUNDARY_SAFETY_MARGIN_MS);
}

/**
 * Finding C4 — the incremental scan had NO upper bound, and that is not the
 * same problem as the millisecond pad above.
 *
 * Postgres `now()` is the instant the transaction STARTED, so a row written by
 * a long transaction carries a `created_at` from before it committed. The
 * worker selects `cursorColumn >= cursor ORDER BY cursorColumn ASC`, advances
 * the cursor to the last row it saw, and that row may commit AFTERWARDS with a
 * timestamp already behind the cursor — never selected again. ADR-0077 rejected
 * exactly this shape for sync-pull; this engine kept it, and ADR-0072 declares
 * the incremental value authoritative, so nothing reconciles it.
 *
 * The scan now stops at `now() - LAG`. The guarantee that buys is precise and
 * worth stating rather than implying:
 *
 *   A row is counted if the transaction that wrote it committed within
 *   {@link DEFAULT_PROJECTION_LAG_SECONDS} of starting.
 *
 * The cursor only advances past a timestamp `V` on a pass that runs at wall
 * time `V + LAG` or later, so any writer that took less than `LAG` has already
 * committed and is visible by then. A writer that holds a transaction open
 * LONGER than the lag is still missed — that residue is not eliminated, it is
 * bounded and named. `DATABASE_STATEMENT_TIMEOUT_MS` (default 15 s) caps a
 * single statement, not a transaction, which is why the default here is four
 * times that rather than equal to it.
 *
 * ## Why not `pg_stat_activity`
 *
 * `min(xact_start)` over running backends would be exactly right — no row can
 * later appear below it. It is unusable here: a non-superuser without
 * `pg_read_all_stats` reads NULL for other users' `xact_start`, so the bound
 * would silently become `now()` — no bound at all, wearing the shape of one.
 * A wrong answer that looks like the right mechanism is worse than a plainly
 * approximate one.
 */
export const DEFAULT_PROJECTION_LAG_SECONDS = 60;

const MAX_PROJECTION_LAG_SECONDS = 3600;

/**
 * Resolves the lag in seconds from `REPORTING_PROJECTION_LAG_SECONDS`.
 *
 * Anything non-finite, non-integer or negative falls back to the default; `0`
 * is accepted and means "no lag", which restores the old behaviour for a
 * deployment that has measured its own writers and wants the freshness. The
 * ceiling exists because a lag larger than an hour is a projection that is
 * wrong in the other direction — permanently stale — and that failure is just
 * as silent.
 */
export function resolveProjectionLagSeconds(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = Number(env.REPORTING_PROJECTION_LAG_SECONDS);

  if (!Number.isInteger(raw) || raw < 0) {
    return DEFAULT_PROJECTION_LAG_SECONDS;
  }

  return Math.min(raw, MAX_PROJECTION_LAG_SECONDS);
}
