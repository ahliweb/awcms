/**
 * Pure tenant OIDC SSO decision logic (Issue #185, epic ERP-readiness
 * enterprise auth #177) — break-glass enforcement at policy-save time,
 * per-provider+per-policy auto-link domain resolution, and admin CRUD input
 * validation. Ported/adapted from awcms-mini `domain/tenant-sso-policy.ts`
 * (Issue #591); `jitProvisioningEnabled` ADDED to the policy shape (issue #185
 * models optional JIT provisioning default-off).
 */

export type ValidationError = { field: string; message: string };

const PROVIDER_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Break-glass enforcement (issue's own acceptance criterion). Applied at the
// point the tenant policy is SAVED (`tenant-auth-policy.ts`), not merely at
// login time — an admin must not even be able to persist a policy that would
// lock everyone out if the configured SSO provider has an outage.
// ---------------------------------------------------------------------------

export type BreakGlassRequirementInput = {
  passwordLoginEnabled: boolean;
  ssoRequired: boolean;
  breakGlassIdentityIds: string[];
  /**
   * Count of ids the caller has confirmed, via a fresh DB lookup, resolve to a
   * currently `active` identity with an `active` tenant_user membership in THIS
   * tenant — i.e. an identity that can still complete a local password login.
   */
  eligibleBreakGlassCount: number;
};

export type BreakGlassRequirementResult =
  { outcome: "ok" } | { outcome: "invalid"; reason: "break_glass_required" };

/**
 * A tenant policy requires at least one eligible break-glass local owner
 * whenever it would otherwise be possible for every identity to be locked out
 * of local password login: `sso_required=true` OR `password_login_enabled=false`.
 */
export function evaluateBreakGlassRequirement(
  input: BreakGlassRequirementInput
): BreakGlassRequirementResult {
  const requiresBreakGlass = input.ssoRequired || !input.passwordLoginEnabled;

  if (!requiresBreakGlass) {
    return { outcome: "ok" };
  }

  if (input.eligibleBreakGlassCount < 1) {
    return { outcome: "invalid", reason: "break_glass_required" };
  }

  return { outcome: "ok" };
}

// ---------------------------------------------------------------------------
// Auto-link-by-email domain resolution — two independent fail-closed layers.
// ---------------------------------------------------------------------------

/**
 * Auto-linking-by-email guardrail. Both layers must agree:
 *  1. `autoLinkVerifiedEmail` (tenant policy master switch) — `false` (default)
 *     means auto-link never happens regardless of any domain list;
 *  2. the email must be VERIFIED, its domain in the PROVIDER's own
 *     `allowed_email_domains`, AND — if the tenant policy's own
 *     `allowedEmailDomains` is non-empty — additionally appear there too.
 */
export function isAutoLinkAllowedForProvider(
  autoLinkVerifiedEmail: boolean,
  emailVerified: boolean,
  isProviderDomainAllowed: boolean,
  policyAllowedDomains: readonly string[],
  domain: string | null
): boolean {
  if (
    !autoLinkVerifiedEmail ||
    !emailVerified ||
    !isProviderDomainAllowed ||
    domain === null
  ) {
    return false;
  }

  if (policyAllowedDomains.length === 0) {
    return true;
  }

  return policyAllowedDomains.includes(domain);
}

// ---------------------------------------------------------------------------
// Admin CRUD input validation
// ---------------------------------------------------------------------------

function validateBoundedString(
  value: unknown,
  field: string,
  maxLength: number
): { valid: true; value: string } | { valid: false; message: string } {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { valid: false, message: `${field} is required.` };
  }

  const trimmed = value.trim();

  if (trimmed.length > maxLength) {
    return {
      valid: false,
      message: `${field} must be at most ${maxLength} characters.`
    };
  }

  return { valid: true, value: trimmed };
}

function validateEmailDomainList(
  value: unknown,
  field: string
): { valid: true; value: string[] } | { valid: false; message: string } {
  if (value === undefined) {
    return { valid: true, value: [] };
  }

  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    return { valid: false, message: `${field} must be an array of strings.` };
  }

  return {
    valid: true,
    value: value
      .map((domain) => domain.trim().toLowerCase())
      .filter((domain) => domain.length > 0)
  };
}

function validateIssuerUrl(
  value: unknown
): { valid: true; value: string } | { valid: false; message: string } {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { valid: false, message: "issuerUrl is required." };
  }

  try {
    const parsed = new URL(value.trim());

    if (parsed.protocol !== "https:") {
      return { valid: false, message: "issuerUrl must use https." };
    }

    if (parsed.username.length > 0 || parsed.password.length > 0) {
      return {
        valid: false,
        message: "issuerUrl must not embed credentials."
      };
    }
  } catch {
    return { valid: false, message: "issuerUrl must be a valid URL." };
  }

  return { valid: true, value: value.trim() };
}

export type CreateAuthProviderInput = {
  providerKey: string;
  displayName: string;
  issuerUrl: string;
  clientId: string;
  clientSecret: string | null;
  clientSecretEnvVar: string | null;
  scopes: string;
  allowedEmailDomains: string[];
  enabled: boolean;
};

export type CreateAuthProviderValidationResult =
  | { valid: true; value: CreateAuthProviderInput }
  | { valid: false; errors: ValidationError[] };

/** Validates the admin `POST /api/v1/auth/sso-providers` body. Exactly one of `clientSecret`/`clientSecretEnvVar` must be provided (mirrors the DB CHECK, checked here first so a bad request gets a clean 400). */
export function validateCreateAuthProviderInput(
  body: unknown
): CreateAuthProviderValidationResult {
  const errors: ValidationError[] = [];
  const record = (body ?? {}) as Record<string, unknown>;

  let providerKey = "";
  if (
    typeof record.providerKey !== "string" ||
    !PROVIDER_KEY_PATTERN.test(record.providerKey)
  ) {
    errors.push({
      field: "providerKey",
      message: "providerKey is required and must match ^[a-z0-9][a-z0-9_-]*$."
    });
  } else {
    providerKey = record.providerKey;
  }

  const displayNameResult = validateBoundedString(
    record.displayName,
    "displayName",
    120
  );
  if (!displayNameResult.valid) {
    errors.push({ field: "displayName", message: displayNameResult.message });
  }

  const issuerUrlResult = validateIssuerUrl(record.issuerUrl);
  if (!issuerUrlResult.valid) {
    errors.push({ field: "issuerUrl", message: issuerUrlResult.message });
  }

  const clientIdResult = validateBoundedString(
    record.clientId,
    "clientId",
    255
  );
  if (!clientIdResult.valid) {
    errors.push({ field: "clientId", message: clientIdResult.message });
  }

  const hasSecret =
    typeof record.clientSecret === "string" && record.clientSecret.length > 0;
  const hasSecretEnvVar =
    typeof record.clientSecretEnvVar === "string" &&
    record.clientSecretEnvVar.trim().length > 0;

  if (hasSecret === hasSecretEnvVar) {
    errors.push({
      field: "clientSecret",
      message:
        "Exactly one of clientSecret or clientSecretEnvVar must be provided."
    });
  }

  const scopes =
    typeof record.scopes === "string" && record.scopes.trim().length > 0
      ? record.scopes.trim()
      : "openid email profile";

  const allowedDomainsResult = validateEmailDomainList(
    record.allowedEmailDomains,
    "allowedEmailDomains"
  );
  if (!allowedDomainsResult.valid) {
    errors.push({
      field: "allowedEmailDomains",
      message: allowedDomainsResult.message
    });
  }

  const enabled = record.enabled === true;

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      providerKey,
      displayName: (displayNameResult as { valid: true; value: string }).value,
      issuerUrl: (issuerUrlResult as { valid: true; value: string }).value,
      clientId: (clientIdResult as { valid: true; value: string }).value,
      clientSecret: hasSecret ? (record.clientSecret as string) : null,
      clientSecretEnvVar: hasSecretEnvVar
        ? (record.clientSecretEnvVar as string).trim()
        : null,
      scopes,
      allowedEmailDomains: (
        allowedDomainsResult as { valid: true; value: string[] }
      ).value,
      enabled
    }
  };
}

export type UpdateAuthProviderInput = Partial<
  Omit<CreateAuthProviderInput, "providerKey">
>;

export type UpdateAuthProviderValidationResult =
  | { valid: true; value: UpdateAuthProviderInput }
  | { valid: false; errors: ValidationError[] };

/** Validates the admin `PATCH /api/v1/auth/sso-providers/{id}` body — every field optional (partial update). */
export function validateUpdateAuthProviderInput(
  body: unknown
): UpdateAuthProviderValidationResult {
  const errors: ValidationError[] = [];
  const record = (body ?? {}) as Record<string, unknown>;
  const value: UpdateAuthProviderInput = {};

  if (record.displayName !== undefined) {
    const result = validateBoundedString(
      record.displayName,
      "displayName",
      120
    );
    if (!result.valid) {
      errors.push({ field: "displayName", message: result.message });
    } else {
      value.displayName = result.value;
    }
  }

  if (record.issuerUrl !== undefined) {
    const result = validateIssuerUrl(record.issuerUrl);
    if (!result.valid) {
      errors.push({ field: "issuerUrl", message: result.message });
    } else {
      value.issuerUrl = result.value;
    }
  }

  if (record.clientId !== undefined) {
    const result = validateBoundedString(record.clientId, "clientId", 255);
    if (!result.valid) {
      errors.push({ field: "clientId", message: result.message });
    } else {
      value.clientId = result.value;
    }
  }

  const hasSecret =
    typeof record.clientSecret === "string" && record.clientSecret.length > 0;
  const hasSecretEnvVar =
    typeof record.clientSecretEnvVar === "string" &&
    record.clientSecretEnvVar.trim().length > 0;

  if (hasSecret || hasSecretEnvVar) {
    if (hasSecret && hasSecretEnvVar) {
      errors.push({
        field: "clientSecret",
        message:
          "Only one of clientSecret or clientSecretEnvVar may be set at a time."
      });
    } else {
      value.clientSecret = hasSecret ? (record.clientSecret as string) : null;
      value.clientSecretEnvVar = hasSecretEnvVar
        ? (record.clientSecretEnvVar as string).trim()
        : null;
    }
  }

  if (record.scopes !== undefined) {
    const result = validateBoundedString(record.scopes, "scopes", 500);
    if (!result.valid) {
      errors.push({ field: "scopes", message: result.message });
    } else {
      value.scopes = result.value;
    }
  }

  if (record.allowedEmailDomains !== undefined) {
    const result = validateEmailDomainList(
      record.allowedEmailDomains,
      "allowedEmailDomains"
    );
    if (!result.valid) {
      errors.push({ field: "allowedEmailDomains", message: result.message });
    } else {
      value.allowedEmailDomains = result.value;
    }
  }

  if (record.enabled !== undefined) {
    if (typeof record.enabled !== "boolean") {
      errors.push({ field: "enabled", message: "enabled must be a boolean." });
    } else {
      value.enabled = record.enabled;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value };
}

export type UpdateTenantAuthPolicyInput = {
  passwordLoginEnabled?: boolean;
  ssoEnabled?: boolean;
  ssoRequired?: boolean;
  autoLinkVerifiedEmail?: boolean;
  jitProvisioningEnabled?: boolean;
  allowedEmailDomains?: string[];
  breakGlassIdentityIds?: string[];
};

export type UpdateTenantAuthPolicyValidationResult =
  | { valid: true; value: UpdateTenantAuthPolicyInput }
  | { valid: false; errors: ValidationError[] };

/** Validates the admin `PATCH /api/v1/auth/sso-policy` body. Break-glass AVAILABILITY (not just shape) is enforced separately by `saveTenantAuthPolicy` (needs a DB read this pure function cannot perform). */
export function validateUpdateTenantAuthPolicyInput(
  body: unknown
): UpdateTenantAuthPolicyValidationResult {
  const errors: ValidationError[] = [];
  const record = (body ?? {}) as Record<string, unknown>;
  const value: UpdateTenantAuthPolicyInput = {};

  const booleanFields = [
    "passwordLoginEnabled",
    "ssoEnabled",
    "ssoRequired",
    "autoLinkVerifiedEmail",
    "jitProvisioningEnabled"
  ] as const;

  for (const field of booleanFields) {
    if (record[field] !== undefined) {
      if (typeof record[field] !== "boolean") {
        errors.push({ field, message: `${field} must be a boolean.` });
      } else {
        value[field] = record[field] as boolean;
      }
    }
  }

  if (record.allowedEmailDomains !== undefined) {
    const result = validateEmailDomainList(
      record.allowedEmailDomains,
      "allowedEmailDomains"
    );
    if (!result.valid) {
      errors.push({ field: "allowedEmailDomains", message: result.message });
    } else {
      value.allowedEmailDomains = result.value;
    }
  }

  if (record.breakGlassIdentityIds !== undefined) {
    if (
      !Array.isArray(record.breakGlassIdentityIds) ||
      !record.breakGlassIdentityIds.every(
        (id) => typeof id === "string" && UUID_PATTERN.test(id)
      )
    ) {
      errors.push({
        field: "breakGlassIdentityIds",
        message: "breakGlassIdentityIds must be an array of identity UUIDs."
      });
    } else {
      value.breakGlassIdentityIds = [
        ...new Set(record.breakGlassIdentityIds as string[])
      ];
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value };
}
