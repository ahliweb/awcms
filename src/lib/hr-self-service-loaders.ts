/**
 * The data loads of the HR self-service, supervisor and HR screens (Issue #952),
 * kept out of the `.astro` files so the authorisation and audit rules they carry
 * can be exercised against a real database (`tests/integration/
 * hr-self-service-pages.integration.test.ts`) instead of read off a template.
 *
 * Every panel is authorised with the question its API route asks (the route's
 * guard plus the route's ownership grant, `canReadPanel`), so an ABAC deny hides
 * it exactly as it 403s the route (audit H-1); every read outside the employee's
 * own basis records the sensitive read the route records, in the caller's
 * transaction, fail-closed (audit M-1). The subject is always the
 * `tenantUserId` argument, which the pages pass as `auth.context.tenantUserId`
 * and from nothing else (audit L-1).
 */
import type { AccessRequest } from "../modules/identity-access/domain/access-control";
import type { OwnershipGrant } from "../modules/identity-access/application/access-guard";
import {
  listCorrections,
  listEvents,
  type AttendanceCorrection,
  type AttendanceEvent
} from "../modules/hr-workforce/application/hr-attendance-directory";
import { listAssignments } from "../modules/hr-workforce/application/hr-shift-directory";
import {
  listEmployments,
  type Employment
} from "../modules/hr-workforce/application/hr-workforce-directory";
import {
  directReportLinks,
  listEmployeeFacts,
  type EmployeeFigure
} from "../modules/hr-workforce/application/hr-workforce-metrics-directory";
import type { ShiftAssignment } from "../modules/hr-workforce/application/hr-shift-directory";
import { auditPanelRead, canReadPanel } from "./hr-self-service-access";

export type CanFn = (
  request: AccessRequest,
  options?: { ownershipGrant?: OwnershipGrant }
) => Promise<boolean>;

type Common = {
  tx: Bun.SQL;
  tenantId: string;
  /** The caller. Pages pass `auth.context.tenantUserId`; nothing else. */
  tenantUserId: string;
  can: CanFn;
  now: Date;
  correlationId?: string;
};

// --- my work ---------------------------------------------------------------------

export type MyWorkData = {
  canRequest: boolean;
  partial: boolean;
  employments: Employment[];
  shifts: ShiftAssignment[];
  events: AttendanceEvent[];
  corrections: AttendanceCorrection[];
};

export async function loadMyWork(
  input: Common & {
    shiftsTo: Date;
    eventsFrom: Date;
    /** The guard of the one mutation on the screen, stated by the page so the screen-coverage ledger sees the claim. */
    requestGuard: AccessRequest;
  }
): Promise<MyWorkData> {
  const { tx, tenantId, tenantUserId, can, now } = input;
  const mineBasis = { mode: "mine" as const, tenantUserId };
  const canRequest = await can(input.requestGuard);
  const mayEmployments = await canReadPanel(can, "employmentsMine");
  const mayShifts = await canReadPanel(can, "shiftsMine");
  const mayEvents = await canReadPanel(can, "attendanceMine");
  const mayCorrections = await canReadPanel(can, "correctionsMine");

  return {
    canRequest,
    partial: !(mayEmployments && mayShifts && mayEvents && mayCorrections),
    employments: mayEmployments
      ? (
          await listEmployments(tx, tenantId, {
            ownedByTenantUserId: tenantUserId
          })
        ).employments
      : [],
    shifts: mayShifts
      ? (
          await listAssignments(tx, tenantId, {
            from: now,
            to: input.shiftsTo,
            publishedOnly: true,
            ownedByTenantUserId: tenantUserId
          })
        ).assignments
      : [],
    events: mayEvents
      ? (
          await listEvents(tx, tenantId, mineBasis, {
            from: input.eventsFrom,
            to: now,
            effectiveOnly: true
          })
        ).events
      : [],
    corrections: mayCorrections
      ? (await listCorrections(tx, tenantId, mineBasis, {})).corrections
      : []
  };
}

// --- my metrics ------------------------------------------------------------------

export async function loadMyMetrics(
  input: Common & { range: { from: Date; to: Date } }
): Promise<{ employees: EmployeeFigure[]; withheld: boolean }> {
  if (!(await canReadPanel(input.can, "metricsMine"))) {
    return { employees: [], withheld: true };
  }

  const page = await listEmployeeFacts(
    input.tx,
    input.tenantId,
    { mode: "mine", tenantUserId: input.tenantUserId },
    input.range,
    { now: input.now }
  );

  return { employees: page.employees, withheld: false };
}

// --- team ------------------------------------------------------------------------

export type TeamData = {
  employees: EmployeeFigure[];
  events: AttendanceEvent[];
  corrections: AttendanceCorrection[];
  withheld: boolean;
};

export async function loadTeam(
  input: Common & { range: { from: Date; to: Date } }
): Promise<TeamData> {
  const { tx, tenantId, tenantUserId, can, now, correlationId, range } = input;
  // Direct reports only, with the date each reporting line began. Events and
  // corrections are queried for exactly these ids (not the manager chain) and
  // trimmed to each report's `since`, so a supervisor never reads the history
  // from before they managed that person (audit L-2).
  const links = await directReportLinks(tx, tenantId, tenantUserId);
  const since = new Map(links.map((link) => [link.id, link.since]));
  const idsBasis = {
    mode: "ids" as const,
    employmentIds: links.map((link) => link.id)
  };
  const audit = (
    permission:
      | "hr_workforce.attendance.read"
      | "hr_workforce.corrections.read"
      | "hr_workforce.workforce_metrics.read",
    employmentIds: string[]
  ) =>
    auditPanelRead(tx, {
      basis: "reports",
      tenantId,
      actorTenantUserId: tenantUserId,
      permission,
      employmentIds,
      itemCount: employmentIds.length,
      correlationId
    });
  const started = (id: string) => since.get(id)?.getTime() ?? Infinity;
  let employees: EmployeeFigure[] = [];
  let events: AttendanceEvent[] = [];
  let corrections: AttendanceCorrection[] = [];
  let withheld = false;

  if (await canReadPanel(can, "metricsReports")) {
    employees = (
      await listEmployeeFacts(
        tx,
        tenantId,
        { mode: "reports", tenantUserId },
        range,
        { now }
      )
    ).employees;
    await audit(
      "hr_workforce.workforce_metrics.read",
      employees.map((row) => row.employmentId)
    );
  } else {
    withheld = true;
  }

  if (await canReadPanel(can, "attendanceReports")) {
    events = (
      await listEvents(tx, tenantId, idsBasis, {
        from: range.from,
        to: range.to,
        effectiveOnly: true
      })
    ).events.filter(
      (event) =>
        new Date(event.occurredAt).getTime() >= started(event.employmentId)
    );
    await audit(
      "hr_workforce.attendance.read",
      events.map((row) => row.employmentId)
    );
  } else {
    withheld = true;
  }

  if (await canReadPanel(can, "correctionsReports")) {
    corrections = (
      await listCorrections(tx, tenantId, idsBasis, { status: "pending" })
    ).corrections.filter(
      (entry) =>
        new Date(entry.createdAt).getTime() >= started(entry.employmentId)
    );
    await audit(
      "hr_workforce.corrections.read",
      corrections.map((row) => row.employmentId)
    );
  } else {
    withheld = true;
  }

  return { employees, events, corrections, withheld };
}

// --- workforce (HR) --------------------------------------------------------------

export type WorkforceData = {
  employments: Employment[];
  nextCursor: string | null;
  corrections: AttendanceCorrection[] | null;
  events: AttendanceEvent[] | null;
};

export async function loadWorkforce(
  input: Common & {
    state?: "active" | "terminated";
    cursor?: Parameters<typeof listEmployments>[3];
    eventsFrom: Date;
    /** The guards of the two HR panels, stated by the page (the screen-coverage ledger reads the claim there). */
    guards: { corrections: AccessRequest; attendance: AccessRequest };
    /** Records one `all`-basis sensitive read (the page implements it with `recordSensitiveRead`). */
    recordRead: (read: {
      permission:
        "hr_workforce.corrections.read" | "hr_workforce.attendance.read";
      employmentIds: string[];
      itemCount: number;
    }) => Promise<void>;
  }
): Promise<WorkforceData> {
  const { tx, tenantId, can, now } = input;
  // Basis `all`: the roles must grant it, there is no ownership widening.
  const mayCorrections = await can(input.guards.corrections);
  const mayAttendance = await can(input.guards.attendance);
  const employments = await listEmployments(
    tx,
    tenantId,
    input.state ? { state: input.state } : {},
    input.cursor
  );
  const corrections = mayCorrections
    ? (
        await listCorrections(
          tx,
          tenantId,
          { mode: "all" },
          { status: "pending" }
        )
      ).corrections
    : null;
  const events = mayAttendance
    ? (
        await listEvents(
          tx,
          tenantId,
          { mode: "all" },
          { from: input.eventsFrom, to: now, effectiveOnly: true }
        )
      ).events
    : null;

  // HR's `all` basis: the page records the sensitive read the API routes record
  // (ids and a count, same transaction, fail-closed -- audit M-1). The page
  // supplies the recorder so the call, with its literal permission, sits in the
  // file whose guards the sensitive-reads gate reads.
  if (corrections && corrections.length > 0) {
    await input.recordRead({
      permission: "hr_workforce.corrections.read",
      employmentIds: corrections.map((row) => row.employmentId),
      itemCount: corrections.length
    });
  }

  if (events && events.length > 0) {
    await input.recordRead({
      permission: "hr_workforce.attendance.read",
      employmentIds: events.map((row) => row.employmentId),
      itemCount: events.length
    });
  }

  return {
    employments: employments.employments,
    nextCursor: employments.nextCursor,
    corrections,
    events
  };
}
