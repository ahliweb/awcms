/**
 * Account registry, health, credentials and assignments for `channel_accounts`
 * (Issue #1140, ADR-0148). Every function takes the caller's TENANT TRANSACTION
 * (`tx`, RLS bound) plus the tenant id, and filters by that tenant id again:
 * RLS is the wall, the explicit filter is the second wall.
 *
 * Nothing here calls a provider, and nothing returns a credential. A credential
 * enters through {@link writeAccountCredential} (write-only) and leaves only
 * through `SecretStorePort.resolve`, which no API route imports.
 */
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  keysetCursorCreatedAtSql
} from "../../_shared/keyset-pagination";
import type {
  ChannelAssignmentKind,
  ChannelAuthMode,
  ChannelHealthState,
  ChannelSecretPurpose
} from "../domain/channel-accounts-constants";
import { checkAccountShape } from "../domain/provider-matrix";
import type {
  AssignmentInput,
  CreateAccountInput,
  ListAccountsQuery,
  UpdateAccountInput
} from "../domain/channel-accounts-validation";
import type { SecretStorePort } from "./secret-store";

export type AccountView = {
  id: string;
  businessScope: { type: string; id: string } | null;
  provider: string;
  accountKind: string;
  externalId: string;
  displayName: string;
  authMode: ChannelAuthMode;
  connectionId: string | null;
  parentAccountId: string | null;
  status: string;
  statusReason: string | null;
  /** Whether a credential is stored. The reference itself and the value never leave the module. */
  hasCredential: boolean;
  connectedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

type AccountRow = {
  id: string;
  business_scope_type: string | null;
  business_scope_id: string | null;
  provider: string;
  account_kind: string;
  external_id: string;
  display_name: string;
  auth_mode: ChannelAuthMode;
  connection_id: string | null;
  parent_account_id: string | null;
  secret_id: string | null;
  status: string;
  status_reason: string | null;
  connected_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
  updated_at: Date;
  version: number;
  created_at_cursor?: string;
};

function toView(row: AccountRow): AccountView {
  return {
    id: row.id,
    businessScope:
      row.business_scope_type && row.business_scope_id
        ? { type: row.business_scope_type, id: row.business_scope_id }
        : null,
    provider: row.provider,
    accountKind: row.account_kind,
    externalId: row.external_id,
    displayName: row.display_name,
    authMode: row.auth_mode,
    connectionId: row.connection_id,
    parentAccountId: row.parent_account_id,
    status: row.status,
    statusReason: row.status_reason,
    hasCredential: row.secret_id !== null,
    connectedAt: row.connected_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    version: row.version
  };
}

/** What the capability and credential paths need from an account, including the secret reference (internal use only). */
export type AccountRecord = AccountView & { secretId: string | null };

function toRecord(row: AccountRow): AccountRecord {
  return { ...toView(row), secretId: row.secret_id };
}

/** Drops the internal secret reference: the only shape that may leave the module. */
export function toPublicAccount(record: AccountRecord): AccountView {
  const { secretId: _secretId, ...view } = record;

  return view;
}

export async function fetchAccountRecord(
  tx: Bun.SQL,
  tenantId: string,
  accountId: string
): Promise<AccountRecord | null> {
  const rows = (await tx`
    SELECT id, business_scope_type, business_scope_id, provider, account_kind,
           external_id, display_name, auth_mode, connection_id, parent_account_id,
           secret_id, status, status_reason, connected_at, revoked_at,
           created_at, updated_at, version
    FROM awcms_channel_accounts
    WHERE tenant_id = ${tenantId} AND id = ${accountId}
      AND deleted_at IS NULL
  `) as AccountRow[];

  return rows.length === 0 ? null : toRecord(rows[0]!);
}

// ---------------------------------------------------------------------------
// Visibility: assignments are ADDITIVE to the permission checks
// ---------------------------------------------------------------------------

/**
 * An account with NO assignment is tenant-wide: the permission alone decides.
 * An account with at least one assignment is restricted to its assignees, plus
 * anyone who holds `assignments.manage` (`bypass`, resolved by the route from the
 * permission check, never from a client flag).
 */
export async function isAccountVisibleTo(
  tx: Bun.SQL,
  tenantId: string,
  accountId: string,
  tenantUserId: string,
  bypass: boolean,
  minimumKind: ChannelAssignmentKind = "viewer"
): Promise<boolean> {
  if (bypass) return true;

  const rows = (await tx`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (
        WHERE tenant_user_id = ${tenantUserId}
          AND (${minimumKind} = 'viewer'
               OR kind IN ('owner', 'operator') AND ${minimumKind} = 'operator'
               OR kind = 'owner' AND ${minimumKind} = 'owner')
      )::int AS mine
    FROM awcms_channel_account_assignments
    WHERE tenant_id = ${tenantId} AND account_id = ${accountId}
  `) as { total: number; mine: number }[];

  const row = rows[0]!;

  return row.total === 0 || row.mine > 0;
}

// ---------------------------------------------------------------------------
// Create / list / update
// ---------------------------------------------------------------------------

export type CreateAccountOutcome =
  | { outcome: "created"; account: AccountView }
  | {
      outcome: "refused";
      code:
        | "PROVIDER_UNKNOWN"
        | "PROVIDER_NOT_REGISTRABLE"
        | "ACCOUNT_KIND_INVALID"
        | "AUTH_MODE_INVALID"
        | "CONNECTION_NOT_FOUND"
        | "CONNECTION_MISMATCH"
        | "CONNECTION_REQUIRED"
        | "PARENT_REQUIRED"
        | "PARENT_INVALID"
        | "ACCOUNT_ALREADY_REGISTERED";
    };

export async function createAccount(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  input: CreateAccountInput
): Promise<CreateAccountOutcome> {
  const shape = checkAccountShape(
    input.provider,
    input.accountKind,
    input.authMode
  );

  if (!shape.ok) return { outcome: "refused", code: shape.code };

  // OAuth accounts hang off a connection (the token holder); the other modes
  // carry their own credential and may not claim one.
  if (input.authMode === "oauth2") {
    if (!input.connectionId) {
      return { outcome: "refused", code: "CONNECTION_REQUIRED" };
    }

    const connection = (await tx`
      SELECT provider, auth_mode FROM awcms_channel_provider_connections
      WHERE tenant_id = ${tenantId} AND id = ${input.connectionId}
    `) as { provider: string; auth_mode: string }[];

    if (connection.length === 0) {
      return { outcome: "refused", code: "CONNECTION_NOT_FOUND" };
    }

    if (
      connection[0]!.provider !== input.provider ||
      connection[0]!.auth_mode !== "oauth2"
    ) {
      return { outcome: "refused", code: "CONNECTION_MISMATCH" };
    }
  } else if (input.connectionId) {
    return { outcome: "refused", code: "CONNECTION_MISMATCH" };
  }

  if (shape.parentKind) {
    if (!input.parentAccountId) {
      return { outcome: "refused", code: "PARENT_REQUIRED" };
    }

    const parent = (await tx`
      SELECT provider, account_kind FROM awcms_channel_accounts
      WHERE tenant_id = ${tenantId} AND id = ${input.parentAccountId}
        AND deleted_at IS NULL
    `) as { provider: string; account_kind: string }[];

    if (
      parent.length === 0 ||
      parent[0]!.provider !== input.provider ||
      parent[0]!.account_kind !== shape.parentKind
    ) {
      return { outcome: "refused", code: "PARENT_INVALID" };
    }
  } else if (input.parentAccountId) {
    return { outcome: "refused", code: "PARENT_INVALID" };
  }

  const rows = (await tx`
    INSERT INTO awcms_channel_accounts
      (tenant_id, business_scope_type, business_scope_id, provider,
       account_kind, external_id, display_name, auth_mode, connection_id,
       parent_account_id, created_by, updated_by)
    VALUES (${tenantId}, ${input.businessScope?.type ?? null},
            ${input.businessScope?.id ?? null}, ${input.provider},
            ${input.accountKind}, ${input.externalId}, ${input.displayName},
            ${input.authMode}, ${input.connectionId}, ${input.parentAccountId},
            ${actorTenantUserId}, ${actorTenantUserId})
    ON CONFLICT (provider, external_id) WHERE deleted_at IS NULL DO NOTHING
    RETURNING id, business_scope_type, business_scope_id, provider,
              account_kind, external_id, display_name, auth_mode,
              connection_id, parent_account_id, secret_id, status,
              status_reason, connected_at, revoked_at, created_at,
              updated_at, version
  `) as AccountRow[];

  // One generic answer for "already yours" and "another tenant holds it": the
  // conflict must not reveal which (ADR-0148 I1, T6).
  if (rows.length === 0) {
    return { outcome: "refused", code: "ACCOUNT_ALREADY_REGISTERED" };
  }

  return { outcome: "created", account: toView(rows[0]!) };
}

export type ListAccountsResult =
  | { ok: true; items: AccountView[]; nextCursor: string | null }
  | { ok: false; code: "INVALID_CURSOR" };

export async function listAccounts(
  tx: Bun.SQL,
  tenantId: string,
  viewer: { tenantUserId: string; bypass: boolean },
  query: ListAccountsQuery
): Promise<ListAccountsResult> {
  const cursor = query.cursor ? decodeKeysetCursor(query.cursor) : null;

  if (query.cursor && !cursor) return { ok: false, code: "INVALID_CURSOR" };

  const rows = (await tx`
    SELECT acc.id, acc.business_scope_type, acc.business_scope_id,
           acc.provider, acc.account_kind, acc.external_id, acc.display_name,
           acc.auth_mode, acc.connection_id, acc.parent_account_id,
           acc.secret_id, acc.status, acc.status_reason, acc.connected_at,
           acc.revoked_at, acc.created_at, acc.updated_at, acc.version,
           ${tx.unsafe(keysetCursorCreatedAtSql("acc"))} AS created_at_cursor
    FROM awcms_channel_accounts AS acc
    WHERE acc.tenant_id = ${tenantId}
      AND acc.deleted_at IS NULL
      AND (${query.provider}::text IS NULL OR acc.provider = ${query.provider})
      AND (${query.status}::text IS NULL OR acc.status = ${query.status})
      AND (${cursor?.createdAt ?? null}::timestamptz IS NULL
           OR (acc.created_at, acc.id) <
              (${cursor?.createdAt ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
      AND (
        ${viewer.bypass}::boolean
        OR NOT EXISTS (
          SELECT 1 FROM awcms_channel_account_assignments AS a
          WHERE a.tenant_id = acc.tenant_id AND a.account_id = acc.id)
        OR EXISTS (
          SELECT 1 FROM awcms_channel_account_assignments AS a
          WHERE a.tenant_id = acc.tenant_id AND a.account_id = acc.id
            AND a.tenant_user_id = ${viewer.tenantUserId})
      )
    ORDER BY acc.created_at DESC, acc.id DESC
    LIMIT ${query.limit + 1}
  `) as AccountRow[];

  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];

  return {
    ok: true,
    items: page.map(toView),
    nextCursor:
      rows.length > query.limit && last
        ? encodeKeysetCursor(last.created_at_cursor!, last.id)
        : null
  };
}

export type UpdateAccountOutcome =
  | { outcome: "updated"; account: AccountView }
  | { outcome: "not_found" }
  | { outcome: "refused"; code: "ACCOUNT_STATE_INVALID" };

export async function updateAccount(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  accountId: string,
  input: UpdateAccountInput
): Promise<UpdateAccountOutcome> {
  const current = await fetchAccountRecord(tx, tenantId, accountId);

  if (!current) return { outcome: "not_found" };

  // `disabled` is reachable from any live state; `pending` (re-enable) only from
  // `disabled`, and it STAYS pending until a verification marks it connected:
  // re-enabling never skips the check that an account still works.
  if (
    input.status !== null &&
    ((input.status === "disabled" &&
      (current.status === "revoked" || current.status === "disabled")) ||
      (input.status === "pending" && current.status !== "disabled"))
  ) {
    return { outcome: "refused", code: "ACCOUNT_STATE_INVALID" };
  }

  const rows = (await tx`
    UPDATE awcms_channel_accounts
    SET display_name = COALESCE(${input.displayName}, display_name),
        status = COALESCE(${input.status}, status),
        status_reason = CASE WHEN ${input.status}::text IS NULL
                             THEN status_reason ELSE NULL END,
        connected_at = CASE WHEN ${input.status}::text IS NULL
                            THEN connected_at ELSE NULL END,
        updated_by = ${actorTenantUserId}, updated_at = now(),
        version = version + 1
    WHERE tenant_id = ${tenantId} AND id = ${accountId} AND deleted_at IS NULL
    RETURNING id, business_scope_type, business_scope_id, provider,
              account_kind, external_id, display_name, auth_mode,
              connection_id, parent_account_id, secret_id, status,
              status_reason, connected_at, revoked_at, created_at,
              updated_at, version
  `) as AccountRow[];

  return rows.length === 0
    ? { outcome: "not_found" }
    : { outcome: "updated", account: toView(rows[0]!) };
}

// ---------------------------------------------------------------------------
// Credentials (write-only)
// ---------------------------------------------------------------------------

const CREDENTIAL_PURPOSE: Partial<
  Record<ChannelAuthMode, ChannelSecretPurpose>
> = {
  api_token: "api_token",
  bot_token: "bot_token",
  device_key: "device_key"
};

export type WriteCredentialOutcome =
  | { outcome: "written"; replaced: boolean; version: number }
  | { outcome: "not_found" }
  | {
      outcome: "refused";
      code: "CREDENTIAL_NOT_APPLICABLE" | "ACCOUNT_STATE_INVALID";
    };

/**
 * Stores or replaces an account's own credential. The plaintext exists only in
 * this call's arguments and the store's encrypt step. An OAuth account has no
 * credential of its own (its tokens belong to the connection), and a revoked or
 * disabled account cannot be re-armed by writing one: re-enabling is a separate,
 * audited step.
 */
export async function writeAccountCredential(
  tx: Bun.SQL,
  store: SecretStorePort,
  tenantId: string,
  actorTenantUserId: string,
  accountId: string,
  plaintext: string
): Promise<WriteCredentialOutcome> {
  const account = await fetchAccountRecord(tx, tenantId, accountId);

  if (!account) return { outcome: "not_found" };

  const purpose = CREDENTIAL_PURPOSE[account.authMode];

  if (!purpose) {
    return { outcome: "refused", code: "CREDENTIAL_NOT_APPLICABLE" };
  }

  if (account.status === "revoked" || account.status === "disabled") {
    return { outcome: "refused", code: "ACCOUNT_STATE_INVALID" };
  }

  if (account.secretId) {
    const replaced = await store.replace(tx, {
      tenantId,
      secretId: account.secretId,
      purpose,
      plaintext
    });

    if (replaced) {
      await tx`
        UPDATE awcms_channel_accounts
        SET updated_by = ${actorTenantUserId}, updated_at = now(),
            version = version + 1
        WHERE tenant_id = ${tenantId} AND id = ${accountId}
      `;

      return { outcome: "written", replaced: true, version: replaced.version };
    }
  }

  const ref = await store.put(tx, {
    tenantId,
    purpose,
    plaintext,
    createdBy: actorTenantUserId
  });

  await tx`
    UPDATE awcms_channel_accounts
    SET secret_id = ${ref.secretId}, updated_by = ${actorTenantUserId},
        updated_at = now(), version = version + 1
    WHERE tenant_id = ${tenantId} AND id = ${accountId}
  `;

  return { outcome: "written", replaced: false, version: ref.version };
}

// ---------------------------------------------------------------------------
// Disconnect / delete
// ---------------------------------------------------------------------------

/** Clears the reference, THEN deletes the ciphertext (the FK would refuse the reverse). */
async function eraseAccountCredential(
  tx: Bun.SQL,
  store: SecretStorePort,
  tenantId: string,
  accountId: string,
  secretId: string | null
): Promise<void> {
  if (!secretId) return;

  await tx`
    UPDATE awcms_channel_accounts SET secret_id = NULL
    WHERE tenant_id = ${tenantId} AND id = ${accountId}
  `;
  await store.remove(tx, tenantId, secretId);
}

export type DisconnectOutcome =
  | { outcome: "disconnected"; account: AccountView; credentialErased: boolean }
  | { outcome: "not_found" }
  | { outcome: "refused"; code: "ACCOUNT_STATE_INVALID" };

/**
 * Disconnect: the account becomes `revoked`, its OWN credential is erased, its
 * webhook subscriptions are revoked, and every later capability check fails on
 * the status. Capability rows are kept as history; they cannot be used again.
 * Idempotent in effect (a second call is `ACCOUNT_STATE_INVALID`).
 */
export async function disconnectAccount(
  tx: Bun.SQL,
  store: SecretStorePort,
  tenantId: string,
  actorTenantUserId: string,
  accountId: string
): Promise<DisconnectOutcome> {
  const account = await fetchAccountRecord(tx, tenantId, accountId);

  if (!account) return { outcome: "not_found" };
  if (account.status === "revoked") {
    return { outcome: "refused", code: "ACCOUNT_STATE_INVALID" };
  }

  await tx`
    UPDATE awcms_channel_accounts
    SET status = 'revoked', status_reason = 'DISCONNECTED', revoked_at = now(),
        connected_at = NULL, updated_by = ${actorTenantUserId},
        updated_at = now(), version = version + 1
    WHERE tenant_id = ${tenantId} AND id = ${accountId}
  `;
  await tx`
    UPDATE awcms_channel_webhook_subscriptions
    SET status = 'revoked', updated_at = now()
    WHERE tenant_id = ${tenantId} AND account_id = ${accountId}
      AND status <> 'revoked'
  `;
  await eraseAccountCredential(
    tx,
    store,
    tenantId,
    accountId,
    account.secretId
  );

  const refreshed = await fetchAccountRecord(tx, tenantId, accountId);

  return {
    outcome: "disconnected",
    account: toPublicAccount(refreshed!),
    credentialErased: account.secretId !== null
  };
}

export type DeleteOutcome =
  | { outcome: "deleted" }
  | { outcome: "not_found" }
  | {
      outcome: "refused";
      code: "ACCOUNT_STATE_INVALID" | "HAS_CHILD_ACCOUNTS";
    };

/** Soft delete. Only an account that is not serving traffic can be deleted, and never one that still has live children. */
export async function deleteAccount(
  tx: Bun.SQL,
  store: SecretStorePort,
  tenantId: string,
  actorTenantUserId: string,
  accountId: string
): Promise<DeleteOutcome> {
  const account = await fetchAccountRecord(tx, tenantId, accountId);

  if (!account) return { outcome: "not_found" };
  if (account.status === "connected" || account.status === "degraded") {
    return { outcome: "refused", code: "ACCOUNT_STATE_INVALID" };
  }

  const children = (await tx`
    SELECT 1 FROM awcms_channel_accounts
    WHERE tenant_id = ${tenantId} AND parent_account_id = ${accountId}
      AND deleted_at IS NULL
    LIMIT 1
  `) as unknown[];

  if (children.length > 0) {
    return { outcome: "refused", code: "HAS_CHILD_ACCOUNTS" };
  }

  await eraseAccountCredential(
    tx,
    store,
    tenantId,
    accountId,
    account.secretId
  );
  await tx`
    UPDATE awcms_channel_webhook_subscriptions
    SET status = 'revoked', updated_at = now()
    WHERE tenant_id = ${tenantId} AND account_id = ${accountId}
      AND status <> 'revoked'
  `;
  await tx`
    UPDATE awcms_channel_accounts
    SET status = 'deleted', deleted_at = now(), deleted_by = ${actorTenantUserId},
        updated_by = ${actorTenantUserId}, updated_at = now(),
        version = version + 1
    WHERE tenant_id = ${tenantId} AND id = ${accountId}
  `;

  return { outcome: "deleted" };
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export type AccountHealthView = {
  accountId: string;
  state: ChannelHealthState;
  reasonCode: string | null;
  checkedAt: string;
  tokenExpiresAt: string | null;
  quotaRemaining: number | null;
  quotaLimit: number | null;
};

export async function fetchAccountHealth(
  tx: Bun.SQL,
  tenantId: string,
  accountId: string
): Promise<AccountHealthView | null> {
  const rows = (await tx`
    SELECT account_id, state, reason_code, checked_at, token_expires_at,
           quota_remaining::float8 AS quota_remaining,
           quota_limit::float8 AS quota_limit
    FROM awcms_channel_account_health
    WHERE tenant_id = ${tenantId} AND account_id = ${accountId}
  `) as {
    account_id: string;
    state: ChannelHealthState;
    reason_code: string | null;
    checked_at: Date;
    token_expires_at: Date | null;
    quota_remaining: number | null;
    quota_limit: number | null;
  }[];

  const row = rows[0];

  return row
    ? {
        accountId: row.account_id,
        state: row.state,
        reasonCode: row.reason_code,
        checkedAt: row.checked_at.toISOString(),
        tokenExpiresAt: row.token_expires_at?.toISOString() ?? null,
        quotaRemaining: row.quota_remaining,
        quotaLimit: row.quota_limit
      }
    : null;
}

export type RecordHealthInput = {
  state: ChannelHealthState;
  /** A fixed code (`TOKEN_EXPIRED`), never provider text. */
  reasonCode: string | null;
  tokenExpiresAt?: Date | null;
  quotaRemaining?: number | null;
  quotaLimit?: number | null;
};

/**
 * Called by health jobs and dispatch failures of provider connectors (NOT by an
 * HTTP route: a person cannot assert that an account works). It records the
 * latest health and moves the account between `pending`/`connected`/`degraded`:
 *
 *   ok       pending|degraded -> connected
 *   degraded connected        -> degraded
 *   failing  connected        -> degraded
 *   unknown  no status change
 *
 * `revoked`, `disabled` and `deleted` are NEVER changed by health: a stale
 * success report cannot resurrect an account somebody turned off.
 */
export async function recordAccountHealth(
  tx: Bun.SQL,
  tenantId: string,
  accountId: string,
  input: RecordHealthInput
): Promise<{ recorded: boolean }> {
  const account = await fetchAccountRecord(tx, tenantId, accountId);

  if (!account) return { recorded: false };

  await tx`
    INSERT INTO awcms_channel_account_health
      (tenant_id, account_id, state, reason_code, checked_at,
       token_expires_at, quota_remaining, quota_limit)
    VALUES (${tenantId}, ${accountId}, ${input.state}, ${input.reasonCode},
            now(), ${input.tokenExpiresAt ?? null},
            ${input.quotaRemaining ?? null}, ${input.quotaLimit ?? null})
    ON CONFLICT (tenant_id, account_id) DO UPDATE
    SET state = EXCLUDED.state, reason_code = EXCLUDED.reason_code,
        checked_at = EXCLUDED.checked_at,
        token_expires_at = EXCLUDED.token_expires_at,
        quota_remaining = EXCLUDED.quota_remaining,
        quota_limit = EXCLUDED.quota_limit, updated_at = now()
  `;

  if (input.state === "ok") {
    await tx`
      UPDATE awcms_channel_accounts
      SET status = 'connected', status_reason = NULL,
          connected_at = COALESCE(connected_at, now()), updated_at = now(),
          version = version + 1
      WHERE tenant_id = ${tenantId} AND id = ${accountId}
        AND status IN ('pending', 'degraded')
    `;
  } else if (input.state === "degraded" || input.state === "failing") {
    await tx`
      UPDATE awcms_channel_accounts
      SET status = 'degraded', status_reason = ${input.reasonCode},
          updated_at = now(), version = version + 1
      WHERE tenant_id = ${tenantId} AND id = ${accountId}
        AND status = 'connected'
    `;
  }

  return { recorded: true };
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

export type AssignmentView = {
  id: string;
  accountId: string;
  tenantUserId: string;
  kind: ChannelAssignmentKind;
  createdAt: string;
};

type AssignmentRow = {
  id: string;
  account_id: string;
  tenant_user_id: string;
  kind: ChannelAssignmentKind;
  created_at: Date;
};

function toAssignment(row: AssignmentRow): AssignmentView {
  return {
    id: row.id,
    accountId: row.account_id,
    tenantUserId: row.tenant_user_id,
    kind: row.kind,
    createdAt: row.created_at.toISOString()
  };
}

export async function listAssignments(
  tx: Bun.SQL,
  tenantId: string,
  accountId: string
): Promise<AssignmentView[]> {
  const rows = (await tx`
    SELECT id, account_id, tenant_user_id, kind, created_at
    FROM awcms_channel_account_assignments
    WHERE tenant_id = ${tenantId} AND account_id = ${accountId}
    ORDER BY created_at, id
    LIMIT 200
  `) as AssignmentRow[];

  return rows.map(toAssignment);
}

export type AssignOutcome =
  | { outcome: "assigned"; assignment: AssignmentView }
  | { outcome: "refused"; code: "USER_NOT_FOUND" };

/** Upserts one assignee. The user must belong to THIS tenant (composite FK + this check gives a clean refusal instead of a constraint error). */
export async function assignAccount(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  accountId: string,
  input: AssignmentInput
): Promise<AssignOutcome> {
  const user = (await tx`
    SELECT 1 FROM awcms_tenant_users
    WHERE tenant_id = ${tenantId} AND id = ${input.tenantUserId}
  `) as unknown[];

  if (user.length === 0) return { outcome: "refused", code: "USER_NOT_FOUND" };

  const rows = (await tx`
    INSERT INTO awcms_channel_account_assignments
      (tenant_id, account_id, tenant_user_id, kind, created_by)
    VALUES (${tenantId}, ${accountId}, ${input.tenantUserId}, ${input.kind},
            ${actorTenantUserId})
    ON CONFLICT (tenant_id, account_id, tenant_user_id) DO UPDATE
    SET kind = EXCLUDED.kind
    RETURNING id, account_id, tenant_user_id, kind, created_at
  `) as AssignmentRow[];

  return { outcome: "assigned", assignment: toAssignment(rows[0]!) };
}

export async function unassignAccount(
  tx: Bun.SQL,
  tenantId: string,
  accountId: string,
  assignmentId: string
): Promise<boolean> {
  const rows = (await tx`
    DELETE FROM awcms_channel_account_assignments
    WHERE tenant_id = ${tenantId} AND account_id = ${accountId}
      AND id = ${assignmentId}
    RETURNING id
  `) as unknown[];

  return rows.length > 0;
}
