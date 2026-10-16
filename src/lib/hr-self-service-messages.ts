/**
 * The translated client messages of the HR self-service screens (Issue #952).
 * Rendered as JSON in `data-msgs` on `#hr-messages`; `hr-self-service-client.ts`
 * shows the message of the API's error code, else `generic`.
 */
import type { Translator } from "./i18n";

export function hrMessages(t: Translator["t"]): Record<string, string> {
  return {
    generic: t("The request could not be sent. Please try again."),
    busy: t("Please wait…"),
    NETWORK_ERROR: t("The server could not be reached. Please try again."),
    ACCESS_DENIED: t("You do not have permission to do that."),
    VALIDATION_ERROR: t("Some fields are not valid. Check them and try again."),
    IDEMPOTENCY_CONFLICT: t(
      "This request was already used for a different change. Reload the page and try again."
    ),
    APPROVAL_WORKFLOW_NOT_CONFIGURED: t(
      "Corrections need an approval workflow and none is set up yet. Ask your administrator."
    ),
    CORRECTION_ALREADY_PENDING: t(
      "A correction for that event is already waiting for a decision."
    ),
    TARGET_EVENT_NOT_FOUND: t("That event could not be found."),
    TARGET_EVENT_SUPERSEDED: t(
      "That event was already replaced by an approved correction."
    ),
    ATTENDANCE_TIME_IN_FUTURE: t("The proposed time cannot be in the future."),
    EMPLOYMENT_NOT_FOUND: t("Your employment could not be found.")
  };
}
