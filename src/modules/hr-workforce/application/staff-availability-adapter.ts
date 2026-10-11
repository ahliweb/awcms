/**
 * The `hr_workforce` adapter of `StaffAvailabilityPort` (Issue #946, ADR-0132,
 * `docs/awcms/hr-payroll.md` section 5, `docs/awcms/cross-domain-contracts.md`
 * section 4). The contract is `_shared/ports/staff-availability-port.ts`; read
 * its header first.
 *
 * ## What this reads, and the one thing it must never reach
 *
 * Three tables, by name: `awcms_hr_shift_assignments` (the schedule),
 * `awcms_hr_employment_terms` (is the person active) and `awcms_hr_employments`
 * (is the header live and in this tenant; the soft-delete flag lives there, and
 * the design pack's "two tables" could not answer "soft-deleted" without it).
 * None holds a name, a rate or a bank detail. A source-text test fails the build
 * if this file ever names a compensation, payroll, commission or payout table.
 * The result is an allow-list of three fields per person, so it structurally
 * cannot carry anything else.
 *
 * ## Rules, in one place
 *
 *   * ONLY `published` assignments count; drafts and cancelled rows are invisible.
 *   * Working time = work minus each assignment's own break, minus time off,
 *     clipped to the window (the pure `computeWorkingTime`).
 *   * A work assignment counts only when the employment's terms were `active` on
 *     the assignment's LOCAL start date (its stored zone). `on_leave`,
 *     `suspended` and `terminated` terms contribute nothing. A shift that starts
 *     on the last active day counts whole, even past midnight.
 *   * `resolved` needs a live employment in THIS tenant with an `active` term
 *     touching the window (padded a day each side, since terms are dates and the
 *     window is an instant). Everything else is `unknown`, and "not found",
 *     "other tenant", "soft-deleted" and "not active" are indistinguishable.
 *   * The tenant comes from the caller's transaction setting, and is also in
 *     every predicate, so the answer does not rest on RLS alone. With no tenant
 *     set the answer is all `unknown`.
 *   * A person with more than `availabilityMaxRowsPerEmployment` live rows in the
 *     window is `unknown` (never a truncated answer, and never an error for the
 *     rest of the batch).
 *   * `officeId` narrows WORK to assignments at that office; time off is applied
 *     regardless, because a person on leave is on leave everywhere.
 *
 * It authorizes nothing, audits nothing, writes nothing and takes no lock.
 */
import type {
  AvailabilityInterval,
  StaffAvailability,
  StaffAvailabilityPort,
  StaffAvailabilityQuery,
  StaffAvailabilityResult
} from "../../_shared/ports/staff-availability-port";
import {
  computeWorkingTime,
  type ScheduledAssignment
} from "../domain/availability-intervals";
import { SHIFT_LIMITS } from "../domain/hr-shift-types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UTC_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const DAY_MS = 86_400_000;

function readInstant(value: unknown, field: string): number {
  if (typeof value !== "string" || !UTC_INSTANT_PATTERN.test(value)) {
    throw new RangeError(
      `${field} must be an ISO 8601 UTC instant ending in Z.`
    );
  }

  const ms = Date.parse(value);

  if (!Number.isFinite(ms)) {
    throw new RangeError(`${field} is not a real instant.`);
  }

  return ms;
}

type AssignmentRow = {
  employment_id: string;
  kind: "work" | "time_off";
  starts_at: Date;
  ends_at: Date;
  break_starts_at: Date | null;
  break_ends_at: Date | null;
};

export function createStaffAvailabilityAdapter(
  options: { now?: () => Date } = {}
): StaffAvailabilityPort {
  const now = options.now ?? (() => new Date());

  return {
    async getAvailability(
      tx: Bun.SQL,
      query: StaffAvailabilityQuery
    ): Promise<StaffAvailabilityResult> {
      if (!Array.isArray(query.staffRefs) || query.staffRefs.length === 0) {
        throw new RangeError("staffRefs must contain at least one reference.");
      }

      const refs = [...new Set(query.staffRefs)];

      if (refs.length > SHIFT_LIMITS.availabilityMaxStaff) {
        throw new RangeError(
          `At most ${SHIFT_LIMITS.availabilityMaxStaff} staff per call; split the request.`
        );
      }

      if (refs.some((ref) => typeof ref !== "string")) {
        throw new RangeError("Every staff reference must be a string.");
      }

      const fromMs = readInstant(query.fromUtc, "fromUtc");
      const toMs = readInstant(query.toUtc, "toUtc");

      if (toMs <= fromMs) {
        throw new RangeError("toUtc must be after fromUtc.");
      }

      if (toMs - fromMs > SHIFT_LIMITS.availabilityMaxWindowDays * DAY_MS) {
        throw new RangeError(
          `The window is at most ${SHIFT_LIMITS.availabilityMaxWindowDays} days; split the request.`
        );
      }

      if (query.officeId !== undefined && !UUID_PATTERN.test(query.officeId)) {
        throw new RangeError("officeId must be a UUID.");
      }

      const from = new Date(fromMs).toISOString();
      const to = new Date(toMs).toISOString();
      const officeId = query.officeId?.toLowerCase() ?? null;
      // A reference that is not a UUID cannot name an employment: it is `unknown`
      // without ever reaching a `::uuid` cast.
      const candidates = refs
        .filter((ref) => UUID_PATTERN.test(ref))
        .map((ref) => ref.toLowerCase());
      const candidateArray = `{${candidates.join(",")}}`;

      const resolved = new Set<string>();
      const byEmployment = new Map<string, ScheduledAssignment[]>();

      if (candidates.length > 0) {
        const live = (await tx`
          SELECT e.id
          FROM awcms_hr_employments e
          WHERE e.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
            AND e.id = ANY(${candidateArray}::uuid[])
            AND e.deleted_at IS NULL
            AND EXISTS (
              SELECT 1 FROM awcms_hr_employment_terms t
              WHERE t.tenant_id = e.tenant_id AND t.employment_id = e.id
                AND t.status = 'active'
                AND t.effective_from <= ((${to}::timestamptz AT TIME ZONE 'UTC')::date + 1)
                AND (t.effective_to IS NULL
                     OR t.effective_to > ((${from}::timestamptz AT TIME ZONE 'UTC')::date - 1))
            )
        `) as { id: string }[];

        for (const row of live) {
          resolved.add(row.id);
        }
      }

      if (resolved.size > 0) {
        const resolvedArray = `{${[...resolved].join(",")}}`;
        const cap = SHIFT_LIMITS.availabilityMaxRowsPerEmployment;
        // At most `cap + 1` rows per employment come back, so one person with an
        // absurd schedule can neither blow up the batch nor be answered from a
        // truncated list: that person alone becomes `unknown` (fail closed).
        const rows = (await tx`
          SELECT ranked.employment_id, ranked.kind, ranked.starts_at, ranked.ends_at,
                 ranked.break_starts_at, ranked.break_ends_at
          FROM (
            SELECT a.employment_id, a.kind, a.starts_at, a.ends_at,
                   a.break_starts_at, a.break_ends_at,
                   row_number() OVER (PARTITION BY a.employment_id ORDER BY a.starts_at, a.id) AS rn
            FROM awcms_hr_shift_assignments a
            WHERE a.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
              AND a.employment_id = ANY(${resolvedArray}::uuid[])
              AND a.status = 'published'
              AND a.starts_at < ${to}::timestamptz
              AND a.ends_at > ${from}::timestamptz
              AND (
                a.kind = 'time_off'
                OR (
                  (${officeId}::uuid IS NULL OR a.office_id = ${officeId}::uuid)
                  AND EXISTS (
                    SELECT 1 FROM awcms_hr_employment_terms t
                    WHERE t.tenant_id = a.tenant_id AND t.employment_id = a.employment_id
                      AND t.status = 'active'
                      AND t.effective_from <= (a.starts_at AT TIME ZONE a.time_zone)::date
                      AND (t.effective_to IS NULL
                           OR t.effective_to > (a.starts_at AT TIME ZONE a.time_zone)::date)
                  )
                )
              )
          ) ranked
          WHERE ranked.rn <= ${cap + 1}
          ORDER BY ranked.employment_id, ranked.starts_at
        `) as AssignmentRow[];

        for (const row of rows) {
          const list = byEmployment.get(row.employment_id) ?? [];

          list.push({
            kind: row.kind,
            start: row.starts_at.getTime(),
            end: row.ends_at.getTime(),
            breakStart: row.break_starts_at?.getTime() ?? null,
            breakEnd: row.break_ends_at?.getTime() ?? null
          });
          byEmployment.set(row.employment_id, list);
        }

        for (const [employmentId, list] of byEmployment) {
          if (list.length > cap) {
            byEmployment.delete(employmentId);
            resolved.delete(employmentId);
          }
        }
      }

      const staff: StaffAvailability[] = refs.map((ref) => {
        const key = ref.toLowerCase();

        if (!resolved.has(key)) {
          return { staffRef: ref, status: "unknown", intervals: [] };
        }

        const intervals: AvailabilityInterval[] = computeWorkingTime(
          byEmployment.get(key) ?? [],
          { start: fromMs, end: toMs }
        ).map((span) => ({
          startUtc: new Date(span.start).toISOString(),
          endUtc: new Date(span.end).toISOString()
        }));

        return { staffRef: ref, status: "resolved", intervals };
      });

      return { asOf: now().toISOString(), staff };
    }
  };
}

/** The adapter a composition root injects into a consumer. Stateless. */
export const staffAvailabilityAdapter: StaffAvailabilityPort =
  createStaffAvailabilityAdapter();
