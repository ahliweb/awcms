/**
 * Redirect-rule types + untrusted-input validation (ADR-0039; adapted from
 * awcms-micro ADR-0028 §8). Pure — no I/O. Every write path (create, update, bulk
 * import, URL-change capture) runs its body through here first, so a rule can never
 * be stored in an unsafe or ambiguous shape. The two security-critical fields
 * delegate to their dedicated pure guards: the source path to `normalizeRedirectPath`
 * (CRLF/traversal/Unicode) and the target to `validateRedirectTarget` (the frozen
 * open-redirect guards).
 */
import { isRedirectEligiblePath } from "./redirect-eligibility";
import { normalizeRedirectPath, redirectPathKey } from "./redirect-path";
import {
  validateRedirectTarget,
  type RedirectTargetType
} from "./redirect-target";

export type { RedirectTargetType };

export type RedirectStatusCode = 301 | 302 | 307 | 308;
export type RedirectState = "active" | "inactive" | "archived";
export type RedirectOrigin =
  | "manual"
  | "slug_change"
  | "domain_change"
  | "locale_change"
  | "import"
  | "legacy_blog";

export const ALLOWED_REDIRECT_STATUS_CODES: readonly RedirectStatusCode[] = [
  301, 302, 307, 308
];
export const DEFAULT_REDIRECT_STATUS_CODE: RedirectStatusCode = 301;
export const ALLOWED_REDIRECT_STATES: readonly RedirectState[] = [
  "active",
  "inactive",
  "archived"
];
export const ALLOWED_REDIRECT_ORIGINS: readonly RedirectOrigin[] = [
  "manual",
  "slug_change",
  "domain_change",
  "locale_change",
  "import",
  "legacy_blog"
];

export const MAX_REDIRECT_REASON_LENGTH = 500;
export const MAX_LOCALE_SCOPE_LENGTH = 35;

/** BCP-47-ish locale tag shape (letters, digits, hyphen) — bounded, no pattern engine risk. */
const LOCALE_SCOPE_PATTERN = /^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/;

/** A validated, storage-ready redirect rule (create). */
export type RedirectRuleInput = {
  sourcePath: string;
  normalizedSourcePath: string;
  localeScope: string | null;
  domainScopeHost: string | null;
  targetType: RedirectTargetType;
  target: string;
  statusCode: RedirectStatusCode;
  state: RedirectState;
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
  preserveQuery: boolean;
  reason: string | null;
  origin: RedirectOrigin;
};

/** A validated update to the mutable fields of an existing rule (source is immutable). */
export type RedirectRuleUpdate = {
  localeScope: string | null;
  domainScopeHost: string | null;
  targetType: RedirectTargetType;
  target: string;
  statusCode: RedirectStatusCode;
  state: RedirectState;
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
  preserveQuery: boolean;
  reason: string | null;
};

export type RedirectValidationError = { field: string; message: string };

export type RedirectCreateValidationResult =
  | { ok: true; value: RedirectRuleInput }
  | { ok: false; errors: RedirectValidationError[] };

export type RedirectUpdateValidationResult =
  | { ok: true; value: RedirectRuleUpdate }
  | { ok: false; errors: RedirectValidationError[] };

export type RedirectValidationContext = {
  /** The tenant's verified registered hosts (`normalized_hostname`s), lowercased. */
  allowedHosts: readonly string[];
  /** Default origin/state to apply when the body omits them (create only). */
  defaultOrigin?: RedirectOrigin;
  defaultState?: RedirectState;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function validateStatusCode(
  value: unknown,
  errors: RedirectValidationError[]
): RedirectStatusCode {
  if (value === undefined || value === null)
    return DEFAULT_REDIRECT_STATUS_CODE;
  if (
    typeof value !== "number" ||
    !ALLOWED_REDIRECT_STATUS_CODES.includes(value as RedirectStatusCode)
  ) {
    errors.push({
      field: "statusCode",
      message: `Must be one of ${ALLOWED_REDIRECT_STATUS_CODES.join(", ")}.`
    });
    return DEFAULT_REDIRECT_STATUS_CODE;
  }
  return value as RedirectStatusCode;
}

function validateState(
  value: unknown,
  fallback: RedirectState,
  errors: RedirectValidationError[]
): RedirectState {
  if (value === undefined || value === null) return fallback;
  if (
    typeof value !== "string" ||
    !ALLOWED_REDIRECT_STATES.includes(value as RedirectState)
  ) {
    errors.push({
      field: "state",
      message: `Must be one of ${ALLOWED_REDIRECT_STATES.join(", ")}.`
    });
    return fallback;
  }
  return value as RedirectState;
}

function validateDate(
  value: unknown,
  field: string,
  errors: RedirectValidationError[]
): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    errors.push({ field, message: "Must be an ISO-8601 date string or null." });
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    errors.push({ field, message: "Must be a valid ISO-8601 date string." });
    return null;
  }
  return parsed;
}

function validateLocaleScope(
  value: unknown,
  errors: RedirectValidationError[]
): string | null {
  const normalized = normalizeOptionalString(value);
  if (normalized === null) return null;
  if (
    normalized.length > MAX_LOCALE_SCOPE_LENGTH ||
    !LOCALE_SCOPE_PATTERN.test(normalized)
  ) {
    errors.push({
      field: "localeScope",
      message: "Must be a BCP-47-style locale tag (letters, digits, hyphens)."
    });
    return null;
  }
  return normalized;
}

function validateDomainScope(
  value: unknown,
  allowedHosts: readonly string[],
  errors: RedirectValidationError[]
): string | null {
  const normalized = normalizeOptionalString(value);
  if (normalized === null) return null;
  const lowered = normalized.toLowerCase();
  if (!allowedHosts.map((h) => h.toLowerCase()).includes(lowered)) {
    errors.push({
      field: "domainScopeHost",
      message:
        "Must be one of this tenant's verified domains (server-derived host), or null for all hosts."
    });
    return null;
  }
  return lowered;
}

function validateReason(
  value: unknown,
  errors: RedirectValidationError[]
): string | null {
  const normalized = normalizeOptionalString(value);
  if (normalized === null) return null;
  if (normalized.length > MAX_REDIRECT_REASON_LENGTH) {
    errors.push({
      field: "reason",
      message: `Must be at most ${MAX_REDIRECT_REASON_LENGTH} characters.`
    });
    return null;
  }
  return normalized;
}

function validateOrigin(
  value: unknown,
  fallback: RedirectOrigin,
  errors: RedirectValidationError[]
): RedirectOrigin {
  if (value === undefined || value === null) return fallback;
  if (
    typeof value !== "string" ||
    !ALLOWED_REDIRECT_ORIGINS.includes(value as RedirectOrigin)
  ) {
    errors.push({
      field: "origin",
      message: `Must be one of ${ALLOWED_REDIRECT_ORIGINS.join(", ")}.`
    });
    return fallback;
  }
  return value as RedirectOrigin;
}

const SELF_REDIRECT_ERROR: RedirectValidationError = {
  field: "target",
  message: "A rule may not redirect a path to itself (self-redirect)."
};

/**
 * Cross-field checks shared by create + update: effective window ordering and
 * self-redirect. `normalizedSourcePath` is the rule's source (for update, the
 * immutable existing source); `domainScopeHost` is the rule's optional host scope.
 *
 * A target whose (host, path) re-matches the rule's OWN source scope is a
 * self-redirect and rejected — it would bounce the client forever:
 *  - `relative_same_tenant`: the target path equals the source path (A relative
 *    target implicitly stays on whatever host the request came in on, which is
 *    always within the source's scope).
 *  - `verified_external`: the absolute target's `pathname` equals the source
 *    path AND its host is within the rule's scope (an unscoped rule matches any of
 *    the tenant's hosts, so any own-host target with the same path self-loops; a
 *    host-scoped rule self-loops only when the target host equals that scope host).
 *    This mirrors the resolve-time same-host fold-back in `redirect-chain.ts`.
 */
function validateCrossFields(
  normalizedSourcePath: string,
  domainScopeHost: string | null,
  targetType: RedirectTargetType,
  target: string,
  effectiveFrom: Date | null,
  effectiveUntil: Date | null,
  errors: RedirectValidationError[]
): void {
  if (
    effectiveFrom !== null &&
    effectiveUntil !== null &&
    effectiveFrom.getTime() >= effectiveUntil.getTime()
  ) {
    errors.push({
      field: "effectiveUntil",
      message: "effectiveUntil must be after effectiveFrom."
    });
  }

  if (targetType === "relative_same_tenant") {
    if (redirectPathKey(target) === normalizedSourcePath) {
      errors.push(SELF_REDIRECT_ERROR);
    }
    return;
  }

  // targetType === "verified_external": the target is an absolute URL on one of
  // the tenant's own verified hosts (already asserted by `validateRedirectTarget`).
  let url: URL | null = null;
  try {
    url = new URL(target);
  } catch {
    url = null;
  }
  if (url === null) return;

  const targetPathKey = redirectPathKey(url.pathname);
  const scopeMatchesTargetHost =
    domainScopeHost === null ||
    domainScopeHost.toLowerCase() === url.hostname.toLowerCase();

  if (targetPathKey === normalizedSourcePath && scopeMatchesTargetHost) {
    errors.push(SELF_REDIRECT_ERROR);
  }
}

/** Validate an untrusted create body into a storage-ready `RedirectRuleInput`. */
export function validateRedirectInput(
  body: unknown,
  context: RedirectValidationContext
): RedirectCreateValidationResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      errors: [
        { field: "body", message: "Request body must be a JSON object." }
      ]
    };
  }

  const errors: RedirectValidationError[] = [];

  const rawSource = body.sourcePath;
  const sourceResult =
    typeof rawSource === "string"
      ? normalizeRedirectPath(rawSource)
      : ({ ok: false, reason: "Source path is required." } as const);

  if (!sourceResult.ok) {
    errors.push({ field: "sourcePath", message: sourceResult.reason });
  } else if (!isRedirectEligiblePath(sourceResult.path)) {
    // A redirect must never be able to intercept an admin/API/auth/framework/
    // static/system path — enforce the SAME eligibility gate the resolver applies,
    // now at WRITE time so an ineligible source can never be stored (via create,
    // bulk import, or URL-change capture).
    errors.push({
      field: "sourcePath",
      message:
        "Source path is not eligible for a redirect (admin/API/auth/static/system paths can never be redirected)."
    });
  }

  const targetResult = validateRedirectTarget(
    body.target,
    context.allowedHosts
  );
  if (!targetResult.ok) {
    errors.push({ field: "target", message: targetResult.reason });
  }

  const localeScope = validateLocaleScope(body.localeScope, errors);
  const domainScopeHost = validateDomainScope(
    body.domainScopeHost,
    context.allowedHosts,
    errors
  );
  const statusCode = validateStatusCode(body.statusCode, errors);
  const state = validateState(
    body.state,
    context.defaultState ?? "active",
    errors
  );
  const effectiveFrom = validateDate(
    body.effectiveFrom,
    "effectiveFrom",
    errors
  );
  const effectiveUntil = validateDate(
    body.effectiveUntil,
    "effectiveUntil",
    errors
  );
  const preserveQuery =
    body.preserveQuery === undefined ? false : body.preserveQuery === true;
  const reason = validateReason(body.reason, errors);
  const origin = validateOrigin(
    body.origin,
    context.defaultOrigin ?? "manual",
    errors
  );

  if (sourceResult.ok && targetResult.ok) {
    validateCrossFields(
      sourceResult.path,
      domainScopeHost,
      targetResult.targetType,
      targetResult.target,
      effectiveFrom,
      effectiveUntil,
      errors
    );
  }

  if (errors.length > 0 || !sourceResult.ok || !targetResult.ok) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      sourcePath: (rawSource as string).trim(),
      normalizedSourcePath: sourceResult.path,
      localeScope,
      domainScopeHost,
      targetType: targetResult.targetType,
      target: targetResult.target,
      statusCode,
      state,
      effectiveFrom,
      effectiveUntil,
      preserveQuery,
      reason,
      origin
    }
  };
}

/** Validate an untrusted update body (source path immutable — supplied separately). */
export function validateRedirectUpdate(
  body: unknown,
  normalizedSourcePath: string,
  context: RedirectValidationContext
): RedirectUpdateValidationResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      errors: [
        { field: "body", message: "Request body must be a JSON object." }
      ]
    };
  }

  const errors: RedirectValidationError[] = [];

  const targetResult = validateRedirectTarget(
    body.target,
    context.allowedHosts
  );
  if (!targetResult.ok) {
    errors.push({ field: "target", message: targetResult.reason });
  }

  const localeScope = validateLocaleScope(body.localeScope, errors);
  const domainScopeHost = validateDomainScope(
    body.domainScopeHost,
    context.allowedHosts,
    errors
  );
  const statusCode = validateStatusCode(body.statusCode, errors);
  const state = validateState(body.state, "active", errors);
  const effectiveFrom = validateDate(
    body.effectiveFrom,
    "effectiveFrom",
    errors
  );
  const effectiveUntil = validateDate(
    body.effectiveUntil,
    "effectiveUntil",
    errors
  );
  const preserveQuery =
    body.preserveQuery === undefined ? false : body.preserveQuery === true;
  const reason = validateReason(body.reason, errors);

  if (targetResult.ok) {
    validateCrossFields(
      normalizedSourcePath,
      domainScopeHost,
      targetResult.targetType,
      targetResult.target,
      effectiveFrom,
      effectiveUntil,
      errors
    );
  }

  if (errors.length > 0 || !targetResult.ok) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      localeScope,
      domainScopeHost,
      targetType: targetResult.targetType,
      target: targetResult.target,
      statusCode,
      state,
      effectiveFrom,
      effectiveUntil,
      preserveQuery,
      reason
    }
  };
}
