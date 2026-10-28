/**
 * `channel_accounts` constants (Issue #1140, ADR-0148 capability C1).
 *
 * Single source of truth shared by the module descriptor, the route guards and
 * `sql/319`'s catalog seed — the three that must agree or a guard denies every
 * caller including the owner.
 */
export const CHANNEL_ACCOUNTS_MODULE_KEY = "channel_accounts";

export const ACCOUNTS_ACTIVITY_CODE = "accounts";
export const CAPABILITIES_ACTIVITY_CODE = "capabilities";
export const CREDENTIALS_ACTIVITY_CODE = "credentials";
export const ASSIGNMENTS_ACTIVITY_CODE = "assignments";

/**
 * The guards, one per seeded permission. `AccessAction` is a CLOSED vocabulary
 * shared by every module (and the high-risk classification hangs off it), so
 * the pack's working names map onto it: connect -> `create`, disconnect ->
 * `revoke`, capabilities.grant -> `configure`, assignments.manage -> `assign`.
 * `credentials.manage` keeps `manage`. All but `read` and `create` are
 * classified high-risk by the chokepoint.
 *
 * The guards, one per seeded permission. `credentials.manage` and
 * `capabilities.grant` are the high-risk ones (audited at `warning`);
 * `credentials.manage` additionally carries `requiresMfaEnrolment` in the
 * descriptor and a conditional step-up in its route (ADR-0141 section 4).
 */
export const CHANNEL_ACCOUNTS_GUARDS = {
  read: {
    moduleKey: CHANNEL_ACCOUNTS_MODULE_KEY,
    activityCode: ACCOUNTS_ACTIVITY_CODE,
    action: "read" as const
  },
  connect: {
    moduleKey: CHANNEL_ACCOUNTS_MODULE_KEY,
    activityCode: ACCOUNTS_ACTIVITY_CODE,
    action: "create" as const
  },
  disconnect: {
    moduleKey: CHANNEL_ACCOUNTS_MODULE_KEY,
    activityCode: ACCOUNTS_ACTIVITY_CODE,
    action: "revoke" as const
  },
  grantCapability: {
    moduleKey: CHANNEL_ACCOUNTS_MODULE_KEY,
    activityCode: CAPABILITIES_ACTIVITY_CODE,
    action: "configure" as const
  },
  manageCredentials: {
    moduleKey: CHANNEL_ACCOUNTS_MODULE_KEY,
    activityCode: CREDENTIALS_ACTIVITY_CODE,
    action: "manage" as const
  },
  manageAssignments: {
    moduleKey: CHANNEL_ACCOUNTS_MODULE_KEY,
    activityCode: ASSIGNMENTS_ACTIVITY_CODE,
    action: "assign" as const
  }
} as const;

/** Off by default, like every provider-facing capability of ADR-0148. */
export function isChannelAccountsEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.CHANNEL_ACCOUNTS_ENABLED === "true";
}

/** The environment variable that holds the secret key ring (ADR-0148 section 5). */
export const CHANNEL_SECRETS_KEY_RING_ENV = "CHANNEL_SECRETS_ENCRYPTION_KEYS";

/** Prefix of the field-encryption `purpose`; the secret's own purpose is appended, so a ciphertext cannot be re-labelled. */
export const CHANNEL_SECRET_AAD_PURPOSE_PREFIX = "channel_secret:v1:";

export const CHANNEL_SECRET_PURPOSES = [
  "provider_access_token",
  "provider_refresh_token",
  "api_token",
  "device_key",
  "bot_token",
  "webhook_signing_secret",
  "oauth_pkce_verifier",
  "oauth_authorization_code"
] as const;

export type ChannelSecretPurpose = (typeof CHANNEL_SECRET_PURPOSES)[number];

export const AUTH_MODES = [
  "oauth2",
  "api_token",
  "bot_token",
  "device_key"
] as const;

export type ChannelAuthMode = (typeof AUTH_MODES)[number];

export const ACCOUNT_STATUSES = [
  "pending",
  "connected",
  "degraded",
  "revoked",
  "disabled",
  "deleted"
] as const;

export type ChannelAccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const GRANT_STATES = [
  "pending",
  "active",
  "expired",
  "revoked",
  "failed"
] as const;

export type ChannelGrantState = (typeof GRANT_STATES)[number];

export const ASSIGNMENT_KINDS = ["owner", "operator", "viewer"] as const;

export type ChannelAssignmentKind = (typeof ASSIGNMENT_KINDS)[number];

export const HEALTH_STATES = ["ok", "degraded", "failing", "unknown"] as const;

export type ChannelHealthState = (typeof HEALTH_STATES)[number];

export const WEBHOOK_VERIFICATION_MODES = [
  "hmac_signature",
  "secret_header",
  "challenge",
  "unauthenticated"
] as const;

export type ChannelWebhookVerificationMode =
  (typeof WEBHOOK_VERIFICATION_MODES)[number];

/** The OAuth `state` lives this long. Short on purpose: it is a bearer credential in a URL (T1). */
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;

/** A refresh lease: long enough for one provider round trip, short enough that a crashed refresher does not block the next one for long (T12). */
export const REFRESH_LEASE_SECONDS = 30;

/** Largest accepted credential, in characters. Real tokens are far shorter; this bounds abuse of the write-only endpoint. */
export const MAX_SECRET_LENGTH = 4096;

export const MAX_SCOPES = 64;
