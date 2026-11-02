/**
 * What a website may submit (ADR-0155 sections 2 and 4, contract v1).
 *
 * ## A CLOSED field set
 *
 * An unknown key is a validation error, never silently stored and never
 * echoed back (a reflected, attacker-chosen key name is a small XSS-in-waiting
 * for any client that renders error details). `__proto__` and `constructor`
 * are unknown keys like any other. Nested objects are closed the same way.
 *
 * ## No HTML, no upload, no URL fetch
 *
 * Free text is validated as TEXT: control characters, bidi overrides and
 * tag-shaped input are refused, and the stored value is escaped on output by
 * whoever renders it. Nothing here accepts a file, and nothing here ever
 * fetches a URL: `referrerHost` is a hostname that is checked for SHAPE and
 * stored, never resolved (no SSRF surface exists because no request is made).
 *
 * ## No identity is inferred
 *
 * Every identifier is something the visitor typed into the form. There is no
 * fingerprint, cookie, IP or user-agent field in the contract.
 *
 * ## Shape before proof
 *
 * This runs BEFORE the source token is verified, so a malformed request gets
 * the same answer whether or not the token is valid. Checks that depend on the
 * SOURCE (accepted kinds, the consent copy version it currently shows) run
 * after verification and live in `submission-intake.ts`.
 *
 * Pure module: no database, no I/O.
 */
import { normalizeIdentifierValue } from "../../profile-identity/domain/identifier";
import {
  CONSENT_PURPOSES,
  INTERACTION_TYPES,
  SUBMISSION_KINDS,
  type ConsentPurpose,
  type InteractionType,
  type SubmissionKind
} from "./website-engagement-constants";

export type FieldError = { field: string; message: string };

export type SubmissionContact = {
  name: string | null;
  email: string | null;
  /** Lower-cased and trimmed (the identity module's normalizer). */
  emailNormalized: string | null;
  phone: string | null;
  /** Digits and a leading plus only. */
  phoneNormalized: string | null;
  company: string | null;
  subject: string | null;
  message: string | null;
};

export type SubmissionAttribution = {
  landingPath: string | null;
  referrerHost: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
};

export type SubmissionRequest = {
  sourceToken: string;
  /** Redundant ids a client MAY send. Never trusted: compared with the token's and refused on disagreement. */
  claimedTenantId: string | null;
  claimedSourceId: string | null;
  eventId: string;
  kind: SubmissionKind;
  occurredAt: Date | null;
  locale: string | null;
  topic: string | null;
  contact: SubmissionContact | null;
  interactionType: InteractionType | null;
  consent: {
    purposes: ConsentPurpose[];
    copyVersion: string | null;
    pagePath: string | null;
  };
  attribution: SubmissionAttribution;
  challengeToken: string | null;
  /** True when the honeypot was filled: the caller answers neutrally and stores nothing. */
  honeypotTripped: boolean;
  /** Client-reported fill time. A cheap signal, never proof. */
  fillMs: number | null;
};

export type SubmissionRequestResult =
  | { valid: true; value: SubmissionRequest }
  | { valid: false; errors: FieldError[] };

export const MAX_NAME_LENGTH = 120;
export const MAX_COMPANY_LENGTH = 120;
export const MAX_SUBJECT_LENGTH = 150;
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_EMAIL_LENGTH = 254;
export const MAX_PATH_LENGTH = 200;
export const MAX_UTM_LENGTH = 100;
export const MAX_CHALLENGE_TOKEN_LENGTH = 2048;
/** A form filled in under this many milliseconds is a script, not a person. */
export const MIN_HUMAN_FILL_MS = 1000;
export const MAX_OCCURRED_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_OCCURRED_FUTURE_MS = 5 * 60 * 1000;

const TOP_LEVEL_KEYS = new Set([
  "sourceToken",
  "tenantId",
  "sourceId",
  "eventId",
  "kind",
  "occurredAt",
  "locale",
  "topic",
  "contact",
  "interaction",
  "consent",
  "attribution",
  "challengeToken",
  "honeypot",
  "fillMs"
]);
const CONTACT_KEYS = new Set([
  "name",
  "email",
  "phone",
  "company",
  "subject",
  "message"
]);
const INTERACTION_KEYS = new Set(["type"]);
const CONSENT_KEYS = new Set(["purposes", "copyVersion", "pagePath"]);
const ATTRIBUTION_KEYS = new Set([
  "landingPath",
  "referrerHost",
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "utmTerm",
  "utmContent"
]);

const EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCALE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;
const TOPIC_PATTERN = /^[a-z][a-z0-9_.-]{0,59}$/;
const COPY_VERSION_PATTERN = /^[A-Za-z0-9._-]{1,32}$/;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UTM_PATTERN = /^[A-Za-z0-9 _.\-]{1,100}$/;
const HOST_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
/** Control characters other than tab/newline, and the bidi override/isolate range. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_TEXT = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/;
/** A tag, a comment or a declaration: `<b>`, `</p>`, `<!--`, `<?xml`. */
const MARKUP_SHAPE = /<\s*(?:[/!?]|[A-Za-z])/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownKeys(
  record: Record<string, unknown>,
  allowed: Set<string>
): boolean {
  return Object.keys(record).some((key) => !allowed.has(key));
}

/**
 * One text field: a string, NFC-normalised, trimmed, within bounds, with no
 * control characters and no markup. `null` for an absent optional value.
 */
function readText(
  record: Record<string, unknown>,
  field: string,
  path: string,
  maxLength: number,
  errors: FieldError[],
  options: { multiline?: boolean } = {}
): string | null {
  const raw = record[field];

  if (raw === undefined || raw === null) return null;

  if (typeof raw !== "string") {
    errors.push({ field: path, message: `${path} must be text.` });
    return null;
  }

  const value = raw.normalize("NFC").trim();

  if (value.length === 0) return null;

  if (value.length > maxLength) {
    errors.push({
      field: path,
      message: `${path} must be at most ${maxLength} characters.`
    });
    return null;
  }

  const candidate = options.multiline
    ? value
    : value.replace(/[\n\r\t]/g, "\u0000");

  if (FORBIDDEN_TEXT.test(candidate)) {
    errors.push({
      field: path,
      message: `${path} contains characters that are not allowed.`
    });
    return null;
  }

  if (MARKUP_SHAPE.test(value)) {
    errors.push({ field: path, message: `${path} must not contain markup.` });
    return null;
  }

  return value;
}

/** A site-relative path: starts with `/`, no query, no fragment, no scheme, no control characters. */
function readPath(
  record: Record<string, unknown>,
  field: string,
  path: string,
  errors: FieldError[]
): string | null {
  const raw = record[field];

  if (raw === undefined || raw === null) return null;

  if (
    typeof raw !== "string" ||
    raw.length === 0 ||
    raw.length > MAX_PATH_LENGTH ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    /[?#%@\\\u0000-\u001F\u007F\s<>"]/.test(raw)
  ) {
    errors.push({
      field: path,
      message: `${path} must be a site path without query or fragment.`
    });
    return null;
  }

  return raw;
}

/** DNS hostname SHAPE only. It is stored, never resolved. */
function isHostnameShape(value: string): boolean {
  if (value.length === 0 || value.length > 253) return false;

  return value.split(".").every((label) => HOST_LABEL.test(label));
}

function readContact(
  value: unknown,
  errors: FieldError[]
): SubmissionContact | null {
  if (value === undefined || value === null) return null;

  if (!isRecord(value) || unknownKeys(value, CONTACT_KEYS)) {
    errors.push({ field: "contact", message: "contact is not valid." });
    return null;
  }

  const name = readText(value, "name", "contact.name", MAX_NAME_LENGTH, errors);
  const company = readText(
    value,
    "company",
    "contact.company",
    MAX_COMPANY_LENGTH,
    errors
  );
  const subject = readText(
    value,
    "subject",
    "contact.subject",
    MAX_SUBJECT_LENGTH,
    errors
  );
  const message = readText(
    value,
    "message",
    "contact.message",
    MAX_MESSAGE_LENGTH,
    errors,
    { multiline: true }
  );
  const email = readText(
    value,
    "email",
    "contact.email",
    MAX_EMAIL_LENGTH,
    errors
  );
  const phone = readText(value, "phone", "contact.phone", 32, errors);

  if (email !== null && !EMAIL_SHAPE.test(email)) {
    errors.push({
      field: "contact.email",
      message: "email is not an address."
    });
  }

  let phoneNormalized: string | null = null;

  if (phone !== null) {
    phoneNormalized = normalizeIdentifierValue("phone", phone);
    const digits = phoneNormalized.replace(/\D/g, "");

    if (
      digits.length < 6 ||
      digits.length > 16 ||
      !/^\+?\d+$/.test(phoneNormalized)
    ) {
      errors.push({
        field: "contact.phone",
        message: "phone is not a phone number."
      });
      phoneNormalized = null;
    }
  }

  return {
    name,
    email,
    emailNormalized:
      email !== null ? normalizeIdentifierValue("email", email) : null,
    phone,
    phoneNormalized,
    company,
    subject,
    message
  };
}

function readConsent(
  value: unknown,
  errors: FieldError[]
): SubmissionRequest["consent"] {
  const empty = { purposes: [], copyVersion: null, pagePath: null };

  if (value === undefined || value === null) return empty;

  if (!isRecord(value) || unknownKeys(value, CONSENT_KEYS)) {
    errors.push({ field: "consent", message: "consent is not valid." });
    return empty;
  }

  const purposes: ConsentPurpose[] = [];

  if (value.purposes !== undefined) {
    if (!Array.isArray(value.purposes) || value.purposes.length > 8) {
      errors.push({
        field: "consent.purposes",
        message: "consent.purposes must be a short list."
      });
    } else {
      for (const purpose of value.purposes) {
        if (
          typeof purpose !== "string" ||
          !(CONSENT_PURPOSES as readonly string[]).includes(purpose)
        ) {
          errors.push({
            field: "consent.purposes",
            message: "consent.purposes holds a purpose that is not recognised."
          });
          break;
        }

        if (!purposes.includes(purpose as ConsentPurpose)) {
          purposes.push(purpose as ConsentPurpose);
        }
      }
    }
  }

  let copyVersion: string | null = null;

  if (value.copyVersion !== undefined && value.copyVersion !== null) {
    if (
      typeof value.copyVersion !== "string" ||
      !COPY_VERSION_PATTERN.test(value.copyVersion)
    ) {
      errors.push({
        field: "consent.copyVersion",
        message: "consent.copyVersion is not a version label."
      });
    } else {
      copyVersion = value.copyVersion;
    }
  }

  return {
    purposes,
    copyVersion,
    pagePath: readPath(value, "pagePath", "consent.pagePath", errors)
  };
}

function readAttribution(
  value: unknown,
  errors: FieldError[]
): SubmissionAttribution {
  const empty: SubmissionAttribution = {
    landingPath: null,
    referrerHost: null,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmTerm: null,
    utmContent: null
  };

  if (value === undefined || value === null) return empty;

  if (!isRecord(value) || unknownKeys(value, ATTRIBUTION_KEYS)) {
    errors.push({ field: "attribution", message: "attribution is not valid." });
    return empty;
  }

  const utm = (field: string): string | null => {
    const raw = value[field];

    if (raw === undefined || raw === null) return null;

    if (typeof raw !== "string" || !UTM_PATTERN.test(raw)) {
      errors.push({
        field: `attribution.${field}`,
        message: `attribution.${field} is not valid.`
      });
      return null;
    }

    return raw;
  };

  let referrerHost: string | null = null;
  const rawReferrer = value.referrerHost;

  if (rawReferrer !== undefined && rawReferrer !== null) {
    const lowered =
      typeof rawReferrer === "string" ? rawReferrer.trim().toLowerCase() : "";

    if (!isHostnameShape(lowered)) {
      errors.push({
        field: "attribution.referrerHost",
        message: "attribution.referrerHost must be a hostname."
      });
    } else {
      referrerHost = lowered;
    }
  }

  return {
    landingPath: readPath(
      value,
      "landingPath",
      "attribution.landingPath",
      errors
    ),
    referrerHost,
    utmSource: utm("utmSource"),
    utmMedium: utm("utmMedium"),
    utmCampaign: utm("utmCampaign"),
    utmTerm: utm("utmTerm"),
    utmContent: utm("utmContent")
  };
}

export function validateSubmissionRequest(
  body: unknown,
  now: Date = new Date()
): SubmissionRequestResult {
  if (!isRecord(body)) {
    return {
      valid: false,
      errors: [{ field: "body", message: "Body must be an object." }]
    };
  }

  if (unknownKeys(body, TOP_LEVEL_KEYS)) {
    // Deliberately does not name the offending key.
    return {
      valid: false,
      errors: [
        {
          field: "body",
          message: "Body holds a field that is not part of the contract."
        }
      ]
    };
  }

  const errors: FieldError[] = [];

  const sourceToken = body.sourceToken;

  if (typeof sourceToken !== "string" || sourceToken.length === 0) {
    errors.push({ field: "sourceToken", message: "sourceToken is required." });
  }

  const eventId = body.eventId;

  if (typeof eventId !== "string" || !EVENT_ID_PATTERN.test(eventId)) {
    errors.push({
      field: "eventId",
      message: "eventId must be 8 to 64 letters, digits, dashes or underscores."
    });
  }

  const kind = body.kind;

  if (
    typeof kind !== "string" ||
    !(SUBMISSION_KINDS as readonly string[]).includes(kind)
  ) {
    errors.push({ field: "kind", message: "kind is not recognised." });
  }

  const claimed = (field: "tenantId" | "sourceId"): string | null => {
    const raw = body[field];

    if (raw === undefined || raw === null) return null;

    if (typeof raw !== "string" || !UUID_PATTERN.test(raw)) {
      errors.push({ field, message: `${field} is not an identifier.` });
      return null;
    }

    return raw.toLowerCase();
  };

  const claimedTenantId = claimed("tenantId");
  const claimedSourceId = claimed("sourceId");

  let locale: string | null = null;

  if (body.locale !== undefined && body.locale !== null) {
    if (typeof body.locale !== "string" || !LOCALE_PATTERN.test(body.locale)) {
      errors.push({
        field: "locale",
        message: "locale is not a language tag."
      });
    } else {
      locale = body.locale;
    }
  }

  let topic: string | null = null;

  if (body.topic !== undefined && body.topic !== null) {
    if (typeof body.topic !== "string" || !TOPIC_PATTERN.test(body.topic)) {
      errors.push({ field: "topic", message: "topic is not a topic code." });
    } else {
      topic = body.topic;
    }
  }

  let occurredAt: Date | null = null;

  if (body.occurredAt !== undefined && body.occurredAt !== null) {
    const parsed =
      typeof body.occurredAt === "string" ? new Date(body.occurredAt) : null;

    if (
      !parsed ||
      Number.isNaN(parsed.getTime()) ||
      parsed.getTime() < now.getTime() - MAX_OCCURRED_AGE_MS ||
      parsed.getTime() > now.getTime() + MAX_OCCURRED_FUTURE_MS
    ) {
      errors.push({
        field: "occurredAt",
        message: "occurredAt must be a recent timestamp."
      });
    } else {
      occurredAt = parsed;
    }
  }

  let interactionType: InteractionType | null = null;

  if (body.interaction !== undefined && body.interaction !== null) {
    const interaction = body.interaction;

    if (
      !isRecord(interaction) ||
      unknownKeys(interaction, INTERACTION_KEYS) ||
      typeof interaction.type !== "string" ||
      !(INTERACTION_TYPES as readonly string[]).includes(interaction.type)
    ) {
      errors.push({
        field: "interaction",
        message: "interaction is not valid."
      });
    } else {
      interactionType = interaction.type as InteractionType;
    }
  }

  const contact = readContact(body.contact, errors);
  const consent = readConsent(body.consent, errors);
  const attribution = readAttribution(body.attribution, errors);

  let challengeToken: string | null = null;

  if (body.challengeToken !== undefined && body.challengeToken !== null) {
    if (
      typeof body.challengeToken !== "string" ||
      body.challengeToken.length === 0 ||
      body.challengeToken.length > MAX_CHALLENGE_TOKEN_LENGTH
    ) {
      errors.push({
        field: "challengeToken",
        message: "challengeToken is not valid."
      });
    } else {
      challengeToken = body.challengeToken;
    }
  }

  let fillMs: number | null = null;

  if (body.fillMs !== undefined && body.fillMs !== null) {
    if (
      typeof body.fillMs !== "number" ||
      !Number.isFinite(body.fillMs) ||
      body.fillMs < 0 ||
      body.fillMs > 86_400_000
    ) {
      errors.push({ field: "fillMs", message: "fillMs is not valid." });
    } else {
      fillMs = Math.floor(body.fillMs);
    }
  }

  // Kind-specific shape. Deliberately about the REQUEST, not about any person.
  if (typeof kind === "string") {
    if (kind === "interaction") {
      if (
        interactionType === null &&
        !errors.some((e) => e.field === "interaction")
      ) {
        errors.push({
          field: "interaction",
          message: "interaction.type is required for an interaction."
        });
      }

      if (contact !== null) {
        errors.push({
          field: "contact",
          message: "An interaction carries no contact details."
        });
      }

      if (consent.purposes.length > 0) {
        errors.push({
          field: "consent",
          message: "An interaction carries no consent."
        });
      }
    } else if (SUBMISSION_KINDS.includes(kind as SubmissionKind)) {
      if (interactionType !== null) {
        errors.push({
          field: "interaction",
          message: "Only an interaction carries interaction.type."
        });
      }

      if (
        contact === null ||
        (contact.emailNormalized === null && contact.phoneNormalized === null)
      ) {
        errors.push({
          field: "contact",
          message: "contact needs an email or a phone number."
        });
      }

      if (kind === "contact" && contact !== null && contact.message === null) {
        errors.push({
          field: "contact.message",
          message: "contact.message is required for a contact request."
        });
      }
    }
  }

  if (errors.length > 0) return { valid: false, errors };

  const honeypotRaw = body.honeypot;
  const honeypotTripped =
    honeypotRaw !== undefined &&
    honeypotRaw !== null &&
    !(typeof honeypotRaw === "string" && honeypotRaw.trim() === "");

  return {
    valid: true,
    value: {
      sourceToken: sourceToken as string,
      claimedTenantId,
      claimedSourceId,
      eventId: eventId as string,
      kind: kind as SubmissionKind,
      occurredAt,
      locale,
      topic,
      contact,
      interactionType,
      consent,
      attribution,
      challengeToken,
      honeypotTripped,
      fillMs
    }
  };
}
