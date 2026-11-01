/**
 * `channel_accounts` — the account and credential CONTROL PLANE of the
 * omnichannel foundation (Issue #1140, ADR-0148 capability C1).
 *
 * It holds a tenant's connected external accounts, the provider connections
 * (OAuth grants, API-token and device connections) behind them, per-account
 * capability evidence, envelope-encrypted secret REFERENCES, webhook
 * subscription metadata, health and who may operate each account. It sends
 * NOTHING and calls no provider: every channel (WhatsApp senders #1141-#1143,
 * social publishing #1145+, email #1158+) conforms to this one account model.
 */
import { defineModule } from "../_shared/module-contract";
import type { SubjectDataDescriptor } from "../_shared/module-contract";
import {
  ACCOUNTS_ACTIVITY_CODE,
  ASSIGNMENTS_ACTIVITY_CODE,
  CAPABILITIES_ACTIVITY_CODE,
  CHANNEL_ACCOUNTS_MODULE_KEY,
  CREDENTIALS_ACTIVITY_CODE
} from "./domain/channel-accounts-constants";

/** Tenant-user stamps only: the table says nothing ABOUT a person, so anonymising the identity makes each stamp resolve to nobody (ADR-0094). */
function stamps(input: {
  key: string;
  tableName: string;
  columns: string[];
  rationale: string;
}): SubjectDataDescriptor {
  return {
    key: `${CHANNEL_ACCOUNTS_MODULE_KEY}.${input.key}`,
    tableName: input.tableName,
    ownerModuleKey: CHANNEL_ACCOUNTS_MODULE_KEY,
    subjectColumns: input.columns.map((column) => ({
      column,
      references: "tenant_user" as const
    })),
    exportable: false,
    erasure: "severed_with_subject_row",
    rationale: input.rationale
  };
}

export const channelAccountsModule = defineModule({
  key: CHANNEL_ACCOUNTS_MODULE_KEY,
  name: "Channel Accounts",
  version: "0.1.0",
  /**
   * `experimental`: the operator screen is tracked separately (Issue #1154) and
   * ADR-0021 criterion 1 asks every ACTIVE module for an admin screen. This
   * module declares no `navigation` entry until that screen lands in the same
   * change (a nav entry without a page is a permanent 404). The API is complete.
   */
  status: "experimental",
  description:
    "Provider-neutral, tenant-scoped multi-account registry and credential control plane (Issue #1140, ADR-0148 capability C1): connected external accounts (WhatsApp WABA phone numbers and StarSender devices, Pages, profiles, channels, bots, Mailketing ESP logins and their sender identities) unique per live (provider, external id) ACROSS tenants; a brand is a business scope (no new ABAC attribute); provider connections for OAuth 2.0 (single-use state bound to tenant and person, S256 PKCE where offered, fixed server-side redirect URI, verified callback leaving a durable hand-off, server-side refresh lease with bounded backoff, revocation that erases ciphertext and revokes the bound accounts), API tokens, bot tokens and device keys; per-account capability that is FAIL-CLOSED (a missing row is denied, a granted row needs evidence, and the code mirror of the provider matrix v1, held equal to docs/awcms/omnichannel-foundation.md section 3 by a test, has the last word on every use; LinkedIn member data is barred outright); credentials only as `awcms_channel_secrets` references, AES-256-GCM through the shared field-encryption helper behind a `SecretStorePort`, written through a separately grantable, MFA-gated, step-up, idempotent, warning-audited write-only endpoint and never returned, logged, evented or audited; webhook subscription metadata (a provider with no verifiable authentication is status-class only, by CHECK); health; and per-account assignments additive to RBAC/ABAC. It SENDS NOTHING and calls no provider: adapters, the token exchange, dispatch and the admin screen are later issues (#1141-#1154). Off by default (CHANNEL_ACCOUNTS_ENABLED) and needs CHANNEL_SECRETS_ENCRYPTION_KEYS to store a credential.",
  dependencies: ["tenant_admin", "identity_access", "logging"],
  type: "system",
  api: {
    openApiPath: "openapi/modules/channel-accounts.openapi.yaml",
    basePath: "/api/v1/channel-accounts"
  },
  permissions: [
    {
      activityCode: ACCOUNTS_ACTIVITY_CODE,
      action: "read",
      description:
        "Read this tenant's connected channel accounts, provider connections, capabilities and health (never a credential)"
    },
    {
      activityCode: ACCOUNTS_ACTIVITY_CODE,
      action: "create",
      description:
        "Register a channel account, start and complete a provider authorisation, and enable or disable an account"
    },
    {
      activityCode: ACCOUNTS_ACTIVITY_CODE,
      action: "revoke",
      description:
        "Disconnect a channel account or revoke a provider connection, erasing the stored credential (high-risk, audited at warning)"
    },
    {
      activityCode: CAPABILITIES_ACTIVITY_CODE,
      action: "configure",
      description:
        "Record or withdraw what a channel account may do, with the approval or contract evidence for it (high-risk, audited at warning)"
    },
    {
      activityCode: CREDENTIALS_ACTIVITY_CODE,
      action: "manage",
      requiresMfaEnrolment: true,
      description:
        "Write or replace a channel account credential (API token, device key, bot token). Write-only: no API ever returns it (high-risk, MFA enrolment and step-up, audited at warning)"
    },
    {
      activityCode: ASSIGNMENTS_ACTIVITY_CODE,
      action: "assign",
      description: "Assign or unassign who may operate one channel account"
    }
  ],
  jobs: [
    {
      command: "bun run channel-accounts:secrets:rekey",
      schedule: {
        mode: "manual",
        because:
          "A key-rotation action (Issue #1140): run by an operator after adding a new first key to CHANNEL_SECRETS_ENCRYPTION_KEYS, until no secret remains under a non-active key id, and only then is the old key removed. A timer would re-scan an unchanged table forever."
      },
      purpose:
        "Re-encrypt every `awcms_channel_secrets` row whose key id is not the ring's active (first) key onto it, in bounded keyset batches. Idempotent and resumable; refuses to run (exit 1) without the key ring; exits 3 when rows cannot be decrypted under the ring.",
      recommendedSchedule:
        "on demand, after each key rotation; verify the per-key-id counts before retiring the old key",
      environmentNotes:
        "Pure PostgreSQL operation, run as `awcms_app` (DATABASE_URL): no worker role holds any privilege on the channel tables. No network egress. The ring must still contain the old key. Safe in offline/LAN deployments.",
      safeInOfflineLan: true
    }
  ],
  subjectData: [
    stamps({
      key: "accounts",
      tableName: "awcms_channel_accounts",
      columns: ["created_by", "updated_by", "deleted_by"],
      rationale:
        "A tenant's connected external account (a page, a number, a bot). The row describes the account, not a person; its only person-shaped columns are the stamps of the administrators who registered, changed or deleted it. The credential is a reference to another table and is never exported."
    }),
    stamps({
      key: "provider_connections",
      tableName: "awcms_channel_provider_connections",
      columns: ["connected_by"],
      rationale:
        "An authorisation the tenant granted a provider. It records the grant (provider, scopes, expiry, state), not a person; the only person-shaped column is the stamp of the administrator who connected it. Tokens are references and are never exported."
    }),
    stamps({
      key: "capabilities",
      tableName: "awcms_channel_account_capabilities",
      columns: ["granted_by"],
      rationale:
        "What an account may do and the evidence reference for it. The only person-shaped column is the stamp of the administrator who recorded the grant."
    }),
    stamps({
      key: "webhook_subscriptions",
      tableName: "awcms_channel_webhook_subscriptions",
      columns: ["created_by"],
      rationale:
        "How inbound events reach us for one account: a hashed callback token and a verification mode. The only person-shaped column is the stamp of the administrator who created it."
    }),
    stamps({
      key: "secrets",
      tableName: "awcms_channel_secrets",
      columns: ["created_by"],
      rationale:
        "Envelope-encrypted provider credentials. They are the tenant's credentials with a provider, not data about a person; the only person-shaped column is the stamp of the administrator who first stored one. The ciphertext is never exported."
    }),
    stamps({
      key: "oauth_states",
      tableName: "awcms_channel_oauth_states",
      columns: ["initiated_by"],
      rationale:
        "A single-use authorisation nonce (stored as a SHA-256) that expires within minutes. The only person-shaped column is the stamp of the administrator who started the flow."
    }),
    {
      key: `${CHANNEL_ACCOUNTS_MODULE_KEY}.assignments`,
      tableName: "awcms_channel_account_assignments",
      ownerModuleKey: CHANNEL_ACCOUNTS_MODULE_KEY,
      subjectColumns: [
        { column: "tenant_user_id", references: "tenant_user" },
        { column: "created_by", references: "tenant_user" }
      ],
      exportable: true,
      erasure: "hard_delete",
      rationale:
        "Which channel accounts this person may operate, and as what (owner, operator, viewer). It is the person's own access to a business asset, so it is part of a subject-access export; on erasure the row is removed (the account itself belongs to the tenant and is untouched, and removing the last assignment returns an account to tenant-wide visibility, which the tenant's administrators can see in the audit log)."
    }
  ]
});
