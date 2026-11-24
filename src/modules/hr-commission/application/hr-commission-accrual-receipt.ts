/**
 * Masked results of the accrual write path (Issue #1095, decision K3 of
 * 2026-11-22; `docs/awcms/hr-payroll.md` section 13.3).
 *
 * The mutation routes (`approve`, `release`, `pay`, `void`) and the in-process
 * `CommissionAccrualPort` return the accrual to a caller who holds only the
 * power to make that transition, and they record no sensitive-read audit (the
 * mutation is audited by its own event). So what they hand back is a MASKED
 * shape: the facts of the transition, never the earnings or the person.
 *
 * Built FIELD BY FIELD (an allow-list), so a column added to the ledger later
 * does not reach a mutation response by default. The full values are readable
 * only through `GET /api/v1/hr-commission/accruals[/{id}]`, which records a
 * sensitive read. The sensitive-read gate (`PAYROLL_READ_FUNCTION_IMPORTS`)
 * refuses a write-path importer that does not call these functions.
 *
 * Withheld, and why:
 *   - `amount`, `baseAmount`, `units`, `rate`, `fixedAmount`: the earning.
 *   - `employmentId`: who earned it.
 *   - `sourceRef`, `sourceLine`: an identifier of the sale behind it.
 *   - `paymentReference`: an opaque payout reference.
 *   - `ruleId`, `occurredAt`, `operation`: not needed to confirm a transition.
 */
import type {
  CommissionAccrualOutcome,
  CommissionAccrualRecord,
  CommissionVoidOutcome
} from "../../_shared/ports/commission-accrual-port";
import type {
  CommissionAccrual,
  LedgerAccrueOutcome,
  LedgerVoidOutcome
} from "./hr-commission-accrual-ledger";

/** The body of a `approve`/`release`/`pay`/`void` response. `masked` is always `true`. */
export type CommissionAccrualMutationReceipt = Pick<
  CommissionAccrual,
  | "id"
  | "status"
  | "currencyCode"
  | "ruleKey"
  | "ruleVersion"
  | "sourceType"
  | "calculation"
  | "occurredOn"
  | "createdAt"
  | "approvedAt"
  | "releasedAt"
  | "paidAt"
  | "voidedAt"
  | "voidReasonCode"
> & { masked: true };

/** The ONLY keys a stored or returned mutation body may carry (besides `masked`). */
export const MUTATION_RECEIPT_KEYS = [
  "id",
  "status",
  "currencyCode",
  "ruleKey",
  "ruleVersion",
  "sourceType",
  "calculation",
  "occurredOn",
  "createdAt",
  "approvedAt",
  "releasedAt",
  "paidAt",
  "voidedAt",
  "voidReasonCode"
] as const;

/**
 * Projects ANY accrual-shaped value onto the receipt keys (Issue #1095, L1):
 * the one function that a replay of a body stored BEFORE the masking (a full
 * accrual, kept in `awcms_idempotency_keys.response_body` for ~30 days) passes
 * through, so an old full body never leaves the database again. A value that is
 * not an object projects to the bare marker.
 */
export function pickReceipt(raw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  if (raw !== null && typeof raw === "object") {
    for (const key of MUTATION_RECEIPT_KEYS) {
      if (Object.hasOwn(raw, key)) {
        out[key] = (raw as Record<string, unknown>)[key];
      }
    }
  }

  out.masked = true;

  return out;
}

/** A stored `approve|release|pay|void` body (`data` is the accrual) projected to receipts. */
export function projectStoredMutationBody(body: unknown): unknown {
  if (body === null || typeof body !== "object") return body;

  const record = body as Record<string, unknown>;

  return Object.hasOwn(record, "data")
    ? { ...record, data: pickReceipt(record.data) }
    : body;
}

/** A stored `POST /accruals` body (`data.accrual` is the accrual) projected to receipts. */
export function projectStoredAccrueBody(body: unknown): unknown {
  if (body === null || typeof body !== "object") return body;

  const record = body as Record<string, unknown>;
  const data = record.data;

  if (data === null || typeof data !== "object") return body;

  return {
    ...record,
    data: {
      ...(data as Record<string, unknown>),
      accrual: pickReceipt((data as Record<string, unknown>).accrual)
    }
  };
}

export function toMutationReceipt(
  accrual: CommissionAccrual
): CommissionAccrualMutationReceipt {
  return {
    id: accrual.id,
    status: accrual.status,
    currencyCode: accrual.currencyCode,
    ruleKey: accrual.ruleKey,
    ruleVersion: accrual.ruleVersion,
    sourceType: accrual.sourceType,
    calculation: accrual.calculation,
    occurredOn: accrual.occurredOn,
    createdAt: accrual.createdAt,
    approvedAt: accrual.approvedAt,
    releasedAt: accrual.releasedAt,
    paidAt: accrual.paidAt,
    voidedAt: accrual.voidedAt,
    voidReasonCode: accrual.voidReasonCode,
    masked: true
  };
}

/** The port's masked record, built field by field from the ledger's. */
export function toPortRecord(accrual: {
  id: string;
  ruleKey: string;
  ruleVersion: number;
  status: CommissionAccrualRecord["status"];
  currencyCode: string;
}): CommissionAccrualRecord {
  return {
    id: accrual.id,
    ruleKey: accrual.ruleKey,
    ruleVersion: accrual.ruleVersion,
    status: accrual.status,
    currencyCode: accrual.currencyCode
  };
}

export function maskAccrueOutcome(
  outcome: LedgerAccrueOutcome
): CommissionAccrualOutcome {
  return outcome.outcome === "accrued" || outcome.outcome === "replayed"
    ? { outcome: outcome.outcome, accrual: toPortRecord(outcome.accrual) }
    : outcome;
}

export function maskVoidOutcome(
  outcome: LedgerVoidOutcome
): CommissionVoidOutcome {
  return outcome.outcome === "voided" || outcome.outcome === "already_voided"
    ? { outcome: outcome.outcome, accrual: toPortRecord(outcome.accrual) }
    : outcome;
}
