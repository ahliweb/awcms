/**
 * Per-purpose eligibility (ADR-0152 TG6, TG7). Pure: the caller loads the
 * contact state and the LATEST consent row per purpose; this decides.
 *
 *   - Nothing is eligible unless the contact is `started` (no cold DM: a person
 *     who never started the bot has no contact row at all, and one who stopped,
 *     blocked or was ended is not `started`).
 *   - `support` needs a latest `opt_in` (the `/start`) not followed by an opt-out.
 *   - `transactional` and `marketing` need their OWN latest `opt_in` through the
 *     explicit button; `/start` never grants them, and they are never inferred
 *     from each other.
 *
 * Checked at enqueue AND again at dispatch, so a withdrawal wins over
 * everything queued.
 */
import type { ContactState, Purpose } from "./telegram-engagement-constants";

export type LatestConsent = {
  id: string;
  action: "opt_in" | "opt_out";
  method: string;
} | null;

export type EligibilityVerdict =
  | { eligible: true; consentEvidenceId: string }
  | {
      eligible: false;
      reason: "CONTACT_NOT_STARTED" | "CONSENT_REQUIRED" | "CONSENT_WITHDRAWN";
    };

export function evaluateEligibility(
  state: ContactState,
  purpose: Purpose,
  latest: LatestConsent
): EligibilityVerdict {
  if (state !== "started") {
    return { eligible: false, reason: "CONTACT_NOT_STARTED" };
  }

  if (latest === null) {
    return { eligible: false, reason: "CONSENT_REQUIRED" };
  }

  if (latest.action === "opt_out") {
    return { eligible: false, reason: "CONSENT_WITHDRAWN" };
  }

  // Defence in depth over the CHECK in sql/350: a non-support opt-in must have
  // come from the explicit button.
  if (purpose !== "support" && latest.method !== "consent_button") {
    return { eligible: false, reason: "CONSENT_REQUIRED" };
  }

  return { eligible: true, consentEvidenceId: latest.id };
}
