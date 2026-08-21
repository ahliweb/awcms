/**
 * The mail this module sends (ADR-0103).
 *
 * ## The template key is a `derived.*` category
 *
 * `email`'s base categories are fixed; a domain module registers its own with
 * `registerDerivedEmailTemplateCategory` and an explicit variable allow-list.
 * The allow-list is what stops a template author interpolating something the
 * renderer was never told about — an unrecognised variable is a validation
 * error, never "no restriction".
 *
 * Two variables and no more. `confirmUrl` carries the bearer token, and
 * `siteName` is what makes the mail recognisable to somebody who subscribes to
 * several newsrooms. An address is deliberately NOT a variable: the message is
 * already addressed to it, and putting it in the body would put it in the
 * rendered copy the outbox retains.
 *
 * Pure module: no database, no I/O.
 */

export const NEWSLETTER_CONFIRMATION_TEMPLATE_KEY =
  "derived.newsletter_confirmation";

export const NEWSLETTER_CONFIRMATION_VARIABLES = [
  "confirmUrl",
  "siteName"
] as const;

/**
 * The path a subscriber follows from their inbox.
 *
 * A GET-able page rather than a POST-only endpoint, because an email client
 * offers a link and nothing else. The page is what turns the click into the
 * confirming request.
 */
export const NEWSLETTER_CONFIRM_PATH = "/newsletter/confirm";
export const NEWSLETTER_UNSUBSCRIBE_PATH = "/newsletter/unsubscribe";

function buildTokenUrl(origin: string, path: string, token: string): string {
  const url = new URL(path, origin);
  url.searchParams.set("token", token);
  return url.toString();
}

export function buildConfirmationUrl(origin: string, token: string): string {
  return buildTokenUrl(origin, NEWSLETTER_CONFIRM_PATH, token);
}

export function buildUnsubscribeUrl(origin: string, token: string): string {
  return buildTokenUrl(origin, NEWSLETTER_UNSUBSCRIBE_PATH, token);
}
