/**
 * Response mapping shared by the accrual route files (Issue #951, ADR-0132): the
 * one place an accrual refusal is spelled as an HTTP code, so the five routes
 * cannot drift into different 409s for the same refusal.
 */
import { fail } from "../../_shared/api-response";
import type { CommissionAccrualOutcome } from "../../_shared/ports/commission-accrual-port";
import type { AccrualAction } from "../domain/hr-commission-accrual-state";
import type { TransitionOutcome } from "./hr-commission-accrual-ledger";

const VERB: Record<AccrualAction, string> = {
  approve: "approved",
  release: "released",
  void: "voided",
  pay: "paid"
};

/** The refusal `Response` of a transition, or `null` for `ok`. */
export function transitionRefusal(
  action: AccrualAction,
  result: TransitionOutcome
): Response | null {
  switch (result.outcome) {
    case "ok":
      return null;
    case "not_found":
      return fail(404, "RESOURCE_NOT_FOUND", "Commission accrual not found.");
    case "invalid_state":
      return fail(
        409,
        "ACCRUAL_INVALID_STATE",
        `A ${result.status} accrual cannot be ${VERB[action]}.`
      );
    case "sod_violation":
      if (result.kind === "beneficiary" && action === "approve") {
        return fail(
          403,
          "APPROVE_OWN_ACCRUAL_FORBIDDEN",
          "The beneficiary of an accrual cannot approve it; a second person must."
        );
      }

      return fail(
        403,
        "SEGREGATION_OF_DUTIES",
        result.kind === "beneficiary"
          ? `The beneficiary of an accrual cannot ${action} it.`
          : result.kind === "creator_approves"
            ? "Whoever created an accrual cannot approve it; a second person must."
            : "Whoever approved an accrual cannot pay it; a different person must."
      );
    case "actor_required":
      return fail(
        403,
        "ACTOR_REQUIRED",
        "A commission accrual transition must be made by a signed-in person."
      );
  }
}

/** The refusal `Response` of an accrual post, or `null` when it was accrued or replayed. */
export function accrueRefusal(
  result: CommissionAccrualOutcome
): Response | null {
  switch (result.outcome) {
    case "accrued":
    case "replayed":
      return null;
    case "source_conflict":
      return fail(
        409,
        "SOURCE_CONFLICT",
        "This source was already accrued for this employment with a different amount, date, rule or currency."
      );
    case "no_effective_rule":
      return fail(
        409,
        "NO_EFFECTIVE_RULE",
        "No published version of this rule is in force on the event date."
      );
    case "rule_ambiguous":
      return fail(
        409,
        "RULE_AMBIGUOUS",
        "More than one published version of this rule is in force on the event date."
      );
    case "source_type_mismatch":
      return fail(
        409,
        "SOURCE_TYPE_MISMATCH",
        `This rule applies to source type ${result.expectedSourceType}.`
      );
    case "currency_mismatch":
      return fail(
        409,
        "CURRENCY_MISMATCH",
        `This rule pays in ${result.expectedCurrencyCode}.`
      );
    case "employment_not_found":
      return fail(404, "EMPLOYMENT_NOT_FOUND", "Employment not found.");
    case "employment_not_eligible":
      return fail(
        409,
        "EMPLOYMENT_NOT_ELIGIBLE",
        "The employment was not live and employed on the event date."
      );
    case "input_invalid":
      return fail(400, "VALIDATION_ERROR", result.message);
  }
}
