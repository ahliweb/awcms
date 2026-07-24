/**
 * Pure validation for the tenant domain management API. No I/O here.
 *
 * Hostname validation deliberately does **not** invent a second hostname-shape
 * opinion: it reuses `lib/tenant/public-host-tenant-resolver.ts`'s
 * `normalizePublicHost()` — the exact same lowercase/trim/RFC-1035-shape check
 * the public host resolver applies to an inbound `Host` header — so a hostname
 * this API accepts is guaranteed to be a hostname the resolver could later
 * match against. A raw hostname containing a port (`example.com:8443`) is
 * rejected outright, *before* calling `normalizePublicHost` (which would
 * silently strip the port for Host-header parsing) — a domain/subdomain mapping
 * is a DNS name, never a `Host` header with a port suffix, and silently
 * stripping one here would desync the stored `hostname` column from
 * `normalized_hostname` (the migration 046 CHECK constraint requires
 * `normalized_hostname = lower(btrim(hostname))` exactly).
 */
import { normalizePublicHost } from "../../../lib/tenant/public-host-tenant-resolver";

export type ValidationError = {
  field: string;
  message: string;
};

type Result<T> =
  { valid: true; value: T } | { valid: false; errors: ValidationError[] };

export type TenantDomainType = "subdomain" | "custom_domain";
export type TenantDomainRouteMode = "canonical" | "legacy_blog";
export type TenantDomainVerificationMethod =
  "dns_txt" | "dns_cname" | "file" | "manual";
/**
 * PATCH-only status vocabulary — deliberately excludes `active`. A domain can
 * only ever reach `active` through `POST .../verify` (DNS verification stays
 * manual-first, but is still a distinct, audited, idempotent action — not a
 * side effect of a generic field update).
 */
export type UpdatableTenantDomainStatus =
  "pending_verification" | "suspended" | "failed";

// Exported (admin UI): the create/edit forms build their `<select>` option
// lists from these same arrays rather than re-declaring a second opinion of the
// enum vocabulary — a value the UI can select is guaranteed to be a value this
// validator accepts.
export const TENANT_DOMAIN_TYPES: readonly TenantDomainType[] = [
  "subdomain",
  "custom_domain"
];
export const TENANT_DOMAIN_ROUTE_MODES: readonly TenantDomainRouteMode[] = [
  "canonical",
  "legacy_blog"
];
export const TENANT_DOMAIN_VERIFICATION_METHODS: readonly TenantDomainVerificationMethod[] =
  ["dns_txt", "dns_cname", "file", "manual"];
export const TENANT_DOMAIN_UPDATABLE_STATUSES: readonly UpdatableTenantDomainStatus[] =
  ["pending_verification", "suspended", "failed"];

const DOMAIN_TYPES = TENANT_DOMAIN_TYPES;
const ROUTE_MODES = TENANT_DOMAIN_ROUTE_MODES;
const VERIFICATION_METHODS = TENANT_DOMAIN_VERIFICATION_METHODS;
const UPDATABLE_STATUSES = TENANT_DOMAIN_UPDATABLE_STATUSES;

// DNS TXT record values can legitimately run long (concatenated multi-string
// records); this is a generous defense-in-depth cap, not a DNS-protocol-
// accurate limit — the field is never parsed/executed, only stored and echoed
// back.
const MAX_RECORD_LENGTH = 2000;

export type CreateTenantDomainInput = {
  hostname: string;
  normalizedHostname: string;
  domainType: TenantDomainType;
  routeMode: TenantDomainRouteMode;
  verificationMethod: TenantDomainVerificationMethod | null;
  verificationRecordName: string | null;
  verificationRecordValue: string | null;
  redirectToPrimary: boolean;
};

export type UpdateTenantDomainInput = {
  domainType?: TenantDomainType;
  routeMode?: TenantDomainRouteMode;
  status?: UpdatableTenantDomainStatus;
  verificationMethod?: TenantDomainVerificationMethod | null;
  verificationRecordName?: string | null;
  verificationRecordValue?: string | null;
  redirectToPrimary?: boolean;
};

function validateHostname(
  record: Record<string, unknown>,
  errors: ValidationError[]
): { hostname: string; normalizedHostname: string } | undefined {
  const raw = record.hostname;

  if (typeof raw !== "string" || raw.trim().length === 0) {
    errors.push({ field: "hostname", message: "hostname is required." });
    return undefined;
  }

  const trimmed = raw.trim();

  if (trimmed.includes(":")) {
    errors.push({
      field: "hostname",
      message: "hostname must not include a port."
    });
    return undefined;
  }

  let normalized: string | null;

  try {
    normalized = normalizePublicHost(trimmed);
  } catch {
    // normalizePublicHost() only throws for an empty string, already ruled out
    // above — unreachable in practice, kept as a safety net so this function
    // never throws out of a request-validation path.
    errors.push({
      field: "hostname",
      message: "hostname must be a valid DNS hostname."
    });
    return undefined;
  }

  if (!normalized) {
    errors.push({
      field: "hostname",
      message:
        "hostname must be a valid DNS hostname (RFC 1035 shape, no IPv6 literal)."
    });
    return undefined;
  }

  return { hostname: trimmed, normalizedHostname: normalized };
}

function validateRecordString(
  field: string,
  value: unknown,
  errors: ValidationError[]
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > MAX_RECORD_LENGTH
  ) {
    errors.push({
      field,
      message: `${field} must be a non-empty string up to ${MAX_RECORD_LENGTH} characters, or null.`
    });
    return null;
  }

  return value.trim();
}

/** Tri-state helper for PATCH: field omitted -> leave unchanged; `null` -> clear; string -> validate + set. */
function validateUpdateRecordString(
  field: string,
  value: unknown,
  errors: ValidationError[]
): { present: boolean; value: string | null } {
  if (value === undefined) {
    return { present: false, value: null };
  }

  if (value === null) {
    return { present: true, value: null };
  }

  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > MAX_RECORD_LENGTH
  ) {
    errors.push({
      field,
      message: `${field} must be a non-empty string up to ${MAX_RECORD_LENGTH} characters, or null.`
    });
    return { present: false, value: null };
  }

  return { present: true, value: value.trim() };
}

export function validateCreateTenantDomainInput(
  body: unknown
): Result<CreateTenantDomainInput> {
  const errors: ValidationError[] = [];
  const record = (body ?? {}) as Record<string, unknown>;

  const hostnameResult = validateHostname(record, errors);

  let domainType: TenantDomainType = "custom_domain";
  if (record.domainType !== undefined) {
    if (
      typeof record.domainType !== "string" ||
      !DOMAIN_TYPES.includes(record.domainType as TenantDomainType)
    ) {
      errors.push({
        field: "domainType",
        message: `domainType must be one of ${DOMAIN_TYPES.join(", ")}.`
      });
    } else {
      domainType = record.domainType as TenantDomainType;
    }
  }

  let routeMode: TenantDomainRouteMode = "canonical";
  if (record.routeMode !== undefined) {
    if (
      typeof record.routeMode !== "string" ||
      !ROUTE_MODES.includes(record.routeMode as TenantDomainRouteMode)
    ) {
      errors.push({
        field: "routeMode",
        message: `routeMode must be one of ${ROUTE_MODES.join(", ")}.`
      });
    } else {
      routeMode = record.routeMode as TenantDomainRouteMode;
    }
  }

  let verificationMethod: TenantDomainVerificationMethod | null = null;
  if (
    record.verificationMethod !== undefined &&
    record.verificationMethod !== null
  ) {
    if (
      typeof record.verificationMethod !== "string" ||
      !VERIFICATION_METHODS.includes(
        record.verificationMethod as TenantDomainVerificationMethod
      )
    ) {
      errors.push({
        field: "verificationMethod",
        message: `verificationMethod must be one of ${VERIFICATION_METHODS.join(", ")}, or null.`
      });
    } else {
      verificationMethod =
        record.verificationMethod as TenantDomainVerificationMethod;
    }
  }

  const verificationRecordName = validateRecordString(
    "verificationRecordName",
    record.verificationRecordName,
    errors
  );
  const verificationRecordValue = validateRecordString(
    "verificationRecordValue",
    record.verificationRecordValue,
    errors
  );

  let redirectToPrimary = false;
  if (record.redirectToPrimary !== undefined) {
    if (typeof record.redirectToPrimary !== "boolean") {
      errors.push({
        field: "redirectToPrimary",
        message: "redirectToPrimary must be a boolean."
      });
    } else {
      redirectToPrimary = record.redirectToPrimary;
    }
  }

  if (errors.length > 0 || !hostnameResult) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      hostname: hostnameResult.hostname,
      normalizedHostname: hostnameResult.normalizedHostname,
      domainType,
      routeMode,
      verificationMethod,
      verificationRecordName,
      verificationRecordValue,
      redirectToPrimary
    }
  };
}

export function validateUpdateTenantDomainInput(
  body: unknown
): Result<UpdateTenantDomainInput> {
  const errors: ValidationError[] = [];
  const record = (body ?? {}) as Record<string, unknown>;
  const value: UpdateTenantDomainInput = {};

  if (record.domainType !== undefined) {
    if (
      typeof record.domainType !== "string" ||
      !DOMAIN_TYPES.includes(record.domainType as TenantDomainType)
    ) {
      errors.push({
        field: "domainType",
        message: `domainType must be one of ${DOMAIN_TYPES.join(", ")}.`
      });
    } else {
      value.domainType = record.domainType as TenantDomainType;
    }
  }

  if (record.routeMode !== undefined) {
    if (
      typeof record.routeMode !== "string" ||
      !ROUTE_MODES.includes(record.routeMode as TenantDomainRouteMode)
    ) {
      errors.push({
        field: "routeMode",
        message: `routeMode must be one of ${ROUTE_MODES.join(", ")}.`
      });
    } else {
      value.routeMode = record.routeMode as TenantDomainRouteMode;
    }
  }

  if (record.status !== undefined) {
    if (record.status === "active") {
      errors.push({
        field: "status",
        message:
          'status cannot be set to "active" directly — use POST /api/v1/tenant/domains/{id}/verify to activate a domain.'
      });
    } else if (
      typeof record.status !== "string" ||
      !UPDATABLE_STATUSES.includes(record.status as UpdatableTenantDomainStatus)
    ) {
      errors.push({
        field: "status",
        message: `status must be one of ${UPDATABLE_STATUSES.join(", ")} (use POST .../verify to reach "active").`
      });
    } else {
      value.status = record.status as UpdatableTenantDomainStatus;
    }
  }

  if (record.verificationMethod !== undefined) {
    if (record.verificationMethod === null) {
      value.verificationMethod = null;
    } else if (
      typeof record.verificationMethod !== "string" ||
      !VERIFICATION_METHODS.includes(
        record.verificationMethod as TenantDomainVerificationMethod
      )
    ) {
      errors.push({
        field: "verificationMethod",
        message: `verificationMethod must be one of ${VERIFICATION_METHODS.join(", ")}, or null.`
      });
    } else {
      value.verificationMethod =
        record.verificationMethod as TenantDomainVerificationMethod;
    }
  }

  const verificationRecordName = validateUpdateRecordString(
    "verificationRecordName",
    record.verificationRecordName,
    errors
  );
  if (verificationRecordName.present) {
    value.verificationRecordName = verificationRecordName.value;
  }

  const verificationRecordValue = validateUpdateRecordString(
    "verificationRecordValue",
    record.verificationRecordValue,
    errors
  );
  if (verificationRecordValue.present) {
    value.verificationRecordValue = verificationRecordValue.value;
  }

  if (record.redirectToPrimary !== undefined) {
    if (typeof record.redirectToPrimary !== "boolean") {
      errors.push({
        field: "redirectToPrimary",
        message: "redirectToPrimary must be a boolean."
      });
    } else {
      value.redirectToPrimary = record.redirectToPrimary;
    }
  }

  if (errors.length === 0 && Object.keys(value).length === 0) {
    errors.push({
      field: "body",
      message:
        "Provide at least one of domainType, routeMode, status, verificationMethod, verificationRecordName, verificationRecordValue, redirectToPrimary."
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value };
}
