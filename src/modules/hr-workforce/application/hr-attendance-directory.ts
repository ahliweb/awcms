/**
 * Attendance events and corrections (Issue #947, ADR-0132,
 * `docs/awcms/hr-payroll.md` section 4.2).
 *
 * ## What is the database's job and what is this file's
 *
 * The database decides every rule that must hold for ANY writer: the append-only
 * privilege and trigger, the server clock, the skew and back-dating bounds, replay
 * by `client_event_key`, the supersession gate, the correction status machine and
 * the segregation of duties (`sql/198`). This file maps a refusal to a NAMED
 * outcome (each risky write runs in a savepoint, so the refusal does not poison
 * the request's transaction) and does the reading: who may see which rows.
 *
 * ## Who sees what
 *
 * Three ways to read, and the route chooses one:
 *
 *   * `all`     — the caller holds the read permission: every row in the tenant.
 *   * `mine`    — an `ownershipGrant` (ADR-0063) on the persisted login link: the
 *                 caller's OWN employments (every live one, terminated ones
 *                 included: an ex-employee, or a rehired one, reads their whole
 *                 own history, the old employment and the current one alike).
 *   * `reports` — an `ownershipGrant` on the CURRENT manager chain: the live
 *                 employments below the caller's own live, non-terminated
 *                 employment (`awcms_hr_report_ids`, bounded to ten levels, and
 *                 it neither returns nor walks through a soft-deleted employment).
 *
 * ## What is never here
 *
 * No location, device or network value. The correction `reason` is selected only
 * when the caller is allowed to see it and is never passed to an audit row, an
 * event or the workflow store: the workflow instance is started with NO facts.
 */
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  utcMicrosecondTextSql,
  type KeysetCursor
} from "../../_shared/keyset-pagination";
import { resolveModuleEnabled } from "../../identity-access/application/auth-context";
import { recordAuditEvent } from "../../logging/application/audit-log";
import {
  InvalidWorkflowFactsError,
  startWorkflowInstance,
  WorkflowDefinitionNotActiveError
} from "../../workflow-approval/application/workflow-instance";
import {
  cancelWorkflowInstance,
  WorkflowRecoveryError
} from "../../workflow-approval/application/workflow-recovery";
import { HR_WORKFORCE_MODULE_KEY } from "../domain/hr-workforce-permissions";
import {
  attendanceEventIsAudited,
  CORRECTION_RESOURCE_TYPE,
  type AttendanceKind,
  type AttendanceSource,
  type CorrectionKind,
  type CorrectionStatus
} from "../domain/hr-attendance-types";
import type {
  CreateAttendanceEventInput,
  CreateCorrectionInput
} from "../domain/hr-attendance-validation";
import { readSettings } from "./hr-workforce-directory";

export const ATTENDANCE_PAGE_SIZE = 100;

type Actor = {
  actorTenantUserId: string | null;
  correlationId: string | undefined;
};

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();
const optional = (value: Date | string | null): string | null =>
  value === null ? null : iso(value);

export function parseAttendanceCursor(cursor: string): KeysetCursor | null {
  return decodeKeysetCursor(cursor);
}

// --- Visibility ------------------------------------------------------------------

/** How a read is restricted. `all` is the permission; the others are ownership grants. */
export type ReadBasis =
  | { mode: "all" }
  | { mode: "mine"; tenantUserId: string }
  | { mode: "reports"; tenantUserId: string };

/**
 * Every live (not soft-deleted) employment of the caller, terminated ones
 * included, newest first. A person who was rehired has an old, terminated
 * employment and a current one, and `mine` covers BOTH: the ownership grant is
 * the persisted login link, so an old employment stays theirs to read. Empty for
 * a login linked to no employment.
 */
export async function callerEmploymentIds(
  tx: Bun.SQL,
  tenantId: string,
  tenantUserId: string
): Promise<string[]> {
  const rows = (await tx`
    SELECT id
    FROM awcms_hr_employments
    WHERE tenant_id = ${tenantId} AND tenant_user_id = ${tenantUserId}
      AND deleted_at IS NULL
    ORDER BY created_at DESC, id DESC
  `) as { id: string }[];

  return rows.map((row) => row.id);
}

/**
 * The employment ids a `reports` read covers: the live employments below the
 * caller's own live, NON-terminated employment. Empty for a caller who has no
 * such employment (a terminated manager supervises nobody).
 */
export async function reportIdsOf(
  tx: Bun.SQL,
  tenantId: string,
  tenantUserId: string
): Promise<string[]> {
  const rows = (await tx`
    SELECT r.employment_id AS id
    FROM awcms_hr_employments m
    CROSS JOIN LATERAL awcms_hr_report_ids(m.tenant_id, m.id) r
    WHERE m.tenant_id = ${tenantId} AND m.tenant_user_id = ${tenantUserId}
      AND m.deleted_at IS NULL AND m.terminated_on IS NULL
  `) as { id: string }[];

  return rows.map((row) => row.id);
}

/**
 * Whether the employment is within a basis: the caller's own, or one of their
 * reports. Used by the `ownershipGrant` of a by-id read and for the 403 a list
 * gives when a filter names someone outside it.
 */
export async function employmentWithinBasis(
  tx: Bun.SQL,
  tenantId: string,
  employmentId: string,
  basis: ReadBasis
): Promise<boolean> {
  if (basis.mode === "all") {
    return true;
  }

  if (basis.mode === "mine") {
    return (
      await callerEmploymentIds(tx, tenantId, basis.tenantUserId)
    ).includes(employmentId);
  }

  return (await reportIdsOf(tx, tenantId, basis.tenantUserId)).includes(
    employmentId
  );
}

/** The employment is the caller's own (any state short of soft-deleted). */
export async function employmentIsCallers(
  tx: Bun.SQL,
  tenantId: string,
  employmentId: string,
  tenantUserId: string
): Promise<boolean> {
  const rows = (await tx`
    SELECT 1 AS owned FROM awcms_hr_employments
    WHERE tenant_id = ${tenantId} AND id = ${employmentId}
      AND tenant_user_id = ${tenantUserId} AND deleted_at IS NULL
  `) as { owned: number }[];

  return rows.length > 0;
}

/** SQL fragment source for the employment filter of a basis; the ids are bound, never interpolated. */
async function basisEmploymentIds(
  tx: Bun.SQL,
  tenantId: string,
  basis: ReadBasis
): Promise<string[] | null> {
  if (basis.mode === "all") {
    return null;
  }

  if (basis.mode === "mine") {
    return callerEmploymentIds(tx, tenantId, basis.tenantUserId);
  }

  return reportIdsOf(tx, tenantId, basis.tenantUserId);
}

// --- Events ----------------------------------------------------------------------

export type AttendanceEvent = {
  id: string;
  employmentId: string;
  kind: AttendanceKind;
  occurredAt: string;
  recordedAt: string;
  source: AttendanceSource;
  clientEventKey: string;
  officeId: string | null;
  supersedesEventId: string | null;
  supersededByEventId: string | null;
  correctionId: string | null;
  late: boolean;
};

type EventRow = {
  id: string;
  employment_id: string;
  kind: AttendanceKind;
  occurred_at: Date | string;
  recorded_at: Date | string;
  source: AttendanceSource;
  client_event_key: string;
  office_id: string | null;
  supersedes_event_id: string | null;
  superseded_by: string | null;
  correction_id: string | null;
  late: boolean;
};

const EVENT_SELECT = `
  e.id, e.employment_id, e.kind, e.occurred_at, e.recorded_at, e.source,
  e.client_event_key, e.office_id, e.supersedes_event_id, e.correction_id, e.late,
  (SELECT s.id FROM awcms_hr_attendance_events s
    WHERE s.tenant_id = e.tenant_id AND s.supersedes_event_id = e.id) AS superseded_by`;

function mapEvent(row: EventRow): AttendanceEvent {
  return {
    id: row.id,
    employmentId: row.employment_id,
    kind: row.kind,
    occurredAt: iso(row.occurred_at),
    recordedAt: iso(row.recorded_at),
    source: row.source,
    clientEventKey: row.client_event_key,
    officeId: row.office_id,
    supersedesEventId: row.supersedes_event_id,
    supersededByEventId: row.superseded_by,
    correctionId: row.correction_id,
    late: row.late
  };
}

export async function getEvent(
  tx: Bun.SQL,
  tenantId: string,
  eventId: string
): Promise<AttendanceEvent | null> {
  const rows = (await tx`
    SELECT ${tx.unsafe(EVENT_SELECT)} FROM awcms_hr_attendance_events e
    WHERE e.tenant_id = ${tenantId} AND e.id = ${eventId}
  `) as EventRow[];

  return rows[0] ? mapEvent(rows[0]) : null;
}

export type EventListFilters = {
  employmentId?: string;
  /** Window on the CLAIMED instant: `from` inclusive, `to` exclusive. */
  from?: Date;
  to?: Date;
  /** Hide events a later correction replaced: the effective record. */
  effectiveOnly?: boolean;
};

/** Newest claimed instant first, keyset on `(occurred_at, id)`; the cursor's `createdAt` slot carries `occurred_at`. */
export async function listEvents(
  tx: Bun.SQL,
  tenantId: string,
  basis: ReadBasis,
  filters: EventListFilters,
  cursor?: KeysetCursor
): Promise<{ events: AttendanceEvent[]; nextCursor: string | null }> {
  const scope = await basisEmploymentIds(tx, tenantId, basis);

  if (scope !== null && scope.length === 0) {
    return { events: [], nextCursor: null };
  }

  const employmentId = filters.employmentId ?? null;
  const from = filters.from ? filters.from.toISOString() : null;
  const to = filters.to ? filters.to.toISOString() : null;
  const effectiveOnly = filters.effectiveOnly ?? false;
  const cursorAt = cursor ? cursor.createdAt : null;
  const cursorId = cursor ? cursor.id : null;
  // The ids travel as ONE jsonb parameter (the JS array itself, never a
  // JSON.stringify string, which Bun.SQL stores as a jsonb string scalar); a bare
  // `${array}` binding arrives as comma-joined text. NULL = no restriction.
  const scopeJson = scope;

  const rows = (await tx`
    SELECT ${tx.unsafe(EVENT_SELECT)},
           ${tx.unsafe(utcMicrosecondTextSql("e.occurred_at"))} AS occurred_at_cursor
    FROM awcms_hr_attendance_events e
    WHERE e.tenant_id = ${tenantId}
      AND (${scopeJson}::jsonb IS NULL
           OR e.employment_id IN (
                SELECT jsonb_array_elements_text(${scopeJson}::jsonb)::uuid))
      AND (${employmentId}::uuid IS NULL OR e.employment_id = ${employmentId}::uuid)
      AND (${from}::timestamptz IS NULL OR e.occurred_at >= ${from}::timestamptz)
      AND (${to}::timestamptz IS NULL OR e.occurred_at < ${to}::timestamptz)
      AND (NOT ${effectiveOnly} OR NOT EXISTS (
            SELECT 1 FROM awcms_hr_attendance_events s
             WHERE s.tenant_id = e.tenant_id AND s.supersedes_event_id = e.id))
      AND (
        ${cursorAt}::timestamptz IS NULL
        OR (e.occurred_at, e.id) < (${cursorAt}::timestamptz, ${cursorId}::uuid)
      )
    ORDER BY e.occurred_at DESC, e.id DESC
    LIMIT ${ATTENDANCE_PAGE_SIZE}
  `) as (EventRow & { occurred_at_cursor: string })[];
  const last = rows[rows.length - 1];

  return {
    events: rows.map(mapEvent),
    nextCursor:
      rows.length === ATTENDANCE_PAGE_SIZE && last
        ? encodeKeysetCursor(last.occurred_at_cursor, last.id)
        : null
  };
}

export type RecordEventOutcome =
  | { outcome: "ok"; event: AttendanceEvent; replayed: boolean }
  | { outcome: "employment_not_found" }
  | { outcome: "office_not_found" }
  | { outcome: "key_conflict" }
  | { outcome: "refused"; reason: EventRefusal };

export type EventRefusal =
  | "target_superseded"
  | "future"
  | "backdated"
  | "too_old"
  | "employment_terminated"
  | "employment_deleted";

/**
 * The correction guard's own refusals, which repeat what `settleCorrection`
 * checked: a divergence between the two is a named refusal, never a 500.
 */
export type CorrectionGuardRefusal =
  "self_approval" | "no_approver" | "verdict_mismatch";

type Refusal = EventRefusal | CorrectionGuardRefusal;

const EVENT_REFUSAL_TAGS: readonly [string, Refusal][] = [
  // Another correction superseded the same event between the check and the
  // insert: the one-superseder unique index is the arbiter.
  ["awcms_hr_attendance_events_one_superseder", "target_superseded"],
  ["HR_ATTENDANCE_FUTURE", "future"],
  ["HR_ATTENDANCE_BACKDATED", "backdated"],
  ["HR_ATTENDANCE_TOO_OLD", "too_old"],
  ["HR_EMPLOYMENT_TERMINATED", "employment_terminated"],
  ["HR_EMPLOYMENT_DELETED", "employment_deleted"],
  ["HR_CORRECTION_SELF_APPROVAL", "self_approval"],
  ["HR_CORRECTION_NO_APPROVER", "no_approver"],
  ["HR_CORRECTION_VERDICT_MISMATCH", "verdict_mismatch"]
];

/** The named refusal a database error carries, or `null` for any other error. */
export function refusalOf(error: unknown): Refusal | null {
  const text = error instanceof Error ? error.message : "";

  return EVENT_REFUSAL_TAGS.find(([tag]) => text.includes(tag))?.[1] ?? null;
}

/**
 * Record one event. A replay of the same `clientEventKey` for the same employment
 * returns the ORIGINAL (`replayed: true`) — an offline queue posts each event once —
 * provided it names the same kind, instant and source; a different one under a used
 * key is a `key_conflict`. The caller has already established WHO may record for
 * WHOM (the route); the database decides whether the claimed time is acceptable.
 */
export async function recordEvent(
  tx: Bun.TransactionSQL,
  tenantId: string,
  actor: Actor,
  input: CreateAttendanceEventInput
): Promise<RecordEventOutcome> {
  const header = (await tx`
    SELECT deleted_at FROM awcms_hr_employments
    WHERE tenant_id = ${tenantId} AND id = ${input.employmentId}
  `) as { deleted_at: Date | null }[];

  if (!header[0] || header[0].deleted_at) {
    return { outcome: "employment_not_found" };
  }

  if (input.officeId) {
    const office = (await tx`
      SELECT 1 AS present FROM awcms_offices
      WHERE tenant_id = ${tenantId} AND id = ${input.officeId}
        AND deleted_at IS NULL
    `) as { present: number }[];

    if (office.length === 0) {
      return { outcome: "office_not_found" };
    }
  }

  const existing = await findByKey(
    tx,
    tenantId,
    input.employmentId,
    input.clientEventKey
  );

  if (existing) {
    return replayOutcome(existing, input);
  }

  const attempt = await guarded(tx, async (sp) => {
    const rows = (await sp`
      INSERT INTO awcms_hr_attendance_events
        (tenant_id, employment_id, kind, occurred_at, source, client_event_key,
         office_id, recorded_by)
      VALUES (${tenantId}, ${input.employmentId}, ${input.kind},
              ${input.occurredAt.toISOString()}::timestamptz, ${input.source},
              ${input.clientEventKey}, ${input.officeId},
              ${actor.actorTenantUserId})
      ON CONFLICT (tenant_id, employment_id, client_event_key) DO NOTHING
      RETURNING id
    `) as { id: string }[];

    return rows[0]?.id ?? null;
  });

  if (!attempt.ok) {
    // The correction guard does not run on a recorded (non-correction) event.
    if (
      attempt.reason === "self_approval" ||
      attempt.reason === "no_approver" ||
      attempt.reason === "verdict_mismatch"
    ) {
      throw new Error(
        `Unexpected refusal ${attempt.reason} recording an event.`
      );
    }

    return { outcome: "refused", reason: attempt.reason };
  }

  if (attempt.value === null) {
    // A concurrent writer of the same key committed first: return its row.
    const winner = await findByKey(
      tx,
      tenantId,
      input.employmentId,
      input.clientEventKey
    );

    return winner ? replayOutcome(winner, input) : { outcome: "key_conflict" };
  }

  const event = (await getEvent(tx, tenantId, attempt.value))!;

  // A person recording FOR someone else, or a stale replay, leaves a trace
  // (ADR-0132 follow-up, #998). `self` and a punctual kiosk/import tap stay
  // un-audited: high volume, and the event is the record. NEVER a location,
  // device or free text: ids and classifications only (the claimed instant is on
  // the event row the audit row names; the audit stays free of any instant).
  if (attendanceEventIsAudited(event.source, event.late)) {
    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: actor.actorTenantUserId ?? undefined,
      moduleKey: HR_WORKFORCE_MODULE_KEY,
      action: "hr_workforce.attendance_event.recorded_for_other",
      resourceType: "hr_attendance_event",
      resourceId: event.id,
      severity: event.late ? "warning" : "info",
      message: "Attendance event recorded on behalf of an employment.",
      attributes: {
        employmentId: event.employmentId,
        kind: event.kind,
        source: event.source,
        late: event.late
      },
      correlationId: actor.correlationId
    });
  }

  return { outcome: "ok", event, replayed: false };
}

async function findByKey(
  tx: Bun.SQL,
  tenantId: string,
  employmentId: string,
  clientEventKey: string
): Promise<AttendanceEvent | null> {
  const rows = (await tx`
    SELECT ${tx.unsafe(EVENT_SELECT)} FROM awcms_hr_attendance_events e
    WHERE e.tenant_id = ${tenantId} AND e.employment_id = ${employmentId}
      AND e.client_event_key = ${clientEventKey}
  `) as EventRow[];

  return rows[0] ? mapEvent(rows[0]) : null;
}

function replayOutcome(
  existing: AttendanceEvent,
  input: CreateAttendanceEventInput
): RecordEventOutcome {
  const same =
    existing.kind === input.kind &&
    existing.source === input.source &&
    new Date(existing.occurredAt).getTime() === input.occurredAt.getTime();

  return same
    ? { outcome: "ok", event: existing, replayed: true }
    : { outcome: "key_conflict" };
}

/**
 * Runs `work` in a savepoint. A database refusal that names one of the event
 * guards is returned as a value and the request's transaction stays usable; any
 * other error propagates.
 */
async function guarded<T>(
  tx: Bun.TransactionSQL,
  work: (sp: Bun.SQL) => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; reason: Refusal }> {
  try {
    return { ok: true, value: await tx.savepoint((sp) => work(sp)) };
  } catch (error) {
    const reason = refusalOf(error);

    if (reason) {
      return { ok: false, reason };
    }

    throw error;
  }
}

// --- Corrections -----------------------------------------------------------------

export type AttendanceCorrection = {
  id: string;
  employmentId: string;
  kind: CorrectionKind;
  targetEventId: string | null;
  proposedKind: AttendanceKind;
  proposedOccurredAt: string;
  status: CorrectionStatus;
  workflowInstanceId: string;
  requestedBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  /** The event an approval appended, once it has. */
  appliedEventId: string | null;
  /** Present only on the single-correction READ and only for a caller who may see it (the requester, a workflow assignee, a `corrections.read` holder); no write response carries it. */
  reason?: string;
};

type CorrectionRow = {
  id: string;
  employment_id: string;
  kind: CorrectionKind;
  target_event_id: string | null;
  proposed_kind: AttendanceKind;
  proposed_occurred_at: Date | string;
  status: CorrectionStatus;
  workflow_instance_id: string;
  requested_by: string;
  decided_by: string | null;
  decided_at: Date | string | null;
  created_at: Date | string;
  applied_event_id: string | null;
  reason?: string;
};

const CORRECTION_SELECT = `
  c.id, c.employment_id, c.kind, c.target_event_id, c.proposed_kind,
  c.proposed_occurred_at, c.status, c.workflow_instance_id, c.requested_by,
  c.decided_by, c.decided_at, c.created_at,
  (SELECT ev.id FROM awcms_hr_attendance_events ev
    WHERE ev.tenant_id = c.tenant_id AND ev.correction_id = c.id) AS applied_event_id`;

function mapCorrection(
  row: CorrectionRow,
  includeReason: boolean
): AttendanceCorrection {
  return {
    id: row.id,
    employmentId: row.employment_id,
    kind: row.kind,
    targetEventId: row.target_event_id,
    proposedKind: row.proposed_kind,
    proposedOccurredAt: iso(row.proposed_occurred_at),
    status: row.status,
    workflowInstanceId: row.workflow_instance_id,
    requestedBy: row.requested_by,
    decidedBy: row.decided_by,
    decidedAt: optional(row.decided_at),
    createdAt: iso(row.created_at),
    appliedEventId: row.applied_event_id,
    ...(includeReason && row.reason !== undefined ? { reason: row.reason } : {})
  };
}

/** The reason column is selected ONLY when the caller may see it, so it is not even read otherwise. */
export async function getCorrection(
  tx: Bun.SQL,
  tenantId: string,
  correctionId: string,
  options: { includeReason: boolean }
): Promise<AttendanceCorrection | null> {
  const reasonSql = options.includeReason ? ", c.reason" : "";
  const rows = (await tx`
    SELECT ${tx.unsafe(CORRECTION_SELECT + reasonSql)}
    FROM awcms_hr_attendance_corrections c
    WHERE c.tenant_id = ${tenantId} AND c.id = ${correctionId}
  `) as CorrectionRow[];

  return rows[0] ? mapCorrection(rows[0], options.includeReason) : null;
}

/** The facts the route needs to decide visibility, with no reason in them. */
export async function correctionAccessFacts(
  tx: Bun.SQL,
  tenantId: string,
  correctionId: string,
  tenantUserId: string
): Promise<{
  employmentId: string;
  requestedBy: string;
  isAssignee: boolean;
  /** The approval instance's own status (`pending`, `approved`, `rejected`, `cancelled`), or null when the row is not visible. */
  instanceStatus: string | null;
} | null> {
  const rows = (await tx`
    SELECT c.employment_id, c.requested_by,
           (SELECT i.status FROM awcms_workflow_instances i
             WHERE i.tenant_id = c.tenant_id AND i.id = c.workflow_instance_id
           ) AS instance_status,
           EXISTS (
             SELECT 1
             FROM awcms_workflow_tasks t
             JOIN awcms_workflow_task_assignments a
               ON a.tenant_id = t.tenant_id AND a.workflow_task_id = t.id
             WHERE t.tenant_id = c.tenant_id
               AND t.workflow_instance_id = c.workflow_instance_id
               AND a.tenant_user_id = ${tenantUserId}
               AND a.status IN ('pending', 'decided')
           ) AS is_assignee
    FROM awcms_hr_attendance_corrections c
    WHERE c.tenant_id = ${tenantId} AND c.id = ${correctionId}
  `) as {
    employment_id: string;
    requested_by: string;
    is_assignee: boolean;
    instance_status: string | null;
  }[];

  return rows[0]
    ? {
        employmentId: rows[0].employment_id,
        requestedBy: rows[0].requested_by,
        isAssignee: rows[0].is_assignee,
        instanceStatus: rows[0].instance_status
      }
    : null;
}

export type CorrectionListFilters = {
  employmentId?: string;
  status?: CorrectionStatus;
};

/** Newest first, keyset on `(created_at, id)`. The LIST never carries the reason. */
export async function listCorrections(
  tx: Bun.SQL,
  tenantId: string,
  basis: ReadBasis,
  filters: CorrectionListFilters,
  cursor?: KeysetCursor
): Promise<{ corrections: AttendanceCorrection[]; nextCursor: string | null }> {
  const scope = await basisEmploymentIds(tx, tenantId, basis);

  if (scope !== null && scope.length === 0) {
    return { corrections: [], nextCursor: null };
  }

  const employmentId = filters.employmentId ?? null;
  const status = filters.status ?? null;
  const cursorAt = cursor ? cursor.createdAt : null;
  const cursorId = cursor ? cursor.id : null;
  const scopeJson = scope;

  const rows = (await tx`
    SELECT ${tx.unsafe(CORRECTION_SELECT)},
           ${tx.unsafe(utcMicrosecondTextSql("c.created_at"))} AS created_at_cursor
    FROM awcms_hr_attendance_corrections c
    WHERE c.tenant_id = ${tenantId}
      AND (${scopeJson}::jsonb IS NULL
           OR c.employment_id IN (
                SELECT jsonb_array_elements_text(${scopeJson}::jsonb)::uuid))
      AND (${employmentId}::uuid IS NULL OR c.employment_id = ${employmentId}::uuid)
      AND (${status}::text IS NULL OR c.status = ${status}::text)
      AND (
        ${cursorAt}::timestamptz IS NULL
        OR (c.created_at, c.id) < (${cursorAt}::timestamptz, ${cursorId}::uuid)
      )
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT ${ATTENDANCE_PAGE_SIZE}
  `) as (CorrectionRow & { created_at_cursor: string })[];
  const last = rows.length > 0 ? rows[rows.length - 1] : undefined;

  return {
    corrections: rows.map((row) => mapCorrection(row, false)),
    nextCursor:
      rows.length === ATTENDANCE_PAGE_SIZE && last
        ? encodeKeysetCursor(last.created_at_cursor, last.id)
        : null
  };
}

export type CreateCorrectionOutcome =
  | { outcome: "ok"; correction: AttendanceCorrection }
  | { outcome: "employment_not_found" }
  | { outcome: "proposed_in_future" }
  | { outcome: "target_not_found" }
  | { outcome: "target_superseded" }
  | { outcome: "target_already_pending" }
  | { outcome: "approval_workflow_not_configured" }
  | { outcome: "approval_facts_invalid"; errors: unknown };

/**
 * Propose a correction and start its approval instance, in one transaction.
 * Approval is REQUIRED and fail-closed: with the `workflow` module off for the
 * tenant, or no published definition under the tenant's correction workflow key,
 * nothing is created. The instance is started with NO facts, so neither the
 * reason nor the proposed time enters the workflow store.
 *
 * A proposed instant further in the future than the tenant's clock-skew bound is
 * refused HERE (`proposed_in_future`), by the same rule the event guard applies
 * (`sql/198`): otherwise approval could never append the event (the guard would
 * refuse it at settle) and the correction would sit pending for good. The bound
 * is checked against the request's `now`, and time only moves forward, so what
 * passes here is not future at settle either.
 */
export async function createCorrection(
  tx: Bun.TransactionSQL,
  tenantId: string,
  actor: Actor,
  input: CreateCorrectionInput,
  now: Date
): Promise<CreateCorrectionOutcome> {
  if (!actor.actorTenantUserId) {
    return { outcome: "approval_workflow_not_configured" };
  }

  const header = (await tx`
    SELECT deleted_at FROM awcms_hr_employments
    WHERE tenant_id = ${tenantId} AND id = ${input.employmentId}
  `) as { deleted_at: Date | null }[];

  if (!header[0] || header[0].deleted_at) {
    return { outcome: "employment_not_found" };
  }

  const settings = await readSettings(tx, tenantId);

  if (
    input.proposedOccurredAt.getTime() >
    now.getTime() + settings.clockSkewSeconds * 1000
  ) {
    return { outcome: "proposed_in_future" };
  }

  if (input.targetEventId) {
    const target = (await tx`
      SELECT e.employment_id,
             EXISTS (SELECT 1 FROM awcms_hr_attendance_events s
                      WHERE s.tenant_id = e.tenant_id
                        AND s.supersedes_event_id = e.id) AS superseded
      FROM awcms_hr_attendance_events e
      WHERE e.tenant_id = ${tenantId} AND e.id = ${input.targetEventId}
    `) as { employment_id: string; superseded: boolean }[];

    // Another employment's event is "not found", not a different message: the
    // refusal must not say that the id exists.
    if (!target[0] || target[0].employment_id !== input.employmentId) {
      return { outcome: "target_not_found" };
    }

    if (target[0].superseded) {
      return { outcome: "target_superseded" };
    }

    const pending = (await tx`
      SELECT 1 AS present FROM awcms_hr_attendance_corrections
      WHERE tenant_id = ${tenantId} AND target_event_id = ${input.targetEventId}
        AND status = 'pending'
    `) as { present: number }[];

    if (pending.length > 0) {
      return { outcome: "target_already_pending" };
    }
  }

  if (!(await resolveModuleEnabled(tx, tenantId, "workflow"))) {
    return { outcome: "approval_workflow_not_configured" };
  }

  const correctionId = crypto.randomUUID();

  type Attempt =
    | { kind: "ok" }
    | { kind: "not_configured" }
    | { kind: "facts_invalid"; errors: unknown }
    | { kind: "pending_target" };

  let attempt: Attempt;

  try {
    attempt = await tx.savepoint(async (sp): Promise<Attempt> => {
      let instanceId: string;

      try {
        const workflow = await startWorkflowInstance(sp, {
          tenantId,
          workflowKey: settings.correctionWorkflowKey,
          resourceType: CORRECTION_RESOURCE_TYPE,
          resourceId: correctionId,
          requestedByTenantUserId: actor.actorTenantUserId!,
          now,
          correlationId: actor.correlationId
        });

        instanceId = workflow.instanceId;
      } catch (error) {
        if (error instanceof WorkflowDefinitionNotActiveError) {
          return { kind: "not_configured" };
        }

        if (error instanceof InvalidWorkflowFactsError) {
          return { kind: "facts_invalid", errors: error.errors };
        }

        throw error;
      }

      await sp`
        INSERT INTO awcms_hr_attendance_corrections
          (id, tenant_id, employment_id, kind, target_event_id, proposed_kind,
           proposed_occurred_at, reason, workflow_instance_id, requested_by)
        VALUES (${correctionId}, ${tenantId}, ${input.employmentId},
                ${input.kind}, ${input.targetEventId}, ${input.proposedKind},
                ${input.proposedOccurredAt.toISOString()}::timestamptz,
                ${input.reason}, ${instanceId}, ${actor.actorTenantUserId})
      `;

      return { kind: "ok" };
    });
  } catch (error) {
    // The unique index on (target, pending) lost a race with a concurrent request.
    if (
      error instanceof Error &&
      error.message.includes(
        "awcms_hr_attendance_corrections_one_pending_target"
      )
    ) {
      attempt = { kind: "pending_target" };
    } else {
      throw error;
    }
  }

  if (attempt.kind === "not_configured") {
    return { outcome: "approval_workflow_not_configured" };
  }

  if (attempt.kind === "facts_invalid") {
    return { outcome: "approval_facts_invalid", errors: attempt.errors };
  }

  if (attempt.kind === "pending_target") {
    return { outcome: "target_already_pending" };
  }

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId,
    moduleKey: HR_WORKFORCE_MODULE_KEY,
    action: "hr_workforce.attendance_correction.requested",
    resourceType: "hr_attendance_correction",
    resourceId: correctionId,
    severity: "info",
    message: "Attendance correction requested.",
    // Ids and kinds only. NEVER the reason, and not the proposed instant.
    attributes: {
      employmentId: input.employmentId,
      kind: input.kind,
      proposedKind: input.proposedKind
    },
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    correction: (await getCorrection(tx, tenantId, correctionId, {
      includeReason: false
    }))!
  };
}

type LockedCorrection = {
  id: string;
  employment_id: string;
  kind: CorrectionKind;
  target_event_id: string | null;
  proposed_kind: AttendanceKind;
  proposed_occurred_at: Date | string;
  status: CorrectionStatus;
  workflow_instance_id: string;
  requested_by: string;
  subject_tenant_user_id: string | null;
};

async function lockCorrection(
  tx: Bun.SQL,
  tenantId: string,
  correctionId: string
): Promise<LockedCorrection | null> {
  const rows = (await tx`
    SELECT id, employment_id, kind, target_event_id, proposed_kind,
           proposed_occurred_at, status, workflow_instance_id, requested_by,
           subject_tenant_user_id
    FROM awcms_hr_attendance_corrections
    WHERE tenant_id = ${tenantId} AND id = ${correctionId}
    FOR UPDATE
  `) as LockedCorrection[];

  return rows[0] ?? null;
}

export type WithdrawOutcome =
  | { outcome: "ok"; correction: AttendanceCorrection }
  | { outcome: "not_found" }
  | { outcome: "not_requester" }
  | { outcome: "not_pending"; status: CorrectionStatus }
  | { outcome: "workflow_already_decided" };

/** Withdraw a pending correction. The REQUESTER only; the instance is cancelled first. */
export async function withdrawCorrection(
  tx: Bun.SQL,
  tenantId: string,
  correctionId: string,
  actor: Actor,
  now: Date
): Promise<WithdrawOutcome> {
  const row = await lockCorrection(tx, tenantId, correctionId);

  if (!row) {
    return { outcome: "not_found" };
  }

  // "Not yours" and "no such correction" answer alike at the route.
  if (
    !actor.actorTenantUserId ||
    row.requested_by !== actor.actorTenantUserId
  ) {
    return { outcome: "not_requester" };
  }

  if (row.status !== "pending") {
    return { outcome: "not_pending", status: row.status };
  }

  try {
    await cancelWorkflowInstance(tx, {
      tenantId,
      instanceId: row.workflow_instance_id,
      cancelledByTenantUserId: actor.actorTenantUserId,
      // A constant: no reason text from the correction ever reaches the workflow store.
      reason: "Withdrawn by the requester.",
      correlationId: actor.correlationId
    });
  } catch (error) {
    if (error instanceof WorkflowRecoveryError) {
      // Already decided (or cancelled) in the engine; `settle` reconciles it.
      return { outcome: "workflow_already_decided" };
    }

    throw error;
  }

  await tx`
    UPDATE awcms_hr_attendance_corrections
    SET status = 'withdrawn', decided_by = ${actor.actorTenantUserId},
        decided_at = ${now.toISOString()}::timestamptz, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${correctionId}
  `;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId,
    moduleKey: HR_WORKFORCE_MODULE_KEY,
    action: "hr_workforce.attendance_correction.withdrawn",
    resourceType: "hr_attendance_correction",
    resourceId: correctionId,
    severity: "info",
    message: "Attendance correction withdrawn.",
    attributes: { employmentId: row.employment_id },
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    correction: (await getCorrection(tx, tenantId, correctionId, {
      includeReason: false
    }))!
  };
}

export type SettleOutcome =
  | { outcome: "ok"; correction: AttendanceCorrection }
  | { outcome: "not_found" }
  | { outcome: "not_pending"; status: CorrectionStatus }
  | { outcome: "still_pending" }
  | { outcome: "no_approver" }
  | { outcome: "self_approved" }
  | { outcome: "target_superseded" }
  | { outcome: "apply_refused"; reason: EventRefusal | "verdict_mismatch" };

type InstanceRow = {
  status: string;
  cancelled_by_tenant_user_id: string | null;
};

type DecisionRow = {
  decision: string;
  decided_by_tenant_user_id: string;
  on_behalf_of_tenant_user_id: string | null;
};

/**
 * Apply the workflow engine's verdict to a pending correction.
 *
 *   * instance `pending`   -> nothing to apply yet (`still_pending`);
 *   * instance `approved`  -> needs at least one approving decision, and NONE by
 *                             the requester or by the employee the correction is
 *                             ABOUT (directly or as the delegator whose standing
 *                             a delegate used), and the settling actor is neither: otherwise refused, the
 *                             correction stays pending. Then the status moves to
 *                             `approved` and the superseding event is appended, in
 *                             one savepoint, so both happen or neither does;
 *   * instance `rejected`  -> the correction is `rejected`;
 *   * instance `cancelled` -> the correction is `withdrawn`.
 *
 * Every move is checked AGAIN by the database against the workflow's own rows.
 * The original event is never touched.
 */
export async function settleCorrection(
  tx: Bun.TransactionSQL,
  tenantId: string,
  correctionId: string,
  actor: Actor,
  now: Date
): Promise<SettleOutcome> {
  const row = await lockCorrection(tx, tenantId, correctionId);

  if (!row) {
    return { outcome: "not_found" };
  }

  if (row.status !== "pending") {
    return { outcome: "not_pending", status: row.status };
  }

  const instances = (await tx`
    SELECT status, cancelled_by_tenant_user_id
    FROM awcms_workflow_instances
    WHERE tenant_id = ${tenantId} AND id = ${row.workflow_instance_id}
  `) as InstanceRow[];
  const instance = instances[0];

  if (!instance || instance.status === "pending") {
    return { outcome: "still_pending" };
  }

  const decisions = (await tx`
    SELECT d.decision, d.decided_by_tenant_user_id,
           d.on_behalf_of_tenant_user_id
    FROM awcms_workflow_decisions d
    JOIN awcms_workflow_tasks t
      ON t.tenant_id = d.tenant_id AND t.id = d.workflow_task_id
    WHERE d.tenant_id = ${tenantId}
      AND t.workflow_instance_id = ${row.workflow_instance_id}
    ORDER BY d.created_at DESC, d.id DESC
  `) as DecisionRow[];

  const actorId = actor.actorTenantUserId;

  if (instance.status === "approved") {
    const approving = decisions.filter(
      (d) => d.decision === "approve" || d.decision === "force_approve"
    );

    // An instance that finished with no human approving decision (a graph with
    // no approval node) would make the requester their own approver.
    if (approving.length === 0) {
      return { outcome: "no_approver" };
    }

    // Segregation of duties covers the requester AND the person the correction
    // is about: the login linked when it was requested, and the one linked now
    // (a re-link in between must not shed the exclusion). No manager-chain check.
    const currentLogin = (await tx`
      SELECT tenant_user_id FROM awcms_hr_employments
      WHERE tenant_id = ${tenantId} AND id = ${row.employment_id}
    `) as { tenant_user_id: string | null }[];
    const excluded = new Set<string>(
      [
        row.requested_by,
        row.subject_tenant_user_id,
        currentLogin[0]?.tenant_user_id ?? null
      ].filter((id): id is string => id !== null)
    );

    if (
      approving.some(
        (d) =>
          excluded.has(d.decided_by_tenant_user_id) ||
          (d.on_behalf_of_tenant_user_id !== null &&
            excluded.has(d.on_behalf_of_tenant_user_id))
      ) ||
      (actorId !== null && excluded.has(actorId))
    ) {
      return { outcome: "self_approved" };
    }

    if (row.target_event_id) {
      const taken = (await tx`
        SELECT 1 AS present FROM awcms_hr_attendance_events
        WHERE tenant_id = ${tenantId}
          AND supersedes_event_id = ${row.target_event_id}
      `) as { present: number }[];

      if (taken.length > 0) {
        return { outcome: "target_superseded" };
      }
    }

    const approverId = approving[0]!.decided_by_tenant_user_id;
    const applied = await guarded(tx, async (sp) => {
      await sp`
        UPDATE awcms_hr_attendance_corrections
        SET status = 'approved', decided_by = ${approverId},
            decided_at = ${now.toISOString()}::timestamptz, updated_at = now()
        WHERE tenant_id = ${tenantId} AND id = ${correctionId}
      `;
      // The event is built FROM the correction row in SQL, never re-typed through
      // a JS Date: the database compares the instant exactly (microseconds).
      await sp`
        INSERT INTO awcms_hr_attendance_events
          (tenant_id, employment_id, kind, occurred_at, source,
           client_event_key, supersedes_event_id, correction_id, recorded_by)
        SELECT c.tenant_id, c.employment_id, c.proposed_kind,
               c.proposed_occurred_at, 'correction', 'correction:' || c.id::text,
               c.target_event_id, c.id, ${actorId}
        FROM awcms_hr_attendance_corrections c
        WHERE c.tenant_id = ${tenantId} AND c.id = ${correctionId}
      `;
    });

    if (!applied.ok) {
      switch (applied.reason) {
        case "target_superseded":
          return { outcome: "target_superseded" };
        case "self_approval":
          return { outcome: "self_approved" };
        case "no_approver":
          return { outcome: "no_approver" };
        case "verdict_mismatch":
          return { outcome: "apply_refused", reason: "verdict_mismatch" };
        default:
          return { outcome: "apply_refused", reason: applied.reason };
      }
    }
  } else if (instance.status === "rejected") {
    const rejecter =
      decisions.find(
        (d) => d.decision === "reject" || d.decision === "force_reject"
      )?.decided_by_tenant_user_id ?? null;

    // `decided_by` names who DECIDED, never who settled it: a rejection nobody
    // decided (a graph with a reject node) stores NULL there (`sql/281`), and the
    // audit row below records who settled it (#998).
    await tx`
      UPDATE awcms_hr_attendance_corrections
      SET status = 'rejected', decided_by = ${rejecter},
          decided_at = ${now.toISOString()}::timestamptz, updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${correctionId}
    `;
  } else {
    // `cancelled`: the instance was ended elsewhere (an administrator's recovery
    // action). The correction can no longer be approved.
    const canceller = instance.cancelled_by_tenant_user_id;

    await tx`
      UPDATE awcms_hr_attendance_corrections
      SET status = 'withdrawn',
          decided_by = ${canceller},
          decided_at = ${now.toISOString()}::timestamptz, updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${correctionId}
    `;
  }

  const settled = (await getCorrection(tx, tenantId, correctionId, {
    includeReason: false
  }))!;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actorId ?? undefined,
    moduleKey: HR_WORKFORCE_MODULE_KEY,
    action: "hr_workforce.attendance_correction.settled",
    resourceType: "hr_attendance_correction",
    resourceId: correctionId,
    severity: settled.status === "approved" ? "warning" : "info",
    message: "Attendance correction settled.",
    // Ids and the resulting status only. NEVER the reason.
    attributes: {
      employmentId: row.employment_id,
      status: settled.status,
      appliedEventId: settled.appliedEventId,
      workflowInstanceId: row.workflow_instance_id,
      // `user`: somebody called `settle`; `workflow_event`: the domain-event
      // consumer applied the verdict (no acting user, so no actor on the row).
      trigger: actorId === null ? "workflow_event" : "user"
    },
    correlationId: actor.correlationId
  });

  return { outcome: "ok", correction: settled };
}
