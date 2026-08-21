import { normalizeIdentifierValue } from "../../profile-identity/domain/identifier";

/**
 * What a reader may submit (ADR-0103, PRD §22/§30).
 *
 * ## The shape check is deliberately shallow
 *
 * It refuses what is obviously not an address and accepts the rest. A stricter
 * regex would reject valid addresses — the grammar is genuinely baroque — and
 * would buy nothing, because the ACTUAL proof that an address exists and belongs
 * to the person who typed it is the double opt-in. A confirmation link nobody
 * follows is the strictest validator there is.
 *
 * ## No consent checkbox default
 *
 * PRD §30 forbids a pre-ticked consent. There is no consent FIELD here at all,
 * which is stronger: consent is recorded when the confirmation link is followed,
 * so it cannot be defaulted, pre-ticked, or inferred from a submission.
 *
 * Pure module: no database, no I/O.
 */

/** Long enough for any real address, short enough that an anonymous endpoint is not a storage primitive. */
export const MAX_SUBSCRIBER_EMAIL_LENGTH = 254;

/** Free-form on purpose — a legacy import wants to say where a row came from, and an enum would need a migration per import. */
export const MAX_SUBSCRIPTION_SOURCE_LENGTH = 64;

export type SubscriptionRequest = {
  /** As typed, for a support conversation. */
  email: string;
  /** Lower-cased and trimmed — every lookup and the unique index use this. */
  emailNormalized: string;
  locale: string | null;
};

export type SubscriptionRequestResult =
  | { valid: true; value: SubscriptionRequest }
  | { valid: false; errors: { field: string; message: string }[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A shallow address shape: something, an `@`, something with a dot, no spaces.
 *
 * The comment above says why this is not stricter. What it MUST catch is input
 * that is not an address at all, because that is what would otherwise reach the
 * mail dispatcher as a recipient.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateSubscriptionRequest(
  body: unknown
): SubscriptionRequestResult {
  if (!isRecord(body)) {
    return {
      valid: false,
      errors: [{ field: "body", message: "Body must be an object." }]
    };
  }

  const errors: { field: string; message: string }[] = [];
  const rawEmail = body.email;

  if (typeof rawEmail !== "string") {
    errors.push({ field: "email", message: "email is required." });
    return { valid: false, errors };
  }

  const email = rawEmail.trim();

  if (email.length === 0 || email.length > MAX_SUBSCRIBER_EMAIL_LENGTH) {
    errors.push({
      field: "email",
      message: `email must be between 1 and ${MAX_SUBSCRIBER_EMAIL_LENGTH} characters.`
    });
  } else if (!EMAIL_SHAPE.test(email)) {
    errors.push({ field: "email", message: "email is not an address." });
  }

  let locale: string | null = null;
  if (body.locale !== undefined && body.locale !== null) {
    if (
      typeof body.locale !== "string" ||
      !/^[a-z]{2}(-[A-Z]{2})?$/.test(body.locale)
    ) {
      errors.push({
        field: "locale",
        message: "locale is not a language tag."
      });
    } else {
      locale = body.locale;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      email,
      // The SAME normalizer the identity module uses, so an address that is one
      // person to `profile_identity` is one subscriber here. A second
      // lower-casing rule would eventually disagree with the first.
      emailNormalized: normalizeIdentifierValue("email", email),
      locale
    }
  };
}
