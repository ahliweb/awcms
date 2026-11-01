/**
 * Request validation for `channel_accounts` (Issue #1140). Pure; no I/O.
 *
 * Every validator is STRICT about unknown fields. That is a security property,
 * not pedantry: a credential-shaped field (`token`, `secret`, `apiKey`) sent to
 * an endpoint that does not take one must be refused loudly instead of being
 * silently ignored, or silently stored somewhere it should not be.
 */
import {
  ASSIGNMENT_KINDS,
  AUTH_MODES,
  MAX_SCOPES,
  MAX_SECRET_LENGTH,
  type ChannelAssignmentKind,
  type ChannelAuthMode
} from "./channel-accounts-constants";
import {
  CHANNEL_CAPABILITIES,
  type CapabilityEvidenceKind,
  type ChannelCapability
} from "./provider-matrix";

export type ValidationError = { field: string; message: string };

export type Validated<T> =
  { valid: true; value: T } | { valid: false; errors: ValidationError[] };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROVIDER_PATTERN = /^[a-z][a-z0-9_]{1,31}$/;
const KIND_PATTERN = /^[a-z][a-z0-9_]{1,47}$/;
const SCOPE_TYPE_PATTERN = /^[a-z][a-z0-9_]*$/;
// An OAuth scope string as providers spell them: letters, digits and the
// separators providers use. No whitespace (it separates scopes), no control chars.
const SCOPE_PATTERN = /^[A-Za-z0-9_.:/\-]{1,200}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const EVIDENCE_KINDS: readonly CapabilityEvidenceKind[] = [
  "scope_list_hash",
  "app_review_reference",
  "contract_reference",
  "written_authorization"
];

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownFields(
  body: Record<string, unknown>,
  allowed: readonly string[]
): ValidationError[] {
  return Object.keys(body)
    .filter((key) => !allowed.includes(key))
    .map((key) => ({ field: key, message: "Unknown field." }));
}

function text(
  body: Record<string, unknown>,
  field: string,
  errors: ValidationError[],
  options: { min: number; max: number }
): string | null {
  const raw = body[field];

  if (typeof raw !== "string") {
    errors.push({ field, message: "Must be a string." });

    return null;
  }

  const value = raw.trim();

  if (
    value.length < options.min ||
    value.length > options.max ||
    CONTROL_CHARS.test(value)
  ) {
    errors.push({
      field,
      message: `Must be ${options.min} to ${options.max} printable characters.`
    });

    return null;
  }

  return value;
}

export type BusinessScopeInput = { type: string; id: string };

function businessScope(
  body: Record<string, unknown>,
  errors: ValidationError[]
): BusinessScopeInput | null {
  const raw = body.businessScope;

  if (raw === undefined || raw === null) return null;

  if (!isRecord(raw)) {
    errors.push({ field: "businessScope", message: "Must be an object." });

    return null;
  }

  const extra = unknownFields(raw, ["type", "id"]).map((error) => ({
    ...error,
    field: `businessScope.${error.field}`
  }));

  errors.push(...extra);

  if (typeof raw.type !== "string" || !SCOPE_TYPE_PATTERN.test(raw.type)) {
    errors.push({
      field: "businessScope.type",
      message: "Must be lower snake case."
    });
  }

  if (!isUuid(raw.id)) {
    errors.push({ field: "businessScope.id", message: "Must be a UUID." });
  }

  return typeof raw.type === "string" && isUuid(raw.id)
    ? { type: raw.type, id: raw.id.toLowerCase() }
    : null;
}

function nullableUuid(
  body: Record<string, unknown>,
  field: string,
  errors: ValidationError[]
): string | null {
  const raw = body[field];

  if (raw === undefined || raw === null) return null;

  if (!isUuid(raw)) {
    errors.push({ field, message: "Must be a UUID." });

    return null;
  }

  return raw.toLowerCase();
}

// ---------------------------------------------------------------------------
// Account registration
// ---------------------------------------------------------------------------

export type CreateAccountInput = {
  provider: string;
  accountKind: string;
  authMode: ChannelAuthMode;
  externalId: string;
  displayName: string;
  businessScope: BusinessScopeInput | null;
  connectionId: string | null;
  parentAccountId: string | null;
};

export function validateCreateAccount(
  raw: unknown
): Validated<CreateAccountInput> {
  if (!isRecord(raw)) {
    return {
      valid: false,
      errors: [{ field: "body", message: "Must be a JSON object." }]
    };
  }

  const errors = unknownFields(raw, [
    "provider",
    "accountKind",
    "authMode",
    "externalId",
    "displayName",
    "businessScope",
    "connectionId",
    "parentAccountId"
  ]);

  const provider = text(raw, "provider", errors, { min: 2, max: 32 });
  const accountKind = text(raw, "accountKind", errors, { min: 2, max: 48 });
  const externalId = text(raw, "externalId", errors, { min: 1, max: 256 });
  const displayName = text(raw, "displayName", errors, { min: 1, max: 200 });
  const authMode = raw.authMode;

  if (provider !== null && !PROVIDER_PATTERN.test(provider)) {
    errors.push({ field: "provider", message: "Must be lower snake case." });
  }

  if (accountKind !== null && !KIND_PATTERN.test(accountKind)) {
    errors.push({ field: "accountKind", message: "Must be lower snake case." });
  }

  if (
    typeof authMode !== "string" ||
    !(AUTH_MODES as readonly string[]).includes(authMode)
  ) {
    errors.push({
      field: "authMode",
      message: `Must be one of ${AUTH_MODES.join(", ")}.`
    });
  }

  const scope = businessScope(raw, errors);
  const connectionId = nullableUuid(raw, "connectionId", errors);
  const parentAccountId = nullableUuid(raw, "parentAccountId", errors);

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    value: {
      provider: provider!,
      accountKind: accountKind!,
      authMode: authMode as ChannelAuthMode,
      externalId: externalId!,
      displayName: displayName!,
      businessScope: scope,
      connectionId,
      parentAccountId
    }
  };
}

export type UpdateAccountInput = {
  displayName: string | null;
  /** Only `disabled` and `pending` are operator-settable: `connected`/`degraded` are earned by verification, `revoked`/`deleted` have their own endpoints. */
  status: "disabled" | "pending" | null;
};

export function validateUpdateAccount(
  raw: unknown
): Validated<UpdateAccountInput> {
  if (!isRecord(raw)) {
    return {
      valid: false,
      errors: [{ field: "body", message: "Must be a JSON object." }]
    };
  }

  const errors = unknownFields(raw, ["displayName", "status"]);
  let displayName: string | null = null;
  let status: UpdateAccountInput["status"] = null;

  if (raw.displayName !== undefined) {
    displayName = text(raw, "displayName", errors, { min: 1, max: 200 });
  }

  if (raw.status !== undefined) {
    if (raw.status === "disabled" || raw.status === "pending") {
      status = raw.status;
    } else {
      errors.push({
        field: "status",
        message: "Only 'disabled' or 'pending' can be set here."
      });
    }
  }

  if (errors.length === 0 && displayName === null && status === null) {
    errors.push({ field: "body", message: "Nothing to change." });
  }

  return errors.length > 0
    ? { valid: false, errors }
    : { valid: true, value: { displayName, status } };
}

// ---------------------------------------------------------------------------
// Credential (write-only)
// ---------------------------------------------------------------------------

export type WriteCredentialInput = { secret: string };

/**
 * The ONE field that carries a credential in this whole API. Whitespace INSIDE
 * is refused (a pasted token with a newline is a typo, and a trailing newline
 * becomes part of an Authorization header later); surrounding whitespace is
 * trimmed. The value is never echoed in an error message.
 */
export function validateWriteCredential(
  raw: unknown
): Validated<WriteCredentialInput> {
  if (!isRecord(raw)) {
    return {
      valid: false,
      errors: [{ field: "body", message: "Must be a JSON object." }]
    };
  }

  const errors = unknownFields(raw, ["secret"]);
  const secret = typeof raw.secret === "string" ? raw.secret.trim() : null;

  if (
    secret === null ||
    secret.length < 8 ||
    Buffer.byteLength(secret, "utf8") > MAX_SECRET_LENGTH ||
    /\s/.test(secret) ||
    CONTROL_CHARS.test(secret)
  ) {
    errors.push({
      field: "secret",
      message: `Must be 8 to ${MAX_SECRET_LENGTH} bytes (UTF-8) with no whitespace.`
    });
  }

  return errors.length > 0
    ? { valid: false, errors }
    : { valid: true, value: { secret: secret! } };
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export type SetCapabilityInput = {
  state: "granted" | "pending_approval" | "denied";
  evidenceKind: CapabilityEvidenceKind | null;
  evidenceRef: string | null;
};

export function isCapability(value: unknown): value is ChannelCapability {
  return (
    typeof value === "string" &&
    (CHANNEL_CAPABILITIES as readonly string[]).includes(value)
  );
}

export function validateSetCapability(
  raw: unknown
): Validated<SetCapabilityInput> {
  if (!isRecord(raw)) {
    return {
      valid: false,
      errors: [{ field: "body", message: "Must be a JSON object." }]
    };
  }

  const errors = unknownFields(raw, ["state", "evidenceKind", "evidenceRef"]);
  const state = raw.state;

  if (
    state !== "granted" &&
    state !== "pending_approval" &&
    state !== "denied"
  ) {
    errors.push({
      field: "state",
      message: "Must be 'granted', 'pending_approval' or 'denied'."
    });
  }

  let evidenceKind: CapabilityEvidenceKind | null = null;
  let evidenceRef: string | null = null;

  if (raw.evidenceKind !== undefined && raw.evidenceKind !== null) {
    if (
      typeof raw.evidenceKind === "string" &&
      (EVIDENCE_KINDS as readonly string[]).includes(raw.evidenceKind)
    ) {
      evidenceKind = raw.evidenceKind as CapabilityEvidenceKind;
    } else {
      errors.push({
        field: "evidenceKind",
        message: `Must be one of ${EVIDENCE_KINDS.join(", ")}.`
      });
    }
  }

  if (raw.evidenceRef !== undefined && raw.evidenceRef !== null) {
    evidenceRef = text(raw, "evidenceRef", errors, { min: 1, max: 200 });
  }

  // Evidence is required to GRANT and meaningless otherwise: asking for it on a
  // denial would make withdrawing a capability harder than granting one.
  if (state === "granted" && (evidenceKind === null || evidenceRef === null)) {
    errors.push({
      field: "evidenceRef",
      message: "A granted capability requires evidenceKind and evidenceRef."
    });
  }

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    value: {
      state: state as SetCapabilityInput["state"],
      evidenceKind: state === "granted" ? evidenceKind : null,
      evidenceRef: state === "granted" ? evidenceRef : null
    }
  };
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

export type AssignmentInput = {
  tenantUserId: string;
  kind: ChannelAssignmentKind;
};

export function validateAssignment(raw: unknown): Validated<AssignmentInput> {
  if (!isRecord(raw)) {
    return {
      valid: false,
      errors: [{ field: "body", message: "Must be a JSON object." }]
    };
  }

  const errors = unknownFields(raw, ["tenantUserId", "kind"]);

  if (!isUuid(raw.tenantUserId)) {
    errors.push({ field: "tenantUserId", message: "Must be a UUID." });
  }

  if (
    typeof raw.kind !== "string" ||
    !(ASSIGNMENT_KINDS as readonly string[]).includes(raw.kind)
  ) {
    errors.push({
      field: "kind",
      message: `Must be one of ${ASSIGNMENT_KINDS.join(", ")}.`
    });
  }

  return errors.length > 0
    ? { valid: false, errors }
    : {
        valid: true,
        value: {
          tenantUserId: (raw.tenantUserId as string).toLowerCase(),
          kind: raw.kind as ChannelAssignmentKind
        }
      };
}

// ---------------------------------------------------------------------------
// OAuth start
// ---------------------------------------------------------------------------

export type OAuthStartInput = {
  provider: string;
  scopes: string[];
  businessScope: BusinessScopeInput | null;
};

/** The redirect URI is deliberately NOT an input: it is this deployment's own fixed callback (T1). */
export function validateOAuthStart(raw: unknown): Validated<OAuthStartInput> {
  if (!isRecord(raw)) {
    return {
      valid: false,
      errors: [{ field: "body", message: "Must be a JSON object." }]
    };
  }

  const errors = unknownFields(raw, ["provider", "scopes", "businessScope"]);
  const provider = text(raw, "provider", errors, { min: 2, max: 32 });

  if (provider !== null && !PROVIDER_PATTERN.test(provider)) {
    errors.push({ field: "provider", message: "Must be lower snake case." });
  }

  const scopes: string[] = [];

  if (!Array.isArray(raw.scopes)) {
    errors.push({ field: "scopes", message: "Must be an array of scopes." });
  } else if (raw.scopes.length > MAX_SCOPES) {
    errors.push({
      field: "scopes",
      message: `At most ${MAX_SCOPES} scopes.`
    });
  } else {
    for (const scope of raw.scopes) {
      if (typeof scope === "string" && SCOPE_PATTERN.test(scope)) {
        scopes.push(scope);
      } else {
        errors.push({ field: "scopes", message: "Contains an invalid scope." });
        break;
      }
    }
  }

  const scope = businessScope(raw, errors);

  return errors.length > 0
    ? { valid: false, errors }
    : {
        valid: true,
        value: {
          provider: provider!,
          scopes: [...new Set(scopes)].sort(),
          businessScope: scope
        }
      };
}

// ---------------------------------------------------------------------------
// OAuth callback query
// ---------------------------------------------------------------------------

export type OAuthCallbackQuery = {
  state: string;
  code: string | null;
  providerError: boolean;
};

export function validateOAuthCallbackQuery(
  params: URLSearchParams
): Validated<OAuthCallbackQuery> {
  const state = params.get("state");
  const code = params.get("code");
  const errors: ValidationError[] = [];

  if (!state || state.length > 512 || CONTROL_CHARS.test(state)) {
    errors.push({ field: "state", message: "Missing or invalid state." });
  }

  if (
    code !== null &&
    (Buffer.byteLength(code, "utf8") > MAX_SECRET_LENGTH ||
      CONTROL_CHARS.test(code))
  ) {
    errors.push({ field: "code", message: "Invalid code." });
  }

  return errors.length > 0
    ? { valid: false, errors }
    : {
        valid: true,
        value: {
          state: state!,
          code,
          providerError: params.get("error") !== null
        }
      };
}

// ---------------------------------------------------------------------------
// List queries
// ---------------------------------------------------------------------------

export type ListAccountsQuery = {
  provider: string | null;
  status: string | null;
  limit: number;
  cursor: string | null;
};

export function validateListAccountsQuery(
  params: URLSearchParams
): Validated<ListAccountsQuery> {
  const errors: ValidationError[] = [];
  const provider = params.get("provider");
  const status = params.get("status");
  const limitRaw = params.get("limit");
  let limit = 50;

  if (provider !== null && !PROVIDER_PATTERN.test(provider)) {
    errors.push({ field: "provider", message: "Must be lower snake case." });
  }

  if (status !== null && !/^[a-z]{3,16}$/.test(status)) {
    errors.push({ field: "status", message: "Invalid status." });
  }

  if (limitRaw !== null) {
    const parsed = Number(limitRaw);

    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      errors.push({ field: "limit", message: "Must be an integer 1-100." });
    } else {
      limit = parsed;
    }
  }

  return errors.length > 0
    ? { valid: false, errors }
    : {
        valid: true,
        value: { provider, status, limit, cursor: params.get("cursor") }
      };
}
