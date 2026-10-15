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

/**
 * Tie-safe batch boundary (Issue #944).
 *
 * The resume bound is `cursorColumn >= cursor + 1ms` (see above), so a row that
 * shares the last processed row's millisecond but was cut off by `LIMIT` is
 * excluded from the NEXT pass too -- and never counted. For the sources the
 * engine first wrapped (decision logs, identities, sync nodes) every row has its
 * own timestamp, so that needed a pathological coincidence. A source that writes
 * SEVERAL rows in one transaction does not need one: `created_at DEFAULT now()`
 * is the transaction's start, so the `created` and `held` history rows of one
 * reservation carry the identical instant, and a page boundary lands between
 * them often.
 *
 * The caller fetches `limit + 1` rows. The extra row is a LOOKAHEAD: it is never
 * processed, it only says whether the page's last millisecond continues past the
 * cut. When it does, the page drops its trailing rows that share that
 * millisecond; the kept rows are then strictly earlier than every dropped one,
 * so the dropped rows sit at `>= cursor + 1ms` and the next pass reads them
 * whole. When it does not (or there is no lookahead because the source ran out)
 * the page is exactly the `limit` rows it always was -- behaviour for a source
 * with distinct timestamps is unchanged.
 *
 * The one case it cannot help is a page whose rows ALL share one millisecond with
 * the lookahead (`limit + 1` rows with one timestamp): there is nothing earlier
 * to end on, and the engine FAILS LOUDLY (throws; the pass rolls back and the
 * projection records the failure) instead of skipping the rest of the
 * millisecond silently or stalling the cursor. ADR-0143 section 2.
 */
export function trimIncompleteTail<T extends Record<string, unknown>>(
  rows: readonly T[],
  cursorColumn: string,
  limit: number
): T[] {
  if (rows.length <= limit) {
    return [...rows];
  }

  const msOf = (row: T): number => {
    const value = row[cursorColumn];

    return (
      value instanceof Date ? value : new Date(value as string)
    ).getTime();
  };
  const page = rows.slice(0, limit);
  const lastMs = msOf(page[page.length - 1]!);

  if (msOf(rows[limit]!) !== lastMs) {
    return page;
  }

  let keep = page.length;

  while (keep > 0 && msOf(page[keep - 1]!) === lastMs) {
    keep -= 1;
  }

  if (keep === 0) {
    // `limit + 1` rows inside one millisecond: nothing earlier to end on. Keeping
    // the page would silently skip the rest of the millisecond and dropping all
    // of it would stall the cursor, so fail loudly (ADR-0143 section 2). The
    // pass's transaction rolls back and the projection records the failure; the
    // fix is a `batchLimit` above the tie group.
    throw new Error(
      `reporting projection engine: more than ${limit} source rows share one millisecond of "${cursorColumn}"; raise the descriptor's batchLimit above the tie group (a keyset cursor is the structural fix, ADR-0143).`
    );
  }

  return page.slice(0, keep);
}
