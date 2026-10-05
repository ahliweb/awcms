/**
 * Supplier identifier pipeline (Issue #888, ADR-0128): normalize -> hash ->
 * mask, the SAME three functions `profile_identity` uses for
 * `awcms_profile_identifiers`, so a tax number is masked one way everywhere.
 *
 * The raw value is stored (RLS-protected) so the audited reveal endpoint can
 * return it; every other surface reads `masked_value` only. The hash exists for
 * dedup/lookup and is NEVER returned.
 */
import {
  hashIdentifierValue,
  maskIdentifierValue,
  normalizeIdentifierValue,
  type IdentifierType
} from "../../profile-identity/domain/identifier";
import type { SupplierIdentifierType } from "./procurement-types";

/**
 * The profile-identity type whose normalisation/masking fits ours. NEVER
 * `email`: a contact reference that happens to be an address must take the
 * generic tail mask — `masked_value` is shown to readers who hold only
 * `suppliers.read`, and the email mask publishes the domain and first letter.
 */
const PROFILE_TYPE: Readonly<Record<SupplierIdentifierType, IdentifierType>> = {
  tax_id: "tax_id",
  business_id: "external_code",
  payment_ref: "other",
  contact_ref: "other",
  other: "other"
};

/**
 * Types whose short values are not shown even as a tail (audit L3). The shared
 * tail mask keeps the last 4 characters of anything over 4, so a 6-character
 * payment or contact reference would publish two thirds of itself to every
 * `suppliers.read` holder.
 */
const MASK_ENTIRELY_BELOW: Readonly<
  Partial<Record<SupplierIdentifierType, number>>
> = { payment_ref: 8, contact_ref: 8, other: 8 };

export type PreparedIdentifier = {
  normalizedValue: string;
  valueHash: string;
  maskedValue: string;
};

export function prepareIdentifier(
  type: SupplierIdentifierType,
  rawValue: string
): PreparedIdentifier {
  const profileType = PROFILE_TYPE[type];
  const normalizedValue = normalizeIdentifierValue(profileType, rawValue);
  const fullMaskBelow = MASK_ENTIRELY_BELOW[type];
  const maskedValue =
    fullMaskBelow !== undefined && normalizedValue.length < fullMaskBelow
      ? "*".repeat(normalizedValue.length)
      : maskIdentifierValue(normalizedValue, profileType);

  return {
    normalizedValue,
    valueHash: hashIdentifierValue(normalizedValue),
    maskedValue
  };
}
