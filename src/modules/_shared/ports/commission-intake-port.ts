/**
 * `CommissionIntakePort` — how an EVENT-DRIVEN consumer reports a sale fact (or
 * its reversal) to `hr_commission` without posting it (Issue #1189, ADR-0147,
 * ADR-0011; `docs/awcms/hr-payroll.md` section 6.4).
 *
 * ## Why a second port next to `CommissionAccrualPort`
 *
 * `CommissionAccrualPort` posts to the accrual ledger in the CALLER's
 * transaction with the CALLER's privileges. A consumer that runs in
 * `domain-events:dispatch` is `awcms_worker`, and the payroll boundary forbids
 * that role any privilege on an accrual (an accrual IS one employee's earnings).
 * So such a consumer depends on THIS port instead: it submits an intake record
 * with one `INSERT ... ON CONFLICT DO NOTHING` in its own transaction, and a job
 * that runs as `awcms_app` (`hr-commission:intents:post`) posts it later through
 * the one existing posting core. `CommissionAccrualPort` stays exactly as it is
 * (`commission_accrual` 1.1.0): it remains the synchronous seam for a route that
 * has a signed-in person and a live transaction.
 *
 * ## The same request shapes, the same validators
 *
 * `submitAccrual` takes a `CommissionAccrualRequest` and `submitVoid` a
 * `CommissionVoidRequest`, and both run the SAME pure validators the ledger and
 * the HTTP surface use, so an intake record can never hold a value the ledger
 * would refuse as malformed. Everything the ledger decides from the database (the
 * rule in force, the employment's eligibility, a conflicting earlier request, an
 * accrual already paid) is decided LATER, by the poster; the consumer never needs
 * the answer synchronously.
 *
 * ## Eventually consistent, and blind on purpose
 *
 * `queued` means "recorded", not "accrued": the accrual appears after the next
 * poster tick, and a business refusal is discovered by the tenant's intake
 * exceptions list, not by the consumer. The consumer cannot read back what it
 * submitted or how it was settled (the worker holds INSERT on the queue and
 * nothing else). This port NEVER returns an accrual, an amount or a rule.
 *
 * ## Outcomes
 *
 *   - `queued`: a new intake row was written.
 *   - `duplicate`: the SAME request (same canonical digest) was already queued or
 *     settled; nothing was written. The same identity with a DIFFERENT request is
 *     `queued` (a second row) and surfaces at posting as the ledger's own
 *     `source_conflict` in the exceptions list, instead of being swallowed.
 *   - `input_invalid`: a malformed request, or an employment id that does not
 *     exist in the tenant.
 *   - `actor_required`: a `void` with no person (every status edge stamps one).
 *   - `disabled`: the tenant has not switched commission intake on. Nothing is
 *     written. Default-deny.
 *
 * ## Authorization is registration plus the switch, not a session
 *
 * Calling the adapter performs no access check and writes no audit row, like the
 * accrual port: the consumer is reviewed code declared in a module descriptor
 * (ADR-0134) that lists `commission_intake` in `capabilities.consumes`, and the
 * tenant must have switched intake on (`hr_commission.intake.configure`). The
 * poster audits the posting. A business refusal is a RETURNED outcome; a refused
 * call writes nothing.
 *
 * `tx` is the caller's tenant-scoped transaction. Plain database writes only, no
 * provider call (ADR-0006). The port's only write is the single INSERT, and it
 * runs in a savepoint: after `input_invalid` or `disabled` the caller's
 * transaction is still usable, and a result other than `queued`/`duplicate`
 * means NOTHING was written (the caller may carry on, or throw to undo its own
 * writes). The port reads the tenant switch first; it never reads the ledger. Money is a decimal STRING (never a JS number).
 */
import type {
  CommissionAccrualRequest,
  CommissionVoidRequest
} from "./commission-accrual-port";

export type CommissionIntakeOutcome =
  | { outcome: "queued" | "duplicate" | "actor_required" | "disabled" }
  | { outcome: "input_invalid"; message: string };

export type CommissionIntakePort = {
  /** Queue an accrual request. The actor is optional: a system accrual has none. */
  submitAccrual(
    tx: Bun.SQL,
    tenantId: string,
    actorTenantUserId: string | null,
    request: CommissionAccrualRequest
  ): Promise<CommissionIntakeOutcome>;
  /** Queue a void. The actor is the person who voided the sale: it is stamped on the accrual. */
  submitVoid(
    tx: Bun.SQL,
    tenantId: string,
    actorTenantUserId: string | null,
    request: CommissionVoidRequest
  ): Promise<CommissionIntakeOutcome>;
};
