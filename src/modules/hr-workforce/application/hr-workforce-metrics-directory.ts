/**
 * Workforce metrics -- the reading half (Issue #953;
 * `docs/awcms/workforce-metrics.md`).
 *
 * ## Who sees what
 *
 * One read path per audience, never combined (the same three bases the
 * attendance list uses, narrowed for the supervisor):
 *
 *   * `all`     -- HR: holds `hr_workforce.workforce_metrics.read`. Every
 *                  employee's own facts.
 *   * `mine`    -- the employee: an `ownershipGrant` on the persisted login link.
 *                  Their OWN employments (terminated ones included).
 *   * `reports` -- the supervisor: an `ownershipGrant` on the CURRENT manager
 *                  link, DIRECT reports only (one level, unlike the attendance
 *                  list's whole chain): the issue says direct reports, and a
 *                  performance-flavoured fact about a skip-level person is the
 *                  one a manager is least entitled to.
 *
 * A group aggregate is a DIFFERENT disclosure and a different permission
 * (`workforce_metrics.analyze`): it is computed here per office and every group
 * passes through `suppressIfSmall`.
 *
 * ## What is read
 *
 * `awcms_hr_attendance_events` (effective events only: a superseded event is
 * gone), `awcms_hr_shift_assignments` (published, non-cancelled work shifts) and
 * the employment header and current terms for the office and employed-in-window
 * test. Nothing else -- in particular no compensation, commission or payroll
 * table, and no column that could hold a location, photo, device or network
 * value (there is none on these tables).
 *
 * Tenant isolation is the database's (RLS FORCE on every table read here); this
 * file additionally binds `tenant_id` in every predicate.
 */
import {
  computeFacts,
  METRICS_PAGE_SIZE,
  suppressIfSmall,
  MAX_AGGREGATED_EMPLOYMENTS,
  MAX_SESSION_MINUTES,
  SHIFT_MATCH_EARLY_MINUTES,
  type GroupFigure,
  type MetricEvent,
  type MetricShift,
  type MetricsQuery,
  type WorkforceFacts
} from "../domain/hr-workforce-metrics";
import { callerEmploymentIds } from "./hr-attendance-directory";

export type MetricsBasis =
  | { mode: "all" }
  | { mode: "mine"; tenantUserId: string }
  | { mode: "reports"; tenantUserId: string };

/**
 * The employments a DIRECT-reports read covers, each with the date the
 * relationship began: live employments whose current terms name one of the
 * caller's live, non-terminated employments as manager. `since` is the
 * `effective_from` of the report's CURRENT term (the earliest, when two of the
 * caller's employments manage the same person): a supervisor sees facts only
 * from when the reporting line existed, never the history from before they
 * managed that person. Conservative on purpose: a later change of title under the
 * same manager starts a new term and moves `since` forward.
 */
export async function directReportLinks(
  tx: Bun.SQL,
  tenantId: string,
  tenantUserId: string
): Promise<{ id: string; since: Date }[]> {
  const rows = (await tx`
    SELECT r.id, min(t.effective_from)::text AS since
    FROM awcms_hr_employments m
    JOIN awcms_hr_employment_terms t
      ON t.tenant_id = m.tenant_id AND t.manager_employment_id = m.id
     AND t.effective_to IS NULL
    JOIN awcms_hr_employments r
      ON r.tenant_id = t.tenant_id AND r.id = t.employment_id
     AND r.deleted_at IS NULL
    WHERE m.tenant_id = ${tenantId} AND m.tenant_user_id = ${tenantUserId}
      AND m.deleted_at IS NULL AND m.terminated_on IS NULL
    GROUP BY r.id
  `) as { id: string; since: string }[];

  return rows.map((row) => ({
    id: row.id,
    since: new Date(`${row.since}T00:00:00Z`)
  }));
}

/** The employment ids of {@link directReportLinks}. */
export async function directReportIdsOf(
  tx: Bun.SQL,
  tenantId: string,
  tenantUserId: string
): Promise<string[]> {
  return (await directReportLinks(tx, tenantId, tenantUserId)).map(
    (link) => link.id
  );
}

/** Whether one employment is within a basis; `all` is always true. */
export async function employmentWithinMetricsBasis(
  tx: Bun.SQL,
  tenantId: string,
  employmentId: string,
  basis: MetricsBasis
): Promise<boolean> {
  if (basis.mode === "all") {
    return true;
  }

  const ids =
    basis.mode === "mine"
      ? await callerEmploymentIds(tx, tenantId, basis.tenantUserId)
      : await directReportIdsOf(tx, tenantId, basis.tenantUserId);

  return ids.includes(employmentId);
}

type Scope = { ids: string[] | null; since: Map<string, Date> };

async function scopeOf(
  tx: Bun.SQL,
  tenantId: string,
  basis: MetricsBasis
): Promise<Scope> {
  if (basis.mode === "all") {
    return { ids: null, since: new Map() };
  }

  if (basis.mode === "mine") {
    return {
      ids: await callerEmploymentIds(tx, tenantId, basis.tenantUserId),
      since: new Map()
    };
  }

  const links = await directReportLinks(tx, tenantId, basis.tenantUserId);

  return {
    ids: links.map((link) => link.id),
    since: new Map(links.map((link) => [link.id, link.since]))
  };
}

type EmploymentRow = {
  id: string;
  employee_no: string;
  office_id: string | null;
};

/**
 * One keyset page of employments employed at any point in the window, in `id`
 * order, restricted to `scope` (null = unrestricted). `scope` travels as ONE
 * jsonb parameter (the JS array itself, never a JSON.stringify string).
 */
async function employmentPage(
  tx: Bun.SQL,
  tenantId: string,
  scope: string[] | null,
  window: MetricsQuery,
  after: string | null,
  limit: number
): Promise<EmploymentRow[]> {
  const from = window.from.toISOString();
  const to = window.to.toISOString();

  return (await tx`
    SELECT e.id, e.employee_no, t.office_id
    FROM awcms_hr_employments e
    LEFT JOIN awcms_hr_employment_terms t
      ON t.tenant_id = e.tenant_id AND t.employment_id = e.id
     AND t.effective_to IS NULL
    WHERE e.tenant_id = ${tenantId}
      AND e.deleted_at IS NULL
      AND e.hired_on <= (${to}::timestamptz AT TIME ZONE 'UTC')::date
      AND (e.terminated_on IS NULL
           OR e.terminated_on >= (${from}::timestamptz AT TIME ZONE 'UTC')::date)
      AND (${scope}::jsonb IS NULL
           OR e.id IN (SELECT jsonb_array_elements_text(${scope}::jsonb)::uuid))
      AND (${after}::uuid IS NULL OR e.id > ${after}::uuid)
    ORDER BY e.id
    LIMIT ${limit}
  `) as EmploymentRow[];
}

async function countEmployments(
  tx: Bun.SQL,
  tenantId: string,
  window: MetricsQuery
): Promise<number> {
  const from = window.from.toISOString();
  const to = window.to.toISOString();
  const rows = (await tx`
    SELECT count(*)::int AS n
    FROM awcms_hr_employments e
    WHERE e.tenant_id = ${tenantId}
      AND e.deleted_at IS NULL
      AND e.hired_on <= (${to}::timestamptz AT TIME ZONE 'UTC')::date
      AND (e.terminated_on IS NULL
           OR e.terminated_on >= (${from}::timestamptz AT TIME ZONE 'UTC')::date)
  `) as { n: number }[];

  return rows[0]?.n ?? 0;
}

type EventRow = {
  employment_id: string;
  kind: MetricEvent["kind"];
  occurred_at: Date | string;
};

type ShiftRow = {
  employment_id: string;
  starts_at: Date | string;
  ends_at: Date | string;
  break_starts_at: Date | string | null;
  break_ends_at: Date | string | null;
};

const toDate = (value: Date | string): Date =>
  value instanceof Date ? value : new Date(value);

/** Facts for each employment id in `ids`, as of `now`. */
async function factsFor(
  tx: Bun.SQL,
  tenantId: string,
  ids: readonly string[],
  window: MetricsQuery,
  now: Date,
  since: ReadonlyMap<string, Date> = new Map()
): Promise<Map<string, WorkforceFacts>> {
  const result = new Map<string, WorkforceFacts>();

  if (ids.length === 0) {
    return result;
  }

  const idList = [...ids];
  const eventFrom = new Date(
    window.from.getTime() - SHIFT_MATCH_EARLY_MINUTES * 60_000
  ).toISOString();
  const eventTo = new Date(
    window.to.getTime() + MAX_SESSION_MINUTES * 60_000
  ).toISOString();
  const from = window.from.toISOString();
  const to = window.to.toISOString();

  const events = (await tx`
    SELECT e.employment_id, e.kind, e.occurred_at
    FROM awcms_hr_attendance_events e
    WHERE e.tenant_id = ${tenantId}
      AND e.employment_id IN (
        SELECT jsonb_array_elements_text(${idList}::jsonb)::uuid)
      AND e.occurred_at >= ${eventFrom}::timestamptz
      AND e.occurred_at < ${eventTo}::timestamptz
      AND NOT EXISTS (
        SELECT 1 FROM awcms_hr_attendance_events s
         WHERE s.tenant_id = e.tenant_id AND s.supersedes_event_id = e.id)
  `) as EventRow[];
  const shifts = (await tx`
    SELECT a.employment_id, a.starts_at, a.ends_at, a.break_starts_at,
           a.break_ends_at
    FROM awcms_hr_shift_assignments a
    WHERE a.tenant_id = ${tenantId}
      AND a.employment_id IN (
        SELECT jsonb_array_elements_text(${idList}::jsonb)::uuid)
      AND a.kind = 'work' AND a.status = 'published'
      AND a.starts_at >= ${from}::timestamptz
      AND a.starts_at < ${to}::timestamptz
  `) as ShiftRow[];

  const eventsBy = new Map<string, MetricEvent[]>();
  const shiftsBy = new Map<string, MetricShift[]>();

  for (const row of events) {
    const list = eventsBy.get(row.employment_id) ?? [];
    list.push({ kind: row.kind, occurredAt: toDate(row.occurred_at) });
    eventsBy.set(row.employment_id, list);
  }

  for (const row of shifts) {
    const list = shiftsBy.get(row.employment_id) ?? [];
    list.push({
      startsAt: toDate(row.starts_at),
      endsAt: toDate(row.ends_at),
      breakStartsAt: row.break_starts_at ? toDate(row.break_starts_at) : null,
      breakEndsAt: row.break_ends_at ? toDate(row.break_ends_at) : null
    });
    shiftsBy.set(row.employment_id, list);
  }

  for (const id of idList) {
    // A supervisor's window starts no earlier than the reporting line did.
    const start = since.get(id);
    const own =
      start && start > window.from ? { from: start, to: window.to } : window;

    result.set(
      id,
      computeFacts(eventsBy.get(id) ?? [], shiftsBy.get(id) ?? [], own, now)
    );
  }

  return result;
}

export type EmployeeFigure = {
  employmentId: string;
  employeeNo: string;
  facts: WorkforceFacts;
};

/**
 * One page of per-employee facts for `basis`, optionally narrowed to one
 * employment (the caller has already checked it is within the basis). The cursor
 * is the last employment id of the previous page.
 */
export async function listEmployeeFacts(
  tx: Bun.SQL,
  tenantId: string,
  basis: MetricsBasis,
  window: MetricsQuery,
  options: { employmentId?: string; after?: string | null; now: Date }
): Promise<{ employees: EmployeeFigure[]; nextCursor: string | null }> {
  const scoped = await scopeOf(tx, tenantId, basis);

  if (scoped.ids !== null && scoped.ids.length === 0) {
    return { employees: [], nextCursor: null };
  }

  // A named employment NARROWS the basis, never replaces it: an id outside the
  // scope (a forged filter or cursor) yields an empty page.
  const scope = options.employmentId
    ? scoped.ids === null || scoped.ids.includes(options.employmentId)
      ? [options.employmentId]
      : []
    : scoped.ids;
  const page = await employmentPage(
    tx,
    tenantId,
    scope,
    window,
    options.after ?? null,
    METRICS_PAGE_SIZE
  );
  const facts = await factsFor(
    tx,
    tenantId,
    page.map((row) => row.id),
    window,
    options.now,
    scoped.since
  );

  return {
    employees: page.map((row) => ({
      employmentId: row.id,
      employeeNo: row.employee_no,
      facts: facts.get(row.id)!
    })),
    nextCursor:
      page.length === METRICS_PAGE_SIZE ? page[page.length - 1]!.id : null
  };
}

export type OfficeGroup = { officeId: string | null };

/**
 * Per-office aggregates for the whole tenant, each passed through small-group
 * suppression. Groups are the office of each employee's CURRENT terms (`null` =
 * no office assigned).
 *
 * There is deliberately NO tenant-wide total here: with a total and the
 * unsuppressed groups, a suppressed group would be recoverable by subtraction.
 * Returns `tooLarge` when the tenant has more employments than
 * {@link MAX_AGGREGATED_EMPLOYMENTS}.
 */
export async function listGroupFigures(
  tx: Bun.SQL,
  tenantId: string,
  window: MetricsQuery,
  now: Date,
  maxEmployments: number = MAX_AGGREGATED_EMPLOYMENTS
): Promise<
  { tooLarge: true } | { tooLarge: false; groups: GroupFigure<OfficeGroup>[] }
> {
  // Refuse BEFORE reading a single page: a cheap COUNT(*) of the in-scope
  // employments, not a scan that notices the size after the work is done.
  if ((await countEmployments(tx, tenantId, window)) > maxEmployments) {
    return { tooLarge: true };
  }

  const byOffice = new Map<string | null, WorkforceFacts[]>();
  let after: string | null = null;

  for (;;) {
    const page = await employmentPage(tx, tenantId, null, window, after, 200);

    if (page.length === 0) {
      break;
    }

    const facts = await factsFor(
      tx,
      tenantId,
      page.map((row) => row.id),
      window,
      now
    );

    for (const row of page) {
      const list = byOffice.get(row.office_id) ?? [];
      list.push(facts.get(row.id)!);
      byOffice.set(row.office_id, list);
    }

    after = page[page.length - 1]!.id;

    if (page.length < 200) {
      break;
    }
  }

  const groups = [...byOffice.entries()]
    .map(([officeId, list]) => suppressIfSmall({ officeId }, list))
    // Stable order that leaks nothing about size: by office id, null last.
    .sort((a, b) => {
      const left = a.group.officeId;
      const right = b.group.officeId;

      if (left === right) return 0;
      if (left === null) return 1;
      if (right === null) return -1;

      return left < right ? -1 : 1;
    });

  return { tooLarge: false, groups };
}
