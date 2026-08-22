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
import { buildVerificationRecordName } from "./domain-verification-challenge";

export type ValidationError = {
  field: string;
  message: string;
};

type Result<T> =
  { valid: true; value: T } | { valid: false; errors: ValidationError[] };

export type TenantDomainType = "subdomain" | "custom_domain";
export type TenantDomainRouteMode = "canonical" | "legacy_blog";
/**
 * ADR-0106 — one method, and it is the one that is actually implemented.
 *
 * `awcms_tenant_domains.verification_method` (migration 046) still accepts
 * `dns_cname`, `file` and `manual`, and the CHECK constraint is left alone: an
 * applied migration is immutable, and the column is documentation of what the
 * schema was willing to hold. What changed is that this application only ever
 * writes, and only ever honours, `dns_txt`.
 *
 * `manual` is gone because it never meant anything. It was the whole of the old
 * check — `verification_method IS NOT NULL` then `status = 'active'` — so a
 * tenant admin could PATCH it onto a row and activate any hostname they liked.
 * `file` is gone because implementing it means this server issuing an HTTP
 * request to a hostname the caller chose, which is SSRF wearing a verification
 * badge; see `dns-txt-verifier.ts`. `dns_cname` is gone because it needs a
 * platform target hostname to point AT, which is per-deployment configuration
 * that does not exist — and a second half-built method would not make the first
 * one any more true.
 */
export type TenantDomainVerificationMethod = "dns_txt";

/** The only method this application writes. */
export const TENANT_DOMAIN_VERIFICATION_METHOD: TenantDomainVerificationMethod =
  "dns_txt";
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
export const TENANT_DOMAIN_UPDATABLE_STATUSES: readonly UpdatableTenantDomainStatus[] =
  ["pending_verification", "suspended", "failed"];

const DOMAIN_TYPES = TENANT_DOMAIN_TYPES;
const ROUTE_MODES = TENANT_DOMAIN_ROUTE_MODES;
const UPDATABLE_STATUSES = TENANT_DOMAIN_UPDATABLE_STATUSES;

export type CreateTenantDomainInput = {
  hostname: string;
  normalizedHostname: string;
  domainType: TenantDomainType;
  routeMode: TenantDomainRouteMode;
  redirectToPrimary: boolean;
};

export type UpdateTenantDomainInput = {
  domainType?: TenantDomainType;
  routeMode?: TenantDomainRouteMode;
  status?: UpdatableTenantDomainStatus;
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

/**
 * Fields the API used to accept and now mints itself (ADR-0106). Supplying one
 * is REFUSED rather than ignored: a caller that sends
 * `verificationRecordValue` believes it has chosen what will be checked, and
 * silently dropping it would leave that belief intact while the server checked
 * something else entirely. A 400 naming the field is the only answer that tells
 * the truth.
 */
const SERVER_MANAGED_FIELDS = [
  "verificationMethod",
  "verificationRecordName",
  "verificationRecordValue"
] as const;

function refuseServerManagedFields(
  record: Record<string, unknown>,
  errors: ValidationError[]
): void {
  for (const field of SERVER_MANAGED_FIELDS) {
    if (record[field] !== undefined) {
      errors.push({
        field,
        message: `${field} is managed by the server and cannot be set — the DNS TXT challenge is minted when the domain is created and re-issued by POST /api/v1/tenant/domains/{id}/verify.`
      });
    }
  }
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

  refuseServerManagedFields(record, errors);

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

  // ADR-0106 — refuse here rather than accepting a row that can never be
  // verified. `_awcms-verify.` + the hostname has to fit in a DNS name, and a
  // hostname that does not leave room for the label is one this platform cannot
  // prove ownership of. Checked at CREATE so the impossible row never exists,
  // which is why `createTenantDomain`'s own mint is infallible.
  if (
    hostnameResult &&
    !buildVerificationRecordName(hostnameResult.normalizedHostname).ok
  ) {
    errors.push({
      field: "hostname",
      message:
        "hostname is too long to carry a DNS verification record and cannot be verified."
    });
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

  refuseServerManagedFields(record, errors);

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
        "Provide at least one of domainType, routeMode, status, redirectToPrimary."
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value };
}
