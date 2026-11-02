/**
 * Request-body validation for the consent and suppression endpoints
 * (Issue #963). Strict: unknown keys are rejected, so a body that tries to
 * smuggle a raw `recipientHash` or a status is a 400, not silently ignored.
 */
import {
  normalizePhoneNumber,
  type NormalizedPhone
} from "./whatsapp-recipient";
import type { SuppressionReason } from "./whatsapp-eligibility";
import { isWhatsappRecordUuid, parseBusinessScope } from "./whatsapp-sender";

export type ValidationResult<T> =
  { valid: true; value: T } | { valid: false; errors: string[] };

function checkShape(
  raw: unknown,
  allowedKeys: readonly string[]
): { record: Record<string, unknown> } | { errors: string[] } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { errors: ["Request body must be a JSON object."] };
  }

  const record = raw as Record<string, unknown>;
  const unknown = Object.keys(record).filter((k) => !allowedKeys.includes(k));

  return unknown.length > 0
    ? { errors: [`Unknown field(s): ${unknown.join(", ")}.`] }
    : { record };
}

function phoneErrors(phone: NormalizedPhone): string[] {
  return phone.valid ? [] : [`phone: ${phone.reason}`];
}

export type ConsentGrantInput = {
  phone: string;
  source: string;
  reinstateWithdrawn?: boolean;
  evidenceRef?: string;
};

export function validateConsentGrantInput(
  raw: unknown,
  defaultCountryCode?: string
): ValidationResult<ConsentGrantInput> {
  const shape = checkShape(raw, [
    "phone",
    "source",
    "reinstateWithdrawn",
    "evidenceRef"
  ]);

  if ("errors" in shape) {
    return { valid: false, errors: shape.errors };
  }

  const errors: string[] = [];
  const { phone, source, reinstateWithdrawn, evidenceRef } = shape.record;

  if (
    reinstateWithdrawn !== undefined &&
    typeof reinstateWithdrawn !== "boolean"
  ) {
    errors.push("reinstateWithdrawn must be a boolean.");
  }

  if (
    evidenceRef !== undefined &&
    (typeof evidenceRef !== "string" ||
      evidenceRef.trim().length < 1 ||
      evidenceRef.length > 200)
  ) {
    errors.push("evidenceRef must be 1-200 characters.");
  }

  if (typeof phone !== "string") {
    errors.push("phone is required.");
  } else {
    errors.push(
      ...phoneErrors(normalizePhoneNumber(phone, defaultCountryCode))
    );
  }

  if (typeof source !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(source)) {
    errors.push(
      "source is required: lower-case snake case, at most 64 characters."
    );
  }

  return errors.length > 0
    ? { valid: false, errors }
    : {
        valid: true,
        value: {
          phone: phone as string,
          source: source as string,
          ...(reinstateWithdrawn === true ? { reinstateWithdrawn: true } : {}),
          ...(typeof evidenceRef === "string"
            ? { evidenceRef: evidenceRef.trim() }
            : {})
        }
      };
}

export type ConsentWithdrawInput = Record<string, never>;

export function validateEmptyObject(
  raw: unknown
): ValidationResult<Record<string, never>> {
  if (raw === undefined || raw === null) {
    return { valid: true, value: {} };
  }

  const shape = checkShape(raw, []);

  return "errors" in shape
    ? { valid: false, errors: shape.errors }
    : { valid: true, value: {} };
}

export type SuppressionCreateInput = {
  phone: string;
  reason: Extract<SuppressionReason, "manual" | "stop_reply">;
};

export function validateSuppressionCreateInput(
  raw: unknown,
  defaultCountryCode?: string
): ValidationResult<SuppressionCreateInput> {
  const shape = checkShape(raw, ["phone", "reason"]);

  if ("errors" in shape) {
    return { valid: false, errors: shape.errors };
  }

  const errors: string[] = [];
  const { phone, reason } = shape.record;

  if (typeof phone !== "string") {
    errors.push("phone is required.");
  } else {
    errors.push(
      ...phoneErrors(normalizePhoneNumber(phone, defaultCountryCode))
    );
  }

  // `hard_failure` is written only by the dispatcher on a provider verdict; an
  // operator cannot forge one.
  if (reason !== "manual" && reason !== "stop_reply") {
    errors.push("reason must be one of: manual, stop_reply.");
  }

  return errors.length > 0
    ? { valid: false, errors }
    : {
        valid: true,
        value: {
          phone: phone as string,
          reason: reason as SuppressionCreateInput["reason"]
        }
      };
}

export type SenderPolicyInput = {
  /** `null` is the tenant-wide default. */
  businessScope: { type: string; id: string } | null;
  /** `null` selects the deployment sender for the scope, explicitly. */
  defaultSenderAccountId: string | null;
};

/**
 * `PUT /api/v1/whatsapp/sender-policy` (Issue #1141). BOTH keys are required,
 * even when `null`: leaving one out must not read as "do not change it" or as a
 * decision to use the deployment sender. Strict, so a body that tries to smuggle
 * a token, a phone number id, a device id or a provider name is a 400, never
 * silently ignored: the sender is an account of this tenant, nothing else.
 */
export function validateSenderPolicyInput(
  raw: unknown
): ValidationResult<SenderPolicyInput> {
  const shape = checkShape(raw, ["businessScope", "defaultSenderAccountId"]);

  if ("errors" in shape) {
    return { valid: false, errors: shape.errors };
  }

  const errors: string[] = [];
  const { businessScope, defaultSenderAccountId } = shape.record;

  if (businessScope === undefined) {
    errors.push(
      "businessScope is required (an object, or null for tenant-wide)."
    );
  }

  if (defaultSenderAccountId === undefined) {
    errors.push(
      "defaultSenderAccountId is required (an account id, or null for the deployment sender)."
    );
  }

  const scope = parseBusinessScope(businessScope);

  if (scope === "invalid") {
    errors.push(
      "businessScope must be null or { type: lowercase snake_case, id: uuid }."
    );
  }

  if (
    defaultSenderAccountId !== undefined &&
    defaultSenderAccountId !== null &&
    !isWhatsappRecordUuid(defaultSenderAccountId)
  ) {
    errors.push("defaultSenderAccountId must be a uuid or null.");
  }

  return errors.length > 0
    ? { valid: false, errors }
    : {
        valid: true,
        value: {
          businessScope: scope as SenderPolicyInput["businessScope"],
          defaultSenderAccountId: defaultSenderAccountId as string | null
        }
      };
}
