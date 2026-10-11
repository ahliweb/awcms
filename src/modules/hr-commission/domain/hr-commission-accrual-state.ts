/**
 * The accrual state machine and the two date rules around it (Issue #951,
 * ADR-0132, `docs/awcms/hr-payroll.md` sections 6.3 and 8). PURE.
 *
 * Every function here has a twin in `sql/187`/`sql/188` (a trigger or a CHECK),
 * because the database is the authority and the handler only pre-checks so a
 * refusal is a clean 409 instead of an aborted transaction. The integration test
 * `hr-commission-accrual-database` drives every pair of states and every date
 * boundary through BOTH and asserts they agree.
 */

export const ACCRUAL_STATUSES = [
  "pending",
  "approved",
  "payable",
  "paid",
  "voided"
] as const;
export type AccrualStatus = (typeof ACCRUAL_STATUSES)[number];

export function isAccrualStatus(value: unknown): value is AccrualStatus {
  return (
    typeof value === "string" &&
    (ACCRUAL_STATUSES as readonly string[]).includes(value)
  );
}

export type AccrualAction = "approve" | "release" | "void" | "pay";

/** The only edges. `voided` and `paid` have none out; a voided accrual can never be paid. */
const EDGES: Readonly<Record<AccrualAction, [AccrualStatus, AccrualStatus][]>> =
  {
    approve: [["pending", "approved"]],
    release: [["approved", "payable"]],
    void: [
      ["pending", "voided"],
      ["approved", "voided"]
    ],
    pay: [["payable", "paid"]]
  };

/** The status `action` leads to from `from`, or `null` when that edge does not exist. */
export function transitionTarget(
  from: AccrualStatus,
  action: AccrualAction
): AccrualStatus | null {
  return EDGES[action].find(([source]) => source === from)?.[1] ?? null;
}

export function canTransition(from: AccrualStatus, to: AccrualStatus): boolean {
  return Object.values(EDGES).some((edges) =>
    edges.some(([source, target]) => source === from && target === to)
  );
}

export const ACCRUAL_ACTION_TARGET: Readonly<
  Record<AccrualAction, AccrualStatus>
> = {
  approve: "approved",
  release: "payable",
  void: "voided",
  pay: "paid"
};

export type SodRefusal = "beneficiary" | "creator_approves" | "approver_pays";

export type AccrualParties = {
  /** The login linked to the beneficiary employment (`null` when unlinked). */
  beneficiaryUserId: string | null;
  createdBy: string | null;
  approvedBy: string | null;
};

/**
 * Segregation of duties over one accrual (`sql/188`'s transition trigger is the
 * twin): the beneficiary can approve, release or pay none of their own accrual;
 * whoever created an accrual cannot approve it; whoever approved it cannot pay
 * it. `void` is not segregated (it moves no money, and voiding is the safe way
 * out). `null` stamps constrain nothing.
 */
export function sodViolation(
  action: AccrualAction,
  actor: string,
  parties: AccrualParties
): SodRefusal | null {
  if (action !== "void" && actor === parties.beneficiaryUserId) {
    return "beneficiary";
  }

  if (action === "approve" && actor === parties.createdBy) {
    return "creator_approves";
  }

  if (action === "pay" && actor === parties.approvedBy) {
    return "approver_pays";
  }

  return null;
}

/** The oldest event an accrual may report, in days: a sale older than this is not a late delivery (`sql/188`). */
export const MAX_EVENT_AGE_DAYS = 730;

export function isEventTooOld(occurredAt: Date, now: Date): boolean {
  return occurredAt.getTime() < now.getTime() - MAX_EVENT_AGE_DAYS * 86_400_000;
}

/**
 * A window starting before TODAY (the UTC date of the publishing transaction) is
 * back-dated: publishing it changes which rule applies to events that already
 * happened. `sql/187` stamps the same fact from the same comparison.
 */
export function isBackdatedWindow(
  effectiveFrom: string,
  todayUtc: string
): boolean {
  return effectiveFrom < todayUtc;
}

export type EmploymentDates = {
  hiredOn: string;
  terminatedOn: string | null;
  deleted: boolean;
};

/** Whether an employment may earn a commission for an event on `occurredOn` (`sql/188` insert guard). */
export function employmentEarnsOn(
  employment: EmploymentDates,
  occurredOn: string
): boolean {
  return (
    !employment.deleted &&
    employment.hiredOn <= occurredOn &&
    (employment.terminatedOn === null || occurredOn <= employment.terminatedOn)
  );
}

/** `|occurredOn - UTC date of occurredAt| <= 1 day` — any UTC offset (`sql/188` CHECK). */
export function occurredOnMatchesInstant(
  occurredOn: string,
  occurredAt: Date
): boolean {
  const day = 86_400_000;
  const on = Date.parse(`${occurredOn}T00:00:00Z`);
  const at = Date.parse(`${occurredAt.toISOString().slice(0, 10)}T00:00:00Z`);

  return Math.abs(on - at) <= day;
}
