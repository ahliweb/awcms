/**
 * `CommissionAccrualPort` — how a downstream adapter reports a SALE FACT to the
 * `hr_commission` accrual ledger (Issue #951, ADR-0132, ADR-0011;
 * `docs/awcms/hr-payroll.md` section 6.2 and 6.4).
 *
 * The shape is fixed HERE, in neutral ground, for the reason every sibling port
 * documents: `hr_commission` imports nothing from commerce, booking or any other
 * domain, and an adapter (in the consuming repository or a composition root)
 * depends on THIS type, never on `hr_commission`'s `application/` or `domain/`
 * code. The adapter, not the ledger, decides WHICH events are commissionable and
 * who earns them.
 *
 * ## Employee commission only
 *
 * The beneficiary is always an EMPLOYMENT (`hr_workforce`): a person with an
 * identity, an office and a manager. Affiliate and referral payouts have an
 * external beneficiary, other terms and another module's ledger; they are NOT
 * here and this port must not be bent to carry them.
 *
 * ## The caller owns the truth of the sale; the ledger owns exactly-once
 *
 * The ledger can prove a source identity was not accrued twice for an employment;
 * it CANNOT prove the sale exists, is paid, or belongs to that employee. Checking
 * that is the adapter's duty and is not repeated here — a caller that posts an
 * unverified base amount has made the ledger pay on a claim.
 *
 *   - `source` is `(type, ref, line)`. `type` MUST equal the `sourceType` of the
 *     rule named by `ruleKey` (a rule says which kind of event it applies to).
 *     `ref` and `line` are opaque to the ledger; the adapter keeps them stable.
 *   - Posting the same identity for the same employment AGAIN with the same
 *     canonical request returns the ORIGINAL (`replayed`), whatever has happened
 *     to the accrual or the rule since — including after it was voided: a voided
 *     accrual is not silently resurrected by a redelivery. The same identity with
 *     a different amount, date, rule key or currency is `source_conflict`.
 *   - One source line may be split between staff by calling once per employment.
 *
 * ## Which rule applies
 *
 * The PUBLISHED version of `ruleKey` whose window contains `occurredOn` — the
 * civil date of the sale in the tenant's own time, derived BY THE CALLER (the
 * ledger assumes no timezone) and within one day of `occurredAt`'s UTC date. Never
 * `now()`. If no published version contains that date the outcome is
 * `no_effective_rule`: a retired version no longer applies, and a version
 * published later with a back-dated window only applies if its publisher
 * acknowledged the back-dating (docs/awcms/hr-payroll.md section 6.1).
 *
 * ## The composition root authorizes and audits — the port does not
 *
 * Calling the adapter performs NO access check and writes NO audit row: it is the
 * ledger's posting core behind a typed seam, and a typed seam is not a
 * chokepoint. The consumer's composition root (its route handler, its job) MUST
 * authorize the actor against ITS OWN permission for the business action through
 * `authorizeInTransaction` before calling it, and MUST audit that business
 * action. Pass the request's `correlationId` through so the ledger row joins the
 * consumer's audit row. (The HTTP surface `POST /api/v1/hr-commission/accruals`
 * is such a composition root: it requires `hr_commission.accruals.accrue`.)
 *
 * ## Transactions and the result
 *
 * `tx` is the CALLER's tenant-scoped transaction; the accrual commits or rolls
 * back with the caller's own writes. Plain database writes only — no provider
 * call (ADR-0006). A business refusal is a RETURNED outcome, not an exception,
 * and a refused call writes NOTHING; but a handler that RETURNS a 4xx `Response`
 * after a refusal still COMMITS its transaction, so a consumer that already wrote
 * its own rows must throw to undo them.
 *
 * Money is a decimal STRING in and out (never a JS number): a number has already
 * been through a float.
 */

export type CommissionAccrualSource = {
  /** Lower-case code; must equal the rule's `sourceType`. */
  type: string;
  /** Opaque, stable reference. `A-Za-z0-9_.:-` only, at most 200 characters. */
  ref: string;
  /** `''`/omitted when the source has no lines. At most 64 characters, same alphabet. */
  line?: string;
};

export type CommissionAccrualRequest = {
  /** The beneficiary: an `hr_workforce` employment id. */
  employmentId: string;
  /** Which rule (by key) to apply; the version is chosen by `occurredOn`. */
  ruleKey: string;
  source: CommissionAccrualSource;
  /** PERCENT rule: the non-negative base amount, a decimal string. */
  baseAmount?: string;
  /** FIXED rule: a non-negative whole number of units. */
  units?: number;
  /** Must equal the rule's currency. */
  currencyCode: string;
  /** The instant of the sale. Not in the future (beyond a day of clock skew). */
  occurredAt: Date;
  /** `YYYY-MM-DD` — the sale's civil date in the tenant's time. */
  occurredOn: string;
  /** The request's correlation id; stored on the row. Pass it through. */
  correlationId?: string;
};

export type CommissionAccrualRecord = {
  id: string;
  employmentId: string;
  ruleKey: string;
  ruleVersion: number;
  status: "pending" | "approved" | "payable" | "paid" | "voided";
  /** Fixed-scale decimal string. */
  amount: string;
  currencyCode: string;
};

export type CommissionAccrualOutcome =
  | { outcome: "accrued" | "replayed"; accrual: CommissionAccrualRecord }
  | { outcome: "source_conflict"; accrualId: string }
  | { outcome: "no_effective_rule" }
  | { outcome: "rule_ambiguous" }
  | { outcome: "source_type_mismatch"; expectedSourceType: string }
  | { outcome: "currency_mismatch"; expectedCurrencyCode: string }
  | { outcome: "employment_not_found" }
  | { outcome: "employment_not_eligible" }
  | { outcome: "input_invalid"; message: string };

export type CommissionAccrualPort = {
  /** Accrue a commission for a sale fact, exactly once per source identity and employment. */
  accrue(
    tx: Bun.SQL,
    tenantId: string,
    actorTenantUserId: string | null,
    request: CommissionAccrualRequest
  ): Promise<CommissionAccrualOutcome>;
};
