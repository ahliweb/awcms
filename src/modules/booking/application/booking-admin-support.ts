/**
 * Shared plumbing of the booking ADMIN configuration services (Issue #1030):
 * the actor, the refusal value, the savepoint that turns a database guard into
 * a named 4xx, and the keyset page shape.
 *
 * ## Why every guarded write runs under a savepoint
 *
 * A violated constraint or guard trigger aborts the PostgreSQL transaction, and
 * `withTenant` COMMITs a returned 4xx, so catching the error without a savepoint
 * turns a caller-actionable 409 into a 500 (the lesson of
 * `booking-schedule-directory.ts`). The savepoint also makes a refusal write
 * nothing: a resource create that fails on its third unit leaves no resource.
 *
 * ## Which refusal is which status
 *
 *   * `23505` (a unique index: the code is taken)            -> 409 `CODE_TAKEN`
 *   * `BOOKING_MODE_IN_USE`, `TIMEZONE_IN_USE`,
 *     `SCHEDULE_TIMEZONE_MISMATCH` (the resource guard)       -> 409, named
 *   * `TIMEZONE_INVALID` (`pg_timezone_names` does not know it) -> 400
 *   * `23514` (a CHECK the validator did not catch)           -> 422 `CONSTRAINT_VIOLATED`
 *   * any other `55000` guard                                -> 409 `GUARD_REFUSED`
 *
 * Anything else is a bug and is rethrown (a 500), never disguised as a 4xx.
 */
import { fail } from "../../_shared/api-response";
import {
  encodeKeysetCursor,
  type KeysetCursor
} from "../../_shared/keyset-pagination";

export type Sql = Bun.SQL;

export const ADMIN_PAGE_SIZE = 100;

export type AdminActor = {
  actorTenantUserId: string;
  correlationId?: string;
};

export type AdminRefusal = {
  outcome: "refused";
  httpStatus: 400 | 404 | 409 | 422;
  code: string;
  message: string;
  errors?: { field: string; message: string }[];
};

export function refuse(
  httpStatus: AdminRefusal["httpStatus"],
  code: string,
  message: string,
  errors?: AdminRefusal["errors"]
): AdminRefusal {
  return {
    outcome: "refused",
    httpStatus,
    code,
    message,
    ...(errors ? { errors } : {})
  };
}

export function refusalResponse(refusal: AdminRefusal): Response {
  return fail(
    refusal.httpStatus,
    refusal.code,
    refusal.message,
    {},
    refusal.errors
  );
}

/** Thrown inside a {@link guarded} callback to refuse AND roll back what the callback wrote so far. */
export class RefusalSignal extends Error {
  constructor(readonly refusal: AdminRefusal) {
    super(refusal.code);
  }
}

/** Maps a database refusal to the named refusal it is, or `null` when it is not one. */
export function classifyAdminError(error: unknown): AdminRefusal | null {
  if (!(error instanceof Bun.SQL.PostgresError)) {
    return null;
  }

  const errno = String(error.errno);
  const message = String(error.message);

  if (errno === "23505") {
    return refuse(409, "CODE_TAKEN", "That code is already in use.");
  }

  if (message.includes("BOOKING_MODE_IN_USE")) {
    return refuse(
      409,
      "BOOKING_MODE_IN_USE",
      "The booking mode cannot change while the resource has live allocations or active blocks."
    );
  }

  if (message.includes("SCHEDULE_TIMEZONE_MISMATCH")) {
    return refuse(
      409,
      "SCHEDULE_TIMEZONE_MISMATCH",
      "The resource has an active schedule written in its current time zone; deactivate it first."
    );
  }

  if (message.includes("TIMEZONE_IN_USE")) {
    return refuse(
      409,
      "TIMEZONE_IN_USE",
      "The time zone cannot change while the resource has live allocations or active blocks."
    );
  }

  if (message.includes("TIMEZONE_INVALID")) {
    return refuse(
      400,
      "TIMEZONE_INVALID",
      "timezone is not a zone the database knows."
    );
  }

  if (errno === "23514") {
    return refuse(
      422,
      "CONSTRAINT_VIOLATED",
      "The request violates a rule of the booking configuration."
    );
  }

  if (errno === "55000") {
    return refuse(409, "GUARD_REFUSED", "The database refused this change.");
  }

  return null;
}

/** Runs `run` under a savepoint; a recognised database refusal rolls it back and is returned as a value. */
export async function guarded<T>(
  tx: Sql,
  name: string,
  run: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; refusal: AdminRefusal }> {
  await tx.unsafe(`SAVEPOINT ${name}`);

  try {
    const value = await run();

    await tx.unsafe(`RELEASE SAVEPOINT ${name}`);
    return { ok: true, value };
  } catch (error) {
    await tx.unsafe(`ROLLBACK TO SAVEPOINT ${name}`);

    const refusal =
      error instanceof RefusalSignal
        ? error.refusal
        : classifyAdminError(error);

    if (refusal) {
      return { ok: false, refusal };
    }

    throw error;
  }
}

/** Builds `{ <key>: items, nextCursor }` from a page read with `LIMIT ADMIN_PAGE_SIZE`. */
export function toPage<Row extends { id: string; created_at: string }, T>(
  rows: Row[],
  map: (row: Row) => T
): { items: T[]; nextCursor: string | null } {
  const last = rows[rows.length - 1];

  return {
    items: rows.map(map),
    nextCursor:
      rows.length === ADMIN_PAGE_SIZE && last
        ? encodeKeysetCursor(last.created_at, last.id)
        : null
  };
}

export function cursorParts(cursor?: KeysetCursor): {
  createdAt: string | null;
  id: string | null;
} {
  return {
    createdAt: cursor ? cursor.createdAt : null,
    id: cursor ? cursor.id : null
  };
}

export type DeletedFilter = "exclude" | "only" | "include";
