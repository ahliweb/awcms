/**
 * Provider connections and the OAuth grant lifecycle (Issue #1140, ADR-0148
 * sections 5 and pack threats T1, T12).
 *
 * ## What lives here, and what does not
 *
 * Here: the `state` nonce and PKCE pair, the verified callback, the durable
 * hand-off row, the grant state machine, revocation, and the server-side
 * refresh LEASE. Not here: the authorisation URL of any provider (the adapter's
 * pure function, `oauth-adapter-registry.ts`) and every provider HTTP call.
 * The token exchange and the refresh itself are provider I/O and run outside any
 * transaction in the connector's job (ADR-0148 I10); this module gives that job
 * the three calls it needs: {@link activateConnectionGrant},
 * {@link acquireRefreshLease} + {@link completeRefresh} / {@link failRefresh}.
 *
 * ## The callback is bound to three things, and answers one way
 *
 * The `state` must (1) exist, (2) be unexpired and unconsumed, and (3) have been
 * started by THIS tenant and THIS person. Every failure returns the same
 * `STATE_INVALID`: which of the three failed is not an oracle for a forger. The
 * tenant is also carried inside the state parameter (as the SSO flow does) and
 * must equal the request's tenant, so a callback cannot be pointed at another
 * tenant than the one that started it.
 */
import { createHash } from "node:crypto";

import {
  buildOAuthStateParam,
  computePkceChallengeS256,
  generateOAuthState,
  generatePkceVerifier,
  hashOAuthState,
  parseOAuthStateParam
} from "../../../lib/auth/oauth-state-token";
import {
  OAUTH_STATE_TTL_SECONDS,
  REFRESH_LEASE_SECONDS,
  type ChannelGrantState
} from "../domain/channel-accounts-constants";
import { resolveChannelOAuthRedirectUri } from "../domain/channel-accounts-config";
import { getProviderRow } from "../domain/provider-matrix";
import type { OAuthStartInput } from "../domain/channel-accounts-validation";
import { getChannelOAuthAdapter } from "./oauth-adapter-registry";
import type { SecretStorePort } from "./secret-store";

const MAX_PENDING_STATES_PER_PERSON = 10;
const MAX_REFRESH_FAILURES = 5;
const MAX_REFRESH_BACKOFF_SECONDS = 3600;

function sha256Tagged(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export type ConnectionView = {
  id: string;
  provider: string;
  authMode: string;
  grantState: ChannelGrantState;
  label: string | null;
  grantedScopes: string[];
  issuedAt: string | null;
  expiresAt: string | null;
  refreshExpiresAt: string | null;
  revokedAt: string | null;
  /** Whether an access credential is stored. Never the reference, never the value. */
  hasAccessCredential: boolean;
  /** An authorisation code waits for its token exchange. */
  awaitingExchange: boolean;
  connectedBy: string | null;
  createdAt: string;
};

type ConnectionRow = {
  id: string;
  provider: string;
  auth_mode: string;
  grant_state: ChannelGrantState;
  label: string | null;
  granted_scopes: string[];
  issued_at: Date | null;
  expires_at: Date | null;
  refresh_expires_at: Date | null;
  revoked_at: Date | null;
  access_secret_id: string | null;
  pending_code_secret_id: string | null;
  connected_by: string | null;
  created_at: Date;
};

const CONNECTION_COLUMNS = `id, provider, auth_mode, grant_state, label,
  granted_scopes, issued_at, expires_at, refresh_expires_at, revoked_at,
  access_secret_id, pending_code_secret_id, connected_by, created_at`;

function toConnectionView(row: ConnectionRow): ConnectionView {
  return {
    id: row.id,
    provider: row.provider,
    authMode: row.auth_mode,
    grantState: row.grant_state,
    label: row.label,
    grantedScopes: row.granted_scopes,
    issuedAt: row.issued_at?.toISOString() ?? null,
    expiresAt: row.expires_at?.toISOString() ?? null,
    refreshExpiresAt: row.refresh_expires_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    hasAccessCredential: row.access_secret_id !== null,
    awaitingExchange: row.pending_code_secret_id !== null,
    connectedBy: row.connected_by,
    createdAt: row.created_at.toISOString()
  };
}

export async function listConnections(
  tx: Bun.SQL,
  tenantId: string,
  provider: string | null
): Promise<ConnectionView[]> {
  const rows = (await tx`
    SELECT ${tx.unsafe(CONNECTION_COLUMNS)}
    FROM awcms_channel_provider_connections
    WHERE tenant_id = ${tenantId}
      AND (${provider}::text IS NULL OR provider = ${provider})
    ORDER BY created_at DESC, id DESC
    LIMIT 200
  `) as ConnectionRow[];

  return rows.map(toConnectionView);
}

export async function fetchConnection(
  tx: Bun.SQL,
  tenantId: string,
  connectionId: string
): Promise<ConnectionView | null> {
  const rows = (await tx`
    SELECT ${tx.unsafe(CONNECTION_COLUMNS)}
    FROM awcms_channel_provider_connections
    WHERE tenant_id = ${tenantId} AND id = ${connectionId}
  `) as ConnectionRow[];

  return rows.length === 0 ? null : toConnectionView(rows[0]!);
}

// ---------------------------------------------------------------------------
// Bounded sweep of abandoned authorisations
// ---------------------------------------------------------------------------

/** A hand-off nobody exchanged within a day is abandoned: its code must not sit encrypted forever. */
const STALE_PENDING_CONNECTION_SECONDS = 24 * 60 * 60;

/**
 * Removes what an abandoned authorisation leaves behind, in bounded batches for
 * ONE tenant: expired states that no connection references (with their PKCE
 * verifier ciphertext) and `pending` connections whose code was never exchanged
 * (failed, hand-off secrets erased). Called on the write path of
 * {@link startOAuthGrant}, so growth is bounded by use without a scheduled job
 * and without an orphaned ciphertext row. This is the `purgeFunctionRef` of the
 * `awcms_channel_oauth_states` lifecycle descriptor.
 */
export async function sweepExpiredOAuthStates(
  tx: Bun.SQL,
  store: SecretStorePort,
  tenantId: string,
  now: Date,
  limit = 50
): Promise<{ statesDeleted: number; connectionsFailed: number }> {
  const stale = (await tx`
    SELECT id FROM awcms_channel_provider_connections
    WHERE tenant_id = ${tenantId} AND grant_state = 'pending'
      AND created_at < ${new Date(now.getTime() - STALE_PENDING_CONNECTION_SECONDS * 1000)}
    ORDER BY created_at LIMIT ${limit}
  `) as { id: string }[];
  let connectionsFailed = 0;

  for (const row of stale) {
    if (await failConnectionGrant(tx, store, tenantId, row.id)) {
      connectionsFailed += 1;
    }
  }

  const expired = (await tx`
    DELETE FROM awcms_channel_oauth_states AS s
    WHERE s.id IN (
      SELECT o.id FROM awcms_channel_oauth_states AS o
      WHERE o.tenant_id = ${tenantId} AND o.expires_at < ${now}
        AND NOT EXISTS (
          SELECT 1 FROM awcms_channel_provider_connections AS c
          WHERE c.tenant_id = o.tenant_id AND c.oauth_state_id = o.id)
      ORDER BY o.created_at LIMIT ${limit})
      AND s.tenant_id = ${tenantId}
    RETURNING s.pkce_secret_id
  `) as { pkce_secret_id: string | null }[];

  for (const row of expired) {
    if (row.pkce_secret_id) {
      await store.remove(tx, tenantId, row.pkce_secret_id);
    }
  }

  return { statesDeleted: expired.length, connectionsFailed };
}

// ---------------------------------------------------------------------------
// OAuth start
// ---------------------------------------------------------------------------

export type StartOAuthOutcome =
  | { outcome: "started"; authorizationUrl: string; expiresAt: string }
  | {
      outcome: "refused";
      code:
        | "PROVIDER_UNKNOWN"
        | "PROVIDER_NOT_REGISTRABLE"
        | "AUTH_MODE_INVALID"
        | "PROVIDER_ADAPTER_UNAVAILABLE"
        | "TOO_MANY_PENDING";
    };

export async function startOAuthGrant(
  tx: Bun.SQL,
  store: SecretStorePort,
  tenantId: string,
  actorTenantUserId: string,
  input: OAuthStartInput,
  now: Date,
  env: NodeJS.ProcessEnv = process.env
): Promise<StartOAuthOutcome> {
  const row = getProviderRow(input.provider);

  if (!row) return { outcome: "refused", code: "PROVIDER_UNKNOWN" };
  if (!row.registrable) {
    return { outcome: "refused", code: "PROVIDER_NOT_REGISTRABLE" };
  }
  if (!row.authModes.includes("oauth2")) {
    return { outcome: "refused", code: "AUTH_MODE_INVALID" };
  }

  const adapter = getChannelOAuthAdapter(input.provider);

  if (!adapter) {
    return { outcome: "refused", code: "PROVIDER_ADAPTER_UNAVAILABLE" };
  }

  await sweepExpiredOAuthStates(tx, store, tenantId, now);

  const pending = (await tx`
    SELECT count(*)::int AS pending FROM awcms_channel_oauth_states
    WHERE tenant_id = ${tenantId} AND initiated_by = ${actorTenantUserId}
      AND consumed_at IS NULL AND expires_at > ${now}
  `) as { pending: number }[];

  if (pending[0]!.pending >= MAX_PENDING_STATES_PER_PERSON) {
    return { outcome: "refused", code: "TOO_MANY_PENDING" };
  }

  const redirectUri = resolveChannelOAuthRedirectUri(env);
  const rawState = generateOAuthState();
  let codeChallenge: string | null = null;
  let pkceSecretId: string | null = null;

  if (adapter.supportsPkce) {
    const verifier = generatePkceVerifier();

    codeChallenge = computePkceChallengeS256(verifier);
    pkceSecretId = (
      await store.put(tx, {
        tenantId,
        purpose: "oauth_pkce_verifier",
        plaintext: verifier,
        createdBy: actorTenantUserId
      })
    ).secretId;
  }

  const expiresAt = new Date(now.getTime() + OAUTH_STATE_TTL_SECONDS * 1000);
  const scope = input.businessScope;

  await tx`
    INSERT INTO awcms_channel_oauth_states
      (tenant_id, provider, state_hash, initiated_by, pkce_secret_id,
       redirect_uri_hash, requested_scopes, business_scope_type,
       business_scope_id, expires_at)
    VALUES (${tenantId}, ${input.provider}, ${hashOAuthState(rawState)},
            ${actorTenantUserId}, ${pkceSecretId}, ${sha256Tagged(redirectUri)},
            ${input.scopes}, ${scope?.type ?? null}, ${scope?.id ?? null},
            ${expiresAt})
  `;

  return {
    outcome: "started",
    authorizationUrl: adapter.buildAuthorizationUrl({
      state: buildOAuthStateParam(tenantId, rawState),
      codeChallenge,
      redirectUri,
      scopes: input.scopes
    }),
    expiresAt: expiresAt.toISOString()
  };
}

// ---------------------------------------------------------------------------
// OAuth callback
// ---------------------------------------------------------------------------

export type CallbackOutcome =
  | { outcome: "handed_off"; connectionId: string }
  | { outcome: "denied_by_provider" }
  | { outcome: "refused"; code: "STATE_INVALID" };

/**
 * Verifies the callback and leaves the durable hand-off (a `pending`
 * connection holding the encrypted authorisation code). It does NOT exchange the
 * code: that is provider I/O and runs outside this transaction.
 */
export async function completeOAuthCallback(
  tx: Bun.SQL,
  store: SecretStorePort,
  tenantId: string,
  tenantUserId: string,
  input: { stateParam: string; code: string | null; providerError: boolean },
  now: Date,
  env: NodeJS.ProcessEnv = process.env
): Promise<CallbackOutcome> {
  const invalid: CallbackOutcome = {
    outcome: "refused",
    code: "STATE_INVALID"
  };
  const parsed = parseOAuthStateParam(input.stateParam);

  if (!parsed || parsed.tenantId.toLowerCase() !== tenantId.toLowerCase()) {
    return invalid;
  }

  const rows = (await tx`
    SELECT id, provider, initiated_by, pkce_secret_id, redirect_uri_hash,
           requested_scopes, consumed_at, expires_at
    FROM awcms_channel_oauth_states
    WHERE tenant_id = ${tenantId} AND state_hash = ${hashOAuthState(parsed.token)}
    FOR UPDATE
  `) as {
    id: string;
    provider: string;
    initiated_by: string;
    pkce_secret_id: string | null;
    redirect_uri_hash: string;
    requested_scopes: string[];
    consumed_at: Date | null;
    expires_at: Date;
  }[];

  const state = rows[0];

  if (
    !state ||
    state.consumed_at !== null ||
    state.expires_at.getTime() <= now.getTime() ||
    state.initiated_by !== tenantUserId ||
    // The deployment's callback URI must be the one the flow was started with.
    state.redirect_uri_hash !==
      sha256Tagged(resolveChannelOAuthRedirectUri(env))
  ) {
    return invalid;
  }

  // Single use: compare-and-swap, so two callbacks racing on one state have one winner.
  const consumed = (await tx`
    UPDATE awcms_channel_oauth_states SET consumed_at = ${now}
    WHERE tenant_id = ${tenantId} AND id = ${state.id} AND consumed_at IS NULL
    RETURNING id
  `) as unknown[];

  if (consumed.length === 0) return invalid;

  if (input.providerError || !input.code) {
    if (state.pkce_secret_id) {
      await store.remove(tx, tenantId, state.pkce_secret_id);
    }

    return { outcome: "denied_by_provider" };
  }

  const code = await store.put(tx, {
    tenantId,
    purpose: "oauth_authorization_code",
    plaintext: input.code,
    createdBy: tenantUserId
  });
  const created = (await tx`
    INSERT INTO awcms_channel_provider_connections
      (tenant_id, provider, auth_mode, grant_state, redirect_uri_hash,
       oauth_state_id, pending_code_secret_id, connected_by)
    VALUES (${tenantId}, ${state.provider}, 'oauth2', 'pending',
            ${state.redirect_uri_hash}, ${state.id}, ${code.secretId},
            ${tenantUserId})
    RETURNING id
  `) as { id: string }[];

  return { outcome: "handed_off", connectionId: created[0]!.id };
}

// ---------------------------------------------------------------------------
// Grant activation / failure (called by the connector's exchange job)
// ---------------------------------------------------------------------------

export type GrantTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  refreshExpiresAt: Date | null;
  grantedScopes: string[];
};

export type ActivateGrantOutcome =
  | { outcome: "activated" }
  | { outcome: "not_found" }
  | { outcome: "refused"; code: "GRANT_STATE_INVALID" };

async function eraseHandoffSecrets(
  tx: Bun.SQL,
  store: SecretStorePort,
  tenantId: string,
  connectionId: string
): Promise<void> {
  const rows = (await tx`
    SELECT c.pending_code_secret_id, s.pkce_secret_id
    FROM awcms_channel_provider_connections AS c
    LEFT JOIN awcms_channel_oauth_states AS s
      ON s.tenant_id = c.tenant_id AND s.id = c.oauth_state_id
    WHERE c.tenant_id = ${tenantId} AND c.id = ${connectionId}
  `) as {
    pending_code_secret_id: string | null;
    pkce_secret_id: string | null;
  }[];
  const row = rows[0];

  if (!row) return;

  await tx`
    UPDATE awcms_channel_provider_connections
    SET pending_code_secret_id = NULL
    WHERE tenant_id = ${tenantId} AND id = ${connectionId}
  `;

  if (row.pending_code_secret_id) {
    await store.remove(tx, tenantId, row.pending_code_secret_id);
  }

  // The state's reference clears itself (ON DELETE SET NULL).
  if (row.pkce_secret_id) {
    await store.remove(tx, tenantId, row.pkce_secret_id);
  }
}

export async function activateConnectionGrant(
  tx: Bun.SQL,
  store: SecretStorePort,
  tenantId: string,
  connectionId: string,
  grant: GrantTokens,
  now: Date
): Promise<ActivateGrantOutcome> {
  const current = await fetchConnection(tx, tenantId, connectionId);

  if (!current) return { outcome: "not_found" };
  if (current.grantState !== "pending") {
    return { outcome: "refused", code: "GRANT_STATE_INVALID" };
  }

  await eraseHandoffSecrets(tx, store, tenantId, connectionId);

  const access = await store.put(tx, {
    tenantId,
    purpose: "provider_access_token",
    plaintext: grant.accessToken,
    createdBy: null
  });
  const refresh = grant.refreshToken
    ? await store.put(tx, {
        tenantId,
        purpose: "provider_refresh_token",
        plaintext: grant.refreshToken,
        createdBy: null
      })
    : null;
  const scopes = [...new Set(grant.grantedScopes)].sort();

  await tx`
    UPDATE awcms_channel_provider_connections
    SET grant_state = 'active', access_secret_id = ${access.secretId},
        refresh_secret_id = ${refresh?.secretId ?? null},
        granted_scopes = ${scopes}, scope_list_hash = ${sha256Tagged(scopes.join(" "))},
        issued_at = ${now}, expires_at = ${grant.expiresAt},
        refresh_expires_at = ${grant.refreshExpiresAt},
        refresh_failure_count = 0, refresh_lease_until = NULL,
        updated_at = now(), version = version + 1
    WHERE tenant_id = ${tenantId} AND id = ${connectionId}
  `;

  return { outcome: "activated" };
}

/** The exchange failed (invalid code, provider refusal): the hand-off is erased and the grant is `failed`. */
export async function failConnectionGrant(
  tx: Bun.SQL,
  store: SecretStorePort,
  tenantId: string,
  connectionId: string
): Promise<boolean> {
  const current = await fetchConnection(tx, tenantId, connectionId);

  if (!current || current.grantState !== "pending") return false;

  await eraseHandoffSecrets(tx, store, tenantId, connectionId);
  await tx`
    UPDATE awcms_channel_provider_connections
    SET grant_state = 'failed', updated_at = now(), version = version + 1
    WHERE tenant_id = ${tenantId} AND id = ${connectionId}
  `;

  return true;
}

// ---------------------------------------------------------------------------
// Revocation
// ---------------------------------------------------------------------------

export type RevokeOutcome =
  | { outcome: "revoked"; accountsRevoked: number }
  | { outcome: "not_found" }
  | { outcome: "refused"; code: "GRANT_STATE_INVALID" };

/**
 * Revocation: the grant is `revoked` (terminal, trigger-enforced), every
 * credential reference it held is cleared and its ciphertext deleted, and the
 * accounts bound to it become `revoked` too, so nothing can use the old grant on
 * the next claim. Provider-side revocation (calling the provider's revoke
 * endpoint) is the connector's job; this is the half that must not depend on it.
 */
export async function revokeConnection(
  tx: Bun.SQL,
  store: SecretStorePort,
  tenantId: string,
  connectionId: string
): Promise<RevokeOutcome> {
  const rows = (await tx`
    SELECT grant_state, access_secret_id, refresh_secret_id,
           pending_code_secret_id, oauth_state_id
    FROM awcms_channel_provider_connections
    WHERE tenant_id = ${tenantId} AND id = ${connectionId}
    FOR UPDATE
  `) as {
    grant_state: ChannelGrantState;
    access_secret_id: string | null;
    refresh_secret_id: string | null;
    pending_code_secret_id: string | null;
    oauth_state_id: string | null;
  }[];
  const row = rows[0];

  if (!row) return { outcome: "not_found" };
  if (row.grant_state === "revoked") {
    return { outcome: "refused", code: "GRANT_STATE_INVALID" };
  }

  const pkce = row.oauth_state_id
    ? ((
        (await tx`
        SELECT pkce_secret_id FROM awcms_channel_oauth_states
        WHERE tenant_id = ${tenantId} AND id = ${row.oauth_state_id}
      `) as { pkce_secret_id: string | null }[]
      )[0]?.pkce_secret_id ?? null)
    : null;

  await tx`
    UPDATE awcms_channel_provider_connections
    SET grant_state = 'revoked', revoked_at = now(),
        access_secret_id = NULL, refresh_secret_id = NULL,
        pending_code_secret_id = NULL, refresh_lease_until = NULL,
        updated_at = now(), version = version + 1
    WHERE tenant_id = ${tenantId} AND id = ${connectionId}
  `;

  for (const secretId of [
    row.access_secret_id,
    row.refresh_secret_id,
    row.pending_code_secret_id,
    pkce
  ]) {
    if (secretId) await store.remove(tx, tenantId, secretId);
  }

  const accounts = (await tx`
    UPDATE awcms_channel_accounts
    SET status = 'revoked', status_reason = 'CONNECTION_REVOKED',
        revoked_at = now(), connected_at = NULL, updated_at = now(),
        version = version + 1
    WHERE tenant_id = ${tenantId} AND connection_id = ${connectionId}
      AND deleted_at IS NULL AND status <> 'revoked'
    RETURNING id
  `) as unknown[];

  return { outcome: "revoked", accountsRevoked: accounts.length };
}

// ---------------------------------------------------------------------------
// Refresh lease (T12): one winner per attempt, bounded backoff on failure
// ---------------------------------------------------------------------------

export type LeaseOutcome =
  { acquired: true; leaseVersion: number } | { acquired: false };

/**
 * Takes the refresh lease with a compare-and-set on the connection row. Of N
 * concurrent callers exactly one gets `acquired: true` and may call the
 * provider; the rest see zero rows and do not. A crashed holder's lease expires
 * after {@link REFRESH_LEASE_SECONDS}, and a failed refresh pushes the lease out
 * by a bounded exponential backoff, so a provider outage is not a retry storm.
 */
export async function acquireRefreshLease(
  tx: Bun.SQL,
  tenantId: string,
  connectionId: string,
  now: Date
): Promise<LeaseOutcome> {
  const leaseUntil = new Date(now.getTime() + REFRESH_LEASE_SECONDS * 1000);
  const rows = (await tx`
    UPDATE awcms_channel_provider_connections
    SET refresh_lease_until = ${leaseUntil}, version = version + 1,
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${connectionId}
      AND grant_state = 'active'
      AND (refresh_lease_until IS NULL OR refresh_lease_until <= ${now})
    RETURNING version
  `) as { version: number }[];

  return rows.length === 0
    ? { acquired: false }
    : { acquired: true, leaseVersion: rows[0]!.version };
}

export type CompleteRefreshOutcome =
  { outcome: "refreshed" } | { outcome: "lease_lost" };

/** Stores the refreshed tokens, but only for the holder of the lease it took (its version must still be current). */
export async function completeRefresh(
  tx: Bun.SQL,
  store: SecretStorePort,
  tenantId: string,
  connectionId: string,
  leaseVersion: number,
  tokens: {
    accessToken: string;
    refreshToken: string | null;
    expiresAt: Date | null;
  }
): Promise<CompleteRefreshOutcome> {
  const claimed = (await tx`
    UPDATE awcms_channel_provider_connections
    SET refresh_lease_until = NULL, refresh_failure_count = 0,
        expires_at = ${tokens.expiresAt}, version = version + 1,
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${connectionId}
      AND grant_state = 'active' AND version = ${leaseVersion}
      AND refresh_lease_until IS NOT NULL
    RETURNING access_secret_id, refresh_secret_id
  `) as { access_secret_id: string | null; refresh_secret_id: string | null }[];
  const row = claimed[0];

  if (!row) return { outcome: "lease_lost" };

  if (row.access_secret_id) {
    await store.replace(tx, {
      tenantId,
      secretId: row.access_secret_id,
      purpose: "provider_access_token",
      plaintext: tokens.accessToken
    });
  } else {
    const access = await store.put(tx, {
      tenantId,
      purpose: "provider_access_token",
      plaintext: tokens.accessToken,
      createdBy: null
    });

    await tx`
      UPDATE awcms_channel_provider_connections
      SET access_secret_id = ${access.secretId}
      WHERE tenant_id = ${tenantId} AND id = ${connectionId}
    `;
  }

  if (tokens.refreshToken) {
    if (row.refresh_secret_id) {
      await store.replace(tx, {
        tenantId,
        secretId: row.refresh_secret_id,
        purpose: "provider_refresh_token",
        plaintext: tokens.refreshToken
      });
    } else {
      const refresh = await store.put(tx, {
        tenantId,
        purpose: "provider_refresh_token",
        plaintext: tokens.refreshToken,
        createdBy: null
      });

      await tx`
        UPDATE awcms_channel_provider_connections
        SET refresh_secret_id = ${refresh.secretId}
        WHERE tenant_id = ${tenantId} AND id = ${connectionId}
      `;
    }
  }

  return { outcome: "refreshed" };
}

export type FailRefreshOutcome =
  | { outcome: "backoff"; retryAfterSeconds: number }
  | { outcome: "expired" }
  | { outcome: "lease_lost" };

/**
 * A failed refresh. `permanent` (the provider says the grant is invalid or
 * revoked) or too many failures end the grant (`expired`) and degrade its
 * accounts, which stops sends; otherwise the lease is pushed out by a bounded
 * exponential backoff. No path retries immediately.
 */
export async function failRefresh(
  tx: Bun.SQL,
  tenantId: string,
  connectionId: string,
  leaseVersion: number,
  options: { permanent: boolean },
  now: Date
): Promise<FailRefreshOutcome> {
  const rows = (await tx`
    SELECT refresh_failure_count FROM awcms_channel_provider_connections
    WHERE tenant_id = ${tenantId} AND id = ${connectionId}
      AND grant_state = 'active' AND version = ${leaseVersion}
    FOR UPDATE
  `) as { refresh_failure_count: number }[];

  if (rows.length === 0) return { outcome: "lease_lost" };

  const failures = rows[0]!.refresh_failure_count + 1;

  if (options.permanent || failures >= MAX_REFRESH_FAILURES) {
    await tx`
      UPDATE awcms_channel_provider_connections
      SET grant_state = 'expired', refresh_lease_until = NULL,
          refresh_failure_count = ${failures}, version = version + 1,
          updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${connectionId}
    `;
    await tx`
      UPDATE awcms_channel_accounts
      SET status = 'degraded', status_reason = 'TOKEN_REFRESH_FAILED',
          updated_at = now(), version = version + 1
      WHERE tenant_id = ${tenantId} AND connection_id = ${connectionId}
        AND deleted_at IS NULL AND status = 'connected'
    `;

    return { outcome: "expired" };
  }

  const backoff = Math.min(
    REFRESH_LEASE_SECONDS * 2 ** failures,
    MAX_REFRESH_BACKOFF_SECONDS
  );

  await tx`
    UPDATE awcms_channel_provider_connections
    SET refresh_lease_until = ${new Date(now.getTime() + backoff * 1000)},
        refresh_failure_count = ${failures}, version = version + 1,
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${connectionId}
  `;

  return { outcome: "backoff", retryAfterSeconds: backoff };
}
