/**
 * Pure rules for registering a partner (ADR-0089). No I/O.
 *
 * `awcms_partners` is the registry the platform writes and nobody else can
 * read: the FK from `awcms_partner_managed_tenants` bypasses RLS, so a customer
 * can NAME a partner whose row it will never be able to see. That is what makes
 * "registered partners only" enforceable without handing anybody a directory of
 * the platform's commercial relationships.
 *
 * Until this file existed the registry had exactly one writer — an operator
 * with a psql prompt.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lower-case slug, the spelling `tenant_code` already uses. Not enforced by a
 * CHECK in `sql/116` — which is exactly why it is enforced here: `partner_code`
 * carries a GLOBAL unique index, so a stray space or capital produces a second
 * row that reads like the first one to a human and is a different key to
 * Postgres.
 */
const PARTNER_CODE_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const PARTNER_CODE_MAX_LENGTH = 64;
const DISPLAY_NAME_MAX_LENGTH = 160;

export type PartnerRegistrationError = { field: string; message: string };

export type RegisterPartnerInput = {
  partnerTenantId: string;
  partnerCode: string;
  displayName: string;
};

export type RegisterPartnerValidation =
  | { valid: true; value: RegisterPartnerInput }
  | { valid: false; errors: PartnerRegistrationError[] };

/**
 * Collects EVERY problem rather than failing on the first — the same choice
 * `validateIssueMachineCredentialInput` makes, for the same reason: an operator
 * registering a partner is filling in a form.
 *
 * `status` is deliberately NOT accepted. `sql/116` pins it to `'active'` with a
 * CHECK, and it stays pinned until the PR that ships a READER of suspension
 * widens it. A field the API accepts and the database refuses is worse than no
 * field, and a field the API accepts and the database stores while nothing
 * consults it is worse still.
 */
export function validateRegisterPartnerInput(
  body: unknown
): RegisterPartnerValidation {
  if (typeof body !== "object" || body === null) {
    return {
      valid: false,
      errors: [{ field: "body", message: "Body must be a JSON object." }]
    };
  }

  const input = body as Record<string, unknown>;
  const errors: PartnerRegistrationError[] = [];

  const partnerTenantId =
    typeof input.partnerTenantId === "string"
      ? input.partnerTenantId.trim()
      : "";
  if (!UUID_PATTERN.test(partnerTenantId)) {
    errors.push({
      field: "partnerTenantId",
      message:
        "partnerTenantId must be the uuid of an existing tenant on this deployment."
    });
  }

  const partnerCode =
    typeof input.partnerCode === "string" ? input.partnerCode.trim() : "";
  if (partnerCode.length === 0) {
    errors.push({ field: "partnerCode", message: "partnerCode is required." });
  } else if (partnerCode.length > PARTNER_CODE_MAX_LENGTH) {
    errors.push({
      field: "partnerCode",
      message: `partnerCode must be at most ${PARTNER_CODE_MAX_LENGTH} characters.`
    });
  } else if (!PARTNER_CODE_PATTERN.test(partnerCode)) {
    errors.push({
      field: "partnerCode",
      message:
        "partnerCode must be lower-case letters, digits and hyphens, starting and ending with a letter or digit."
    });
  }

  const displayName =
    typeof input.displayName === "string" ? input.displayName.trim() : "";
  if (displayName.length === 0) {
    errors.push({ field: "displayName", message: "displayName is required." });
  } else if (displayName.length > DISPLAY_NAME_MAX_LENGTH) {
    errors.push({
      field: "displayName",
      message: `displayName must be at most ${DISPLAY_NAME_MAX_LENGTH} characters.`
    });
  }

  if (errors.length > 0) return { valid: false, errors };

  return { valid: true, value: { partnerTenantId, partnerCode, displayName } };
}
