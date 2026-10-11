/**
 * Schedules, closures and exceptions of `booking` (Issue #938): the configuration
 * the availability calculation reads. Tenant-scoped under RLS FORCE; every query
 * also names `tenant_id`.
 *
 * ## Supersede, do not edit
 *
 * A schedule's windows are never edited in place (booking.md section 4): a new
 * effective window supersedes the old one. The only changes are shortening
 * `effective_to` and deactivating, and the database trigger of `sql/186` holds
 * that for every writer; the validator and this module state it again so the
 * refusal is a 4xx with a name rather than a database error.
 *
 * ## A schedule change cancels nothing
 *
 * Editing a schedule changes FUTURE availability only. A stored allocation's
 * instants are facts (booking.md section 2.2); the read-only conflict report of
 * section 7.3 arrives with reconciliation.
 *
 * ## The savepoint
 *
 * A violated constraint aborts the PostgreSQL transaction, and `withTenant`
 * COMMITs a returned 4xx, so catching the error without a savepoint turns a
 * caller-actionable 409 into a 500. Each guarded write runs under one.
 */
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  keysetCursorCreatedAtSql,
  type KeysetCursor
} from "../../_shared/keyset-pagination";
import { recordAuditEvent } from "../../logging/application/audit-log";
import { BOOKING_AUDIT_EVENTS } from "../domain/booking-audit";
import { BOOKING_MODULE_KEY } from "../domain/booking-permissions";
import type { ExceptionInput, ScheduleInput } from "../domain/booking-schedule";
import type { SchedulePatchInput } from "../domain/booking-validation";

type Sql = Bun.SQL;

export const SCHEDULE_PAGE_SIZE = 100;

export type ScheduleActor = {
  actorTenantUserId: string;
  correlationId?: string;
};

export type ScheduleDto = {
  id: string;
  resourceId: string | null;
  timezone: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  rules: unknown;
  status: "active" | "inactive";
  createdAt: string;
};

export type ExceptionDto = {
  id: string;
  scheduleId: string | null;
  resourceId: string | null;
  localFrom: string;
  localTo: string;
  kind: "closed" | "override_hours";
  windows: unknown;
  reasonCode: string | null;
  createdAt: string;
};

type ScheduleRow = {
  id: string;
  resource_id: string | null;
  timezone: string;
  effective_from: string;
  effective_to: string | null;
  rules: unknown;
  status: "active" | "inactive";
  created_at: string;
};

type ExceptionRow = {
  id: string;
  schedule_id: string | null;
  resource_id: string | null;
  local_from: string;
  local_to: string;
  kind: "closed" | "override_hours";
  windows: unknown;
  reason_code: string | null;
  created_at: string;
};

const SCHEDULE_COLUMNS = `
  s.id, s.resource_id, s.timezone,
  to_char(s.effective_from, 'YYYY-MM-DD') AS effective_from,
  to_char(s.effective_to, 'YYYY-MM-DD') AS effective_to,
  s.rules, s.status,
  ${keysetCursorCreatedAtSql("s")} AS created_at`;

const EXCEPTION_COLUMNS = `
  e.id, e.schedule_id, e.resource_id,
  to_char(e.local_from, 'YYYY-MM-DD') AS local_from,
  to_char(e.local_to, 'YYYY-MM-DD') AS local_to,
  e.kind, e.windows, e.reason_code,
  ${keysetCursorCreatedAtSql("e")} AS created_at`;

function toSchedule(row: ScheduleRow): ScheduleDto {
  return {
    id: row.id,
    resourceId: row.resource_id,
    timezone: row.timezone,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    rules: row.rules,
    status: row.status,
    createdAt: row.created_at
  };
}

function toException(row: ExceptionRow): ExceptionDto {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    resourceId: row.resource_id,
    localFrom: row.local_from,
    localTo: row.local_to,
    kind: row.kind,
    windows: row.windows,
    reasonCode: row.reason_code,
    createdAt: row.created_at
  };
}

export function parseScheduleCursor(cursor: string): KeysetCursor | null {
  return decodeKeysetCursor(cursor);
}

export async function listSchedules(
  tx: Sql,
  tenantId: string,
  filters: { resourceId?: string; activeOnly: boolean },
  cursor?: KeysetCursor
): Promise<{ schedules: ScheduleDto[]; nextCursor: string | null }> {
  const resourceId = filters.resourceId ?? null;
  const cursorCreatedAt = cursor ? cursor.createdAt : null;
  const cursorId = cursor ? cursor.id : null;
  const rows = (await tx`
    SELECT ${tx.unsafe(SCHEDULE_COLUMNS)}
    FROM awcms_booking_schedules s
    WHERE s.tenant_id = ${tenantId}
      AND (${resourceId}::uuid IS NULL OR s.resource_id = ${resourceId}::uuid)
      AND (NOT ${filters.activeOnly} OR s.status = 'active')
      AND (
        ${cursorCreatedAt}::timestamptz IS NULL
        OR (s.created_at, s.id) < (${cursorCreatedAt}::timestamptz, ${cursorId}::uuid)
      )
    ORDER BY s.created_at DESC, s.id DESC
    LIMIT ${SCHEDULE_PAGE_SIZE}
  `) as ScheduleRow[];
  const last = rows[rows.length - 1];

  return {
    schedules: rows.map(toSchedule),
    nextCursor:
      rows.length === SCHEDULE_PAGE_SIZE && last
        ? encodeKeysetCursor(last.created_at, last.id)
        : null
  };
}

export async function listExceptions(
  tx: Sql,
  tenantId: string,
  filters: { scheduleId?: string; resourceId?: string },
  cursor?: KeysetCursor
): Promise<{ exceptions: ExceptionDto[]; nextCursor: string | null }> {
  const scheduleId = filters.scheduleId ?? null;
  const resourceId = filters.resourceId ?? null;
  const cursorCreatedAt = cursor ? cursor.createdAt : null;
  const cursorId = cursor ? cursor.id : null;
  const rows = (await tx`
    SELECT ${tx.unsafe(EXCEPTION_COLUMNS)}
    FROM awcms_booking_schedule_exceptions e
    WHERE e.tenant_id = ${tenantId}
      AND (${scheduleId}::uuid IS NULL OR e.schedule_id = ${scheduleId}::uuid)
      AND (${resourceId}::uuid IS NULL OR e.resource_id = ${resourceId}::uuid)
      AND (
        ${cursorCreatedAt}::timestamptz IS NULL
        OR (e.created_at, e.id) < (${cursorCreatedAt}::timestamptz, ${cursorId}::uuid)
      )
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT ${SCHEDULE_PAGE_SIZE}
  `) as ExceptionRow[];
  const last = rows[rows.length - 1];

  return {
    exceptions: rows.map(toException),
    nextCursor:
      rows.length === SCHEDULE_PAGE_SIZE && last
        ? encodeKeysetCursor(last.created_at, last.id)
        : null
  };
}

export async function getSchedule(
  tx: Sql,
  tenantId: string,
  id: string
): Promise<ScheduleDto | null> {
  const rows = (await tx`
    SELECT ${tx.unsafe(SCHEDULE_COLUMNS)}
    FROM awcms_booking_schedules s
    WHERE s.tenant_id = ${tenantId} AND s.id = ${id}
  `) as ScheduleRow[];

  return rows[0] ? toSchedule(rows[0]) : null;
}

type GuardedFailure =
  "overlap" | "timezone_mismatch" | "timezone_invalid" | "not_editable";

/** Maps the database's refusals (constraint 23P01, trigger messages) to a name. */
function classify(error: unknown): GuardedFailure | null {
  if (!(error instanceof Bun.SQL.PostgresError)) {
    return null;
  }

  const errno = String(error.errno);
  const message = String(error.message);

  if (errno === "23P01" || errno === "23505") {
    return "overlap";
  }

  if (message.includes("SCHEDULE_TIMEZONE_MISMATCH")) {
    return "timezone_mismatch";
  }

  if (message.includes("TIMEZONE_INVALID")) {
    return "timezone_invalid";
  }

  if (errno === "55000") {
    return "not_editable";
  }

  return null;
}

async function guarded<T>(
  tx: Sql,
  name: string,
  run: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; failure: GuardedFailure }> {
  await tx.unsafe(`SAVEPOINT ${name}`);

  try {
    const value = await run();

    await tx.unsafe(`RELEASE SAVEPOINT ${name}`);
    return { ok: true, value };
  } catch (error) {
    await tx.unsafe(`ROLLBACK TO SAVEPOINT ${name}`);

    const failure = classify(error);

    if (failure) {
      return { ok: false, failure };
    }

    throw error;
  }
}

export type CreateScheduleResult =
  | { outcome: "ok"; schedule: ScheduleDto }
  | { outcome: "resource_not_found" }
  | { outcome: "overlap" }
  | { outcome: "timezone_mismatch" }
  | { outcome: "timezone_invalid" };

export async function createSchedule(
  tx: Sql,
  tenantId: string,
  actor: ScheduleActor,
  input: ScheduleInput
): Promise<CreateScheduleResult> {
  if (input.resourceId) {
    const resource = (await tx`
      SELECT 1 AS present FROM awcms_booking_resources
      WHERE tenant_id = ${tenantId} AND id = ${input.resourceId}
        AND deleted_at IS NULL
    `) as unknown[];

    if (resource.length === 0) {
      return { outcome: "resource_not_found" };
    }
  }

  const result = await guarded(
    tx,
    "awcms_booking_schedule_create",
    async () =>
      (await tx`
      INSERT INTO awcms_booking_schedules
        (tenant_id, resource_id, timezone, effective_from, effective_to, rules,
         created_by, updated_by)
      VALUES (
        ${tenantId}, ${input.resourceId}, ${input.timezone},
        ${input.effectiveFrom}::date, ${input.effectiveTo}::date,
        ${input.rules as object}::jsonb,
        ${actor.actorTenantUserId}, ${actor.actorTenantUserId}
      )
      RETURNING id
    `) as { id: string }[]
  );

  if (!result.ok) {
    return result.failure === "not_editable"
      ? { outcome: "overlap" }
      : { outcome: result.failure };
  }

  const id = result.value[0]!.id;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId,
    moduleKey: BOOKING_MODULE_KEY,
    action: BOOKING_AUDIT_EVENTS.scheduleChanged.action,
    resourceType: "booking_schedule",
    resourceId: id,
    severity: BOOKING_AUDIT_EVENTS.scheduleChanged.severity,
    message: "Booking schedule created.",
    attributes: {
      change: "created",
      resourceId: input.resourceId,
      timezone: input.timezone,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo
    },
    correlationId: actor.correlationId
  });

  return { outcome: "ok", schedule: (await getSchedule(tx, tenantId, id))! };
}

export type PatchScheduleResult =
  | { outcome: "ok"; schedule: ScheduleDto }
  | { outcome: "not_found" }
  | { outcome: "not_editable"; message: string };

/** Shortens `effective_to` and/or deactivates; nothing else is editable. */
export async function patchSchedule(
  tx: Sql,
  tenantId: string,
  actor: ScheduleActor,
  id: string,
  patch: SchedulePatchInput
): Promise<PatchScheduleResult> {
  const current = (await tx`
    SELECT status, to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
           to_char(effective_to, 'YYYY-MM-DD') AS effective_to
    FROM awcms_booking_schedules
    WHERE tenant_id = ${tenantId} AND id = ${id}
    FOR UPDATE
  `) as {
    status: string;
    effective_from: string;
    effective_to: string | null;
  }[];
  const row = current[0];

  if (!row) {
    return { outcome: "not_found" };
  }

  if (row.status !== "active") {
    return {
      outcome: "not_editable",
      message: "An inactive schedule cannot be changed; create a new window."
    };
  }

  if (patch.effectiveTo !== undefined) {
    if (patch.effectiveTo <= row.effective_from) {
      return {
        outcome: "not_editable",
        message: "effectiveTo must be after effectiveFrom."
      };
    }

    if (row.effective_to !== null && patch.effectiveTo >= row.effective_to) {
      return {
        outcome: "not_editable",
        message:
          "effectiveTo may only be shortened; supersede with a new window to extend."
      };
    }
  }

  const effectiveTo = patch.effectiveTo ?? null;
  const deactivate = patch.status === "inactive";
  const result = await guarded(
    tx,
    "awcms_booking_schedule_patch",
    async () =>
      tx`
      UPDATE awcms_booking_schedules
      SET effective_to = COALESCE(${effectiveTo}::date, effective_to),
          status = CASE WHEN ${deactivate} THEN 'inactive' ELSE status END,
          updated_at = now(),
          updated_by = ${actor.actorTenantUserId}
      WHERE tenant_id = ${tenantId} AND id = ${id}
    `
  );

  if (!result.ok) {
    return {
      outcome: "not_editable",
      message: "The schedule cannot be changed that way."
    };
  }

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId,
    moduleKey: BOOKING_MODULE_KEY,
    action: BOOKING_AUDIT_EVENTS.scheduleChanged.action,
    resourceType: "booking_schedule",
    resourceId: id,
    severity: BOOKING_AUDIT_EVENTS.scheduleChanged.severity,
    message: deactivate
      ? "Booking schedule deactivated."
      : "Booking schedule shortened.",
    attributes: {
      change: deactivate ? "deactivated" : "shortened",
      effectiveTo: patch.effectiveTo ?? null
    },
    correlationId: actor.correlationId
  });

  return { outcome: "ok", schedule: (await getSchedule(tx, tenantId, id))! };
}

export type CreateExceptionResult =
  | { outcome: "ok"; exception: ExceptionDto }
  | { outcome: "duplicate" }
  | { outcome: "owner_not_found" };

export async function createException(
  tx: Sql,
  tenantId: string,
  actor: ScheduleActor,
  input: ExceptionInput
): Promise<CreateExceptionResult> {
  const owner = input.scheduleId
    ? ((await tx`
        SELECT 1 AS present FROM awcms_booking_schedules
        WHERE tenant_id = ${tenantId} AND id = ${input.scheduleId}
          AND status = 'active'
        FOR SHARE
      `) as unknown[])
    : ((await tx`
        SELECT 1 AS present FROM awcms_booking_resources
        WHERE tenant_id = ${tenantId} AND id = ${input.resourceId}
          AND deleted_at IS NULL
        FOR SHARE
      `) as unknown[]);

  if (owner.length === 0) {
    return { outcome: "owner_not_found" };
  }

  const windows = input.windows === null ? null : (input.windows as object);
  const inserted = await guarded(
    tx,
    "awcms_booking_exception_create",
    async () =>
      (await tx`
        INSERT INTO awcms_booking_schedule_exceptions
          (tenant_id, schedule_id, resource_id, local_from, local_to, kind, windows,
           reason_code, created_by)
        VALUES (
          ${tenantId}, ${input.scheduleId}, ${input.resourceId},
          ${input.localFrom}::date, ${input.localTo}::date, ${input.kind},
          ${windows}::jsonb, ${input.reasonCode}, ${actor.actorTenantUserId}
        )
        RETURNING id
      `) as { id: string }[]
  );

  if (!inserted.ok) {
    return { outcome: "duplicate" };
  }

  const id = inserted.value[0]!.id;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId,
    moduleKey: BOOKING_MODULE_KEY,
    action: BOOKING_AUDIT_EVENTS.scheduleChanged.action,
    resourceType: "booking_schedule_exception",
    resourceId: id,
    severity: BOOKING_AUDIT_EVENTS.scheduleChanged.severity,
    message: "Booking schedule exception created.",
    attributes: {
      change: "exception_created",
      kind: input.kind,
      localFrom: input.localFrom,
      localTo: input.localTo
    },
    correlationId: actor.correlationId
  });

  const created = (await tx`
    SELECT ${tx.unsafe(EXCEPTION_COLUMNS)}
    FROM awcms_booking_schedule_exceptions e
    WHERE e.tenant_id = ${tenantId} AND e.id = ${id}
  `) as ExceptionRow[];

  return { outcome: "ok", exception: toException(created[0]!) };
}

/** Deletes one exception (configuration with no history value); audited. */
export async function deleteException(
  tx: Sql,
  tenantId: string,
  actor: ScheduleActor,
  id: string
): Promise<boolean> {
  const rows = (await tx`
    DELETE FROM awcms_booking_schedule_exceptions
    WHERE tenant_id = ${tenantId} AND id = ${id}
    RETURNING kind,
      to_char(local_from, 'YYYY-MM-DD') AS local_from,
      to_char(local_to, 'YYYY-MM-DD') AS local_to
  `) as { kind: string; local_from: string; local_to: string }[];
  const row = rows[0];

  if (!row) {
    return false;
  }

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId,
    moduleKey: BOOKING_MODULE_KEY,
    action: BOOKING_AUDIT_EVENTS.scheduleChanged.action,
    resourceType: "booking_schedule_exception",
    resourceId: id,
    severity: BOOKING_AUDIT_EVENTS.scheduleChanged.severity,
    message: "Booking schedule exception deleted.",
    attributes: {
      change: "exception_deleted",
      kind: row.kind,
      localFrom: row.local_from,
      localTo: row.local_to
    },
    correlationId: actor.correlationId
  });

  return true;
}
