/**
 * Shift templates and shift assignments (Issue #946, ADR-0132,
 * `docs/awcms/hr-payroll.md` section 4.4).
 *
 * ## Time
 *
 * Instants are UTC and half-open `[startsAt, endsAt)`. Putting a template on a
 * local date resolves the wall clock to UTC ONCE, here, through the pure
 * `materialiseTemplate`, and stores the result with the zone it was resolved in;
 * editing the template afterwards never moves an assignment that exists.
 *
 * ## Concurrency
 *
 * Every writer of one employment's schedule takes the per-employment advisory
 * lock (`awcms_hr_lock_employment_schedule`, sql/184) BEFORE it looks for a
 * conflict and holds it to commit. The trigger takes the same lock, so a writer
 * that bypasses this file is serialised too and the second of two overlapping
 * writes is refused (`23P01`). This file pre-checks under the lock so the
 * refusal is a named outcome (`conflict`, with the other assignment's id) and
 * not a poisoned transaction.
 *
 * ## What is never here
 *
 * No reason, note or comment on an assignment, and no name: the audit rows carry
 * ids, the kind and the source only.
 */
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  keysetCursorCreatedAtSql,
  utcMicrosecondTextSql,
  type KeysetCursor
} from "../../_shared/keyset-pagination";
import { recordAuditEvent } from "../../logging/application/audit-log";
import { HR_WORKFORCE_MODULE_KEY } from "../domain/hr-workforce-permissions";
import { materialiseTemplate } from "../domain/hr-shift-time";
import type {
  ShiftKind,
  ShiftStatus,
  TimeOffKind
} from "../domain/hr-shift-types";
import type {
  CreateAssignmentInput,
  CreateTemplateInput,
  TemplateBreak,
  UpdateTemplateInput
} from "../domain/hr-shift-validation";

export const SHIFT_PAGE_SIZE = 100;

type Actor = {
  actorTenantUserId: string | null;
  correlationId: string | undefined;
};

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

// --- Shared checks --------------------------------------------------------------------

async function officeExists(
  tx: Bun.SQL,
  tenantId: string,
  officeId: string
): Promise<boolean> {
  const rows = (await tx`
    SELECT 1 AS present FROM awcms_offices
    WHERE tenant_id = ${tenantId} AND id = ${officeId} AND deleted_at IS NULL
  `) as { present: number }[];

  return rows.length > 0;
}

/** The same list the database trigger checks (`pg_timezone_names`), so a refusal is a 422 and not a poisoned transaction. */
async function zoneKnown(tx: Bun.SQL, zone: string): Promise<boolean> {
  const rows = (await tx`
    SELECT 1 AS present FROM pg_timezone_names WHERE name = ${zone}
  `) as { present: number }[];

  return rows.length > 0;
}

// --- Templates ------------------------------------------------------------------------

export type ShiftTemplate = {
  id: string;
  code: string;
  name: string;
  localStart: string;
  durationMinutes: number;
  breakOffsetMinutes: number | null;
  breakMinutes: number | null;
  timeZone: string;
  officeId: string | null;
  createdAt: string;
  deletedAt: string | null;
};

type TemplateRow = {
  id: string;
  code: string;
  name: string;
  local_start: string;
  duration_minutes: number;
  break_offset_minutes: number | null;
  break_minutes: number | null;
  time_zone: string;
  office_id: string | null;
  created_at: Date | string;
  deleted_at: Date | string | null;
};

const TEMPLATE_SELECT = `
  id, code, name, to_char(local_start, 'HH24:MI') AS local_start,
  duration_minutes, break_offset_minutes, break_minutes, time_zone, office_id,
  created_at, deleted_at`;

function mapTemplate(row: TemplateRow): ShiftTemplate {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    localStart: row.local_start,
    durationMinutes: row.duration_minutes,
    breakOffsetMinutes: row.break_offset_minutes,
    breakMinutes: row.break_minutes,
    timeZone: row.time_zone,
    officeId: row.office_id,
    createdAt: iso(row.created_at),
    deletedAt: row.deleted_at ? iso(row.deleted_at) : null
  };
}

export function parseShiftCursor(cursor: string): KeysetCursor | null {
  return decodeKeysetCursor(cursor);
}

export async function getTemplate(
  tx: Bun.SQL,
  tenantId: string,
  templateId: string,
  options: { includeDeleted?: boolean } = {}
): Promise<ShiftTemplate | null> {
  const includeDeleted = options.includeDeleted ?? false;
  const rows = (await tx`
    SELECT ${tx.unsafe(TEMPLATE_SELECT)} FROM awcms_hr_shift_templates
    WHERE tenant_id = ${tenantId} AND id = ${templateId}
      AND (${includeDeleted} OR deleted_at IS NULL)
  `) as TemplateRow[];

  return rows[0] ? mapTemplate(rows[0]) : null;
}

export async function listTemplates(
  tx: Bun.SQL,
  tenantId: string,
  cursor?: KeysetCursor
): Promise<{ templates: ShiftTemplate[]; nextCursor: string | null }> {
  const cursorCreatedAt = cursor ? cursor.createdAt : null;
  const cursorId = cursor ? cursor.id : null;
  const rows = (await tx`
    SELECT ${tx.unsafe(TEMPLATE_SELECT)},
           ${tx.unsafe(keysetCursorCreatedAtSql())} AS created_at_cursor
    FROM awcms_hr_shift_templates
    WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
      AND (
        ${cursorCreatedAt}::timestamptz IS NULL
        OR (created_at, id) < (${cursorCreatedAt}::timestamptz, ${cursorId}::uuid)
      )
    ORDER BY created_at DESC, id DESC
    LIMIT ${SHIFT_PAGE_SIZE}
  `) as (TemplateRow & { created_at_cursor: string })[];
  const last = rows[rows.length - 1];

  return {
    templates: rows.map(mapTemplate),
    nextCursor:
      rows.length === SHIFT_PAGE_SIZE && last
        ? encodeKeysetCursor(last.created_at_cursor, last.id)
        : null
  };
}

export type CreateTemplateOutcome =
  | { outcome: "ok"; template: ShiftTemplate }
  | { outcome: "duplicate_code" }
  | { outcome: "office_not_found" }
  | { outcome: "invalid_time_zone" };

export async function createTemplate(
  tx: Bun.SQL,
  tenantId: string,
  actor: Actor,
  input: CreateTemplateInput
): Promise<CreateTemplateOutcome> {
  if (input.officeId && !(await officeExists(tx, tenantId, input.officeId))) {
    return { outcome: "office_not_found" };
  }

  if (!(await zoneKnown(tx, input.timeZone))) {
    return { outcome: "invalid_time_zone" };
  }

  const inserted = (await tx`
    INSERT INTO awcms_hr_shift_templates
      (tenant_id, code, name, local_start, duration_minutes,
       break_offset_minutes, break_minutes, time_zone, office_id,
       created_by, updated_by)
    VALUES (${tenantId}, ${input.code}, ${input.name}, ${input.localStart}::time,
            ${input.durationMinutes}, ${input.break?.offsetMinutes ?? null},
            ${input.break?.minutes ?? null}, ${input.timeZone}, ${input.officeId},
            ${actor.actorTenantUserId}, ${actor.actorTenantUserId})
    ON CONFLICT DO NOTHING
    RETURNING id
  `) as { id: string }[];
  const id = inserted[0]?.id;

  if (!id) {
    return { outcome: "duplicate_code" };
  }

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: HR_WORKFORCE_MODULE_KEY,
    action: "hr_workforce.shift_template.created",
    resourceType: "hr_shift_template",
    resourceId: id,
    severity: "info",
    message: "Shift template created.",
    attributes: {},
    correlationId: actor.correlationId
  });

  return { outcome: "ok", template: (await getTemplate(tx, tenantId, id))! };
}

export type UpdateTemplateOutcome =
  | { outcome: "ok"; template: ShiftTemplate }
  | { outcome: "not_found" }
  | { outcome: "office_not_found" }
  | { outcome: "invalid_time_zone" }
  | { outcome: "invalid_break" };

export async function updateTemplate(
  tx: Bun.SQL,
  tenantId: string,
  templateId: string,
  actor: Actor,
  input: UpdateTemplateInput
): Promise<UpdateTemplateOutcome> {
  const locked = (await tx`
    SELECT ${tx.unsafe(TEMPLATE_SELECT)} FROM awcms_hr_shift_templates
    WHERE tenant_id = ${tenantId} AND id = ${templateId} AND deleted_at IS NULL
    FOR UPDATE
  `) as TemplateRow[];

  if (!locked[0]) {
    return { outcome: "not_found" };
  }

  const current = mapTemplate(locked[0]);
  const duration = input.durationMinutes ?? current.durationMinutes;
  const breakValue: TemplateBreak =
    input.break !== undefined
      ? input.break
      : current.breakMinutes !== null && current.breakOffsetMinutes !== null
        ? {
            offsetMinutes: current.breakOffsetMinutes,
            minutes: current.breakMinutes
          }
        : null;

  // A shorter shift must still contain the break it already had.
  if (breakValue && breakValue.offsetMinutes + breakValue.minutes > duration) {
    return { outcome: "invalid_break" };
  }

  const officeId =
    input.officeId !== undefined ? input.officeId : current.officeId;

  if (input.officeId && !(await officeExists(tx, tenantId, input.officeId))) {
    return { outcome: "office_not_found" };
  }

  const timeZone = input.timeZone ?? current.timeZone;

  if (input.timeZone && !(await zoneKnown(tx, input.timeZone))) {
    return { outcome: "invalid_time_zone" };
  }

  await tx`
    UPDATE awcms_hr_shift_templates
    SET name = ${input.name ?? current.name},
        local_start = ${input.localStart ?? current.localStart}::time,
        duration_minutes = ${duration},
        break_offset_minutes = ${breakValue?.offsetMinutes ?? null},
        break_minutes = ${breakValue?.minutes ?? null},
        time_zone = ${timeZone},
        office_id = ${officeId},
        updated_at = now(), updated_by = ${actor.actorTenantUserId}
    WHERE tenant_id = ${tenantId} AND id = ${templateId}
  `;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: HR_WORKFORCE_MODULE_KEY,
    action: "hr_workforce.shift_template.updated",
    resourceType: "hr_shift_template",
    resourceId: templateId,
    severity: "info",
    message: "Shift template updated.",
    attributes: { fields: Object.keys(input).sort() },
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    template: (await getTemplate(tx, tenantId, templateId))!
  };
}

export type DeleteTemplateOutcome =
  | { outcome: "ok"; template: ShiftTemplate }
  | { outcome: "not_found" }
  | { outcome: "already_deleted" };

export async function softDeleteTemplate(
  tx: Bun.SQL,
  tenantId: string,
  templateId: string,
  actor: Actor
): Promise<DeleteTemplateOutcome> {
  const rows = (await tx`
    SELECT deleted_at FROM awcms_hr_shift_templates
    WHERE tenant_id = ${tenantId} AND id = ${templateId}
    FOR UPDATE
  `) as { deleted_at: Date | null }[];

  if (!rows[0]) {
    return { outcome: "not_found" };
  }

  if (rows[0].deleted_at) {
    return { outcome: "already_deleted" };
  }

  await tx`
    UPDATE awcms_hr_shift_templates
    SET deleted_at = now(), deleted_by = ${actor.actorTenantUserId},
        updated_at = now(), updated_by = ${actor.actorTenantUserId}
    WHERE tenant_id = ${tenantId} AND id = ${templateId}
  `;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: HR_WORKFORCE_MODULE_KEY,
    action: "hr_workforce.shift_template.deleted",
    resourceType: "hr_shift_template",
    resourceId: templateId,
    severity: "warning",
    message: "Shift template soft-deleted.",
    attributes: {},
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    template: (await getTemplate(tx, tenantId, templateId, {
      includeDeleted: true
    }))!
  };
}

// --- Assignments ----------------------------------------------------------------------

export type ShiftAssignment = {
  id: string;
  employmentId: string;
  templateId: string | null;
  kind: ShiftKind;
  timeOffKind: TimeOffKind | null;
  startsAt: string;
  endsAt: string;
  breakStartsAt: string | null;
  breakEndsAt: string | null;
  timeZone: string;
  officeId: string | null;
  status: ShiftStatus;
  publishedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
};

type AssignmentRow = {
  id: string;
  employment_id: string;
  template_id: string | null;
  kind: ShiftKind;
  time_off_kind: TimeOffKind | null;
  starts_at: Date | string;
  ends_at: Date | string;
  break_starts_at: Date | string | null;
  break_ends_at: Date | string | null;
  time_zone: string;
  office_id: string | null;
  status: ShiftStatus;
  published_at: Date | string | null;
  cancelled_at: Date | string | null;
  created_at: Date | string;
};

const ASSIGNMENT_SELECT = `
  a.id, a.employment_id, a.template_id, a.kind, a.time_off_kind, a.starts_at,
  a.ends_at, a.break_starts_at, a.break_ends_at, a.time_zone, a.office_id,
  a.status, a.published_at, a.cancelled_at, a.created_at`;

function mapAssignment(row: AssignmentRow): ShiftAssignment {
  const optional = (value: Date | string | null) =>
    value === null ? null : iso(value);

  return {
    id: row.id,
    employmentId: row.employment_id,
    templateId: row.template_id,
    kind: row.kind,
    timeOffKind: row.time_off_kind,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    breakStartsAt: optional(row.break_starts_at),
    breakEndsAt: optional(row.break_ends_at),
    timeZone: row.time_zone,
    officeId: row.office_id,
    status: row.status,
    publishedAt: optional(row.published_at),
    cancelledAt: optional(row.cancelled_at),
    createdAt: iso(row.created_at)
  };
}

export async function getAssignment(
  tx: Bun.SQL,
  tenantId: string,
  assignmentId: string
): Promise<ShiftAssignment | null> {
  const rows = (await tx`
    SELECT ${tx.unsafe(ASSIGNMENT_SELECT)} FROM awcms_hr_shift_assignments a
    WHERE a.tenant_id = ${tenantId} AND a.id = ${assignmentId}
  `) as AssignmentRow[];

  return rows[0] ? mapAssignment(rows[0]) : null;
}

export type AssignmentListFilters = {
  employmentId?: string;
  /** Window: assignments overlapping `[from, to)`. */
  from?: Date;
  to?: Date;
  status?: ShiftStatus;
  /** Draft and cancelled rows are hidden: what an employee or a consumer may see. */
  publishedOnly?: boolean;
  /** When set, ONLY this login's own employment's assignments. */
  ownedByTenantUserId?: string;
};

/** Oldest start first, keyset on `(starts_at, id)`; the cursor's `createdAt` slot carries `starts_at`. */
export async function listAssignments(
  tx: Bun.SQL,
  tenantId: string,
  filters: AssignmentListFilters,
  cursor?: KeysetCursor
): Promise<{ assignments: ShiftAssignment[]; nextCursor: string | null }> {
  const employmentId = filters.employmentId ?? null;
  const from = filters.from ? filters.from.toISOString() : null;
  const to = filters.to ? filters.to.toISOString() : null;
  const status = filters.status ?? null;
  const publishedOnly = filters.publishedOnly ?? false;
  const owner = filters.ownedByTenantUserId ?? null;
  const cursorStart = cursor ? cursor.createdAt : null;
  const cursorId = cursor ? cursor.id : null;

  const rows = (await tx`
    SELECT ${tx.unsafe(ASSIGNMENT_SELECT)},
           ${tx.unsafe(utcMicrosecondTextSql("a.starts_at"))} AS starts_at_cursor
    FROM awcms_hr_shift_assignments a
    JOIN awcms_hr_employments e
      ON e.tenant_id = a.tenant_id AND e.id = a.employment_id
    WHERE a.tenant_id = ${tenantId}
      AND (${employmentId}::uuid IS NULL OR a.employment_id = ${employmentId}::uuid)
      AND (${from}::timestamptz IS NULL OR a.ends_at > ${from}::timestamptz)
      AND (${to}::timestamptz IS NULL OR a.starts_at < ${to}::timestamptz)
      AND (${status}::text IS NULL OR a.status = ${status}::text)
      AND (NOT ${publishedOnly} OR a.status = 'published')
      AND (${owner}::uuid IS NULL
           OR (e.tenant_user_id = ${owner}::uuid AND e.deleted_at IS NULL))
      AND (
        ${cursorStart}::timestamptz IS NULL
        OR (a.starts_at, a.id) > (${cursorStart}::timestamptz, ${cursorId}::uuid)
      )
    ORDER BY a.starts_at ASC, a.id ASC
    LIMIT ${SHIFT_PAGE_SIZE}
  `) as (AssignmentRow & { starts_at_cursor: string })[];
  const last = rows[rows.length - 1];

  return {
    assignments: rows.map(mapAssignment),
    nextCursor:
      rows.length === SHIFT_PAGE_SIZE && last
        ? encodeKeysetCursor(last.starts_at_cursor, last.id)
        : null
  };
}

type EmploymentGate = { deleted_at: Date | null };

export type CreateAssignmentOutcome =
  | { outcome: "ok"; assignment: ShiftAssignment }
  | { outcome: "employment_not_found" }
  | { outcome: "template_not_found" }
  | { outcome: "office_not_found" }
  | { outcome: "invalid_time_zone" }
  | { outcome: "conflict"; conflictingAssignmentId: string };

/**
 * Create a DRAFT assignment. A draft is invisible to every consumer of the
 * availability port until it is published, but it already counts for the
 * overlap rule, so two schedulers cannot both draft the same hour.
 */
export async function createAssignment(
  tx: Bun.SQL,
  tenantId: string,
  actor: Actor,
  input: CreateAssignmentInput
): Promise<CreateAssignmentOutcome> {
  const header = (await tx`
    SELECT deleted_at FROM awcms_hr_employments
    WHERE tenant_id = ${tenantId} AND id = ${input.employmentId}
  `) as EmploymentGate[];

  if (!header[0] || header[0].deleted_at) {
    return { outcome: "employment_not_found" };
  }

  let startsAt: Date;
  let endsAt: Date;
  let breakStartsAt: Date | null;
  let breakEndsAt: Date | null;
  let timeZone: string;
  let templateId: string | null = null;
  let officeId = input.officeId;

  if (input.source === "template") {
    const template = await getTemplate(tx, tenantId, input.templateId);

    if (!template) {
      return { outcome: "template_not_found" };
    }

    const shape = materialiseTemplate(
      {
        localStart: template.localStart,
        durationMinutes: template.durationMinutes,
        breakOffsetMinutes: template.breakOffsetMinutes,
        breakMinutes: template.breakMinutes,
        timeZone: template.timeZone
      },
      input.localDate
    );

    ({ startsAt, endsAt, breakStartsAt, breakEndsAt } = shape);
    timeZone = template.timeZone;
    templateId = template.id;
    officeId = officeId ?? template.officeId;
  } else {
    ({ startsAt, endsAt, breakStartsAt, breakEndsAt, timeZone } = input);

    if (!(await zoneKnown(tx, timeZone))) {
      return { outcome: "invalid_time_zone" };
    }
  }

  if (officeId && !(await officeExists(tx, tenantId, officeId))) {
    return { outcome: "office_not_found" };
  }

  // Lock, THEN look: see the header. The trigger re-takes the same lock.
  await tx`SELECT awcms_hr_lock_employment_schedule(${tenantId}::uuid, ${input.employmentId}::uuid)`;

  const conflict = (await tx`
    SELECT awcms_hr_shift_conflict(
      ${tenantId}::uuid, ${input.employmentId}::uuid, gen_random_uuid(),
      ${startsAt.toISOString()}::timestamptz, ${endsAt.toISOString()}::timestamptz
    ) AS id
  `) as { id: string | null }[];

  if (conflict[0]?.id) {
    return { outcome: "conflict", conflictingAssignmentId: conflict[0].id };
  }

  const inserted = (await tx`
    INSERT INTO awcms_hr_shift_assignments
      (tenant_id, employment_id, template_id, kind, time_off_kind, starts_at,
       ends_at, break_starts_at, break_ends_at, time_zone, office_id, created_by)
    VALUES (${tenantId}, ${input.employmentId}, ${templateId}, ${input.kind},
            ${input.timeOffKind}, ${startsAt.toISOString()}::timestamptz,
            ${endsAt.toISOString()}::timestamptz,
            ${breakStartsAt ? breakStartsAt.toISOString() : null}::timestamptz,
            ${breakEndsAt ? breakEndsAt.toISOString() : null}::timestamptz,
            ${timeZone}, ${officeId}, ${actor.actorTenantUserId})
    RETURNING id
  `) as { id: string }[];
  const id = inserted[0]!.id;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: HR_WORKFORCE_MODULE_KEY,
    action: "hr_workforce.shift.created",
    resourceType: "hr_shift_assignment",
    resourceId: id,
    severity: "info",
    message: "Shift assignment drafted.",
    attributes: { kind: input.kind, source: input.source },
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    assignment: (await getAssignment(tx, tenantId, id))!
  };
}

type LockedAssignment = {
  id: string;
  employment_id: string;
  status: ShiftStatus;
  kind: ShiftKind;
  employment_deleted_at: Date | null;
};

async function lockAssignment(
  tx: Bun.SQL,
  tenantId: string,
  assignmentId: string
): Promise<LockedAssignment | null> {
  const rows = (await tx`
    SELECT a.id, a.employment_id, a.status, a.kind,
           e.deleted_at AS employment_deleted_at
    FROM awcms_hr_shift_assignments a
    JOIN awcms_hr_employments e
      ON e.tenant_id = a.tenant_id AND e.id = a.employment_id
    WHERE a.tenant_id = ${tenantId} AND a.id = ${assignmentId}
    FOR UPDATE OF a
  `) as LockedAssignment[];

  return rows[0] ?? null;
}

export type PublishOutcome =
  | { outcome: "ok"; assignment: ShiftAssignment }
  | { outcome: "not_found" }
  | { outcome: "not_draft"; status: ShiftStatus }
  | { outcome: "employment_deleted" };

/** draft -> published. Only a published assignment is visible to `StaffAvailabilityPort`. */
export async function publishAssignment(
  tx: Bun.SQL,
  tenantId: string,
  assignmentId: string,
  actor: Actor
): Promise<PublishOutcome> {
  const row = await lockAssignment(tx, tenantId, assignmentId);

  if (!row) {
    return { outcome: "not_found" };
  }

  if (row.status !== "draft") {
    return { outcome: "not_draft", status: row.status };
  }

  if (row.employment_deleted_at) {
    return { outcome: "employment_deleted" };
  }

  await tx`
    UPDATE awcms_hr_shift_assignments
    SET status = 'published', published_at = now(),
        published_by = ${actor.actorTenantUserId}, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${assignmentId}
  `;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: HR_WORKFORCE_MODULE_KEY,
    action: "hr_workforce.shift.published",
    resourceType: "hr_shift_assignment",
    resourceId: assignmentId,
    severity: "info",
    message: "Shift assignment published.",
    attributes: { kind: row.kind, employmentId: row.employment_id },
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    assignment: (await getAssignment(tx, tenantId, assignmentId))!
  };
}

export type CancelOutcome =
  | { outcome: "ok"; assignment: ShiftAssignment }
  | { outcome: "not_found" }
  | { outcome: "already_cancelled" };

/** draft or published -> cancelled (terminal). A published assignment is cancelled, never deleted. */
export async function cancelAssignment(
  tx: Bun.SQL,
  tenantId: string,
  assignmentId: string,
  actor: Actor
): Promise<CancelOutcome> {
  const row = await lockAssignment(tx, tenantId, assignmentId);

  if (!row) {
    return { outcome: "not_found" };
  }

  if (row.status === "cancelled") {
    return { outcome: "already_cancelled" };
  }

  await tx`
    UPDATE awcms_hr_shift_assignments
    SET status = 'cancelled', cancelled_at = now(),
        cancelled_by = ${actor.actorTenantUserId}, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${assignmentId}
  `;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: HR_WORKFORCE_MODULE_KEY,
    action: "hr_workforce.shift.cancelled",
    resourceType: "hr_shift_assignment",
    resourceId: assignmentId,
    severity: "warning",
    message: "Shift assignment cancelled.",
    attributes: {
      kind: row.kind,
      employmentId: row.employment_id,
      wasPublished: row.status === "published"
    },
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    assignment: (await getAssignment(tx, tenantId, assignmentId))!
  };
}
