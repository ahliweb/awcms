/**
 * The send-eligibility rule for `whatsapp_delivery` (ADR-0133 section 4). Pure:
 * the caller reads the recipient's suppression and consent rows and passes them
 * in, so the SAME rule runs at enqueue and again at dispatch.
 *
 * | purpose       | consent needed | suppression honoured                       |
 * | ------------- | -------------- | ------------------------------------------ |
 * | transactional | no             | every reason (hard failure, stop, manual)  |
 * | security      | no             | hard failure only — never blocked by a     |
 * |               |                | marketing opt-out or a manual entry        |
 * | marketing     | explicit opt-in| every reason, and a withdrawn consent      |
 *
 * Consent is read from the CONSENT row only. Segment, list or campaign-audience
 * membership is deliberately not an input: it never implies consent.
 */
import type { WhatsappPurpose } from "./whatsapp-templates";

export type SuppressionReason = "hard_failure" | "stop_reply" | "manual";
export type ConsentStatus = "granted" | "withdrawn";

export type EligibilityFacts = {
  suppressionReason: SuppressionReason | null;
  /** `null` = no consent row exists for the recipient. */
  consentStatus: ConsentStatus | null;
};

export type EligibilityDecision =
  | { eligible: true }
  | { eligible: false; kind: "suppressed"; reason: "hard_failure" | "opt_out" }
  | { eligible: false; kind: "consent_required" };

export function decideEligibility(
  purpose: WhatsappPurpose,
  facts: EligibilityFacts
): EligibilityDecision {
  if (purpose === "security") {
    return facts.suppressionReason === "hard_failure"
      ? { eligible: false, kind: "suppressed", reason: "hard_failure" }
      : { eligible: true };
  }

  if (facts.suppressionReason !== null) {
    return {
      eligible: false,
      kind: "suppressed",
      reason:
        facts.suppressionReason === "hard_failure" ? "hard_failure" : "opt_out"
    };
  }

  if (purpose === "marketing") {
    if (facts.consentStatus === "withdrawn") {
      return { eligible: false, kind: "suppressed", reason: "opt_out" };
    }

    if (facts.consentStatus !== "granted") {
      return { eligible: false, kind: "consent_required" };
    }
  }

  return { eligible: true };
}
