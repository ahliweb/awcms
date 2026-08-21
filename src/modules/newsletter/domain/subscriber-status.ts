/**
 * The subscription lifecycle (ADR-0103).
 *
 * Pure module: no database, no I/O.
 */

export const NEWSLETTER_SUBSCRIBER_STATUSES = [
  /** Submitted, not yet confirmed. Carries no consent record, because none was given. */
  "pending",
  /** Confirmed the double opt-in. The only state that receives mail. */
  "active",
  /** The SUBSCRIBER stopped asking. */
  "unsubscribed",
  /** The OPERATOR or the provider stopped sending — a hard bounce, an abuse report, a legal instruction. */
  "suppressed"
] as const;

export type NewsletterSubscriberStatus =
  (typeof NEWSLETTER_SUBSCRIBER_STATUSES)[number];

export function isNewsletterSubscriberStatus(
  value: unknown
): value is NewsletterSubscriberStatus {
  return (
    typeof value === "string" &&
    (NEWSLETTER_SUBSCRIBER_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * May a fresh subscription overwrite this row?
 *
 * ADR-0103's reason for four states rather than three. Somebody who unsubscribed
 * in March may sign up again in June, and letting them is correct. An address
 * SUPPRESSED for abuse must not be re-addable by whoever is abusing it — and a
 * single `inactive` state would make that a matter of remembering to check
 * rather than of the type.
 *
 * `pending` is resubscribable so a lost confirmation mail can be re-sent, and
 * `active` is too — re-confirming an active subscription changes nothing, which
 * is what makes the endpoint idempotent (FR-NWL-005) rather than an error.
 */
export function canResubscribe(status: NewsletterSubscriberStatus): boolean {
  return status !== "suppressed";
}

/** Only an `active` subscriber receives mail. Everything else is a state that does not. */
export function receivesMail(status: NewsletterSubscriberStatus): boolean {
  return status === "active";
}
