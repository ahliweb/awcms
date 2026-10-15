/**
 * The translated client messages shared by every booking admin screen (Issue
 * #942). A page renders this object as JSON in `data-msgs` on
 * `#booking-messages`; `booking-admin-client.ts` shows the message of the API's
 * error code, else `generic`. Keys are the API's error codes, so no English
 * lives in the script.
 *
 * Several codes share a sentence on purpose: the screen says what to DO, not the
 * internal name of the rule.
 */
import type { Translator } from "./i18n";

export function bookingMessages(t: Translator["t"]): Record<string, string> {
  return {
    generic: t("The change could not be saved. Please try again."),
    busy: t("Please wait…"),
    nothingToSave: t("There is nothing to change."),
    NETWORK_ERROR: t("The server could not be reached. Please try again."),
    ACCESS_DENIED: t("You do not have permission to do that."),
    VALIDATION_ERROR: t("Some fields are not valid. Check them and try again."),
    STAY_DATES_INVALID: t(
      "The dates are not valid: check-out must be after check-in."
    ),
    IDEMPOTENCY_CONFLICT: t(
      "This request was already used for a different change. Reload the page and try again."
    ),
    CODE_TAKEN: t(
      "That code is already in use, including by a deleted record."
    ),
    BOOKING_MODE_IN_USE: t(
      "The booking mode cannot change while the resource has live bookings or blocks."
    ),
    TIMEZONE_IN_USE: t(
      "The time zone cannot change while the resource has live bookings or blocks."
    ),
    SCHEDULE_TIMEZONE_MISMATCH: t(
      "The resource has an active schedule in its current time zone. Deactivate the schedule first."
    ),
    TIMEZONE_INVALID: t("That time zone is not known."),
    CAPACITY_REDUCTION_NOT_ALLOWED: t(
      "Capacity can only grow. Deactivate a unit instead of removing it."
    ),
    RESOURCE_DELETED: t("This resource is deleted. Restore it first."),
    RESOURCE_IN_USE: t(
      "The resource has live bookings or blocks. Cancel or release them, or set it to inactive."
    ),
    RESOURCE_NOT_FOUND: t("That resource no longer exists."),
    POOL_NOT_EMPTY: t("The pool still has resources. Move them out first."),
    POOL_DELETED: t("The pool is deleted. Restore the pool first."),
    POOL_NOT_FOUND: t("That pool no longer exists."),
    UNIT_NOT_FOUND: t("That unit does not belong to this resource."),
    OFFERING_DELETED: t("This offering is deleted. Restore it first."),
    OFFERING_NOT_FOUND: t("That offering no longer exists."),
    BLOCK_CONFLICT: t(
      "Some of those nights are already booked or blocked. Nothing was changed."
    ),
    BLOCK_NOT_FOUND: t("That block no longer exists."),
    BOOKING_MODE_MISMATCH: t("Blocked nights apply to stay resources only."),
    SCHEDULE_OVERLAP: t(
      "An active schedule already covers part of that period. Shorten or deactivate it first."
    ),
    SCHEDULE_NOT_EDITABLE: t("This schedule can no longer be changed."),
    INVALID_STATE: t(
      "The booking is no longer in a state that allows that. Reload the page."
    ),
    HOLD_EXPIRED: t("The hold has expired."),
    RESERVATION_NOT_FOUND: t("That reservation no longer exists."),
    CONSTRAINT_VIOLATED: t("The values break a rule of the booking setup."),
    GUARD_REFUSED: t("The database refused this change.")
  };
}
